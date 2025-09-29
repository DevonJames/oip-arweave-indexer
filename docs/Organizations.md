# OIP Organizations Documentation

## Overview

Organizations in the OIP (Open Index Protocol) system are special records that represent entities, companies, groups, or communities. They have unique features including automatic handle generation, membership policies, and dual-index storage for both public access and specialized organization management.

## Organization Record Structure

### Template Information

**Template Name**: `organization`  
**Template Transaction ID**: `NQi19GjOw-Iv8PzjZ5P-XcFkAYu50cl5V_qceT2xlGM`  
**Record Type**: `organization`

### Field Structure

Organizations consist of two main sections:

#### Basic Section (shared with all records)
```json
{
  "basic": {
    "name": "Organization Name",
    "description": "Organization description",
    "date": 1759026867,
    "language": "en",
    "tagItems": ["fitness", "health", "ai"]
  }
}
```

#### Organization Section (organization-specific)
```json
{
  "organization": {
    "org_handle": "fitnessally",                    // User input handle
    "org_public_key": "034d41b0c8bdbf3ad65e55...",  // Organization's public key
    "admin_public_keys": ["034d41b0c8bdbf3ad65..."], // Array of admin public keys
    "membership_policy": "Auto-Enroll App Users",    // Enum: membership policy
    "metadata": "Additional organization metadata"   // Optional metadata
  }
}
```

## Unique Handle Generation System

### How Organization Handles Work

Organizations use a unique handle generation system to prevent conflicts:

1. **User Input**: User provides `org_handle` (e.g., `"fitnessally"`)
2. **Transaction ID Conversion**: System converts transaction ID to decimal number
3. **Uniqueness Check**: System checks existing organizations for handle conflicts
4. **Number Appending**: Appends digits from transaction ID until unique handle found
5. **Final Handle**: Results in unique handle (e.g., `"fitnessally8"`)

### Handle Generation Process

```javascript
// Example process for transaction ID: 6zmCRZ06E2XtvN84BEQE_g4laBJdoCzTfQURHD2YlC4
const txId = "6zmCRZ06E2XtvN84BEQE_g4laBJdoCzTfQURHD2YlC4";
const userHandle = "fitnessally";
const decimalNumber = parseInt(txId.replace(/[^0-9a-fA-F]/g, ''), 16);
// Result: 8.162281327923245e+24

// Start with 1 digit: "fitnessally8"
// Check if "fitnessally8" exists
// If not exists: Final handle = "fitnessally8"
// If exists: Try "fitnessally81", then "fitnessally816", etc.
```

### Handle Fields in Final Record

Organizations store both the original input and the generated unique handle:

```json
{
  "data": {
    "orgHandle": "fitnessally8",    // ✅ Unique generated handle
    "org_handle": "fitnessally",    // ✅ Original user input (preserved)
    // ... other fields
  }
}
```

## Membership Policy System

### Available Membership Policies

The `membership_policy` field is an enum with four options:

| Index | Code | Display Name | Description |
|-------|------|-------------|-------------|
| 0 | `invite-only` | "Invite Only" | Members must be explicitly invited |
| 1 | `app-user-auto` | "Auto-Enroll App Users" | Users from organization's domain auto-join |
| 2 | `token-gated` | "Token-Gated Membership" | Requires specific tokens/NFTs |
| 3 | `open-join` | "Open Join" | Anyone can join freely |

### Publishing Format

When publishing, you can use either the code or display name:

```json
{
  "organization": {
    "membership_policy": "Auto-Enroll App Users"  // Display name
  }
}
```

```json
{
  "organization": {
    "membership_policy": "app-user-auto"  // Code
  }
}
```

Both formats are automatically converted to the appropriate enum index during publishing.

### Membership Policy Implementation

#### Auto-Enroll App Users (Index 1)
- **Behavior**: Users accessing from the organization's domain are automatically considered members
- **Implementation**: Checks request headers for domain matching
- **Use Case**: Company employees accessing from company domain

#### Invite Only (Index 0)
- **Behavior**: Only explicitly invited users can access organization records
- **Implementation**: Maintains invitation lists (future feature)
- **Use Case**: Private organizations with controlled access

#### Token-Gated Membership (Index 2)
- **Behavior**: Users must own specific tokens/NFTs to access
- **Implementation**: Token ownership verification (future feature)
- **Use Case**: DAO membership, NFT communities

#### Open Join (Index 3)
- **Behavior**: Anyone can access organization records
- **Implementation**: No restrictions applied
- **Use Case**: Public organizations, open communities

## Publishing Organizations

### API Endpoints

#### Primary Publishing Endpoint
**Endpoint**: `POST /api/organizations/newOrganization`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>  # Optional but recommended
```

**Request Body**:
```json
{
  "basic": {
    "name": "FitnessAlly",
    "description": "AI-powered fitness and nutrition platform...",
    "date": 1759026867,
    "language": "en",
    "tagItems": ["fitness", "ai", "health"]
  },
  "organization": {
    "org_handle": "fitnessally",
    "org_public_key": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
    "admin_public_keys": ["034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d"],
    "membership_policy": "Auto-Enroll App Users",
    "metadata": "Additional organization information"
  },
  "blockchain": "arweave"
}
```

**Response**:
```json
{
  "transactionId": "6zmCRZ06E2XtvN84BEQE_g4laBJdoCzTfQURHD2YlC4",
  "recordToIndex": {
    "data": { /* organization data with generated orgHandle */ },
    "oip": {
      "recordType": "organization",
      "didTx": "did:arweave:6zmCRZ06E2XtvN84BEQE_g4laBJdoCzTfQURHD2YlC4",
      "creator": { /* creator information */ }
    }
  },
  "blockchain": "arweave"
}
```

#### Alternative Publishing Endpoint
**Endpoint**: `POST /api/records/newRecord?recordType=organization`

Same request/response format as above.

### Publishing Process Flow

1. **Template Processing**: Organization data is compressed using the organization template
2. **Handle Generation**: `convertToOrgHandle()` creates unique handle from transaction ID
3. **Enum Expansion**: `membership_policy` enum values are expanded to display names
4. **Creator Lookup**: System finds creator information for the publishing address
5. **Dual Indexing**: Record is indexed to both `records` and `organizations` indices
6. **Blockchain Storage**: Compressed data is published to Arweave with OIP tags

## Data Storage and Indexing

### Dual Index System

Organizations are stored in **two separate Elasticsearch indices**:

#### 1. Records Index (`records`)
- **Purpose**: General record queries and search
- **Access**: Via `/api/records?recordType=organization`
- **Features**: Full OIP query capabilities, filtering, search
- **Structure**: Standard OIP record format

#### 2. Organizations Index (`organizations`) 
- **Purpose**: Organization-specific queries and management
- **Access**: Via `/api/organizations`
- **Features**: Organization-focused endpoints and operations
- **Structure**: Enhanced organization format with processed fields

### Index Processing Differences

#### Immediate Publishing (API calls)
1. User publishes via `/api/organizations/newOrganization`
2. `publishNewRecord` detects `recordType === 'organization'`
3. Performs immediate organization processing:
   - Calls `convertToOrgHandle()` for unique handle
   - Expands enum values using organization template
   - Indexes to both `records` and `organizations` indices
4. Publishes to blockchain

#### Blockchain Sync (other nodes)
1. Node discovers organization via `keepDBUpToDate`
2. `processNewRecord` detects `recordType === 'organization'`
3. Calls `indexNewOrganizationRegistration` with same processing:
   - Handle generation, enum expansion, dual indexing
4. Ensures consistency across all OIP nodes

## Retrieving Organizations

### Organizations Endpoint

**Endpoint**: `GET /api/organizations`

**Response**:
```json
{
  "qtyOrganizationsInDB": 2,
  "maxArweaveOrgBlockInDB": 1762717,
  "organizationsInDB": [
    {
      "data": {
        "orgHandle": "fitnessally8",                    // ✅ Unique generated handle
        "name": "FitnessAlly",
        "description": "AI-powered fitness platform...",
        "date": 1759026867,
        "language": 37,
        "nsfw": false,
        "webUrl": "fitnessally.io",
        "orgPublicKey": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
        "adminPublicKeys": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
        "membershipPolicy": "Auto-Enroll App Users",    // ✅ Expanded enum value
        "metadata": null
      },
      "oip": {
        "recordType": "organization",
        "did": "did:arweave:6zmCRZ06E2XtvN84BEQE_g4laBJdoCzTfQURHD2YlC4",
        "didTx": "did:arweave:6zmCRZ06E2XtvN84BEQE_g4laBJdoCzTfQURHD2YlC4",
        "inArweaveBlock": 1762717,
        "indexedAt": "2025-09-28T03:32:51.234Z",
        "ver": "0.8.0",
        "signature": "A6WagVkb7rSw8X/KbdS/JdXO7waKMfJcvyx7nz76jm0...",
        "organization": {
          "orgHandle": "fitnessally8",
          "orgPublicKey": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
          "adminPublicKeys": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
          "membershipPolicy": "Auto-Enroll App Users",
          "metadata": null
        },
        "creator": {                                    // ✅ Creator object included
          "creatorHandle": "Librarian7",
          "didAddress": "did:arweave:u4B6d5ddggsotOiG86D-KPkeW23qQNdqaXo_ZcdI3k0",
          "didTx": "did:arweave:T6EQ_RLaAvUpCjeWkx6BYmQl57rkF_YHr9QH97_eG7Q",
          "publicKey": "v2LPUKrpSnmzQzPr7Cfjb_vh9FD6GbRXQNqUk9miFmiWA6PtKj6gvOCiQXpr5o9u4..."
        }
      }
    }
  ]
}
```

### Records Endpoint (Alternative Access)

**Endpoint**: `GET /api/records?recordType=organization`

Returns organizations in standard OIP records format with full query capabilities:
- Filtering by tags, creator, date ranges
- Full-text search across organization data
- Reference resolution (`resolveDepth`)
- All standard OIP query parameters

## Organization Access Control

### Private Organization Records

Organizations can control access to records using the `access_level: 'organization'` setting:

```json
{
  "accessControl": {
    "access_level": "organization",
    "shared_with": ["did:arweave:organization_did"]
  }
}
```

### Membership Verification

The system automatically checks membership based on the organization's `membership_policy`:

#### Auto-Enroll App Users
```javascript
// Checks if request comes from organization's domain
const isMember = await checkDomainBasedMembership(organization, requestInfo);
```

#### Open Join
```javascript
// Anyone is considered a member
return true;
```

#### Invite Only & Token-Gated
```javascript
// Future implementation for invitation lists and token verification
console.log('⚠️ Not yet implemented');
return false;
```

## Technical Implementation

### Core Functions

#### Handle Generation
```javascript
const convertToOrgHandle = async (txId, handle) => {
    const decimalNumber = parseInt(txId.replace(/[^0-9a-fA-F]/g, ''), 16);
    let digitsCount = 1;
    let uniqueHandleFound = false;
    let finalHandle = '';
    
    while (!uniqueHandleFound) {
        const currentDigits = decimalNumber.toString().substring(0, digitsCount);
        const possibleHandle = `${handle}${currentDigits}`;
        
        const organizations = await findOrganizationsByHandle(possibleHandle);
        
        if (organizations.length === 0) {
            uniqueHandleFound = true;
            finalHandle = possibleHandle;
        } else {
            digitsCount++;
        }
    }
    
    return finalHandle;
};
```

#### Organization Lookup
```javascript
const findOrganizationsByHandle = async (orgHandle) => {
    const response = await elasticClient.search({
        index: 'organizations',
        body: {
            query: {
                term: {
                    "data.orgHandle.keyword": orgHandle
                }
            }
        }
    });
    return response.hits.hits.map(hit => hit._source);
};
```

#### Enum Expansion
```javascript
// During indexing, membership_policy enum indices are expanded:
// 0 -> "Invite Only"
// 1 -> "Auto-Enroll App Users" 
// 2 -> "Token-Gated Membership"
// 3 -> "Open Join"

if (orgTemplate && orgTemplate.data && orgTemplate.data.fields) {
    const fields = JSON.parse(orgTemplate.data.fields);
    if (fields.membership_policy === "enum" && Array.isArray(fields.membership_policyValues)) {
        const enumValues = fields.membership_policyValues;
        if (typeof membershipPolicyValue === "number" && membershipPolicyValue < enumValues.length) {
            membershipPolicyValue = enumValues[membershipPolicyValue].name;
        }
    }
}
```

### Processing Workflows

#### Immediate Publishing Workflow
```
User Request → /api/organizations/newOrganization → publishNewRecord() → 
Organization Detection → Handle Generation → Enum Expansion → 
Dual Indexing (records + organizations) → Blockchain Publishing
```

#### Blockchain Sync Workflow  
```
keepDBUpToDate() → processNewRecord() → Organization Detection → 
indexNewOrganizationRegistration() → Handle Generation → Enum Expansion → 
Dual Indexing (records + organizations)
```

## Organization Deletion

### Blockchain-Based Deletion

Organizations can be deleted using blockchain delete messages:

**Delete Message Format**:
```json
{
  "delete": {
    "did": "did:arweave:organization_transaction_id"
  }
}
```

**Publishing Delete Message**:
```bash
curl -X POST https://api.oip.onl/api/records/newRecord \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "delete": {
      "did": "did:arweave:6zmCRZ06E2XtvN84BEQE_g4laBJdoCzTfQURHD2YlC4"
    }
  }'
```

### Multi-Index Deletion

The deletion system searches both indices:
1. **Records Index**: Searches for organization in general records
2. **Organizations Index**: Searches for organization in specialized index
3. **Authorization**: Verifies delete message creator matches organization creator
4. **Network-Wide**: Delete message propagates to all OIP nodes

### CLI Deletion (Single Server)

```bash
# Delete from organizations index
node index.js --deleteRecords --index organizations --did did:arweave:org_transaction_id

# Delete from records index  
node index.js --deleteRecords --index records --did did:arweave:org_transaction_id

# Delete entire organizations index (for schema changes)
node index.js --deleteIndex --index organizations
```

## API Examples

### Publishing a New Organization

```javascript
const organizationData = {
  basic: {
    name: "FitnessAlly",
    description: "AI-powered fitness and nutrition management platform...",
    date: Math.floor(Date.now() / 1000),
    language: "en",
    tagItems: ["fitness", "ai", "health", "nutrition"]
  },
  organization: {
    org_handle: "fitnessally",
    org_public_key: "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
    admin_public_keys: ["034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d"],
    membership_policy: "Auto-Enroll App Users",
    metadata: "Comprehensive fitness platform with AI integration"
  }
};

const response = await fetch('https://api.oip.onl/api/organizations/newOrganization', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${jwtToken}`
  },
  body: JSON.stringify(organizationData)
});
```

### Retrieving Organizations

```javascript
// Get all organizations
const organizations = await fetch('https://api.oip.onl/api/organizations');

// Get organizations via records endpoint with full query capabilities
const orgRecords = await fetch('https://api.oip.onl/api/records?recordType=organization&limit=10&sortBy=date:desc');

// Search organizations by tags
const fitnessOrgs = await fetch('https://api.oip.onl/api/records?recordType=organization&tags=fitness,health&tagsMatchMode=AND');

// Find specific organization by handle (approximate)
const specificOrg = await fetch('https://api.oip.onl/api/records?recordType=organization&search=fitnessally8');
```

### Organization-Protected Records

Organizations can protect records using access control:

```javascript
// Publishing a record that only organization members can access
const protectedRecord = {
  basic: {
    name: "Internal Training Video",
    description: "Private training content for organization members"
  },
  video: {
    // video data
  },
  accessControl: {
    access_level: "organization",
    shared_with: ["did:arweave:6zmCRZ06E2XtvN84BEQE_g4laBJdoCzTfQURHD2YlC4"]
  }
};

// Only members of the specified organization can access this record
```

## Security and Authorization

### Creator Verification

- **Organization Creator**: The Arweave address that published the organization
- **Admin Public Keys**: Array of public keys with administrative privileges
- **Deletion Authorization**: Only the original creator can delete the organization
- **Modification Rights**: Currently, organizations are immutable after creation

### Access Control Integration

Organizations integrate with the OIP access control system:

```javascript
// Check if user is organization member
const isMember = await organizationEncryption.isUserOrganizationMember(
    userPublicKey, 
    organizationDid, 
    requestInfo
);

// Filter records based on organization membership
if (accessLevel === 'organization') {
    const sharedWith = accessControl?.shared_with;
    const isMember = await checkOrganizationMembershipForRecord(
        userPubKey, 
        sharedWith, 
        requestInfo
    );
    return isMember;
}
```

## Development and Testing

### Local Development

```bash
# Start OIP server
npm start

# Publish test organization
curl -X POST http://localhost:3005/api/organizations/newOrganization \
  -H "Content-Type: application/json" \
  -d '{"basic":{"name":"Test Org"},"organization":{"org_handle":"testorg","org_public_key":"...","membership_policy":"Open Join"}}'

# Check organizations endpoint
curl http://localhost:3005/api/organizations

# Check records endpoint
curl "http://localhost:3005/api/records?recordType=organization"
```

### Index Management

```bash
# Delete organizations index (for schema changes)
node index.js --deleteIndex --index organizations

# Delete specific organization
node index.js --deleteRecords --index organizations --did did:arweave:org_id

# Check index mapping
curl http://localhost:9200/organizations/_mapping
```

## Troubleshooting

### Common Issues

#### 1. Elasticsearch Mapping Conflicts
**Symptom**: `mapper_parsing_exception` when indexing
**Cause**: Field type mismatch (e.g., string vs long)
**Solution**: Delete and recreate the organizations index

```bash
node index.js --deleteIndex --index organizations
# Restart server to recreate index with correct mapping
```

#### 2. Missing Creator Object
**Symptom**: Organizations without creator information
**Cause**: Creator not found in database during processing
**Solution**: Ensure creator is registered before publishing organization

#### 3. Handle Conflicts
**Symptom**: Duplicate organization handles
**Cause**: Race condition in handle generation
**Solution**: System automatically resolves by appending more digits

#### 4. Enum Value Issues
**Symptom**: Numeric values instead of enum names
**Cause**: Template not found or enum expansion failed
**Solution**: Verify organization template exists and is properly formatted

### Debug Information

Enable detailed logging to troubleshoot organization processing:

```javascript
// In helpers/elasticsearch.js - organization processing logs:
console.log('Organization transaction:', transaction);
console.log('Expanded membershipPolicy enum:', membershipPolicyValue);
console.log('Creator info found for organization:', creatorInfo);
console.log('Organization to index:', organization);
```

## Migration and Compatibility

### Legacy Organizations

Existing organizations with numeric `membershipPolicy` values:
- **Backward Compatibility**: Numeric values still work
- **Gradual Migration**: New organizations use expanded enum values
- **Index Recreation**: Deleting/recreating index applies new format to all records

### Cross-Node Consistency

All OIP nodes process organizations identically:
- **Same Handle Generation**: Deterministic based on transaction ID
- **Same Enum Expansion**: Uses same organization template
- **Same Dual Indexing**: Both indices populated consistently
- **Same Creator Lookup**: Consistent creator information

## Future Enhancements

### Planned Features

1. **Organization Updates**: Allow admins to update organization information
2. **Member Management**: Implement invitation systems for invite-only organizations
3. **Token-Gated Access**: Integration with blockchain tokens/NFTs for membership
4. **Organization Analytics**: Usage statistics and member activity tracking
5. **Multi-Admin Support**: Enhanced admin role management
6. **Organization Hierarchies**: Parent/child organization relationships

### API Expansions

1. **Member Endpoints**: `/api/organizations/:orgId/members`
2. **Admin Endpoints**: `/api/organizations/:orgId/admins`
3. **Invitation Endpoints**: `/api/organizations/:orgId/invitations`
4. **Analytics Endpoints**: `/api/organizations/:orgId/analytics`

---

*This documentation reflects the current implementation of the OIP organization system. Organizations provide a foundation for access control, community management, and collaborative content creation within the OIP ecosystem.*
