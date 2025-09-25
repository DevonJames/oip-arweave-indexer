#!/bin/bash

# OIP Docker Entrypoint Script
# Handles custom public directory setup before starting the application

set -e

echo "🚀 OIP Docker Container Starting..."
echo "📁 CUSTOM_PUBLIC_PATH: ${CUSTOM_PUBLIC_PATH:-false}"

# Handle custom public directory
if [ "$CUSTOM_PUBLIC_PATH" = "true" ]; then
    echo "🔧 Custom public path enabled - checking for parent directory public folder..."
    
    # Check if parent public directory exists (mounted via volume)
    if [ -d "/usr/src/parent-public" ] && [ "$(ls -A /usr/src/parent-public 2>/dev/null)" ]; then
        echo "✅ Found parent public directory, symlinking..."
        # Remove the default public directory and create symlink
        rm -rf /usr/src/app/public
        ln -sf /usr/src/parent-public /usr/src/app/public
        echo "📂 Using custom public directory from parent folder"
    else
        echo "⚠️  Parent public directory not found or empty"
        echo "📋 Expected: Parent directory should be mounted to /usr/src/parent-public"
        echo "🔧 Falling back to default public directory"
        
        # Ensure default public directory exists
        if [ ! -d "/usr/src/app/public" ]; then
            echo "📁 Creating default public directory..."
            mkdir -p /usr/src/app/public
            echo "<h1>OIP Default Page</h1><p>Configure CUSTOM_PUBLIC_PATH and mount parent public directory.</p>" > /usr/src/app/public/index.html
        fi
    fi
else
    echo "📁 Using default public directory"
    # Ensure default public directory exists
    if [ ! -d "/usr/src/app/public" ]; then
        echo "📁 Creating default public directory..."
        mkdir -p /usr/src/app/public
        echo "<h1>OIP Default Page</h1><p>Default OIP public directory.</p>" > /usr/src/app/public/index.html
    fi
fi

echo "📂 Public directory setup complete"
echo "🎯 Starting OIP application..."

# Execute the main command
exec "$@"
