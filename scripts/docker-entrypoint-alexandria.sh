#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# ALEXANDRIA SERVICE - Docker Entrypoint
# ═══════════════════════════════════════════════════════════════════════════════

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  ALEXANDRIA SERVICE - Starting"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Wait for OIP Daemon to be ready
OIP_DAEMON="${OIP_DAEMON_URL:-http://oip-daemon-service:3005}"
DAEMON_HOST=$(echo $OIP_DAEMON | sed 's|http://||' | cut -d: -f1)
DAEMON_PORT=$(echo $OIP_DAEMON | sed 's|http://||' | cut -d: -f2 | cut -d/ -f1)

echo "⏳ Waiting for OIP Daemon at ${DAEMON_HOST}:${DAEMON_PORT}..."
./wait-for-it.sh "${DAEMON_HOST}:${DAEMON_PORT}" -t 120 -- echo "✅ OIP Daemon is ready"

# Wait for Ollama if specified
if [ -n "$OLLAMA_HOST" ]; then
    OLLAMA_HOST_ONLY=$(echo $OLLAMA_HOST | sed 's|http://||' | cut -d: -f1)
    OLLAMA_PORT=$(echo $OLLAMA_HOST | sed 's|http://||' | cut -d: -f2)
    if [ -n "$OLLAMA_HOST_ONLY" ] && [ -n "$OLLAMA_PORT" ]; then
        echo "⏳ Waiting for Ollama at ${OLLAMA_HOST_ONLY}:${OLLAMA_PORT}..."
        ./wait-for-it.sh "${OLLAMA_HOST_ONLY}:${OLLAMA_PORT}" -t 60 -- echo "✅ Ollama is ready" || echo "⚠️  Ollama not available (continuing anyway)"
    fi
fi

# Ensure data directories exist
echo "📁 Ensuring data directories..."
mkdir -p ./media/temp_audio ./media/generated ./data/podcasts ./data/images

# Set up node_modules if they were moved during build
if [ -d "../node_modules" ] && [ ! -d "./node_modules" ]; then
    echo "🔗 Linking node_modules..."
    ln -s ../node_modules ./node_modules
fi

# Environment info
echo ""
echo "📋 Environment:"
echo "   PORT: ${PORT:-3006}"
echo "   NODE_ENV: ${NODE_ENV:-development}"
echo "   OIP_DAEMON_URL: ${OIP_DAEMON_URL:-http://oip-daemon-service:3005}"
echo "   OLLAMA_HOST: ${OLLAMA_HOST:-not set}"
echo "   TTS_SERVICE_URL: ${TTS_SERVICE_URL:-not set}"
echo "   STT_SERVICE_URL: ${STT_SERVICE_URL:-not set}"
echo ""

# Memory settings (higher for AI operations)
export NODE_OPTIONS="${NODE_OPTIONS:---expose-gc --max-old-space-size=8192}"
echo "💾 Memory: NODE_OPTIONS=$NODE_OPTIONS"
echo ""

# Start Alexandria
echo "🚀 Starting Alexandria Service..."
exec "$@"

