# OIP Multi-Deployment Guide

## Overview

The OIP stack now supports multiple frontend deployments using a single backend infrastructure. This allows you to create project-specific public folders while sharing the same OIP services, databases, and APIs.

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

### 3. Create Your Frontend

Create `RockHoppersGame/public/index.html`:

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
        <h1>Welcome to Rock Hoppers Game</h1>
        <p>Powered by OIP (Open Index Protocol)</p>
        
        <!-- Your game interface here -->
        <div id="game-container">
            <!-- Game content -->
        </div>
        
        <!-- OIP Integration -->
        <div id="oip-features">
            <button onclick="testOIPConnection()">Test OIP Connection</button>
            <button onclick="loadRecords()">Load Game Records</button>
        </div>
    </div>

    <!-- Load API base URL (automatically configured by OIP) -->
    <script src="/api-config"></script>
    <script src="app.js"></script>
</body>
</html>
```

Create `RockHoppersGame/public/app.js`:

```javascript
// Your game's main JavaScript file
console.log('Rock Hoppers Game initializing...');
console.log('API Base URL:', window.API_BASE_URL);

// Test OIP connection
async function testOIPConnection() {
    try {
        const response = await fetch('/api/health');
        const health = await response.json();
        console.log('OIP Health:', health);
        alert('OIP Connection: ' + health.message);
    } catch (error) {
        console.error('OIP Connection failed:', error);
        alert('OIP Connection failed: ' + error.message);
    }
}

// Load game records from OIP
async function loadRecords() {
    try {
        const response = await fetch('/api/records?recordType=gameData&limit=10');
        const data = await response.json();
        console.log('Game Records:', data);
        
        // Process your game records here
        displayRecords(data.records);
    } catch (error) {
        console.error('Failed to load records:', error);
    }
}

function displayRecords(records) {
    const container = document.getElementById('game-container');
    container.innerHTML = '<h3>Game Records:</h3>';
    
    records.forEach(record => {
        const div = document.createElement('div');
        div.innerHTML = `
            <p><strong>${record.data.basic.name}</strong></p>
            <p>${record.data.basic.description}</p>
        `;
        container.appendChild(div);
    });
}

// Initialize your game
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing Rock Hoppers Game...');
    // Your game initialization code here
});
```

Create `RockHoppersGame/public/styles.css`:

```css
/* Your game's styles */
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

h1 {
    color: #16213e;
    text-align: center;
    background: linear-gradient(45deg, #0f3460, #16213e);
    padding: 20px;
    border-radius: 10px;
    margin-bottom: 30px;
}

#game-container {
    background: #0f3460;
    padding: 20px;
    border-radius: 10px;
    margin: 20px 0;
}

#oip-features {
    text-align: center;
    margin: 20px 0;
}

button {
    background: #e94560;
    color: white;
    border: none;
    padding: 10px 20px;
    margin: 0 10px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 16px;
}

button:hover {
    background: #c73650;
}
```

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

This pattern gives you the full power of OIP's backend infrastructure while maintaining complete control over your frontend presentation and user experience.
