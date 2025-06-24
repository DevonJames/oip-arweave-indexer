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
RUN python -c "\
import os; \
from transformers import AutoTokenizer, AutoModelForCausalLM; \
import torch; \
print('📥 Downloading LLaMA 3.2 models...'); \
try: \
    print('Downloading 3B model from HuggingFace'); \
    tokenizer = AutoTokenizer.from_pretrained('meta-llama/Llama-3.2-3B'); \
    model = AutoModelForCausalLM.from_pretrained('meta-llama/Llama-3.2-3B', torch_dtype=torch.float16); \
    tokenizer.save_pretrained('/app/models/llama-3.2-3b'); \
    model.save_pretrained('/app/models/llama-3.2-3b'); \
    print('✅ 3B model downloaded successfully'); \
except Exception as e: \
    print(f'❌ 3B model download failed: {e}'); \
try: \
    print('Downloading 11B model from HuggingFace'); \
    tokenizer = AutoTokenizer.from_pretrained('meta-llama/Llama-3.2-11B'); \
    model = AutoModelForCausalLM.from_pretrained('meta-llama/Llama-3.2-11B', torch_dtype=torch.float16); \
    tokenizer.save_pretrained('/app/models/llama-3.2-11b'); \
    model.save_pretrained('/app/models/llama-3.2-11b'); \
    print('✅ 11B model downloaded successfully'); \
except Exception as e: \
    print(f'❌ 11B model download failed: {e}'); \
print('🎯 Model download process complete'); \
"

# Expose the port for the API
EXPOSE 8081

# Run the text generation API
CMD ["python", "llama_text_generator.py"]