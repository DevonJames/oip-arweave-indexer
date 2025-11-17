#!/bin/bash

# Manual sync test - checks if HTTP polling is working between nodes
# Usage: bash scripts/manual-sync-test.sh

echo ""
echo "========================================="
echo "  Manual Sync Test Between Nodes"
echo "========================================="
echo ""

# Node URLs (change these to match your setup)
NODE1="http://localhost:8765"  # rockhoppers
NODE2="http://localhost:8765"  # oip-main

echo "Node 1: $NODE1"
echo "Node 2: $NODE2"
echo ""

# Check what each node has in its image registry
echo "1️⃣ Checking Node 1 registry..."
NODE1_ENTRIES=$(curl -s "$NODE1/get?soul=oip:registry:index:image" | jq -r '.data | keys | map(select(startswith("_") | not)) | length')
echo "   Node 1 has $NODE1_ENTRIES entries in image registry"

echo ""
echo "2️⃣ Checking Node 2 registry..."
NODE2_ENTRIES=$(curl -s "$NODE2/get?soul=oip:registry:index:image" | jq -r '.data | keys | map(select(startsWith("_") | not)) | length')
echo "   Node 2 has $NODE2_ENTRIES entries in image registry"

echo ""
echo "3️⃣ Sample entry from Node 1:"
NODE1_SAMPLE=$(curl -s "$NODE1/get?soul=oip:registry:index:image" | jq -r '.data | to_entries | map(select(.key | startswith("_") | not)) | .[0] | "\(.key) -> soul=\(.value.soul)"')
echo "   $NODE1_SAMPLE"

echo ""
echo "4️⃣ Testing if Node 2 can fetch that soul from Node 1..."
SAMPLE_SOUL=$(echo "$NODE1_SAMPLE" | grep -oP 'soul=\K[^ ]+')
if [ -n "$SAMPLE_SOUL" ]; then
    echo "   Fetching soul: $SAMPLE_SOUL"
    curl -s "$NODE2/get?soul=$SAMPLE_SOUL" | jq -r '
      if .success and .data then
        "   ✅ Record found! Type: " + (.data.oip.recordType // .oip.recordType // "unknown")
      else
        "   ❌ Record not found on Node 2"
      end
    '
else
    echo "   ⚠️ No sample soul found"
fi

echo ""
echo "========================================="
echo ""

