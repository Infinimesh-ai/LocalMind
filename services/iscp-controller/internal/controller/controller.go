package controller

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Infinimesh-ai/ISCP/pkg/iscp/canonical"
	iscpcrypto "github.com/Infinimesh-ai/ISCP/pkg/iscp/crypto"
	"github.com/Infinimesh-ai/ISCP/pkg/iscp/identity"
	"github.com/Infinimesh-ai/ISCP/pkg/iscp/session"
	"github.com/Infinimesh-ai/ISCP/pkg/iscp/trust"
	"github.com/Infinimesh-ai/ISCP/pkg/server/postgres"
	"github.com/Infinimesh-ai/ISCP/pkg/server/repository"
	"github.com/jackc/pgx/v5/pgxpool"
)

type secureSession struct {
	mu        sync.Mutex
	peer      PeerAuthorization
	state     *session.State
	ready     chan struct{}
	readyOnce sync.Once
}

type agentWaiter struct {
	deviceID string
	response chan AgentResponse
}

type Controller struct {
	cfg      Config
	logger   *slog.Logger
	provider iscpcrypto.Provider
	db       *pgxpool.Pool
	repo     repository.RelayRepository
	trust    identity.Device
	device   identity.Device
	relay    *relayClient

	mu            sync.RWMutex
	refreshMu     sync.Mutex
	deliveryLocks map[string]*sync.Mutex
	peers         map[string]PeerAuthorization
	sessions      map[string]*secureSession
	peerSessions  map[string]string
	pendingHellos map[string]session.LocalHello
	waiters       map[string]agentWaiter
	lastSeen      map[string]time.Time
}

func New(ctx context.Context, cfg Config, logger *slog.Logger) (*Controller, error) {
	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	migrations, err := postgres.EmbeddedMigrations()
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("load Relay migrations: %w", err)
	}
	if err := postgres.ApplyMigrations(ctx, db, migrations); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply Relay migrations: %w", err)
	}
	trustRoot, err := loadOrCreateDevice(cfg.StateDirectory, "trust-root.json", cfg.DomainID, "localmind-trust-root", map[string]string{"product_kind": "localmind", "device_role": "trust_root"})
	if err != nil {
		db.Close()
		return nil, err
	}
	device, err := loadOrCreateDevice(cfg.StateDirectory, "localmind-peer.json", cfg.DomainID, "localmind-notifications", map[string]string{"product_kind": "localmind", "device_role": "notification_service"})
	if err != nil {
		db.Close()
		return nil, err
	}
	c := &Controller{
		cfg: cfg, logger: logger, provider: iscpcrypto.NewProvider(), db: db,
		repo: repository.NewRelayRepository(db), trust: trustRoot, device: device,
		deliveryLocks: map[string]*sync.Mutex{}, peers: map[string]PeerAuthorization{}, sessions: map[string]*secureSession{},
		peerSessions: map[string]string{}, pendingHellos: map[string]session.LocalHello{},
		waiters: map[string]agentWaiter{}, lastSeen: map[string]time.Time{},
	}
	if err := c.loadPeers(); err != nil {
		c.Close()
		return nil, err
	}
	if err := c.registerDevice(ctx, device.Identity); err != nil {
		c.Close()
		return nil, fmt.Errorf("register LocalMind Relay device: %w", err)
	}
	access, _, err := c.issueCredentials(ctx, device.Identity.DeviceID, 30*24*time.Hour)
	if err != nil {
		c.Close()
		return nil, fmt.Errorf("issue LocalMind Relay credentials: %w", err)
	}
	c.relay = newRelayClient(cfg, device, access)
	return c, nil
}

func (c *Controller) Close() {
	if c.db != nil {
		c.db.Close()
	}
}

func (c *Controller) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", c.health)
	mux.HandleFunc("POST /v1/enrollments", c.authorized(c.enroll))
	mux.HandleFunc("POST /v1/deliveries", c.authorized(c.deliver))
	mux.HandleFunc("GET /v1/devices/{deviceID}/status", c.authorized(c.deviceStatus))
	mux.HandleFunc("DELETE /v1/devices/{deviceID}", c.authorized(c.revokeDevice))
	mux.HandleFunc("POST /v2/relay/devices/refresh-access", c.refreshAccess)
	mux.HandleFunc("POST /v2/relay/envelopes", c.proxyEnvelope)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	})
}

func (c *Controller) RunRelay(ctx context.Context) {
	backoff := time.Second
	for ctx.Err() == nil {
		if time.Until(c.relay.credentialSnapshot().ExpiresAt) < time.Minute {
			access, _, err := c.issueCredentials(ctx, c.device.Identity.DeviceID, 30*24*time.Hour)
			if err == nil {
				c.relay.setCredential(access)
			}
		}
		err := c.relay.runOnce(ctx, c.handleRelayMessage)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			c.logger.Warn("Relay connection ended", "error", err)
		}
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func (c *Controller) authorized(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if len(token) != len(c.cfg.ControllerToken) || subtle.ConstantTimeCompare([]byte(token), []byte(c.cfg.ControllerToken)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

func (c *Controller) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "device_id": c.device.Identity.DeviceID})
}

func (c *Controller) enroll(w http.ResponseWriter, r *http.Request) {
	var input EnrollInput
	if err := decodeJSON(r, &input, 1<<20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	req := input.Request
	if err := validateEnrollmentInput(input, c.cfg.DomainID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := c.registerDevice(r.Context(), req.Identity); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Relay device registration failed"})
		return
	}
	access, refresh, err := c.issueCredentials(r.Context(), req.Identity.DeviceID, 30*24*time.Hour)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Relay credential issuance failed"})
		return
	}
	now := time.Now().UTC()
	grantExpiry := now.Add(30 * 24 * time.Hour)
	localThumbprint, _ := identity.Thumbprint(c.device.Identity)
	remoteThumbprint, _ := identity.Thumbprint(req.Identity)
	localToSpark, err := trust.SignGrant(c.provider, c.trust, trust.Grant{
		GrantID: randomToken(), SubjectDeviceID: c.device.Identity.DeviceID, Audience: req.Identity.DeviceID,
		ConfirmationThumbprint: localThumbprint, Permissions: []string{permission}, RelayConstraints: []string{c.cfg.RelayID},
		NotBefore: now.Add(-time.Minute), ExpiresAt: grantExpiry,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Trust Grant issuance failed"})
		return
	}
	sparkToLocal, err := trust.SignGrant(c.provider, c.trust, trust.Grant{
		GrantID: randomToken(), SubjectDeviceID: req.Identity.DeviceID, Audience: c.device.Identity.DeviceID,
		ConfirmationThumbprint: remoteThumbprint, Permissions: []string{permission}, RelayConstraints: []string{c.cfg.RelayID},
		NotBefore: now.Add(-time.Minute), ExpiresAt: grantExpiry,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Trust Grant issuance failed"})
		return
	}
	sparkPeer := PeerAuthorization{
		Identity: c.device.Identity, InboundGrant: localToSpark, OutboundGrant: sparkToLocal,
	}
	controllerPeer := PeerAuthorization{
		Identity: req.Identity, InboundGrant: sparkToLocal, OutboundGrant: localToSpark,
	}
	if err := c.savePeer(controllerPeer); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "persist peer authorization failed"})
		return
	}
	bundle := EnrollmentBundle{
		Type: enrollmentBundleType, DomainID: c.cfg.DomainID, DeviceID: req.Identity.DeviceID,
		RelayID: c.cfg.RelayID, RelayBaseURL: c.cfg.RelayPublicBaseURL, RelayWebSocketURL: c.cfg.RelayPublicWebSocket,
		TrustRootIdentity: c.trust.Identity, Access: access, Refresh: refresh, Peers: []PeerAuthorization{sparkPeer},
		IssuedAt: now, ExpiresAt: grantExpiry,
	}
	writeJSON(w, http.StatusCreated, bundle)
}

func (c *Controller) deliver(w http.ResponseWriter, r *http.Request) {
	var input DeliveryInput
	if err := decodeJSON(r, &input, 64<<10); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if input.DeliveryID == "" || input.DeviceID == "" || strings.TrimSpace(input.Content) == "" || len(input.Content) > 16<<10 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "delivery_id, device_id and bounded content are required"})
		return
	}
	unlock := c.lockDeviceDelivery(input.DeviceID)
	defer unlock()
	ctx, cancel := context.WithTimeout(r.Context(), c.cfg.RequestTimeout)
	defer cancel()
	result, err := c.sendDelivery(ctx, input)
	if err != nil {
		c.invalidateDeviceSession(input.DeviceID)
		status := http.StatusServiceUnavailable
		if errors.Is(err, context.DeadlineExceeded) {
			status = http.StatusGatewayTimeout
		}
		writeJSON(w, status, map[string]any{"error": err.Error(), "retryable": true})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (c *Controller) lockDeviceDelivery(deviceID string) func() {
	c.mu.Lock()
	if c.deliveryLocks == nil {
		c.deliveryLocks = map[string]*sync.Mutex{}
	}
	lock := c.deliveryLocks[deviceID]
	if lock == nil {
		lock = &sync.Mutex{}
		c.deliveryLocks[deviceID] = lock
	}
	c.mu.Unlock()
	lock.Lock()
	return lock.Unlock
}

func (c *Controller) deviceStatus(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("deviceID")
	c.mu.RLock()
	lastSeen, ok := c.lastSeen[deviceID]
	_, enrolled := c.peers[deviceID]
	c.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{"enrolled": enrolled, "online": ok && time.Since(lastSeen) < 2*time.Minute, "last_seen_at": lastSeen})
}

func (c *Controller) revokeDevice(w http.ResponseWriter, r *http.Request) {
	deviceID := r.PathValue("deviceID")
	now := time.Now().UTC()
	if err := c.repo.RevokeDevice(r.Context(), repository.DomainID(c.cfg.DomainID), deviceID, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "revoke device failed"})
		return
	}
	_ = c.repo.RevokeDeviceCredentials(r.Context(), repository.DomainID(c.cfg.DomainID), deviceID, now)
	c.mu.Lock()
	delete(c.peers, deviceID)
	if sessionID := c.peerSessions[deviceID]; sessionID != "" {
		delete(c.sessions, sessionID)
		delete(c.peerSessions, deviceID)
	}
	c.mu.Unlock()
	_ = os.Remove(c.peerPath(deviceID))
	w.WriteHeader(http.StatusNoContent)
}

func (c *Controller) proxyEnvelope(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, strings.TrimRight(c.cfg.RelayInternalBaseURL, "/")+"/v2/relay/envelopes", bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "proxy request failed"})
		return
	}
	for _, name := range []string{"Authorization", "Content-Type", accessProofHeader} {
		req.Header.Set(name, r.Header.Get(name))
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Relay unavailable"})
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, 4<<20))
}

func (c *Controller) refreshAccess(w http.ResponseWriter, r *http.Request) {
	c.refreshMu.Lock()
	defer c.refreshMu.Unlock()

	var input struct {
		Refresh string `json:"refresh"`
	}
	if err := decodeJSON(r, &input, 4096); err != nil || input.Refresh == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "refresh credential is required"})
		return
	}
	now := time.Now().UTC()
	hash := iscpcrypto.SHA256([]byte(input.Refresh))
	credential, err := c.repo.GetRefreshByHash(r.Context(), repository.DomainID(c.cfg.DomainID), hash, now)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "refresh credential invalid"})
		return
	}
	if err := c.repo.RevokeRefreshByHash(r.Context(), repository.DomainID(c.cfg.DomainID), hash, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "credential rotation failed"})
		return
	}
	access, refresh, err := c.issueCredentials(r.Context(), credential.DeviceID, 30*24*time.Hour)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "credential rotation failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"access": access, "refresh": refresh})
}

func validateEnrollmentInput(input EnrollInput, domainID string) error {
	req := input.Request
	if req.Type != enrollmentRequestType || req.ProductKind != "sparkclaw" || req.RuntimeKind != "sparkclaw" || req.Identity.Type != identity.TypeDeviceIdentity || req.Identity.DomainID != domainID || req.Identity.DeviceID == "" {
		return errors.New("invalid SparkClaw enrollment request")
	}
	if input.EndpointID == "" || input.EndpointID != req.Identity.DeviceID {
		return errors.New("endpoint identity does not match pairing")
	}
	thumbprint, err := identity.Thumbprint(req.Identity)
	if err != nil || req.Identity.PublicKey.KTY != "Ed25519" || req.Identity.PublicKey.Use != "identity-signature" || req.Identity.PublicKey.KID != thumbprint {
		return errors.New("invalid device public key")
	}
	return nil
}

func (c *Controller) registerDevice(ctx context.Context, value identity.DeviceIdentity) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	canonicalValue, err := canonical.Marshal(raw)
	if err != nil {
		return err
	}
	thumbprint, err := identity.Thumbprint(value)
	if err != nil {
		return err
	}
	id, err := postgres.NewUUIDv7Like(time.Now().UTC())
	if err != nil {
		return err
	}
	return c.repo.InsertDevice(ctx, repository.RelayDevice{
		ID: postgres.UUIDString(id), DomainID: repository.DomainID(c.cfg.DomainID), DeviceID: value.DeviceID,
		IdentityRaw: raw, IdentityCanonical: canonicalValue, PublicKeyThumbprint: thumbprint,
		Status: "active", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	})
}

func (c *Controller) issueCredentials(ctx context.Context, deviceID string, refreshTTL time.Duration) (RelayCredential, RelayCredential, error) {
	now := time.Now().UTC()
	accessToken, refreshToken := randomToken(), randomToken()
	access := RelayCredential{DomainID: c.cfg.DomainID, DeviceID: deviceID, Token: accessToken, ExpiresAt: now.Add(15 * time.Minute)}
	refresh := RelayCredential{DomainID: c.cfg.DomainID, DeviceID: deviceID, Token: refreshToken, ExpiresAt: now.Add(refreshTTL)}
	accessID, err := postgres.NewUUIDv7Like(now)
	if err != nil {
		return RelayCredential{}, RelayCredential{}, err
	}
	refreshID, err := postgres.NewUUIDv7Like(now)
	if err != nil {
		return RelayCredential{}, RelayCredential{}, err
	}
	if err := c.repo.StoreAccessHash(ctx, postgres.UUIDString(accessID), repository.DomainID(c.cfg.DomainID), deviceID, iscpcrypto.SHA256([]byte(accessToken)), now, access.ExpiresAt); err != nil {
		return RelayCredential{}, RelayCredential{}, err
	}
	if err := c.repo.StoreRefreshHash(ctx, postgres.UUIDString(refreshID), repository.DomainID(c.cfg.DomainID), deviceID, iscpcrypto.SHA256([]byte(refreshToken)), now, refresh.ExpiresAt); err != nil {
		return RelayCredential{}, RelayCredential{}, err
	}
	return access, refresh, nil
}

func decodeJSON(r *http.Request, out any, limit int64) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, limit))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (c *Controller) peerPath(deviceID string) string {
	return filepath.Join(c.cfg.StateDirectory, "peers", filepath.Base(deviceID)+".json")
}

func (c *Controller) savePeer(peer PeerAuthorization) error {
	directory := filepath.Join(c.cfg.StateDirectory, "peers")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(peer, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(c.peerPath(peer.Identity.DeviceID), append(raw, '\n'), 0o600); err != nil {
		return err
	}
	c.mu.Lock()
	c.peers[peer.Identity.DeviceID] = peer
	c.mu.Unlock()
	return nil
}

func (c *Controller) loadPeers() error {
	directory := filepath.Join(c.cfg.StateDirectory, "peers")
	entries, err := os.ReadDir(directory)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(directory, entry.Name()))
		if err != nil {
			return err
		}
		var peer PeerAuthorization
		if err := json.Unmarshal(raw, &peer); err != nil {
			return err
		}
		c.peers[peer.Identity.DeviceID] = peer
	}
	return nil
}
