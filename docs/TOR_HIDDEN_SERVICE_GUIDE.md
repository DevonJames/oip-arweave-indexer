# TOR Hidden Service Guide for Onion Press

This guide explains how to use the TOR hidden service integrated into Onion Press, find your `.onion` address, and configure anonymous publishing.

## Overview

When you run the `onion-press-server` or `alexandria` profile, your instance automatically becomes a TOR hidden service. This provides:

1. **Incoming Access via TOR** - Anyone on the TOR network can access your Onion Press at your unique `.onion` address
2. **Outgoing Anonymous Publishing** - You can publish records to other `.onion` addresses (like the Internet Archive's OIP gateway) anonymously

## Finding Your .onion Address

### Method 1: Docker Logs (Easiest)

When the container starts, it displays your `.onion` address:

```bash
docker logs alexandria-onion-press-service-1 | grep -A2 "HIDDEN SERVICE"
```

Output:
```
═══════════════════════════════════════════════════════════════
🧅 HIDDEN SERVICE ACTIVE
   .onion address: abc123xyz456abc123xyz456abc123xyz456abc123xyz456abcdefgh.onion
═══════════════════════════════════════════════════════════════
```

### Method 2: Makefile Command

```bash
make -f Makefile.split status
```

Look for the "🧅 TOR Status" section.

### Method 3: Read from Container

```bash
docker compose -f docker-compose-split.yml exec onion-press-service cat /var/lib/tor/hidden_service/hostname
```

### Method 4: API Endpoint

```bash
curl http://localhost:3007/api/tor/status
```

Or through the OIP daemon proxy:
```bash
curl https://yourdomain.com/onion-press/api/tor/status
```

Response:
```json
{
  "connected": true,
  "onionAddress": "abc123xyz456...abcdefgh.onion",
  "socksHost": "127.0.0.1",
  "socksPort": 9050,
  "proxyUrl": "socks5h://127.0.0.1:9050"
}
```

## Accessing Your Instance via TOR

Once you have your `.onion` address, anyone using TOR Browser can access your Onion Press at:

```
http://abc123xyz456...abcdefgh.onion/
```

This provides:
- Anonymous browsing of your published records
- Censorship-resistant access to your content
- No IP address exposure for visitors

## Persisting Your .onion Address

Your `.onion` address is generated from cryptographic keys stored in the `tor-hidden-service` Docker volume. **This address persists across container restarts** as long as you don't delete the volume.

To check your volumes:
```bash
docker volume ls | grep tor
```

### Backing Up Your Hidden Service Keys

To preserve your `.onion` address when migrating to a new server:

```bash
# Backup
docker run --rm -v oip-arweave-indexer_tor-hidden-service:/data -v $(pwd):/backup alpine tar czf /backup/tor-hidden-service-backup.tar.gz -C /data .

# Restore on new server
docker run --rm -v oip-arweave-indexer_tor-hidden-service:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/tor-hidden-service-backup.tar.gz"
```

⚠️ **Security Warning**: These keys ARE your hidden service identity. Anyone with these keys can impersonate your `.onion` address. Store backups securely.

## Publishing to Internet Archive via TOR

When `PUBLISH_TO_INTERNETARCHIVE=true`, Onion Press routes publish requests through TOR to the Internet Archive's OIP gateway.

### Configuration

In your `.env`:
```bash
PUBLISH_TO_INTERNETARCHIVE=true
IA_ORGANIZATION_HANDLE=internetarchive
```

The Internet Archive's `.onion` address is retrieved from their organization record's `gateway_onion_address` field.

### How It Works

1. You publish a record via WordPress or API
2. Onion Press creates an OIP-formatted record
3. If `PUBLISH_TO_INTERNETARCHIVE=true`:
   - The record is sent through the TOR SOCKS proxy
   - Request goes to: `http://{IA_ONION_ADDRESS}/api/publish`
   - Your IP is never exposed to the Internet Archive

## TOR Bootstrap Status

TOR needs ~30-60 seconds to bootstrap on first start. You can check status:

```bash
docker logs alexandria-onion-press-service-1 2>&1 | grep -E "(bootstrap|TOR|tor)"
```

Successful bootstrap looks like:
```
🔐 Starting TOR daemon...
⏳ Waiting for TOR to bootstrap...
✅ TOR SOCKS proxy is ready
```

## Testing TOR Connectivity

### Test Outbound TOR Connection

```bash
curl -X GET "http://localhost:3007/api/tor/test"
```

Response:
```json
{
  "success": true,
  "message": "TOR connectivity verified",
  "duration": "1234ms"
}
```

### Test Publishing Through TOR

```bash
curl -X POST "http://localhost:3007/api/tor/proxy" \
  -H "Content-Type: application/json" \
  -d '{"method": "GET", "url": "http://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/"}'
```

## Troubleshooting

### "TOR hidden service hostname not found"

**Cause**: TOR hasn't finished generating keys yet, or volume permissions issue.

**Fix**: Wait 30-60 seconds after container start, then check again. If persistent:
```bash
docker compose -f docker-compose-split.yml restart onion-press-service
```

### "TOR SOCKS proxy not ready"

**Cause**: TOR daemon failed to start or is still bootstrapping.

**Fix**: Check TOR logs:
```bash
docker logs alexandria-onion-press-service-1 2>&1 | tail -50
```

Look for errors like "Permission denied" or "Address already in use".

### Connection Timeouts

TOR is slower than direct connections. The default timeout is 120 seconds for TOR-proxied requests. If publishing large records, this may need adjustment.

### Volume Permission Issues

If TOR can't write to its directories:
```bash
docker compose -f docker-compose-split.yml down onion-press-service
docker volume rm oip-arweave-indexer_tor-hidden-service oip-arweave-indexer_tor-data
docker compose -f docker-compose-split.yml up -d onion-press-service
```

⚠️ This generates a NEW `.onion` address.

## Security Considerations

### What TOR Protects

- **Your IP address** from visitors accessing your `.onion`
- **Your IP address** when publishing to other `.onion` services
- **Traffic content** from network observers (encrypted within TOR)

### What TOR Does NOT Protect

- **Content of your records** - these are public on Arweave/GUN
- **Metadata timing attacks** - advanced adversaries may correlate timing
- **Application-level leaks** - if your content contains identifying info

### Best Practices

1. **Don't mix identities** - Don't publish both anonymous and identified content from same instance
2. **Use dedicated instance** - For sensitive publishing, run a separate Onion Press instance
3. **Check for leaks** - Ensure your published content doesn't contain identifying metadata
4. **Keep TOR updated** - Rebuild containers periodically to get TOR updates

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   onion-press-service                        │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │   TOR Daemon    │    │      Node.js Application        │ │
│  │                 │    │                                 │ │
│  │  SOCKS: 127.0.0.1:9050  ──────────────────────────────>│ │
│  │                 │    │  (outbound .onion requests)     │ │
│  │                 │    │                                 │ │
│  │  Hidden Service │    │  HTTP: 127.0.0.1:3007           │ │
│  │  Port 80 ───────────>│  (incoming .onion requests)     │ │
│  │                 │    │                                 │ │
│  └─────────────────┘    └─────────────────────────────────┘ │
│                                                              │
│  Volumes:                                                    │
│    /var/lib/tor/hidden_service/ → tor-hidden-service        │
│    /var/lib/tor/data/           → tor-data                  │
└─────────────────────────────────────────────────────────────┘
```

## Related Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PUBLISH_TO_INTERNETARCHIVE` | `false` | Enable publishing to IA via TOR |
| `TOR_SOCKS_PORT` | `9050` | TOR SOCKS proxy port (internal) |
| `TOR_CONTROL_PORT` | `9051` | TOR control port (internal) |
| `IA_ORGANIZATION_HANDLE` | `internetarchive` | Org record with IA's `.onion` address |

## Commands Reference

```bash
# View onion address
make -f Makefile.split status

# View TOR logs
docker logs alexandria-onion-press-service-1 2>&1 | grep -i tor

# Restart TOR (by restarting container)
docker compose -f docker-compose-split.yml restart onion-press-service

# Test TOR connectivity
curl http://localhost:3007/api/tor/test

# Get full TOR status
curl http://localhost:3007/api/tor/status

# Backup hidden service keys
docker run --rm -v oip-arweave-indexer_tor-hidden-service:/data -v $(pwd):/backup alpine tar czf /backup/tor-backup.tar.gz -C /data .
```

