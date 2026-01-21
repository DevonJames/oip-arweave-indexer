# Custom Proxy Server Guide

## Overview

OIP supports proxying requests to external servers, allowing you to run a custom application (like a game server or custom API) alongside OIP while routing requests through a unified endpoint. This is useful when:

- You have a separate server application with its own API endpoints
- You want to avoid CORS issues by routing everything through one origin
- You're building a game or application that needs both OIP services and custom backend logic
- You want to use OIP's infrastructure (authentication, static serving) while adding custom functionality

## Configuration

Add these environment variables to your `.env` file:

```bash
# Required: The URL of your custom server
CUSTOM_PROXY_TARGET=http://localhost:3001

# Required: The route prefix that triggers proxying
CUSTOM_PROXY_ROUTE=/game-api

# Optional: Strip the route prefix when forwarding (default: false)
CUSTOM_PROXY_STRIP_PREFIX=false
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CUSTOM_PROXY_TARGET` | Yes | - | The URL of your custom server (e.g., `http://localhost:3001`) |
| `CUSTOM_PROXY_ROUTE` | Yes | - | The route prefix that triggers proxying (e.g., `/game-api`) |
| `CUSTOM_PROXY_STRIP_PREFIX` | No | `false` | If `true`, removes the route prefix when forwarding requests |

## Usage Examples

### Example 1: Basic Proxy (Keep Prefix)

Your game server runs on port 3001 and expects requests at `/game-api/*`:

```bash
# .env
CUSTOM_PROXY_TARGET=http://localhost:3001
CUSTOM_PROXY_ROUTE=/game-api
```

**Request Flow:**
```
Client Request:     GET http://localhost:3005/game-api/player/stats
Proxied To:         GET http://localhost:3001/game-api/player/stats
```

Your game server should have routes like:
```javascript
// game-server.js
app.get('/game-api/player/stats', (req, res) => { ... });
app.post('/game-api/save-game', (req, res) => { ... });
```

### Example 2: Proxy with Prefix Stripping

Your game server runs on port 3001 but expects requests at the root (no `/game-api` prefix):

```bash
# .env
CUSTOM_PROXY_TARGET=http://localhost:3001
CUSTOM_PROXY_ROUTE=/game-api
CUSTOM_PROXY_STRIP_PREFIX=true
```

**Request Flow:**
```
Client Request:     GET http://localhost:3005/game-api/player/stats
Proxied To:         GET http://localhost:3001/player/stats
                    (prefix stripped)
```

Your game server should have routes like:
```javascript
// game-server.js
app.get('/player/stats', (req, res) => { ... });
app.post('/save-game', (req, res) => { ... });
```

### Example 3: Combined with Custom Public Path

You can use both features together for a complete custom application setup:

```bash
# .env
# Serve static files from parent directory's public/ folder
CUSTOM_PUBLIC_PATH=true

# Proxy API requests to your custom server
CUSTOM_PROXY_TARGET=http://localhost:3001
CUSTOM_PROXY_ROUTE=/game-api
```

**Project Structure:**
```
RockHoppersGame/
├── oip-arweave-indexer/     # OIP backend (port 3005)
│   └── .env                 # Configuration
├── public/                  # Your game's static files (served by OIP)
│   ├── index.html
│   ├── game.js
│   └── assets/
└── game-server/             # Your custom server (port 3001)
    └── server.js
```

**Request Routing:**
| Request | Handled By |
|---------|------------|
| `GET /` | OIP static files (from `../public/`) |
| `GET /game.js` | OIP static files |
| `GET /api/records` | OIP API |
| `GET /api/voice/converse` | OIP API |
| `GET /game-api/player/stats` | Your game server (proxied) |
| `POST /game-api/save-game` | Your game server (proxied) |

## How It Works

### Middleware Order

The proxy middleware is registered early in Express's middleware chain:

1. CORS middleware
2. Security headers
3. **Custom proxy middleware** ← Catches `/game-api/*` requests
4. Static file serving
5. OIP API routes (`/api/*`)

This means:
- Proxy routes are checked **before** static files and OIP APIs
- OIP's `/api/*` routes are **unaffected** (they're registered separately)
- Static files are served if no proxy match

### Features

- **Full HTTP Support**: GET, POST, PUT, DELETE, PATCH, OPTIONS
- **WebSocket Proxying**: WebSocket connections are automatically proxied
- **CORS Headers**: Automatically added to proxied responses
- **Error Handling**: Returns proper 502 errors if the target server is unavailable
- **Logging**: Console output shows proxy activity for debugging

### Console Output

When the proxy is enabled, you'll see:
```
🔀 Custom proxy enabled: /game-api/* → http://localhost:3001
🔀 Proxy configured: /game-api/* → http://localhost:3001
🔀 Strip prefix: false
```

During operation:
```
🔀 [Proxy] GET /game-api/player/stats → http://localhost:3001/game-api/player/stats
🔀 [Proxy] POST /game-api/save-game → http://localhost:3001/game-api/save-game
```

## Docker Configuration

When running OIP in Docker, `localhost` inside the container refers to the container itself, NOT your host machine. You need special hostnames to reach external services.

### Option 1: Proxy to Host Machine Services (Recommended)

If your game server runs on the host machine (not in Docker), use `host.docker.internal`:

```bash
# .env
CUSTOM_PROXY_TARGET=http://host.docker.internal:3001
CUSTOM_PROXY_ROUTE=/game-api
```

**Linux Requirement:** `host.docker.internal` works automatically on Docker Desktop (Mac/Windows), but on Linux it requires the `extra_hosts` directive. OIP's docker-compose.yml already includes this:

```yaml
# Already configured in docker-compose.yml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

**Common Mistake:**
```bash
# ❌ WRONG - localhost means the container itself!
CUSTOM_PROXY_TARGET=http://localhost:3001

# ✅ CORRECT - reaches host machine
CUSTOM_PROXY_TARGET=http://host.docker.internal:3001
```

### Option 2: Docker Network (Both in Docker)

If your game server also runs in Docker, use the service name:

```yaml
# docker-compose.override.yml
services:
  game-server:
    build: ../game-server
    networks:
      - oip-network
    ports:
      - "3001:3001"

networks:
  oip-network:
    external: true
    name: ${COMPOSE_PROJECT_NAME}_oip-network
```

```bash
# .env - use Docker service name
CUSTOM_PROXY_TARGET=http://game-server:3001
CUSTOM_PROXY_ROUTE=/game-api
```

### Restarting After Changes

Environment changes only need a restart, not rebuild:

```bash
make down && make up
```

## Troubleshooting

### Proxy Not Working

1. **Check environment variables are set:**
   ```bash
   echo $CUSTOM_PROXY_TARGET
   echo $CUSTOM_PROXY_ROUTE
   ```

2. **Verify your custom server is running:**
   ```bash
   curl http://localhost:3001/health
   ```

3. **Check OIP logs for proxy messages:**
   ```
   🔀 Custom proxy enabled: /game-api/* → http://localhost:3001
   ```

### ECONNREFUSED Error

```json
{"error": "Proxy error", "message": "connect ECONNREFUSED ::1:3001", "target": "http://localhost:3001"}
```

**Cause:** You're using `localhost` in Docker, which refers to the container itself.

**Solution:** Use `host.docker.internal` instead:
```bash
# Change this:
CUSTOM_PROXY_TARGET=http://localhost:3001
# To this:
CUSTOM_PROXY_TARGET=http://host.docker.internal:3001
```

### ENOTFOUND host.docker.internal Error

```json
{"error": "Proxy error", "message": "getaddrinfo ENOTFOUND host.docker.internal", "target": "http://host.docker.internal:3001"}
```

**Cause:** You're on Linux and `host.docker.internal` isn't configured.

**Solution:** Ensure your docker-compose.yml has `extra_hosts` configured for the OIP service:
```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

OIP's docker-compose.yml already includes this for the `oip` and `oip-gpu` services. If using a different service variant, add the line manually.

### 502 Bad Gateway Errors

The target server is unreachable. Check:
- Is your custom server running?
- Is the port correct?
- In Docker, are you using `host.docker.internal` (not `localhost`)?

### CORS Issues

The proxy automatically adds CORS headers, but if you still have issues:
- Ensure your custom server also handles CORS for WebSocket connections
- Check browser console for specific CORS error messages

### Route Conflicts

If a route matches both the proxy and an OIP route:
- The proxy middleware runs first, so it will handle the request
- Choose a unique prefix that doesn't conflict with `/api/*`

## Best Practices

1. **Use descriptive route prefixes**: `/game-api`, `/custom-api`, `/app-api`
2. **Don't use `/api`**: This conflicts with OIP's built-in routes
3. **Use strip prefix in production**: Keeps your game server's routes clean and portable
4. **Health checks**: Add a health endpoint to your custom server for monitoring
5. **Error handling**: Your custom server should return proper error responses

## Example: Complete Game Server Setup

### Game Server (game-server/server.js)

```javascript
const express = require('express');
const app = express();

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'game-server' });
});

// Game API endpoints
app.get('/player/:id/stats', (req, res) => {
    res.json({ playerId: req.params.id, score: 1000, level: 5 });
});

app.post('/save-game', (req, res) => {
    console.log('Saving game:', req.body);
    res.json({ success: true, savedAt: new Date().toISOString() });
});

app.listen(3001, () => {
    console.log('Game server running on port 3001');
});
```

### OIP Configuration (.env)

```bash
# Proxy to game server with prefix stripping
# Use host.docker.internal when running OIP in Docker
CUSTOM_PROXY_TARGET=http://host.docker.internal:3001
CUSTOM_PROXY_ROUTE=/game-api
CUSTOM_PROXY_STRIP_PREFIX=true

# Also serve custom static files
CUSTOM_PUBLIC_PATH=true
```

**Note:** If running OIP outside Docker (directly with Node.js), use `http://localhost:3001` instead.

### Frontend Usage

```javascript
// Fetch player stats through OIP proxy
const response = await fetch('/game-api/player/123/stats');
const stats = await response.json();

// Save game through OIP proxy
await fetch('/game-api/save-game', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameState: {...} })
});

// Still use OIP's voice API directly
await fetch('/api/voice/converse-custom', {
    method: 'POST',
    body: formData
});
```

## Related Documentation

- [OIP Technical Overview](OIP_TECHNICAL_OVERVIEW.md) - Full system architecture
- [Custom Frontend Development](OIP_TECHNICAL_OVERVIEW.md#custom-frontend-development) - Frontend patterns
- [Multi-Stack Deployment](OIP_TECHNICAL_OVERVIEW.md#multi-stack-deployment) - Running multiple OIP instances
