export const sparkClawInstallScript = String.raw`#!/bin/sh
set -eu

SERVER=""
PAIRING_TOKEN=""
SPARKCLAW_DIR="\${SPARKCLAW_DIR:-}"
GATEWAY_URL="\${SPARKCLAW_GATEWAY_URL:-http://127.0.0.1:18789}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server) SERVER="$2"; shift 2 ;;
    --pairing-token) PAIRING_TOKEN="$2"; shift 2 ;;
    --sparkclaw-dir) SPARKCLAW_DIR="$2"; shift 2 ;;
    --gateway-url) GATEWAY_URL="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$SERVER" ] || [ -z "$PAIRING_TOKEN" ]; then
  echo "--server and --pairing-token are required" >&2
  exit 2
fi
SERVER="\${SERVER%/}"
case "$SERVER" in
  http://*|https://*) ;;
  *) echo "--server must be an HTTP or HTTPS URL" >&2; exit 2 ;;
esac
case "$GATEWAY_URL" in
  http://*|https://*) ;;
  *) echo "--gateway-url must be an HTTP or HTTPS URL" >&2; exit 2 ;;
esac
case "$PAIRING_TOKEN" in
  ''|*[!A-Za-z0-9_-]*) echo "--pairing-token is invalid" >&2; exit 2 ;;
esac

if command -v python3 >/dev/null 2>&1; then
  JSON_TOOL=python3
elif command -v jq >/dev/null 2>&1; then
  JSON_TOOL=jq
else
  echo "python3 or jq is required to parse signed enrollment data" >&2
  exit 1
fi

json_get() {
  if [ "$JSON_TOOL" = python3 ]; then
    python3 - "$1" "$2" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding="utf-8"))
for part in sys.argv[2].split("."):
    value = value[part]
print(value)
PY
  else
    jq -r ".$2" "$1"
  fi
}

find_sparkclaw() {
  for candidate in "$SPARKCLAW_DIR" "$PWD" "$HOME/SparkClaw" "$HOME/sparkclaw" /opt/SparkClaw /opt/sparkclaw; do
    if [ -n "$candidate" ] && [ -f "$candidate/services/gateway/cmd/iscp-bridge/main.go" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  found="$(find "$HOME" -maxdepth 8 -type f -path '*/services/gateway/cmd/iscp-bridge/main.go' -print -quit 2>/dev/null || true)"
  if [ -n "$found" ]; then
    repo="$found"
    for _ in 1 2 3 4 5; do repo="$(dirname "$repo")"; done
    printf '%s\n' "$repo"
    return 0
  fi
  return 1
}

SPARKCLAW_DIR="$(find_sparkclaw || true)"
if [ -z "$SPARKCLAW_DIR" ]; then
  echo "SparkClaw source tree was not found. Re-run with --sparkclaw-dir /path/to/SparkClaw" >&2
  exit 1
fi
if ! command -v go >/dev/null 2>&1; then
  echo "Go is required to build SparkClaw's ISCP Bridge" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
STATE_ROOT=""
STATE_CREATED=0
INSTALL_COMPLETE=0
cleanup() {
  rm -rf "$TMP_DIR"
  if [ "$STATE_CREATED" = 1 ] && [ "$INSTALL_COMPLETE" != 1 ] && [ -n "$STATE_ROOT" ]; then
    rm -rf "$STATE_ROOT"
  fi
}
trap cleanup EXIT HUP INT TERM
curl -fsS "$SERVER/api/iscp/pairings/$PAIRING_TOKEN/bootstrap" > "$TMP_DIR/bootstrap.json"
DOMAIN_ID="$(json_get "$TMP_DIR/bootstrap.json" domain_id)"
DEVICE_ID="$(json_get "$TMP_DIR/bootstrap.json" device_id)"
case "$DEVICE_ID" in
  ''|*[!A-Za-z0-9._-]*) echo "LocalMind returned an invalid SparkClaw device ID" >&2; exit 1 ;;
esac

STATE_ROOT="\${XDG_CONFIG_HOME:-$HOME/.config}/sparkclaw/localmind-$DEVICE_ID"
IDENTITY_DIR="$STATE_ROOT/identity"
BIN_DIR="$STATE_ROOT/bin"
if [ -e "$STATE_ROOT" ]; then
  echo "SparkClaw pairing state already exists at $STATE_ROOT." >&2
  echo "Create a new pairing in LocalMind, or remove that stale directory and retry." >&2
  exit 1
fi
mkdir -p "$IDENTITY_DIR" "$BIN_DIR"
STATE_CREATED=1
chmod 700 "$STATE_ROOT" "$IDENTITY_DIR" "$BIN_DIR"

echo "Building SparkClaw ISCP Bridge..."
(cd "$SPARKCLAW_DIR/services/gateway" && go build -o "$BIN_DIR/iscp-bridge" ./cmd/iscp-bridge)
chmod 700 "$BIN_DIR/iscp-bridge"

"$BIN_DIR/iscp-bridge" enroll \
  -identity-dir "$IDENTITY_DIR" \
  -domain "$DOMAIN_ID" \
  -device "$DEVICE_ID" \
  -hardware "$(uname -m)" \
  -key-backend file \
  -output "$TMP_DIR/enrollment-request.json"

if [ "$JSON_TOOL" = python3 ]; then
  python3 - "$TMP_DIR/enrollment-request.json" "$TMP_DIR/enroll-body.json" <<'PY'
import json, sys
request = json.load(open(sys.argv[1], encoding="utf-8"))
json.dump({"request": request}, open(sys.argv[2], "w", encoding="utf-8"), separators=(",", ":"))
PY
else
  jq -c '{request: .}' "$TMP_DIR/enrollment-request.json" > "$TMP_DIR/enroll-body.json"
fi

curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  --data-binary "@$TMP_DIR/enroll-body.json" \
  "$SERVER/api/iscp/pairings/$PAIRING_TOKEN/enroll" > "$STATE_ROOT/enrollment.json"
chmod 600 "$STATE_ROOT/enrollment.json"

PAIRING_STATUS="$(curl -sS -o "$TMP_DIR/gateway-pairing.json" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$GATEWAY_URL/api/pairing/start" || true)"
if [ "$PAIRING_STATUS" = 201 ]; then
  PAIRING_ID="$(json_get "$TMP_DIR/gateway-pairing.json" pairing_id)"
  PAIRING_CODE="$(json_get "$TMP_DIR/gateway-pairing.json" code)"
  if [ "$JSON_TOOL" = python3 ]; then
    python3 - "$PAIRING_ID" "$PAIRING_CODE" "$TMP_DIR/gateway-claim.json" <<'PY'
import json, sys
json.dump({"pairing_id": sys.argv[1], "code": sys.argv[2], "client_name": "LocalMind ISCP Bridge"}, open(sys.argv[3], "w", encoding="utf-8"))
PY
  else
    jq -nc --arg id "$PAIRING_ID" --arg code "$PAIRING_CODE" '{pairing_id:$id,code:$code,client_name:"LocalMind ISCP Bridge"}' > "$TMP_DIR/gateway-claim.json"
  fi
  curl -fsS -X POST -H 'Content-Type: application/json' --data-binary "@$TMP_DIR/gateway-claim.json" "$GATEWAY_URL/api/pairing/claim" > "$TMP_DIR/gateway-client.json"
  json_get "$TMP_DIR/gateway-client.json" token > "$STATE_ROOT/gateway.token"
elif [ -n "\${SPARKCLAW_API_TOKEN:-}" ]; then
  printf '%s\n' "$SPARKCLAW_API_TOKEN" > "$STATE_ROOT/gateway.token"
elif [ "$PAIRING_STATUS" = 400 ] && grep -q 'pairing is not required' "$TMP_DIR/gateway-pairing.json"; then
  # The current Gateway client requires a non-empty token file even when HTTP
  # authentication is disabled. The value is not treated as a credential.
  printf '%s\n' 'localmind-bridge-no-auth' > "$STATE_ROOT/gateway.token"
else
  echo "SparkClaw Gateway requires authentication, but automatic pairing was unavailable." >&2
  echo "Re-run with SPARKCLAW_API_TOKEN set to the Gateway API token." >&2
  exit 1
fi
chmod 600 "$STATE_ROOT/gateway.token"

if [ "$JSON_TOOL" = python3 ]; then
  python3 - "$STATE_ROOT" "$GATEWAY_URL" > "$STATE_ROOT/bridge.json" <<'PY'
import json, sys
root, gateway = sys.argv[1:]
json.dump({
  "profile": "local-lab",
  "identity_directory": root + "/identity",
  "identity_key_backend": "file",
  "identity_keyring_service": "SparkClaw ISCP Bridge",
  "enrollment_file": root + "/enrollment.json",
  "permission": "agent.bridge",
  "gateway": {"base_url": gateway, "token_file": root + "/gateway.token", "timeout_seconds": 30},
  "relay": {"reconnect_min_seconds": 1, "reconnect_max_seconds": 30, "request_timeout_seconds": 30, "event_poll_milliseconds": 500, "envelope_ttl_seconds": 300}
}, sys.stdout, indent=2)
PY
else
  jq -n --arg root "$STATE_ROOT" --arg gateway "$GATEWAY_URL" '{profile:"local-lab",identity_directory:($root+"/identity"),identity_key_backend:"file",identity_keyring_service:"SparkClaw ISCP Bridge",enrollment_file:($root+"/enrollment.json"),permission:"agent.bridge",gateway:{base_url:$gateway,token_file:($root+"/gateway.token"),timeout_seconds:30},relay:{reconnect_min_seconds:1,reconnect_max_seconds:30,request_timeout_seconds:30,event_poll_milliseconds:500,envelope_ttl_seconds:300}}' > "$STATE_ROOT/bridge.json"
fi
chmod 600 "$STATE_ROOT/bridge.json"

cat > "$STATE_ROOT/run.sh" <<EOF
#!/bin/sh
exec "$BIN_DIR/iscp-bridge" run -config "$STATE_ROOT/bridge.json"
EOF
chmod 700 "$STATE_ROOT/run.sh"

case "$(uname -s)" in
  Darwin)
    LABEL="com.localmind.sparkclaw.$DEVICE_ID"
    PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>$STATE_ROOT/run.sh</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$STATE_ROOT/bridge.log</string>
<key>StandardErrorPath</key><string>$STATE_ROOT/bridge.log</string>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    ;;
  Linux)
    if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
      UNIT_DIR="\${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
      mkdir -p "$UNIT_DIR"
      cat > "$UNIT_DIR/localmind-sparkclaw-$DEVICE_ID.service" <<EOF
[Unit]
Description=LocalMind SparkClaw ISCP Bridge
After=network-online.target

[Service]
ExecStart=$STATE_ROOT/run.sh
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
EOF
      systemctl --user daemon-reload
      systemctl --user enable --now "localmind-sparkclaw-$DEVICE_ID.service"
    else
      nohup "$STATE_ROOT/run.sh" >> "$STATE_ROOT/bridge.log" 2>&1 &
      printf '%s\n' "$!" > "$STATE_ROOT/bridge.pid"
    fi
    ;;
  *)
    nohup "$STATE_ROOT/run.sh" >> "$STATE_ROOT/bridge.log" 2>&1 &
    printf '%s\n' "$!" > "$STATE_ROOT/bridge.pid"
    ;;
esac

INSTALL_COMPLETE=1
echo "SparkClaw is connected to LocalMind. Device: $DEVICE_ID"
`.replaceAll('\\${', '${');
