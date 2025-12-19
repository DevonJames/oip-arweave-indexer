# ═══════════════════════════════════════════════════════════════════════════════
# TOR DAEMON DOCKERFILE
# ═══════════════════════════════════════════════════════════════════════════════
# Purpose: Provides onion service (inbound) and SOCKS5 proxy (outbound)
# 
# Features:
#   - Generates unique .onion address for this instance
#   - SOCKS5 proxy for outbound TOR connections
#   - Control port for status queries
# ═══════════════════════════════════════════════════════════════════════════════

FROM alpine:latest

# Install TOR
RUN apk add --no-cache tor

# Create directories and set permissions
RUN mkdir -p /var/lib/tor/hidden_service && \
    chown -R tor:tor /var/lib/tor && \
    chmod 700 /var/lib/tor/hidden_service

# Copy configuration
COPY torrc /etc/tor/torrc

# Set ownership of config
RUN chown tor:tor /etc/tor/torrc

# Create data directory
RUN mkdir -p /var/lib/tor/data && \
    chown -R tor:tor /var/lib/tor/data

# Run as tor user
USER tor

# Expose ports
# 9050 - SOCKS5 proxy
# 9051 - Control port
EXPOSE 9050 9051

# Start TOR
CMD ["tor", "-f", "/etc/tor/torrc"]

