#!/usr/bin/env python3
import os
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch

print('📥 Downloading LLaMA 3.2 models...')

# Download 3B model
try:
    print('Downloading 3B model from HuggingFace')
    tokenizer = AutoTokenizer.from_pretrained('meta-llama/Llama-3.2-3B')
    model = AutoModelForCausalLM.from_pretrained('meta-llama/Llama-3.2-3B', torch_dtype=torch.float16)
    tokenizer.save_pretrained('/app/models/llama-3.2-3b')
    model.save_pretrained('/app/models/llama-3.2-3b')
    print('✅ 3B model downloaded successfully')
except Exception as e:
    print(f'❌ 3B model download failed: {e}')

# Download 11B model  
try:
    print('Downloading 11B model from HuggingFace')
    tokenizer = AutoTokenizer.from_pretrained('meta-llama/Llama-3.2-11B')
    model = AutoModelForCausalLM.from_pretrained('meta-llama/Llama-3.2-11B', torch_dtype=torch.float16)
    tokenizer.save_pretrained('/app/models/llama-3.2-11b')
    model.save_pretrained('/app/models/llama-3.2-11b')
    print('✅ 11B model downloaded successfully')
except Exception as e:
    print(f'❌ 11B model download failed: {e}')

print('🎯 Model download process complete') 