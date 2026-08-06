package controller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Infinimesh-ai/ISCP/pkg/iscp/envelope"
	"github.com/Infinimesh-ai/ISCP/pkg/iscp/identity"
	"github.com/Infinimesh-ai/ISCP/pkg/iscp/payload"
	"github.com/Infinimesh-ai/ISCP/pkg/iscp/session"
	"github.com/Infinimesh-ai/ISCP/pkg/iscp/trust"
)

func (c *Controller) sendDelivery(ctx context.Context, input DeliveryInput) (DeliveryResult, error) {
	secured, err := c.ensureSession(ctx, input.DeviceID)
	if err != nil {
		return DeliveryResult{}, err
	}
	agentSessionID := strings.TrimSpace(input.AgentSessionID)
	if agentSessionID == "" {
		response, err := c.sendAgentRequest(ctx, secured, AgentRequest{
			ProtocolVersion: protocolVersion,
			Type:            typeSessionCreate,
			RequestID:       "localmind-session-" + input.DeviceID,
			EndpointID:      c.device.Identity.DeviceID,
			IdempotencyKey:  "localmind-notification-session:" + input.DeviceID,
			IssuedAt:        time.Now().UTC(),
			ExpiresAt:       time.Now().UTC().Add(5 * time.Minute),
			Payload:         json.RawMessage(`{"title":"LocalMind notifications"}`),
		})
		if err != nil {
			return DeliveryResult{}, fmt.Errorf("create SparkClaw session: %w", err)
		}
		if response.Status != "ok" {
			return DeliveryResult{}, responseError(response)
		}
		var result struct {
			Session struct {
				ID string `json:"id"`
			} `json:"session"`
		}
		if err := json.Unmarshal(response.Result, &result); err != nil || result.Session.ID == "" {
			return DeliveryResult{}, errors.New("SparkClaw returned an invalid session")
		}
		agentSessionID = result.Session.ID
	}
	payloadRaw, _ := json.Marshal(map[string]string{"content": input.Content})
	now := time.Now().UTC()
	response, err := c.sendAgentRequest(ctx, secured, AgentRequest{
		ProtocolVersion: protocolVersion,
		Type:            typeMessageSend,
		RequestID:       input.DeliveryID,
		EndpointID:      c.device.Identity.DeviceID,
		SessionID:       agentSessionID,
		IdempotencyKey:  "localmind-notification:" + input.DeliveryID,
		IssuedAt:        now,
		ExpiresAt:       now.Add(5 * time.Minute),
		Payload:         payloadRaw,
	})
	if err != nil {
		return DeliveryResult{}, err
	}
	if response.Status != "accepted" || response.Operation == nil {
		return DeliveryResult{}, responseError(response)
	}
	return DeliveryResult{Accepted: true, AgentSessionID: agentSessionID, OperationID: response.Operation.ID}, nil
}

func responseError(response AgentResponse) error {
	if response.Error != nil {
		return fmt.Errorf("SparkClaw rejected request (%s): %s", response.Error.Code, response.Error.Message)
	}
	return fmt.Errorf("SparkClaw returned status %q", response.Status)
}

func (c *Controller) ensureSession(ctx context.Context, deviceID string) (*secureSession, error) {
	c.mu.Lock()
	peer, ok := c.peers[deviceID]
	if !ok {
		c.mu.Unlock()
		return nil, errors.New("SparkClaw endpoint is not enrolled")
	}
	if sessionID := c.peerSessions[deviceID]; sessionID != "" {
		secured := c.sessions[sessionID]
		c.mu.Unlock()
		if secured == nil {
			return nil, errors.New("ISCP session state is unavailable")
		}
		select {
		case <-secured.ready:
			return secured, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	sessionID := "localmind-" + randomToken()[:24]
	localHello, err := session.CreateHello(c.provider, c.device, sessionID, deviceID, peer.OutboundGrant.GrantID, time.Now().UTC())
	if err != nil {
		c.mu.Unlock()
		return nil, err
	}
	secured := &secureSession{peer: peer, ready: make(chan struct{})}
	c.sessions[sessionID] = secured
	c.peerSessions[deviceID] = sessionID
	c.pendingHellos[sessionID] = localHello
	c.mu.Unlock()

	if err := c.sendFrame(ctx, deviceID, session.TypeHello, localHello.Hello); err != nil {
		c.dropSession(deviceID, sessionID, secured)
		return nil, err
	}
	select {
	case <-secured.ready:
		return secured, nil
	case <-ctx.Done():
		c.dropSession(deviceID, sessionID, secured)
		return nil, ctx.Err()
	}
}

func (c *Controller) dropSession(deviceID, sessionID string, expected *secureSession) {
	c.mu.Lock()
	if c.sessions[sessionID] == expected {
		delete(c.sessions, sessionID)
		delete(c.pendingHellos, sessionID)
		if c.peerSessions[deviceID] == sessionID {
			delete(c.peerSessions, deviceID)
		}
	}
	c.mu.Unlock()
}

func (c *Controller) invalidateDeviceSession(deviceID string) {
	c.mu.Lock()
	sessionID := c.peerSessions[deviceID]
	if sessionID != "" {
		delete(c.sessions, sessionID)
		delete(c.pendingHellos, sessionID)
		delete(c.peerSessions, deviceID)
	}
	c.mu.Unlock()
}

func (c *Controller) sendFrame(ctx context.Context, peerDeviceID, payloadType string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.relay.submit(ctx, relayFrame{
		Type: wireFrameType, DomainID: c.cfg.DomainID, MessageID: "frame-" + randomToken()[:24],
		SenderDeviceID: c.device.Identity.DeviceID, RecipientDeviceID: peerDeviceID,
		PayloadType: payloadType, Route: envelope.Route{RelayID: c.cfg.RelayID, TTLSeconds: 300, Priority: 5}, Payload: raw,
	})
}

func (c *Controller) sendAgentRequest(ctx context.Context, secured *secureSession, request AgentRequest) (AgentResponse, error) {
	responseChannel := make(chan AgentResponse, 1)
	c.mu.Lock()
	if _, exists := c.waiters[request.RequestID]; exists {
		c.mu.Unlock()
		return AgentResponse{}, errors.New("duplicate in-flight request")
	}
	c.waiters[request.RequestID] = agentWaiter{
		deviceID: secured.peer.Identity.DeviceID,
		response: responseChannel,
	}
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.waiters, request.RequestID)
		c.mu.Unlock()
	}()
	if err := c.sendSecure(ctx, secured, payload.TypeTaskInvoke, request); err != nil {
		return AgentResponse{}, err
	}
	select {
	case response := <-responseChannel:
		return response, nil
	case <-ctx.Done():
		return AgentResponse{}, ctx.Err()
	}
}

func (c *Controller) sendSecure(ctx context.Context, secured *secureSession, payloadType string, value any) error {
	plaintext, err := json.Marshal(value)
	if err != nil {
		return err
	}
	secured.mu.Lock()
	secureEnvelope, err := envelope.Encrypt(c.provider, secured.state, "message-"+randomToken()[:24], payloadType, envelope.Route{
		RelayID: c.cfg.RelayID, TTLSeconds: 300, Priority: 5,
	}, plaintext)
	secured.mu.Unlock()
	if err != nil {
		return err
	}
	return c.relay.submit(ctx, secureEnvelope)
}

func (c *Controller) handleRelayMessage(ctx context.Context, raw json.RawMessage) error {
	var metadata struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return err
	}
	switch metadata.Type {
	case wireFrameType:
		var frame relayFrame
		if err := json.Unmarshal(raw, &frame); err != nil {
			return err
		}
		return c.handleFrame(ctx, frame)
	case envelope.TypeSecureEnvelope:
		var secureEnvelope envelope.SecureEnvelope
		if err := json.Unmarshal(raw, &secureEnvelope); err != nil {
			return err
		}
		return c.handleSecureEnvelope(secureEnvelope)
	default:
		return fmt.Errorf("unsupported Relay envelope type %q", metadata.Type)
	}
}

func (c *Controller) handleFrame(ctx context.Context, frame relayFrame) error {
	if frame.DomainID != c.cfg.DomainID || frame.RecipientDeviceID != c.device.Identity.DeviceID || frame.Route.RelayID != c.cfg.RelayID {
		return errors.New("invalid ISCP frame binding")
	}
	c.mu.RLock()
	peer, ok := c.peers[frame.SenderDeviceID]
	c.mu.RUnlock()
	if !ok {
		return errors.New("ISCP frame sender is not enrolled")
	}
	switch frame.PayloadType {
	case session.TypeHello:
		var remote session.Hello
		if err := json.Unmarshal(frame.Payload, &remote); err != nil {
			return err
		}
		return c.acceptHello(ctx, peer, remote)
	case session.TypeReady:
		var ready session.Ready
		if err := json.Unmarshal(frame.Payload, &ready); err != nil {
			return err
		}
		return c.acceptReady(peer, ready)
	default:
		return errors.New("unsupported ISCP session frame")
	}
}

func (c *Controller) acceptHello(ctx context.Context, peer PeerAuthorization, remote session.Hello) error {
	if remote.DeviceID != peer.Identity.DeviceID || remote.PeerDeviceID != c.device.Identity.DeviceID || remote.DomainID != c.cfg.DomainID || remote.GrantID != peer.InboundGrant.GrantID {
		return errors.New("invalid Session Hello binding")
	}
	now := time.Now().UTC()
	remoteThumbprint, _ := identity.Thumbprint(peer.Identity)
	if err := trust.VerifyGrant(c.provider, peer.InboundGrant, c.trust.Identity, trust.VerifyOptions{
		Audience: c.device.Identity.DeviceID, SubjectDeviceID: peer.Identity.DeviceID,
		ConfirmationThumbprint: remoteThumbprint, Permission: permission, RelayID: c.cfg.RelayID, Now: now,
	}); err != nil {
		return fmt.Errorf("verify inbound Trust Grant: %w", err)
	}
	localThumbprint, _ := identity.Thumbprint(c.device.Identity)
	if err := trust.VerifyGrant(c.provider, peer.OutboundGrant, c.trust.Identity, trust.VerifyOptions{
		Audience: peer.Identity.DeviceID, SubjectDeviceID: c.device.Identity.DeviceID,
		ConfirmationThumbprint: localThumbprint, Permission: permission, RelayID: c.cfg.RelayID, Now: now,
	}); err != nil {
		return fmt.Errorf("verify outbound Trust Grant: %w", err)
	}
	if err := session.VerifyHello(c.provider, remote, peer.Identity); err != nil {
		return err
	}
	c.mu.RLock()
	localHello, ok := c.pendingHellos[remote.SessionID]
	secured := c.sessions[remote.SessionID]
	c.mu.RUnlock()
	if !ok || secured == nil || secured.peer.Identity.DeviceID != peer.Identity.DeviceID {
		return errors.New("Session Hello has no matching LocalMind initiation")
	}
	state, err := session.Establish(c.provider, localHello, remote, c.device.Identity, peer.Identity)
	if err != nil {
		return err
	}
	ready, err := state.CreateReady(c.provider, c.device)
	if err != nil {
		return err
	}
	secured.mu.Lock()
	secured.state = state
	secured.mu.Unlock()
	return c.sendFrame(ctx, peer.Identity.DeviceID, session.TypeReady, ready)
}

func (c *Controller) acceptReady(peer PeerAuthorization, ready session.Ready) error {
	c.mu.RLock()
	secured := c.sessions[ready.SessionID]
	c.mu.RUnlock()
	if secured == nil || secured.peer.Identity.DeviceID != peer.Identity.DeviceID {
		return errors.New("Session Ready has no matching session")
	}
	secured.mu.Lock()
	if secured.state == nil {
		secured.mu.Unlock()
		return errors.New("Session Ready arrived before Hello")
	}
	err := secured.state.VerifyReady(c.provider, ready, peer.Identity)
	secured.mu.Unlock()
	if err != nil {
		return err
	}
	secured.readyOnce.Do(func() { close(secured.ready) })
	c.mu.Lock()
	c.lastSeen[peer.Identity.DeviceID] = time.Now().UTC()
	delete(c.pendingHellos, ready.SessionID)
	c.mu.Unlock()
	return nil
}

func (c *Controller) handleSecureEnvelope(value envelope.SecureEnvelope) error {
	c.mu.RLock()
	secured := c.sessions[value.SessionID]
	c.mu.RUnlock()
	if secured == nil {
		return errors.New("SecureEnvelope session is unknown")
	}
	secured.mu.Lock()
	plaintext, err := envelope.Decrypt(c.provider, secured.state, value)
	secured.mu.Unlock()
	if err != nil {
		return err
	}
	if value.PayloadType != payload.TypeTaskResult {
		return errors.New("SecureEnvelope is not a task result")
	}
	var response AgentResponse
	if err := json.Unmarshal(plaintext, &response); err != nil {
		return err
	}
	if response.ProtocolVersion != protocolVersion || response.Type != typeResponse || response.EndpointID != c.device.Identity.DeviceID {
		return errors.New("invalid SparkClaw response binding")
	}
	c.mu.Lock()
	c.lastSeen[secured.peer.Identity.DeviceID] = time.Now().UTC()
	c.mu.Unlock()
	c.deliverAgentResponse(secured.peer.Identity.DeviceID, response)
	return nil
}

func (c *Controller) deliverAgentResponse(peerDeviceID string, response AgentResponse) {
	c.mu.RLock()
	waiter, waiting := c.waiters[response.RequestID]
	c.mu.RUnlock()
	if waiting && waiter.deviceID == peerDeviceID {
		select {
		case waiter.response <- response:
		default:
		}
	}
}
