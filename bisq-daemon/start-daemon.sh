#!/bin/bash

# Start script for Bisq daemon with improved error handling

# Set up logging
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "Bisq daemon startup initiated"

# Print Java version (for debugging)
log "Java version:"
java -version

# Print environment info
log "Environment variables:"
log "BISQ_HOME=$BISQ_HOME"
log "API_PORT=$API_PORT"
log "JAVA_OPTS=$JAVA_OPTS"

# Wait for Bitcoin network to be available (if running in separate container)
if [ ! -z "$BITCOIN_HOST" ]; then
  echo "Waiting for Bitcoin node at $BITCOIN_HOST to be available..."
  until nc -z $BITCOIN_HOST 8332; do
    echo "Bitcoin node not ready yet, sleeping..."
    sleep 5
  done
  echo "Bitcoin node is available!"
fi

# Ensure Bisq directory exists
mkdir -p $BISQ_HOME
log "Bisq home directory: $BISQ_HOME"

# Create a fresh properties file from our new template
log "Creating fresh properties file"
cp /bisq-build/bisq.properties.new $BISQ_HOME/bisq.properties

# List the contents of Bisq directory
log "Bisq directory contents:"
ls -la $BISQ_HOME

# Set API Password from environment if provided
if [ ! -z "$API_PASSWORD" ]; then
  log "Setting API password from environment variable"
  sed -i "s/apiPassword=.*/apiPassword=$API_PASSWORD/" $BISQ_HOME/bisq.properties
fi

# Check if bisq.properties exists
if [ -f "$BISQ_HOME/bisq.properties" ]; then
  log "bisq.properties exists"
  log "Content of bisq.properties:"
  cat $BISQ_HOME/bisq.properties
else
  log "ERROR: bisq.properties not found"
fi

# First, run the discovery script to find valid options
log "Running discovery script to find valid Bisq options..."
./discover-options.sh || true # Continue even if discovery fails

# Now try to extract the location of the daemon or find out what we need
log "Checking if bisq-daemon exists in the current directory:"
ls -l bisq-daemon || true

log "Checking for other binaries in the build directory:"
find . -type f -executable -name "*bisq*" | grep -v "\.sh" || true
find . -type f -executable -name "*daemon*" | grep -v "\.sh" || true

# Set Java options as environment variable
export _JAVA_OPTIONS="$JAVA_OPTS"
log "Set _JAVA_OPTIONS=$_JAVA_OPTIONS"

# From the help output, we can see --baseCurrencyNetwork is the correct option, not bitcoinNetwork
# And there's no daoActivated option, but there is fullDaoNode
log "Starting daemon with valid options..."
exec ./bisq-daemon \
  --apiPassword=${API_PASSWORD:-bisq} \
  --apiPort=${API_PORT:-9998} \
  --appName=bisq-daemon \
  --baseCurrencyNetwork=BTC_REGTEST \
  --fullDaoNode=false \
  --maxMemory=3000 \
  --logLevel=INFO 