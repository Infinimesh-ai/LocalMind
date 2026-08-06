package controller

import (
	"errors"
	"os"
	"strings"
	"time"
)

type Config struct {
	Addr                   string
	DatabaseURL            string
	DomainID               string
	RelayID                string
	RelayInternalBaseURL   string
	RelayInternalWebSocket string
	RelayPublicBaseURL     string
	RelayPublicWebSocket   string
	ControllerToken        string
	StateDirectory         string
	RequestTimeout         time.Duration
}

func ConfigFromEnv() (Config, error) {
	cfg := Config{
		Addr:                   env("ISCP_CONTROLLER_ADDR", ":8091"),
		DatabaseURL:            strings.TrimSpace(os.Getenv("ISCP_DATABASE_URL")),
		DomainID:               env("ISCP_DOMAIN_ID", "localmind"),
		RelayID:                env("ISCP_RELAY_ID", "localmind-relay"),
		RelayInternalBaseURL:   env("ISCP_RELAY_INTERNAL_BASE_URL", "http://iscp-relay:8080"),
		RelayInternalWebSocket: env("ISCP_RELAY_INTERNAL_WS_URL", "ws://iscp-relay:8080/v2/relay/connect"),
		RelayPublicBaseURL:     strings.TrimRight(strings.TrimSpace(os.Getenv("ISCP_RELAY_PUBLIC_BASE_URL")), "/"),
		RelayPublicWebSocket:   strings.TrimSpace(os.Getenv("ISCP_RELAY_PUBLIC_WS_URL")),
		ControllerToken:        strings.TrimSpace(os.Getenv("ISCP_CONTROLLER_TOKEN")),
		StateDirectory:         env("ISCP_STATE_DIR", "/var/lib/localmind-iscp"),
		RequestTimeout:         20 * time.Second,
	}
	if cfg.DatabaseURL == "" || cfg.ControllerToken == "" || cfg.RelayPublicBaseURL == "" || cfg.RelayPublicWebSocket == "" {
		return Config{}, errors.New("ISCP_DATABASE_URL, ISCP_CONTROLLER_TOKEN, ISCP_RELAY_PUBLIC_BASE_URL and ISCP_RELAY_PUBLIC_WS_URL are required")
	}
	if len(cfg.ControllerToken) < 32 {
		return Config{}, errors.New("ISCP_CONTROLLER_TOKEN must contain at least 32 characters")
	}
	if !strings.HasPrefix(cfg.RelayPublicBaseURL, "https://") || !strings.HasPrefix(cfg.RelayPublicWebSocket, "wss://") {
		return Config{}, errors.New("public Relay URLs must use HTTPS and WSS")
	}
	return cfg, nil
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
