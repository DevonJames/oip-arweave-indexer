#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  FIXING WORDPRESS PERMALINKS FOR ALEXANDRIA NODE"
echo "═══════════════════════════════════════════════════════════════"
echo ""

WORDPRESS_CONTAINER="alexandria-wordpress-1"

echo "🔄 Flushing WordPress permalinks..."
docker exec -it $WORDPRESS_CONTAINER wp rewrite flush --allow-root

echo ""
echo "✅ Permalinks flushed!"
echo ""
echo "This should fix the issue where /wp-json/wp/v2/posts/ returns HTML instead of JSON."
echo ""
echo "The REST API should now work correctly at:"
echo "  - http://wordpress:80/wp-json/wp/v2/posts/"
echo "  - http://wordpress:80/index.php?rest_route=/wp/v2/posts"
echo ""
