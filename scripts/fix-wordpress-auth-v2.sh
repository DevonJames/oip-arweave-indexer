#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  FIXING WORDPRESS AUTHENTICATION (V2 - WITH DEBUGGING)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Create mu-plugins directory
docker exec -it onionpress-wordpress-1 sh -c 'mkdir -p /var/www/html/wp-content/mu-plugins'

# Create improved mu-plugin with debugging
docker exec -it onionpress-wordpress-1 sh -c 'cat > /var/www/html/wp-content/mu-plugins/op-rest-api-auth-fix.php << "EOFPHP"
<?php
/**
 * Plugin Name: OP REST API Auth Fix
 * Description: Allows regular passwords for REST API Basic Auth (for internal Docker access)
 * Version: 2.0.0
 */

if (!defined("ABSPATH")) {
    exit;
}

// Enable WordPress debug logging
if (!defined("WP_DEBUG_LOG")) {
    define("WP_DEBUG_LOG", true);
}

add_filter("rest_authentication_errors", function($result) {
    // If already authenticated, return as-is
    if (!empty($result) && !is_wp_error($result)) {
        return $result;
    }
    
    // Only process REST API requests
    if (!defined("REST_REQUEST") || !REST_REQUEST) {
        return $result;
    }
    
    // Check for Basic Auth headers
    if (!isset($_SERVER["PHP_AUTH_USER"]) || !isset($_SERVER["PHP_AUTH_PW"])) {
        error_log("OP Auth Fix: No Basic Auth headers found");
        return $result;
    }
    
    $username = sanitize_user($_SERVER["PHP_AUTH_USER"]);
    $password = $_SERVER["PHP_AUTH_PW"];
    
    error_log("OP Auth Fix: Attempting auth for user: " . $username);
    error_log("OP Auth Fix: Password length: " . strlen($password));
    
    if (empty($username) || empty($password)) {
        error_log("OP Auth Fix: Empty username or password");
        return $result;
    }
    
    // Get user by login
    $user = get_user_by("login", $username);
    if (!$user) {
        error_log("OP Auth Fix: User not found: " . $username);
        return $result;
    }
    
    error_log("OP Auth Fix: Found user ID: " . $user->ID);
    
    // Try Application Password first (WordPress preferred method)
    if (function_exists("wp_authenticate_application_password")) {
        error_log("OP Auth Fix: Trying Application Password...");
        // Application Passwords should be used WITHOUT spaces for Basic Auth
        $app_password_clean = str_replace(" ", "", $password);
        $app_user = wp_authenticate_application_password(null, $username, $app_password_clean);
        
        if (!is_wp_error($app_user) && $app_user instanceof WP_User) {
            error_log("OP Auth Fix: Application Password SUCCESS for user: " . $username);
            wp_set_current_user($app_user->ID);
            return true;
        } else {
            $error_msg = is_wp_error($app_user) ? $app_user->get_error_message() : "Unknown error";
            error_log("OP Auth Fix: Application Password failed: " . $error_msg);
        }
    }
    
    // Fallback: Try regular password authentication
    error_log("OP Auth Fix: Trying regular password...");
    $password_check = wp_check_password($password, $user->user_pass, $user->ID);
    if ($password_check) {
        error_log("OP Auth Fix: Regular password SUCCESS for user: " . $username);
        wp_set_current_user($user->ID);
        return true;
    } else {
        error_log("OP Auth Fix: Regular password FAILED for user: " . $username);
    }
    
    error_log("OP Auth Fix: All authentication methods failed for user: " . $username);
    return new WP_Error("rest_forbidden", "Authentication failed", array("status" => 401));
}, 1);
EOFPHP
'

echo "✅ Mu-plugin created with debugging enabled"
echo ""
echo "Now test authentication and check WordPress debug log:"
echo "  docker exec -it onionpress-wordpress-1 tail -f /var/www/html/wp-content/debug.log"
echo ""
echo "Or run the test:"
echo "  docker exec -it onionpress-oip-daemon-service-1 node scripts/test-wordpress-auth.js"
echo ""
