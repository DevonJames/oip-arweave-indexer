FROM node:lts-alpine
ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install necessary packages for building native modules
RUN apk add --no-cache bash make g++ python3 python3-dev py3-pip curl chromium

# Install chromium for puppeteer
# RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont libx11 libxcomposite libxdamage libxrandr libxi libxtst libnss alsa-lib at-spi2-core gtk+3.0 libdrm libgbm

#     # Install Puppeteer
RUN npm install puppeteer-extra puppeteer-extra-plugin-stealth

# Install Python packages for LLaMA2 and Coqui TTS
# RUN pip3 install torch transformers flask TTS


# Install app dependencies
COPY package*.json ./
RUN npm install --production --silent && mv node_modules ../

# Copy wait-for-it.sh script and make it executable
COPY wait-for-it.sh wait-for-it.sh
RUN chmod +x wait-for-it.sh
RUN ls -l wait-for-it.sh

# Copy the rest of the application code
COPY . .

# Include necessary directories
COPY config ./config
COPY helpers ./helpers
COPY remapTemplates ./remapTemplates
COPY routes ./routes
COPY speech-synthesizer ./speech-synthesizer
COPY src ./src  
COPY test ./test  

# Copy the .env file
COPY .env .env

# Expose ports for the application and debugging
EXPOSE 3005
EXPOSE 9229
EXPOSE 8081
EXPOSE 8082 

# Set permissions and switch to non-root user
RUN chown -R node /usr/src/app
USER node

# Rebuild native modules
RUN npm rebuild


# Command to run the application with debugging enabled
# CMD ["./wait-for-it.sh", "elasticsearch:9200", "--timeout=90", "--strict", "--", "node", "--inspect=0.0.0.0:9229", "index.js", "--keepDBUpToDate", "10", "100"]
CMD ["./wait-for-it.sh", "elasticsearch:9200", "--timeout=90", "--strict", "--", "sh", "-c", "\
  python3 coqui_tts.py & \
  node --inspect=0.0.0.0:9229 index.js --keepDBUpToDate 10 100"]
# Start the Node.js server and Python APIs for LLaMA2 and Coqui TTS
# CMD ["./wait-for-it.sh", "elasticsearch:9200", "--timeout=90", "--strict", "--", "sh", "-c", "\
#   python3 llama_text_generator.py & \
#   python3 coqui_tts.py & \
#   node --inspect=0.0.0.0:9229 index.js --keepDBUpToDate 10 100"]

# CMD ["./wait-for-it.sh", "elasticsearch:9200", "--timeout=90", "--strict", "--", "node", "--inspect=0.0.0.0:9229", "index.js"]
# Add healthcheck for the app (ensure curl is installed)
HEALTHCHECK --interval=75s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3005/api/health || exit 1