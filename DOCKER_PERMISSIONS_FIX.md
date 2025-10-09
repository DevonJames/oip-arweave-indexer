# Docker Permissions Fix for Linux Servers

## Problem

When Docker containers run on Linux servers, they typically run as `root` by default. This means any files created by the container (like uploaded media files in `data/media/`) are owned by `root:root`, which can cause:

1. **Git pull errors** - Your user can't create/modify `.gitkeep` files
2. **File access issues** - Your user can't manage media files
3. **Build failures** - Permission denied when copying files

## Quick Fix

### Option 1: Use the Helper Script (Recommended)

```bash
# Run this after any rebuild or when you encounter permission issues
./fix-permissions.sh
```

This script will:
- Fix ownership to your current user
- Set proper permissions (755)
- Create directory structure if missing

### Option 2: Manual Fix

```bash
# Change ownership of data directory
sudo chown -R $USER:$USER ./data

# Set proper permissions
sudo chmod -R 755 ./data
```

## When to Run This

You should run the permission fix:
- ✅ After `git pull` if you get "Permission denied" errors
- ✅ After `docker-compose up` or rebuilds
- ✅ Before committing if Docker created new files
- ✅ If you can't access/modify media files

## Workflow Integration

### Recommended Workflow on Linux Servers:

```bash
# 1. Stop containers
docker-compose down

# 2. Fix permissions before pulling
./fix-permissions.sh

# 3. Pull latest changes
git pull

# 4. Rebuild
make rebuild-standard-gpu  # or your preferred profile

# 5. Fix permissions after Docker creates files
./fix-permissions.sh
```

## Why This Happens

- **Mac/Windows**: Docker Desktop runs containers in a VM with user mapping, so files appear as your user
- **Linux**: Docker runs directly on the host, so container's root = host's root
- **Solution**: Either run containers as your user ID, or fix permissions after creation

## Advanced: Run Docker as Your User (Optional)

If you want to prevent this issue entirely, you can configure Docker to run as your user ID by adding to `docker-compose.yml`:

```yaml
services:
  oip-gpu:
    user: "1000:1000"  # Replace with your UID:GID (run 'id' to find)
    # ... rest of config
```

⚠️ **Note**: This approach requires:
- Setting your specific UID:GID (different for each user)
- May cause issues on Mac/Windows development environments
- Not recommended for a multi-developer repository

## Current Status

✅ `fix-permissions.sh` script available  
✅ Works on any Linux server  
✅ Automatically detects your user/group  
✅ No docker-compose changes needed  

## Related Files

- `data/media/` - Media uploads directory (created by Docker)
- `data/media/web/` - Web-accessible media files
- `data/media/.gitkeep` - Keeps directory structure in Git
- `elasticsearch_data/` - May also need permission fixes

