# Authentication System Refactor Plan

## Problem Statement

The current system incorrectly uses JWT tokens for API-level authentication where API keys should be used instead. JWT tokens should be reserved for user-specific authentication in the reference client, while API keys should protect server-to-server and data operation endpoints.

## Current State Analysis

### Routes Currently Using JWT (Incorrectly)

**Publishing Routes** (`routes/publish.js`):
- `POST /api/publish/newTemplate` - should use API key

**Template Routes** (`routes/templates.js`):
- `POST /api/templates/newTemplate` - should use API key
- `POST /api/templates/newTemplateRemap` - should use API key

**Wallet Routes** (`routes/wallet.js`):
- `POST /api/wallet/address` - should use API key
- `GET /api/wallet/balances` - should use API key
- `GET /api/wallet/transactions` - should use API key
- `POST /api/wallet/verify-payment` - should use API key
- `GET /api/wallet/payment-status/:contentId` - should use API key
- `GET /api/wallet/notifications` - should use API key
- `POST /api/wallet/notifications/mark-read` - should use API key

**Lit Protocol Routes** (`routes/lit.js`):
- `POST /api/lit/mint-pkp` - should use API key
- `GET /api/lit/pkp/:tokenId` - should use API key

### Routes Currently Using JWT (Correctly)

**User Routes** (`routes/user.js`):
- `PUT /api/user/update-subscription` - should keep JWT (user-specific)
- `PUT /api/user/update-payment` - should keep JWT (user-specific)

### Publishing Routes Without Current Authentication

**Publishing Routes** (`routes/publish.js`):
- `POST /api/publish/newRecipe` - should add API key
- `POST /api/publish/newWorkout` - should add API key
- `POST /api/publish/newVideo` - should add API key
- `POST /api/publish/newImage` - should add API key
- `POST /api/publish/newPost` - should add API key

**Creator Routes** (`routes/creators.js`):
- `POST /api/creators/newCreator` - should add API key

### Technical Issues

**Duplicate Middleware:**
- `helpers/utils.js` exports `authenticateToken` function (lines 202-221)
- `middleware/auth.js` exports `authenticateToken` function (lines 11-29)
- Most routes import from `helpers/utils.js`

## Implementation Plan

### Phase 1: Environment and Middleware Setup

#### 1.1 Environment Configuration
- Add `OIP_API_KEY` to `example env` file
- Generate secure API key for production deployment
- Document API key in README

#### 1.2 Create API Key Middleware
- Create `authenticateApiKey` middleware function
- Add to `helpers/utils.js` or create dedicated `middleware/apiAuth.js`
- Validate `X-API-Key` header against environment variable

#### 1.3 Update CORS Configuration
- Add `X-API-Key` to allowed headers in `index.js`
- Current: `allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'xi-api-key']`
- Update to: `allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key', 'xi-api-key']`

### Phase 2: Server Route Updates

#### 2.1 Replace JWT with API Key Authentication

**Templates:**
```javascript
// In routes/templates.js
// BEFORE: router.post('/newTemplate', authenticateToken, async (req, res) => {
// AFTER:  router.post('/newTemplate', authenticateApiKey, async (req, res) => {

// BEFORE: router.post('/newTemplateRemap', authenticateToken, async (req, res) => {
// AFTER:  router.post('/newTemplateRemap', authenticateApiKey, async (req, res) => {
```

**Wallet Routes:**
```javascript
// In routes/wallet.js - Replace ALL authenticateToken with authenticateApiKey
router.post('/address', authenticateApiKey, async (req, res) => {
router.get('/balances', authenticateApiKey, async (req, res) => {
router.get('/transactions', authenticateApiKey, async (req, res) => {
router.post('/verify-payment', authenticateApiKey, async (req, res) => {
router.get('/payment-status/:contentId', authenticateApiKey, async (req, res) => {
router.get('/notifications', authenticateApiKey, async (req, res) => {
router.post('/notifications/mark-read', authenticateApiKey, async (req, res) => {
```

**Lit Protocol Routes:**
```javascript
// In routes/lit.js
router.post('/mint-pkp', authenticateApiKey, async (req, res) => {
router.get('/pkp/:tokenId', authenticateApiKey, async (req, res) => {
```

#### 2.2 Add API Key Authentication to Unprotected Routes

**Publishing Routes:**
```javascript
// In routes/publish.js
router.post('/newRecipe', authenticateApiKey, async (req, res) => {
router.post('/newWorkout', authenticateApiKey, async (req, res) => {
router.post('/newVideo', authenticateApiKey, async (req, res) => {
router.post('/newImage', authenticateApiKey, async (req, res) => {
router.post('/newPost', authenticateApiKey, async (req, res) => {
```

**Creator Routes:**
```javascript
// In routes/creators.js
router.post('/newCreator', authenticateApiKey, async (req, res) => {
```

#### 2.3 Keep JWT Authentication for User-Specific Routes
- Leave `routes/user.js` routes using `authenticateToken` as-is
- These handle user account management and should remain user-specific

### Phase 3: Reference Client Updates

#### 3.1 Add API Key Configuration
```javascript
// In public/reference-client.html
const API_KEY = 'your-oip-api-key-here'; // Should be loaded from config
```

#### 3.2 Update Fetch Requests
Add `X-API-Key` header to all publishing requests:

```javascript
// Creator registration
const response = await fetch('/api/creators/newCreator', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'X-API-Key': API_KEY
    },
    body: JSON.stringify(creatorData)
});

// Template creation  
const response = await fetch('/api/templates/newTemplate', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'X-API-Key': API_KEY
    },
    body: JSON.stringify(templateData)
});

// Record publishing
const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'X-API-Key': API_KEY
    },
    body: JSON.stringify(recordData)
});
```

#### 3.3 Dual Authentication Strategy
- **JWT Token**: For user authentication and session management
- **API Key**: For all data operations (publishing, templates, etc.)
- Both should be sent when user is logged in and performing data operations

### Phase 4: Cleanup and Consolidation

#### 4.1 Middleware Consolidation
- Choose single source for authentication middleware (recommend `middleware/auth.js`)
- Update all imports to use consolidated middleware
- Remove duplicate `authenticateToken` from `helpers/utils.js`
- Export both `authenticateToken` and `authenticateApiKey` from `middleware/auth.js`

#### 4.2 Update Imports
```javascript
// Update all files currently importing from helpers/utils.js
// BEFORE: const { authenticateToken } = require('../helpers/utils');
// AFTER:  const { authenticateToken, authenticateApiKey } = require('../middleware/auth');
```

#### 4.3 Testing Requirements
- Test all protected routes with API key
- Test reference client with dual authentication
- Verify JWT-only routes still work for user operations
- Test error responses for missing/invalid API keys
- Test error responses for missing/invalid JWT tokens

### Phase 5: Security Considerations

#### 5.1 API Key Management
- Generate cryptographically secure API key
- Store securely in environment variables
- Consider key rotation strategy for production
- Document API key usage in API documentation

#### 5.2 Error Messages
- Ensure API key validation provides clear error messages
- Don't expose sensitive information in error responses
- Log authentication failures for monitoring

#### 5.3 Rate Limiting
- Consider adding rate limiting to API key protected routes
- Implement request throttling if needed

## Implementation Code Templates

### API Key Middleware Template
```javascript
// middleware/auth.js addition
const authenticateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
        return res.status(401).json({ 
            error: 'Unauthorized', 
            message: 'API key required' 
        });
    }
    
    if (apiKey !== process.env.OIP_API_KEY) {
        return res.status(403).json({ 
            error: 'Forbidden', 
            message: 'Invalid API key' 
        });
    }
    
    next();
};
```

### Environment Variable Addition
```bash
# Add to example env and production .env
OIP_API_KEY=your-secure-api-key-here
```

### Reference Client API Key Integration
```javascript
// Add to reference client configuration
const API_CONFIG = {
    apiKey: 'your-oip-api-key-here', // Should be loaded from environment/config
    baseUrl: window.location.origin
};

// Helper function for authenticated requests
async function makeAuthenticatedRequest(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        'X-API-Key': API_CONFIG.apiKey,
        ...options.headers
    };
    
    // Add JWT token if user is logged in
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    return fetch(endpoint, {
        ...options,
        headers
    });
}
```

## Testing Checklist

- [ ] API key middleware validates correct keys
- [ ] API key middleware rejects invalid keys
- [ ] API key middleware rejects missing keys
- [ ] All publishing routes require API key
- [ ] All template routes require API key
- [ ] All wallet routes require API key
- [ ] All Lit protocol routes require API key
- [ ] User routes still use JWT authentication
- [ ] Reference client sends both JWT and API key
- [ ] Reference client handles authentication errors
- [ ] CORS allows X-API-Key header
- [ ] All route imports updated to use consolidated middleware
- [ ] No duplicate authentication middleware remains

## Notes

- This refactor separates concerns properly: API keys for server-to-server operations, JWT for user session management
- The reference client will use both: JWT for user context and API keys for data operations
- This allows the platform to scale with proper API access control while maintaining user authentication
- Consider implementing API key rotation and management system in future iterations

## Rollback Plan

If issues arise during implementation:
1. Revert route middleware changes
2. Remove API key requirements from reference client
3. Keep JWT authentication as fallback
4. Address issues before re-implementing

This incremental approach allows for safe rollback at any point during implementation. 