#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# WordPress Auto-Configuration Entrypoint
# ═══════════════════════════════════════════════════════════════════════════════
# 
# This script automatically configures WordPress on first run, skipping the
# installation wizard. Useful for anonymous Onion Press deployments.
#
# Environment Variables:
#   WP_AUTO_INSTALL=true          - Enable auto-installation
#   WP_SITE_URL=https://domain.com/wordpress - Full public URL including /wordpress path
#   WP_SITE_TITLE=Onion Press     - Site title
#   WP_ADMIN_USER=admin           - Admin username
#   WP_ADMIN_PASSWORD=<random>    - Admin password (auto-generated if not set)
#   WP_ADMIN_EMAIL=noreply@localhost - Admin email (can be fake)
#
# ═══════════════════════════════════════════════════════════════════════════════

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "  WORDPRESS ENTRYPOINT"
echo "═══════════════════════════════════════════════════════════════"
echo "  WP_SITE_URL: ${WP_SITE_URL:-not set}"
echo "  WP_AUTO_INSTALL: ${WP_AUTO_INSTALL:-false}"
echo "═══════════════════════════════════════════════════════════════"

# Execute the original WordPress entrypoint in background to set up wp-config.php
# We need to let it run first to create the config file
docker-entrypoint.sh apache2-foreground &
APACHE_PID=$!

# Wait for wp-config.php to be created
echo "⏳ Waiting for WordPress initialization..."
for i in {1..60}; do
    if [ -f /var/www/html/wp-config.php ]; then
        echo "✅ wp-config.php created"
        break
    fi
    sleep 1
done

# Wait for database to be ready
echo "⏳ Waiting for database..."
for i in {1..60}; do
    if mysql -h"${WORDPRESS_DB_HOST:-wordpress-db}" -u"${WORDPRESS_DB_USER:-wordpress}" -p"${WORDPRESS_DB_PASSWORD:-wordpress}" -e "SELECT 1" > /dev/null 2>&1; then
        echo "✅ Database is ready"
        break
    fi
    sleep 2
done

# Small delay to ensure Apache has started
sleep 3

# Check if WordPress is already installed
if wp core is-installed --allow-root 2>/dev/null; then
    echo "✅ WordPress already installed"
    
    # Update URLs if they've changed (e.g., domain change)
    if [ -n "${WP_SITE_URL}" ]; then
        CURRENT_URL=$(wp option get siteurl --allow-root 2>/dev/null || echo "")
        if [ "${CURRENT_URL}" != "${WP_SITE_URL}" ]; then
            echo "🔄 Updating site URLs to ${WP_SITE_URL}..."
            wp option update home "${WP_SITE_URL}" --allow-root || true
            wp option update siteurl "${WP_SITE_URL}" --allow-root || true
        fi
        # Force update to ensure WordPress uses the correct URL for redirects
        wp option update home "${WP_SITE_URL}" --allow-root || true
        wp option update siteurl "${WP_SITE_URL}" --allow-root || true
    fi
else
    # Check if auto-install is enabled
    if [ "${WP_AUTO_INSTALL:-false}" = "true" ]; then
        echo "🔧 Auto-installing WordPress..."
        
        # Generate password if not provided
        if [ -z "${WP_ADMIN_PASSWORD}" ]; then
            WP_ADMIN_PASSWORD=$(openssl rand -base64 16)
            PASSWORD_GENERATED=true
        fi
        
        # Install WordPress with the proxy URL
        wp core install \
            --url="${WP_SITE_URL:-http://localhost:8080}" \
            --title="${WP_SITE_TITLE:-Onion Press}" \
            --admin_user="${WP_ADMIN_USER:-admin}" \
            --admin_password="${WP_ADMIN_PASSWORD}" \
            --admin_email="${WP_ADMIN_EMAIL:-noreply@localhost.invalid}" \
            --skip-email \
            --allow-root
        
        echo ""
        echo "═══════════════════════════════════════════════════════════════"
        echo "🔐 WORDPRESS ADMIN CREDENTIALS"
        echo "═══════════════════════════════════════════════════════════════"
        echo "   URL:      ${WP_SITE_URL:-http://localhost:8080}/wp-admin/"
        echo "   Username: ${WP_ADMIN_USER:-admin}"
        if [ "${PASSWORD_GENERATED}" = "true" ]; then
            echo "   Password: ${WP_ADMIN_PASSWORD} (auto-generated)"
        else
            echo "   Password: (as configured)"
        fi
        echo "═══════════════════════════════════════════════════════════════"
        echo ""
        
        # Activate OP Publisher plugin if present
        if [ -d /var/www/html/wp-content/plugins/op-publisher ]; then
            echo "🔌 Activating OP Publisher plugin..."
            wp plugin activate op-publisher --allow-root || true
        fi
        
        # Disable unnecessary default features for privacy
        echo "🔒 Configuring privacy settings..."
        wp option update blog_public 0 --allow-root || true  # Discourage search engines
        wp option update default_pingback_flag 0 --allow-root || true
        wp option update default_ping_status closed --allow-root || true
        
        echo "✅ WordPress auto-installation complete!"
    else
        echo "ℹ️  WordPress not installed. Complete setup at ${WP_SITE_URL:-/}/wp-admin/install.php"
        echo "   Tip: Set WP_AUTO_INSTALL=true to auto-configure on startup"
    fi
fi

# Wait for Apache to exit (keeps container running)
wait $APACHE_PID
