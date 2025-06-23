from transformers import AutoTokenizer, AutoModelForCausalLM
from flask import Flask, request, jsonify
import torch
import os

app = Flask(__name__)

# Configuration - can be overridden by environment variables
DEFAULT_MODEL = os.getenv('LLAMA_MODEL', '11b')  # '3b' or '11b'
MODEL_BASE_PATH = '/app/models'

# Model configurations
MODELS = {
    '3b': {
        'local_path': f'{MODEL_BASE_PATH}/llama-3.2-3b',
        'hf_name': 'meta-llama/Llama-3.2-3B',
        'vram_gb': 6  # Approximate VRAM usage
    },
    '11b': {
        'local_path': f'{MODEL_BASE_PATH}/llama-3.2-11b', 
        'hf_name': 'meta-llama/Llama-3.2-11B',
        'vram_gb': 13  # Approximate VRAM usage
    }
}

def load_model(model_size=DEFAULT_MODEL):
    """Load the specified model (3b or 11b)"""
    config = MODELS.get(model_size, MODELS['11b'])
    
    print(f"Loading LLaMA 3.2 {model_size.upper()} model...")
    
    # Try local model first, then HuggingFace
    model_path = config['local_path'] if os.path.exists(config['local_path']) else config['hf_name']
    
    try:
        tokenizer = AutoTokenizer.from_pretrained(model_path)
        model = AutoModelForCausalLM.from_pretrained(
            model_path,
            torch_dtype=torch.float16,
            device_map="auto",
            trust_remote_code=True
        )
        print(f"✅ Successfully loaded {model_size.upper()} model (~{config['vram_gb']}GB VRAM)")
        return tokenizer, model, model_size
    except Exception as e:
        print(f"❌ Failed to load {model_size.upper()} model: {e}")
        if model_size != '3b':
            print("🔄 Falling back to 3B model...")
            return load_model('3b')
        else:
            raise e

# Load the model
tokenizer, model, current_model_size = load_model()

@app.route("/generate", methods=["POST"])
def generate_text():
    data = request.json
    prompt = data.get("prompt", "")
    max_length = data.get("max_length", 512)
    temperature = data.get("temperature", 0.7)
    requested_model = data.get("model", current_model_size)  # Allow per-request model selection
    
    # Switch model if requested (and different from current)
    global tokenizer, model, current_model_size
    if requested_model != current_model_size and requested_model in MODELS:
        try:
            print(f"🔄 Switching from {current_model_size.upper()} to {requested_model.upper()} model...")
            tokenizer, model, current_model_size = load_model(requested_model)
        except Exception as e:
            print(f"❌ Failed to switch to {requested_model.upper()} model: {e}")
            # Continue with current model
    
    # Tokenize input
    inputs = tokenizer(prompt, return_tensors="pt")
    
    # Move inputs to same device as model
    device = next(model.parameters()).device
    inputs = {k: v.to(device) for k, v in inputs.items()}
    
    # Generate text
    with torch.no_grad():
        outputs = model.generate(
            inputs["input_ids"],
            max_length=max_length,
            temperature=temperature,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
            attention_mask=inputs.get("attention_mask")
        )
    
    # Decode response (skip the input prompt)
    generated_ids = outputs[0][inputs["input_ids"].shape[1]:]
    response = tokenizer.decode(generated_ids, skip_special_tokens=True)
    
    return jsonify({
        "generated_text": response,
        "full_response": tokenizer.decode(outputs[0], skip_special_tokens=True),
        "model_used": current_model_size,
        "vram_usage_gb": MODELS[current_model_size]['vram_gb']
    })

@app.route("/models", methods=["GET"])
def list_models():
    """List available models and their status"""
    model_status = {}
    for size, config in MODELS.items():
        model_status[size] = {
            "available": os.path.exists(config['local_path']) or True,  # HF fallback always available
            "vram_gb": config['vram_gb'],
            "currently_loaded": size == current_model_size,
            "local_path_exists": os.path.exists(config['local_path'])
        }
    
    return jsonify({
        "current_model": current_model_size,
        "available_models": model_status
    })

@app.route("/switch", methods=["POST"])
def switch_model():
    """Switch to a different model"""
    data = request.json
    target_model = data.get("model", "11b")
    
    if target_model not in MODELS:
        return jsonify({"error": f"Unknown model: {target_model}"}), 400
    
    if target_model == current_model_size:
        return jsonify({"message": f"Already using {target_model.upper()} model"})
    
    global tokenizer, model, current_model_size
    try:
        print(f"🔄 Switching to {target_model.upper()} model...")
        tokenizer, model, current_model_size = load_model(target_model)
        return jsonify({
            "message": f"Successfully switched to {target_model.upper()} model",
            "model": current_model_size,
            "vram_gb": MODELS[current_model_size]['vram_gb']
        })
    except Exception as e:
        return jsonify({"error": f"Failed to switch to {target_model.upper()} model: {str(e)}"}), 500

@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "current_model": current_model_size,
        "model_loaded": model is not None,
        "cuda_available": torch.cuda.is_available(),
        "gpu_memory": torch.cuda.get_device_properties(0).total_memory // (1024**3) if torch.cuda.is_available() else None
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8081)