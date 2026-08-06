package controller

import (
	"strings"
	"testing"
)

func TestConfigFromEnvRequiresPublicRelayAndStrongToken(t *testing.T) {
	t.Setenv("ISCP_DATABASE_URL", "postgresql://database/localmind")
	t.Setenv("ISCP_RELAY_PUBLIC_BASE_URL", "https://localmind.example/iscp")
	t.Setenv("ISCP_RELAY_PUBLIC_WS_URL", "wss://localmind.example/iscp/v2/relay/connect")
	t.Setenv("ISCP_CONTROLLER_TOKEN", "short")
	if _, err := ConfigFromEnv(); err == nil {
		t.Fatal("short controller token was accepted")
	}

	t.Setenv("ISCP_CONTROLLER_TOKEN", strings.Repeat("s", 32))
	cfg, err := ConfigFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DomainID != "localmind" || cfg.RelayID != "localmind-relay" {
		t.Fatalf("unexpected defaults: %#v", cfg)
	}

	t.Setenv("ISCP_RELAY_PUBLIC_BASE_URL", "http://localmind.example/iscp")
	if _, err := ConfigFromEnv(); err == nil {
		t.Fatal("plaintext public Relay URL was accepted")
	}
}
