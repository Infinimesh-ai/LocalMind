# Dev containers

## Develop with domain

> MacOs only, OrbStack only

### 1. Generate and install Root CA

```bash
# the root ca file will be located at `./.docker/dev/certs/ca`
yarn affine cert --install
```

### 2. Generate domain certs

```bash
# certificates will be located at `./.docker/dev/certs/${domain}`
yarn affine cert --domain affine.localhost
```

### 3. Enable nginx service in compose.yml

## Source watching through container mounts

When the host filesystem does not forward change events into the container,
set `LOCALMIND_DEV_POLL_INTERVAL_MS=1000` for Web/Admin development servers.
This enables Rspack polling while preserving the existing automatic page reload.
The default polling exclusions also cover `.docker` and `backups`, so local
runtime data and backup updates do not trigger application recompilation.
Without this variable, the default filesystem watcher is unchanged.
For the backend, enable `legacyWatch` in the local nodemon configuration.
