FROM openjdk:11-slim

# Install required packages
RUN apt-get update && apt-get install -y \
    git \
    maven \
    curl \
    gnupg \
    wget \
    netcat \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Clone Bisq repository
WORKDIR /bisq-build
RUN git clone https://github.com/bisq-network/bisq.git .

# Build Bisq - use --info for more verbose output
RUN ./gradlew build -x test --info

# Create directory for Bisq data
RUN mkdir -p /root/.local/share/Bisq

# Copy configuration with a new filename to ensure it's used
COPY bisq.properties /bisq-build/bisq.properties.new
COPY start-daemon.sh ./start-daemon.sh
COPY check-api.sh ./check-api.sh
COPY discover-options.sh ./discover-options.sh
COPY check-memory.sh ./check-memory.sh
RUN chmod +x ./start-daemon.sh ./check-api.sh ./discover-options.sh ./check-memory.sh

# Expose API port
EXPOSE 9998

# Set environment variables
ENV BISQ_APP_NAME=bisq-daemon
ENV BISQ_HOME=/root/.local/share/Bisq
ENV API_PORT=9998
ENV API_PASSWORD=bisq
ENV JAVA_OPTS="-Xms1g -Xmx4g"

# Health check to verify daemon is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD ./check-api.sh

# First, run the discovery script to get valid options
# Then start Bisq with the start-daemon.sh script
CMD ["./start-daemon.sh"] 