#!/bin/bash

# Script to create a permanent WordPress mu-plugin for REST API authentication
# This persists across WordPress restarts

echo "═══════════════════════════════════════════════════════════════"
echo "  CREATING PERMANENT WORDPRESS AUTHENTICATION FIX"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Create mu-plugins directory if it doesn't exist
docker exec -it onionpress-wordpress-1 mkdir -p /var/www/html/wp-content/mu-plugins --allow-root

# Create the mu-plugin file
docker exec -it onionpress-wordpress-1 sh -c 'cat > /var/www/html/wp-content/mu-plugins/op-rest-api-auth-fix.php << "EOFPHP"
<?php
/**
 * Plugin Name: OP REST API Auth Fix
 * Description: Allows regular passwords for REST API Basic Auth (for internal Docker access)
 * Version: 1.0.0
 * Author: OIP Team
 */

if (!defined("ABSPATH")) {
    exit;
}

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
    
    // Try Application Password first (WordPress preferred method)
    if (function_exists("wp_authenticate_application_password")) {
        $app_password_user = wp_authenticate_application_password(null, $username, $password);
        if (!is_wp_error($app_password_user) && $app_password_user instanceof WP_User) {
            wp_set_current_user($app_password_user->ID);
            return true;
        }
    }
    
    // Fallback: Try regular password authentication
    // WordPress normally doesn'\''t allow this for REST API, but we allow it for internal Docker access
    $password_check = wp_check_password($password, $user->user_pass, $user->ID);
    if ($password_check) {
        wp_set_current_user($user->ID);
        error_log("OP REST API Auth Fix: Using regular password auth for REST API user: " . $username);
        return true;
    }
    
    return new WP_Error("rest_forbidden", "Sorry, you are not allowed to do that.", array("status" => 401));
}, 1);
EOFPHP
'

echo "✅ Mu-plugin created: /var/www/html/wp-content/mu-plugins/op-rest-api-auth-fix.php"
echo ""
echo "This fix will persist across WordPress restarts."
echo ""
echo "Testing authentication..."
echo ""

# Test the fix
docker exec -it onionpress-oip-daemon-service-1 node scripts/test-wordpress-auth.js
