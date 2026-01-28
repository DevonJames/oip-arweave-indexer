# Onion Press Setup Guide

Complete step-by-step guide for setting up Onion Press with WordPress integration.

## Prerequisites

- Docker and Docker Compose installed
- `.env` file configured (copy from `example env` if needed)
- Access to the server/container where WordPress will run

## Step-by-Step Setup

### 1. Configure Environment Variables

Add these variables to your `.env` file:

```bash
# ═══════════════════════════════════════════════════════════════════════════
# ONION PRESS CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

# Public API URL (base URL of your OIP daemon - DO NOT include /wordpress)
# Example: http://localhost:3075 (if daemon runs on port 3075)
# Example: https://your-domain.com (for production)
PUBLIC_API_BASE_URL=http://localhost:3075

# ═══════════════════════════════════════════════════════════════════════════
# WORDPRESS CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

# WordPress Admin User (default: admin)
WP_ADMIN_USER=admin

# WordPress Application Password (created in step 3)
# IMPORTANT: Must include spaces every 4 characters (e.g., "xxxx xxxx xxxx xxxx")
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx xxxx

# WordPress Auto-Install (optional - skips installation wizard)
WP_AUTO_INSTALL=true
WP_SITE_TITLE=Onion Press
WP_ADMIN_EMAIL=noreply@localhost.invalid
```

**Important Notes:**
- `PUBLIC_API_BASE_URL` should **NOT** include `/wordpress` - it's automatically appended
- `WP_APP_PASSWORD` must include spaces (WordPress displays them with spaces, but `wp-cli` outputs them without)
- If `WP_AUTO_INSTALL=true`, WordPress will be automatically configured on first run

### 2. Create WordPress Admin User (if not using auto-install)

If `WP_AUTO_INSTALL=false`, you'll need to create an admin user manually:

```bash
# For alexandria node
docker exec -it alexandria-wordpress-1 wp user create admin admin@localhost.invalid --role=administrator --allow-root

# For onionpress node
docker exec -it onionpress-wordpress-1 wp user create admin admin@localhost.invalid --role=administrator --allow-root
```

**Or** use the WordPress web interface at `http://your-domain:PORT/wordpress/wp-admin/install.php`

### 3. Create Application Password

Create an Application Password for the admin user:

```bash
# For alexandria node
docker exec -it alexandria-wordpress-1 wp user application-password create admin "Onion Press API" --allow-root

# For onionpress node
docker exec -it onionpress-wordpress-1 wp user application-password create admin "Onion Press API" --allow-root
```

**Important:** The `wp-cli` command outputs the password **without spaces**, but WordPress REST API expects it **with spaces** (every 4 characters).

**To add spaces manually:**
```bash
# If the output is: xxxxxxxxxxxxxxxxxxxxxxxx
# You need: xxxx xxxx xxxx xxxx xxxx xxxx xxxx

# Quick sed command to add spaces:
echo "xxxxxxxxxxxxxxxxxxxxxxxx" | sed 's/.\{4\}/& /g' | sed 's/ $//'
```

Copy the password **with spaces** and add it to your `.env` file as `WP_APP_PASSWORD`.

### 4. Run WordPress Authentication Fix Script

This script creates a WordPress mu-plugin that enables Application Passwords over HTTP (required for Docker environments):

```bash
# For alexandria node
./scripts/fix-wordpress-auth-alexandria.sh

# For onionpress node
./scripts/fix-wordpress-auth-v3.sh
```

This script:
- Creates the mu-plugins directory
- Installs `op-rest-api-auth-fix.php` mu-plugin
- Enables Application Passwords over HTTP
- Handles Basic Auth properly (strips spaces from Application Passwords for authentication)

### 5. Flush WordPress Permalinks

WordPress permalinks must be flushed to ensure REST API endpoints work correctly:

```bash
# For alexandria node
./scripts/fix-wordpress-permalinks-alexandria.sh

# For onionpress node (create similar script or run manually)
docker exec -it onionpress-wordpress-1 wp rewrite flush --allow-root
```

This fixes the issue where `/wp-json/wp/v2/posts/` returns HTML instead of JSON.

### 6. Rebuild and Start Services

Rebuild the Onion Press server profile:

```bash
make -f Makefile.split rebuild-onion-press-server
```

Or if starting fresh:

```bash
make -f Makefile.split onion-press-server
```

### 7. Verify Setup

Test WordPress authentication:

```bash
# For alexandria node
docker exec -it alexandria-oip-daemon-service-1 node scripts/test-wordpress-auth.js

# For onionpress node
docker exec -it onionpress-oip-daemon-service-1 node scripts/test-wordpress-auth.js
```

You should see successful authentication messages.

## Troubleshooting

### WordPress returns HTML instead of JSON

**Symptom:** REST API endpoints return HTML (login page) instead of JSON.

**Solutions:**
1. Run the permalink flush script (step 5)
2. Verify `PUBLIC_API_BASE_URL` is set correctly in `.env`
3. Restart WordPress container: `docker restart alexandria-wordpress-1`

### Application Password authentication fails

**Symptom:** 401 errors, "HTML instead of JSON" errors.

**Solutions:**
1. Verify `WP_APP_PASSWORD` has spaces (every 4 characters)
2. Run the authentication fix script (step 4)
3. Check WordPress logs: `docker logs alexandria-wordpress-1 | grep "OP Auth Fix"`
4. Verify the Application Password wasn't revoked in WordPress admin

### WordPress doesn't know the correct URL

**Symptom:** Redirects to wrong URL, permalinks broken.

**Solutions:**
1. Verify `PUBLIC_API_BASE_URL` is set correctly (without `/wordpress`)
2. Restart WordPress container to apply new environment variables
3. Run permalink flush script again

### User sync fails

**Symptom:** Posts attributed to admin instead of logged-in user.

**Solutions:**
1. Verify Application Password is correct
2. Check that the mu-plugin is installed: `docker exec -it alexandria-wordpress-1 ls -la /var/www/html/wp-content/mu-plugins/`
3. Check WordPress authentication logs

## Node-Specific Notes

### Alexandria Node

- Container prefix: `alexandria-`
- Use `fix-wordpress-auth-alexandria.sh`
- Use `fix-wordpress-permalinks-alexandria.sh`

### Onionpress Node

- Container prefix: `onionpress-`
- Use `fix-wordpress-auth-v3.sh`
- Create permalink flush script or run manually

## Environment Variables Reference

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `PUBLIC_API_BASE_URL` | Base URL of OIP daemon (no `/wordpress`) | `http://localhost:3075` | Yes |
| `WP_ADMIN_USER` | WordPress admin username | `admin` | No (default: `admin`) |
| `WP_APP_PASSWORD` | Application Password with spaces | `xxxx xxxx xxxx xxxx` | Yes |
| `WP_AUTO_INSTALL` | Auto-configure WordPress | `true` | No |
| `WP_SITE_TITLE` | WordPress site title | `Onion Press` | No |
| `WP_ADMIN_EMAIL` | Admin email (can be fake) | `noreply@localhost.invalid` | No |

## Quick Reference

```bash
# 1. Set environment variables in .env
PUBLIC_API_BASE_URL=http://localhost:3075
WP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx xxxx

# 2. Create Application Password (if not using auto-install)
docker exec -it alexandria-wordpress-1 wp user application-password create admin "Onion Press API" --allow-root

# 3. Run authentication fix
./scripts/fix-wordpress-auth-alexandria.sh

# 4. Flush permalinks
./scripts/fix-wordpress-permalinks-alexandria.sh

# 5. Rebuild
make -f Makefile.split rebuild-onion-press-server

# 6. Test
docker exec -it alexandria-oip-daemon-service-1 node scripts/test-wordpress-auth.js
```

## Additional Resources

- [Onion Press Guide](./ONION_PRESS_GUIDE.md) - Comprehensive user guide
- [WordPress REST API Documentation](https://developer.wordpress.org/rest-api/)
- [Application Passwords Documentation](https://wordpress.org/support/article/application-passwords/)
