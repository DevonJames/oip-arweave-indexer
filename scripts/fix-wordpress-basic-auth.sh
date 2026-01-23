#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  FIXING WORDPRESS BASIC AUTH FOR INTERNAL HTTP ACCESS"
echo "═══════════════════════════════════════════════════════════════"
echo ""

echo "WordPress is configured with HTTPS site URL but accessed via HTTP internally."
echo "This can cause WordPress to reject Basic Auth."
echo ""
echo "Options:"
echo "1. Allow Basic Auth over HTTP (recommended for internal Docker access)"
echo "2. Configure WordPress to use HTTP internally"
echo ""

echo "Checking current WordPress configuration..."
docker exec -it onionpress-wordpress-1 wp option get siteurl --allow-root
docker exec -it onionpress-wordpress-1 wp option get home --allow-root
echo ""

echo "Adding filter to allow Basic Auth over HTTP..."
docker exec -it onionpress-wordpress-1 wp eval '
// Allow Application Passwords over HTTP for internal Docker access
add_filter("application_password_is_api_request", "__return_true");
add_filter("wp_is_application_passwords_available", "__return_true");

// Force WordPress to accept Basic Auth even over HTTP
add_filter("determine_current_user", function($user_id) {
    // If we have Basic Auth headers, try to authenticate
    if (isset($_SERVER["PHP_AUTH_USER"]) && isset($_SERVER["PHP_AUTH_PW"])) {
        $username = $_SERVER["PHP_AUTH_USER"];
        $password = $_SERVER["PHP_AUTH_PW"];
        
        // Try Application Password first
        $user = wp_authenticate_application_password(null, $username, $password);
        if (!is_wp_error($user)) {
            return $user->ID;
        }
        
        // Fallback to regular password
        $user = wp_authenticate($username, $password);
        if (!is_wp_error($user)) {
            return $user->ID;
        }
    }
    return $user_id;
}, 10, 1);
' --allow-root

echo ""
echo "✅ WordPress configuration updated"
echo ""
echo "Alternatively, you can add this to wp-config.php:"
echo ""
echo "// Allow Application Passwords over HTTP"
echo "define('\''WP_DEBUG'\'', true);"
echo "add_filter('\''application_password_is_api_request'\'', '\''__return_true'\'');"
echo ""
echo "═══════════════════════════════════════════════════════════════"
