#!/bin/bash

# OIP LLM Model Installation Script
# Uses Ollama to install and manage local LLM models

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 OIP LLM Model Installation${NC}"
echo ""

# Check if docker-compose is running
if ! docker-compose ps | grep -q ollama; then
    echo -e "${YELLOW}⚠️  Ollama service not running. Starting services...${NC}"
    docker-compose --profile full-gpu up -d ollama
    echo -e "${BLUE}⏳ Waiting for Ollama to start...${NC}"
    sleep 10
fi

# Wait for Ollama service to be ready
echo -e "${BLUE}🔍 Checking Ollama service...${NC}"
max_retries=30
for i in $(seq 1 $max_retries); do
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Ollama service is ready${NC}"
        break
    else
        echo -e "${YELLOW}⏳ Waiting for Ollama... ($i/$max_retries)${NC}"
        sleep 2
    fi
    
    if [ $i -eq $max_retries ]; then
        echo -e "${RED}❌ Ollama service failed to start${NC}"
        exit 1
    fi
done

echo ""
echo -e "${BLUE}📦 Installing LLM Models...${NC}"
echo ""

# Model installation function
install_model() {
    local model_name=$1
    local display_name=$2
    local size=$3
    
    echo -e "${BLUE}📥 Installing $display_name ($size)...${NC}"
    
    if docker exec $(docker-compose ps -q ollama) ollama pull "$model_name"; then
        echo -e "${GREEN}✅ Successfully installed $display_name${NC}"
    else
        echo -e "${RED}❌ Failed to install $display_name${NC}"
        return 1
    fi
    echo ""
}

# Install models (following the proven guide's recommendations)
echo -e "${YELLOW}Installing recommended models for OIP Voice Assistant:${NC}"
echo ""

# 1. TinyLlama - Ultra-fast for quick responses
install_model "tinyllama" "TinyLlama" "637 MB"

# 2. Mistral - Balanced performance for general conversation
install_model "mistral" "Mistral 7B" "4.1 GB"

# 3. LLaMA 2 - Creative and analytical responses
install_model "llama2" "LLaMA 2 7B" "3.8 GB"

# 4. LLaMA 3.2 3B - Fast, efficient modern model (user requested)
echo -e "${BLUE}📥 Installing LLaMA 3.2 3B (2.0 GB)...${NC}"
if docker exec $(docker-compose ps -q ollama) ollama pull llama3.2:3b; then
    echo -e "${GREEN}✅ Successfully installed LLaMA 3.2 3B${NC}"
else
    echo -e "${YELLOW}⚠️  LLaMA 3.2 3B not available, trying alternative...${NC}"
    # Try the instruct variant
    if docker exec $(docker-compose ps -q ollama) ollama pull llama3.2:3b-instruct-q4_0; then
        echo -e "${GREEN}✅ Successfully installed LLaMA 3.2 3B Instruct${NC}"
    else
        echo -e "${RED}❌ LLaMA 3.2 variants not available${NC}"
    fi
fi
echo ""

# Verify installations
echo -e "${BLUE}🔍 Verifying installed models...${NC}"
echo ""

if docker exec $(docker-compose ps -q ollama) ollama list; then
    echo ""
    echo -e "${GREEN}✅ Model installation complete!${NC}"
    echo ""
    echo -e "${BLUE}📊 Model Usage Recommendations:${NC}"
    echo -e "  ${GREEN}TinyLlama${NC}    - Ultra-fast responses (<1s), simple queries"
    echo -e "  ${GREEN}Mistral${NC}      - Balanced performance (1-2s), general conversation"
    echo -e "  ${GREEN}LLaMA 2${NC}      - High quality (2-3s), creative/analytical tasks"
    echo -e "  ${GREEN}LLaMA 3.2${NC}    - Modern efficiency (1-2s), latest capabilities"
    echo ""
    echo -e "${BLUE}🎯 Default model set to: ${GREEN}llama3.2:3b${NC}"
    echo ""
    echo -e "${YELLOW}💡 You can switch models in the Voice Assistant interface!${NC}"
else
    echo -e "${RED}❌ Failed to verify models${NC}"
    exit 1
fi

# Check storage usage
echo -e "${BLUE}💾 Storage usage:${NC}"
du -sh ./ollama_data/ 2>/dev/null || echo "Storage info not available"

echo ""
echo -e "${GREEN}🎉 LLM setup complete! Your Voice Assistant is ready.${NC}"
echo -e "${BLUE}🌐 Access your assistant at: ${GREEN}http://localhost:3005${NC}" 