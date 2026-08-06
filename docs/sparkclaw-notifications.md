# Proactive SparkClaw notifications

LocalMind can deliver document and comment mentions to a user's SparkClaw through an ISCP Relay. The SparkClaw Bridge opens an outbound WebSocket, so the SparkClaw host needs neither a public IP nor an inbound port.

## User flow

1. In LocalMind, open Account settings > Integrations and click Connect for SparkClaw.
2. On the SparkClaw host, enter the SparkClaw source tree and run the single command shown by LocalMind.
3. Return to LocalMind and click Done.

The installer builds the existing `iscp-bridge`, creates the device key locally, consumes a one-time enrollment, and installs a launchd or systemd user service with a background-process fallback. The default unauthenticated SparkClaw Gateway needs no extra configuration. If the Gateway has an API token, set `SPARKCLAW_API_TOKEN` before running the command.

Users can disable delivery under Settings > Notifications > SparkClaw notifications. LocalMind sends only the notification kind and a deep link, never the document title, body, or comment text.

## Server deployment

Set the following variables for the optional `iscp` Compose profile:

```dotenv
ISCP_ENABLED=true
ISCP_CONTROLLER_TOKEN=<at least 32 random characters>
ISCP_RELAY_PUBLIC_BASE_URL=https://localmind.example.com/iscp
ISCP_RELAY_PUBLIC_WS_URL=wss://localmind.example.com/iscp/v2/relay/connect
```

Start it with:

```sh
docker compose -f .docker/selfhost/compose.localmind.yml --profile iscp up -d
```

Reverse proxy `/iscp/v2/relay/connect` as WebSocket traffic to local port `${ISCP_RELAY_PORT:-8080}`. Proxy `/iscp/v2/relay/envelopes` and `/iscp/v2/relay/devices/refresh-access` to local port `${ISCP_CONTROLLER_PORT:-8091}`. Strip the `/iscp` prefix. The public endpoints require certificate-valid HTTPS/WSS. Never expose the internal Controller token to a browser or SparkClaw.

Persist and back up both the Controller state volume, which contains the LocalMind Trust Root and peer key, and PostgreSQL, which contains Relay credentials and queued messages.

## Current compatibility boundary

SparkClaw does not yet expose a passive notification capability. LocalMind currently falls back to `agent.message.send.v1` in a dedicated Agent session. That reaches the SparkClaw Runtime, but the current WebChat cannot guarantee a global badge or toast on every page. LocalMind instructs the notification session not to call tools or modify data; native global alerts require a passive protocol and UI support in SparkClaw.
