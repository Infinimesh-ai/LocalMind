package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	iscpcrypto "github.com/Infinimesh-ai/ISCP/pkg/iscp/crypto"
	"github.com/Infinimesh-ai/ISCP/pkg/iscp/identity"
	"github.com/Infinimesh-ai/ISCP/pkg/iscp/session"
)

func TestAuthorized(t *testing.T) {
	controller := &Controller{cfg: Config{ControllerToken: strings.Repeat("a", 32)}}
	handler := controller.authorized(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodPost, "/v1/deliveries", nil)
	response := httptest.NewRecorder()
	handler(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("request without token returned %d", response.Code)
	}

	request = httptest.NewRequest(http.MethodPost, "/v1/deliveries", nil)
	request.Header.Set("Authorization", "Bearer "+strings.Repeat("a", 32))
	response = httptest.NewRecorder()
	handler(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("authorized request returned %d", response.Code)
	}
}

func TestValidateEnrollmentInput(t *testing.T) {
	device, err := identity.NewDevice(iscpcrypto.NewProvider(), "localmind", "sparkclaw-test", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	valid := EnrollInput{
		EndpointID: device.Identity.DeviceID,
		Request: EnrollmentRequest{
			Type: enrollmentRequestType, ProductKind: "sparkclaw", RuntimeKind: "sparkclaw",
			Identity: device.Identity,
		},
	}
	if err := validateEnrollmentInput(valid, "localmind"); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}

	wrongEndpoint := valid
	wrongEndpoint.EndpointID = "another-device"
	if err := validateEnrollmentInput(wrongEndpoint, "localmind"); err == nil {
		t.Fatal("endpoint mismatch was accepted")
	}

	wrongKey := valid
	wrongKey.Request.Identity.PublicKey.KID = "attacker-controlled-kid"
	if err := validateEnrollmentInput(wrongKey, "localmind"); err == nil {
		t.Fatal("public key thumbprint mismatch was accepted")
	}
}

func TestRelayCredentialSnapshot(t *testing.T) {
	client := &relayClient{}
	expiresAt := time.Now().UTC().Add(time.Hour)
	client.setCredential(RelayCredential{Token: "rotated", ExpiresAt: expiresAt})
	snapshot := client.credentialSnapshot()
	if snapshot.Token != "rotated" || !snapshot.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("unexpected credential snapshot: %#v", snapshot)
	}
}

func TestInvalidateDeviceSession(t *testing.T) {
	secured := &secureSession{ready: make(chan struct{})}
	controller := &Controller{
		sessions:      map[string]*secureSession{"session-1": secured},
		peerSessions:  map[string]string{"device-1": "session-1"},
		pendingHellos: map[string]session.LocalHello{"session-1": {}},
	}
	controller.invalidateDeviceSession("device-1")
	if len(controller.sessions) != 0 || len(controller.peerSessions) != 0 || len(controller.pendingHellos) != 0 {
		t.Fatal("invalidated session state was retained")
	}
}

func TestDeviceDeliveryLockSerializesSameDevice(t *testing.T) {
	controller := &Controller{deliveryLocks: map[string]*sync.Mutex{}}
	unlock := controller.lockDeviceDelivery("device-1")
	acquired := make(chan struct{})
	go func() {
		defer controller.lockDeviceDelivery("device-1")()
		close(acquired)
	}()
	select {
	case <-acquired:
		t.Fatal("same-device delivery lock was acquired concurrently")
	case <-time.After(20 * time.Millisecond):
	}
	unlock()
	select {
	case <-acquired:
	case <-time.After(time.Second):
		t.Fatal("same-device delivery lock was not released")
	}
}

func TestAgentWaiterIsBoundToPeerDevice(t *testing.T) {
	waiter := agentWaiter{deviceID: "device-1", response: make(chan AgentResponse, 1)}
	controller := &Controller{
		waiters: map[string]agentWaiter{"request-1": waiter},
	}
	response := AgentResponse{RequestID: "request-1"}
	controller.deliverAgentResponse("device-2", response)
	select {
	case <-waiter.response:
		t.Fatal("response from a different peer device reached the waiter")
	default:
	}
	controller.deliverAgentResponse("device-1", response)
	select {
	case received := <-waiter.response:
		if received.RequestID != response.RequestID {
			t.Fatal("waiter received the wrong response")
		}
	default:
		t.Fatal("response from the bound peer device did not reach the waiter")
	}
}
