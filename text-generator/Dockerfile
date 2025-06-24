# Dockerfile for LLaMA2 Text Generator
FROM python:3.9-slim

# Upgrade pip to the latest version
RUN pip install --upgrade pip

# Install required dependencies including sentencepiece for LlamaTokenizer
RUN pip install --default-timeout=1000 torch transformers flask sentencepiece wget

# Copy the app
COPY . /app

# Set the working directory
WORKDIR /app

# Create directories for models
RUN mkdir -p /app/models/llama-3.2-3b /app/models/llama-3.2-11b

# Download LLaMA 3.2 models from HuggingFace (now that you have access)
RUN python download_models.py

# Expose the port for the API
EXPOSE 8081

# Run the text generation API
CMD ["python", "llama_text_generator.py"]