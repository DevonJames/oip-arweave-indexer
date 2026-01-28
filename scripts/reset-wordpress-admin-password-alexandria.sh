#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  RESET WORDPRESS ADMIN PASSWORD FOR ALEXANDRIA NODE"
echo "═══════════════════════════════════════════════════════════════"
echo ""

WORDPRESS_CONTAINER="alexandria-wordpress-1"

# Get username from argument or use default
USERNAME=${1:-admin}

# Generate a random password if not provided
if [ -z "$2" ]; then
    NEW_PASSWORD=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-16)
    PASSWORD_GENERATED=true
else
    NEW_PASSWORD=$2
    PASSWORD_GENERATED=false
fi

echo "Username: $USERNAME"
if [ "$PASSWORD_GENERATED" = "true" ]; then
    echo "New Password: $NEW_PASSWORD (auto-generated)"
else
    echo "New Password: (as provided)"
fi
echo ""

# Check if user exists
USER_EXISTS=$(docker exec -it $WORDPRESS_CONTAINER wp user get "$USERNAME" --field=ID --allow-root 2>/dev/null)

if [ -z "$USER_EXISTS" ]; then
    echo "❌ User '$USERNAME' not found!"
    echo ""
    echo "Available users:"
    docker exec -it $WORDPRESS_CONTAINER wp user list --allow-root --field=user_login --format=table
    echo ""
    echo "To create a new admin user instead, run:"
    echo "  docker exec -it $WORDPRESS_CONTAINER wp user create $USERNAME admin@localhost.invalid --role=administrator --user_pass='$NEW_PASSWORD' --allow-root"
    exit 1
fi

echo "🔄 Resetting password for user '$USERNAME'..."
docker exec -it $WORDPRESS_CONTAINER wp user update "$USERNAME" --user_pass="$NEW_PASSWORD" --allow-root

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Password reset successfully!"
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "🔐 WORDPRESS ADMIN CREDENTIALS"
    echo "═══════════════════════════════════════════════════════════════"
    echo "   URL:      https://alexandria.io/wordpress/wp-admin/"
    echo "   Username: $USERNAME"
    if [ "$PASSWORD_GENERATED" = "true" ]; then
        echo "   Password: $NEW_PASSWORD"
    else
        echo "   Password: (as provided)"
    fi
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
else
    echo "❌ Failed to reset password"
    exit 1
fi
