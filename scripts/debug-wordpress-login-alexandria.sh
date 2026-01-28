#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  DEBUGGING WORDPRESS LOGIN FOR ALEXANDRIA NODE"
echo "═══════════════════════════════════════════════════════════════"
echo ""

WORDPRESS_CONTAINER="alexandria-wordpress-1"

echo "1️⃣ Listing all WordPress users with details:"
docker exec -it $WORDPRESS_CONTAINER wp user list --allow-root --format=table

echo ""
echo "2️⃣ Checking user 'devon' specifically:"
docker exec -it $WORDPRESS_CONTAINER wp user get devon --allow-root --format=table 2>&1

echo ""
echo "3️⃣ Checking WordPress error log (last 50 lines):"
docker exec -it $WORDPRESS_CONTAINER tail -50 /var/www/html/wp-content/debug.log 2>/dev/null || echo "⚠️  Debug log not found or empty"

echo ""
echo "4️⃣ Checking Apache/PHP error logs:"
docker exec -it $WORDPRESS_CONTAINER tail -30 /var/log/apache2/error.log 2>/dev/null || docker exec -it $WORDPRESS_CONTAINER tail -30 /var/log/php*.log 2>/dev/null || echo "⚠️  Error log not found"

echo ""
echo "5️⃣ Checking WordPress site URL configuration:"
docker exec -it $WORDPRESS_CONTAINER wp option get siteurl --allow-root
docker exec -it $WORDPRESS_CONTAINER wp option get home --allow-root

echo ""
echo "6️⃣ Checking if any authentication plugins are active:"
docker exec -it $WORDPRESS_CONTAINER wp plugin list --status=active --allow-root | grep -i "auth\|login\|security" || echo "No auth/login plugins found"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "💡 TIP: Try logging in with the email address instead of username"
echo "═══════════════════════════════════════════════════════════════"
echo ""
