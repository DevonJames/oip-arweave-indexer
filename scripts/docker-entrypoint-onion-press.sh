#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# ONION PRESS SERVICE - Docker Entrypoint
# ═══════════════════════════════════════════════════════════════════════════════

set -e

echo "🧅 Starting Onion Press Service..."

# Wait for OIP daemon to be ready
echo "⏳ Waiting for OIP daemon service..."
for i in {1..30}; do
    if curl -sf "${OIP_DAEMON_URL:-http://oip-daemon-service:3005}/health" > /dev/null 2>&1; then
        echo "✅ OIP daemon is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "⚠️  OIP daemon not ready after 30 attempts, starting anyway..."
    fi
    sleep 2
done

# Check TOR daemon status (optional)
if [ -n "$TOR_PROXY_HOST" ]; then
    echo "⏳ Checking TOR daemon..."
    if nc -z "${TOR_PROXY_HOST:-tor-daemon}" "${TOR_PROXY_PORT:-9050}" 2>/dev/null; then
        echo "✅ TOR daemon is reachable"
    else
        echo "⚠️  TOR daemon not reachable at ${TOR_PROXY_HOST:-tor-daemon}:${TOR_PROXY_PORT:-9050}"
    fi
fi

# Execute the main command
exec "$@"

