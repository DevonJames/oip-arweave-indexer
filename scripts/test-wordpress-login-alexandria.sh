#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  TESTING WORDPRESS LOGIN FOR ALEXANDRIA NODE"
echo "═══════════════════════════════════════════════════════════════"
echo ""

WORDPRESS_CONTAINER="alexandria-wordpress-1"
USERNAME=${1:-devon}
PASSWORD=${2:-8Tr7s3TW9GjKNvUD3}

echo "Testing login for user: $USERNAME"
echo ""

# Check if user exists
echo "1️⃣ Checking if user exists:"
docker exec -it $WORDPRESS_CONTAINER wp user get "$USERNAME" --allow-root --field=user_login 2>&1

echo ""
echo "2️⃣ Verifying password:"
docker exec -it $WORDPRESS_CONTAINER wp user check-password "$USERNAME" "$PASSWORD" --allow-root 2>&1

echo ""
echo "3️⃣ Listing all users:"
docker exec -it $WORDPRESS_CONTAINER wp user list --allow-root --format=table

echo ""
echo "4️⃣ To reset password, run:"
echo "   docker exec -it $WORDPRESS_CONTAINER wp user update $USERNAME --user_pass='NEW_PASSWORD' --allow-root"
echo ""
