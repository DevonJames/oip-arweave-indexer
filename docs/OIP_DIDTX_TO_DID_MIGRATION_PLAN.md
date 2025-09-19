# OIP.didTx to OIP.did Migration Plan

## Overview

This document outlines the comprehensive plan to migrate from `oip.didTx` to `oip.did` throughout the entire OIP Arweave Indexer application. This migration is necessary to maximize compatibility with newly implemented GUN records and create a unified DID system.

## Current State Analysis

### Files Affected (18 total)

1. **Core System Files:**
   - `helpers/elasticsearch.js` - Primary indexing and search logic
   - `helpers/templateHelper.js` - Record publishing and template handling
   - `helpers/utils.js` - Utility functions for record resolution
   - `routes/records.js` - Records API endpoint
   - `routes/templates.js` - Templates API endpoint
   - `routes/cleanup.js` - Template cleanup system

2. **Publishing & Processing Files:**
   - `routes/publish.js` - Record publishing endpoints
   - `routes/scrape.js` - Web scraping and content publishing
   - `routes/scrape_old.js` - Legacy scraping functions
   - `routes/workout.js` - Workout-specific record handling
   - `routes/jfk.js` - JFK-specific record handling

3. **Frontend & Documentation:**
   - `public/reference-client.html` - Frontend reference client
   - `docs/TEMPLATE_CLEANUP_GUIDE.md` - Documentation
   - `docs/GUN_DEPLOYMENT_GUIDE.md` - GUN deployment docs
   - `docs/toBuild/*.md` - Various documentation files

4. **Legacy & Migration Files:**
   - `helpers/elasticsearch_fromOldServer.js` - Legacy functions
   - `helpers/dref-resolver.js` - DID reference resolver
   - `config/migrateGunSupport.js` - GUN migration support

## Migration Strategy

### Phase 1: Core Infrastructure Updates

#### 1.1 Primary Record Creation (`helpers/elasticsearch.js`)
**Current:**
```javascript
record = {
    data: combinedRecords,
    oip: {
        didTx: 'did:arweave:' + transaction.transactionId,
        // ...
    }
};
```

**Target:**
```javascript
record = {
    data: combinedRecords,
    oip: {
        did: 'did:arweave:' + transaction.transactionId,
        didTx: 'did:arweave:' + transaction.transactionId, // Backward compatibility
        // ...
    }
};
```

#### 1.2 Record Indexing Logic (`helpers/elasticsearch.js`)
**Current:**
```javascript
const recordId = record.oip.did || record.oip.didTx;
```

**Target:**
```javascript
const recordId = record.oip.did || record.oip.didTx; // Keep for backward compatibility
```

#### 1.3 Search and Query Functions
**Update all Elasticsearch queries:**
- Change `"oip.didTx"` to `"oip.did"` in primary queries
- Add fallback queries for `"oip.didTx"` for backward compatibility

### Phase 2: Template System Updates

#### 2.1 Template Creation (`helpers/elasticsearch.js`)
**Current:**
```javascript
oip: {
    didTx: 'did:arweave:' + transaction.transactionId,
    // ...
}
```

**Target:**
```javascript
oip: {
    did: 'did:arweave:' + transaction.transactionId,
    didTx: 'did:arweave:' + transaction.transactionId, // Backward compatibility
    // ...
}
```

#### 2.2 Template Cleanup System (`routes/cleanup.js`)
**Update references:**
- `template.oip.didTx` → `template.oip.did || template.oip.didTx`

### Phase 3: Publishing System Updates

#### 3.1 Record Publishing (`helpers/templateHelper.js`)
**Update GUN publishing:**
```javascript
gunRecordData.oip.did = publishResult.did;
gunRecordData.oip.didTx = publishResult.did; // For backward compatibility
```

**Target:**
```javascript
gunRecordData.oip.did = publishResult.did; // Primary field
gunRecordData.oip.didTx = publishResult.did; // Keep for compatibility
```

#### 3.2 Sub-record Publishing
**Update all `didTxRefs` handling to use `oip.did`**

### Phase 4: API Endpoints Updates

#### 4.1 Records API (`routes/records.js`)
**Add backward compatibility:**
```javascript
// Normalize DID parameter (backward compatibility)
if (queryParams.didTx && !queryParams.did) {
    queryParams.did = queryParams.didTx;
}
```

#### 4.2 Templates API (`routes/templates.js`)
**Update filtering logic:**
```javascript
// Current
templates = templates.filter(template => template.oip.didTx === didTx);

// Target
templates = templates.filter(template => 
    (template.oip.did || template.oip.didTx) === didTx
);
```

### Phase 5: Frontend Updates

#### 5.1 Reference Client (`public/reference-client.html`)
**Update all DID handling:**
- Record routing and navigation
- Record display and formatting
- Search and filtering
- Record structure display

### Phase 6: Utility Functions Updates

#### 6.1 Record Resolution (`helpers/utils.js`)
**Update DID reference resolution:**
```javascript
// Current
const refRecord = recordsInDB.find(record => record.oip.didTx === properties[key]);

// Target
const refRecord = recordsInDB.find(record => 
    (record.oip.did || record.oip.didTx) === properties[key]
);
```

#### 6.2 DID Reference Resolver (`helpers/dref-resolver.js`)
**Update all DID matching logic**

### Phase 7: Creator and Organization Systems

#### 7.1 Creator Registration
**Update creator record structure to use `oip.did`**

#### 7.2 Organization Registration
**Update organization record structure to use `oip.did`**

## Implementation Details

### Backward Compatibility Strategy

1. **Dual Field Approach:**
   - Set both `oip.did` and `oip.didTx` during creation
   - Search both fields during queries
   - Prefer `oip.did` but fallback to `oip.didTx`

2. **Query Updates:**
```javascript
// Before
{ match: { "oip.didTx": targetDid } }

// After
{
    bool: {
        should: [
            { match: { "oip.did": targetDid } },
            { match: { "oip.didTx": targetDid } }
        ]
    }
}
```

3. **Record ID Logic:**
```javascript
const recordId = record.oip.did || record.oip.didTx;
```

### Critical Functions to Update

#### High Priority (Core Functionality)
1. `processNewRecord()` - Record creation
2. `processNewTemplate()` - Template creation
3. `indexRecord()` - Record indexing
4. `deleteRecordFromDB()` - Record deletion
5. `deleteTemplateFromDB()` - Template deletion
6. `checkTemplateUsage()` - Template usage checking

#### Medium Priority (API Endpoints)
1. `getRecords()` - Records retrieval
2. `getTemplates()` - Templates retrieval
3. `searchRecordInDB()` - Record searching
4. `resolveRecords()` - Record resolution

#### Lower Priority (Frontend & Docs)
1. Reference client display logic
2. Documentation examples
3. Legacy migration scripts

## Implementation Steps

### Step 1: Core Record Creation
```javascript
// In processNewRecord() function
record = {
    data: combinedRecords,
    oip: {
        recordType: recordType,
        recordStatus: "original",
        did: 'did:arweave:' + transaction.transactionId,        // NEW PRIMARY
        didTx: 'did:arweave:' + transaction.transactionId,      // BACKWARD COMPATIBILITY
        inArweaveBlock: inArweaveBlock,
        // ... rest of fields
    }
};
```

### Step 2: Core Template Creation
```javascript
// In processNewTemplate() function
const oip = {
    did: 'did:arweave:' + transaction.transactionId,           // NEW PRIMARY
    didTx: 'did:arweave:' + transaction.transactionId,         // BACKWARD COMPATIBILITY
    recordType: 'template',
    // ... rest of fields
};
```

### Step 3: Update All Search Queries
```javascript
// Helper function for backward-compatible queries
function createDIDQuery(targetDid) {
    return {
        bool: {
            should: [
                { match: { "oip.did": targetDid } },
                { match: { "oip.didTx": targetDid } }
            ]
        }
    };
}
```

### Step 4: Update Record ID Logic
```javascript
// Standardize record ID extraction
function getRecordId(record) {
    return record.oip.did || record.oip.didTx;
}
```

### Step 5: Update Frontend Display
```javascript
// In reference client
function getRecordDID(record) {
    return record.oip?.did || record.oip?.didTx;
}
```

## Testing Strategy

### 1. Backward Compatibility Tests
- Ensure old records with only `oip.didTx` still work
- Verify new records with `oip.did` work correctly
- Test mixed environments

### 2. Functionality Tests
- Record creation and indexing
- Record retrieval and filtering
- Template operations
- Delete operations
- Search functionality

### 3. API Endpoint Tests
- `/api/records` with various DID formats
- `/api/templates` with DID filtering
- Publishing endpoints
- Cleanup endpoints

## Rollback Plan

### If Issues Arise:
1. **Immediate:** Revert core record creation to only use `oip.didTx`
2. **Search:** Keep dual-field search logic for compatibility
3. **Frontend:** Update display logic to handle both fields
4. **Gradual:** Implement migration in phases rather than all at once

## Risk Assessment

### High Risk Areas:
1. **Record Deletion:** Must work with both DID formats
2. **Template Cleanup:** Critical for field limit management
3. **Search Functionality:** Core user experience
4. **GUN Integration:** New functionality depends on this

### Mitigation Strategies:
1. **Extensive Testing:** Test each component individually
2. **Gradual Deployment:** Implement in phases
3. **Monitoring:** Watch for errors during migration
4. **Fallback Logic:** Always include backward compatibility

## Success Criteria

### Primary Goals:
1. ✅ All new records use `oip.did` as primary identifier
2. ✅ All old records continue to work via `oip.didTx`
3. ✅ Search and filtering work with both formats
4. ✅ GUN integration works seamlessly
5. ✅ Template cleanup system works correctly

### Secondary Goals:
1. ✅ Frontend displays DIDs consistently
2. ✅ API responses include both fields during transition
3. ✅ Documentation reflects new structure
4. ✅ Performance remains stable

## Implementation Timeline

### Phase 1 (Critical): Core System (Day 1)
- Update record and template creation
- Update indexing logic
- Update search queries

### Phase 2 (Important): APIs (Day 1-2)
- Update all route handlers
- Update publishing logic
- Update cleanup system

### Phase 3 (Supporting): Frontend & Utils (Day 2-3)
- Update reference client
- Update utility functions
- Update documentation

### Phase 4 (Final): Testing & Cleanup (Day 3-4)
- Comprehensive testing
- Performance validation
- Documentation updates

---

## Notes

- **Backward Compatibility:** Essential for existing data
- **GUN Integration:** Primary driver for this migration
- **Field Limits:** Template cleanup must continue working
- **Performance:** Monitor query performance with dual-field searches
- **Data Integrity:** Ensure no data loss during migration

This migration will enable seamless integration between Arweave and GUN storage systems while maintaining full backward compatibility with existing records and templates.
