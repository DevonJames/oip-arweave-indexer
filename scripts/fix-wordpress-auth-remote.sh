#!/bin/bash

# Script to fix WordPress REST API authentication on remote instance
# This adds a filter directly to WordPress without needing to rebuild

echo "═══════════════════════════════════════════════════════════════"
echo "  FIXING WORDPRESS REST API AUTHENTICATION (REMOTE)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Add the authentication fix directly to WordPress functions.php or as a mu-plugin
echo "Adding REST API authentication fix to WordPress..."

docker exec -it onionpress-wordpress-1 wp eval '
// Allow regular passwords for REST API Basic Auth (for internal Docker access)
add_filter("rest_authentication_errors", function($result) {
    // If already authenticated or not a REST request, return as-is
    if (!empty($result) || !defined("REST_REQUEST") || !REST_REQUEST) {
        return $result;
    }
    
    // Check for Basic Auth headers
    if (!isset($_SERVER["PHP_AUTH_USER"]) || !isset($_SERVER["PHP_AUTH_PW"])) {
        return $result;
    }
    
    $username = sanitize_user($_SERVER["PHP_AUTH_USER"]);
    $password = $_SERVER["PHP_AUTH_PW"];
    
    if (empty($username) || empty($password)) {
        return $result;
    }
    
    // Get user by login
    $user = get_user_by("login", $username);
    if (!$user) {
        return $result;
    }
    
    // Try Application Password first
    if (function_exists("wp_authenticate_application_password")) {
        $app_password_user = wp_authenticate_application_password(null, $username, $password);
        if (!is_wp_error($app_password_user) && $app_password_user instanceof WP_User) {
            wp_set_current_user($app_password_user->ID);
            return true;
        }
    }
    
    // Fallback: Try regular password
    $password_check = wp_check_password($password, $user->user_pass, $user->ID);
    if ($password_check) {
        wp_set_current_user($user->ID);
        error_log("OP Publisher: Using regular password auth for REST API user: " . $username);
        return true;
    }
    
    return new WP_Error("rest_forbidden", "Sorry, you are not allowed to do that.", array("status" => 401));
}, 1);
' --allow-root

echo ""
echo "✅ WordPress authentication fix applied!"
echo ""
echo "Note: This fix is temporary and will be lost on WordPress restart."
echo "For a permanent fix, you need to add this code to a plugin or mu-plugin."
echo ""
echo "Testing authentication..."
echo ""

# Test the fix
docker exec -it onionpress-oip-daemon-service-1 node scripts/test-wordpress-auth.js
