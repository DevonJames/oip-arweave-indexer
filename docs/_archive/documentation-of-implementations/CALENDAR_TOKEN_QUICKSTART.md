# Calendar Token System - Quick Start Guide

## What Changed?

Added **scoped JWT tokens** for calendar subscriptions that:
- ✅ Only access `workoutSchedule` and `mealPlan` records
- ✅ Read-only (GET requests only)
- ✅ 1-year expiration (vs 45 days for standard JWT)
- ✅ Still work with GUN encryption (includes publicKey)
- ✅ Can be revoked by user

## Quick Test

### Prerequisites

1. Ensure OIP backend is running on port 8765
2. Have a test user account (email/password)
3. Install `jq` for JSON parsing: `brew install jq`

### Run Full Test Suite

```bash
cd /Users/devon/Documents/CODE-local/oip-arweave-indexer

# Run with default settings
./scripts/test-calendar-tokens.sh

# Or specify custom settings
API_BASE=http://localhost:8765 \
TEST_EMAIL=your@email.com \
TEST_PASSWORD=yourpassword \
./scripts/test-calendar-tokens.sh
```

### Manual Quick Test

```bash
# 1. Login and get full JWT
curl -X POST http://localhost:8765/api/user/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}' \
  | jq -r '.token' > /tmp/jwt.txt

# 2. Generate calendar token
curl -X POST http://localhost:8765/api/user/generate-calendar-token \
  -H "Authorization: Bearer $(cat /tmp/jwt.txt)" \
  | jq -r '.calendarJWT' > /tmp/calendar_jwt.txt

# 3. Use calendar token to access workouts (should work)
curl -X GET "http://localhost:8765/api/records?recordType=workoutSchedule&source=gun" \
  -H "Authorization: Bearer $(cat /tmp/calendar_jwt.txt)" \
  | jq '.auth.user.scope'
# Expected: "calendar-read-only"

# 4. Try to access profile (should fail)
curl -X GET "http://localhost:8765/api/records?recordType=userFitnessProfile&source=gun" \
  -H "Authorization: Bearer $(cat /tmp/calendar_jwt.txt)" \
  | jq
# Expected: 403 Forbidden
```

## API Endpoints

### Generate Calendar Token
```http
POST /api/user/generate-calendar-token
Authorization: Bearer <full-jwt>
```

### Revoke Calendar Token
```http
POST /api/user/revoke-calendar-token
Authorization: Bearer <full-jwt>
```

### Use Calendar Token
```http
GET /api/records?recordType=workoutSchedule&source=gun
Authorization: Bearer <calendar-jwt>
```

## Files Changed

| File | Changes |
|------|---------|
| `routes/user.js` | Added 2 endpoints: generate + revoke calendar tokens |
| `middleware/auth.js` | Added scope checking and enforcement |
| `routes/records.js` | Added scope enforcement to GET /api/records |

## Database Schema Changes

New fields in `users` index:
```javascript
{
  calendarTokenHash: "sha256_hash",
  calendarTokenCreatedAt: 1733759580000,
  calendarTokenLastUsed: null,
  calendarTokenRevokedAt: null
}
```

## Security Benefits

| Before | After |
|--------|-------|
| Full JWT stored in `.calendar-tokens.json` | Calendar JWT stored (scoped) |
| All data accessible | Only workouts & meals |
| Read/write access | Read-only |
| 45-day expiration | 365-day expiration |
| **100% account compromise if stolen** | **~10% data exposure if stolen** |

## Integration with FitnessAlly

### OLD Code (Insecure)
```typescript
// DON'T DO THIS - stores full-access JWT
const token = crypto.randomBytes(32).toString('hex');
calendarTokenStore.set(token, {
  oipToken: fullAccessJWT // ❌ PROBLEM
});
```

### NEW Code (Secure)
```typescript
// Call OIP to generate scoped token
const response = await fetch(`${oipHost}/api/user/generate-calendar-token`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${fullAccessJWT}` }
});

const { calendarJWT } = await response.json();

// Store scoped JWT
calendarTokenStore.set(tokenHash, {
  oipToken: calendarJWT // ✅ Scoped token
});

// Use in calendar subscriptions
const workouts = await fetch(`${oipHost}/api/records?recordType=workoutSchedule`, {
  headers: { 'Authorization': `Bearer ${calendarJWT}` }
});
```

## Troubleshooting

### Test fails with "Invalid or expired token"
- Check JWT_SECRET matches in `.env` file
- Verify token hasn't expired
- Ensure proper Authorization header format: `Bearer <token>`

### Test fails with "User not found"
- Create test user: `POST /api/user/register`
- Verify email/password are correct
- Check Elasticsearch users index

### Scope enforcement not working
- Verify `enforceCalendarScope` middleware is in route chain
- Check `req.user.scope` is set correctly
- Review console logs for scope check messages

### GUN decryption fails
- Ensure calendar JWT includes `publicKey` field
- Verify user has `encryptedGunSalt` in database
- Check GUN encryption configuration

## Next Steps

1. ✅ Test all endpoints using provided test script
2. ✅ Update FitnessAlly to use new calendar token generation
3. ✅ Update FitnessAlly calendar subscription endpoints
4. ✅ Deploy to staging/production
5. ✅ Monitor logs for scope enforcement messages
6. ✅ Have users regenerate calendar tokens

## Support

For issues or questions, check:
- Full documentation: `docs/CALENDAR_TOKEN_SYSTEM.md`
- Test script: `scripts/test-calendar-tokens.sh`
- Console logs: Look for `[Calendar Token]` and `[Calendar Scope]` prefixes

---

**Last Updated**: December 9, 2025

