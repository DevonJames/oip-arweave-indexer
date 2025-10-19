# Verbose Logging Cleanup

## Issue
Console logging was filling up memory due to high-frequency log messages during normal operations.

## Logs Removed (Commented Out)

### 1. Organization Record Filtering Logs
**Files:** `helpers/elasticsearch.js`, `helpers/organizationEncryption.js`

These logs were triggered on every GET request for organization records:

```javascript
// helpers/elasticsearch.js (line 2724)
// console.log('Excluding organization record (not member):', record.oip?.did, 'user:', userPubKey.slice(0, 12));

// helpers/elasticsearch.js (line 2708)
// console.log('Excluding organization record (no shared_with):', record.oip?.did);

// helpers/organizationEncryption.js (line 103)
// console.warn(`⚠️ Unknown membership policy: ${membershipPolicy} for ${organizationDid}`);
```

**Reason:** These logs fire on every single organization record access check, which can happen hundreds or thousands of times per minute when users browse organization content.

### 2. GUN Database Operation Logs
**Files:** `helpers/gun.js`, `helpers/oipGunRegistry.js`

These logs were triggered on every GUN database read/write operation:

```javascript
// helpers/gun.js (line 342)
// console.log('✅ GUN record retrieved successfully via HTTP API');

// helpers/gun.js (line 174)
// console.log('📡 Sending HTTP PUT request to GUN API...');

// helpers/oipGunRegistry.js (line 46)
// console.log(`📝 Registering OIP record in GUN registry: ${recordDid}`);

// helpers/oipGunRegistry.js (line 71)
// console.log('✅ Registered OIP record in GUN registry:', recordDid);
```

**Reason:** GUN operations are extremely frequent (every record publish, every record retrieval), and these success messages were creating excessive noise and memory consumption.

## Impact

### Before Cleanup:
- ❌ Excessive console output filling logs
- ❌ Memory consumption from log string concatenation
- ❌ Difficult to find important error messages
- ❌ Logs filled with repetitive success messages

### After Cleanup:
- ✅ Cleaner log output focused on errors and important events
- ✅ Reduced memory footprint
- ✅ Easier to identify actual issues
- ✅ Retained the code (commented) for debugging purposes

## Kept Active Logs

The following important logs were **kept active** for operational monitoring:

- ✅ Error messages (all `console.error`)
- ✅ Warnings about actual issues (not routine operations)
- ✅ `keepDBUpToDate` cycle progress and transaction processing
- ✅ Record status transitions (pending → original)
- ✅ Server startup and initialization messages
- ✅ Memory monitor warnings

## Re-enabling for Debugging

If you need to debug these specific operations, you can temporarily uncomment the relevant logs:

```bash
# Find all commented verbose logs
grep -r "// console.log.*GUN" helpers/
grep -r "// console.log.*organization record" helpers/
```

## Files Modified

1. `helpers/elasticsearch.js` - 2 organization filtering logs
2. `helpers/organizationEncryption.js` - 1 membership policy log
3. `helpers/gun.js` - 2 GUN operation logs
4. `helpers/oipGunRegistry.js` - 2 registry operation logs

**Total:** 7 high-frequency log statements commented out

## Date
October 19, 2025

