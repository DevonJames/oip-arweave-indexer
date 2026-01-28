#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  FIXING WORDPRESS URL CONFIGURATION FOR ALEXANDRIA NODE"
echo "═══════════════════════════════════════════════════════════════"
echo ""

WORDPRESS_CONTAINER="alexandria-wordpress-1"

# The correct URL should be https://alexandria.io/wordpress
# This is what WordPress should think its URL is (behind the proxy)
CORRECT_URL="https://alexandria.io/wordpress"

echo "🔄 Setting WordPress site URL to: $CORRECT_URL"
docker exec -it $WORDPRESS_CONTAINER wp option update home "$CORRECT_URL" --allow-root
docker exec -it $WORDPRESS_CONTAINER wp option update siteurl "$CORRECT_URL" --allow-root

# Check wp-config.php for URL constants (they override database options)
echo "🔄 Checking wp-config.php for URL constants..."
WP_HOME_FOUND=$(docker exec -it $WORDPRESS_CONTAINER grep -c 'WP_HOME' /var/www/html/wp-config.php 2>/dev/null || echo "0")
WP_SITEURL_FOUND=$(docker exec -it $WORDPRESS_CONTAINER grep -c 'WP_SITEURL' /var/www/html/wp-config.php 2>/dev/null || echo "0")

if [ "$WP_HOME_FOUND" != "0" ] || [ "$WP_SITEURL_FOUND" != "0" ]; then
    echo "⚠️  Found URL constants in wp-config.php (these override database settings):"
    docker exec -it $WORDPRESS_CONTAINER grep -E 'WP_HOME|WP_SITEURL' /var/www/html/wp-config.php 2>/dev/null || true
    echo ""
    echo "⚠️  These constants override database options. Check your docker-compose environment variables."
    echo "    Look for WORDPRESS_CONFIG_EXTRA in docker-compose-split.yml"
fi

echo ""
echo "🔄 Flushing permalinks..."
docker exec -it $WORDPRESS_CONTAINER wp rewrite flush --allow-root

echo ""
echo "✅ WordPress URL configuration updated!"
echo ""
echo "Current configuration:"
echo "  home:    $(docker exec -it $WORDPRESS_CONTAINER wp option get home --allow-root)"
echo "  siteurl: $(docker exec -it $WORDPRESS_CONTAINER wp option get siteurl --allow-root)"
echo ""
echo "⚠️  IMPORTANT: Make sure your .env has:"
echo "   PUBLIC_API_BASE_URL=https://alexandria.io"
echo "   (without /wordpress - it's added automatically)"
echo ""
echo "Now try logging in again at: https://alexandria.io/wordpress/wp-admin/"
echo ""
