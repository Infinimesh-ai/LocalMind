#!/bin/sh
# Restarts the LocalMind server container after Docker marks it unhealthy.
#
# Docker's restart policy only acts when the process exits. A process stuck
# after a fatal error keeps the container running, so run this on the Docker
# host from cron or a systemd timer, for example every minute:
#
#   * * * * * /opt/localmind/.docker/selfhost/localmind-watchdog.sh >> /var/log/localmind-watchdog.log 2>&1
#
# Environment:
#   LOCALMIND_WATCHDOG_CONTAINER             container name (localmind_affine_server)
#   LOCALMIND_WATCHDOG_COOLDOWN_SECONDS      minimum time between restarts (900)
#   LOCALMIND_WATCHDOG_MAX_RESTARTS_PER_DAY  stop restarting after this many (6)
#   LOCALMIND_WATCHDOG_STATE_DIR             restart history and saved logs
#                                            (/var/lib/localmind-watchdog)
set -eu

container=${LOCALMIND_WATCHDOG_CONTAINER:-localmind_affine_server}
cooldown=${LOCALMIND_WATCHDOG_COOLDOWN_SECONDS:-900}
max_per_day=${LOCALMIND_WATCHDOG_MAX_RESTARTS_PER_DAY:-6}
state_dir=${LOCALMIND_WATCHDOG_STATE_DIR:-/var/lib/localmind-watchdog}

status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo missing)
[ "$status" = unhealthy ] || exit 0

now=$(date +%s)
mkdir -p "$state_dir"
chmod 0700 "$state_dir"
history="$state_dir/$container.restarts"
touch "$history"

last=$(tail -n 1 "$history")
if [ -n "$last" ] && [ $((now - last)) -lt "$cooldown" ]; then
  echo "$(date -u +%FT%TZ) $container unhealthy; within ${cooldown}s cooldown"
  exit 0
fi
recent=$(awk -v since=$((now - 86400)) '$1 >= since' "$history" | wc -l | tr -d ' ')
if [ "$recent" -ge "$max_per_day" ]; then
  echo "$(date -u +%FT%TZ) $container unhealthy; $recent restarts in 24h, manual action required" >&2
  exit 1
fi

# Keep the failed process's recent output before replacing it.
docker logs --timestamps --tail 4000 "$container" > "$state_dir/$container.$now.log" 2>&1 || true
chmod 0600 "$state_dir/$container.$now.log"
echo "$now" >> "$history"
echo "$(date -u +%FT%TZ) restarting $container (health=$status)"
docker restart --timeout 30 "$container"
