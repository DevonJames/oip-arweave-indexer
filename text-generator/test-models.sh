#!/bin/bash

# Test script for LLaMA 3.2 models
# Usage: ./test-models.sh [3b|11b|test|health]

BASE_URL="http://localhost:8081"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🦙 LLaMA 3.2 Model Testing Script${NC}"
echo ""

# Function to check if service is running
check_service() {
    curl -s "${BASE_URL}/health" > /dev/null
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Text generation service is running${NC}"
        return 0
    else
        echo -e "${RED}❌ Text generation service is not running${NC}"
        echo "Make sure to start it with: make rebuild PROFILE=full-gpu"
        return 1
    fi
}

# Function to get model status
get_status() {
    echo -e "${BLUE}📊 Current Model Status:${NC}"
    curl -s "${BASE_URL}/models" | jq '.' || echo "Service not responding"
    echo ""
}

# Function to test generation
test_generation() {
    local model=$1
    local prompt="Explain artificial intelligence in simple terms:"
    
    echo -e "${BLUE}🧠 Testing ${model^^} model generation...${NC}"
    
    curl -s -X POST "${BASE_URL}/generate" \
        -H "Content-Type: application/json" \
        -d "{\"prompt\": \"${prompt}\", \"model\": \"${model}\", \"max_length\": 200, \"temperature\": 0.7}" | \
    jq -r '.generated_text' || echo "Generation failed"
    echo ""
}

# Function to switch models
switch_model() {
    local target_model=$1
    echo -e "${YELLOW}🔄 Switching to ${target_model^^} model...${NC}"
    
    curl -s -X POST "${BASE_URL}/switch" \
        -H "Content-Type: application/json" \
        -d "{\"model\": \"${target_model}\"}" | \
    jq '.' || echo "Switch failed"
    echo ""
}

# Function to run comprehensive test
run_test() {
    echo -e "${BLUE}🧪 Running comprehensive model test...${NC}"
    echo ""
    
    # Test 3B model
    switch_model "3b"
    sleep 2
    test_generation "3b"
    
    echo -e "${YELLOW}--- Model Performance Comparison ---${NC}"
    echo ""
    
    # Test 11B model
    switch_model "11b"
    sleep 2
    test_generation "11b"
    
    echo -e "${GREEN}✅ Test complete!${NC}"
}

# Main script logic
case "$1" in
    "3b")
        check_service && switch_model "3b" && test_generation "3b"
        ;;
    "11b")
        check_service && switch_model "11b" && test_generation "11b"
        ;;
    "test")
        check_service && run_test
        ;;
    "health")
        check_service && get_status
        ;;
    *)
        echo "Usage: $0 [3b|11b|test|health]"
        echo ""
        echo "Commands:"
        echo "  3b     - Switch to and test 3B model"
        echo "  11b    - Switch to and test 11B model"
        echo "  test   - Run comprehensive test of both models"
        echo "  health - Check service status and model availability"
        echo ""
        echo "Examples:"
        echo "  $0 health  # Check if service is running"
        echo "  $0 3b      # Use fast 3B model"
        echo "  $0 11b     # Use high-quality 11B model"
        echo "  $0 test    # Compare both models"
        ;;
esac 