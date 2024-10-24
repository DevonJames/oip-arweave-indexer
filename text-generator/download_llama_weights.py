from transformers import LlamaForCausalLM, LlamaTokenizer

# Specify the larger model name (70B in this case)
model_name = "meta-llama/Llama-2-70b"

# Download the tokenizer and model weights
print("Downloading tokenizer for LLaMA2 70B...")
tokenizer = LlamaTokenizer.from_pretrained(model_name)

print("Downloading model weights for LLaMA2 70B...")
model = LlamaForCausalLM.from_pretrained(model_name)

print("LLaMA2 70B model and tokenizer downloaded successfully!")