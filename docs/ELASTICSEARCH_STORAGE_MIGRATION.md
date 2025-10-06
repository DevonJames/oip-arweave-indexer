# Elasticsearch Storage Migration Guide

## Overview

Elasticsearch storage has been migrated from **Docker-managed volumes** to **host filesystem bind mounts**. This change prevents hitting Docker's disk image space limits and gives you direct access to Elasticsearch data on your host filesystem.

## What Changed?

### Before (Docker-managed volume)
```yaml
volumes:
  - esdata:/usr/share/elasticsearch/data
```
- Data stored in Docker's internal volume: `/var/lib/docker/volumes/`
- Limited by Docker's disk image size
- Not directly accessible on host

### After (Host bind mount)
```yaml
volumes:
  - ${ELASTICSEARCH_DATA_PATH:-./elasticsearch_data}:/usr/share/elasticsearch/data
```
- Data stored on your host filesystem
- Full access to host disk space (1.1+ TB typically)
- Directly accessible and manageable

## Configuration

### Environment Variable

Add to your `.env` file:

```bash
# Default: stores in project directory
ELASTICSEARCH_DATA_PATH=./elasticsearch_data

# Or use absolute path for more space:
ELASTICSEARCH_DATA_PATH=/data/elasticsearch

# Or custom location:
ELASTICSEARCH_DATA_PATH=/mnt/storage/elasticsearch
```

### Choosing a Location

**Option 1: Project Directory (Default)**
```bash
ELASTICSEARCH_DATA_PATH=./elasticsearch_data
```
- ✅ Simple, keeps everything together
- ✅ Easy to backup with project
- ⚠️  Limited by project partition space

**Option 2: Dedicated Data Directory**
```bash
ELASTICSEARCH_DATA_PATH=/data/elasticsearch
```
- ✅ Can use separate partition with more space
- ✅ Independent of project location
- ✅ Better for production deployments
- ⚠️  Requires creating `/data` directory first

**Option 3: Custom Path**
```bash
ELASTICSEARCH_DATA_PATH=/mnt/bigdisk/elasticsearch
```
- ✅ Maximum flexibility
- ✅ Can use external drives or NFS mounts
- ⚠️  Make sure path exists and has correct permissions

## Migration Process

### Check Current Storage Status

```bash
make check-es-storage
```

This shows:
- Current storage location
- Disk space available
- Whether old Docker volume exists
- Data size

### Migrate Existing Data

If you have existing Elasticsearch data in a Docker volume:

```bash
# 1. Stop services
make down

# 2. Migrate data to host filesystem
make migrate-elasticsearch-data

# 3. Start services with your profile
make up PROFILE=standard
```

The migration tool will:
- ✅ Automatically detect your old Docker volume
- ✅ Copy all data to the new location
- ✅ Set correct permissions (elasticsearch user: 1000:1000)
- ✅ Verify data integrity

### Clean Up Old Volume

After verifying the migration worked:

```bash
# Remove old Docker volume to free space
make clean-old-es-volume
```

⚠️  **Wait 10 seconds before confirming** - this is destructive!

## Fresh Installation

For new installations, no migration is needed:

```bash
# 1. Configure path in .env (optional)
echo "ELASTICSEARCH_DATA_PATH=/data/elasticsearch" >> .env

# 2. Create directory with correct permissions
sudo mkdir -p /data/elasticsearch
sudo chown -R 1000:1000 /data/elasticsearch

# 3. Start services
make up PROFILE=standard
```

Elasticsearch will automatically initialize the data directory.

## Troubleshooting

### Permission Issues

If Elasticsearch fails to start with permission errors:

```bash
# Fix permissions (elasticsearch runs as user 1000)
sudo chown -R 1000:1000 /path/to/elasticsearch_data
```

### Disk Space Issues

Check available space:

```bash
df -h /path/to/elasticsearch_data
```

If low on space, change `ELASTICSEARCH_DATA_PATH` to a location with more space:

```bash
# 1. Stop services
make down

# 2. Update .env
ELASTICSEARCH_DATA_PATH=/new/location/with/more/space

# 3. Move existing data (if any)
sudo mv ./elasticsearch_data /new/location/with/more/space/elasticsearch_data

# 4. Fix permissions
sudo chown -R 1000:1000 /new/location/with/more/space/elasticsearch_data

# 5. Start services
make up PROFILE=standard
```

### Container Won't Start

Check Elasticsearch logs:

```bash
docker-compose logs elasticsearch
```

Common issues:
- **Permission denied**: Run `sudo chown -R 1000:1000 /path/to/data`
- **Directory not found**: Make sure `ELASTICSEARCH_DATA_PATH` directory exists
- **Disk full**: Check `df -h` and move to larger partition

## Affected Docker Compose Files

All three docker-compose files have been updated:

1. **docker-compose.yml** - Main file (all profiles)
2. **docker-compose-backend-only.yml** - Backend-only deployments
3. **docker-compose-voice-enhanced.yml** - Voice-enhanced stack

All now use `${ELASTICSEARCH_DATA_PATH:-./elasticsearch_data}` for consistency.

## Benefits

✅ **More Space**: Access full host disk space, not limited by Docker's disk image

✅ **Better Performance**: Direct filesystem access, no Docker volume layer

✅ **Easy Backup**: Data is directly accessible on host for backup tools

✅ **Easy Migration**: Can move data directory between systems easily

✅ **Monitoring**: Can monitor disk usage with standard tools (`du`, `df`)

✅ **Flexibility**: Can use network mounts, external drives, etc.

## Rollback (If Needed)

If you need to go back to Docker-managed volumes:

1. Stop services: `make down`
2. Edit docker-compose files to use `esdata:/usr/share/elasticsearch/data`
3. Restore volume definition in volumes section
4. Copy data back: `docker run --rm -v ./elasticsearch_data:/source -v esdata:/target alpine cp -av /source/. /target/`
5. Start services: `make up PROFILE=standard`

## Support

For issues or questions:
- Check `make check-es-storage` for current status
- Review Elasticsearch logs: `docker-compose logs elasticsearch`
- Verify permissions: `ls -la /path/to/elasticsearch_data`
