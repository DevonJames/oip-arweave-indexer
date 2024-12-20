FROM node:lts-alpine
ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install necessary packages for building native modules
RUN apk add --no-cache bash make g++ python3 python3-dev py3-pip curl chromium

# Install chromium for puppeteer
# RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont libx11 libxcomposite libxdamage libxrandr libxi libxtst libnss alsa-lib at-spi2-core gtk+3.0 libdrm libgbm

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
# COPY src ./src  
# COPY test ./test  
# COPY downloads ./downloads

# Copy the .env file
COPY .env .env

# Expose ports for the application and debugging
EXPOSE 3005
EXPOSE 9229
EXPOSE 8081
EXPOSE 8082
EXPOSE 4040 

# Set permissions and switch to non-root user
RUN chown -R node /usr/src/app
USER node

# Rebuild native modules
RUN npm rebuild


# Command to run the application with debugging enabled
# CMD ["./wait-for-it.sh", "elasticsearch:9200", "--timeout=90", "--strict", "--", "node", "--inspect=0.0.0.0:9229", "index.js", "--keepDBUpToDate", "10", "100"]

# CMD ["./wait-for-it.sh", "elasticsearch:9200", "--timeout=90", "--strict", "--", \
#      "./wait-for-it.sh", "speech-synthesizer:8082", "--timeout=90", "--strict", "--", \
#      "curl", "-f", "http://speech-synthesizer:8082/health", "||", \
#      "echo 'Waiting for synthesizer to be ready'", "sleep 5", ";", \
#      "sh", "-c", "node --inspect=0.0.0.0:9229 index.js --keepDBUpToDate 10 100"]

# CMD ["./wait-for-it.sh", "elasticsearch:9200", "--timeout=90", "--strict", "--", "sh", "-c", "\
#     "./wait-for-it.sh", "speech-synthesizer:8082", "--timeout=400", "--strict", "--", \
#      "curl", "-f", "http://speech-synthesizer:8082/health", "||", \
#      "echo 'Waiting for synthesizer to be ready'", "sleep 5", ";", \
#      node --inspect=0.0.0.0:9229 index.js --keepDBUpToDate 10 100"]
# python3 coqui_tts.py & \

# Start the Node.js server and Python APIs for LLaMA2 and Coqui TTS
# CMD ./wait-for-it.sh", "speech-synthesizer:8082", "--timeout=400", "--strict", "--\
#   sh -c 'until curl -s -f http://speech-synthesizer:8082/health; do \
#            echo "Waiting for synthesizer to be ready..."; \
#            sleep 5; \
#          done && \
#          python3 llama_text_generator.py & \
#          python3 coqui_tts.py & \
#          exec node --inspect=0.0.0.0:9229 index.js --keepDBUpToDate 10 100'
  
  # python3 llama_text_generator.py & \
  # python3 coqui_tts.py & \
# # Start the Node.js server and Python APIs for LLaMA2 and Coqui TTS




# # pretty sure this works
# CMD ["./wait-for-it.sh", "elasticsearch:9200", "--timeout=90", "--strict", "--", "sh", "-c", "\
# node --inspect=0.0.0.0:9229 index.js --keepDBUpToDate 10 100"]


# suggested by chatgpt
CMD ["sh", "-c", "\
  ./wait-for-it.sh elasticsearch:9200 --timeout=90 --strict -- \
  ./wait-for-it.sh speech-synthesizer:8082 --timeout=600 --strict -- \
  # start ngrok if needed
  ngrok start --config /usr/src/app/ngrok.yml & \ 
  node --inspect=0.0.0.0:9229 index.js --keepDBUpToDate 10 100"]


# python3 llama_text_generator.py & \
# python3 coqui_tts.py & \

# CMD ["./wait-for-it.sh", "elasticsearch:9200", "--timeout=90", "--strict", "--", "node", "--inspect=0.0.0.0:9229", "index.js"]
# Add healthcheck for the app (ensure curl is installed)
HEALTHCHECK --interval=75s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3005/api/health || exit 1