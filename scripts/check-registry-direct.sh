#!/bin/bash

# Simple script to check GUN registry contents directly
# Run this on the server: bash scripts/check-registry-direct.sh

echo ""
echo "========================================="
echo "  Checking GUN Registry Contents"
echo "========================================="
echo ""

GUN_URL=${1:-http://localhost:8765}

echo "Using GUN relay: $GUN_URL"
echo ""

# Check image registry
echo "📷 Checking image registry..."
curl -s "$GUN_URL/get?soul=oip:registry:index:image" | jq -r '
  if .success then
    if .data then
      "✅ Registry exists with " + (.data | keys | map(select(startswith("_") | not)) | length | tostring) + " entries"
    else
      "❌ Registry exists but has no data"
    end
  else
    "❌ Registry not found or empty"
  end
'

echo ""
echo "Sample entries (if any):"
curl -s "$GUN_URL/get?soul=oip:registry:index:image" | jq -r '
  if .success and .data then
    .data | to_entries | map(select(.key | startswith("_") | not)) | .[0:3] | .[] | 
    "  - \(.key): nodeId=\(.value.nodeId // "unknown"), soul=\(.value.soul // "unknown")"
  else
    "  (none)"
  end
'

echo ""
echo "========================================="
echo ""

# Also check if any records exist at all
echo "📊 Checking recent GUN records..."
curl -s "$GUN_URL/list" 2>/dev/null | head -20

