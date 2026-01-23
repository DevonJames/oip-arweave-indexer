#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  CHECKING WORDPRESS APPLICATION PASSWORD CONFIGURATION"
echo "═══════════════════════════════════════════════════════════════"
echo ""

echo "1. Checking WordPress version (Application Passwords require 5.6+):"
docker exec -it onionpress-wordpress-1 wp core version --allow-root
echo ""

echo "2. Checking if Application Passwords are enabled:"
docker exec -it onionpress-wordpress-1 wp option get application_passwords --allow-root 2>/dev/null || echo "Option not found (this is OK - Application Passwords are enabled by default)"
echo ""

echo "3. Checking WordPress site URL (Application Passwords may require HTTPS):"
docker exec -it onionpress-wordpress-1 wp option get siteurl --allow-root
docker exec -it onionpress-wordpress-1 wp option get home --allow-root
echo ""

echo "4. Testing Application Password directly with wp-cli:"
docker exec -it onionpress-wordpress-1 wp user application-password verify devon qYOjEpuUYTU1CIkKH0ijr3h8 --allow-root 2>&1 || echo "wp-cli doesn't have a verify command, trying REST API test..."
echo ""

echo "5. Testing REST API authentication from WordPress container:"
docker exec -it onionpress-wordpress-1 sh -c '
    echo "Testing Basic Auth with Application Password..."
    echo "Username: devon"
    echo "Password: qYOjEpuUYTU1CIkKH0ijr3h8"
    echo ""
    echo "Request:"
    curl -v -u "devon:qYOjEpuUYTU1CIkKH0ijr3h8" \
        -H "Accept: application/json" \
        http://localhost/wp-json/wp/v2/users/me 2>&1 | head -30
'
echo ""

echo "6. Checking WordPress debug log for authentication errors:"
docker exec -it onionpress-wordpress-1 tail -20 /var/www/html/wp-content/debug.log 2>/dev/null || echo "Debug log not found or empty"
echo ""

echo "═══════════════════════════════════════════════════════════════"
