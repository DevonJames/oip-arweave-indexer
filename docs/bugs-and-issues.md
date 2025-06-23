# Bugs and Issues - Priority List

## Critical (P0) - Immediate Fix Required

### 1. Missing Error Handling in Arweave Wallet Manager
**Location**: `helpers/arweave-wallet.js`
- The `uploadFile` method has incomplete error handling in the fallback approach comment
- Missing implementation for direct Arweave upload fallback
- Could cause uploads to fail silently

### 2. Undefined Variable in Template Helper
**Location**: `helpers/templateHelper.js:350`
- Reference to `latestArweaveBlockInDB` without definition
- This will cause a ReferenceError when `currentblock` is null twice

## High Priority (P1) - Fix Soon

### 3. Missing Imports in Routes
**Location**: Multiple route files
- Several routes use functions without importing them properly
- Example: `routes/records.js` references `getRecordByDidTx` and `verifyBitcoinPayment` without imports

### 4. Inconsistent Response Formats
**Location**: Various API endpoints
- Some endpoints return `res.status(200).json(transactionId, recordToIndex)` which is incorrect
- Should be `res.status(200).json({ transactionId, recordToIndex })`
- Found in: `routes/records.js`, original `routes/publish.js`

### 5. Memory Leak in Scrape Routes
**Location**: `routes/scrape.js`
- `ongoingScrapes` Map is not always cleaned up properly
- Could accumulate memory over time with failed scrapes

## Medium Priority (P2) - Should Fix

### 6. Race Condition in WebTorrent Initialization
**Location**: `helpers/templateHelper.js`
- Async initialization of WebTorrent might not complete before use
- Could cause "WebTorrent module failed to load" errors intermittently

### 7. Missing Content-Type Validation
**Location**: `helpers/publisher-manager.js`
- No validation of content types in tags
- Could lead to incorrect metadata on blockchain

### 8. Incomplete Lit Protocol Integration
**Location**: `routes/publish.js` and `helpers/lit-protocol.js`
- Lit Protocol helper is imported but file doesn't exist in the provided structure
- Video encryption features will fail

### 9. Hardcoded Backend URL
**Location**: `routes/scrape.js`
- `backendURL` is referenced but not defined globally
- Will cause undefined reference errors

## Low Priority (P3) - Nice to Fix

### 10. Commented Out Code
**Location**: Throughout the codebase
- Large sections of commented code make maintenance difficult
- Should be removed or properly documented

### 11. Console Logs in Production
**Location**: Throughout
- Excessive console.log statements
- Should use proper logging library with levels

### 12. Missing TypeScript/JSDoc
**Location**: All files
- No type definitions or JSDoc comments
- Makes API usage unclear

### 13. Duplicate Route Definitions
**Location**: `routes/scrape.js`
- Duplicate results in grep search suggest possible route conflicts

### 14. Environment Variable Validation
**Location**: `config/checkEnvironment.js`
- Referenced but not shown - needs review
- Missing TURBO_URL validation

## Recommendations

### Immediate Actions:
1. Fix the undefined `latestArweaveBlockInDB` variable
2. Add proper error handling to all async functions
3. Fix incorrect response formats
4. Define missing global variables like `backendURL`

### Short-term Actions:
1. Implement proper cleanup for `ongoingScrapes`
2. Add missing imports
3. Create the missing `helpers/lit-protocol.js` file or remove references
4. Add input validation for blockchain parameter

### Long-term Actions:
1. Refactor to use a proper logging library
2. Add TypeScript or comprehensive JSDoc
3. Remove commented code
4. Add comprehensive test coverage
5. Implement proper dependency injection

## Testing Recommendations

1. Add integration tests for both Arweave and Irys publishing
2. Test error scenarios (network failures, invalid data)
3. Load test the scraping endpoints for memory leaks
4. Test concurrent publishing requests
5. Validate all API response formats

## Security Considerations

1. No rate limiting on API endpoints
2. Missing authentication on several endpoints (commented out)
3. Direct file system access without proper sanitization
4. Wallet file path from environment variable needs validation 