# GUN Network Security Configuration

## Overview

This document explains the security measures in place to ensure your GUN network only syncs between controlled nodes and never leaks private/organization records to the public GUN network.

## 🚨 **Critical Security Understanding**

**IMPORTANT**: Records stored in GUN are **NOT encrypted in the registry**. While private record *content* is encrypted, the registry metadata (record type, creator, timestamps, DIDs) is visible as plaintext. This is why **network isolation** is critical.

### What's at Risk

When you store records in GUN with `storage=gun`:

1. **Private records** (`access_level: "private"`) - Only accessible by the creator
2. **Organization records** (`access_level: "organization"`) - Accessible by organization members
3. **Metadata** - Record types, DIDs, creator info, timestamps (VISIBLE in registry)

### Why Network Isolation Matters

- ✅ **With proper isolation**: Only your 3 controlled nodes can see and sync records
- ❌ **Without isolation**: Any GUN node on the public network could discover your records' metadata
- ❌ **Public GUN relays**: Could index your record metadata and make it searchable

## 🔒 **Security Measures Implemented**

### 1. Peer Whitelist Validation

The `gun-relay-server.js` now validates all peer URLs against a whitelist:

```javascript
// SECURITY: Whitelist of allowed peer domains (only sync with controlled nodes)
const allowedDomains = [
    'rockhoppersgame.com',
    'api.oip.onl',
    'oip.fitnessally.io',
    'localhost',
    '127.0.0.1',
    'gun-relay'  // Docker internal service name
];
```

**Any peer URL not matching these domains will be rejected and logged.**

### 2. Automatic Discovery Disabled

```javascript
const gunConfig = {
    multicast: false,  // Disable multicast peer discovery
    axe: false         // Disable GUN's automatic peer exchange/discovery
};
```

- **`multicast: false`** - Prevents local network broadcast discovery
- **`axe: false`** - Prevents peers from sharing/exchanging other peer addresses

### 3. Explicit Peer Configuration

GUN only connects to peers explicitly listed in `GUN_EXTERNAL_PEERS` environment variable. No default public peers are included.

### 4. Runtime Monitoring

New `/peers/status` endpoint provides real-time peer connection information:

```bash
curl http://localhost:8765/peers/status
```

Returns:
```json
{
  "configuredPeers": ["https://api.oip.onl/gun-relay", "..."],
  "peerCount": 2,
  "allowedDomains": ["rockhoppersgame.com", "api.oip.onl", "..."],
  "isolationMode": "multi-node",
  "multicastDisabled": true,
  "axeDisabled": true,
  "timestamp": "2025-11-21T..."
}
```

## 📋 **Configuration Checklist**

### For Each of Your Three Nodes

#### Node 1: rockhoppersgame.com

```bash
# In .env file:
GUN_EXTERNAL_PEERS=https://api.oip.onl/gun-relay,https://oip.fitnessally.io/gun-relay
```

#### Node 2: api.oip.onl

```bash
# In .env file:
GUN_EXTERNAL_PEERS=https://rockhoppersgame.com/gun-relay,https://oip.fitnessally.io/gun-relay
```

#### Node 3: oip.fitnessally.io

```bash
# In .env file:
GUN_EXTERNAL_PEERS=https://rockhoppersgame.com/gun-relay,https://api.oip.onl/gun-relay
```

### ⚠️ **What NOT to Include**

Never include these in `GUN_EXTERNAL_PEERS`:

- ❌ Public GUN relays (e.g., `wss://gun-us.herokuapp.com/gun`)
- ❌ Third-party GUN servers
- ❌ Any domain you don't control
- ❌ Default GUN peer lists

## 🔍 **Verification Commands**

### Full Security Audit

```bash
make verify-gun-security
```

This will:
1. ✅ Check `.env` configuration
2. ✅ Validate peer URLs against whitelist
3. ✅ Query running container configuration
4. ✅ Check peer status endpoint
5. ✅ Scan logs for unauthorized connection attempts
6. ✅ Generate security summary report

### Quick Peer Check

```bash
make check-gun-peers
```

Shows current peer configuration and status.

### Monitor Peer Logs

```bash
make gun-peer-logs
```

Shows recent peer-related log entries, including any security warnings.

## 🚨 **What to Look For**

### Good Signs ✅

```
🌐 GUN peers configured: https://api.oip.onl/gun-relay, https://oip.fitnessally.io/gun-relay
🔒 GUN network isolated to 2 controlled node(s)
✅ All peers are authorized
✅ No unauthorized peer attempts found in logs
```

### Warning Signs ⚠️

```
🚨 SECURITY WARNING: Rejected unauthorized GUN peer: wss://gun-us.herokuapp.com/gun
🚨 Only peers from controlled domains are allowed
```

**Action**: Remove unauthorized peers from `GUN_EXTERNAL_PEERS` in `.env` immediately.

## 🛡️ **Additional Security Recommendations**

### 1. Network-Level Isolation (Optional but Recommended)

Consider using firewall rules to restrict GUN relay port (8765) access:

```bash
# Only allow connections from your other nodes' IPs
sudo ufw allow from <node2-ip> to any port 8765
sudo ufw allow from <node3-ip> to any port 8765
sudo ufw deny 8765
```

### 2. TLS/SSL for Inter-Node Communication

Ensure all `GUN_EXTERNAL_PEERS` URLs use HTTPS:
- ✅ `https://api.oip.onl/gun-relay` 
- ❌ `http://api.oip.onl/gun-relay`

This prevents eavesdropping on record metadata during sync.

### 3. Regular Security Audits

Run security verification after any configuration changes:

```bash
make verify-gun-security
```

### 4. Monitor Logs for Anomalies

Regularly check for unexpected peer connection attempts:

```bash
make gun-peer-logs | grep "SECURITY"
```

## 🔧 **Troubleshooting**

### Issue: "GUN_EXTERNAL_PEERS not set"

**Status**: This is actually SAFE - your node is running in isolated mode with no external peers.

**When this is okay**: 
- Single-node testing
- Initial setup before connecting to other nodes

**When this is a problem**:
- You expect multi-node sync but haven't configured peers

### Issue: "Unauthorized peer detected"

**Severity**: 🚨 HIGH - Immediate action required

**Steps**:
1. Check `.env` for `GUN_EXTERNAL_PEERS`
2. Remove any unauthorized URLs
3. Restart services: `make down && make up-no-makefile-ngrok PROFILE=standard-gpu`
4. Verify: `make verify-gun-security`

### Issue: "Peer status endpoint not reachable"

**Possible causes**:
- GUN relay container not running
- Port mapping issue
- Container hasn't started yet

**Fix**:
```bash
# Check container status
docker ps | grep gun-relay

# Check container logs
docker logs <gun-relay-container>

# Restart if needed
docker-compose restart gun-relay
```

## 📊 **Security Audit Frequency**

Recommended audit schedule:

- ✅ **After initial setup** - Verify configuration is correct
- ✅ **After .env changes** - Ensure no unauthorized peers added
- ✅ **Weekly** - Routine security check
- ✅ **Before adding new nodes** - Verify whitelist is updated
- ✅ **After suspicious activity** - Immediate audit if logs show warnings

## 🔐 **Current Security Status**

As of the latest updates:

| Security Measure | Status | Notes |
|-----------------|--------|-------|
| Peer Whitelist | ✅ Enabled | Only controlled domains allowed |
| Multicast Discovery | ✅ Disabled | No automatic local network discovery |
| Peer Exchange (Axe) | ✅ Disabled | Peers can't share other peer addresses |
| Runtime Monitoring | ✅ Available | `/peers/status` endpoint active |
| Validation Script | ✅ Available | `make verify-gun-security` |
| Unauthorized Peer Rejection | ✅ Active | Invalid peers logged and blocked |

## 📚 **Related Documentation**

- [OIP GUN Integration Guide](./OIP_GUN_INTEGRATION_COMPREHENSIVE_GUIDE.md) - Full GUN integration details
- [Organizations Guide](./ORGANIZATIONS.md) - Organization-level access control
- [User Wallets Documentation](./user_wallets_documentation.md) - User authentication and wallets

## 🆘 **Support**

If you discover a security issue or have questions:

1. **Check logs first**: `make gun-peer-logs`
2. **Run security audit**: `make verify-gun-security`
3. **Review configuration**: `make check-gun-peers`
4. **Isolate if uncertain**: Set `GUN_EXTERNAL_PEERS=` (empty) to run in isolated mode

---

**Remember**: GUN network security depends on **proper peer configuration**. Always verify after changes!

