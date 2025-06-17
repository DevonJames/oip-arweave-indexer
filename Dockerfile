FROM node:18-alpine
ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install necessary packages for all services
RUN apk add --no-cache bash make g++ python3 python3-dev py3-pip curl chromium cmake ffmpeg poppler-utils \
    openssl-dev \
    openssl-libs-static \
    libssl3 \
    libcrypto3 \
    libc6-compat \
    linux-headers \
    git \
    pkgconfig

# Add dependencies for node-canvas
RUN apk add --no-cache \
    build-base \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg \
    pkgconfig

#     # Install Puppeteer
# RUN npm install puppeteer-extra puppeteer-extra-plugin-stealth

# Set environment variables for Puppeteer
# ENV PUPPETEER_SKIP_DOWNLOAD=true
# ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

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

# Install dependencies with progressive fallback strategy
RUN npm install --production --verbose --ignore-scripts || \
    (echo "First install failed, trying without optional dependencies..." && \
     npm install --production --verbose --ignore-scripts --no-optional) || \
    (echo "Second install failed, trying basic install..." && \
     npm install --production --ignore-scripts --no-optional --no-fund --no-audit)

# Rebuild native modules that need it (canvas, puppeteer, etc.)
# bcryptjs doesn't need rebuilding since it's pure JavaScript
RUN npm rebuild canvas sharp || echo "Some optional native modules failed to rebuild, continuing..."

# Move node_modules to parent directory
RUN mv node_modules ../

# Copy wait-for-it.sh script and make it executable
COPY wait-for-it.sh wait-for-it.sh
RUN chmod +x wait-for-it.sh

# Copy all application code including services
COPY . .

# Include all necessary directories
COPY config ./config
COPY helpers ./helpers
COPY remapTemplates ./remapTemplates
COPY routes ./routes
COPY speech-synthesizer ./speech-synthesizer
COPY text-generator ./text-generator
COPY ngrok ./ngrok

# Copy the .env file if it exists
COPY .env .env

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
EXPOSE 3005
EXPOSE 9229
EXPOSE 8081
EXPOSE 8082
EXPOSE 4040 
EXPOSE 5555

# Command to run all services
CMD ["sh", "-c", "\
  ./wait-for-it.sh elasticsearch:9200 --timeout=90 --strict -- \
  node --inspect=0.0.0.0:9229 index.js --keepDBUpToDate 10 15"]

# Add healthcheck for the app
HEALTHCHECK --interval=75s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3005/api/health || exit 1