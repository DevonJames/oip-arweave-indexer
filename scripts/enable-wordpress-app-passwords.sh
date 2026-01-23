#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  ENABLING WORDPRESS APPLICATION PASSWORDS"
echo "═══════════════════════════════════════════════════════════════"
echo ""

echo "WordPress is reporting 'Application passwords are not available'"
echo "This means the Application Passwords feature is disabled."
echo ""

echo "1. Checking WordPress version (Application Passwords require 5.6+):"
docker exec -it onionpress-wordpress-1 wp core version --allow-root
echo ""

echo "2. Enabling Application Passwords feature..."
docker exec -it onionpress-wordpress-1 wp eval '
// Force enable Application Passwords
add_filter("wp_is_application_passwords_available", "__return_true");
add_filter("application_password_is_api_request", "__return_true");

// Also add to wp-config.php to make it permanent
$wp_config_path = ABSPATH . "wp-config.php";
$wp_config_content = file_get_contents($wp_config_path);

// Check if we already added this
if (strpos($wp_config_content, "APPLICATION_PASSWORDS") === false) {
    // Add after <?php
    $wp_config_content = str_replace(
        "<?php",
        "<?php\n// Enable Application Passwords\nif (!defined(\"WP_IS_APPLICATION_PASSWORDS_AVAILABLE\")) {\n    define(\"WP_IS_APPLICATION_PASSWORDS_AVAILABLE\", true);\n}",
        $wp_config_content
    );
    file_put_contents($wp_config_path, $wp_config_content);
    echo "✅ Added Application Passwords enable flag to wp-config.php\n";
} else {
    echo "✅ Application Passwords already enabled in wp-config.php\n";
}
' --allow-root

echo ""
echo "3. Verifying Application Passwords are enabled:"
docker exec -it onionpress-wordpress-1 wp eval '
if (apply_filters("wp_is_application_passwords_available", false)) {
    echo "✅ Application Passwords are enabled\n";
} else {
    echo "❌ Application Passwords are still disabled\n";
}
' --allow-root

echo ""
echo "4. Testing Application Password authentication:"
docker exec -it onionpress-wordpress-1 sh -c '
curl -s -u "devon:qYOjEpuUYTU1CIkKH0ijr3h8" \
    -H "Accept: application/json" \
    http://localhost/wp-json/wp/v2/users/me | head -5
'

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "If Application Passwords are still not available, WordPress may"
echo "require HTTPS. Check WordPress site URL configuration."
echo "═══════════════════════════════════════════════════════════════"
