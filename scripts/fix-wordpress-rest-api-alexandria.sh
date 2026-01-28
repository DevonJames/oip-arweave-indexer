#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  FIXING WORDPRESS REST API FOR ALEXANDRIA NODE"
echo "═══════════════════════════════════════════════════════════════"
echo ""

WORDPRESS_CONTAINER="alexandria-wordpress-1"

echo "1️⃣ Setting permalink structure to 'Post name' (enables REST API)..."
docker exec -it $WORDPRESS_CONTAINER wp rewrite structure '/%postname%/' --allow-root

echo ""
echo "2️⃣ Flushing rewrite rules..."
docker exec -it $WORDPRESS_CONTAINER wp rewrite flush --allow-root

echo ""
echo "3️⃣ Verifying REST API endpoints..."
echo "   Testing /wp-json/wp/v2/..."
docker exec -it $WORDPRESS_CONTAINER curl -s http://localhost/wp-json/wp/v2/ | head -20

echo ""
echo "4️⃣ Checking permalink structure..."
docker exec -it $WORDPRESS_CONTAINER wp option get permalink_structure --allow-root

echo ""
echo "5️⃣ Testing REST API with Application Password..."
echo "   (This will show if authentication works)"
echo ""
echo "✅ REST API should now be accessible at:"
echo "   - http://wordpress:80/wp-json/wp/v2/posts/"
echo "   - http://wordpress:80/index.php?rest_route=/wp/v2/posts"
echo ""
