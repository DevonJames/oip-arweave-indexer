# GUN Integration Deployment Guide

## Quick Start

The GUN integration has been successfully implemented with **HD wallet user authentication** and is ready for deployment. This system provides private, encrypted storage for conversation sessions and other user-owned records alongside the existing Arweave permanent storage.

## Prerequisites

- Docker and Docker Compose installed
- `.env` file configured (copy from `example env`)
- Arweave wallet configured in `config/arweave-keyfile.json`
- **HD Wallet Dependencies**: `bip39`, `bip32`, `tiny-secp256k1` (automatically installed)

## Deployment Steps

### 1. Configure Environment

```bash
# Copy the example environment file
cp "example env" .env

# Edit .env to add GUN configuration
# GUN_PEERS=http://gun-relay:8765/gun
# GUN_ENABLE_ENCRYPTION=true
# GUN_DEFAULT_PRIVACY=false
```

### 2. Start Services

```bash
# Start all services including GUN relay
make standard

# Or build from scratch
make rebuild-standard
```

### 3. Verify GUN Integration

```bash
# Run integration tests
npm test -- test/test-gun-integration.js

# Check service status
make status

# Verify GUN relay is running
curl http://localhost:8765/gun
```

## API Usage Examples

### Register User with HD Wallet

```bash
# Register new user (generates HD wallet automatically)
curl -X POST 'https://api.oip.onl/api/user/register' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "developer@example.com",
    "password": "secure_password_123"
  }'

# Response includes JWT token and user's public key
# {
#   "success": true,
#   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
#   "publicKey": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1"
# }
```

### Login Existing User

```bash
# Login existing user
curl -X POST 'https://api.oip.onl/api/user/login' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "developer@example.com",
    "password": "secure_password_123"
  }'
```

### Create Private Conversation Session

```bash
# Create private conversation session in GUN
curl -X POST 'https://api.oip.onl/api/records/newRecord?recordType=conversationSession&storage=gun&localId=session_001' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "basic": {
      "name": "My Private Conversation",
      "description": "Private AI conversation session"
    },
    "conversationSession": {
      "session_id": "session_001",
      "start_timestamp": 1757789558199,
      "message_count": 0,
      "messages": "",
      "message_timestamps": "",
      "message_roles": "",
      "model_name": "gpt-4o-mini",
      "conversation_type": "text",
      "owner_public_key": "USER_PUBLIC_KEY_FROM_JWT"
    },
    "accessControl": {
      "access_level": "private",
      "owner_public_key": "USER_PUBLIC_KEY_FROM_JWT",
      "created_by": "USER_PUBLIC_KEY_FROM_JWT"
    }
  }'
```

### Query Private Records (Authenticated)

```bash
# Get user's private conversation sessions
curl 'https://api.oip.onl/api/records?source=gun&recordType=conversationSession&limit=15&sortBy=date:desc' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'

# Get specific private session by DID
curl 'https://api.oip.onl/api/records?source=gun&did=did:gun:647f79c2a338:session_1757789557773&limit=1' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'

# Get all records (public + user's private)
curl 'https://api.oip.onl/api/records?source=all&limit=10' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'

# Search across all accessible records
curl 'https://api.oip.onl/api/records?search=cooking&source=all' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

### Query Public Records (Unauthenticated)

```bash
# Get only public records (no private sessions visible)
curl 'https://api.oip.onl/api/records?source=gun&recordType=conversationSession&limit=15'
# Returns: {"records": [], "auth": {"authenticated": false}}

# Get public Arweave records
curl 'https://api.oip.onl/api/records?source=arweave&limit=10'

# Public search (no private results)
curl 'https://api.oip.onl/api/records?search=cooking&source=all'
```

### Update Private Session with Messages

```bash
# Update existing session with conversation messages
curl -X POST 'https://api.oip.onl/api/records/newRecord?recordType=conversationSession&storage=gun&localId=session_001' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "basic": {
      "name": "Active Conversation",
      "description": "Private AI conversation session"
    },
    "conversationSession": {
      "session_id": "session_001",
      "start_timestamp": 1757789558199,
      "last_activity_timestamp": 1757789564542,
      "message_count": 2,
      "messages": "[\"Hello, who are you?\",\"I am ALFRED, an AI assistant...\"]",
      "message_timestamps": "[1757789559348,1757789564040]",
      "message_roles": "[\"user\",\"assistant\"]",
      "model_name": "gpt-4o-mini",
      "conversation_type": "text",
      "owner_public_key": "USER_PUBLIC_KEY_FROM_JWT"
    },
    "accessControl": {
      "access_level": "private",
      "owner_public_key": "USER_PUBLIC_KEY_FROM_JWT",
      "created_by": "USER_PUBLIC_KEY_FROM_JWT"
    }
  }'
```

## Frontend Usage (ALFRED Interface)

### Voice Assistant Interface

1. Open `http://localhost:3001` in your browser (ALFRED interface)
2. **Register/Login**: Use the user menu (👤) to create account or sign in
3. **HD Wallet**: Automatically generated on registration
4. **Private Sessions**: Conversation history automatically saved as private GUN records
5. **Cross-Device**: Access your conversation history from any device with login

### Authentication Flow

1. **First Visit**: Auth modal appears automatically
2. **Register**: Creates HD wallet with 12-word mnemonic (encrypted)
3. **Login**: Retrieves user's public key for record ownership
4. **Auto-Save**: Conversations automatically saved as private sessions
5. **Privacy**: Only you can see your conversation history

### Session Management

- **Automatic Creation**: New sessions created on first message
- **Real-Time Updates**: Messages saved as you chat
- **History Sidebar**: View and load previous conversations
- **Cross-User Privacy**: Cannot see other users' sessions

## Architecture Overview

The integration adds GUN as a private storage backend with HD wallet authentication:

- **Arweave**: Permanent, public, immutable storage (server-signed)
- **GUN**: Private, encrypted, user-owned storage (HD wallet-signed)

### HD Wallet Authentication System
- **BIP-39**: 12-word mnemonic generation for account recovery
- **BIP-32**: Hierarchical deterministic key derivation (`m/44'/0'/0'/0/0`)
- **secp256k1**: Elliptic curve cryptography for signatures
- **PBKDF2**: Password-based key encryption (100,000 iterations)

### Storage Architecture
- **Public Records**: Stored on Arweave, signed with server key
- **Private Records**: Stored on GUN, owned by user's HD wallet key
- **Unified API**: Same `/api/records` endpoint handles both storage types
- **Optional Authentication**: Public access for public records, required for private
- **Cross-User Privacy**: Users can only access their own private records

## Key Benefits

1. **True User Ownership**: Individual HD wallets for cryptographic ownership
2. **Cross-User Privacy**: Users can only access their own private records
3. **Unified API**: Single endpoint handles both public and private storage
4. **Optional Authentication**: Public records accessible without auth
5. **Automatic Encryption**: Private records encrypted in GUN storage
6. **Real-Time Sessions**: Conversation history saved automatically
7. **Cross-Device Access**: Same account works across multiple devices
8. **Backward Compatibility**: Existing public records continue to work

## Troubleshooting

### GUN Relay Not Starting

```bash
# Check if gun-relay service is running
docker-compose ps | grep gun-relay

# View gun-relay logs
docker-compose logs gun-relay

# Restart gun-relay service
docker-compose restart gun-relay
```

### GUN Records Not Appearing

1. Check that `source=all` or `source=gun` is used in queries
2. Verify GUN relay is accessible at `http://gun-relay:8765/gun`
3. Check Elasticsearch logs for indexing errors

### Authentication Issues

- **Invalid Token**: Ensure JWT token is valid and not expired
- **Missing Public Key**: Verify user has HD wallet (register new users)
- **Cross-User Access**: Users cannot access other users' private records
- **Array Format**: Old users may have broken public key format (re-register to fix)

## Migration Notes

### Existing Records

All existing Arweave records will automatically get:
- `oip.did` field (copied from `oip.didTx`)
- `oip.storage` field (set to `'arweave'`)
- `oip.encrypted` field (set to `false`)

Run the migration script to update existing records:

```bash
node config/migrateGunSupport.js
```

### API Compatibility

- All existing API calls continue to work unchanged
- New `source` parameter is optional (defaults to `all`)
- `didTx` parameter still works (aliased to `did`)
- Alfred AI automatically includes GUN records in search results

## Security Considerations

1. **HD Wallet Security**: Private keys encrypted with user passwords using PBKDF2
2. **Cross-User Privacy**: Strong isolation between users' private records
3. **Access Control**: Uses `accessControl.owner_public_key` for ownership verification
4. **Encryption**: AES-256-GCM encryption for private GUN records
5. **Key Management**: Individual user HD wallets, not shared server keys
6. **Network Security**: GUN relay runs in isolated Docker network
7. **JWT Security**: Tokens include user's public key for ownership verification

## Performance Impact

- **Minimal**: GUN records are indexed to Elasticsearch immediately
- **Query Speed**: Same as existing records (all queries hit Elasticsearch)
- **Storage**: GUN adds ~10MB persistent volume for relay data
- **Memory**: GUN relay uses ~50MB additional RAM

---

**Status**: ✅ Ready for Production  
**Documentation**: Complete  
**Tests**: Available (`test/test-gun-integration.js`)  
**Migration**: Automated (`config/migrateGunSupport.js`)
