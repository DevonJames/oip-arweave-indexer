#!/bin/bash

# Script to verify WordPress Application Password
# Usage: ./scripts/verify-wp-app-password.sh [username] [app_password]

USERNAME=${1:-devon}
APP_PASSWORD=${2:-${WP_APP_PASSWORD}}

if [ -z "$APP_PASSWORD" ]; then
    echo "Error: Application Password not provided"
    echo "Usage: $0 [username] [app_password]"
    echo "   Or set WP_APP_PASSWORD environment variable"
    exit 1
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  VERIFYING WORDPRESS APPLICATION PASSWORD"
echo "═══════════════════════════════════════════════════════════════"
echo "Username: $USERNAME"
echo "Application Password: ${APP_PASSWORD:0:8}... (${#APP_PASSWORD} chars)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# First, list all users to find the correct username
echo "📋 WordPress Users:"
docker exec -it onionpress-wordpress-1 wp user list --allow-root --field=user_login --format=table
echo ""

# List application passwords for the user
echo "📋 Application Passwords for user '$USERNAME':"
docker exec -it onionpress-wordpress-1 wp user application-password list "$USERNAME" --allow-root --format=table 2>/dev/null || {
    echo "⚠️  User '$USERNAME' not found or has no application passwords"
    echo ""
    echo "Available users:"
    docker exec -it onionpress-wordpress-1 wp user list --allow-root --field=user_login
    exit 1
}

echo ""
echo "🔍 Testing Application Password with WordPress REST API..."

# Test using curl from within the WordPress container
docker exec -it onionpress-wordpress-1 sh -c "
    APP_PASS='$APP_PASSWORD'
    USER='$USERNAME'
    WORDPRESS_URL='http://localhost'
    
    echo 'Testing: \$WORDPRESS_URL/wp-json/wp/v2/users/me'
    RESPONSE=\$(curl -s -w '\nHTTP_CODE:%{http_code}' -u \"\$USER:\$APP_PASS\" \"\$WORDPRESS_URL/wp-json/wp/v2/users/me\")
    HTTP_CODE=\$(echo \"\$RESPONSE\" | grep 'HTTP_CODE:' | cut -d: -f2)
    BODY=\$(echo \"\$RESPONSE\" | sed '/HTTP_CODE:/d')
    
    if [ \"\$HTTP_CODE\" = \"200\" ]; then
        echo '✅ SUCCESS!'
        echo \"Response:\"
        echo \"\$BODY\" | head -20
    else
        echo \"❌ FAILED (HTTP \$HTTP_CODE)\"
        echo \"Response:\"
        echo \"\$BODY\" | head -20
    fi
"

echo ""
echo "═══════════════════════════════════════════════════════════════"
