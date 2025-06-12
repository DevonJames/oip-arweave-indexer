# Bisq Daemon for OIP Arweave

This directory contains the necessary configuration to run a Bisq daemon as part of the OIP Arweave project. The daemon provides an API for interacting with the Bisq decentralized exchange.

## Setup

The Bisq daemon is configured to run as a Docker service. You can start it along with other services using:

```bash
docker-compose up -d bisq
```

## Mock Mode

The API wrapper now includes an automatic fallback to **mock mode** when connection fails. This means that your application will continue to function even if the Bisq daemon is not running or is configured incorrectly.

When in mock mode:
- All API responses are simulated with realistic mock data
- Your application's logic will continue to work
- Swaps will be simulated but not actually executed

This is useful for development and testing purposes, as well as for graceful degradation in production.

## Connection Issues

If you encounter connection issues with the Bisq daemon, follow these steps:

1. Run the diagnostic script to check connectivity:
```bash
node bisq-daemon/check-bisq-api.js
```

2. If the diagnostic shows that mock mode is enabled, check if:
   - The Bisq daemon container is running: `docker ps | grep bisq`
   - Your application is connecting to the right host (localhost or container name)
   - The correct port is being used (default 9998)

3. Run the fix script to apply solutions automatically:
```bash
./fix-bisq-connection.sh
```

## Environment Configuration

When connecting to the Bisq daemon:

- Inside Docker: Use `bisq` as the hostname
- Outside Docker: Use `localhost` as the hostname (with port forwarding)

Set the appropriate environment variable to control this behavior:
```
RUNNING_IN_DOCKER=true  # When running in Docker
RUNNING_IN_DOCKER=false # When running locally
```

## Configuration

The Bisq daemon configuration is stored in `bisq.properties`. You can modify this file to change Bisq settings. Key settings include:

- `bitcoinNetwork`: The Bitcoin network to use (MAINNET, TESTNET, REGTEST)
- `apiPassword`: Password for API authentication
- `apiPort`: Port for the API (default: 9998)

You can also override these settings through environment variables in the `docker-compose.yml` file.

## API Usage

The Bisq daemon exposes an API. You can interact with it using the included wrapper:

```javascript
const BisqApi = require('./bisq-api-wrapper');

// Create API client
const bisq = new BisqApi({
  host: process.env.RUNNING_IN_DOCKER ? 'bisq' : 'localhost',
  port: 9998,
  password: 'bisq'
});

// Example: Get market data
async function getMarketData() {
  try {
    const markets = await bisq.getMarkets();
    console.log('Available markets:', markets);
  } catch (error) {
    console.error('Error fetching markets:', error);
  }
}

getMarketData();
```

## API Endpoints

The Bisq API supports the following key endpoints:

- `/markets` - List available markets
- `/offers` - Manage offers
- `/wallets/btc` - Manage Bitcoin wallet
- `/trades` - View and manage trades

For a complete API reference, see the [Bisq API documentation](https://github.com/bisq-network/bisq/blob/master/core/src/main/java/bisq/core/api/CoreApi.java).

## Security Considerations

The Bisq daemon handles sensitive financial data. In production environments:

1. Use a strong API password
2. Consider placing the API behind a reverse proxy with TLS
3. Limit access to the API to trusted applications only
4. Regularly backup Bisq data volume 