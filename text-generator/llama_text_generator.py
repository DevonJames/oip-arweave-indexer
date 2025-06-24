import os
import requests
import time
from flask import Flask, request, jsonify

app = Flask(__name__)

# Configuration
OLLAMA_HOST = os.getenv('OLLAMA_HOST', 'http://localhost:11434')
DEFAULT_MODEL = os.getenv('LLAMA_MODEL', 'llama3.2:3b')

# Available models (will be auto-detected from Ollama)
AVAILABLE_MODELS = {
    'llama3.2:3b': {'name': 'LLaMA 3.2 3B', 'size': '2.0 GB', 'description': 'Fast, efficient model'},
    'mistral': {'name': 'Mistral 7B', 'size': '4.1 GB', 'description': 'Balanced performance'},
    'llama2': {'name': 'LLaMA 2 7B', 'size': '3.8 GB', 'description': 'Creative and analytical'},
    'tinyllama': {'name': 'TinyLlama', 'size': '637 MB', 'description': 'Ultra-fast, minimal resources'}
}

def check_ollama_health():
    """Check if Ollama service is available."""
    try:
        response = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=5)
        return response.status_code == 200
    except:
        return False

def get_installed_models():
    """Get list of installed models from Ollama."""
    try:
        response = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=10)
        if response.status_code == 200:
            data = response.json()
            models = []
            for model in data.get('models', []):
                model_name = model.get('name', '').split(':')[0]  # Remove version tag
                models.append({
                    'name': model.get('name', ''),
                    'size': f"{model.get('size', 0) / (1024**3):.1f} GB",
                    'modified': model.get('modified', ''),
                    'digest': model.get('digest', '')
                })
            return models
        return []
    except Exception as e:
        print(f"Error getting models: {e}")
        return []

def generate_with_ollama(prompt, model_name, max_tokens=512, temperature=0.7):
    """Generate text using Ollama API."""
    try:
        payload = {
            "model": model_name,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens
            }
        }
        
        response = requests.post(
            f"{OLLAMA_HOST}/api/generate",
            json=payload,
            timeout=60  # Longer timeout for generation
        )
        
        if response.status_code == 200:
            data = response.json()
            return data.get("response", "").strip()
        else:
            return f"Error: HTTP {response.status_code} - {response.text}"
            
    except Exception as e:
        return f"Error generating text: {str(e)}"

@app.route("/generate", methods=["POST"])
def generate_text():
    """Generate text using the specified model."""
    data = request.json
    prompt = data.get("prompt", "")
    max_length = data.get("max_length", 512)
    temperature = data.get("temperature", 0.7)
    model = data.get("model", DEFAULT_MODEL)
    
    if not prompt:
        return jsonify({"error": "No prompt provided"}), 400
    
    # Check if Ollama is available
    if not check_ollama_health():
        return jsonify({
            "error": "Ollama service is not available",
            "suggestion": "Please ensure Ollama is running and models are installed"
        }), 503
    
    # Generate text
    start_time = time.time()
    generated_text = generate_with_ollama(prompt, model, max_length, temperature)
    generation_time = time.time() - start_time
    
    return jsonify({
        "generated_text": generated_text,
        "model_used": model,
        "generation_time": f"{generation_time:.2f}s",
        "prompt_length": len(prompt),
        "response_length": len(generated_text)
    })

@app.route("/models", methods=["GET"])
def list_models():
    """List available models."""
    installed_models = get_installed_models()
    
    # Merge with known model info
    models_info = []
    for model in installed_models:
        model_key = model['name'].split(':')[0]  # Remove version tag
        info = AVAILABLE_MODELS.get(model_key, {
            'name': model['name'],
            'description': 'Custom model'
        })
        
        models_info.append({
            'name': model['name'],
            'display_name': info.get('name', model['name']),
            'size': model['size'],
            'description': info.get('description', 'Local model'),
            'modified': model.get('modified', ''),
            'available': True
        })
    
    return jsonify({
        "current_model": DEFAULT_MODEL,
        "available_models": models_info,
        "ollama_status": "healthy" if check_ollama_health() else "unavailable",
        "total_models": len(models_info)
    })

@app.route("/install", methods=["POST"])
def install_model():
    """Install a model via Ollama."""
    data = request.json
    model_name = data.get("model", "")
    
    if not model_name:
        return jsonify({"error": "No model name provided"}), 400
    
    try:
        # Start model pull
        payload = {"name": model_name}
        response = requests.post(f"{OLLAMA_HOST}/api/pull", json=payload, timeout=300)
        
        if response.status_code == 200:
            return jsonify({
                "message": f"Successfully installed model: {model_name}",
                "model": model_name,
                "status": "installed"
            })
        else:
            return jsonify({
                "error": f"Failed to install model: {response.text}",
                "status": "failed"
            }), 500
            
    except Exception as e:
        return jsonify({
            "error": f"Error installing model: {str(e)}",
            "status": "error"
        }), 500

@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    ollama_healthy = check_ollama_health()
    installed_models = get_installed_models() if ollama_healthy else []
    
    return jsonify({
        "status": "healthy" if ollama_healthy else "degraded",
        "ollama_available": ollama_healthy,
        "ollama_host": OLLAMA_HOST,
        "models_installed": len(installed_models),
        "default_model": DEFAULT_MODEL,
        "models": [m['name'] for m in installed_models] if ollama_healthy else []
    })

@app.route("/switch", methods=["POST"])
def switch_model():
    """Switch default model."""
    global DEFAULT_MODEL
    
    data = request.json
    model_name = data.get("model", "")
    
    if not model_name:
        return jsonify({"error": "No model name provided"}), 400
    
    # Verify model exists
    installed_models = get_installed_models()
    model_names = [m['name'] for m in installed_models]
    
    if model_name not in model_names:
        return jsonify({
            "error": f"Model '{model_name}' not found",
            "available_models": model_names
        }), 404
    
    DEFAULT_MODEL = model_name
    
    return jsonify({
        "message": f"Switched to model: {model_name}",
        "current_model": DEFAULT_MODEL
    })

if __name__ == "__main__":
    print(f"🚀 Starting Text Generator with Ollama backend")
    print(f"📡 Ollama host: {OLLAMA_HOST}")
    print(f"🤖 Default model: {DEFAULT_MODEL}")
    
    # Wait for Ollama to be available
    max_retries = 30
    for i in range(max_retries):
        if check_ollama_health():
            print("✅ Ollama service is available")
            break
        else:
            print(f"⏳ Waiting for Ollama service... ({i+1}/{max_retries})")
            time.sleep(2)
    else:
        print("⚠️  Starting without Ollama connection")
    
    app.run(host="0.0.0.0", port=8081)