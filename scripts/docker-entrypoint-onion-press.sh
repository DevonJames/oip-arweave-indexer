#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# ONION PRESS SERVICE - Docker Entrypoint
# ═══════════════════════════════════════════════════════════════════════════════
# Starts TOR daemon (for hidden service) then the Node.js application
# ═══════════════════════════════════════════════════════════════════════════════

set -e

echo "🧅 Starting Onion Press Service..."

# ─────────────────────────────────────────────────────────────────────────────
# Wait for OIP daemon
# ─────────────────────────────────────────────────────────────────────────────
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

# ─────────────────────────────────────────────────────────────────────────────
# Start TOR daemon
# ─────────────────────────────────────────────────────────────────────────────
echo "🔐 Starting TOR daemon..."

# Ensure TOR directories have correct ownership
chown -R tor:tor /var/lib/tor 2>/dev/null || true
chmod 700 /var/lib/tor/hidden_service 2>/dev/null || true

# Start TOR in background
tor -f /etc/tor/torrc &
TOR_PID=$!

# Wait for TOR to bootstrap
echo "⏳ Waiting for TOR to bootstrap..."
for i in {1..60}; do
    if nc -z 127.0.0.1 9050 2>/dev/null; then
        echo "✅ TOR SOCKS proxy is ready"
        break
    fi
    if [ $i -eq 60 ]; then
        echo "⚠️  TOR not ready after 60 seconds, continuing anyway..."
    fi
    sleep 1
done

# Wait a bit more for hidden service to initialize
sleep 3

# Check for .onion address
if [ -f /var/lib/tor/hidden_service/hostname ]; then
    ONION_ADDRESS=$(cat /var/lib/tor/hidden_service/hostname)
    echo "═══════════════════════════════════════════════════════════════"
    echo "🧅 HIDDEN SERVICE ACTIVE"
    echo "   .onion address: $ONION_ADDRESS"
    echo "═══════════════════════════════════════════════════════════════"
    # Export for the Node app to read
    export ONION_ADDRESS="$ONION_ADDRESS"
else
    echo "⚠️  Hidden service hostname not yet available"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Start Node.js application
# ─────────────────────────────────────────────────────────────────────────────
echo "🚀 Starting Node.js application..."

# Execute the main command
exec "$@"

