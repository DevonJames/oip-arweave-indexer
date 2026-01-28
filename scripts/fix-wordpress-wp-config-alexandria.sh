#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  FIXING WORDPRESS wp-config.php URL CONSTANTS"
echo "═══════════════════════════════════════════════════════════════"
echo ""

WORDPRESS_CONTAINER="alexandria-wordpress-1"
CORRECT_URL="https://alexandria.io/wordpress"

echo "🔄 Fixing WP_HOME and WP_SITEURL in wp-config.php..."
echo "   Setting to: $CORRECT_URL"
echo ""

# Create a backup first
docker exec -it $WORDPRESS_CONTAINER cp /var/www/html/wp-config.php /var/www/html/wp-config.php.backup

# Fix WP_HOME
docker exec -it $WORDPRESS_CONTAINER sh -c "
if grep -q \"define.*WP_HOME\" /var/www/html/wp-config.php; then
    sed -i \"s|define.*WP_HOME.*|define('WP_HOME', '$CORRECT_URL');|g\" /var/www/html/wp-config.php
    echo '✅ Updated WP_HOME'
else
    echo '⚠️  WP_HOME not found in wp-config.php'
fi
"

# Fix WP_SITEURL
docker exec -it $WORDPRESS_CONTAINER sh -c "
if grep -q \"define.*WP_SITEURL\" /var/www/html/wp-config.php; then
    sed -i \"s|define.*WP_SITEURL.*|define('WP_SITEURL', '$CORRECT_URL');|g\" /var/www/html/wp-config.php
    echo '✅ Updated WP_SITEURL'
else
    echo '⚠️  WP_SITEURL not found in wp-config.php'
fi
"

echo ""
echo "🔍 Verifying changes:"
docker exec -it $WORDPRESS_CONTAINER grep -E "WP_HOME|WP_SITEURL" /var/www/html/wp-config.php | head -2

echo ""
echo "🔄 Flushing permalinks..."
docker exec -it $WORDPRESS_CONTAINER wp rewrite flush --allow-root

echo ""
echo "✅ wp-config.php updated!"
echo ""
echo "⚠️  IMPORTANT: Make sure your .env has:"
echo "   PUBLIC_API_BASE_URL=https://alexandria.io"
echo "   (without /wordpress - it's added automatically)"
echo ""
echo "Then restart WordPress container to prevent it from reverting:"
echo "   docker restart $WORDPRESS_CONTAINER"
echo ""
