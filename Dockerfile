FROM node:lts-alpine
ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install curl and bash
RUN apk add --no-cache bash curl

# Install necessary packages for building native modules
RUN apk add --no-cache make g++ python3

# Install chromium for puppeteer
RUN apk add --no-cache chromium

# Set the Puppeteer executable path to the installed chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Set the cache directory for Puppeteer
ENV PUPPETEER_CACHE_DIR="/usr/src/app/cache/puppeteer"

# Create cache directory for Puppeteer
RUN mkdir -p /usr/src/app/cache/puppeteer && chown -R node:node /usr/src/app/cache

# Install app dependencies
COPY package*.json ./

# Copy package files and install dependencies
COPY ["package.json", "package-lock.json*", "npm-shrinkwrap.json*", "./"]
RUN npm install --production --silent && mv node_modules ../

# Copy the rest of the application code
COPY . .

# Copy wait-for-it.sh script and make it executable
COPY wait-for-it.sh /usr/local/bin/wait-for-it.sh
RUN chmod +x /usr/local/bin/wait-for-it.sh

# Include necessary directories
COPY config ./config
COPY helpers ./helpers
COPY remapTemplates ./remapTemplates
COPY routes ./routes
COPY src ./src  
COPY test ./test  

# Copy the .env file
COPY .env .env

# Expose ports for the application and debugging
EXPOSE 3005
EXPOSE 9229

# Set permissions and switch to non-root user
RUN chown -R node /usr/src/app
USER node

# Rebuild native modules
RUN npm rebuild

# Command to run the application with debugging enabled
CMD ["./wait-for-it.sh", "elasticsearch:9200", "--timeout=90", "--strict", "--", "node", "--inspect=0.0.0.0:9229", "index.js", "--keepDBUpToDate", "10", "100"]
# CMD ["./wait-for-it.sh", "elasticsearch:9200", "--timeout=90", "--strict", "--", "node", "--inspect=0.0.0.0:9229", "index.js"]
# Add healthcheck for the app (ensure curl is installed)
HEALTHCHECK --interval=75s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3005/api/health || exit 1