# Local LLM Model Installation and Management Guide

## Overview

Foundry AI Assistant uses **Ollama** to manage and run local Large Language Models (LLMs) completely on your own hardware. This guide explains how models are installed, stored, managed, and integrated into the application's voice and chat functionality.

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Chat UI       │    │   Backend API   │    │   Ollama        │    │   Local Storage │
│   Port 3000     │    │   Port 8000     │    │   Port 11434    │    │   Host Volume   │
├─────────────────┤    ├─────────────────┤    ├─────────────────┤    ├─────────────────┤
│ • Model Picker  │───▶│ • Model Router  │───▶│ • Model Runner  │───▶│ • Model Binaries│
│ • Dynamic List  │    │ • RAG Pipeline  │    │ • REST API      │    │ • Persistent    │
│ • Instant       │◀───┤ • Model         │◀───┤ • Memory Mgmt   │◀───┤   Storage       │
│   Switching     │    │   Discovery     │    │ • Auto-loading  │    │ • ./ollama_data │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 1. Ollama Service Configuration

### Docker Compose Setup

The Ollama service runs as a containerized service with persistent storage:

```yaml
# docker-compose.yml
services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ./ollama_data:/root/.ollama  # Persistent model storage
    networks:
      - foundry-network
```

### Volume Mounting and Persistence

**Local Storage Path**: `./ollama_data` (project root)
**Container Path**: `/root/.ollama`
**Purpose**: Ensures models persist across container restarts

```bash
# Directory structure
ollama_data/
├── models/
│   ├── manifests/
│   │   └── registry.ollama.ai/
│   │       ├── library/
│   │       │   ├── mistral/
│   │       │   ├── llama2/
│   │       │   └── tinyllama/
│   └── blobs/
│       ├── sha256-abc123...  # Model weight files
│       ├── sha256-def456...
│       └── sha256-ghi789...
```

### Environment Configuration

```bash
# Environment variables (exampleenv)
OLLAMA_HOST=http://ollama:11434           # Docker networking
OLLAMA_BASE_URL=http://localhost:11434    # Local development
```

## 2. Model Installation Methods

### Method 1: Automated Installation (Recommended)

The `docker-run.sh` script provides one-click model installation:

```bash
# Install default models (Mistral and LLaMA2)
./docker-run.sh pull-models

# This executes:
docker-compose exec ollama ollama pull llama2
docker-compose exec ollama ollama pull mistral
```

**Script Implementation**:
```bash
# Function to pull Ollama models
pull_models() {
    echo -e "${GREEN}Pulling Ollama models...${NC}"
    docker-compose exec ollama ollama pull llama2
    docker-compose exec ollama ollama pull mistral
}
```

### Method 2: Manual Model Installation

Install specific models directly:

```bash
# Connect to Ollama container
docker exec -it foundry-ollama-1 /bin/bash

# Inside container - install models
ollama pull mistral        # 4.1 GB - Fast, general purpose
ollama pull llama2         # 3.8 GB - Creative, analytical  
ollama pull tinyllama      # 637 MB - Ultra-fast, simple tasks
ollama pull phi            # 2.7 GB - Microsoft's efficient model
ollama pull neural-chat    # 7 GB - Intel's optimized model
ollama pull zephyr         # 7 GB - Instruction-tuned model
ollama pull mixtral        # 47 GB - High-quality, resource intensive
ollama pull llama2:13b     # 13 GB - Larger LLaMA2 variant
ollama pull llama2:70b     # 70 GB - Production-quality (requires 64GB+ RAM)
```

### Method 3: Direct Docker Commands

Install without entering the container:

```bash
# Install specific models
docker exec foundry-ollama-1 ollama pull mistral
docker exec foundry-ollama-1 ollama pull llama2:13b
docker exec foundry-ollama-1 ollama pull codellama  # Code-specialized model

# Install quantized versions (smaller memory footprint)
docker exec foundry-ollama-1 ollama pull llama2:7b-q4_0
docker exec foundry-ollama-1 ollama pull mistral:7b-q4_K_M
```

### Method 4: Batch Installation Script

For multiple models at once:

```bash
#!/bin/bash
# install_models.sh

models=(
    "mistral"
    "llama2"
    "tinyllama"
    "phi"
    "neural-chat"
    "zephyr"
)

for model in "${models[@]}"; do
    echo "Installing $model..."
    docker exec foundry-ollama-1 ollama pull "$model"
    echo "$model installation complete."
done
```

## 3. Model Discovery and Management

### Backend Model Discovery (`backend/app/routers/chat.py`)

The system automatically discovers installed models through Ollama's API:

```python
@router.get("/models")
async def list_models():
    """List available models from Ollama."""
    try:
        # Connect to Ollama service
        ollama_host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
        client = ollama.Client(host=ollama_host)
        
        # Query installed models
        models_response = client.list()
        
        # Process model information
        models = []
        for model in models_response.get('models', []):
            model_info = {
                "name": model.get('name', 'unknown'),
                "size": f"{model.get('size', 0) / (1024**3):.1f} GB",
                "modified": model.get('modified')  # Last update timestamp
            }
            models.append(model_info)
        
        # Return current state
        return {
            "models": models,
            "current_model": rag_chain.model_name  # Active model
        }
        
    except Exception as e:
        # Graceful fallback if Ollama unavailable
        return {
            "models": [
                {"name": "mistral", "size": "4.1 GB"},
                {"name": "llama2", "size": "3.8 GB"},
                {"name": "tinyllama", "size": "0.6 GB"}
            ],
            "current_model": "mistral"
        }
```

### Frontend Model Selection (`frontend/src/components/ChatInterface.tsx`)

The UI dynamically loads and displays available models:

```typescript
interface Model {
  name: string;
  size: string;
  modified?: string;
}

// Fetch available models on component mount
useEffect(() => {
  const fetchModels = async () => {
    try {
      const response = await chatAPI.getModels() as ModelsResponse;
      
      // Normalize model data format
      const normalizedModels: Model[] = response.models.map((model: any) => {
        if (typeof model === 'string') {
          return { name: model, size: 'Unknown' };
        } else {
          return model;  // Already in object format
        }
      });
      
      setModels(normalizedModels);
      setSelectedModel(response.current_model || 'mistral');
      
    } catch (error) {
      // Fallback models if API unavailable
      setModels([
        { name: 'mistral', size: '4.1 GB' },
        { name: 'llama2', size: '3.8 GB' },
        { name: 'tinyllama', size: '637 MB' }
      ]);
    }
  };

  fetchModels();
}, []);

// Model selection UI
<select
  value={selectedModel}
  onChange={(e) => setSelectedModel(e.target.value)}
  className="bg-gray-700 border border-gray-600 rounded px-3 py-1"
>
  {models.map((model) => (
    <option key={model.name} value={model.name}>
      {model.name} ({model.size})
    </option>
  ))}
</select>
```

## 4. Dynamic Model Switching

### Runtime Model Switching

The system supports instant model switching without restarts:

```python
# RAG Chain model switching (backend/app/rag/chain.py)
class RAGChain:
    def switch_model(self, model_name: str):
        """Switch to a different model instantly."""
        if model_name == self.model_name:
            return  # No change needed
        
        old_model = self.model_name
        self.model_name = model_name
        logger.info(f"Switched model from {old_model} to {self.model_name}")
    
    async def _call_ollama_direct(self, prompt: str) -> str:
        """Call Ollama with currently selected model."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": self.model_name,  # Use current model
                    "prompt": prompt,
                    "stream": False
                }
            )
            
            result = response.json()
            return result.get("response", "").strip()
```

### Chat Integration

Model switching is integrated into the chat flow:

```python
@router.post("/query", response_model=ChatResponse)
async def chat_query(
    request: ChatRequest,
    current_user: User = Depends(get_current_user)
):
    """Process chat query with specified model."""
    
    # Switch model if user specified different one
    if request.model and request.model != rag_chain.model_name:
        rag_chain.switch_model(request.model)
    
    # Process through RAG pipeline with new model
    result = await rag_chain.query(
        question=request.query,
        user_id=str(current_user.id)
    )
    
    return ChatResponse(
        response=result["answer"],
        sources=result["sources"],
        model=result["model"]  # Confirm which model was used
    )
```

## 5. Model Storage and Memory Management

### Storage Requirements

**Model Size Examples**:
- **TinyLlama**: 637 MB (minimal memory usage)
- **Mistral 7B**: 4.1 GB (balanced performance)
- **LLaMA2 7B**: 3.8 GB (general purpose)
- **LLaMA2 13B**: 13 GB (enhanced capability)
- **Mixtral 8x7B**: 47 GB (enterprise quality)
- **LLaMA2 70B**: 70 GB (production ready)

### Memory Optimization

**Quantization Support**:
```bash
# 4-bit quantized models (smaller memory footprint)
docker exec foundry-ollama-1 ollama pull llama2:7b-q4_0
docker exec foundry-ollama-1 ollama pull mistral:7b-q4_K_M
docker exec foundry-ollama-1 ollama pull llama2:13b-q4_0

# 8-bit quantized models (balance size/quality)
docker exec foundry-ollama-1 ollama pull llama2:7b-q8_0
docker exec foundry-ollama-1 ollama pull mixtral:8x7b-q8_0
```

### Hardware Requirements

**Memory Guidelines**:
- **Minimum**: 16 GB RAM (for 7B models)
- **Recommended**: 32 GB RAM (for 13B models)
- **Optimal**: 64+ GB RAM (for 70B models)

**Storage Guidelines**:
- **Minimum**: 50 GB free space
- **Recommended**: 200 GB free space
- **Enterprise**: 500+ GB for model variety

## 6. Model Performance and Characteristics

### Model Comparison Matrix

| Model | Size | RAM Usage | Speed | Use Case | Strengths |
|-------|------|-----------|-------|----------|-----------|
| **TinyLlama** | 637 MB | ~1 GB | ⚡⚡⚡ | Quick queries | Ultra-fast, minimal resources |
| **Mistral 7B** | 4.1 GB | ~6 GB | ⚡⚡ | General purpose | Balanced speed/quality |
| **LLaMA2 7B** | 3.8 GB | ~6 GB | ⚡⚡ | Creative tasks | Better reasoning |
| **Phi 2.7B** | 2.7 GB | ~4 GB | ⚡⚡⚡ | Code/Math | Microsoft optimized |
| **LLaMA2 13B** | 13 GB | ~16 GB | ⚡ | Detailed responses | Enhanced capability |
| **Mixtral 8x7B** | 47 GB | ~48 GB | ⚡ | Production | Mixture of experts |

### Performance Optimization

**Model Loading**:
- First query loads model into memory (~30s for large models)
- Subsequent queries are fast (cached in RAM)
- Ollama automatically manages memory

**Speed Optimization**:
```python
# RAG chain prompt optimization for faster inference
max_prompt_length = 2000  # Prevent timeout
if len(prompt) > max_prompt_length:
    # Intelligently truncate while preserving question
    parts = prompt.split("Question:")
    if len(parts) == 2:
        context_part = parts[0]
        question_part = "Question:" + parts[1]
        max_context = max_prompt_length - len(question_part) - 100
        if max_context > 0:
            truncated_context = context_part[:max_context] + "...\n\n"
            prompt = truncated_context + question_part
```

## 7. Model Installation Verification

### Health Checking

```bash
# Check Ollama service status
curl -s http://localhost:11434/api/tags | jq '.'

# Expected response:
{
  "models": [
    {
      "name": "mistral:latest",
      "size": 4109669376,
      "digest": "sha256:...",
      "modified": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Installation Verification Script

```bash
#!/bin/bash
# verify_models.sh

echo "🔍 Checking Ollama service..."
curl -s http://localhost:11434/api/tags > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Ollama service is running"
else
    echo "❌ Ollama service not accessible"
    exit 1
fi

echo ""
echo "📋 Installed models:"
docker exec foundry-ollama-1 ollama list

echo ""
echo "💾 Storage usage:"
du -sh ./ollama_data/

echo ""
echo "🧠 Memory usage:"
docker stats foundry-ollama-1 --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

## 8. Troubleshooting

### Common Issues and Solutions

**🔴 Model Not Appearing in UI**
```bash
# 1. Verify model is installed
docker exec foundry-ollama-1 ollama list

# 2. Check Ollama service health
curl http://localhost:11434/api/tags

# 3. Restart API service to refresh model list
docker restart foundry-api-1
```

**🔴 Out of Memory Errors**
```bash
# Use smaller/quantized models
docker exec foundry-ollama-1 ollama pull tinyllama
docker exec foundry-ollama-1 ollama pull llama2:7b-q4_0

# Check available memory
free -h
docker stats foundry-ollama-1
```

**🔴 Slow Model Loading**
```bash
# Check disk space
df -h

# Monitor model loading
docker logs foundry-ollama-1 -f

# Use SSD storage for better performance
# Consider model caching strategies
```

**🔴 Model Download Failures**
```bash
# Check internet connectivity
ping registry.ollama.ai

# Check available disk space
df -h

# Retry with verbose logging
docker exec foundry-ollama-1 ollama pull mistral --verbose
```

### Performance Debugging

```python
# Backend performance monitoring
@router.get("/models/performance")
async def model_performance():
    """Get model performance metrics."""
    try:
        import psutil
        
        return {
            "cpu_percent": psutil.cpu_percent(),
            "memory_percent": psutil.virtual_memory().percent,
            "disk_usage": psutil.disk_usage('./ollama_data').percent,
            "ollama_status": "running" if ollama_health_check() else "down"
        }
    except Exception as e:
        return {"error": str(e)}
```

## 9. Advanced Model Management

### Model Updates and Versioning

```bash
# Update existing models to latest versions
docker exec foundry-ollama-1 ollama pull mistral:latest
docker exec foundry-ollama-1 ollama pull llama2:latest

# Install specific versions
docker exec foundry-ollama-1 ollama pull llama2:7b-chat
docker exec foundry-ollama-1 ollama pull llama2:13b-chat

# List all installed models with versions
docker exec foundry-ollama-1 ollama list
```

### Model Cleanup and Maintenance

```bash
# Remove unused models
docker exec foundry-ollama-1 ollama rm old-model:version

# Check storage usage
docker exec foundry-ollama-1 du -sh /root/.ollama/

# Clean up unused blobs (careful!)
docker exec foundry-ollama-1 ollama prune
```

### Custom Model Import

```bash
# Import custom GGUF models
docker exec foundry-ollama-1 ollama create my-custom-model -f Modelfile

# Example Modelfile:
FROM ./custom-model.gguf
PARAMETER temperature 0.7
PARAMETER top_p 0.9
```

## 10. Integration with Voice Pipeline

### Model Selection for Voice Queries

The voice pipeline automatically uses the selected model:

```typescript
// Voice query processing
const handleSendMessage = async (messageText?: string) => {
  // Send to LLM with current model selection
  const response = await fetch('/api/v1/chat/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ 
      query: messageContent,
      model: selectedModel  // User-selected model
    }),
  });

  const data = await response.json();
  
  // Speak response with TTS
  if (messageText) {
    speak(data.response, selectedVoice);
  }
};
```

### Model Performance for Voice

**Recommended Models for Voice Interaction**:
- **TinyLlama**: Ultra-fast responses (<1s), good for simple commands
- **Mistral**: Balanced speed/quality (1-2s), ideal for general conversation
- **LLaMA2**: Higher quality responses (2-3s), better for complex queries

## 11. Deployment Considerations

### Production Deployment

```yaml
# Production docker-compose.yml optimizations
services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ./ollama_data:/root/.ollama
    environment:
      - OLLAMA_NUM_PARALLEL=2        # Concurrent requests
      - OLLAMA_MAX_LOADED_MODELS=3   # Memory management
      - OLLAMA_KEEP_ALIVE=24h        # Keep models loaded
    deploy:
      resources:
        limits:
          memory: 32G               # Set memory limits
          cpus: '8'                 # CPU allocation
```

### Backup and Recovery

```bash
# Backup models and configuration
tar -czf ollama_backup_$(date +%Y%m%d).tar.gz ./ollama_data/

# Restore models
tar -xzf ollama_backup_20240115.tar.gz

# Verify restored models
docker exec foundry-ollama-1 ollama list
```

## 12. Future Enhancements

### Planned Features

1. **Automatic Model Updates**: Scheduled model version checks
2. **Model Performance Benchmarking**: Built-in speed/quality testing
3. **GPU Acceleration**: NVIDIA GPU support for faster inference
4. **Model Recommendations**: AI-suggested models based on usage patterns
5. **Custom Model Training**: Fine-tuning interface for domain-specific models

### API Extensions

```python
# Future model management endpoints
@router.post("/models/install")
async def install_model(model_name: str):
    """Install a model programmatically."""
    pass

@router.delete("/models/{model_name}")
async def remove_model(model_name: str):
    """Remove an installed model."""
    pass

@router.get("/models/{model_name}/performance")
async def model_performance(model_name: str):
    """Get model-specific performance metrics."""
    pass
```

## Conclusion

Foundry AI Assistant provides a sophisticated yet user-friendly system for managing local LLM models through Ollama. The architecture ensures:

- **Complete Privacy**: All models run locally, no data leaves your system
- **Easy Installation**: One-click model installation and management
- **Dynamic Switching**: Instant model changes without service restarts
- **Persistent Storage**: Models are cached for fast startup and survival across updates
- **Performance Optimization**: Intelligent prompt management and memory usage
- **Voice Integration**: Seamless integration with STT/TTS pipeline
- **Scalable Architecture**: From lightweight models to enterprise-grade inference

The system balances ease of use with powerful functionality, making local AI accessible while maintaining the privacy and control that comes with on-premise deployment.

## Quick Reference Commands

```bash
# Essential Commands
./docker-run.sh start           # Start all services
./docker-run.sh pull-models     # Install default models
./docker-run.sh health          # Check service status

# Model Management
docker exec foundry-ollama-1 ollama list                    # List installed models
docker exec foundry-ollama-1 ollama pull mistral           # Install specific model
docker exec foundry-ollama-1 ollama rm old-model          # Remove model
curl http://localhost:11434/api/tags                       # API model list

# Debugging
docker logs foundry-ollama-1 -f                           # View Ollama logs
docker stats foundry-ollama-1                             # Monitor resources
du -sh ./ollama_data/                                      # Check storage usage
``` 