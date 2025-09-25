# OIP Multi-Deployment Guide

## Overview

The OIP stack now supports multiple frontend deployments using a single backend infrastructure. This allows you to create project-specific public folders while sharing the same OIP services, databases, and APIs.

This guide covers different development workflows for your custom frontends with OIP backend, including the `npx serve .` pattern for rapid frontend development.

## Architecture Pattern

```
RockHoppersGame/                    # Your project directory
├── oip-arweave-indexer/           # OIP backend (this repository)
│   ├── .env                       # Project-specific configuration
│   ├── docker-compose.yml
│   ├── Makefile
│   ├── public/                    # Default OIP public folder (fallback)
│   └── ...                        # All OIP backend files
└── public/                        # Custom project public folder
    ├── index.html                 # Your project's main page
    ├── app.js                     # Your project's JavaScript
    ├── styles.css                 # Your project's styles
    └── ...                        # Your project's assets
```

## Development Patterns

### Pattern 1: Frontend-First Development (npx serve .)

**Best for**: Rapid frontend development, UI/UX iteration, when you want hot reloading

```bash
RockHoppersGame/
├── oip-arweave-indexer/    # OIP backend running on :3005
└── public/                 # Frontend running on :3000 via npx serve
    ├── index.html
    ├── app.js
    └── package.json        # Optional: for dependencies
```

#### Frontend-First Setup

1. **Start OIP Backend**:
```bash
cd RockHoppersGame/oip-arweave-indexer
# Keep CUSTOM_PUBLIC_PATH=false (or remove it entirely)
make standard  # Backend runs on :3005
```

2. **Start Frontend Development Server**:
```bash
cd RockHoppersGame/public
npx serve . -p 3000  # Frontend runs on :3000
# OR with custom port: npx serve . -p 8080
```

3. **Configure API Proxy** in your frontend JavaScript:

Create `RockHoppersGame/public/config.js`:
```javascript
// Development configuration
const isDevelopment = window.location.port === '3000' || window.location.port === '8080';

const API_CONFIG = {
    // In development: proxy to OIP backend
    // In production: same origin (served by OIP)
    baseURL: isDevelopment ? 'http://localhost:3005' : '',
    
    // Helper function for API calls
    apiUrl: (endpoint) => {
        const base = API_CONFIG.baseURL;
        return `${base}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    }
};

// Make it globally available
window.API_CONFIG = API_CONFIG;
```

4. **Update your app.js** to use the proxy:

```javascript
// API helper function
async function apiCall(endpoint, options = {}) {
    const url = window.API_CONFIG.apiUrl(endpoint);
    
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
        },
    };
    
    const finalOptions = { ...defaultOptions, ...options };
    
    try {
        const response = await fetch(url, finalOptions);
        return await response.json();
    } catch (error) {
        console.error(`API call failed for ${endpoint}:`, error);
        throw error;
    }
}

// Example usage
async function testConnection() {
    try {
        const health = await apiCall('/api/health');
        console.log('OIP Health:', health);
        alert('Connected to OIP: ' + health.message);
    } catch (error) {
        alert('Failed to connect to OIP backend');
    }
}

async function loadRecords() {
    try {
        const data = await apiCall('/api/records?limit=5');
        console.log('Records:', data);
        displayRecords(data.records);
    } catch (error) {
        console.error('Failed to load records:', error);
    }
}
```

#### Benefits of Frontend-First Development:
- ✅ **Hot Reloading**: Changes reflect immediately
- ✅ **Familiar Workflow**: Keep using `npx serve .`
- ✅ **Independent Development**: Frontend and backend can be developed separately
- ✅ **Easy Testing**: Test frontend without affecting backend
- ✅ **CORS Handled**: Explicit API calls handle cross-origin requests

### Pattern 2: Integrated Development (OIP serves frontend)

**Best for**: Production-like testing, when you want single-origin behavior

```bash
RockHoppersGame/
├── oip-arweave-indexer/
│   └── .env              # CUSTOM_PUBLIC_PATH=true
└── public/               # Served directly by OIP backend
    ├── index.html
    └── app.js
```

#### Integrated Development Setup

1. **Configure OIP to serve your frontend**:
```bash
cd RockHoppersGame/oip-arweave-indexer
echo "CUSTOM_PUBLIC_PATH=true" >> .env
make standard  # Everything runs on :3005
```

2. **Access your app**: `http://localhost:3005` or your ngrok domain

3. **Simpler JavaScript** (no proxy needed):
```javascript
// Simple API calls - same origin
async function testConnection() {
    const response = await fetch('/api/health');
    const health = await response.json();
    console.log('OIP Health:', health);
}

async function loadRecords() {
    const response = await fetch('/api/records?limit=5');
    const data = await response.json();
    displayRecords(data.records);
}
```

#### Benefits of Integrated Development:
- ✅ **Production-like**: Same as final deployment
- ✅ **No CORS Issues**: Same origin for all requests
- ✅ **Single Port**: Everything on one port
- ✅ **Ngrok Ready**: External access works immediately

### Pattern 3: Hybrid Development (Best of Both)

**Best for**: Professional development workflow with both rapid iteration and production testing

#### Directory Structure:
```bash
RockHoppersGame/
├── oip-arweave-indexer/
│   ├── .env.development     # CUSTOM_PUBLIC_PATH=false
│   ├── .env.production      # CUSTOM_PUBLIC_PATH=true
│   └── Makefile
├── public/                  # Production frontend
└── dev/                     # Development frontend (with build tools)
    ├── src/
    ├── package.json
    ├── webpack.config.js    # Optional
    └── build/               # Builds to ../public/
```

#### Setup Scripts:

Create `RockHoppersGame/scripts/dev.sh`:
```bash
#!/bin/bash
echo "🚀 Starting development environment..."

# Start OIP backend
cd oip-arweave-indexer
cp .env.development .env
make standard &
BACKEND_PID=$!

# Wait for backend to be ready
sleep 10

# Start frontend dev server
cd ../dev
npm run dev &  # or npx serve . -p 3000
FRONTEND_PID=$!

echo "✅ Development servers started:"
echo "   Backend: http://localhost:3005"
echo "   Frontend: http://localhost:3000"
echo "   Press Ctrl+C to stop both servers"

# Wait for interrupt
trap "kill $BACKEND_PID $FRONTEND_PID" EXIT
wait
```

Create `RockHoppersGame/scripts/build.sh`:
```bash
#!/bin/bash
echo "🏗️ Building for production..."

# Build frontend
cd dev
npm run build  # Outputs to ../public/

# Configure for production
cd ../oip-arweave-indexer
cp .env.production .env

echo "✅ Ready for production deployment with: make standard"
```

## Package.json for Development

Create `RockHoppersGame/public/package.json` for dependencies:

```json
{
  "name": "rockhoppers-game",
  "version": "1.0.0",
  "description": "Rock Hoppers Game Frontend",
  "scripts": {
    "dev": "npx serve . -p 3000",
    "dev-hot": "npx live-server --port=3000 --host=localhost",
    "build": "echo 'No build step needed for static files'",
    "start": "npx serve . -p 3000"
  },
  "devDependencies": {
    "live-server": "^1.2.2"
  }
}
```

Then you can use:
```bash
cd RockHoppersGame/public
npm run dev        # Start development server
npm run dev-hot    # Start with live reload
```

## CORS Configuration

OIP backend already includes CORS support for development! The backend allows:
- `localhost` on any port (perfect for `npx serve`)
- Browser extensions (Chrome, Firefox, Safari)
- Ngrok domains

No additional configuration needed for the `npx serve .` workflow.

## Setup Instructions

### 1. Create Your Project Structure

```bash
# Create your project directory
mkdir RockHoppersGame
cd RockHoppersGame

# Clone or copy the OIP backend
git clone https://github.com/your-org/oip-arweave-indexer.git
# OR if already exists: cp -r /path/to/oip-arweave-indexer .

# Create your custom public directory
mkdir public
```

### 2. Configure Environment Variables

In `RockHoppersGame/oip-arweave-indexer/.env`:

```bash
# Enable custom public path
CUSTOM_PUBLIC_PATH=true

# Your other OIP configuration
PORT=3005
JWT_SECRET=your_jwt_secret
ELASTICSEARCHHOST=http://elasticsearch:9200
# ... etc
```

## Complete Example: Rock Hoppers Game

Here's a complete example using the frontend-first development pattern:

### 1. Project Structure
```bash
RockHoppersGame/
├── oip-arweave-indexer/     # OIP backend
│   ├── .env                 # CUSTOM_PUBLIC_PATH=false (for dev)
│   └── ...
└── public/                  # Your game frontend
    ├── index.html
    ├── app.js
    ├── config.js
    ├── game.js
    └── styles.css
```

### 2. Start Development Servers

**Terminal 1 - Backend:**
```bash
cd RockHoppersGame/oip-arweave-indexer
make standard
# Backend runs on :3005
```

**Terminal 2 - Frontend:**
```bash
cd RockHoppersGame/public  
npx serve . -p 3000
# Frontend runs on :3000
```

### 3. Complete Frontend Code

`RockHoppersGame/public/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rock Hoppers Game</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div id="app">
        <header>
            <h1>🦘 Rock Hoppers Game</h1>
            <p>Powered by OIP (Open Index Protocol)</p>
        </header>
        
        <main>
            <div id="connection-status">
                <button onclick="testOIPConnection()">Test OIP Connection</button>
                <span id="status-indicator">⚪</span>
            </div>
            
            <div id="game-area">
                <h2>Game Area</h2>
                <button onclick="startGame()">Start Game</button>
                <button onclick="saveScore()">Save High Score</button>
                <button onclick="loadLeaderboard()">Load Leaderboard</button>
            </div>
            
            <div id="leaderboard">
                <h3>Leaderboard</h3>
                <div id="scores"></div>
            </div>
        </main>
    </div>

    <script src="config.js"></script>
    <script src="app.js"></script>
    <script src="game.js"></script>
</body>
</html>
```

`RockHoppersGame/public/config.js`:
```javascript
// Auto-detect development vs production
const isDevelopment = window.location.port === '3000' || 
                     window.location.hostname === 'localhost' && 
                     window.location.port !== '3005';

const API_CONFIG = {
    baseURL: isDevelopment ? 'http://localhost:3005' : '',
    
    apiUrl: (endpoint) => {
        const base = API_CONFIG.baseURL;
        return `${base}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
    },
    
    // Game-specific configuration
    gameConfig: {
        recordType: 'rockHoppersScore',
        maxScores: 10
    }
};

window.API_CONFIG = API_CONFIG;
console.log('🔧 API Config loaded:', { isDevelopment, baseURL: API_CONFIG.baseURL });
```

`RockHoppersGame/public/app.js`:
```javascript
// Global app state
let gameState = {
    connected: false,
    playerName: 'Player1',
    currentScore: 0
};

// API helper function
async function apiCall(endpoint, options = {}) {
    const url = window.API_CONFIG.apiUrl(endpoint);
    console.log(`🌐 API Call: ${url}`);
    
    const defaultOptions = {
        headers: { 'Content-Type': 'application/json' }
    };
    
    try {
        const response = await fetch(url, { ...defaultOptions, ...options });
        const data = await response.json();
        console.log(`✅ API Response:`, data);
        return data;
    } catch (error) {
        console.error(`❌ API Error for ${endpoint}:`, error);
        throw error;
    }
}

// Test OIP connection
async function testOIPConnection() {
    const indicator = document.getElementById('status-indicator');
    
    try {
        indicator.textContent = '🟡';
        const health = await apiCall('/api/health');
        
        gameState.connected = true;
        indicator.textContent = '🟢';
        alert(`✅ Connected to OIP!\n\nStatus: ${health.message}\nUptime: ${health.uptime}`);
    } catch (error) {
        gameState.connected = false;
        indicator.textContent = '🔴';
        alert('❌ Failed to connect to OIP backend\n\nMake sure the backend is running on :3005');
    }
}

// Save game score to OIP
async function saveScore() {
    if (!gameState.connected) {
        alert('Please test connection first!');
        return;
    }
    
    const score = gameState.currentScore || Math.floor(Math.random() * 1000);
    
    const scoreRecord = {
        basic: {
            name: `${gameState.playerName} - Score: ${score}`,
            description: `Rock Hoppers game score by ${gameState.playerName}`,
            date: Math.floor(Date.now() / 1000),
            tagItems: ['rockhoppers', 'game', 'score']
        },
        gameData: {
            playerName: gameState.playerName,
            score: score,
            level: 1,
            timestamp: Date.now(),
            gameVersion: '1.0.0'
        }
    };
    
    try {
        const result = await apiCall('/api/publish/newRecord', {
            method: 'POST',
            body: JSON.stringify(scoreRecord)
        });
        
        alert(`🎉 Score saved to blockchain!\n\nScore: ${score}\nTransaction: ${result.transactionId?.slice(0, 12)}...`);
        loadLeaderboard(); // Refresh leaderboard
    } catch (error) {
        alert('❌ Failed to save score: ' + error.message);
    }
}

// Load leaderboard from OIP
async function loadLeaderboard() {
    if (!gameState.connected) {
        alert('Please test connection first!');
        return;
    }
    
    try {
        const data = await apiCall(`/api/records?recordType=${API_CONFIG.gameConfig.recordType}&limit=${API_CONFIG.gameConfig.maxScores}&sortBy=date:desc`);
        
        const scoresContainer = document.getElementById('scores');
        
        if (data.records && data.records.length > 0) {
            scoresContainer.innerHTML = data.records.map((record, index) => {
                const gameData = record.data.gameData;
                const date = new Date(gameData.timestamp).toLocaleDateString();
                
                return `
                    <div class="score-entry">
                        <span class="rank">#${index + 1}</span>
                        <span class="player">${gameData.playerName}</span>
                        <span class="score">${gameData.score}</span>
                        <span class="date">${date}</span>
                    </div>
                `;
            }).join('');
        } else {
            scoresContainer.innerHTML = '<p>No scores yet! Be the first to play!</p>';
        }
    } catch (error) {
        alert('❌ Failed to load leaderboard: ' + error.message);
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    console.log('🦘 Rock Hoppers Game initializing...');
    console.log('🔧 Development mode:', window.location.port === '3000');
    
    // Auto-test connection
    setTimeout(testOIPConnection, 1000);
});
```

`RockHoppersGame/public/game.js`:
```javascript
// Game logic
function startGame() {
    console.log('🎮 Starting Rock Hoppers Game...');
    
    // Simulate gameplay
    gameState.currentScore = 0;
    const gameInterval = setInterval(() => {
        gameState.currentScore += Math.floor(Math.random() * 10);
        console.log(`Score: ${gameState.currentScore}`);
        
        // End game after 5 seconds
        if (gameState.currentScore > 100) {
            clearInterval(gameInterval);
            alert(`🎉 Game Over! Final Score: ${gameState.currentScore}`);
        }
    }, 500);
}
```

### 4. Development Workflow

1. **Start both servers** (backend on :3005, frontend on :3000)
2. **Develop your frontend** with live reloading via `npx serve`
3. **Test API integration** using the proxy configuration
4. **When ready for production**, set `CUSTOM_PUBLIC_PATH=true` and redeploy

### 5. Production Deployment

When ready to deploy:

```bash
# Switch to production mode
cd RockHoppersGame/oip-arweave-indexer
echo "CUSTOM_PUBLIC_PATH=true" > .env.production
cp .env.production .env

# Deploy
make standard

# Your app is now served by OIP on :3005 (or ngrok domain)
```

## Development Tips

### Hot Reloading
Use `live-server` for automatic page refresh:
```bash
cd RockHoppersGame/public
npx live-server --port=3000 --host=localhost
```

### Debug API Calls
Add this to your browser console:
```javascript
// Enable detailed API logging
localStorage.setItem('debug-api', 'true');
```

### Environment Detection
Your frontend automatically detects development vs production:
- **Development**: `localhost:3000` → API calls go to `localhost:3005`
- **Production**: Same origin → API calls are relative

### Multiple Projects
Run multiple frontends simultaneously:
```bash
# Project 1
cd RockHoppersGame/public && npx serve . -p 3000

# Project 2  
cd SpaceGame/public && npx serve . -p 3001

# Project 3
cd PuzzleGame/public && npx serve . -p 3002

# All use the same OIP backend on :3005
```

`RockHoppersGame/public/styles.css`:
```css
/* Game-specific styles */
body {
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 20px;
    background-color: #1a1a2e;
    color: #eee;
}

#app {
    max-width: 1200px;
    margin: 0 auto;
}

header h1 {
    color: #fff;
    text-align: center;
    background: linear-gradient(45deg, #0f3460, #16213e);
    padding: 20px;
    border-radius: 10px;
    margin-bottom: 30px;
}

#connection-status {
    text-align: center;
    margin: 20px 0;
    padding: 15px;
    background: #0f3460;
    border-radius: 10px;
}

#status-indicator {
    font-size: 24px;
    margin-left: 10px;
}

#game-area, #leaderboard {
    background: #0f3460;
    padding: 20px;
    border-radius: 10px;
    margin: 20px 0;
}

.score-entry {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px;
    margin: 5px 0;
    background: #16213e;
    border-radius: 5px;
}

.rank {
    font-weight: bold;
    color: #e94560;
}

button {
    background: #e94560;
    color: white;
    border: none;
    padding: 10px 20px;
    margin: 5px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 16px;
    transition: background 0.3s;
}

button:hover {
    background: #c73650;
}

button:disabled {
    background: #666;
    cursor: not-allowed;
}
```

## Quick Start Commands

### Option 1: Frontend Development (npx serve)
```bash
# Terminal 1: Start OIP backend
cd RockHoppersGame/oip-arweave-indexer
make standard

# Terminal 2: Start frontend dev server  
cd RockHoppersGame/public
npx serve . -p 3000

# OR use the helper script:
cd RockHoppersGame/oip-arweave-indexer
make dev-frontend
```

### Option 2: Integrated Development
```bash
cd RockHoppersGame/oip-arweave-indexer
echo "CUSTOM_PUBLIC_PATH=true" >> .env
make standard
# Access at http://localhost:3005
```

## Setup Instructions (Alternative Integrated Approach)

### 4. Deploy Your Project

```bash
cd RockHoppersGame/oip-arweave-indexer

# Copy example environment and configure
cp "example env" .env
# Edit .env and set CUSTOM_PUBLIC_PATH=true

# Deploy with your preferred profile
make standard          # Standard deployment with all services
# OR
make minimal           # Minimal deployment (just core services)
# OR  
make chatterbox-gpu    # With GPU-accelerated voice features
```

### 5. Access Your Application

- **Main Application**: `https://your-ngrok-domain.com/` (serves your custom public folder)
- **OIP Admin**: `https://your-ngrok-domain.com/admin` (if admin.html exists in your public folder)
- **API Health**: `https://your-ngrok-domain.com/api/health`
- **Records API**: `https://your-ngrok-domain.com/api/records`

## File Serving Priority

1. **Custom Public Path** (`../public/`): When `CUSTOM_PUBLIC_PATH=true`
2. **Default OIP Public** (`./public/`): When `CUSTOM_PUBLIC_PATH=false` or not set

## Advanced Usage

### Multiple Projects

You can create multiple project deployments:

```bash
GameProject1/
├── oip-arweave-indexer/    # Port 3005
└── public/

GameProject2/  
├── oip-arweave-indexer/    # Port 3006 (change PORT in .env)
└── public/

WebApp3/
├── oip-arweave-indexer/    # Port 3007
└── public/
```

### Shared Services

For efficiency, you can share Elasticsearch and other services:

```bash
# In each project's .env, point to shared services
ELASTICSEARCHHOST=http://shared-elasticsearch:9200
GUN_PEERS=http://shared-gun-relay:8765
```

### Environment-Specific Configuration

Create different `.env` files for different environments:

```bash
# Development
RockHoppersGame/oip-arweave-indexer/.env.development

# Production  
RockHoppersGame/oip-arweave-indexer/.env.production

# Staging
RockHoppersGame/oip-arweave-indexer/.env.staging
```

## API Integration Examples

### Publishing Game Data

```javascript
// Publish game score
async function saveGameScore(playerName, score, level) {
    const gameRecord = {
        basic: {
            name: `${playerName} - Level ${level}`,
            description: `Game score: ${score}`,
            date: Math.floor(Date.now() / 1000),
            tagItems: ['game', 'rockhoppers', 'score']
        },
        gameData: {
            playerName: playerName,
            score: score,
            level: level,
            timestamp: Date.now(),
            gameVersion: '1.0.0'
        }
    };

    try {
        const response = await fetch('/api/publish/newRecord', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(gameRecord)
        });

        const result = await response.json();
        console.log('Score saved:', result);
        return result;
    } catch (error) {
        console.error('Failed to save score:', error);
    }
}
```

### Loading Leaderboard

```javascript
// Load top scores
async function loadLeaderboard() {
    try {
        const response = await fetch('/api/records?recordType=gameData&sortBy=score:desc&limit=10');
        const data = await response.json();
        
        const leaderboard = data.records.map(record => ({
            player: record.data.gameData.playerName,
            score: record.data.gameData.score,
            level: record.data.gameData.level,
            date: new Date(record.data.gameData.timestamp)
        }));
        
        return leaderboard;
    } catch (error) {
        console.error('Failed to load leaderboard:', error);
        return [];
    }
}
```

## Benefits

✅ **Shared Infrastructure**: Multiple frontends use the same OIP backend  
✅ **Project Isolation**: Each project has its own public folder and configuration  
✅ **Flexible Deployment**: Use any OIP profile (minimal, standard, GPU, etc.)  
✅ **Easy Maintenance**: Update OIP backend once, benefits all projects  
✅ **Cost Effective**: Share databases, APIs, and services across projects  
✅ **Scalable**: Add new projects without duplicating backend infrastructure  

## Troubleshooting

### Static Files Not Loading

1. Check `CUSTOM_PUBLIC_PATH=true` in `.env`
2. Verify your public folder exists at the parent level
3. Check console logs for the served path: `📁 Serving static files from: ...`

### API Calls Failing

1. Verify OIP services are running: `make status`
2. Check API health: `curl http://localhost:3005/api/health`
3. Ensure ngrok tunnel is active for external access

### Multiple Projects Conflicting

1. Use different ports for each project (change `PORT` in `.env`)
2. Use different ngrok domains or subdomains
3. Ensure database isolation if needed

## Next Steps

- Customize your project's public folder with your specific frontend code
- Integrate with OIP's authentication system for user management
- Use OIP's record system for game data, user profiles, and content
- Leverage OIP's media system for game assets and user-generated content
- Implement real-time features using OIP's WebSocket support

## Summary

This multi-deployment system gives you **three powerful development patterns**:

### 🚀 **Pattern 1: Frontend-First Development (`npx serve`)**
- **Perfect for**: Rapid development, hot reloading, familiar workflow
- **Setup**: Backend on :3005, Frontend on :3000 via `npx serve`
- **Benefits**: Keep your existing development workflow, instant updates

### 🔧 **Pattern 2: Integrated Development (OIP serves frontend)**
- **Perfect for**: Production-like testing, single-origin behavior
- **Setup**: Set `CUSTOM_PUBLIC_PATH=true`, everything on :3005
- **Benefits**: No CORS issues, production-ready immediately

### ⚡ **Pattern 3: Hybrid Development (Professional workflow)**
- **Perfect for**: Teams, build processes, multiple environments
- **Setup**: Development and production configurations
- **Benefits**: Best of both worlds, automated workflows

### 🎯 **Key Features**
✅ **Your familiar `npx serve .` workflow works perfectly**  
✅ **CORS already configured** - no additional setup needed  
✅ **Automatic environment detection** - dev vs production  
✅ **Complete OIP API access** - records, authentication, media, AI  
✅ **Multiple projects** can share the same backend  
✅ **Easy transition** from development to production  

### 🛠️ **Helper Tools**
- **`make dev-frontend`**: Start frontend development server automatically
- **`./scripts/dev-frontend.sh`**: Flexible frontend development helper
- **Auto-proxy configuration**: Seamless API calls in development
- **Environment detection**: Automatic dev/production switching

This pattern gives you the full power of OIP's backend infrastructure while maintaining complete control over your frontend presentation and user experience.

