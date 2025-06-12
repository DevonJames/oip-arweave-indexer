# Dockerfile for LLaMA2 Text Generator
FROM python:3.9-slim

# Upgrade pip to the latest version
RUN pip install --upgrade pip

# Install required dependencies including sentencepiece for LlamaTokenizer
RUN pip install --default-timeout=1000 torch transformers flask sentencepiece

# Copy the app
COPY . /app

# Set the working directory
WORKDIR /app

# Download the LLaMA2 model and tokenizer during the Docker build
RUN python -c "from transformers import LlamaTokenizer, LlamaForCausalLM; \
    tokenizer = LlamaTokenizer.from_pretrained('meta-llama/Llama-2-7b'); \
    model = LlamaForCausalLM.from_pretrained('meta-llama/Llama-2-7b', device_map='auto')"

# Expose the port for the API
EXPOSE 8081

# Run the text generation API
CMD ["python", "llama_text_generator.py"]