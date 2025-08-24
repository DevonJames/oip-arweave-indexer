# GUN Media Distribution API Documentation

## Overview

The GUN Media Distribution System provides a comprehensive API for storing, distributing, and managing media files in a decentralized peer-to-peer network. The system combines BitTorrent for efficient file distribution with GUN for metadata coordination, offering enterprise-grade features including encryption, monitoring, and automated maintenance.

## Base URL

```
http://localhost:3005/api/media
```

## Authentication

Currently, the API operates without authentication for basic operations. Production deployments should implement proper authentication and authorization mechanisms.

---

## Core Media Operations

### Upload Media

Upload and distribute media files with optional encryption and replication.

**Endpoint:** `POST /media/upload`

**Content-Type:** `multipart/form-data`

**Parameters:**
- `file` (required): The media file to upload
- `encrypt` (optional): Enable encryption (`true`/`false`, default: `false`)
- `recipients` (optional): JSON array of public keys for encrypted access
- `accessLevel` (optional): Access level (`public`/`private`/`restricted`, default: `private`)
- `expiresAt` (optional): Expiration timestamp (ISO 8601 format)
- `replicate` (optional): Enable P2P replication (`true`/`false`, default: `true`)
- `priority` (optional): Replication priority (1-10, default: 5)

**Example - Basic Upload:**
```bash
curl -X POST http://localhost:3005/api/media/upload \
  -F "file=@image.jpg" \
  -F "replicate=true" \
  -F "priority=7"
```

**Example - Encrypted Upload:**
```bash
curl -X POST http://localhost:3005/api/media/upload \
  -F "file=@document.pdf" \
  -F "encrypt=true" \
  -F "recipients=[\"pubkey1\",\"pubkey2\"]" \
  -F "accessLevel=private" \
  -F "expiresAt=2025-12-31T23:59:59Z"
```

**Response:**
```json
{
  "success": true,
  "mediaId": "a1b2c3d4e5f6789...",
  "manifest": {
    "mediaId": "a1b2c3d4e5f6789...",
    "fileName": "image.jpg",
    "contentType": "image/jpeg",
    "fileSize": 1048576,
    "transport": {
      "bittorrent": {
        "infoHash": "abc123...",
        "magnetURI": "magnet:?xt=urn:btih:abc123...",
        "trackers": ["wss://tracker.btorrent.xyz", "..."]
      }
    },
    "createdAt": "2025-01-21T15:30:00.000Z",
    "encrypted": false,
    "replicationQueued": true
  },
  "torrent": {
    "infoHash": "abc123...",
    "magnetURI": "magnet:?xt=urn:btih:abc123..."
  },
  "network": {
    "peerId": "peer_hostname_timestamp_random",
    "networkPeers": 3,
    "replicationQueued": true
  }
}
```

---

### Get Media Manifest

Retrieve comprehensive metadata about a media file including network availability.

**Endpoint:** `GET /media/:mediaId/manifest`

**Example:**
```bash
curl http://localhost:3005/api/media/a1b2c3d4e5f6789.../manifest
```

**Response:**
```json
{
  "mediaId": "a1b2c3d4e5f6789...",
  "fileName": "image.jpg",
  "contentType": "image/jpeg",
  "fileSize": 1048576,
  "transport": {
    "bittorrent": {
      "infoHash": "abc123...",
      "magnetURI": "magnet:?xt=urn:btih:abc123...",
      "trackers": ["wss://tracker.btorrent.xyz"]
    }
  },
  "availability": {
    "local": true,
    "network": true,
    "totalCopies": 4
  },
  "network": {
    "availablePeers": 3,
    "peers": [
      {
        "peerId": "peer_node1_...",
        "apiEndpoint": "http://node1:3005/api",
        "lastSeen": 1642781400000
      }
    ]
  },
  "replication": {
    "status": "completed",
    "completedPeers": 3,
    "targetCount": 3
  }
}
```

---

### Download Media

Download media files with automatic peer fallback.

**Endpoint:** `GET /media/:mediaId/download`

**Example:**
```bash
curl http://localhost:3005/api/media/a1b2c3d4e5f6789.../download -o downloaded-file.jpg
```

**Response Headers:**
```
Content-Type: image/jpeg
Content-Length: 1048576
Content-Disposition: attachment; filename="image.jpg"
X-Media-Source: local
X-Source-Peer: peer_hostname_timestamp_random
```

**Response:** Binary file data

---

### Download from Magnet URI

Download media from a BitTorrent magnet URI.

**Endpoint:** `POST /media/download-magnet`

**Content-Type:** `application/json`

**Parameters:**
- `magnetURI` (required): BitTorrent magnet URI

**Example:**
```bash
curl -X POST http://localhost:3005/api/media/download-magnet \
  -H "Content-Type: application/json" \
  -d '{"magnetURI": "magnet:?xt=urn:btih:abc123..."}'
```

**Response:**
```json
{
  "success": true,
  "mediaId": "a1b2c3d4e5f6789...",
  "fileSize": 1048576,
  "infoHash": "abc123..."
}
```

---

## Network & Peer Management

### Get Network Statistics

Retrieve comprehensive network health and performance statistics.

**Endpoint:** `GET /media/network/stats`

**Example:**
```bash
curl http://localhost:3005/api/media/network/stats
```

**Response:**
```json
{
  "coordinator": {
    "initialized": true,
    "uptime": 3600000,
    "networkHealth": "healthy"
  },
  "peers": {
    "selfPeerId": "peer_hostname_timestamp_random",
    "totalPeers": 5,
    "healthyPeers": 4,
    "uptime": 3600000,
    "lastHeartbeat": 1642781400000,
    "capabilities": {
      "seeding": true,
      "downloading": true,
      "relay": true,
      "encryption": true
    }
  },
  "replication": {
    "queueSize": 2,
    "activeReplications": 1,
    "completedReplications": 15,
    "targetReplicationCount": 3,
    "maxConcurrentReplications": 5
  },
  "seeder": {
    "totalTorrents": 10,
    "totalPeers": 25,
    "totalUploaded": 104857600,
    "totalDownloaded": 52428800
  },
  "activity": {
    "totalUploads": 20,
    "totalDownloads": 35,
    "totalReplications": 15
  }
}
```

---

### Get Peer Information

Retrieve information about discovered peers in the network.

**Endpoint:** `GET /media/peers`

**Example:**
```bash
curl http://localhost:3005/api/media/peers
```

**Response:**
```json
{
  "self": {
    "peerId": "peer_hostname_timestamp_random",
    "uptime": 3600000,
    "capabilities": {
      "seeding": true,
      "downloading": true,
      "relay": true,
      "encryption": true
    }
  },
  "peers": [
    {
      "peerId": "peer_node1_...",
      "hostname": "node1",
      "addresses": ["192.168.1.100"],
      "port": 3005,
      "apiEndpoint": "http://192.168.1.100:3005/api",
      "lastSeen": 1642781400000,
      "isHealthy": true,
      "capabilities": {
        "seeding": true,
        "downloading": true,
        "relay": true
      }
    }
  ],
  "summary": {
    "totalPeers": 5,
    "healthyPeers": 4,
    "lastHeartbeat": 1642781400000
  }
}
```

---

### Get Seeding Status

List media files currently being seeded by this node.

**Endpoint:** `GET /media/seeding`

**Example:**
```bash
curl http://localhost:3005/api/media/seeding
```

**Response:**
```json
{
  "stats": {
    "totalTorrents": 10,
    "totalPeers": 25,
    "totalUploaded": 104857600,
    "totalDownloaded": 52428800,
    "client": {
      "peerId": "webtorrent_client_id",
      "nodeId": "node_identifier"
    }
  },
  "seeding": [
    {
      "mediaId": "a1b2c3d4e5f6789...",
      "fileName": "image.jpg",
      "fileSize": 1048576,
      "contentType": "image/jpeg",
      "peers": 3,
      "uploaded": 3145728,
      "createdAt": "2025-01-21T15:30:00.000Z"
    }
  ]
}
```

---

## Security & Access Control

### Check Media Access

Verify if a user has access to encrypted media.

**Endpoint:** `POST /media/:mediaId/check-access`

**Content-Type:** `application/json`

**Parameters:**
- `userPublicKey` (required): User's public key for access verification

**Example:**
```bash
curl -X POST http://localhost:3005/api/media/a1b2c3d4e5f6789.../check-access \
  -H "Content-Type: application/json" \
  -d '{"userPublicKey": "user_public_key_here"}'
```

**Response:**
```json
{
  "mediaId": "a1b2c3d4e5f6789...",
  "hasAccess": true,
  "userPublicKey": "user_public_key_h...",
  "timestamp": 1642781400000
}
```

---

### Get Encryption Statistics

Retrieve encryption system statistics and configuration.

**Endpoint:** `GET /media/encryption/stats`

**Example:**
```bash
curl http://localhost:3005/api/media/encryption/stats
```

**Response:**
```json
{
  "cachedKeys": 5,
  "algorithm": "aes-256-gcm",
  "keyLength": 32,
  "keyRotationInterval": 604800000,
  "maxKeyAge": 2592000000
}
```

---

## Monitoring & Metrics

### Get Health Status

Check the overall health of the media distribution system.

**Endpoint:** `GET /media/health`

**Example:**
```bash
curl http://localhost:3005/api/media/health
```

**Response:**
```json
{
  "status": "healthy",
  "networkHealth": "healthy",
  "components": {
    "mediaSeeder": "ready",
    "peerRegistry": "ready",
    "replicationManager": "ready",
    "encryptionManager": "ready",
    "monitoringService": "ready",
    "maintenanceService": "ready"
  },
  "timestamp": "2025-01-21T15:30:00.000Z"
}
```

---

### Get Prometheus Metrics

Retrieve metrics in Prometheus format for monitoring systems.

**Endpoint:** `GET /media/metrics`

**Example:**
```bash
curl http://localhost:3005/api/media/metrics
```

**Response:**
```
# HELP media_uploads_total Total number of media uploads
# TYPE media_uploads_total counter
media_uploads_total 20

# HELP media_downloads_total Total number of media downloads
# TYPE media_downloads_total counter
media_downloads_total 35

# HELP active_peers Number of active peers
# TYPE active_peers gauge
active_peers 4

# HELP upload_duration_seconds Upload duration in seconds
# TYPE upload_duration_seconds histogram
upload_duration_seconds_bucket{le="0.1"} 5
upload_duration_seconds_bucket{le="0.5"} 12
upload_duration_seconds_bucket{le="1"} 18
upload_duration_seconds_bucket{le="+Inf"} 20
upload_duration_seconds_sum 15.5
upload_duration_seconds_count 20
```

---

### Get Monitoring Metrics (JSON)

Retrieve detailed monitoring metrics in JSON format.

**Endpoint:** `GET /media/monitoring/metrics`

**Example:**
```bash
curl http://localhost:3005/api/media/monitoring/metrics
```

**Response:**
```json
{
  "media_uploads_total": {
    "type": "counter",
    "value": 20,
    "help": "Total number of media uploads",
    "lastUpdated": 1642781400000
  },
  "active_peers": {
    "type": "gauge",
    "value": 4,
    "help": "Number of active peers",
    "lastUpdated": 1642781400000
  },
  "upload_duration_seconds": {
    "type": "histogram",
    "buckets": [
      {"le": "0.1", "count": 5},
      {"le": "0.5", "count": 12},
      {"le": "1", "count": 18}
    ],
    "sum": 15.5,
    "count": 20,
    "help": "Upload duration in seconds",
    "lastUpdated": 1642781400000
  }
}
```

---

### Get Active Alerts

Retrieve currently active monitoring alerts.

**Endpoint:** `GET /media/monitoring/alerts`

**Example:**
```bash
curl http://localhost:3005/api/media/monitoring/alerts
```

**Response:**
```json
{
  "alerts": [
    {
      "name": "high_replication_queue",
      "message": "Replication queue is backing up",
      "severity": "warning",
      "lastTriggered": 1642781400000,
      "triggerCount": 3
    }
  ],
  "count": 1,
  "timestamp": 1642781400000
}
```

---

## Maintenance & Operations

### Get Maintenance Status

Retrieve the status of automated maintenance tasks.

**Endpoint:** `GET /media/maintenance/status`

**Example:**
```bash
curl http://localhost:3005/api/media/maintenance/status
```

**Response:**
```json
{
  "tasks": [
    {
      "name": "cleanup_old_files",
      "description": "Remove old and unused media files",
      "priority": "medium",
      "enabled": true,
      "lastRun": 1642781400000,
      "runCount": 5,
      "failures": 0,
      "averageDuration": 2500
    },
    {
      "name": "backup_metadata",
      "description": "Backup critical metadata and configurations",
      "priority": "high",
      "enabled": true,
      "lastRun": 1642777800000,
      "runCount": 12,
      "failures": 0,
      "averageDuration": 1200
    }
  ],
  "recentHistory": [
    {
      "taskName": "health_diagnostics",
      "timestamp": 1642781400000,
      "duration": 500,
      "success": true,
      "error": null
    }
  ],
  "nextDueTask": {
    "name": "optimize_storage",
    "dueAt": 1642785000000,
    "overdue": false
  },
  "timestamp": 1642781400000
}
```

---

### Run Maintenance Task

Manually execute a specific maintenance task.

**Endpoint:** `POST /media/maintenance/run/:taskName`

**Available Tasks:**
- `cleanup_old_files` - Remove old and unused files
- `cleanup_logs` - Rotate and compress log files
- `optimize_storage` - Optimize storage and defragment
- `backup_metadata` - Create metadata backup
- `health_diagnostics` - Run system health checks
- `peer_cleanup` - Clean up stale peer data
- `replication_maintenance` - Maintain replication queues

**Example:**
```bash
curl -X POST http://localhost:3005/api/media/maintenance/run/cleanup_old_files
```

**Response:**
```json
{
  "success": true,
  "taskName": "cleanup_old_files",
  "result": true,
  "timestamp": 1642781400000
}
```

---

## Error Responses

All endpoints return consistent error responses:

**Format:**
```json
{
  "error": "Error description",
  "details": "Additional error details"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad Request (invalid parameters)
- `404` - Not Found (media or resource not found)
- `500` - Internal Server Error
- `503` - Service Unavailable (system not ready)

**Example Error:**
```json
{
  "error": "Media not found or unavailable",
  "details": "No peers available for download"
}
```

---

## Integration Examples

### Complete Upload-Download Workflow

```bash
# 1. Upload media with replication
RESPONSE=$(curl -s -X POST http://localhost:3005/api/media/upload \
  -F "file=@video.mp4" \
  -F "replicate=true" \
  -F "priority=8")

# 2. Extract media ID
MEDIA_ID=$(echo $RESPONSE | jq -r '.mediaId')

# 3. Check manifest and availability
curl http://localhost:3005/api/media/$MEDIA_ID/manifest

# 4. Download from network
curl http://localhost:3005/api/media/$MEDIA_ID/download -o downloaded-video.mp4
```

### Encrypted Media Workflow

```bash
# 1. Generate key pair (in practice, use proper cryptographic libraries)
USER_PRIVATE_KEY="your_private_key_here"
USER_PUBLIC_KEY="your_public_key_here"

# 2. Upload encrypted media
RESPONSE=$(curl -s -X POST http://localhost:3005/api/media/upload \
  -F "file=@confidential.pdf" \
  -F "encrypt=true" \
  -F "recipients=[\"$USER_PUBLIC_KEY\"]" \
  -F "accessLevel=private")

MEDIA_ID=$(echo $RESPONSE | jq -r '.mediaId')

# 3. Check access permission
curl -X POST http://localhost:3005/api/media/$MEDIA_ID/check-access \
  -H "Content-Type: application/json" \
  -d "{\"userPublicKey\":\"$USER_PUBLIC_KEY\"}"

# 4. Download (requires proper decryption on client side)
curl http://localhost:3005/api/media/$MEDIA_ID/download -o encrypted-file.pdf
```

### Monitoring Integration

```bash
# Set up Prometheus scraping
curl http://localhost:3005/api/media/metrics

# Check system health
curl http://localhost:3005/api/media/health

# Monitor network status
curl http://localhost:3005/api/media/network/stats

# Check for alerts
curl http://localhost:3005/api/media/monitoring/alerts
```

---

## Rate Limits & Best Practices

### Recommended Practices

1. **File Size Limits**: Keep individual files under 100MB for optimal P2P performance
2. **Batch Operations**: Use replication priorities to manage network load
3. **Monitoring**: Regularly check `/health` and `/monitoring/alerts` endpoints
4. **Maintenance**: Allow automated maintenance tasks to run regularly
5. **Security**: Always use encryption for sensitive media files

### Performance Considerations

- **Upload Performance**: Larger files take longer to create torrents and replicate
- **Download Performance**: Files with more peers download faster
- **Network Load**: High replication priorities may impact network performance
- **Storage**: Monitor disk space using maintenance endpoints

### Security Considerations

- **Encryption Keys**: Store private keys securely, never expose in API calls
- **Access Control**: Regularly audit recipient lists for encrypted media
- **Network Security**: Use HTTPS in production deployments
- **Monitoring**: Set up alerts for security-related events

---

## Support & Troubleshooting

### Common Issues

**Media Not Found (404)**
- Check if media ID is correct
- Verify media hasn't expired (for encrypted files)
- Check network connectivity to peers

**Upload Failures (500)**
- Verify file size is within limits
- Check disk space using maintenance endpoints
- Ensure all system components are healthy

**Access Denied for Encrypted Media**
- Verify user public key is in recipients list
- Check if media has expired
- Ensure encryption system is operational

### Debugging

Use the health and monitoring endpoints to diagnose issues:

```bash
# Check overall system health
curl http://localhost:3005/api/media/health

# Get detailed network statistics
curl http://localhost:3005/api/media/network/stats

# Check for active alerts
curl http://localhost:3005/api/media/monitoring/alerts

# Review maintenance status
curl http://localhost:3005/api/media/maintenance/status
```

---

*This documentation covers the complete GUN Media Distribution API. For additional support or feature requests, please refer to the project documentation or contact the development team.*
