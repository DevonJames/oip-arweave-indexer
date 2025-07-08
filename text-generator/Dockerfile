# Dockerfile for LLaMA2 Text Generator
FROM python:3.9-slim

WORKDIR /app

# Install basic dependencies only (no heavy ML libraries needed)
RUN pip install --no-cache-dir \
    flask==2.3.3 \
    requests==2.31.0

# Copy service files
COPY . .

# Expose port
EXPOSE 8081

# Run the service
CMD ["python", "llama_text_generator.py"]