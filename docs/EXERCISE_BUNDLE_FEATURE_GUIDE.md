# Exercise Bundle - Technical Reference

## What It Does
Single workflow to publish an exercise with all dependencies: multi-resolution GIF demos, equipment (with icons).

## Record Flow
```
Exercise
├── basic.avatar → multiResolutionGif DID
│   └── gif_media_refs → [4 image DIDs]
└── exercise.equipmentRequired → [fitnessEquipment DIDs]
    └── basic.avatar → image DID (icon)
```

## Publishing Functions

```javascript
publishExerciseBundle() {
    const gifDID = await publishBundleGif();
    const equipmentDIDs = await processEquipmentItems();
    const exerciseDID = await publishBundleExercise(gifDID, equipmentDIDs);
}
```

## Critical Pattern: DID Extraction
```javascript
// ALWAYS use this pattern in all publishing functions:
const did = result.did || result.didTx || result.oip?.did || result.oip?.didTx;

if (did) {
    return did;
} else {
    throw new Error('No DID in response');
}
```

## Media Upload (Two Steps)
```javascript
// 1. Upload file
const formData = new FormData();
formData.append('file', file);
const uploadRes = await fetch('/api/media/upload', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
});
const upload = await uploadRes.json();

// 2. Create image record
const recordRes = await fetch('/api/records/newRecord?recordType=image', {
    method: 'POST',
    headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        basic: { name: "Icon Name", webUrl: upload.httpUrl },
        image: {
            webUrl: upload.httpUrl,
            bittorrentAddress: upload.magnetURI,
            filename: upload.originalName,
            size: upload.size,
            contentType: upload.mime
        },
        storage: "gun" // or blockchain: "arweave"
    })
});
const record = await recordRes.json();
const imageDID = record.did || record.didTx || record.oip?.did || record.oip?.didTx;
```

## Storage Types

**GUN (Private/Organization):**
```json
{
  "storage": "gun",
  "accessControl": {
    "access_level": "organization",
    "shared_with": "did:arweave:org_did"
  }
}
```

**Arweave (Public):**
```json
{
  "blockchain": "arweave"
}
```

## Data Structures

**Exercise Record:**
```json
{
  "basic": {
    "name": "Barbell Bench Press",
    "avatar": "did:gun:..."  // GIF collection DID
  },
  "exercise": {
    "instructions": ["Step 1", "Step 2"],
    "difficulty": "intermediate",
    "muscleGroups": ["chest", "triceps"],
    "equipmentRequired": ["did:arweave:...", "did:arweave:..."],
    "isBodyweight": false
  },
  "blockchain": "arweave"
}
```

**MultiResolutionGif:**
```json
{
  "multiResolutionGif": {
    "gif_media_refs": [
      "did:gun:...180p",
      "did:gun:...360p",
      "did:gun:...720p",
      "did:gun:...1080p"
    ]
  }
}
```

**FitnessEquipment:**
```json
{
  "basic": {
    "name": "Barbell",
    "avatar": "did:gun:..."  // Icon DID (optional)
  },
  "fitnessEquipment": {
    "category": "General"
  }
}
```

## API Endpoints

| Endpoint | Purpose | Auth Required |
|----------|---------|---------------|
| `POST /api/records/newRecord?recordType=<type>` | Create any record | Yes |
| `POST /api/media/upload` | Upload media file | Yes |
| `GET /api/organizations` | Get user's orgs | Yes |
| `GET /api/records?recordType=<type>&noDuplicates=true` | List existing records | Yes |

## UI Modes

**GIF Collection:**
- Create New (upload 4 files)
- Select Existing (dropdown)

**Equipment:**
- Create New (fill details + icon)
- Select Existing (dropdown, hides icon section)

**Equipment Icon (when creating new equipment):**
- Create New (upload file)
- Select Existing (dropdown)
- No Icon

## Known Issues Fixed

1. ✅ DID extraction handles both GUN and Arweave formats
2. ✅ Media uses two-step upload process
3. ✅ Organization dropdown parses `organizationsInDB` array
4. ✅ Removed `&source=gun` from API calls (caused filtering issues)
5. ✅ Icon section hides when selecting existing equipment

## Troubleshooting

**Dropdown empty?**
- Check console for API errors
- Verify JWT token valid
- Check `result.records` array in response

**"Failed to publish" but record exists?**
- Check DID extraction in console logs
- Backend may return non-fatal warnings

**Missing equipmentRequired array?**
- Verify `processEquipmentItems()` returns array of DIDs
- Check console logs for DID tracking

## File Location
`public/reference-client.html` (lines ~15900-18200)
