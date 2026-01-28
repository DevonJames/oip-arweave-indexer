#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  CHECKING WORDPRESS USERS FOR ALEXANDRIA NODE"
echo "═══════════════════════════════════════════════════════════════"
echo ""

WORDPRESS_CONTAINER="alexandria-wordpress-1"

echo "📋 Listing all WordPress users:"
docker exec -it $WORDPRESS_CONTAINER wp user list --allow-root --format=table

echo ""
echo "📋 Checking admin users:"
docker exec -it $WORDPRESS_CONTAINER wp user list --role=administrator --allow-root --format=table

echo ""
echo "🔍 To reset a user's password, run:"
echo "   docker exec -it $WORDPRESS_CONTAINER wp user update <username> --user_pass='<new-password>' --allow-root"
echo ""
echo "🔍 To create a new admin user, run:"
echo "   docker exec -it $WORDPRESS_CONTAINER wp user create <username> <email> --role=administrator --user_pass='<password>' --allow-root"
echo ""
