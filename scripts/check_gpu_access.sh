#!/bin/bash
# Script to verify GPU access for Docker containers
# Run this to diagnose GPU detection issues

echo "=========================================="
echo "GPU Access Diagnostic Script"
echo "=========================================="
echo ""

# Check if nvidia-smi works on host
echo "1. Checking NVIDIA driver on host..."
if command -v nvidia-smi &> /dev/null; then
    echo "   ✅ nvidia-smi found"
    nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
else
    echo "   ❌ nvidia-smi not found - NVIDIA driver may not be installed"
    exit 1
fi

echo ""
echo "2. Checking Docker GPU runtime..."
if docker info 2>/dev/null | grep -q nvidia; then
    echo "   ✅ NVIDIA runtime detected in Docker"
else
    echo "   ⚠️ NVIDIA runtime not detected in Docker info"
    echo "   This might be normal if using newer nvidia-container-toolkit"
fi

echo ""
echo "3. Testing GPU access in Docker container..."
if docker run --rm --gpus all nvidia/cuda:11.7.1-base-ubuntu20.04 nvidia-smi &> /dev/null; then
    echo "   ✅ GPU access works in Docker containers"
    docker run --rm --gpus all nvidia/cuda:11.7.1-base-ubuntu20.04 nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
else
    echo "   ❌ GPU access FAILED in Docker containers"
    echo ""
    echo "   Troubleshooting steps:"
    echo "   1. Install nvidia-container-toolkit:"
    echo "      - Ubuntu/Debian: sudo apt-get install -y nvidia-container-toolkit"
    echo "      - Then: sudo systemctl restart docker"
    echo ""
    echo "   2. Or install nvidia-docker2 (older method):"
    echo "      - Follow: https://github.com/NVIDIA/nvidia-docker"
    echo ""
    echo "   3. Verify Docker daemon has GPU support:"
    echo "      - Check: cat /etc/docker/daemon.json"
    echo "      - Should contain: \"default-runtime\": \"nvidia\" or \"runtimes\": { \"nvidia\": ... }"
    exit 1
fi

echo ""
echo "4. Checking PyTorch CUDA detection..."
docker run --rm --gpus all nvidia/cuda:11.7.1-base-ubuntu20.04 bash -c "
    apt-get update -qq && apt-get install -y python3-pip -qq > /dev/null 2>&1
    pip3 install torch --index-url https://download.pytorch.org/whl/cu118 -qq > /dev/null 2>&1
    python3 -c 'import torch; print(\"   PyTorch version:\", torch.__version__); print(\"   CUDA available:\", torch.cuda.is_available()); print(\"   CUDA device:\", torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"N/A\")'
"

echo ""
echo "=========================================="
echo "Diagnostic complete!"
echo "=========================================="
echo ""
echo "If GPU access works above but your container still doesn't detect it:"
echo "  1. Rebuild the container: docker-compose build tts-service-gpu"
echo "  2. Restart the service: docker-compose restart tts-service-gpu"
echo "  3. Check container logs: docker-compose logs tts-service-gpu"
echo ""

