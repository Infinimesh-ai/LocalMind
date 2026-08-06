package controller

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	iscpcrypto "github.com/Infinimesh-ai/ISCP/pkg/iscp/crypto"
	"github.com/Infinimesh-ai/ISCP/pkg/iscp/identity"
	"github.com/gorilla/websocket"
)

const accessProofHeader = "X-ISCP-Access-Proof"

type relayMessage struct {
	State     string          `json:"state"`
	Challenge string          `json:"challenge,omitempty"`
	Envelope  json.RawMessage `json:"envelope,omitempty"`
	Error     string          `json:"error,omitempty"`
}

type relayClient struct {
	cfg      Config
	provider iscpcrypto.Provider
	device   identity.Device
	http     *http.Client

	mu         sync.RWMutex
	credential RelayCredential
}

func newRelayClient(cfg Config, device identity.Device, credential RelayCredential) *relayClient {
	return &relayClient{
		cfg: cfg, provider: iscpcrypto.NewProvider(), device: device,
		http: &http.Client{Timeout: cfg.RequestTimeout}, credential: credential,
	}
}

func (c *relayClient) setCredential(credential RelayCredential) {
	c.mu.Lock()
	c.credential = credential
	c.mu.Unlock()
}

func (c *relayClient) credentialSnapshot() RelayCredential {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.credential
}

func (c *relayClient) submit(ctx context.Context, value any) error {
	c.mu.RLock()
	credential := c.credential
	c.mu.RUnlock()
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	path := "/v2/relay/envelopes"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.cfg.RelayInternalBaseURL, "/")+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+credential.Token)
	req.Header.Set("Content-Type", "application/json")
	proof, err := c.accessProof(credential.Token, http.MethodPost, path)
	if err != nil {
		return err
	}
	req.Header.Set(accessProofHeader, proof)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("relay returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func (c *relayClient) runOnce(ctx context.Context, handle func(context.Context, json.RawMessage) error) error {
	conn, response, err := (&websocket.Dialer{HandshakeTimeout: c.cfg.RequestTimeout}).DialContext(ctx, c.cfg.RelayInternalWebSocket, nil)
	if err != nil {
		if response != nil {
			return fmt.Errorf("relay websocket returned %d", response.StatusCode)
		}
		return err
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()

	var challenge relayMessage
	if err := conn.ReadJSON(&challenge); err != nil {
		return err
	}
	if challenge.State != "challenge" || challenge.Challenge == "" {
		return errors.New("relay returned invalid challenge")
	}
	proof, err := c.device.CreateProof(c.provider, c.cfg.RelayID, challenge.Challenge, randomToken(), time.Now().UTC())
	if err != nil {
		return err
	}
	if err := conn.WriteJSON(proof); err != nil {
		return err
	}
	var ready relayMessage
	if err := conn.ReadJSON(&ready); err != nil {
		return err
	}
	if ready.State != "ready" {
		return fmt.Errorf("relay connection not ready: %s", ready.Error)
	}
	for {
		var message relayMessage
		if err := conn.ReadJSON(&message); err != nil {
			return err
		}
		switch message.State {
		case "message":
			if err := handle(ctx, message.Envelope); err != nil {
				return err
			}
		case "drained":
			return nil
		case "closed":
			return errors.New("relay closed connection")
		default:
			return fmt.Errorf("unknown relay state %q", message.State)
		}
	}
}

func (c *relayClient) accessProof(token, method, path string) (string, error) {
	hash := iscpcrypto.SHA256([]byte(token))
	challenge := strings.Join([]string{
		"iscp/v2/relay/access-proof",
		strings.ToUpper(method),
		path,
		iscpcrypto.Base64URL(hash),
	}, "\x00")
	proof, err := c.device.CreateProof(c.provider, c.cfg.RelayID, challenge, randomToken(), time.Now().UTC())
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(proof)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func randomToken() string {
	var value [32]byte
	_, _ = rand.Read(value[:])
	return base64.RawURLEncoding.EncodeToString(value[:])
}
