#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  DEBUGGING WORDPRESS AUTHENTICATION"
echo "═══════════════════════════════════════════════════════════════"
echo ""

echo "1. Checking if mu-plugin exists:"
docker exec -it onionpress-wordpress-1 ls -la /var/www/html/wp-content/mu-plugins/ 2>/dev/null || echo "Directory doesn't exist"
echo ""

echo "2. Checking WordPress error log:"
docker exec -it onionpress-wordpress-1 tail -50 /var/www/html/wp-content/debug.log 2>/dev/null || echo "Debug log not found"
echo ""

echo "3. Testing Application Password directly with wp-cli (bypassing REST API):"
docker exec -it onionpress-wordpress-1 wp user get devon --field=user_login --allow-root
echo ""

echo "4. Verifying Application Password exists:"
docker exec -it onionpress-wordpress-1 wp user application-password list devon --allow-root | head -5
echo ""

echo "5. Testing Basic Auth from WordPress container itself:"
docker exec -it onionpress-wordpress-1 sh -c '
echo "Testing with Application Password WITHOUT spaces:"
curl -v -u "devon:qYOjEpuUYTU1CIkKH0ijr3h8" \
    -H "Accept: application/json" \
    http://localhost/wp-json/wp/v2/users/me 2>&1 | grep -A 5 "< HTTP"
'
echo ""

echo "6. Checking PHP error log:"
docker exec -it onionpress-wordpress-1 tail -20 /var/log/apache2/error.log 2>/dev/null || docker exec -it onionpress-wordpress-1 tail -20 /var/log/php*.log 2>/dev/null || echo "PHP error log not found"
echo ""

echo "═══════════════════════════════════════════════════════════════"
