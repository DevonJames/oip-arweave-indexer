FROM node:18-alpine3.20
ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install necessary packages for all services including Chromium dependencies
RUN apk update && apk add --no-cache bash make g++ python3 python3-dev py3-pip curl chromium cmake ffmpeg poppler-utils \
    openssl-dev \
    openssl-libs-static \
    libssl3 \
    libcrypto3 \
    libc6-compat \
    linux-headers \
    git \
    pkgconfig \
    espeak \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    eudev-dev \
    xvfb \
    dbus

# Add dependencies for node-canvas (required for image processing)
RUN apk add --no-cache \
    build-base \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev \
    freetype-dev \
    fontconfig-dev \
    pkgconfig

#     # Install Puppeteer
# RUN npm install puppeteer-extra puppeteer-extra-plugin-stealth

# Set environment variables for Puppeteer to use system chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMIUM_FLAGS="--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage"

# Install Python packages for LLaMA2 and Coqui TTS
# RUN pip3 install torch transformers flask TTS

# Set environment variables to help CMake find OpenSSL - Updated for Alpine Linux
ENV OPENSSL_ROOT_DIR=/usr
ENV OPENSSL_INCLUDE_DIR=/usr/include/openssl
ENV OPENSSL_CRYPTO_LIBRARY=/usr/lib/libcrypto.so.3
ENV OPENSSL_SSL_LIBRARY=/usr/lib/libssl.so.3
ENV PKG_CONFIG_PATH=/usr/lib/pkgconfig

# Install app dependencies with better native module handling
COPY package*.json ./

# Create npmrc for better native module compilation
RUN echo "python=/usr/bin/python3" > .npmrc && \
    echo "node_gyp=/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js" >> .npmrc

# Install dependencies with better native module support
RUN npm install --verbose --build-from-source

# Rebuild native modules to ensure they work with current environment
RUN npm rebuild canvas bcrypt sharp

# Move node_modules to parent directory for caching - this is how the working container works
RUN mv node_modules ../

# Copy wait-for-it.sh script and make it executable
COPY wait-for-it.sh wait-for-it.sh
RUN sed -i 's/\r$//' wait-for-it.sh && chmod +x wait-for-it.sh

# Copy specific application directories and config
COPY config ./config
COPY helpers ./helpers
COPY lib ./lib
COPY media ./media
COPY remapTemplates ./remapTemplates
COPY routes ./routes
COPY speech-synthesizer ./speech-synthesizer
COPY text-generator ./text-generator
COPY ngrok ./ngrok
COPY public ./public
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
COPY frontend ./frontend
COPY middleware ./middleware
COPY socket ./socket
COPY services ./services
COPY utils ./utils
COPY voices ./voices
COPY *.js ./
COPY *.json ./
COPY *.md ./

# Build Next.js frontend (replaces webpack entirely)
WORKDIR /usr/src/app/frontend
RUN npm ci && npm run build

# Return to main app directory
WORKDIR /usr/src/app

# Note: .env file is loaded by docker-compose via env_file directive at runtime
# No need to copy .env during build since it's mounted/loaded at runtime

# Create the complete directory structure that routes/jfk.js expects at startup
RUN mkdir -p \
  ./media/temp_audio \
  ./media/jfk/pdf \
  ./media/jfk/images \
  ./media/jfk/analysis \
  ./media/rfk/pdf \
  ./media/rfk/images \
  ./media/rfk/analysis

# Expose all necessary ports
EXPOSE 3000
EXPOSE 3005
EXPOSE 9229
EXPOSE 8081
EXPOSE 8082
EXPOSE 4040 
EXPOSE 5555

# Copy and set up the startup script
COPY start-services.sh ./start-services.sh
RUN sed -i 's/\r$//' start-services.sh && chmod +x start-services.sh

# Command to run all services (API + Next.js frontend)
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["./start-services.sh"]

# Add healthcheck for the app
HEALTHCHECK --interval=75s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3005}/api/health || exit 1