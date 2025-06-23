# Blockchain Publishing Transition

## Overview

This document describes the transition from using only Irys to supporting both Arweave (via Turbo) and Irys for publishing OIP records. The system now allows users to specify which blockchain to publish to via a `blockchain` parameter in API requests.

## Changes Made

### 1. New Publisher Manager

Created a unified publisher manager at `helpers/publisher-manager.js` that handles publishing to both blockchains:

- **Arweave**: Uses Turbo SDK for publishing to Arweave
- **Irys**: Uses Irys SDK for publishing to the Irys network

### 2. Updated API Endpoints

All publishing endpoints now accept a `blockchain` parameter:

#### Records Endpoint
```javascript
POST /api/records/newRecord
{
  "blockchain": "arweave", // or "irys" (optional, defaults to "arweave")
  // ... other record data
}

Query Parameters:
- addMediaToArweave: 'true' or 'false' (default: 'true')
- addMediaToIPFS: 'true' or 'false' (default: 'false')
- addMediaToArFleet: 'true' or 'false' (default: 'false')
```

#### Templates Endpoint
```javascript
POST /api/templates/newTemplate
{
  "blockchain": "arweave", // or "irys" (optional, defaults to "arweave")
  // ... template data
}
```

#### Creators Endpoint
```javascript
POST /api/creators/newCreator
{
  "blockchain": "arweave", // or "irys" (optional, defaults to "arweave")
  // ... creator data
}
```

#### Publish Endpoints
```javascript
POST /api/publish/newRecipe
POST /api/publish/newVideo
POST /api/publish/newTemplate
{
  "blockchain": "arweave", // or "irys" (optional, defaults to "arweave")
  // ... data
}
```

#### Scrape Endpoints
```javascript
POST /api/scrape/article
POST /api/scrape/recipe
{
  "blockchain": "arweave", // or "irys" (optional, defaults to "arweave")
  // ... scrape data
}
```

### 3. Media Storage Options

The system now supports multiple storage backends for media files:

#### Arweave (Default)
- **Purpose**: Permanent storage
- **Usage**: Default storage method for all media files
- **Benefits**: Permanent archival, data never expires
- **Flag**: `addMediaToArweave` (default: true)

#### ArFleet (Optional)
- **Purpose**: Time-limited decentralized storage (30 days by default)
- **Usage**: Enable with `addMediaToArFleet=true`
- **Benefits**: Cost-effective for temporary storage
- **Flag**: `addMediaToArFleet` (default: false)

#### BitTorrent (Automatic)
- **Purpose**: P2P distribution fallback
- **Usage**: Automatically added as supplementary distribution method
- **Benefits**: Decentralized distribution

#### IPFS (Optional)
- **Purpose**: Content-addressed storage
- **Usage**: Enable with `addMediaToIPFS=true`
- **Benefits**: Content deduplication
- **Flag**: `addMediaToIPFS` (default: false)

### 4. Default Behavior

- If no `blockchain` parameter is provided, the system defaults to "arweave"
- All existing API calls will continue to work without modification

### 5. Testing

Use the test script to verify the publisher manager:

```bash
# Test basic functionality (balance, price checks)
node test/test-publisher.js

# Test publishing to Arweave
node test/test-publisher.js --publish-arweave

# Test publishing to Irys
node test/test-publisher.js --publish-irys
```

## Implementation Details

### Publisher Manager API

The publisher manager provides a unified interface:

```javascript
const publisherManager = require('./helpers/publisher-manager');

// Publish data
const result = await publisherManager.publish(data, {
    blockchain: 'arweave', // or 'irys'
    tags: [
        { name: 'Content-Type', value: 'application/json' },
        // ... other tags
    ],
    waitForConfirmation: true // optional, only for Arweave
});

// Get balance
const balance = await publisherManager.getBalance('arweave'); // or 'irys'

// Get price estimate
const price = await publisherManager.getPrice(dataSize, 'arweave'); // or 'irys'

// Fund wallet
const fundResult = await publisherManager.fund(amount, 'arweave'); // or 'irys'
```

### Response Format

Publishing returns a consistent format:

```javascript
{
    id: "transaction-id",
    blockchain: "arweave", // or "irys"
    provider: "turbo", // or "irys"
    url: "https://arweave.net/transaction-id" // or "https://gateway.irys.xyz/transaction-id"
}
```

## Migration Notes

1. The system maintains backward compatibility - existing code will continue to work
2. To use Irys, explicitly pass `"blockchain": "irys"` in requests
3. Both Turbo and Irys packages remain installed and configured
4. Wallet configuration remains the same for both services

## Future Considerations

- Monitor which blockchain is more commonly used
- Consider adding more blockchain options in the future
- Implement blockchain-specific optimizations as needed 