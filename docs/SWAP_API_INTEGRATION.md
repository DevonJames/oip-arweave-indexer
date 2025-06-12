# BTC to XMR Swap API Integration Guide

This document outlines how to integrate the BTC to XMR swap functionality into your OIPArweave application.

## Overview

The swap functionality leverages the Bisq decentralized exchange via a custom API wrapper. This allows users to exchange Bitcoin (BTC) for Monero (XMR) without relying on a centralized exchange.

## Setup

1. **Docker Integration**

   The Bisq daemon has already been configured in the Docker Compose setup. To start it:

   ```bash
   docker-compose up -d bisq
   ```

2. **API Integration**

   To integrate the swap API into your main Express application, add the following to your `index.js`:

   ```javascript
   const express = require('express');
   const cors = require('cors');
   const bodyParser = require('body-parser');
   // Import the swap routes
   const swapRoutes = require('./routes/swap');

   const app = express();
   const PORT = process.env.PORT || 3005;

   // Middleware
   app.use(cors());
   app.use(bodyParser.json());
   app.use(bodyParser.urlencoded({ extended: true }));

   // Add the swap routes
   app.use('/api/swap', swapRoutes);

   // Start the server
   app.listen(PORT, () => {
     console.log(`Server running on port ${PORT}`);
   });
   ```

## API Endpoints

The swap functionality exposes the following endpoints:

### 1. Get Supported Pairs

- **Endpoint**: `GET /api/swap`
- **Description**: Lists all supported swap pairs and current metrics.
- **Response Example**:
  ```json
  {
    "supportedPairs": [
      {
        "fromCurrency": "BTC",
        "toCurrency": "XMR",
        "minAmount": 0.001,
        "maxAmount": 1.0
      }
    ],
    "metrics": {
      "totalSwaps": 10,
      "completedSwaps": 8,
      "failedSwaps": 1,
      "totalVolumeBTC": "0.15000000",
      "avgCompletionTimeMinutes": "75.50"
    }
  }
  ```

### 2. Get BTC to XMR Quote

- **Endpoint**: `GET /api/swap/btc-xmr/quote?amount={btcAmount}`
- **Description**: Gets a quote for swapping a specific amount of BTC to XMR.
- **Parameters**:
  - `amount`: The amount of BTC to swap (required)
- **Response Example**:
  ```json
  {
    "fromCurrency": "BTC",
    "toCurrency": "XMR",
    "requestedBtcAmount": 0.01,
    "expectedXmrAmount": "1.53846154",
    "exchangeRate": 0.0065,
    "offerCount": 3,
    "estimatedFees": "0.0001",
    "estimatedCompletionTimeMinutes": 70,
    "quoteValidUntil": "2023-10-15T12:30:00.000Z"
  }
  ```

### 3. Initialize BTC to XMR Swap

- **Endpoint**: `POST /api/swap/btc-xmr`
- **Description**: Initializes a BTC to XMR swap.
- **Request Body**:
  ```json
  {
    "btcAmount": 0.01,
    "xmrAddress": "44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXft3XjrpDtQGv7SqSsaBYBb98uNbr2VBBEt7f2wfn3RVGQBEP3A",
    "customData": {
      "userId": "user123",
      "note": "Personal swap"
    }
  }
  ```
- **Response Example**:
  ```json
  {
    "swapId": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
    "depositAddress": "bc1q3x54tlw0evltfzz4wl0p78t8st5vuxm4x4xt4w",
    "depositAmount": "0.01",
    "expectedRate": 0.0065,
    "estimatedCompletionTime": "2023-10-15T13:30:00.000Z",
    "nextSteps": {
      "description": "Send exactly 0.01 BTC to the provided deposit address",
      "warningTime": "2023-10-15T12:50:00.000Z"
    },
    "instructions": [
      "1. Send exactly the specified amount of BTC to the deposit address",
      "2. Wait for Bitcoin confirmations (typically 2-3 confirmations)",
      "3. Bisq will automatically process the swap",
      "4. XMR will be sent to your provided Monero address"
    ],
    "supportContact": "support@yourdomain.com",
    "expiresAt": "2023-10-15T13:00:00.000Z"
  }
  ```

### 4. Check Swap Status

- **Endpoint**: `GET /api/swap/{swapId}`
- **Description**: Checks the status of a specific swap.
- **Parameters**:
  - `swapId`: The ID of the swap to check (in URL path)
- **Response Example**:
  ```json
  {
    "swapId": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
    "status": "DEPOSIT_CONFIRMED",
    "details": {
      "fromCurrency": "BTC",
      "toCurrency": "XMR",
      "fromAmount": 0.01,
      "toAddress": "44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXft3XjrpDtQGv7SqSsaBYBb98uNbr2VBBEt7f2wfn3RVGQBEP3A"
    },
    "logs": [
      {
        "time": "2023-10-15T12:30:00.000Z",
        "status": "INITIALIZED",
        "message": "Swap initialized successfully"
      },
      {
        "time": "2023-10-15T12:40:00.000Z",
        "status": "AWAITING_DEPOSIT",
        "message": "Status updated to AWAITING_DEPOSIT"
      },
      {
        "time": "2023-10-15T12:50:00.000Z",
        "status": "DEPOSIT_CONFIRMED",
        "message": "Status updated to DEPOSIT_CONFIRMED"
      }
    ],
    "updatedAt": "2023-10-15T12:50:00.000Z",
    "userFriendlyStatus": "Bitcoin deposit confirmed, processing swap",
    "nextSteps": ["Bitcoin deposit confirmed, no action needed"]
  }
  ```

### 5. Cancel Swap

- **Endpoint**: `DELETE /api/swap/{swapId}`
- **Description**: Attempts to cancel a swap (only possible in certain early states).
- **Parameters**:
  - `swapId`: The ID of the swap to cancel (in URL path)
- **Response Example**:
  ```json
  {
    "swapId": "a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6",
    "status": "CANCELED",
    "message": "Swap canceled successfully"
  }
  ```

## Client Implementation

The `examples/swap-client.js` file demonstrates how to interact with these API endpoints from a client application. You can use it as a reference for implementing the swap functionality in your frontend or other client applications.

## Error Handling

All API endpoints include proper error handling. Errors are returned as JSON responses with appropriate HTTP status codes:

```json
{
  "error": "Error message",
  "message": "Additional details if available"
}
```

## Security Considerations

1. **API Authentication**
   - Consider adding authentication to these endpoints in a production environment
   - JWT tokens or API keys are recommended

2. **Input Validation**
   - All inputs are validated, but consider adding additional validation as needed

3. **Logging and Monitoring**
   - The swap events are logged, but consider implementing more robust logging for production
   - Set up alerts for failed swaps

4. **Data Persistence**
   - For production, swap data should be stored in a database rather than in-memory

## Extending the Functionality

The swap wrapper (`bisq-swap-wrapper.js`) is designed to be extensible. You can add custom functionality by:

1. Extending the class with additional methods
2. Adding more event listeners for swap events
3. Implementing database persistence
4. Adding support for additional trading pairs

## Testing

To test the swap functionality:

1. Start the Bisq daemon using Docker Compose
2. Run the example client:
   ```bash
   node examples/swap-client.js
   ```
3. For automated testing, consider implementing tests using Jest or Mocha

## Production Deployment

For production deployment:

1. Set strong API passwords
2. Enable TLS for all API communications
3. Implement proper database storage
4. Set up monitoring and alerting
5. Configure proper logging
6. Consider implementing rate limiting

## Troubleshooting

Common issues and solutions:

1. **Bisq daemon not responding:**
   - Check if the Bisq container is running: `docker-compose ps`
   - Check logs: `docker-compose logs bisq`

2. **No offers available:**
   - Bisq may not have enough market liquidity
   - Check if Bisq is connected to the network

3. **Swap stuck in a specific status:**
   - Check Bisq logs for details
   - Check if Bitcoin network is congested
   - Verify deposit transactions have confirmed 