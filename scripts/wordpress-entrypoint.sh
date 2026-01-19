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
#   WP_SITE_TITLE=Onion Press     - Site title
#   WP_ADMIN_USER=admin           - Admin username
#   WP_ADMIN_PASSWORD=<random>    - Admin password (auto-generated if not set)
#   WP_ADMIN_EMAIL=noreply@localhost - Admin email (can be fake)
#
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# Wait for database to be ready
echo "⏳ Waiting for database..."
until mysql -h"${WORDPRESS_DB_HOST:-wordpress-db}" -u"${WORDPRESS_DB_USER:-wordpress}" -p"${WORDPRESS_DB_PASSWORD:-wordpress}" -e "SELECT 1" > /dev/null 2>&1; do
    sleep 2
done
echo "✅ Database is ready"

# Check if WordPress is already installed
if wp core is-installed --allow-root 2>/dev/null; then
    echo "✅ WordPress already installed"
else
    # Check if auto-install is enabled
    if [ "${WP_AUTO_INSTALL:-false}" = "true" ]; then
        echo "🔧 Auto-installing WordPress..."
        
        # Generate password if not provided
        WP_ADMIN_PASSWORD=${WP_ADMIN_PASSWORD:-$(openssl rand -base64 16)}
        
        # Wait for wp-config.php to be created by the official entrypoint
        while [ ! -f /var/www/html/wp-config.php ]; do
            echo "   Waiting for wp-config.php..."
            sleep 2
        done
        
        # Install WordPress
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
        echo "   URL:      ${WP_SITE_URL:-http://localhost:8080}/wp-admin"
        echo "   Username: ${WP_ADMIN_USER:-admin}"
        echo "   Password: ${WP_ADMIN_PASSWORD}"
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
        echo "ℹ️  WordPress not installed. Complete setup at /wp-admin/install.php"
        echo "   Tip: Set WP_AUTO_INSTALL=true to auto-configure on startup"
    fi
fi

# Execute the original WordPress entrypoint
exec docker-entrypoint.sh "$@"
