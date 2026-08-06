package controller

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	iscpcrypto "github.com/Infinimesh-ai/ISCP/pkg/iscp/crypto"
	"github.com/Infinimesh-ai/ISCP/pkg/iscp/identity"
)

type storedDevice struct {
	Identity   identity.DeviceIdentity `json:"identity"`
	PrivateKey string                  `json:"private_key"`
}

func loadOrCreateDevice(directory, filename, domainID, deviceID string, metadata map[string]string) (identity.Device, error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return identity.Device{}, fmt.Errorf("create identity directory: %w", err)
	}
	path := filepath.Join(directory, filename)
	if raw, err := os.ReadFile(path); err == nil {
		var stored storedDevice
		if err := json.Unmarshal(raw, &stored); err != nil {
			return identity.Device{}, fmt.Errorf("decode %s: %w", filename, err)
		}
		keyBytes, err := base64.RawURLEncoding.DecodeString(stored.PrivateKey)
		if err != nil {
			return identity.Device{}, fmt.Errorf("decode %s private key: %w", filename, err)
		}
		privateKey, err := iscpcrypto.Ed25519PrivateKeyFromBytes(keyBytes)
		if err != nil {
			return identity.Device{}, fmt.Errorf("load %s private key: %w", filename, err)
		}
		return identity.Device{Identity: stored.Identity, Private: privateKey}, nil
	} else if !os.IsNotExist(err) {
		return identity.Device{}, fmt.Errorf("read %s: %w", filename, err)
	}

	device, err := identity.NewDevice(iscpcrypto.NewProvider(), domainID, deviceID, time.Now().UTC())
	if err != nil {
		return identity.Device{}, err
	}
	device.Identity.Metadata = metadata
	stored := storedDevice{
		Identity:   device.Identity,
		PrivateKey: base64.RawURLEncoding.EncodeToString(device.Private.BytesForDevStore()),
	}
	raw, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return identity.Device{}, err
	}
	temp, err := os.CreateTemp(directory, ".identity-*")
	if err != nil {
		return identity.Device{}, err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return identity.Device{}, err
	}
	if _, err := temp.Write(append(raw, '\n')); err != nil {
		_ = temp.Close()
		return identity.Device{}, err
	}
	if err := temp.Close(); err != nil {
		return identity.Device{}, err
	}
	if err := os.Rename(tempPath, path); err != nil {
		return identity.Device{}, err
	}
	return device, nil
}
