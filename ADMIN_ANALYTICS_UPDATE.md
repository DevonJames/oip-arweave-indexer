# Admin Analytics - Organization & Deletion Updates

## Summary of Changes

Two key improvements have been made to the Admin Analytics system:

### 1. Organization Record Deletion Support

**Problem**: The `/api/records/deleteRecord` endpoint could only delete from the `records` index, not from the `organizations` index.

**Solution**: Enhanced the deletion system to automatically search and delete from both indices:

#### Modified Functions

**`helpers/elasticsearch.js` - `searchRecordInDB()`**
- Now searches both `records` and `organizations` indices
- Returns the record from whichever index contains it
- Maintains memory leak fixes with proper buffer cleanup

**`routes/records.js` - `/api/records/deleteRecord` endpoint**
- Enhanced deletion logic to try both indices:
  1. First attempts deletion from `records` index
  2. If not found, tries `organizations` index
  3. Returns success if found in either index

#### Usage

Delete any record type (including organizations) using the same endpoint:

```bash
# Delete a standard record
curl -X POST https://api.oip.onl/api/records/deleteRecord \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "delete": {
      "did": "did:arweave:record_transaction_id"
    }
  }'

# Delete an organization record (same endpoint!)
curl -X POST https://api.oip.onl/api/records/deleteRecord \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "delete": {
      "did": "did:arweave:6zmCRZ06E2XtvN84BEQE_g4laBJdoCzTfQURHD2YlC4"
    }
  }'
```

#### Benefits

✅ **Unified Deletion API**: Single endpoint for all record types  
✅ **Automatic Index Detection**: System finds the right index automatically  
✅ **Ownership Verification**: Admin keys verified for organization records  
✅ **Backward Compatible**: Existing deletion code continues to work  

---

### 2. Most Recent Organization Selection

**Problem**: When multiple organizations have the same `webUrl`, the system used the first match (arbitrary order), which could select outdated organization configurations.

**Solution**: Enhanced the admin validation to automatically use the most recent organization.

#### Modified Function

**`routes/admin.js` - `validateNodeAdmin()` middleware**

Added intelligent organization sorting:

```javascript
// Sort matching organizations by date (most recent first)
matchingOrgs.sort((a, b) => {
    const dateA = a._source.data?.date || 
                 a._source.oip?.indexedAt || 
                 a._source.oip?.inArweaveBlock || 
                 0;
    const dateB = b._source.data?.date || 
                 b._source.oip?.indexedAt || 
                 b._source.oip?.inArweaveBlock || 
                 0;
    
    // Convert dates to numbers for comparison
    const numA = typeof dateA === 'string' ? new Date(dateA).getTime() : Number(dateA);
    const numB = typeof dateB === 'string' ? new Date(dateB).getTime() : Number(dateB);
    
    return numB - numA; // Descending order (most recent first)
});

// Use the most recent matching organization
const organization = matchingOrgs[0]._source;
```

#### Date Field Priority

The system checks multiple date fields for robustness:
1. **`data.date`** - Primary date field (Unix timestamp)
2. **`oip.indexedAt`** - ISO timestamp when indexed
3. **`oip.inArweaveBlock`** - Arweave block number

#### Usage Scenario

**Before**: If you had these organizations:

```javascript
// Old organization (2024-01-01)
{
  "data": {
    "webUrl": "fitnessally.io",
    "adminPublicKeys": "OLD_ADMIN_KEY",
    "date": 1704067200
  }
}

// New organization (2025-01-14)  
{
  "data": {
    "webUrl": "fitnessally.io",
    "adminPublicKeys": "NEW_ADMIN_KEY",  // Updated admin!
    "date": 1736812800
  }
}
```

System behavior:
- ❌ **Before**: Used first match (could be old organization)
- ✅ **After**: Automatically uses most recent organization

#### Benefits

✅ **Always Current**: Uses latest organization configuration  
✅ **Easy Updates**: Publish new org record to update admin keys  
✅ **No Manual Cleanup**: Old records can stay (just ignored)  
✅ **Transparent**: Logs which organization is selected  

#### Console Output

When multiple organizations match:
```
ℹ️ Found 3 matching organizations, using most recent one
ℹ️ Selected organization: FitnessAlly (fitnessally8)
```

---

## Testing the Changes

### Test Organization Deletion

```bash
# 1. Get your organization DID
curl https://api.oip.onl/api/organizations

# 2. Delete the organization
curl -X POST https://api.oip.onl/api/records/deleteRecord \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "delete": {
      "did": "did:arweave:YOUR_ORG_DID"
    }
  }'

# 3. Verify deletion
curl https://api.oip.onl/api/organizations
```

### Test Most Recent Organization Selection

```bash
# 1. Create first organization
curl -X POST https://api.oip.onl/api/organizations/newOrganization \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "basic": {
      "name": "My Org v1",
      "date": 1704067200
    },
    "organization": {
      "org_handle": "myorg",
      "webUrl": "myorg.io",
      "admin_public_keys": ["OLD_KEY"]
    }
  }'

# 2. Create updated organization (same webUrl, newer date)
curl -X POST https://api.oip.onl/api/organizations/newOrganization \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "basic": {
      "name": "My Org v2",
      "date": 1736812800
    },
    "organization": {
      "org_handle": "myorg",
      "webUrl": "myorg.io",
      "admin_public_keys": ["NEW_KEY"]
    }
  }'

# 3. Test admin analytics (should use v2 with NEW_KEY)
curl -X GET https://api.oip.onl/api/admin/node-analytics \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Check server logs for:
```
ℹ️ Found 2 matching organizations, using most recent one
ℹ️ Selected organization: My Org v2 (myorg...)
```

---

## Updated Documentation

### Files Updated

1. **`docs/feature_documentation/DeletingRecords.md`**
   - Added organization deletion to supported record types
   - Updated "How API Deletion Works" section
   - Added example of deleting organization records

2. **`ADMIN_ANALYTICS_SETUP.md`**
   - Added "Multiple Organizations" section
   - Documented most-recent organization selection

3. **`docs/ADMIN_ANALYTICS_API.md`**
   - Updated "Organization-Based Admin Validation" section
   - Documented organization sorting logic

---

## Technical Details

### Memory Management

All changes maintain existing memory leak fixes:
- `searchResponse = null` after data extraction
- Buffer cleanup in all Elasticsearch operations
- No new memory retention issues introduced

### Error Handling

Both features include comprehensive error handling:
- Graceful fallback when organization not found
- Clear error messages for debugging
- Logging at key decision points

### Performance Impact

Minimal performance impact:
- Organization sorting is O(n log n) but n is typically small (<10)
- Double index search only happens when record not in first index
- No additional database queries added

---

## Migration Notes

### Existing Deployments

No migration required! Changes are backward compatible:
- Old deletion code continues to work
- Single organization setups work exactly as before
- Only new behavior: better handling of edge cases

### Recommended Actions

1. **Review Multiple Organizations**: If you have multiple org records with same `webUrl`, verify the most recent one has correct admin keys
2. **Test Deletion**: Verify organization deletion works as expected
3. **Update Monitoring**: Watch logs for "Found X matching organizations" messages

---

## Future Enhancements

Potential improvements for future versions:

### Organization Version Management
- Add explicit version field to organizations
- Track organization history
- API to view all versions of an organization

### Deletion Webhooks
- Notify when organization is deleted
- Trigger cleanup actions automatically
- Archive deleted organization data

### Admin Key Rotation
- Automated admin key rotation
- Grace period for old keys
- Notification system for key changes

---

*Admin Analytics Updates - OIP v0.8.0+ - Updated 2025-12-08*

