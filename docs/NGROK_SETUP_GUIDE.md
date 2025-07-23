# ngrok Setup Guide

This document explains how ngrok is configured and integrated into the FitnessAlly development environment, and how to replicate this setup for other server applications.

## Overview

The FitnessAlly project uses ngrok to create secure HTTPS tunnels for cross-platform development, enabling seamless communication between web, mobile, and backend services without CORS issues.

## Architecture

### Custom Domains
The setup uses three custom ngrok domains for different services:

- **Backend API**: `https://api.fitnessally.io` → `localhost:8001`
- **Frontend Web**: `https://app.fitnessally.io` → `localhost:5173`
- **Mobile Expo**: `https://mobile.fitnessally.io` → `localhost:8081`

### Benefits
- ✅ **CORS-free**: All services use HTTPS with proper domains
- ✅ **Cross-platform**: Mobile, web, and backend can communicate seamlessly  
- ✅ **Production-like**: HTTPS environment matches production
- ✅ **Custom domains**: Professional URLs instead of random ngrok subdomains

## Configuration

### 1. ngrok Configuration File (`~/.ngrok.yml`)

```yaml
version: "2"
authtoken: YOUR_NGROK_AUTHTOKEN_HERE

tunnels:
  backend:
    proto: http
    addr: 8001
    domain: api.fitnessally.io
    
  frontend:
    proto: http
    addr: 5173
    domain: app.fitnessally.io
    
  mobile:
    proto: http
    addr: 8081
    domain: mobile.fitnessally.io 
```

**Key points:**
- `version: "2"` uses ngrok's v2 configuration format
- `authtoken` is required for custom domains (get from ngrok dashboard)
- Each tunnel maps a local port to a custom domain
- `proto: http` creates HTTP tunnels (ngrok adds HTTPS automatically)

### 2. Makefile Integration

The `make all` command starts ngrok as part of the full development environment:

```makefile
all: db-start db-setup
	@echo "🔗 Starting ngrok tunnels..."
	@(ngrok start --all --config ~/.ngrok.yml > /dev/null 2>&1 &)
	@sleep 3
	@echo "🔗 ngrok: ✅"
	@echo "🌐 Starting web client..."
	@(cd client && npm run dev > /dev/null 2>&1 &)
	@sleep 2
	@echo "🌐 Web: ✅"
	@echo "📱 Starting mobile client..."
	@(cd mobile && npm start > /dev/null 2>&1 &)
	@sleep 2
	@echo "📱 Mobile: ✅"
	@echo ""
	@echo "✅ ALL SERVICES RUNNING!"
	@echo "🌍 Web App: https://app.fitnessally.io"
	@echo "🔗 API: https://api.fitnessally.io/api"
	@echo "📱 Mobile: https://mobile.fitnessally.io"
	@echo ""
	@echo "⚡ Starting backend server (logs below)..."
	@npm run dev
```

**Key aspects:**
- **Command**: `ngrok start --all --config ~/.ngrok.yml`
- **Background execution**: `&` runs ngrok in background
- **Output suppression**: `> /dev/null 2>&1` hides ngrok output
- **Timing**: 3-second sleep ensures ngrok starts before other services
- **All tunnels**: `--all` flag starts all defined tunnels simultaneously

### 3. Application Code Integration

#### Backend Server
The backend dynamically chooses between ngrok and localhost based on environment:

```typescript
// server/routes.ts
const baseUrl = process.env.NODE_ENV === 'development' 
  ? 'https://api.fitnessally.io'  // Use ngrok domain in development
  : `http://localhost:${port}`;   // Use localhost in production
```

#### Frontend Configuration
The frontend is configured to use ngrok domains in development:

```typescript
// client/vite.config.ts - CORS allowlist includes ngrok domains
server: {
  proxy: {
    '/api': {
      target: 'https://api.fitnessally.io',
      changeOrigin: true,
      secure: true
    }
  }
}
```

#### Mobile Configuration
The mobile app switches between different connection modes:

```typescript
// mobile/src/config/api.ts
const API_CONFIG = {
  NGROK_DOMAIN: 'api.fitnessally.io',
  USE_NGROK: true, // Use ngrok HTTPS domain for development
  
  getBaseUrl() {
    if (this.USE_NGROK) {
      return `https://${this.NGROK_DOMAIN}/api`;  
    }
    // ... other connection modes
  }
}
```

### 4. Service Management

#### Status Checking
Scripts check if ngrok is running before starting services:

```bash
#!/bin/bash
# start-frontend-mode.sh
if ! pgrep -f "ngrok" > /dev/null; then
    echo "⚠️  ngrok not detected. To start all tunnels, run:"
    echo "   ngrok start --all --config ~/.ngrok.yml"
fi
```

#### Cleanup
The cleanup process kills ngrok along with other services:

```makefile
stop:
	@echo "🛑 Stopping all services..."
	@-pkill -f "ngrok"
	@-pkill -f "tsx server/index.ts" 
	@-pkill -f "vite"
	@-pkill -f "expo start"
	@echo "✅ All services stopped!"
```

## Replicating for Other Projects

### 1. Setup ngrok Account & Domains

1. **Create ngrok account** at https://ngrok.com
2. **Get authtoken** from your ngrok dashboard
3. **Reserve domains** (requires paid plan for custom domains)
4. **Install ngrok CLI**: `brew install ngrok` (macOS) or download from ngrok.com

### 2. Create Configuration File

Create `~/.ngrok.yml` with your settings:

```yaml
version: "2"
authtoken: YOUR_NGROK_AUTHTOKEN_HERE

tunnels:
  api:
    proto: http
    addr: YOUR_API_PORT
    domain: your-api-domain.ngrok.app
    
  web:
    proto: http  
    addr: YOUR_WEB_PORT
    domain: your-web-domain.ngrok.app
```

### 3. Add to Build System

#### Option A: Makefile
```makefile
dev: start-ngrok start-services
	@echo "✅ Development environment ready!"

start-ngrok:
	@echo "🔗 Starting ngrok tunnels..."
	@(ngrok start --all --config ~/.ngrok.yml > /dev/null 2>&1 &)
	@sleep 3
	@echo "🔗 ngrok: ✅"

start-services:
	@echo "⚡ Starting application..."
	@npm run dev

stop:
	@echo "🛑 Stopping services..."
	@-pkill -f "ngrok"
	@-pkill -f "node"
```

#### Option B: Package.json Scripts
```json
{
  "scripts": {
    "dev": "npm run start:ngrok && npm run start:app",
    "start:ngrok": "ngrok start --all --config ~/.ngrok.yml > /dev/null 2>&1 & sleep 3",
    "start:app": "node server.js",
    "stop": "pkill -f ngrok && pkill -f node"
  }
}
```

#### Option C: Shell Script
```bash
#!/bin/bash
# start-dev.sh

echo "🔗 Starting ngrok tunnels..."
ngrok start --all --config ~/.ngrok.yml > /dev/null 2>&1 &

echo "⏳ Waiting for ngrok to initialize..."
sleep 3

echo "🔗 ngrok: ✅"
echo "🌍 API: https://your-api-domain.ngrok.app"

echo "⚡ Starting application..."
npm start
```

### 4. Environment-Aware Code

Make your application aware of the ngrok setup:

```javascript
// Environment-based URL selection
const getBaseUrl = () => {
  if (process.env.NODE_ENV === 'development') {
    return 'https://your-api-domain.ngrok.app';
  }
  return `http://localhost:${process.env.PORT || 3000}`;
};

// CORS configuration for Express
const cors = require('cors');
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://your-web-domain.ngrok.app',
    'https://your-api-domain.ngrok.app'
  ],
  credentials: true
}));
```

### 5. Best Practices

#### Security
- ⚠️ **Never commit authtoken** to version control
- ✅ Use environment variables for sensitive config
- ✅ Restrict ngrok domains to development only

#### Performance  
- ✅ Start ngrok before dependent services
- ✅ Use `--config` flag to avoid CLI arguments
- ✅ Suppress ngrok output to reduce noise
- ✅ Add proper sleep/wait times

#### Debugging
```bash
# Check ngrok status
ngrok status

# View active tunnels
curl http://localhost:4040/api/tunnels

# Test connectivity
curl https://your-domain.ngrok.app/health
```

## Troubleshooting

### Common Issues

1. **Tunnel not found error**
   ```bash
   # Ensure config file exists and is valid
   cat ~/.ngrok.yml
   ngrok config check
   ```

2. **Domain already in use**
   ```bash
   # Stop existing ngrok processes
   pkill -f ngrok
   # Then restart
   ngrok start --all
   ```

3. **Connection refused**
   - Ensure your local server is running on the configured port
   - Check firewall settings
   - Verify ngrok authtoken is valid

4. **CORS errors**
   - Add ngrok domains to your CORS allowlist
   - Ensure all services use HTTPS (not mixed HTTP/HTTPS)

### Useful Commands

```bash
# Start all tunnels
ngrok start --all --config ~/.ngrok.yml

# Start specific tunnel
ngrok start api --config ~/.ngrok.yml

# Check ngrok status
ngrok status

# View web interface (tunnels, requests, etc.)
open http://localhost:4040
```

## Conclusion

This ngrok setup provides a robust development environment that closely mirrors production while solving common development challenges like CORS and cross-platform communication. The key innovations are:

1. **Custom domains** for professional, consistent URLs
2. **Integrated startup** as part of the main development command
3. **Environment-aware code** that switches between ngrok and production URLs
4. **Multi-service coordination** with proper timing and dependencies

The setup scales well and can be adapted for any multi-service application architecture. 