#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  FIXING WORDPRESS AUTHENTICATION (V3 - ENABLE APP PASSWORDS)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Create mu-plugins directory
docker exec -it onionpress-wordpress-1 sh -c 'mkdir -p /var/www/html/wp-content/mu-plugins'

# Create improved mu-plugin that enables Application Passwords over HTTP
docker exec -it onionpress-wordpress-1 sh -c 'cat > /var/www/html/wp-content/mu-plugins/op-rest-api-auth-fix.php << "EOFPHP"
<?php
/**
 * Plugin Name: OP REST API Auth Fix
 * Description: Enables Application Passwords over HTTP and allows regular passwords for REST API
 * Version: 3.0.0
 */

if (!defined("ABSPATH")) {
    exit;
}

// Enable WordPress debug logging
if (!defined("WP_DEBUG_LOG")) {
    define("WP_DEBUG_LOG", true);
}

// ═══════════════════════════════════════════════════════════════════════════
// ENABLE APPLICATION PASSWORDS OVER HTTP
// WordPress disables Application Passwords when site URL is HTTPS but accessed via HTTP
// ═══════════════════════════════════════════════════════════════════════════
add_filter("wp_is_application_passwords_available", "__return_true");
add_filter("application_password_is_api_request", "__return_true");

// Force WordPress to allow Application Passwords over HTTP
add_filter("wp_is_serving_rest_request", "__return_true");

// ═══════════════════════════════════════════════════════════════════════════
// REST API AUTHENTICATION HANDLER
// ═══════════════════════════════════════════════════════════════════════════
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
        return $result;
    }
    
    $username = sanitize_user($_SERVER["PHP_AUTH_USER"]);
    $password = $_SERVER["PHP_AUTH_PW"];
    
    error_log("OP Auth Fix: Attempting auth for user: " . $username);
    error_log("OP Auth Fix: Password length: " . strlen($password));
    
    if (empty($username) || empty($password)) {
        return $result;
    }
    
    // Get user by login
    $user = get_user_by("login", $username);
    if (!$user) {
        error_log("OP Auth Fix: User not found: " . $username);
        return $result;
    }
    
    error_log("OP Auth Fix: Found user ID: " . $user->ID);
    
    // Try Application Password (WITHOUT spaces - standard for Basic Auth)
    if (function_exists("wp_authenticate_application_password")) {
        error_log("OP Auth Fix: Trying Application Password (without spaces)...");
        $app_password_clean = str_replace(" ", "", $password);
        $app_user = wp_authenticate_application_password(null, $username, $app_password_clean);
        
        if (!is_wp_error($app_user) && $app_user instanceof WP_User) {
            error_log("OP Auth Fix: ✅ Application Password SUCCESS for user: " . $username);
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
        error_log("OP Auth Fix: ✅ Regular password SUCCESS for user: " . $username);
        wp_set_current_user($user->ID);
        return true;
    } else {
        error_log("OP Auth Fix: Regular password FAILED for user: " . $username);
    }
    
    error_log("OP Auth Fix: ❌ All authentication methods failed for user: " . $username);
    return new WP_Error("rest_forbidden", "Authentication failed", array("status" => 401));
}, 1);
EOFPHP
'

echo "✅ Mu-plugin created with Application Passwords enabled over HTTP"
echo ""
echo "Now test authentication:"
echo "  docker exec -it onionpress-oip-daemon-service-1 node scripts/test-wordpress-auth.js"
echo ""
