# Exercise Bundle - Complete Workflow Feature Guide

## Overview

The **Exercise Bundle** feature is a comprehensive workflow in the Reference Client (`public/reference-client.html`) that allows users to publish a complete exercise record with all its dependencies in a single, streamlined process. It handles the complexity of creating and linking multiple OIP record types with automatic DID (Decentralized Identifier) passing.

## Feature Location

**File**: `/Users/devon/Documents/CODE-local/oip-arweave-indexer/public/reference-client.html`
**UI Access**: Publish Tab → Select Record Type: "Exercise Bundle - Complete Workflow"

## Architecture

### Record Types Involved

The Exercise Bundle creates and links these OIP record types:

1. **`image`** records (4 GIF resolutions: 180p, 360p, 720p, 1080p)
2. **`multiResolutionGif`** record (collection container for the 4 GIF images)
3. **`image`** records (optional equipment icons)
4. **`fitnessEquipment`** records (can be new or existing)
5. **`exercise`** record (top-level record that references everything)

### Data Flow

```
Exercise (top-level)
├── avatar → MultiResolutionGif DID
│   └── gif_media_refs → [Image DIDs x 4]
└── equipmentRequired → [FitnessEquipment DIDs]
    └── basic.avatar → Image DID (icon)
```

## Publishing Workflow

### Step-by-Step Process

1. **Exercise Details** (Basic Info)
   - Name, description, instructions, difficulty, category
   - Muscle groups (array), isBodyweight (boolean)
   - Recommended sets/reps or duration

2. **Demo GIF Collection**
   - Mode: "Create New" or "Select Existing"
   - If creating: Upload 4 GIF files (180p, 360p, 720p, 1080p)
   - Storage: GUN or Arweave
   - Access Level: Public, Private, or Organization

3. **Equipment Required**
   - Add multiple equipment items (+ Add Equipment button)
   - For each equipment item:
     - **Mode**: "Create New Equipment" or "Select Existing Equipment"
     - If creating new:
       - Equipment Details: Name, description, storage type
       - Equipment Icon: "Create New Icon", "Select Existing Icon", or "No Icon"

### Publishing Sequence

```javascript
publishExerciseBundle() {
    1. publishBundleGif()
       ├── Upload & publish 4 GIF images → 4 Image DIDs
       └── Create multiResolutionGif collection → GIF Collection DID
    
    2. processEquipmentItems()
       ├── For each equipment:
       │   ├── If mode='existing': Use selected DID
       │   └── If mode='create':
       │       ├── Handle icon (create/existing/none)
       │       └── Publish equipment with icon DID → Equipment DID
       └── Return array of Equipment DIDs
    
    3. publishBundleExercise(gifDID, equipmentDIDs)
       └── Publish exercise with all DIDs → Exercise DID
}
```

## Storage Options

### GUN Storage (Private/Organization)
- **Endpoint**: `/api/records/newRecord?recordType=<type>`
- **Authentication**: Required (JWT)
- **Payload Structure**:
```json
{
  "basic": { ... },
  "<recordType>": { ... },
  "storage": "gun",
  "accessControl": {
    "access_level": "public|private|organization",
    "shared_with": "did:arweave:<org_did>"  // if organization
  }
}
```

### Arweave Storage (Public/Permanent)
- **Endpoint**: `/api/records/newRecord?recordType=<type>`
- **Authentication**: Required (JWT)
- **Payload Structure**:
```json
{
  "basic": { ... },
  "<recordType>": { ... },
  "blockchain": "arweave"
}
```

## Critical Implementation Details

### DID Response Handling

**CRITICAL**: API responses differ between storage types:
- **GUN records**: Return `{ did: "did:gun:..." }` or `{ oip: { did: "..." } }`
- **Arweave records**: Return `{ didTx: "did:arweave:..." }` or `{ oip: { didTx: "..." } }`

**All publishing functions MUST check for both formats**:
```javascript
const did = result.did || result.didTx || result.oip?.did || result.oip?.didTx;
```

### Media File Publishing (Two-Step Process)

For image/GIF files:

**Step 1: Upload to get network addresses**
```javascript
// Upload file
POST /api/media/upload
Content-Type: multipart/form-data
Authorization: Bearer <jwt>

// Response:
{
  "mediaId": "abc123...",
  "httpUrl": "https://oip.example.com/media/abc123",
  "magnetURI": "magnet:?xt=urn:btih:...",
  "originalName": "file.gif",
  "size": 124389,
  "mime": "image/gif"
}
```

**Step 2: Create OIP image record**
```javascript
POST /api/records/newRecord?recordType=image
{
  "basic": {
    "name": "Image Name",
    "webUrl": uploadResult.httpUrl
  },
  "image": {
    "webUrl": uploadResult.httpUrl,
    "bittorrentAddress": uploadResult.magnetURI,
    "ipfsAddress": "",
    "arweaveAddress": "",
    "filename": uploadResult.originalName,
    "size": uploadResult.size,
    "contentType": uploadResult.mime,
    "width": 180,
    "height": 180
  },
  "storage": "gun" // or "blockchain": "arweave"
}
```

### Organization Dropdown Population

For records with "Organization" access level:

```javascript
// Fetch organizations
GET /api/organizations
Authorization: Bearer <jwt>

// Response structure:
{
  "organizationsInDB": [
    {
      "did": "did:arweave:6zmCRZ...",
      "name": "FitnessAlly",
      "orgHandle": "fitnessally8",
      ...
    }
  ]
}

// Display format: "orgHandle (name)"
// Value: did
```

### Existing Record Dropdowns

For "Select Existing" modes:

```javascript
// Equipment
GET /api/records?recordType=fitnessEquipment&noDuplicates=true
Authorization: Bearer <jwt>

// GIF Collections
GET /api/records?recordType=multiResolutionGif&noDuplicates=true
Authorization: Bearer <jwt>

// Icons
GET /api/records?recordType=image&noDuplicates=true&search=icon
Authorization: Bearer <jwt>

// Response:
{
  "records": [
    {
      "data": {
        "basic": { "name": "Record Name", ... }
      },
      "oip": {
        "did": "did:gun:..." // or didTx for Arweave
      }
    }
  ]
}

// Extract: record.oip?.did || record.oip?.didTx
```

**IMPORTANT**: Do NOT use `&source=gun` parameter - it causes filtering issues on the backend.

## Key Functions

### Main Entry Points

| Function | Purpose | Returns |
|----------|---------|---------|
| `createExerciseBundleInterface()` | Generates the HTML UI | HTML string |
| `initializeExerciseBundleInterface()` | Loads data, populates dropdowns | async void |
| `publishExerciseBundle()` | Main orchestrator | async void |

### Publishing Functions

| Function | Purpose | Returns |
|----------|---------|---------|
| `publishBundleGif()` | Creates multi-res GIF collection | GIF DID |
| `publishBundleIcon()` | Uploads & creates icon record | Icon DID |
| `publishBundleEquipment(iconDID)` | Creates equipment record | Equipment DID |
| `processEquipmentItems()` | Handles all equipment with modes | Equipment DIDs array |
| `publishBundleExercise(gifDID, equipmentDIDs)` | Creates exercise record | Exercise DID |

### Data Loading Functions

| Function | Purpose | Stores In |
|----------|---------|-----------|
| `loadOrganizationsForBundle()` | Fetches user's organizations | `bundleOrganizations` |
| `loadExistingEquipmentForBundle()` | Fetches existing equipment | `bundleExistingEquipment` |
| `loadExistingGifsForBundle()` | Fetches existing GIF collections | `bundleExistingGifs` |
| `loadExistingIconsForBundle()` | Fetches existing icons | `bundleExistingIcons` |

### Dropdown Population Functions

| Function | Purpose |
|----------|---------|
| `populateBundleOrgDropdown(selectElement)` | Populates organization dropdowns |
| `updateBundleEquipmentDropdowns()` | Populates equipment select dropdowns |
| `updateBundleGifDropdown()` | Populates GIF collection dropdown |
| `updateEquipIconDropdowns()` | Populates icon select dropdowns |

### AI & Copy Functions

| Function | Purpose |
|----------|---------|
| `copyBundleFromLatestExercise()` | Copies data from latest exercise |
| `fillBundleExerciseWithAI()` | AI-fills exercise fields |
| `copyEquipmentFromLatest(itemId)` | Copies from latest equipment |
| `fillEquipmentWithAI(itemId)` | AI-fills equipment description |

## UI Modes & Toggles

### Demo GIF Collection Modes
- **Create New**: Upload 4 GIF files
- **Select Existing**: Choose from dropdown of existing multiResolutionGif records

Function: `toggleBundleGifMode()`

### Equipment Modes
- **Create New Equipment**: Fill in details + icon
- **Select Existing Equipment**: Choose from dropdown

Function: `toggleEquipmentMode(itemId)`

### Equipment Icon Modes (when creating new equipment)
- **Create New Icon**: Upload icon file
- **Select Existing Icon**: Choose from dropdown
- **No Icon**: Skip icon creation

Function: `toggleEquipIconMode(itemId)`

**IMPORTANT**: When "Select Existing Equipment" is chosen, the icon section is hidden because the icon is already embedded in the equipment record.

## Data Structures

### Exercise Record Structure
```json
{
  "basic": {
    "name": "Exercise Name",
    "description": "Description",
    "language": "en",
    "avatar": "did:gun:...|did:arweave:..."  // GIF Collection DID
  },
  "exercise": {
    "instructions": ["Step 1", "Step 2"],
    "difficulty": "beginner|intermediate|advanced",
    "category": "strength|cardio|flexibility|balance",
    "exercise_type": "main|warmup|cooldown|stretch",
    "measurement_type": "reps|time",
    "isBodyweight": true|false,
    "muscleGroups": ["chest", "triceps", "shoulders"],
    "equipmentRequired": ["did:arweave:...", "did:arweave:..."],
    "recommended_sets": 3,
    "recommended_reps": 10
  },
  "blockchain": "arweave"  // or "storage": "gun"
}
```

### MultiResolutionGif Record Structure
```json
{
  "basic": {
    "name": "GIF Collection Name",
    "description": "Description",
    "language": "en",
    "date": 1759979088
  },
  "multiResolutionGif": {
    "gif_media_refs": [
      "did:gun:...180p",
      "did:gun:...360p", 
      "did:gun:...720p",
      "did:gun:...1080p"
    ],
    "frame_rate": 4,
    "duration_seconds": 3,
    "primary_resolution_index": 2,
    "loop_count": 0
  },
  "storage": "gun"  // or "blockchain": "arweave"
}
```

### FitnessEquipment Record Structure
```json
{
  "basic": {
    "name": "Equipment Name",
    "description": "Equipment description",
    "language": "en",
    "date": 1759969448,
    "avatar": "did:gun:...|did:arweave:..."  // Icon DID (optional)
  },
  "fitnessEquipment": {
    "category": "General",
    "subcategory": "Training Equipment"
  },
  "blockchain": "arweave"  // or "storage": "gun"
}
```

## Authentication

All bundle operations require JWT authentication:

```javascript
headers: {
  'Authorization': `Bearer ${authToken}`,
  'Content-Type': 'application/json'  // or multipart/form-data for uploads
}
```

The `authToken` is obtained from user login and stored globally.

## Error Handling Patterns

### Publishing Error Response
```javascript
try {
  const response = await fetch(url, options);
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Server returned ${response.status}: ${errorText}`);
  }
  
  const result = await response.json();
  
  // CRITICAL: Handle both GUN and Arweave formats
  const did = result.did || result.didTx || result.oip?.did || result.oip?.didTx;
  
  if (did) {
    console.log(`✅ Published successfully: ${did}`);
    return did;
  } else {
    console.error('❌ No DID in response:', result);
    throw new Error('Failed to publish - no DID in response');
  }
} catch (error) {
  console.error('Publishing error:', error);
  throw error;
}
```

## Progress Tracking

The bundle uses a progress system to keep users informed:

```javascript
updateBundleProgress(message, percentage) {
  // Updates progress bar and message
  // percentage: 0-100
}

// Usage:
updateBundleProgress('Publishing demo GIF collection...', 10);
updateBundleProgress('Processing equipment...', 50);
updateBundleProgress('✅ Exercise Bundle published successfully!', 100);
```

## Known Issues & Solutions

### Issue: GIF/Icon Dropdowns Not Populating
**Cause**: DOM elements not fully rendered when population functions are called.
**Solution**: Added 100ms `setTimeout` after `addBundleEquipmentItem()` in initialization.

### Issue: Equipment DIDs Not Appearing in Exercise Record
**Cause**: Only checking `result.did` instead of handling Arweave's `didTx` format.
**Solution**: Robust DID extraction in all publishing functions.

### Issue: Organization Dropdowns Not Populating
**Cause**: API response structure has `organizationsInDB` array, not direct `organizations`.
**Solution**: Updated `loadOrganizationsForBundle()` to parse correct structure.

### Issue: "Failed to publish" Errors When Actually Successful
**Cause**: Backend returns non-fatal template warnings that get caught as errors.
**Solution**: Changed error handling to specifically check for DID presence rather than relying on error-free responses.

### Issue: `source=gun` Query Parameter Filtering Out All Records
**Cause**: Backend API's `source` parameter doesn't correctly match records with `storage: 'gun'`.
**Solution**: Removed `&source=gun` from all API calls - let backend return all records of that type.

## AI Integration

The bundle includes AI-powered auto-fill functionality:

### Exercise AI Fill
```javascript
POST /api/voice/chat
{
  "messages": [
    {
      "role": "system",
      "content": "You are a fitness expert..."
    },
    {
      "role": "user", 
      "content": "Generate exercise details for: Barbell Bench Press"
    }
  ],
  "processing_mode": "llm-grok-4"  // IMPORTANT: For proper JSON
}
```

**Model**: Uses `grok-beta` with `processing_mode: 'llm-grok-4'` for reliable JSON responses.

## Testing Checklist

When testing the Exercise Bundle feature:

- [ ] Can create new exercise with new GIFs
- [ ] Can create new exercise with existing GIF collection
- [ ] Can add multiple equipment items
- [ ] Can create new equipment with new icon
- [ ] Can create new equipment with existing icon
- [ ] Can create new equipment with no icon
- [ ] Can select existing equipment
- [ ] Organization dropdowns populate correctly
- [ ] Equipment dropdowns populate correctly
- [ ] GIF collection dropdown populates correctly
- [ ] Icon dropdowns populate correctly
- [ ] Copy from Latest buttons work
- [ ] AI Fill buttons work
- [ ] Publishing to GUN succeeds
- [ ] Publishing to Arweave succeeds
- [ ] Exercise record contains correct avatar DID
- [ ] Exercise record contains correct equipmentRequired array
- [ ] Multi-res GIF contains all 4 resolution DIDs
- [ ] Equipment records contain correct icon DIDs
- [ ] Success message displays with final Exercise DID

## Related Documentation

Essential reading for understanding the Exercise Bundle:

1. **OIP_TECHNICAL_OVERVIEW.md** - Core OIP concepts (templates, records, drefs)
2. **API_PUBLISH_DOCUMENTATION.md** - Publishing API details
3. **OIP_GUN_SECURITY_AND_SYNC_ARCHITECTURE.md** - GUN storage & encryption
4. **Organizations.md** - Organization records & membership policies
5. **MEDIA_PUBLISHING.md** - Media file handling & network storage
6. **user_wallets_documentation.md** - Authentication & HD wallets
7. **API_RECORDS_ENDPOINT_DOCUMENTATION.md** - Records query API
8. **REFERENCE_CLIENT_GUIDE.md** - Reference client architecture

## Future Enhancements

Potential improvements for the Exercise Bundle:

1. **Bulk Import**: CSV/JSON import for multiple exercises
2. **Equipment Categories**: Better categorization system
3. **Video Support**: Add video demos alongside GIFs
4. **Exercise Variations**: Link related exercise variations
5. **Equipment Rental**: Integration with equipment rental services
6. **Workout Builder**: Auto-generate workouts using published exercises
7. **Progress Tracking**: Track user performance on exercises
8. **Social Features**: Share exercises, rate difficulty, leave comments

## Troubleshooting

### Common Issues

**Dropdown shows "Loading..." forever**
- Check browser console for API errors
- Verify JWT token is valid (not expired)
- Check network tab for failed requests

**"Failed to publish" error**
- Check browser console for actual error
- Verify all required fields are filled
- Check that selected files are valid images/GIFs
- Verify organization is selected (if using Organization access)

**Exercise published but missing avatar or equipment**
- Check browser console logs for DID extraction
- Verify GIF/equipment published successfully
- Check the published exercise record in Elasticsearch

**AI Fill not working**
- Check that exercise name is filled in
- Verify AI endpoint is accessible
- Check browser console for API response

## Code Style & Conventions

When modifying the Exercise Bundle code:

1. **Console Logging**: Use emoji prefixes for visual scanning
   - 🎯 Initialization
   - 📋 Data loading
   - ✅ Success operations
   - ❌ Errors
   - 🔧 Processing/debugging
   - 📤 API requests
   - 📥 API responses

2. **Function Naming**: Use descriptive prefixes
   - `publishBundle*` - Publishing operations
   - `updateBundle*` - UI updates
   - `loadBundle*` - Data fetching
   - `toggleBundle*` - Mode switching
   - `processBundle*` - Data processing

3. **Error Messages**: Be specific and actionable
   - ✅ "Failed to publish icon - no DID in response"
   - ❌ "Error publishing"

4. **Async/Await**: Always use try-catch blocks
   - Log errors with context
   - Rethrow to allow upstream handling
   - Show user-friendly messages

## Summary

The Exercise Bundle is a complex, multi-record publishing workflow that demonstrates:
- Sequential publishing with DID passing
- Dynamic UI generation and management
- Dual storage support (GUN + Arweave)
- Organization-based access control
- Media file handling
- AI integration
- Robust error handling

It serves as a reference implementation for building similar complex workflows in the OIP ecosystem.

