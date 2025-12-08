# Admin Analytics API Documentation

## Overview

The Admin Analytics API provides comprehensive insights into OIP node activity, user registrations, login sessions, and API usage. This endpoint is restricted to organization administrators who own/operate the OIP node.

## Authorization Model

### Organization-Based Admin Validation

The system uses a sophisticated authorization approach that ties admin privileges to organization ownership:

1. **Node Identification**: Uses `PUBLIC_API_BASE_URL` from `.env` to identify the node's domain
2. **Organization Lookup**: Finds the organization record with matching `webUrl` field
3. **Admin Validation**: Validates that the requesting user's `publicKey` matches one of the organization's `adminPublicKeys`

This approach enables:
- ✅ Multi-tenant OIP deployments with independent admin controls
- ✅ Organization-based access control
- ✅ Secure cross-node admin separation
- ✅ Fallback to traditional `isAdmin` flag if organization not configured

### Setup Requirements

#### 1. Configure Node URL

In your `.env` file:

```bash
PUBLIC_API_BASE_URL=https://api.yourdomain.com
# or
PUBLIC_API_BASE_URL=http://localhost:3005
```

#### 2. Create Organization Record

Publish an organization record with your domain:

```bash
POST /api/organizations/newOrganization
Authorization: Bearer <your-jwt-token>

{
  "basic": {
    "name": "Your Organization",
    "description": "Your OIP node organization",
    "date": 1759026867,
    "language": "en",
    "tagItems": ["oip", "node"]
  },
  "organization": {
    "org_handle": "yourorg",
    "org_public_key": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
    "admin_public_keys": [
      "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d"
    ],
    "membership_policy": "Auto-Enroll App Users",
    "webUrl": "api.yourdomain.com"  // Must match PUBLIC_API_BASE_URL domain
  }
}
```

**Important**: The `webUrl` should match your node's domain. The system uses flexible matching:
- **Exact match**: `webUrl: "oip.fitnessally.io"` matches `PUBLIC_API_BASE_URL=https://oip.fitnessally.io`
- **Base domain**: `webUrl: "fitnessally.io"` also matches `PUBLIC_API_BASE_URL=https://oip.fitnessally.io`
- **Protocol agnostic**: Works with or without `https://` prefix

#### 3. Authenticate as Admin

Use your user account whose `publicKey` is listed in the organization's `admin_public_keys` array:

```bash
POST /api/user/login

{
  "email": "admin@yourdomain.com",
  "password": "your_password"
}

# Response includes JWT token with your publicKey
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "publicKey": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d"
}
```

## API Endpoints

### 1. Node Analytics Overview

**Endpoint**: `GET /api/admin/node-analytics`

**Headers**:
```http
Authorization: Bearer <jwt-token>
```

**Query Parameters**:
- `timeRange` (optional): Time range for analytics
  - `24h` - Last 24 hours
  - `7d` - Last 7 days
  - `30d` - Last 30 days (default)
  - `90d` - Last 90 days
  - `all` - All time
- `userId` (optional): Filter by specific user ID
- `includeDetails` (optional): Include detailed activity logs (`true`/`false`, default: `false`)

**Example Request**:
```bash
curl -X GET "https://api.yourdomain.com/api/admin/node-analytics?timeRange=7d" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response Structure**:
```json
{
  "nodeInfo": {
    "baseUrl": "https://api.yourdomain.com",
    "organization": {
      "name": "Your Organization",
      "handle": "yourorg8",
      "did": "did:arweave:6zmCRZ06E2XtvN84BEQE_g4laBJdoCzTfQURHD2YlC4"
    }
  },
  
  "timeRange": "7d",
  "generatedAt": "2025-12-08T10:30:00.000Z",
  
  "users": {
    "totalRegistered": 15,
    "users": [
      {
        "userId": "abc123",
        "email": "user@example.com",
        "publicKey": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
        "createdAt": "2025-11-01T10:00:00.000Z",
        "subscriptionStatus": "active",
        "isAdmin": false,
        "importedWallet": false
      }
      // ... more users
    ]
  },
  
  "activity": {
    "totalRequests": 1523,
    
    "byRequestType": [
      { "type": "query_records", "count": 456 },
      { "type": "publish_record", "count": 89 },
      { "type": "user_login", "count": 45 },
      { "type": "ai_request", "count": 234 },
      { "type": "media_operation", "count": 123 }
      // ... more types
    ],
    
    "byUser": [
      {
        "email": "user@example.com",
        "totalRequests": 342,
        "avgDuration": 145,
        "successRate": "98.50%",
        "requestBreakdown": [
          { "type": "query_records", "count": 156 },
          { "type": "ai_request", "count": 89 }
          // ... more types
        ]
      }
      // ... more users
    ],
    
    "topEndpoints": [
      {
        "endpoint": "/api/records",
        "count": 456,
        "avgDuration": 123,
        "successRate": "99.12%"
      }
      // ... more endpoints
    ],
    
    "errorRateOverTime": [
      {
        "timestamp": "2025-12-01",
        "errorRate": "1.23%"
      }
      // ... more time periods
    ]
  },
  
  "recentLogins": [
    {
      "timestamp": "2025-12-08T10:15:00.000Z",
      "email": "user@example.com",
      "ip": "192.168.1.1",
      "userAgent": "Mozilla/5.0..."
    }
    // ... more logins
  ]
}
```

### 2. User Session Details

**Endpoint**: `GET /api/admin/user-sessions/:userId`

**Headers**:
```http
Authorization: Bearer <jwt-token>
```

**Query Parameters**:
- `limit` (optional): Number of sessions to return (default: 100)
- `offset` (optional): Pagination offset (default: 0)

**Example Request**:
```bash
curl -X GET "https://api.yourdomain.com/api/admin/user-sessions/abc123?limit=50" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response Structure**:
```json
{
  "user": {
    "userId": "abc123",
    "email": "user@example.com",
    "publicKey": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
    "createdAt": "2025-11-01T10:00:00.000Z",
    "subscriptionStatus": "active"
  },
  
  "sessions": {
    "totalLogins": 45,
    "recentLogins": [
      {
        "timestamp": "2025-12-08T10:15:00.000Z",
        "ip": "192.168.1.1",
        "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
        "success": true
      }
      // ... more logins
    ]
  },
  
  "activity": {
    "activityByDate": [
      {
        "date": "2025-12-08",
        "count": 23
      }
      // ... more dates
    ],
    
    "activityByType": [
      {
        "type": "query_records",
        "count": 156
      },
      {
        "type": "ai_request",
        "count": 89
      }
      // ... more types
    ]
  }
}
```

## Activity Tracking

### Tracked Information

The system automatically logs all API activity including:

- **User Information**: userId, email, publicKey, isAdmin status
- **Request Details**: HTTP method, endpoint, query parameters
- **Response Details**: status code, duration (ms), success/failure
- **Context**: IP address, user agent, timestamp
- **Request Type**: Categorized for analytics (query_records, publish_record, user_login, etc.)
- **Record Type**: Template/record type for publishing/querying operations
- **Errors**: Error messages for failed requests

### Request Type Categories

| Category | Description | Example Endpoints |
|----------|-------------|-------------------|
| `query_records` | Querying records from database | `GET /api/records` |
| `publish_record` | Publishing new records | `POST /api/records/newRecord` |
| `delete_record` | Deleting records | `DELETE /api/records/deleteRecord` |
| `publish_content` | Publishing via convenience endpoints | `POST /api/publish/newPost` |
| `media_operation` | Media upload/download/streaming | `/api/media/*` |
| `user_login` | User authentication | `POST /api/user/login` |
| `user_register` | New user registration | `POST /api/user/register` |
| `mnemonic_access` | HD wallet mnemonic retrieval | `GET /api/user/mnemonic` |
| `organization_operation` | Organization CRUD operations | `/api/organizations/*` |
| `ai_request` | ALFRED AI interactions | `/api/alfred/*` |
| `admin_operation` | Admin operations | `/api/admin/*` |
| `other` | Uncategorized requests | Various |

### Privacy Considerations

- **Query Parameters**: Logged but sanitized for sensitive data
- **Request Bodies**: Not logged to protect user privacy
- **Passwords**: Never logged
- **JWT Tokens**: Only extracted user info logged, not token itself

### Performance Impact

- **Asynchronous Logging**: Activity logging happens asynchronously and doesn't block API responses
- **Elasticsearch Indexing**: Logs are batched and indexed efficiently
- **Minimal Overhead**: Typically adds <5ms to request processing time
- **Failed Logging**: Errors in logging don't break API functionality

## Use Cases

### 1. User Activity Monitoring

Track which users are most active on your node:

```bash
GET /api/admin/node-analytics?timeRange=7d
```

Review the `activity.byUser` section to see:
- Total requests per user
- Average response times
- Success rates
- Request type breakdown

### 2. Security Auditing

Monitor login attempts and unusual activity:

```bash
GET /api/admin/user-sessions/:userId
```

Check for:
- Multiple failed login attempts
- Logins from unusual IP addresses
- Suspicious user agent patterns

### 3. Performance Analysis

Identify slow endpoints and optimize:

```bash
GET /api/admin/node-analytics?timeRange=24h
```

Review `activity.topEndpoints` for:
- Endpoints with high request counts
- Endpoints with slow average durations
- Endpoints with high error rates

### 4. Usage Trends

Understand how your node is being used:

```bash
GET /api/admin/node-analytics?timeRange=30d
```

Analyze:
- Request type distribution
- Activity over time
- Popular features
- Growth trends

## Error Responses

### 401 Unauthorized
```json
{
  "error": "Authentication required",
  "message": "Please provide a valid JWT token"
}
```

**Solution**: Include valid JWT token in Authorization header

### 403 Forbidden (No Organization)
```json
{
  "error": "Unauthorized",
  "message": "No organization registered for this node. Please create an organization record with matching webUrl."
}
```

**Solution**: Create organization record with `webUrl` matching `PUBLIC_API_BASE_URL`

### 403 Forbidden (Not Admin)
```json
{
  "error": "Unauthorized",
  "message": "You are not an admin of the organization hosting this node",
  "organizationName": "Your Organization",
  "organizationHandle": "yourorg8"
}
```

**Solution**: Ensure your user's `publicKey` is in the organization's `admin_public_keys` array

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "Failed to validate admin permissions"
}
```

**Solution**: Check server logs for detailed error information

## Elasticsearch Indices

### user_activity Index

The system creates a dedicated `user_activity` index with the following schema:

```javascript
{
  timestamp: { type: 'date' },
  userId: { type: 'keyword' },
  userEmail: { type: 'keyword' },
  userPublicKey: { type: 'keyword' },
  isAdmin: { type: 'boolean' },
  method: { type: 'keyword' },
  endpoint: { type: 'keyword' },
  fullUrl: { type: 'text' },
  queryParams: { type: 'object', enabled: false },
  statusCode: { type: 'integer' },
  duration: { type: 'integer' },
  success: { type: 'boolean' },
  ip: { type: 'ip' },
  userAgent: { type: 'text' },
  requestType: { type: 'keyword' },
  recordType: { type: 'keyword' },
  error: { type: 'text' }
}
```

### Index Management

**Check index status**:
```bash
curl http://localhost:9200/user_activity/_count
```

**View recent activity**:
```bash
curl http://localhost:9200/user_activity/_search?size=10&sort=timestamp:desc
```

**Delete index** (caution - deletes all activity logs):
```bash
curl -X DELETE http://localhost:9200/user_activity
```

The index will be automatically recreated on the next API request.

## Example Workflow

### Complete Setup and Usage

```bash
# 1. Configure your node
echo "PUBLIC_API_BASE_URL=https://api.yourdomain.com" >> .env

# 2. Register as a user
curl -X POST https://api.yourdomain.com/api/user/register \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@yourdomain.com", "password": "secure_password"}'

# Response includes JWT token and publicKey
# Save the publicKey for organization creation

# 3. Create organization record
curl -X POST https://api.yourdomain.com/api/organizations/newOrganization \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "basic": {
      "name": "Your Organization",
      "description": "Your OIP node",
      "date": 1759026867,
      "language": "en"
    },
    "organization": {
      "org_handle": "yourorg",
      "org_public_key": "YOUR_PUBLIC_KEY",
      "admin_public_keys": ["YOUR_PUBLIC_KEY"],
      "membership_policy": "Auto-Enroll App Users",
      "webUrl": "api.yourdomain.com"
    }
  }'

# 4. Access admin analytics
curl -X GET "https://api.yourdomain.com/api/admin/node-analytics?timeRange=30d" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# 5. Check specific user activity
curl -X GET "https://api.yourdomain.com/api/admin/user-sessions/USER_ID" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Integration Examples

### JavaScript/Node.js

```javascript
// Admin Analytics Client
class OIPAdminClient {
  constructor(baseUrl, jwtToken) {
    this.baseUrl = baseUrl;
    this.jwtToken = jwtToken;
  }
  
  async getNodeAnalytics(timeRange = '30d') {
    const response = await fetch(
      `${this.baseUrl}/api/admin/node-analytics?timeRange=${timeRange}`,
      {
        headers: {
          'Authorization': `Bearer ${this.jwtToken}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Analytics request failed: ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  async getUserSessions(userId, limit = 100) {
    const response = await fetch(
      `${this.baseUrl}/api/admin/user-sessions/${userId}?limit=${limit}`,
      {
        headers: {
          'Authorization': `Bearer ${this.jwtToken}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`User sessions request failed: ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  async getMostActiveUsers(timeRange = '7d') {
    const analytics = await this.getNodeAnalytics(timeRange);
    return analytics.activity.byUser
      .sort((a, b) => b.totalRequests - a.totalRequests)
      .slice(0, 10);
  }
}

// Usage
const admin = new OIPAdminClient('https://api.yourdomain.com', 'YOUR_JWT_TOKEN');

// Get 30-day analytics
const analytics = await admin.getNodeAnalytics('30d');
console.log('Total requests:', analytics.activity.totalRequests);
console.log('Total users:', analytics.users.totalRegistered);

// Get most active users
const topUsers = await admin.getMostActiveUsers('7d');
console.log('Top 10 users:', topUsers);

// Get specific user details
const userSessions = await admin.getUserSessions('abc123');
console.log('User login count:', userSessions.sessions.totalLogins);
```

### Python

```python
import requests
from typing import Dict, List, Optional

class OIPAdminClient:
    def __init__(self, base_url: str, jwt_token: str):
        self.base_url = base_url
        self.headers = {'Authorization': f'Bearer {jwt_token}'}
    
    def get_node_analytics(self, time_range: str = '30d', 
                          user_id: Optional[str] = None,
                          include_details: bool = False) -> Dict:
        """Get comprehensive node analytics"""
        params = {'timeRange': time_range}
        if user_id:
            params['userId'] = user_id
        if include_details:
            params['includeDetails'] = 'true'
        
        response = requests.get(
            f'{self.base_url}/api/admin/node-analytics',
            headers=self.headers,
            params=params
        )
        response.raise_for_status()
        return response.json()
    
    def get_user_sessions(self, user_id: str, 
                         limit: int = 100,
                         offset: int = 0) -> Dict:
        """Get detailed session history for a user"""
        params = {'limit': limit, 'offset': offset}
        response = requests.get(
            f'{self.base_url}/api/admin/user-sessions/{user_id}',
            headers=self.headers,
            params=params
        )
        response.raise_for_status()
        return response.json()
    
    def get_user_summary(self) -> List[Dict]:
        """Get summary of all users"""
        analytics = self.get_node_analytics()
        return analytics['users']['users']

# Usage
admin = OIPAdminClient('https://api.yourdomain.com', 'YOUR_JWT_TOKEN')

# Get analytics
analytics = admin.get_node_analytics(time_range='7d')
print(f"Total requests: {analytics['activity']['totalRequests']}")
print(f"Total users: {analytics['users']['totalRegistered']}")

# Get all users
users = admin.get_user_summary()
for user in users:
    print(f"User: {user['email']}, Created: {user['createdAt']}")

# Get specific user activity
sessions = admin.get_user_sessions('abc123')
print(f"Total logins: {sessions['sessions']['totalLogins']}")
```

## Security Best Practices

### 1. Protect JWT Tokens
- Store tokens securely (e.g., environment variables, secure storage)
- Never commit tokens to version control
- Rotate tokens regularly (45-day expiry by default)

### 2. Limit Admin Access
- Only add trusted users to `admin_public_keys`
- Regularly audit admin list
- Remove former administrators promptly

### 3. Monitor Admin Activity
- Admin operations are also logged in `user_activity`
- Review admin actions periodically
- Set up alerts for unusual admin activity

### 4. Secure Network Access
- Use HTTPS in production
- Restrict access to analytics endpoints via firewall
- Consider IP allowlisting for admin endpoints

### 5. Data Privacy
- Analytics data includes user emails and activity
- Comply with privacy regulations (GDPR, CCPA)
- Implement data retention policies
- Consider anonymizing old activity logs

## Troubleshooting

### Issue: "No organization found for node domain"

**Cause**: Organization record not created or `webUrl` doesn't match

**Solution**:
1. Check `PUBLIC_API_BASE_URL` in `.env`
2. Create organization with matching `webUrl`
3. Verify organization indexed successfully:
   ```bash
   curl http://localhost:9200/organizations/_search?q=data.webUrl:yourdomain.com
   ```

### Issue: "You are not an admin of the organization"

**Cause**: User's `publicKey` not in organization's `admin_public_keys`

**Solution**:
1. Get your user's public key:
   ```bash
   # From login response or:
   GET /api/user/mnemonic
   ```
2. Verify organization's admin keys:
   ```bash
   GET /api/organizations
   ```
3. Update organization record to include your public key

### Issue: "User_activity index not created"

**Cause**: First API request after server start hasn't occurred yet

**Solution**: Make any authenticated API request to trigger index creation

### Issue: Missing activity data

**Cause**: Activity logging started after server update

**Solution**: Activity logging only captures data after implementation

## Related Documentation

- [OIP Technical Overview](./OIP_TECHNICAL_OVERVIEW.md)
- [User Wallets Documentation](./user_wallets_documentation.md)
- [Organizations Documentation](./ORGANIZATIONS.md)
- [API Records Documentation](./API_RECORDS_ENDPOINT_DOCUMENTATION.md)

## Changelog

### Version 1.0.0 (2025-12-08)
- Initial release of Admin Analytics API
- Organization-based admin validation
- User activity tracking middleware
- Node analytics overview endpoint
- User session details endpoint
- Comprehensive activity categorization

---

*This API is part of the OIP (Open Index Protocol) system. For questions or support, consult the comprehensive technical documentation.*

