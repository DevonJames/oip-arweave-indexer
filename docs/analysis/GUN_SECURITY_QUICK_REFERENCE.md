# GUN Security Quick Reference

## ⚡ **Quick Commands**

```bash
# Full security audit (run this first!)
make verify-gun-security

# Check current peer configuration
make check-gun-peers

# Monitor peer connection logs
make gun-peer-logs
```

## 🎯 **Immediate Action Items**

### 1. Verify Your Current Configuration

On **each of your three nodes**, run:

```bash
grep GUN_EXTERNAL_PEERS .env
```

### 2. Expected Configuration

Each node should list the OTHER two nodes (not itself):

**Node: rockhoppersgame.com**
```env
GUN_EXTERNAL_PEERS=https://api.oip.onl/gun-relay,https://oip.fitnessally.io/gun-relay
```

**Node: api.oip.onl**
```env
GUN_EXTERNAL_PEERS=https://rockhoppersgame.com/gun-relay,https://oip.fitnessally.io/gun-relay
```

**Node: oip.fitnessally.io**
```env
GUN_EXTERNAL_PEERS=https://rockhoppersgame.com/gun-relay,https://api.oip.onl/gun-relay
```

### 3. Deploy Security Updates

After verifying configuration, rebuild and redeploy:

```bash
# Stop services
make down

# Rebuild with security updates
make rebuild-standard-gpu

# Verify security after startup
make verify-gun-security
```

## ✅ **What's Protected Now**

After these updates, your GUN network has:

1. ✅ **Peer Whitelist** - Only controlled domains can connect
2. ✅ **Auto-Discovery Disabled** - No multicast or peer exchange
3. ✅ **Runtime Validation** - Invalid peers rejected and logged
4. ✅ **Monitoring Endpoint** - Real-time peer status at `/peers/status`
5. ✅ **Audit Tools** - Automated security verification scripts

## 🚨 **Red Flags**

Watch for these in logs:

```bash
# Bad - unauthorized peer attempt
🚨 SECURITY WARNING: Rejected unauthorized GUN peer: wss://gun-us.herokuapp.com/gun

# Bad - peer from unknown domain
🚨 SECURITY: Blocked 1 unauthorized peer(s)
```

**Action**: Immediately check `.env` and remove unauthorized peers.

## 🔍 **Current Status Check**

Run this on all three nodes:

```bash
# Quick verification
make check-gun-peers

# See if any security warnings in logs
docker logs $(docker ps --format "{{.Names}}" | grep gun-relay) 2>&1 | grep SECURITY
```

## 📊 **What Records Are Affected**

### Records Currently in GUN

All records with `storage: "gun"` or published via `/api/records/newRecord?storage=gun`:

- ✅ **Private records** - `access_level: "private"`
- ✅ **Organization records** - `access_level: "organization"`
- ✅ **Conversation sessions** - `recordType: "conversationSession"`
- ✅ **User-specific data** - Workouts, nutrition logs, etc.

### Records NOT Affected

Public records on Arweave are not affected - they're already public by design.

## 💡 **Quick Troubleshooting**

### "Peer status endpoint not reachable"

```bash
# Check if gun-relay is running
docker ps | grep gun-relay

# Restart if needed
docker-compose restart gun-relay

# Check logs
docker logs $(docker ps --format "{{.Names}}" | grep gun-relay)
```

### "Cannot connect to other nodes"

```bash
# Verify URLs are accessible from each node
curl -I https://api.oip.onl/gun-relay/peers/status
curl -I https://rockhoppersgame.com/gun-relay/peers/status
curl -I https://oip.fitnessally.io/gun-relay/peers/status
```

### "Want to temporarily isolate a node"

```bash
# In .env, set:
GUN_EXTERNAL_PEERS=

# Restart:
docker-compose restart gun-relay

# Verify:
make check-gun-peers
```

## 📖 **Full Documentation**

- [GUN Security Configuration Guide](./GUN_SECURITY_CONFIGURATION.md) - Complete security documentation
- [OIP GUN Integration Guide](./OIP_GUN_INTEGRATION_COMPREHENSIVE_GUIDE.md) - Full GUN integration details

## 🆘 **Emergency Isolation**

If you suspect a security issue:

```bash
# IMMEDIATELY isolate the node
echo "GUN_EXTERNAL_PEERS=" >> .env
make down && make up-no-makefile-ngrok PROFILE=standard-gpu

# Run security audit
make verify-gun-security

# Check for unauthorized connections
make gun-peer-logs | grep SECURITY
```

---

**Last Updated**: 2025-11-21  
**Security Status**: ✅ Hardened with whitelist validation and monitoring

