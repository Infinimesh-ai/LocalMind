package controller

import (
	"encoding/json"
	"time"

	"github.com/Infinimesh-ai/ISCP/pkg/iscp/envelope"
	"github.com/Infinimesh-ai/ISCP/pkg/iscp/identity"
	"github.com/Infinimesh-ai/ISCP/pkg/iscp/trust"
)

const (
	enrollmentRequestType = "sparkclaw.bridge.enrollment_request.v1"
	enrollmentBundleType  = "sparkclaw.bridge.enrollment.v1"
	wireFrameType         = "sparkclaw.iscp.relay_frame.v1"
	protocolVersion       = "agent.capability.v1"
	bridgeVersion         = "sparkclaw.bridge.v1"
	permission            = "agent.bridge"
	typeSessionCreate     = "agent.session.create.v1"
	typeMessageSend       = "agent.message.send.v1"
	typeResponse          = "agent.response.v1"
)

type EnrollmentRequest struct {
	Type             string                  `json:"type"`
	DeviceType       string                  `json:"device_type"`
	DeviceRole       string                  `json:"device_role"`
	ProductKind      string                  `json:"product_kind"`
	RuntimeKind      string                  `json:"runtime_kind"`
	HardwareClass    string                  `json:"hardware_class"`
	ProtocolVersions []string                `json:"protocol_versions"`
	Identity         identity.DeviceIdentity `json:"identity"`
	CreatedAt        time.Time               `json:"created_at"`
}

type RelayCredential struct {
	DomainID  string    `json:"domain_id"`
	DeviceID  string    `json:"device_id"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

type PeerAuthorization struct {
	Identity                identity.DeviceIdentity `json:"identity"`
	InboundGrant            trust.Grant             `json:"inbound_grant"`
	OutboundGrant           trust.Grant             `json:"outbound_grant"`
	InboundRevocationEpoch  uint64                  `json:"inbound_revocation_epoch"`
	OutboundRevocationEpoch uint64                  `json:"outbound_revocation_epoch"`
}

type EnrollmentBundle struct {
	Type              string                  `json:"type"`
	DomainID          string                  `json:"domain_id"`
	DeviceID          string                  `json:"device_id"`
	RelayID           string                  `json:"relay_id"`
	RelayBaseURL      string                  `json:"relay_base_url"`
	RelayWebSocketURL string                  `json:"relay_websocket_url"`
	TrustRootIdentity identity.DeviceIdentity `json:"trust_root_identity"`
	Access            RelayCredential         `json:"access"`
	Refresh           RelayCredential         `json:"refresh"`
	Peers             []PeerAuthorization     `json:"peers"`
	IssuedAt          time.Time               `json:"issued_at"`
	ExpiresAt         time.Time               `json:"expires_at"`
}

type relayFrame struct {
	Type              string          `json:"type"`
	DomainID          string          `json:"domain_id"`
	MessageID         string          `json:"message_id"`
	SenderDeviceID    string          `json:"sender_device_id"`
	RecipientDeviceID string          `json:"recipient_device_id"`
	PayloadType       string          `json:"payload_type"`
	Route             envelope.Route  `json:"route"`
	Payload           json.RawMessage `json:"payload"`
}

type AgentRequest struct {
	ProtocolVersion string          `json:"protocol_version"`
	Type            string          `json:"type"`
	RequestID       string          `json:"request_id"`
	EndpointID      string          `json:"endpoint_id"`
	SessionID       string          `json:"session_id,omitempty"`
	IdempotencyKey  string          `json:"idempotency_key,omitempty"`
	IssuedAt        time.Time       `json:"issued_at"`
	ExpiresAt       time.Time       `json:"expires_at"`
	Payload         json.RawMessage `json:"payload,omitempty"`
}

type AgentResponse struct {
	ProtocolVersion string          `json:"protocol_version"`
	Type            string          `json:"type"`
	RequestID       string          `json:"request_id"`
	EndpointID      string          `json:"endpoint_id"`
	SessionID       string          `json:"session_id,omitempty"`
	Status          string          `json:"status"`
	Operation       *AgentOperation `json:"operation,omitempty"`
	Result          json.RawMessage `json:"result,omitempty"`
	Error           *AgentError     `json:"error,omitempty"`
	IssuedAt        time.Time       `json:"issued_at"`
}

type AgentOperation struct {
	ID        string `json:"id"`
	SessionID string `json:"session_id"`
	State     string `json:"state"`
}

type AgentError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type EnrollInput struct {
	EndpointID string            `json:"endpoint_id"`
	Request    EnrollmentRequest `json:"request"`
}

type DeliveryInput struct {
	DeliveryID     string `json:"delivery_id"`
	DeviceID       string `json:"device_id"`
	AgentSessionID string `json:"session_id,omitempty"`
	Content        string `json:"content"`
}

type DeliveryResult struct {
	Accepted       bool   `json:"accepted"`
	AgentSessionID string `json:"session_id"`
	OperationID    string `json:"operation_id,omitempty"`
}
