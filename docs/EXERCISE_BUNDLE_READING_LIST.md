# Exercise Bundle Feature - AI Agent Reading List

## Required Reading (in order)

1. **OIP_TECHNICAL_OVERVIEW.md** (lines 1-200)
   - Understand templates, records, and drefs
   - How DIDs work (did:arweave: vs did:gun:)
   - The dref system for linking records

2. **API_PUBLISH_DOCUMENTATION.md** (lines 1-150)
   - Publishing to GUN vs Arweave
   - JWT authentication requirements
   - Request/response structures

3. **OIP_GUN_SECURITY_AND_SYNC_ARCHITECTURE.md** (lines 1-200)
   - Organization encryption (using org DID)
   - Access levels (public, private, organization)
   - Why authenticated API calls are needed for GUN records

4. **Organizations.md** (lines 1-150)
   - How to fetch organizations from `/api/organizations`
   - Organization structure (did, name, orgHandle)
   - Membership policies

5. **MEDIA_PUBLISHING.md** (lines 1-150)
   - Two-step media upload process
   - `/api/media/upload` → get network addresses
   - Then create image record with those addresses

## Essential Knowledge Summary

### What the Exercise Bundle Does
Publishes a complete exercise record with all dependencies in one workflow:
- **Exercise** (top-level) → references GIF collection and equipment
- **Multi-Resolution GIF** (4 resolutions: 180p, 360p, 720p, 1080p)
- **Fitness Equipment** (0 to many, can create new or select existing)
- **Equipment Icons** (optional images for equipment)

### Publishing Sequence
```
1. publishBundleGif() → returns GIF Collection DID
2. processEquipmentItems() → returns array of Equipment DIDs
3. publishBundleExercise(gifDID, equipmentDIDs) → returns Exercise DID
```

### Critical Implementation Details

**1. DID Extraction (MOST IMPORTANT)**
```javascript
// ALWAYS check for both formats:
const did = result.did || result.didTx || result.oip?.did || result.oip?.didTx;

// GUN returns: { did: "did:gun:..." } or { oip: { did: "..." } }
// Arweave returns: { didTx: "did:arweave:..." } or { oip: { didTx: "..." } }
```

**2. Media Upload Process**
```javascript
// Step 1: Upload file to get network addresses
POST /api/media/upload (multipart/form-data)
→ returns: { httpUrl, magnetURI, originalName, size, mime }

// Step 2: Create image record
POST /api/records/newRecord?recordType=image
{
  "image": {
    "webUrl": httpUrl,
    "bittorrentAddress": magnetURI,
    "filename": originalName,
    "size": size,
    "contentType": mime
  }
}
```

**3. API Endpoints**
- Records: `POST /api/records/newRecord?recordType=<type>`
- Media upload: `POST /api/media/upload`
- Organizations: `GET /api/organizations`
- Existing records: `GET /api/records?recordType=<type>&noDuplicates=true`

**4. Storage Configuration**
```javascript
// GUN (private/organization):
{
  "storage": "gun",
  "accessControl": {
    "access_level": "public|private|organization",
    "shared_with": "did:arweave:org_did"  // if organization
  }
}

// Arweave (public/permanent):
{
  "blockchain": "arweave"
}
```

**5. Organization Dropdown**
```javascript
// Fetch: GET /api/organizations
// Response: { organizationsInDB: [{ did, name, orgHandle }] }
// Display: "orgHandle (name)"
// Value: did
```

**6. Existing Record Dropdowns**
```javascript
// Equipment: GET /api/records?recordType=fitnessEquipment&noDuplicates=true
// GIFs: GET /api/records?recordType=multiResolutionGif&noDuplicates=true
// Icons: GET /api/records?recordType=image&noDuplicates=true&search=icon

// IMPORTANT: Do NOT use &source=gun (causes backend filtering issues)

// Extract: record.oip?.did || record.oip?.didTx
// Name: record.data?.basic?.name
```

### Key Functions (in reference-client.html)

**Main Flow:**
- `publishExerciseBundle()` - orchestrates everything
- `publishBundleGif()` - creates GIF collection (or returns existing DID)
- `processEquipmentItems()` - handles all equipment (new/existing)
- `publishBundleExercise(gifDID, equipmentDIDs)` - final exercise record

**Data Loading:**
- `loadOrganizationsForBundle()` - fetches user's orgs
- `loadExistingEquipmentForBundle()` - fetches equipment list
- `loadExistingGifsForBundle()` - fetches GIF collections
- `loadExistingIconsForBundle()` - fetches icons

**UI Updates:**
- `updateBundleEquipmentDropdowns()` - populates equipment selects
- `updateBundleGifDropdown()` - populates GIF select
- `updateEquipIconDropdowns()` - populates icon selects
- `toggleEquipmentMode(itemId)` - switches create/existing modes
- `toggleEquipIconMode(itemId)` - switches icon modes

### Recent Fixes Applied

1. **DID Extraction**: All publishing functions now handle both GUN (did) and Arweave (didTx) formats
2. **Media Publishing**: Switched to two-step process (upload → create record)
3. **Organization Dropdowns**: Parse `organizationsInDB` array correctly
4. **Existing Record Dropdowns**: Removed `&source=gun` parameter
5. **Icon Section Hiding**: When selecting existing equipment, icon section hides (icon is embedded in equipment)

### Common Issues

**Dropdowns not populating?**
- Check JWT token is valid
- Look for API errors in console
- Verify 100ms setTimeout after DOM rendering

**"Failed to publish" but record exists?**
- Check DID extraction logic
- Backend may return non-fatal warnings
- Look for the actual DID in response

**equipmentRequired array missing?**
- Verify `processEquipmentItems()` returns array
- Check DIDs are being extracted correctly
- Look for console logs tracking DID flow

## File Location
`/Users/devon/Documents/CODE-local/oip-arweave-indexer/public/reference-client.html`

All Exercise Bundle code is in this single file (lines ~15900-18200).

