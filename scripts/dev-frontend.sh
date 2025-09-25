#!/bin/bash

# OIP Frontend Development Helper Script
# Usage: ./scripts/dev-frontend.sh [port] [project-path]

# Default values
DEFAULT_PORT=3000
DEFAULT_PROJECT="../public"

# Parse arguments
FRONTEND_PORT=${1:-$DEFAULT_PORT}
PROJECT_PATH=${2:-$DEFAULT_PROJECT}

echo "🚀 OIP Frontend Development Helper"
echo "=================================="
echo ""

# Check if we're in the right directory
if [ ! -f "index.js" ] || [ ! -f "Makefile" ]; then
    echo "❌ Error: This script must be run from the oip-arweave-indexer directory"
    echo "   Current directory: $(pwd)"
    echo "   Expected files: index.js, Makefile"
    exit 1
fi

# Check if project path exists
if [ ! -d "$PROJECT_PATH" ]; then
    echo "❌ Error: Project directory not found: $PROJECT_PATH"
    echo ""
    echo "💡 To create a new project:"
    echo "   mkdir -p $PROJECT_PATH"
    echo "   echo '<h1>My Project</h1>' > $PROJECT_PATH/index.html"
    exit 1
fi

# Set OIP port from environment
OIP_PORT=${PORT:-3005}

echo "📁 Project path: $PROJECT_PATH"
echo "🌐 Frontend port: $FRONTEND_PORT"
echo "🔧 Backend port: ${OIP_PORT} (OIP)"
echo ""

# Check if backend is running
if curl -s --max-time 2 "http://localhost:${OIP_PORT}/api/health" >/dev/null 2>&1; then
    echo "✅ OIP backend is running on :${OIP_PORT}"
else
    echo "⚠️  OIP backend not detected on :${OIP_PORT}"
    echo ""
    echo "🔧 To start the backend:"
    echo "   make standard    # Full stack"
    echo "   make minimal     # Core only"
    echo ""
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if frontend port is available
if lsof -i :$FRONTEND_PORT >/dev/null 2>&1; then
    echo "⚠️  Port $FRONTEND_PORT is already in use"
    echo ""
    read -p "Try a different port? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Enter port number: " NEW_PORT
        FRONTEND_PORT=$NEW_PORT
    else
        echo "❌ Exiting - port conflict"
        exit 1
    fi
fi

echo ""
echo "🎯 Starting frontend development server..."
echo "   Frontend: http://localhost:$FRONTEND_PORT"
echo "   Backend:  http://localhost:${OIP_PORT}"
echo ""
echo "💡 Development tips:"
echo "   • Your frontend will proxy API calls to the backend"
echo "   • Use Ctrl+C to stop the server"
echo "   • Changes to HTML/CSS/JS will be served immediately"
echo ""

# Change to project directory and start server
cd "$PROJECT_PATH"

# Check if package.json exists for better serve options
if [ -f "package.json" ]; then
    echo "📦 Found package.json - checking for dev script..."
    if npm run | grep -q "dev"; then
        echo "🚀 Running npm run dev..."
        npm run dev
    else
        echo "🚀 Running npx serve with package.json present..."
        npx serve . -p "$FRONTEND_PORT"
    fi
else
    echo "🚀 Running npx serve..."
    npx serve . -p "$FRONTEND_PORT"
fi
