# Base image with ngrok installed
FROM ngrok/ngrok

# Copy the ngrok.yml configuration file
COPY ngrok.yml /usr/src/app/ngrok.yml

# Ensure permissions are correct
# RUN chmod 644 /usr/src/app/ngrok.yml

# Run ngrok with the provided configuration file
CMD ["start","--config", "/usr/src/app/ngrok.ylm", "--all"]
