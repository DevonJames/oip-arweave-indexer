# OIP Arweave Makefile
# Alternative interface for managing Docker deployments

.PHONY: help up down build logs status clean start-ngrok check-ngrok
.DEFAULT_GOAL := help

# Colors
GREEN := \033[0;32m
YELLOW := \033[1;33m
BLUE := \033[0;34m
RED := \033[0;31m
NC := \033[0m

help: ## Show this help message
	@echo "$(BLUE)OIP Arweave Deployment Management$(NC)"
	@echo ""
	@echo "$(YELLOW)Usage:$(NC) make [target] [PROFILE=profile_name]"
	@echo ""
	@echo "$(YELLOW)Available targets:$(NC)"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "$(YELLOW)Available profiles:$(NC)"
	@echo "  $(GREEN)minimal$(NC)              - Core only: elasticsearch, kibana, oip (no canvas - fastest build)"
	@echo "  $(GREEN)minimal-with-scrape$(NC)  - Core + scraping: elasticsearch, kibana, oip with canvas support"
	@echo "  $(GREEN)standard$(NC)             - Distributed: Full stack with Chatterbox TTS + AI chat (recommended)"
	@echo "  $(GREEN)standard-monolithic$(NC)  - Monolithic: Core services in one container (lacks modern AI features)"
	@echo "  $(GREEN)gpu$(NC)                  - GPU-optimized deployment with Chatterbox TTS"
	@echo "  $(GREEN)oip-gpu-only$(NC)         - Only GPU OIP service"
	@echo "  $(GREEN)standard-gpu$(NC)         - Complete stack: all services + GPU acceleration + Chatterbox TTS"
	@echo "  $(GREEN)chatterbox$(NC)           - Standard with Chatterbox TTS focus (CPU optimized)"
	@echo "  $(GREEN)chatterbox-gpu$(NC)       - Chatterbox TTS with GPU acceleration (RTX 4090 optimized)"
	@echo ""
	@echo "$(YELLOW)Examples:$(NC)"
	@echo "  make chatterbox-gpu            # Deploy Chatterbox TTS with GPU acceleration + ngrok"
	@echo "  make rebuild-standard          # Build complete stack with Chatterbox TTS + ngrok"
	@echo "  make ngrok-debug               # Debug ngrok setup (simple v3 command)"
	@echo "  make ngrok-test                # Test ngrok configuration (NGROK_AUTH_TOKEN setup)"
	@echo "  make install-models            # Install LLM models only (if already running)"
	@echo "  make install-chatterbox        # Install/update Chatterbox TTS model"
	@echo "  make status                    # Check service status"
	@echo "  make logs SERVICE=chatterbox-tts # View Chatterbox TTS logs"
	@echo ""
	@echo "$(YELLOW)ngrok Integration (Simplified v3 Command):$(NC)"
	@echo "  🌐 API available at: $(GREEN)https://api.oip.onl$(NC)"
	@echo "  🔧 Setup: Add NGROK_AUTH_TOKEN=your_token to .env file"
	@echo "  ⚡ Simple command: $(GREEN)ngrok http --domain=api.oip.onl 3005$(NC)"
	@echo "  💰 Requires: Paid ngrok plan for custom domain api.oip.onl"
	@echo "  🧪 Test setup: $(GREEN)make ngrok-test$(NC)"

# Default profile - now uses Chatterbox as primary TTS
PROFILE ?= standard

# Check if ngrok is available and configured
check-ngrok:
	@NGROK_FOUND=false; \
	if command -v ngrok >/dev/null 2>&1; then \
		NGROK_FOUND=true; \
	elif [ -f /usr/local/bin/ngrok ]; then \
		NGROK_FOUND=true; \
		NGROK_PATH="/usr/local/bin/ngrok"; \
	elif [ -f ~/bin/ngrok ]; then \
		NGROK_FOUND=true; \
		NGROK_PATH="~/bin/ngrok"; \
	elif [ -f ./ngrok ]; then \
		NGROK_FOUND=true; \
		NGROK_PATH="./ngrok"; \
	elif which ngrok >/dev/null 2>&1; then \
		NGROK_FOUND=true; \
	fi; \
	if [ "$$NGROK_FOUND" = "false" ]; then \
		echo "$(RED)❌ ngrok not found in PATH or common locations$(NC)"; \
		echo "$(YELLOW)Debug info:$(NC)"; \
		echo "  PATH: $$PATH"; \
		echo "  Checked locations: /usr/local/bin/ngrok, ~/bin/ngrok, ./ngrok"; \
		echo ""; \
		echo "$(YELLOW)To fix this:$(NC)"; \
		echo "$(BLUE)Option 1: Add ngrok to PATH$(NC)"; \
		echo "  Find ngrok: find / -name ngrok -type f 2>/dev/null | head -5"; \
		echo "  Then: export PATH=\$$PATH:/path/to/ngrok/directory"; \
		echo "$(BLUE)Option 2: Install ngrok$(NC)"; \
		echo "  # macOS: brew install ngrok"; \
		echo "  # Linux: snap install ngrok OR download from ngrok.com"; \
		echo ""; \
		echo "$(GREEN)Get your authtoken from: https://dashboard.ngrok.com/get-started/your-authtoken$(NC)"; \
		exit 1; \
	else \
		echo "$(GREEN)✅ ngrok found$(NC)"; \
		if command -v ngrok >/dev/null 2>&1; then \
			echo "$(BLUE)📍 ngrok version: $$(ngrok version 2>/dev/null || echo 'version check failed')$(NC)"; \
		fi; \
	fi
	@if [ -f .env ]; then \
		if ! grep -q "NGROK_AUTH_TOKEN=" .env || grep -q "NGROK_AUTH_TOKEN=$$" .env; then \
			echo "$(RED)❌ NGROK_AUTH_TOKEN not set in .env file$(NC)"; \
			echo "$(YELLOW)Please add: NGROK_AUTH_TOKEN=your_token_here$(NC)"; \
			echo "$(GREEN)Get your authtoken from: https://dashboard.ngrok.com/get-started/your-authtoken$(NC)"; \
			echo ""; \
			echo "$(BLUE)Then simply run: make start-ngrok$(NC)"; \
			echo "$(BLUE)Or manually: ngrok http --domain=api.oip.onl 3005$(NC)"; \
			exit 1; \
		fi; \
	else \
		echo "$(RED)❌ .env file not found$(NC)"; \
		echo "$(YELLOW)Please create .env file with NGROK_AUTH_TOKEN=your_token_here$(NC)"; \
		exit 1; \
	fi

# Start ngrok tunnel
start-ngrok: check-ngrok
	@echo "$(BLUE)🔗 Starting ngrok tunnel for api.oip.onl...$(NC)"
	@NGROK_CMD="ngrok"; \
	if ! command -v ngrok >/dev/null 2>&1; then \
		if [ -f /usr/local/bin/ngrok ]; then \
			NGROK_CMD="/usr/local/bin/ngrok"; \
		elif [ -f ~/bin/ngrok ]; then \
			NGROK_CMD="~/bin/ngrok"; \
		elif [ -f ./ngrok ]; then \
			NGROK_CMD="./ngrok"; \
		fi; \
	fi; \
	if [ -f .env ]; then \
		echo "$(BLUE)🔑 Loading auth token from .env...$(NC)"; \
		export $$(grep -v '^#' .env | grep NGROK_AUTH_TOKEN | xargs); \
		if [ -z "$$NGROK_AUTH_TOKEN" ]; then \
			echo "$(RED)❌ NGROK_AUTH_TOKEN is empty or not found in .env$(NC)"; \
			echo "$(YELLOW)💡 Add: NGROK_AUTH_TOKEN=your_token_here$(NC)"; \
			exit 1; \
		else \
			echo "$(GREEN)✅ Auth token loaded (length: $${#NGROK_AUTH_TOKEN} chars)$(NC)"; \
			$$NGROK_CMD config add-authtoken "$$NGROK_AUTH_TOKEN" > /dev/null 2>&1 || true; \
		fi; \
	fi; \
	echo "$(YELLOW)🚀 Starting: $$NGROK_CMD http --domain=api.oip.onl 3005$(NC)"; \
	($$NGROK_CMD http --domain=api.oip.onl 3005 > /tmp/ngrok.log 2>&1 &); \
	sleep 5; \
	if pgrep -f "ngrok http.*api.oip.onl" > /dev/null 2>&1; then \
		echo "$(GREEN)🔗 ngrok: ✅ Process running$(NC)"; \
		echo "$(BLUE)🔍 Checking tunnel status...$(NC)"; \
		sleep 2; \
		if curl -s --max-time 5 http://localhost:4040/api/tunnels | grep -q "api.oip.onl"; then \
			echo "$(GREEN)✅ Tunnel verified: https://api.oip.onl$(NC)"; \
		else \
			echo "$(RED)❌ Tunnel not ready. Checking logs...$(NC)"; \
			if [ -f /tmp/ngrok.log ]; then \
				echo "$(YELLOW)Last few lines of ngrok output:$(NC)"; \
				tail -5 /tmp/ngrok.log; \
			fi; \
		fi; \
	else \
		echo "$(RED)❌ ngrok process failed to start$(NC)"; \
		if [ -f /tmp/ngrok.log ]; then \
			echo "$(YELLOW)ngrok error output:$(NC)"; \
			cat /tmp/ngrok.log; \
		fi; \
		exit 1; \
	fi

# Stop ngrok  
stop-ngrok:
	@echo "$(BLUE)🛑 Stopping ALL ngrok processes...$(NC)"
	@ps aux | grep ngrok | grep -v grep | awk '{print $$2}' | while read pid; do \
		if [ -n "$$pid" ]; then \
			echo "$(YELLOW)Killing ngrok PID: $$pid$(NC)"; \
			kill -9 $$pid 2>/dev/null || true; \
		fi; \
	done; \
	sleep 2; \
	echo "$(GREEN)🔗 All ngrok processes stopped$(NC)"

# Validate profile
validate-profile:
	@case "$(PROFILE)" in \
		minimal|minimal-with-scrape|standard|standard-monolithic|gpu|oip-gpu-only|standard-gpu|chatterbox|chatterbox-gpu) ;; \
		*) echo "$(RED)Error: Invalid profile '$(PROFILE)'. Use: minimal, minimal-with-scrape, standard, standard-monolithic, gpu, oip-gpu-only, standard-gpu, chatterbox, or chatterbox-gpu$(NC)"; exit 1 ;; \
	esac

# Check if .env file exists
check-env:
	@if [ ! -f .env ]; then \
		echo "$(RED)Error: .env file not found$(NC)"; \
		echo "$(YELLOW)Please copy 'example env' to '.env' and configure it manually$(NC)"; \
		echo "$(YELLOW)Command: cp \"example env\" .env$(NC)"; \
		echo "$(RED)Build cancelled to protect your configuration$(NC)"; \
		exit 1; \
	else \
		echo "$(GREEN)Found .env file - using your configuration$(NC)"; \
	fi

# Check if Docker network exists
check-network:
	@if ! docker network inspect oiparweave_oip-network >/dev/null 2>&1; then \
		echo "$(BLUE)Creating network 'oiparweave_oip-network'...$(NC)"; \
		docker network create oiparweave_oip-network; \
	fi

# Check GPU requirements for GPU profiles
check-gpu:
	@if [ "$(PROFILE)" = "standard-gpu" ] || [ "$(PROFILE)" = "gpu" ] || [ "$(PROFILE)" = "oip-gpu-only" ] || [ "$(PROFILE)" = "chatterbox-gpu" ]; then \
		echo "$(BLUE)🔍 Checking GPU requirements for profile: $(PROFILE)$(NC)"; \
		if ! command -v nvidia-smi >/dev/null 2>&1; then \
			echo "$(RED)❌ NVIDIA drivers not found$(NC)"; \
			echo "$(YELLOW)📋 GPU Profile Requirements:$(NC)"; \
			echo "  1. Install NVIDIA drivers: sudo apt install nvidia-driver-535"; \
			echo "  2. Install nvidia-docker2: sudo apt install nvidia-docker2"; \
			echo "  3. Restart Docker: sudo systemctl restart docker"; \
			echo "  4. Test GPU access: docker run --rm --gpus all nvidia/cuda:11.7.1-runtime-ubuntu20.04 nvidia-smi"; \
			echo "$(BLUE)💡 Alternative: Use 'make $(subst -gpu,,$(PROFILE))' for CPU-only version$(NC)"; \
			exit 1; \
		fi; \
		if ! nvidia-smi >/dev/null 2>&1; then \
			echo "$(RED)❌ NVIDIA drivers not working$(NC)"; \
			echo "$(YELLOW)Try: sudo systemctl restart nvidia-persistenced && sudo modprobe nvidia$(NC)"; \
			exit 1; \
		fi; \
		if ! docker run --rm --gpus all nvidia/cuda:11.7.1-runtime-ubuntu20.04 nvidia-smi >/dev/null 2>&1; then \
			echo "$(RED)❌ Docker GPU access failed$(NC)"; \
			echo "$(YELLOW)Missing nvidia-docker2. Install with:$(NC)"; \
			echo "  distribution=\$$(. /etc/os-release;echo \$$ID\$$VERSION_ID)"; \
			echo "  curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -"; \
			echo "  curl -s -L https://nvidia.github.io/nvidia-docker/\$$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list"; \
			echo "  sudo apt-get update && sudo apt-get install -y nvidia-docker2"; \
			echo "  sudo systemctl restart docker"; \
			exit 1; \
		fi; \
		echo "$(GREEN)✅ GPU access verified$(NC)"; \
		echo "$(BLUE)🎮 GPU Info: $$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1)$(NC)"; \
	fi

up: validate-profile check-env check-gpu ## Start services with specified profile + ngrok
	@echo "$(BLUE)Starting OIP Arweave with profile: $(PROFILE)$(NC)"
	@if [ "$(PROFILE)" = "chatterbox" ] || [ "$(PROFILE)" = "chatterbox-gpu" ]; then \
		echo "$(YELLOW)🎭 Deploying with Chatterbox TTS as primary voice engine...$(NC)"; \
	fi
	docker-compose --profile $(PROFILE) up -d
	@echo "$(GREEN)Services started successfully$(NC)"
	@echo "$(BLUE)⏳ Waiting for OIP service to be ready...$(NC)"
	@./wait-for-it.sh localhost:3005 -t 60 || echo "$(YELLOW)OIP service may still be starting...$(NC)"
	@make start-ngrok
	@make status

up-no-makefile-ngrok: validate-profile check-env check-gpu ## Start services with specified profile (ngrok via Docker Compose)
	@echo "$(BLUE)Starting OIP Arweave with profile: $(PROFILE)$(NC)"
	@if [ "$(PROFILE)" = "chatterbox" ] || [ "$(PROFILE)" = "chatterbox-gpu" ]; then \
		echo "$(YELLOW)🎭 Deploying with Chatterbox TTS as primary voice engine...$(NC)"; \
	fi
	docker-compose --profile $(PROFILE) up -d
	@echo "$(GREEN)Services started successfully$(NC)"
	@echo "$(BLUE)⏳ Waiting for OIP service to be ready...$(NC)"
	@./wait-for-it.sh localhost:3005 -t 60 || echo "$(YELLOW)OIP service may still be starting...$(NC)"
	@echo "$(BLUE)ngrok tunnel will be managed by Docker Compose using NGROK_DOMAIN from .env$(NC)"
	@make status

build: validate-profile check-env check-gpu ## Build and start services with specified profile + ngrok
	@echo "$(BLUE)Building and starting OIP Arweave with profile: $(PROFILE)$(NC)"
	@if [ "$(PROFILE)" = "chatterbox" ] || [ "$(PROFILE)" = "chatterbox-gpu" ]; then \
		echo "$(YELLOW)🎭 Building with Chatterbox TTS integration...$(NC)"; \
	fi
	docker-compose --profile $(PROFILE) up -d --build
	@echo "$(GREEN)Services built and started successfully$(NC)"
	@echo "$(BLUE)⏳ Waiting for OIP service to be ready...$(NC)"
	@./wait-for-it.sh localhost:3005 -t 60 || echo "$(YELLOW)OIP service may still be starting...$(NC)"
	@make start-ngrok
	@make status

rebuild: validate-profile check-env check-gpu ## Rebuild and start services with --no-cache and specified profile + ngrok
	@echo "$(BLUE)Rebuilding OIP Arweave with --no-cache and profile: $(PROFILE)$(NC)"
	@if [ "$(PROFILE)" = "chatterbox" ] || [ "$(PROFILE)" = "chatterbox-gpu" ]; then \
		echo "$(YELLOW)🎭 Rebuilding with Chatterbox TTS from scratch...$(NC)"; \
	fi
	docker-compose --profile $(PROFILE) build --no-cache
	docker-compose --profile $(PROFILE) up -d
	@echo "$(GREEN)Services rebuilt and started successfully$(NC)"
	@echo "$(BLUE)⏳ Waiting for OIP service to be ready...$(NC)"
	@./wait-for-it.sh localhost:3005 -t 60 || echo "$(YELLOW)OIP service may still be starting...$(NC)"
	@make start-ngrok
	@make status

down: ## Stop all services + ngrok
	@echo "$(BLUE)Stopping all OIP Arweave services...$(NC)"
	docker-compose down
	@make stop-ngrok
	@echo "$(GREEN)All services stopped$(NC)"

restart: validate-profile ## Restart services with specified profile + ngrok
	@echo "$(BLUE)Restarting services with profile: $(PROFILE)$(NC)"
	@make down
	@make up PROFILE=$(PROFILE)

logs: ## Show logs for all services or specific service (use SERVICE=name)
ifdef SERVICE
	@echo "$(BLUE)Showing logs for service: $(SERVICE)$(NC)"
	docker-compose logs -f $(SERVICE)
else
	@echo "$(BLUE)Showing logs for all services$(NC)"
	docker-compose logs -f
endif

status: ## Show service status + ngrok status
	@echo "$(BLUE)Service Status:$(NC)"
	@docker-compose ps || echo "No services running"
	@echo ""
	@echo "$(BLUE)ngrok Status:$(NC)"
	@if pgrep -f "ngrok http.*api.oip.onl" > /dev/null 2>&1; then \
		echo "$(GREEN)🔗 ngrok: ✅ Running$(NC)"; \
		echo "$(GREEN)🌐 API: https://api.oip.onl$(NC)"; \
		if command -v curl >/dev/null 2>&1; then \
			echo "$(BLUE)Checking tunnel connectivity...$(NC)"; \
			if curl -s --max-time 3 http://localhost:4040/api/tunnels | grep -q "api.oip.onl"; then \
				echo "$(GREEN)✅ Tunnel verified: https://api.oip.onl$(NC)"; \
			else \
				echo "$(YELLOW)⚠️  Tunnel may not be fully ready$(NC)"; \
			fi; \
		fi; \
	else \
		echo "$(RED)❌ ngrok: Not running$(NC)"; \
	fi
	@echo ""
	@echo "$(BLUE)Networks:$(NC)"
	@docker network ls | grep oip || echo "No OIP networks found"

clean: ## Stop services and remove containers, networks, volumes + stop ngrok
	@echo "$(YELLOW)Warning: This will remove all containers, networks, and volumes$(NC)"
	@echo "$(YELLOW)Press Ctrl+C to cancel, or wait 5 seconds to continue...$(NC)"
	@sleep 5
	docker-compose down -v --remove-orphans
	@make stop-ngrok
	@echo "$(GREEN)Cleanup completed$(NC)"

clean-orphans: ## Remove orphaned containers (like old ngrok containers)
	@echo "$(BLUE)🧹 Removing orphaned containers...$(NC)"
	docker-compose down --remove-orphans
	@echo "$(GREEN)✅ Orphaned containers removed$(NC)"

# Quick deployment targets for common scenarios
minimal: ## Quick deploy: Core services only (elasticsearch, kibana, oip - no canvas) + Docker Compose ngrok
	@make up-no-makefile-ngrok PROFILE=minimal

minimal-with-scrape: ## Quick deploy: Core services + scraping (elasticsearch, kibana, oip + canvas) + ngrok
	@make up PROFILE=minimal-with-scrape

standard: ## Quick deploy: Distributed full stack with Chatterbox TTS (recommended) + ngrok
	@make up PROFILE=standard
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

standard-monolithic: ## Quick deploy: Monolithic (all services in one container + separate AI services) + ngrok
	@make up PROFILE=standard-monolithic
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

gpu: ## Quick deploy: GPU-optimized deployment with Chatterbox TTS + ngrok
	@make up PROFILE=gpu
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

oip-gpu-only: ## Quick deploy: GPU OIP service only + ngrok
	@make up PROFILE=oip-gpu-only

standard-gpu: ## Quick deploy: Complete stack with GPU acceleration + Chatterbox TTS + install models + ngrok
	@make up PROFILE=standard-gpu
	@echo "$(YELLOW)🤖 Installing LLM models automatically...$(NC)"
	@make install-models
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

chatterbox: ## Quick deploy: Standard deployment with Chatterbox TTS focus (CPU) + ngrok
	@make up PROFILE=chatterbox
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

chatterbox-gpu: ## Quick deploy: Chatterbox TTS with GPU acceleration (RTX 4090 optimized) + ngrok
	@make up PROFILE=chatterbox-gpu
	@echo "$(YELLOW)🎭 Installing GPU-optimized Chatterbox TTS model...$(NC)"
	@make install-chatterbox

# Quick rebuild targets for common scenarios
rebuild-minimal: ## Quick rebuild: Core services only (elasticsearch, kibana, oip - no canvas) + ngrok
	@make rebuild PROFILE=minimal

rebuild-minimal-with-scrape: ## Quick rebuild: Core services + scraping (elasticsearch, kibana, oip + canvas) + ngrok
	@make rebuild PROFILE=minimal-with-scrape

rebuild-standard: ## Quick rebuild: Distributed full stack with Chatterbox TTS + ngrok
	@make rebuild PROFILE=standard
	@echo "$(YELLOW)⏳ Waiting for TTS service to be ready...$(NC)"
	@timeout 60 bash -c 'until docker ps | grep -E "tts-service.*Up|oip-arweave-indexer-tts-service.*Up" | grep -q Up; do echo "Waiting for TTS service..."; sleep 2; done' || echo "$(YELLOW)⚠️ TTS service didn't start in time, trying anyway...$(NC)"
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-standard-monolithic: ## Quick rebuild: Monolithic (all services in one container + separate AI services) + ngrok
	@make rebuild PROFILE=standard-monolithic
	@echo "$(YELLOW)⏳ Waiting for TTS service to be ready...$(NC)"
	@timeout 60 bash -c 'until docker ps | grep -E "tts-service.*Up|oip-full.*Up|oip-arweave-indexer-tts-service.*Up|oip-arweave-indexer-oip-full.*Up" | grep -q Up; do echo "Waiting for TTS service..."; sleep 2; done' || echo "$(YELLOW)⚠️ TTS service didn't start in time, trying anyway...$(NC)"
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-gpu: ## Quick rebuild: GPU-optimized deployment with Chatterbox TTS + ngrok
	@make rebuild PROFILE=gpu
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-oip-gpu-only: ## Quick rebuild: GPU OIP service only + ngrok
	@make rebuild PROFILE=oip-gpu-only

rebuild-standard-gpu: ## Quick rebuild: Complete stack with GPU acceleration + install models + ngrok (Chatterbox installed during Docker build)
	@make rebuild PROFILE=standard-gpu
	@echo "$(YELLOW)⏳ Waiting for GPU services to be ready...$(NC)"
	@timeout 60 bash -c 'until docker ps | grep -q -E "ollama-gpu.*(Up|Running)"; do echo "Waiting for Ollama GPU service..."; sleep 2; done' || echo "$(YELLOW)⚠️ Ollama GPU service didn't start in time, trying anyway...$(NC)"
	@timeout 60 bash -c 'until docker ps | grep -q -E "tts-service-gpu.*(Up|Running)"; do echo "Waiting for TTS GPU service..."; sleep 2; done' || echo "$(YELLOW)⚠️ TTS GPU service didn't start in time, trying anyway...$(NC)"
	@echo "$(YELLOW)⏳ Waiting for Ollama API to be ready...$(NC)"
	@timeout 60 bash -c 'until curl -s http://localhost:11434/api/tags >/dev/null; do echo "Waiting for Ollama API..."; sleep 3; done' || echo "$(YELLOW)⚠️ Ollama API didn't respond in time, trying anyway...$(NC)"
	@echo "$(YELLOW)🤖 Installing LLM models automatically...$(NC)"
	@make install-models
	@echo "$(GREEN)🎭 Chatterbox TTS installed during Docker build - GPU profile ready!$(NC)"

rebuild-chatterbox: ## Quick rebuild: Standard deployment with Chatterbox TTS focus (CPU) + ngrok
	@make rebuild PROFILE=chatterbox
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-chatterbox-gpu: ## Quick rebuild: Chatterbox TTS with GPU acceleration (RTX 4090 optimized) + ngrok
	@make rebuild PROFILE=chatterbox-gpu
	@echo "$(YELLOW)🎭 Installing GPU-optimized Chatterbox TTS model...$(NC)"

rebuild-tts: ## Rebuild only the TTS service (no cache) - fast fix for TTS issues
	@echo "$(BLUE)🔧 Rebuilding TTS service only...$(NC)"
	docker-compose build --no-cache tts-service
	@echo "$(GREEN)✅ TTS service rebuilt$(NC)"
	@echo "$(BLUE)🚀 Starting TTS service...$(NC)"
	docker-compose up -d tts-service
	@echo "$(GREEN)✅ TTS service started$(NC)"
	@echo "$(BLUE)🔍 Checking TTS service logs...$(NC)"
	@sleep 5
	docker logs oip-arweave-indexer-tts-service-1 --tail 15 || echo "$(YELLOW)⚠️ Check container name with 'docker ps'$(NC)"

# LLM Model Management
install-models: ## Install LLM models using Ollama
	@echo "$(BLUE)Installing LLM models for AI Chat...$(NC)"
	@chmod +x ./install_llm_models.sh
	@./install_llm_models.sh

# Chatterbox TTS Model Management  
install-chatterbox: ## Install/update Chatterbox TTS model (Resemble AI) in TTS service  
	@echo "$(BLUE)🎭 Installing Chatterbox TTS from Resemble AI...$(NC)"
	@CONTAINER_FOUND=false; \
	for i in {1..10}; do \
		if docker ps | grep -E "tts-service.*(Up|Running)|tts-service-gpu.*(Up|Running)|oip-arweave-indexer-tts-service.*(Up|Running)|oip-arweave-indexer-tts-service-gpu.*(Up|Running)"; then \
			CONTAINER_FOUND=true; \
			break; \
		fi; \
		echo "$(YELLOW)⏳ Waiting for TTS service container (attempt $$i/10)...$(NC)"; \
		sleep 2; \
	done; \
	if [ "$$CONTAINER_FOUND" = "true" ]; then \
		echo "$(YELLOW)📦 Installing Chatterbox in TTS service container (where voice synthesis happens)...$(NC)"; \
		echo "$(BLUE)⏳ This may take a few moments to download and initialize the model...$(NC)"; \
		CONTAINER_NAME=$$(docker ps --format "{{.Names}}" | grep -E "tts-service" | head -1); \
		echo "$(BLUE)🔧 Using container: $$CONTAINER_NAME$(NC)"; \
		PYTHON_CMD="python3"; \
		docker exec $$CONTAINER_NAME which python3 >/dev/null 2>&1 || PYTHON_CMD="python"; \
		PIP_CMD="pip3"; \
		docker exec $$CONTAINER_NAME which pip3 >/dev/null 2>&1 || PIP_CMD="pip"; \
		if docker exec $$CONTAINER_NAME $$PIP_CMD list | grep -q chatterbox-tts; then \
			echo "$(GREEN)📋 Chatterbox TTS already available, skipping installation$(NC)"; \
		else \
			echo "$(BLUE)📥 Installing Chatterbox package...$(NC)"; \
			docker exec $$CONTAINER_NAME $$PIP_CMD install --no-cache-dir chatterbox-tts soundfile || echo "$(YELLOW)⚠️ Package installation had issues, trying anyway...$(NC)"; \
		fi; \
		docker exec $$CONTAINER_NAME $$PYTHON_CMD -c "print('🚀 Initializing Chatterbox TTS...'); from chatterbox.tts import ChatterboxTTS; import torch; device='cuda' if torch.cuda.is_available() else 'cpu'; print(f'🖥️  Using device: {device}'); model = ChatterboxTTS.from_pretrained(device=device); print('✅ Chatterbox TTS (Resemble AI) ready! High-quality neural voice available.'); print('🎉 Voice assistant will now use Chatterbox instead of robotic fallback!')" || \
		echo "$(YELLOW)⚠️  Chatterbox installation failed - will use fallback engines (Edge TTS, gTTS, eSpeak)$(NC)"; \
	else \
		echo "$(RED)❌ TTS service container not running$(NC)"; \
		echo "$(YELLOW)💡 Run 'make standard' first to start the TTS service$(NC)"; \
	fi

test-chatterbox: ## Test Chatterbox TTS functionality
	@echo "$(BLUE)Testing Chatterbox TTS...$(NC)"
	@TEST_FOUND=false; \
	if docker-compose ps | grep -q chatterbox-tts; then \
		echo "$(YELLOW)Running Chatterbox test in dedicated chatterbox-tts container...$(NC)"; \
		docker-compose exec chatterbox-tts python -c "import torch; from chatterbox.tts import ChatterboxTTS; import torchaudio as ta; model = ChatterboxTTS.from_pretrained(device='cuda' if torch.cuda.is_available() else 'cpu'); wav = model.generate('Hello, this is Chatterbox TTS with emotion control!', exaggeration=0.7, cfg_weight=0.4); ta.save('/tmp/test_chatterbox.wav', wav, model.sr); print('✅ Chatterbox test completed! Audio saved to /tmp/test_chatterbox.wav')"; \
		TEST_FOUND=true; \
	elif docker-compose ps | grep -q tts-service; then \
		echo "$(YELLOW)Running Chatterbox test in tts-service container...$(NC)"; \
		docker-compose exec tts-service python -c "import torch; from chatterbox.tts import ChatterboxTTS; import torchaudio as ta; model = ChatterboxTTS.from_pretrained(device='cuda' if torch.cuda.is_available() else 'cpu'); wav = model.generate('Hello, this is Chatterbox TTS with emotion control!', exaggeration=0.7, cfg_weight=0.4); ta.save('/tmp/test_chatterbox.wav', wav, model.sr); print('✅ Chatterbox test completed! Audio saved to /tmp/test_chatterbox.wav')"; \
		TEST_FOUND=true; \
	elif docker-compose ps | grep -q oip; then \
		echo "$(YELLOW)Running Chatterbox test in main OIP container...$(NC)"; \
		docker-compose exec oip python -c "import torch; from chatterbox.tts import ChatterboxTTS; import torchaudio as ta; model = ChatterboxTTS.from_pretrained(device='cuda' if torch.cuda.is_available() else 'cpu'); wav = model.generate('Hello, this is Chatterbox TTS with emotion control! Testing from standard profile.', exaggeration=0.7, cfg_weight=0.4); ta.save('/tmp/test_chatterbox.wav', wav, model.sr); print('✅ Chatterbox test completed! Audio saved to /tmp/test_chatterbox.wav')"; \
		TEST_FOUND=true; \
	elif docker-compose ps | grep -q oip-gpu; then \
		echo "$(YELLOW)Running Chatterbox test in GPU OIP container...$(NC)"; \
		docker-compose exec oip-gpu python -c "import torch; from chatterbox.tts import ChatterboxTTS; import torchaudio as ta; model = ChatterboxTTS.from_pretrained(device='cuda' if torch.cuda.is_available() else 'cpu'); wav = model.generate('Hello, this is Chatterbox TTS with GPU acceleration!', exaggeration=0.7, cfg_weight=0.4); ta.save('/tmp/test_chatterbox.wav', wav, model.sr); print('✅ Chatterbox test completed! Audio saved to /tmp/test_chatterbox.wav')"; \
		TEST_FOUND=true; \
	fi; \
	if [ "$$TEST_FOUND" = "false" ]; then \
		echo "$(RED)No suitable container found for Chatterbox TTS testing.$(NC)"; \
		echo "$(YELLOW)Please start services first and install Chatterbox with 'make install-chatterbox'$(NC)"; \
	fi

# ngrok Management
ngrok-status: ## Check ngrok tunnel status
	@echo "$(BLUE)ngrok Tunnel Status:$(NC)"
	@if pgrep -f "ngrok http.*api.oip.onl" > /dev/null 2>&1; then \
		echo "$(GREEN)🔗 ngrok: ✅ Running$(NC)"; \
		echo "$(GREEN)🌐 API: https://api.oip.onl$(NC)"; \
		if command -v curl >/dev/null 2>&1; then \
			echo "$(BLUE)Active tunnels:$(NC)"; \
			curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | "  \(.public_url) -> \(.config.addr)"' 2>/dev/null || echo "  Check http://localhost:4040 for tunnel details"; \
		fi; \
	else \
		echo "$(RED)❌ ngrok: Not running$(NC)"; \
		echo "$(YELLOW)Start with: make start-ngrok$(NC)"; \
	fi

ngrok-start: start-ngrok ## Start ngrok tunnel only

ngrok-stop: stop-ngrok ## Stop ngrok tunnel only

ngrok-restart: ## Restart ngrok tunnel
	@make stop-ngrok
	@make start-ngrok

ngrok-find: ## Find ngrok installation on your system
	@echo "$(BLUE)🔍 Searching for ngrok installation...$(NC)"
	@echo "$(YELLOW)Checking PATH:$(NC)"
	@if command -v ngrok >/dev/null 2>&1; then \
		echo "  ✅ Found in PATH: $$(which ngrok)"; \
		echo "  📍 Version: $$(ngrok version 2>/dev/null)"; \
	else \
		echo "  ❌ Not in PATH"; \
	fi
	@echo "$(YELLOW)Checking common locations:$(NC)"
	@for path in /usr/local/bin/ngrok ~/bin/ngrok ./ngrok /usr/bin/ngrok /opt/ngrok/ngrok ~/.local/bin/ngrok; do \
		if [ -f "$$path" ]; then \
			echo "  ✅ Found: $$path"; \
			echo "    Version: $$($$path version 2>/dev/null || echo 'version check failed')"; \
		fi; \
	done
	@echo "$(YELLOW)Searching entire system (this may take a moment):$(NC)"
	@find / -name ngrok -type f -executable 2>/dev/null | head -10 | while read path; do \
		echo "  🔍 Found: $$path"; \
	done || echo "  Search completed"
	@echo ""
	@echo "$(BLUE)💡 To fix PATH issues:$(NC)"
	@echo "  1. Find ngrok location from above"
	@echo "  2. Add to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
	@echo "     export PATH=\$$PATH:/path/to/ngrok/directory"
	@echo "  3. Reload: source ~/.bashrc (or restart terminal)"

ngrok-debug: ## Debug ngrok setup (simple v3 command)
	@echo "$(BLUE)🔧 Debugging ngrok setup...$(NC)"
	@echo "$(YELLOW)Environment token check:$(NC)"
	@if [ -f .env ]; then \
		if grep -q "NGROK_AUTH_TOKEN=" .env; then \
			TOKEN_LENGTH=$$(grep "NGROK_AUTH_TOKEN=" .env | cut -d'=' -f2 | wc -c); \
			echo "  ✅ Token found in .env (length: $$TOKEN_LENGTH chars)"; \
		else \
			echo "  ❌ NGROK_AUTH_TOKEN not found in .env"; \
		fi; \
	else \
		echo "  ❌ .env file not found"; \
	fi
	@echo "$(YELLOW)Simple command test:$(NC)"
	@echo "  📋 Full command: $(GREEN)ngrok http --domain=api.oip.onl 3005$(NC)"
	@echo "  🎯 This requires your paid plan with custom domain access"
	@echo "  💡 No config files needed with ngrok v3!"

ngrok-test: ## Test ngrok configuration and environment setup
	@echo "$(BLUE)Testing ngrok configuration...$(NC)"
	@echo "$(YELLOW)Checking ngrok installation:$(NC)"
	@NGROK_CMD=""; \
	if command -v ngrok >/dev/null 2>&1; then \
		NGROK_CMD="ngrok"; \
	elif [ -f /usr/local/bin/ngrok ]; then \
		NGROK_CMD="/usr/local/bin/ngrok"; \
	elif [ -f ~/bin/ngrok ]; then \
		NGROK_CMD="~/bin/ngrok"; \
	elif [ -f ./ngrok ]; then \
		NGROK_CMD="./ngrok"; \
	elif which ngrok >/dev/null 2>&1; then \
		NGROK_CMD="ngrok"; \
	fi; \
	if [ -n "$$NGROK_CMD" ]; then \
		echo "  ✅ ngrok found at: $$NGROK_CMD"; \
		echo "  📍 Version: $$($$NGROK_CMD version 2>/dev/null || echo 'version check failed')"; \
	else \
		echo "  ❌ ngrok not found in PATH or common locations"; \
		echo "  🔍 Try: find / -name ngrok -type f 2>/dev/null | head -5"; \
		exit 1; \
	fi
	@echo "$(YELLOW)Checking config file:$(NC)"
	@if [ -f ngrok/ngrok.yml ]; then \
		echo "  ✅ Found ngrok/ngrok.yml"; \
		if grep -q "authtoken_from_env.*true" ngrok/ngrok.yml; then \
			echo "  ✅ Using environment variable for auth token"; \
		else \
			echo "  ⚠️  Not using environment variable for auth token"; \
		fi; \
	elif [ -f ~/.ngrok.yml ]; then \
		echo "  ✅ Found ~/.ngrok.yml"; \
	else \
		echo "  ❌ No ngrok config file found"; \
		exit 1; \
	fi
	@echo "$(YELLOW)Checking .env file:$(NC)"
	@if [ -f .env ]; then \
		if grep -q "NGROK_AUTH_TOKEN=" .env; then \
			if grep -q "NGROK_AUTH_TOKEN=$$" .env; then \
				echo "  ❌ NGROK_AUTH_TOKEN is empty in .env"; \
				exit 1; \
			else \
				echo "  ✅ NGROK_AUTH_TOKEN is set in .env"; \
			fi; \
		else \
			echo "  ❌ NGROK_AUTH_TOKEN not found in .env"; \
			exit 1; \
		fi; \
	else \
		echo "  ❌ .env file not found"; \
		exit 1; \
	fi
	@echo "$(GREEN)✅ ngrok configuration looks good!$(NC)"
	@echo "$(BLUE)You can now run: make start-ngrok$(NC)"

# Development helpers
dev-build: ## Development: Build without cache
	docker-compose build --no-cache

dev-shell: ## Development: Shell into OIP container
	@if docker-compose ps | grep -q oip; then \
		docker-compose exec oip /bin/bash; \
	elif docker-compose ps | grep -q oip-gpu; then \
		docker-compose exec oip-gpu /bin/bash; \
	else \
		echo "$(RED)No OIP container is running$(NC)"; \
	fi

dev-shell-chatterbox: ## Development: Shell into container with Chatterbox TTS
	@SHELL_FOUND=false; \
	if docker-compose ps | grep -q chatterbox-tts; then \
		echo "$(BLUE)Entering dedicated chatterbox-tts container...$(NC)"; \
		docker-compose exec chatterbox-tts /bin/bash; \
		SHELL_FOUND=true; \
	elif docker-compose ps | grep -q tts-service; then \
		echo "$(BLUE)Entering tts-service container...$(NC)"; \
		docker-compose exec tts-service /bin/bash; \
		SHELL_FOUND=true; \
	elif docker-compose ps | grep -q oip-gpu; then \
		echo "$(BLUE)Entering GPU OIP container (with Chatterbox support)...$(NC)"; \
		docker-compose exec oip-gpu /bin/bash; \
		SHELL_FOUND=true; \
	elif docker-compose ps | grep -q oip; then \
		echo "$(BLUE)Entering main OIP container (with Chatterbox support)...$(NC)"; \
		docker-compose exec oip /bin/bash; \
		SHELL_FOUND=true; \
	fi; \
	if [ "$$SHELL_FOUND" = "false" ]; then \
		echo "$(RED)No container with Chatterbox TTS support is running$(NC)"; \
		echo "$(YELLOW)Available containers:$(NC)"; \
		docker-compose ps --services --filter status=running | head -10; \
	fi

dev-logs-oip: ## Development: Show only OIP logs
	@if docker-compose ps | grep -q oip-gpu; then \
		docker-compose logs -f oip-gpu; \
	else \
		docker-compose logs -f oip; \
	fi

dev-logs-chatterbox: ## Development: Show logs for container with Chatterbox TTS
	@LOGS_FOUND=false; \
	if docker-compose ps | grep -q chatterbox-tts; then \
		echo "$(BLUE)Showing logs for dedicated chatterbox-tts container...$(NC)"; \
		docker-compose logs -f chatterbox-tts; \
		LOGS_FOUND=true; \
	elif docker-compose ps | grep -q tts-service; then \
		echo "$(BLUE)Showing logs for tts-service container...$(NC)"; \
		docker-compose logs -f tts-service; \
		LOGS_FOUND=true; \
	elif docker-compose ps | grep -q oip-gpu; then \
		echo "$(BLUE)Showing logs for GPU OIP container (with Chatterbox support)...$(NC)"; \
		docker-compose logs -f oip-gpu; \
		LOGS_FOUND=true; \
	elif docker-compose ps | grep -q oip; then \
		echo "$(BLUE)Showing logs for main OIP container (with Chatterbox support)...$(NC)"; \
		docker-compose logs -f oip; \
		LOGS_FOUND=true; \
	fi; \
	if [ "$$LOGS_FOUND" = "false" ]; then \
		echo "$(RED)No container with Chatterbox TTS support is running$(NC)"; \
		echo "$(YELLOW)Available containers:$(NC)"; \
		docker-compose ps --services --filter status=running | head -10; \
	fi 