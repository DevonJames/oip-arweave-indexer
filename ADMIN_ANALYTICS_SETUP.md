# Admin Analytics - Quick Setup Guide

## Overview

This feature provides OIP node administrators with comprehensive analytics about user registrations, login sessions, and API activity on their node.

## New Files Added

1. **`middleware/activityLogger.js`** - Middleware that logs all API activity to Elasticsearch
2. **`routes/admin.js`** - Admin endpoints for retrieving analytics
3. **`docs/ADMIN_ANALYTICS_API.md`** - Comprehensive API documentation

## Modified Files

1. **`index.js`** - Added activity logging middleware and registered admin routes

## Quick Start

### 1. Configure Your Node

Add to `.env`:
```bash
PUBLIC_API_BASE_URL=https://api.yourdomain.com
# or for local development:
PUBLIC_API_BASE_URL=http://localhost:3005
```

### 2. Create Organization Record

This links your node to an organization for admin authorization:

```bash
POST /api/organizations/newOrganization
Authorization: Bearer <your-jwt-token>

{
  "basic": {
    "name": "Your Organization Name",
    "description": "Your OIP node",
    "date": 1759026867,
    "language": "en",
    "tagItems": ["oip", "node"]
  },
  "organization": {
    "org_handle": "yourorg",
    "org_public_key": "YOUR_PUBLIC_KEY_FROM_REGISTRATION",
    "admin_public_keys": ["YOUR_PUBLIC_KEY_FROM_REGISTRATION"],
    "membership_policy": "Auto-Enroll App Users",
    "webUrl": "yourdomain.com"  // Base domain or full domain from PUBLIC_API_BASE_URL
  }
}
```

**Domain Matching**: The system uses flexible domain matching:
- **Exact match**: `webUrl: "oip.fitnessally.io"` matches `PUBLIC_API_BASE_URL=https://oip.fitnessally.io`
- **Base domain match**: `webUrl: "fitnessally.io"` matches `PUBLIC_API_BASE_URL=https://oip.fitnessally.io`
- **Protocol agnostic**: Works with or without `https://` in `webUrl`

**Examples**:
```javascript
// If PUBLIC_API_BASE_URL=https://oip.fitnessally.io
// These webUrl values will all match:
"webUrl": "fitnessally.io"           // ✅ Base domain match
"webUrl": "oip.fitnessally.io"       // ✅ Exact match
"webUrl": "https://fitnessally.io"   // ✅ Base domain match (protocol removed)
```

### 3. Get Analytics

```bash
GET /api/admin/node-analytics?timeRange=30d
Authorization: Bearer <your-jwt-token>
```

## Authorization Flow

The system validates admin access through:

1. **Extracts JWT token** → Gets user's `publicKey`
2. **Reads `PUBLIC_API_BASE_URL`** → Extracts domain (e.g., "api.yourdomain.com")
3. **Finds organization** → Searches for org with matching `webUrl`
4. **Validates admin** → Checks if user's `publicKey` is in org's `admin_public_keys`

If any step fails, it falls back to checking the traditional `isAdmin` field.

## Key Features

### Activity Tracking

All API activity is automatically logged including:
- User authentication (login/register)
- Record operations (query/publish/delete)
- Media operations (upload/download)
- AI requests (ALFRED interactions)
- Organization operations
- Admin operations

### Analytics Endpoints

1. **`GET /api/admin/node-analytics`**
   - Overall node statistics
   - User registration list
   - Activity breakdown by type
   - Activity breakdown by user
   - Top endpoints by usage
   - Error rates over time
   - Recent login sessions

2. **`GET /api/admin/user-sessions/:userId`**
   - Detailed user session history
   - Login attempts and success rates
   - Activity breakdown by date
   - Activity breakdown by request type

## Activity Data Structure

### Elasticsearch Index: `user_activity`

```javascript
{
  timestamp: "2025-12-08T10:30:00.000Z",
  userId: "abc123",
  userEmail: "user@example.com",
  userPublicKey: "034d41b0...",
  isAdmin: false,
  method: "POST",
  endpoint: "/api/records/newRecord",
  fullUrl: "/api/records/newRecord?recordType=post",
  queryParams: { recordType: "post" },
  statusCode: 200,
  duration: 145,  // milliseconds
  success: true,
  ip: "192.168.1.1",
  userAgent: "Mozilla/5.0...",
  requestType: "publish_record",
  recordType: "post",
  error: null
}
```

### Request Type Categories

| Type | Description |
|------|-------------|
| `query_records` | Querying records |
| `publish_record` | Publishing records |
| `delete_record` | Deleting records |
| `publish_content` | Publishing via convenience endpoints |
| `media_operation` | Media upload/download |
| `user_login` | User authentication |
| `user_register` | User registration |
| `mnemonic_access` | Wallet mnemonic retrieval |
| `organization_operation` | Organization CRUD |
| `ai_request` | AI interactions |
| `admin_operation` | Admin operations |
| `other` | Uncategorized |

## Example Response

```json
{
  "nodeInfo": {
    "baseUrl": "https://api.yourdomain.com",
    "organization": {
      "name": "Your Organization",
      "handle": "yourorg8",
      "did": "did:arweave:..."
    }
  },
  "timeRange": "30d",
  "generatedAt": "2025-12-08T10:30:00.000Z",
  "users": {
    "totalRegistered": 15,
    "users": [
      {
        "userId": "abc123",
        "email": "user@example.com",
        "publicKey": "034d41b0...",
        "createdAt": "2025-11-01T10:00:00.000Z",
        "subscriptionStatus": "active",
        "isAdmin": false,
        "importedWallet": false
      }
    ]
  },
  "activity": {
    "totalRequests": 1523,
    "byRequestType": [
      { "type": "query_records", "count": 456 },
      { "type": "publish_record", "count": 89 }
    ],
    "byUser": [
      {
        "email": "user@example.com",
        "totalRequests": 342,
        "avgDuration": 145,
        "successRate": "98.50%",
        "requestBreakdown": [...]
      }
    ],
    "topEndpoints": [...],
    "errorRateOverTime": [...]
  },
  "recentLogins": [...]
}
```

## Testing

### 1. Test Organization Validation

```bash
# Should succeed if you're an admin
curl -X GET "http://localhost:3005/api/admin/node-analytics" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Should fail with 403 if not admin
```

### 2. Test Activity Logging

```bash
# Make some API requests
curl -X GET "http://localhost:3005/api/records?limit=5" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Check activity was logged
curl -X GET "http://localhost:9200/user_activity/_search?size=1&sort=timestamp:desc"
```

### 3. Test User Sessions

```bash
# Get your user ID from login/register response
# Then query sessions
curl -X GET "http://localhost:3005/api/admin/user-sessions/YOUR_USER_ID" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Common Issues

### Issue: 403 - No organization found

**Solution**: Create organization record with `webUrl` matching your `PUBLIC_API_BASE_URL` domain.

```bash
# Check your configured URL
grep PUBLIC_API_BASE_URL .env

# Example 1: If PUBLIC_API_BASE_URL=https://oip.fitnessally.io
# You can use either:
POST /api/organizations/newOrganization
{
  "organization": {
    "webUrl": "fitnessally.io"  // ✅ Base domain (recommended)
  }
}
# OR
{
  "organization": {
    "webUrl": "oip.fitnessally.io"  // ✅ Full subdomain
  }
}

# Example 2: If PUBLIC_API_BASE_URL=http://localhost:3005
{
  "organization": {
    "webUrl": "localhost"  // ✅ Works for local development
  }
}
```

**Tip**: The error response now includes available organizations to help you debug:
```json
{
  "error": "Unauthorized",
  "message": "No organization registered for this node domain 'oip.fitnessally.io'",
  "availableOrganizations": [
    {
      "name": "FitnessAlly",
      "webUrl": "fitnessally.io"
    }
  ]
}
```

### Issue: 403 - Not an admin

**Solution**: Add your `publicKey` to organization's `admin_public_keys`:

```bash
# Get your public key
POST /api/user/login
# Response includes: "publicKey": "034d41b0..."

# Update organization to include your key in admin_public_keys array
```

### Issue: Empty activity data

**Cause**: Activity logging started after server restart - only new requests are logged.

**Solution**: Activity data will accumulate as users make API requests.

## Performance Considerations

- **Asynchronous Logging**: Activity logging doesn't block API responses
- **Minimal Overhead**: Typically adds <5ms per request
- **Index Size**: ~1KB per logged request
- **Retention**: Consider implementing log rotation for long-running nodes

## Security Notes

- Analytics endpoints require valid JWT authentication
- Admin validation through organization ownership
- Activity logs include IP addresses and user agents
- Comply with privacy regulations (GDPR/CCPA)
- Consider implementing data retention policies

## Next Steps

1. ✅ Configure `PUBLIC_API_BASE_URL` in `.env`
2. ✅ Create organization record with matching `webUrl`
3. ✅ Ensure your user's `publicKey` is in `admin_public_keys`
4. ✅ Test analytics endpoint
5. ✅ Set up monitoring/dashboards using analytics data
6. Consider implementing:
   - Email alerts for unusual activity
   - Dashboard UI for analytics visualization
   - Data export functionality
   - Automated reporting

## Documentation

- **Full API Reference**: `docs/ADMIN_ANALYTICS_API.md`
- **OIP Technical Overview**: `docs/OIP_TECHNICAL_OVERVIEW.md`
- **User Wallets**: `docs/user_wallets_documentation.md`
- **Organizations**: `docs/ORGANIZATIONS.md`

## Support

For issues or questions:
1. Check server logs for error details
2. Review comprehensive documentation in `docs/ADMIN_ANALYTICS_API.md`
3. Verify Elasticsearch `user_activity` index status
4. Ensure organization record is properly configured

---

*Admin Analytics - OIP (Open Index Protocol) v0.8.0+*

