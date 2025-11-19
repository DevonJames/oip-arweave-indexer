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
	@echo "$(YELLOW)Memory Configuration (for 128GB+ systems):$(NC)"
	@echo "  $(GREEN)set-memory-8gb$(NC)       - Set Node.js heap to 8GB"
	@echo "  $(GREEN)set-memory-16gb$(NC)      - Set Node.js heap to 16GB (recommended)"
	@echo "  $(GREEN)set-memory-32gb$(NC)      - Set Node.js heap to 32GB"
	@echo "  $(GREEN)set-memory-64gb$(NC)      - Set Node.js heap to 64GB (high-volume)"
	@echo "  $(GREEN)check-memory-config$(NC)  - Show current memory configuration"
	@echo ""
	@echo "$(YELLOW)Available targets:$(NC)"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "$(YELLOW)Available profiles:$(NC)"
	@echo "  $(GREEN)minimal$(NC)              - Core only: elasticsearch, kibana, oip (no canvas - fastest build)"
	@echo "  $(GREEN)minimal-with-scrape$(NC)  - Core + scraping: elasticsearch, kibana, oip with canvas support"
	@echo "  $(GREEN)standard$(NC)             - Distributed: Full stack with Chatterbox TTS + AI chat (uses arweave.net)"
	@echo "  $(GREEN)standard-macMseries$(NC)  - Distributed: Full stack optimized for Apple Silicon Macs (CPU-based AI)"
	@echo "  $(GREEN)standard-monolithic$(NC)  - Monolithic: Core services in one container (lacks modern AI features)"
	@echo "  $(GREEN)standard-gpu$(NC)         - Complete stack: all services + GPU acceleration (uses arweave.net)"
	@echo "  $(GREEN)max-decentralized$(NC)    - Full decentralized: includes local AR.IO gateway (CPU)"
	@echo "  $(GREEN)max-decentralized-gpu$(NC) - Full decentralized: includes local AR.IO gateway (GPU)"
	@echo "  $(GREEN)gpu$(NC)                  - GPU-optimized deployment with Chatterbox TTS"
	@echo "  $(GREEN)oip-gpu-only$(NC)         - Only GPU OIP service"
	@echo "  $(GREEN)chatterbox$(NC)           - Standard with Chatterbox TTS focus (CPU optimized)"
	@echo "  $(GREEN)chatterbox-gpu$(NC)       - Chatterbox TTS with GPU acceleration (RTX 4090 optimized)"
	@echo "  $(GREEN)backend-only$(NC)         - Distributed: Backend services only for Mac/iOS clients"
	@echo ""
	@echo "$(YELLOW)Examples:$(NC)"
	@echo "  make backend-only              # Deploy backend for Mac/iOS clients + ngrok"
	@echo "  make chatterbox-gpu            # Deploy Chatterbox TTS with GPU acceleration + ngrok"
	@echo "  make rebuild-standard          # Build complete stack with Chatterbox TTS + ngrok"
	@echo "  make ngrok-debug               # Debug ngrok setup (simple v3 command)"
	@echo "  make ngrok-test                # Test ngrok configuration (NGROK_AUTH_TOKEN setup)"
	@echo "  make install-models            # Install LLM models only (if already running)"
	@echo "  make install-chatterbox        # Install/update Chatterbox TTS model"
	@echo "  make status                    # Check service status"
	@echo "  make logs SERVICE=chatterbox-tts # View Chatterbox TTS logs"
	@echo ""
	@echo "$(YELLOW)Multi-Deployment Pattern:$(NC)"
	@echo "  📁 Structure: ProjectName/oip-arweave-indexer/ + ProjectName/public/"
	@echo "  ⚙️  Set CUSTOM_PUBLIC_PATH=true in .env to use parent directory's public/ folder"
	@echo "  🎯 Perfect for multiple frontends sharing the same OIP backend infrastructure"
	@echo "  🚀 Frontend dev: ./scripts/dev-frontend.sh [port] [path]"
	@echo ""
	@echo "$(YELLOW)Mac Client Services:$(NC)"
	@echo "  make mac-stt-services          # Start all Mac STT services with logging"
	@echo "  make mac-stop                  # Stop all Mac STT services"
	@echo "  make mac-status                # Check Mac STT services status"
	@echo "  make mac-logs-stt              # Monitor STT service logs"
	@echo "  make mac-logs-smart-turn       # Monitor Smart Turn service logs"
	@echo "  make mac-logs-interface        # Monitor Interface server logs"
	@echo "  make mac-logs-all              # Monitor all Mac service logs"
	@echo ""
	@echo "$(YELLOW)Elasticsearch Storage Management:$(NC)"
	@echo "  make check-es-storage          # Check Elasticsearch storage location and disk space"
	@echo "  make migrate-elasticsearch-data # Migrate from Docker volume to host bind mount"
	@echo "  make clean-old-es-volume       # Remove old Docker volume after migration"
	@echo ""
	@echo "$(YELLOW)AR.IO Gateway Storage Management:$(NC)"
	@echo "  make check-ario-storage        # Check AR.IO gateway storage location and disk space"
	@echo "  make check-ario-env            # Check AR.IO gateway environment variables"
	@echo "  make reset-ario-gateway        # Reset gateway to start from configured block height (deletes data)"
	@echo ""
	@echo "$(YELLOW)GUN Records Backup & Restore:$(NC)"
	@echo "  make backup-gun-records        # Backup all GUN records from Elasticsearch to JSON file"
	@echo "  make restore-gun-records FILE=backup.json  # Restore GUN records from backup file"
	@echo ""
	@echo "$(YELLOW)ngrok Integration (Simplified v3 Command):$(NC)"
	@echo "  🌐 API available at: $(GREEN)https://api.oip.onl$(NC)"
	@echo "  🔧 Setup: Add NGROK_AUTH_TOKEN=your_token to .env file"
	@echo "  ⚡ Simple command: $(GREEN)ngrok http --domain=api.oip.onl $${PORT:-3005}$(NC)"
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
			echo "$(BLUE)Or manually: ngrok http --domain=api.oip.onl $${PORT:-3005}$(NC)"; \
			exit 1; \
		fi; \
	else \
		echo "$(RED)❌ .env file not found$(NC)"; \
		echo "$(YELLOW)Please create .env file with NGROK_AUTH_TOKEN=your_token_here$(NC)"; \
		exit 1; \
	fi

# Start ngrok tunnel
start-ngrok: check-ngrok
	@NGROK_CMD="ngrok"; \
	if ! command -v ngrok >/dev/null 2>&1; then \
		if [ -f /usr/local/bin/ngrok ]; then NGROK_CMD="/usr/local/bin/ngrok"; \
		elif [ -f ~/bin/ngrok ]; then NGROK_CMD="~/bin/ngrok"; \
		elif [ -f ./ngrok ]; then NGROK_CMD="./ngrok"; \
		fi; \
	fi; \
	DOMAIN=""; \
	if [ -f .env ]; then \
		echo "$(BLUE)🔑 Loading auth token and domain from .env...$(NC)"; \
		export $$(grep -v '^#' .env | grep -E "^(NGROK_AUTH_TOKEN|NGROK_DOMAIN|PORT)=" | xargs); \
		DOMAIN="$$NGROK_DOMAIN"; \
		if [ -z "$$NGROK_AUTH_TOKEN" ]; then \
			echo "$(RED)❌ NGROK_AUTH_TOKEN is empty or not found in .env$(NC)"; \
			echo "$(YELLOW)💡 Add: NGROK_AUTH_TOKEN=your_token_here$(NC)"; \
			exit 1; \
		else \
			echo "$(GREEN)✅ Auth token loaded (length: $${#NGROK_AUTH_TOKEN} chars)$(NC)"; \
			"$$NGROK_CMD" config add-authtoken "$$NGROK_AUTH_TOKEN" > /dev/null 2>&1 || true; \
		fi; \
	fi; \
	if [ -z "$$DOMAIN" ]; then DOMAIN="api.oip.onl"; fi; \
	echo "$(BLUE)🔗 Starting ngrok tunnel for $$DOMAIN...$(NC)"; \
	echo "$(YELLOW)🚀 Starting: $$NGROK_CMD http --domain=$$DOMAIN $${PORT:-3005}$(NC)"; \
	"$$NGROK_CMD" http --domain="$$DOMAIN" "$${PORT:-3005}" > /tmp/ngrok.log 2>&1 & \
	sleep 5; \
	if curl -s --max-time 5 http://localhost:4040/api/tunnels | grep -q "$$DOMAIN"; then \
		echo "$(GREEN)✅ Tunnel verified: https://$$DOMAIN$(NC)"; \
	else \
		echo "$(YELLOW)⚠️  Tunnel may not be fully ready yet$(NC)"; \
		if [ -f /tmp/ngrok.log ]; then echo "$(YELLOW)Last few lines of ngrok output:$(NC)"; tail -5 /tmp/ngrok.log; fi; \
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
		minimal|minimal-with-scrape|standard|standard-macMseries|standard-monolithic|gpu|oip-gpu-only|standard-gpu|chatterbox|chatterbox-gpu|backend-only|max-decentralized|max-decentralized-gpu) ;; \
		*) echo "$(RED)Error: Invalid profile '$(PROFILE)'. Use: minimal, minimal-with-scrape, standard, standard-macMseries, standard-monolithic, gpu, oip-gpu-only, standard-gpu, chatterbox, chatterbox-gpu, backend-only, max-decentralized, or max-decentralized-gpu$(NC)"; exit 1 ;; \
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
	@if [ -f .env ]; then \
		export $$(grep -v '^#' .env | grep -E "^PORT=" | xargs); \
	fi; \
	OIP_PORT=$${PORT:-3005}; \
	echo "$(BLUE)🔍 Checking OIP health on port $$OIP_PORT...$(NC)"; \
	for i in {1..30}; do \
		if curl -s --max-time 2 "http://localhost:$$OIP_PORT/health" >/dev/null 2>&1; then \
			echo "$(GREEN)✅ OIP service is ready on port $$OIP_PORT$(NC)"; \
			break; \
		fi; \
		echo "Waiting for OIP service on port $$OIP_PORT... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)OIP service may still be starting on port $$OIP_PORT...$(NC)"
	@if [ "$(PROFILE)" = "minimal" ] || [ "$(PROFILE)" = "standard" ] || [ "$(PROFILE)" = "standard-gpu" ] || [ "$(PROFILE)" = "standard-macMseries" ] || [ "$(PROFILE)" = "max-decentralized" ] || [ "$(PROFILE)" = "max-decentralized-gpu" ]; then \
		echo "$(BLUE)ngrok tunnel is managed by Docker Compose (service: ngrok-minimal, ngrok, or ngrok-gpu) using NGROK_DOMAIN from .env$(NC)"; \
	else \
		$(MAKE) start-ngrok; \
	fi
	@make status

up-no-makefile-ngrok: validate-profile check-env check-gpu ## Start services with specified profile (ngrok via Docker Compose)
	@echo "$(BLUE)Starting OIP Arweave with profile: $(PROFILE)$(NC)"
	@if [ "$(PROFILE)" = "chatterbox" ] || [ "$(PROFILE)" = "chatterbox-gpu" ]; then \
		echo "$(YELLOW)🎭 Deploying with Chatterbox TTS as primary voice engine...$(NC)"; \
	fi
	docker-compose --profile $(PROFILE) up -d
	@echo "$(GREEN)Services started successfully$(NC)"
	@echo "$(BLUE)⏳ Waiting for OIP service to be ready...$(NC)"
	@if [ -f .env ]; then \
		export $$(grep -v '^#' .env | grep -E "^PORT=" | xargs); \
	fi; \
	OIP_PORT=$${PORT:-3005}; \
	echo "$(BLUE)🔍 Checking OIP health on port $$OIP_PORT...$(NC)"; \
	for i in {1..30}; do \
		if curl -s --max-time 2 "http://localhost:$$OIP_PORT/health" >/dev/null 2>&1; then \
			echo "$(GREEN)✅ OIP service is ready on port $$OIP_PORT$(NC)"; \
			break; \
		fi; \
		echo "Waiting for OIP service on port $$OIP_PORT... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)OIP service may still be starting on port $$OIP_PORT...$(NC)"
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
	@if [ -f .env ]; then \
		export $$(grep -v '^#' .env | grep -E "^PORT=" | xargs); \
	fi; \
	OIP_PORT=$${PORT:-3005}; \
	echo "$(BLUE)🔍 Checking OIP health on port $$OIP_PORT...$(NC)"; \
	for i in {1..30}; do \
		if curl -s --max-time 2 "http://localhost:$$OIP_PORT/health" >/dev/null 2>&1; then \
			echo "$(GREEN)✅ OIP service is ready on port $$OIP_PORT$(NC)"; \
			break; \
		fi; \
		echo "Waiting for OIP service on port $$OIP_PORT... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)OIP service may still be starting on port $$OIP_PORT...$(NC)"
	@if [ "$(PROFILE)" = "minimal" ] || [ "$(PROFILE)" = "standard" ] || [ "$(PROFILE)" = "standard-gpu" ] || [ "$(PROFILE)" = "standard-macMseries" ] || [ "$(PROFILE)" = "max-decentralized" ] || [ "$(PROFILE)" = "max-decentralized-gpu" ]; then \
		echo "$(BLUE)ngrok tunnel is managed by Docker Compose (service: ngrok-minimal, ngrok, or ngrok-gpu) using NGROK_DOMAIN from .env$(NC)"; \
	else \
		$(MAKE) start-ngrok; \
	fi
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
	@if [ -f .env ]; then \
		export $$(grep -v '^#' .env | grep -E "^PORT=" | xargs); \
	fi; \
	OIP_PORT=$${PORT:-3005}; \
	echo "$(BLUE)🔍 Checking OIP health on port $$OIP_PORT...$(NC)"; \
	for i in {1..30}; do \
		if curl -s --max-time 2 "http://localhost:$$OIP_PORT/health" >/dev/null 2>&1; then \
			echo "$(GREEN)✅ OIP service is ready on port $$OIP_PORT$(NC)"; \
			break; \
		fi; \
		echo "Waiting for OIP service on port $$OIP_PORT... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)OIP service may still be starting on port $$OIP_PORT...$(NC)"
	@if [ "$(PROFILE)" = "minimal" ] || [ "$(PROFILE)" = "standard" ] || [ "$(PROFILE)" = "standard-gpu" ] || [ "$(PROFILE)" = "standard-macMseries" ] || [ "$(PROFILE)" = "max-decentralized" ] || [ "$(PROFILE)" = "max-decentralized-gpu" ]; then \
		echo "$(BLUE)ngrok tunnel is managed by Docker Compose (service: ngrok-minimal, ngrok, or ngrok-gpu) using NGROK_DOMAIN from .env$(NC)"; \
	else \
		$(MAKE) start-ngrok; \
	fi
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
	@DOMAIN=""; \
	if [ -f .env ]; then \
		DOMAIN=$$(grep -v '^#' .env | grep -E "^NGROK_DOMAIN=" | cut -d'=' -f2-); \
	fi; \
	if [ -z "$$DOMAIN" ]; then DOMAIN="api.oip.onl"; fi; \
	if command -v curl >/dev/null 2>&1 && curl -s --max-time 3 http://localhost:4040/api/tunnels >/dev/null; then \
		if curl -s --max-time 3 http://localhost:4040/api/tunnels | grep -q "$$DOMAIN"; then \
			echo "$(GREEN)🔗 ngrok: ✅ Running$(NC)"; \
			echo "$(GREEN)🌐 API: https://$$DOMAIN$(NC)"; \
			echo "$(GREEN)✅ Tunnel verified: https://$$DOMAIN$(NC)"; \
		else \
			echo "$(YELLOW)⚠️  ngrok API reachable on :4040 but domain not reported yet$(NC)"; \
			curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | "  \(.public_url) -> \(.config.addr)"' 2>/dev/null || true; \
		fi; \
	else \
		if docker ps --format '{{.Names}}' | grep -q 'ngrok'; then \
			echo "$(YELLOW)⚠️  ngrok container running but API not reachable on 4040$(NC)"; \
		else \
			echo "$(RED)❌ ngrok: Not running$(NC)"; \
		fi; \
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

fix-permissions: ## Fix file permissions for data directory (Linux servers)
	@echo "$(BLUE)🔧 Fixing permissions for data directory...$(NC)"
	@./fix-permissions.sh

# Quick deployment targets for common scenarios
minimal: ## Quick deploy: Core services only (elasticsearch, kibana, oip - no canvas) + Docker Compose ngrok
	@make up-no-makefile-ngrok PROFILE=minimal

minimal-with-scrape: ## Quick deploy: Core services + scraping (elasticsearch, kibana, oip + canvas) + ngrok
	@make up PROFILE=minimal-with-scrape

standard: ## Quick deploy: Distributed full stack with Chatterbox TTS (recommended) + ngrok
	@make up PROFILE=standard
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

standard-macMseries: ## Quick deploy: Distributed full stack optimized for Apple Silicon Macs (CPU-based AI) + ngrok
	@make up PROFILE=standard-macMseries
	@echo "$(YELLOW)🍎 Installing LLM models for Apple Silicon...$(NC)"
	@make install-models
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

standard-gpu: ## Quick deploy: Complete stack with GPU acceleration + install models + ngrok (no AR.IO)
	@make up PROFILE=standard-gpu
	@echo "$(YELLOW)🤖 Installing LLM models automatically...$(NC)"
	@make install-models
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

max-decentralized: ## Quick deploy: Full stack + local AR.IO gateway (CPU)
	@make up PROFILE=max-decentralized
	@echo "$(YELLOW)🤖 Installing LLM models automatically...$(NC)"
	@make install-models
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

max-decentralized-gpu: ## Quick deploy: Full stack + local AR.IO gateway + GPU acceleration
	@make up PROFILE=max-decentralized-gpu
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

backend-only: ## Quick deploy: Backend services only for distributed Mac/iOS client architecture + ngrok
	@echo "$(BLUE)🍎 Deploying backend-only services for Mac/iOS clients...$(NC)"
	@echo "$(YELLOW)📱 This profile expects STT/VAD/Smart Turn to run on Mac/iOS clients$(NC)"
	@./deploy-backend-only.sh

# Quick rebuild targets for common scenarios
rebuild-minimal: ## Quick rebuild: Core services only (elasticsearch, kibana, oip - no canvas) + ngrok
	@make rebuild PROFILE=minimal

rebuild-minimal-with-scrape: ## Quick rebuild: Core services + scraping (elasticsearch, kibana, oip + canvas) + ngrok
	@make rebuild PROFILE=minimal-with-scrape

rebuild-standard: ## Quick rebuild: Distributed full stack with Chatterbox TTS + ngrok
	@make rebuild PROFILE=standard
	@echo "$(YELLOW)⏳ Waiting for TTS service to be ready...$(NC)"
	@for i in {1..30}; do \
		if docker ps | grep -E "tts-service.*Up|oip-arweave-indexer-tts-service.*Up" | grep -q Up; then \
			echo "$(GREEN)✅ TTS service is ready$(NC)"; \
			break; \
		fi; \
		echo "Waiting for TTS service... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)⚠️ TTS service didn't start in time, trying anyway...$(NC)"
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-standard-macMseries: ## Quick rebuild: Distributed full stack optimized for Apple Silicon Macs (CPU-based AI) + ngrok
	@make rebuild PROFILE=standard-macMseries
	@echo "$(YELLOW)⏳ Waiting for services to be ready...$(NC)"
	@for i in {1..30}; do \
		if docker ps | grep -E "ollama.*Up|oip-arweave-indexer-ollama.*Up" | grep -q Up; then \
			echo "$(GREEN)✅ Ollama service is ready$(NC)"; \
			break; \
		fi; \
		echo "Waiting for Ollama service... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)⚠️ Ollama service didn't start in time, trying anyway...$(NC)"
	@for i in {1..30}; do \
		if docker ps | grep -E "tts-service.*Up|oip-arweave-indexer-tts-service.*Up" | grep -q Up; then \
			echo "$(GREEN)✅ TTS service is ready$(NC)"; \
			break; \
		fi; \
		echo "Waiting for TTS service... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)⚠️ TTS service didn't start in time, trying anyway...$(NC)"
	@echo "$(YELLOW)🍎 Installing LLM models for Apple Silicon...$(NC)"
	@make install-models
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-standard-monolithic: ## Quick rebuild: Monolithic (all services in one container + separate AI services) + ngrok
	@make rebuild PROFILE=standard-monolithic
	@echo "$(YELLOW)⏳ Waiting for TTS service to be ready...$(NC)"
	@for i in {1..30}; do \
		if docker ps | grep -E "tts-service.*Up|oip-full.*Up|oip-arweave-indexer-tts-service.*Up|oip-arweave-indexer-oip-full.*Up" | grep -q Up; then \
			echo "$(GREEN)✅ TTS service is ready$(NC)"; \
			break; \
		fi; \
		echo "Waiting for TTS service... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)⚠️ TTS service didn't start in time, trying anyway...$(NC)"
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-gpu: ## Quick rebuild: GPU-optimized deployment with Chatterbox TTS + ngrok
	@make rebuild PROFILE=gpu
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-oip-gpu-only: ## Quick rebuild: GPU OIP service only + ngrok
	@make rebuild PROFILE=oip-gpu-only

rebuild-standard-gpu: ## Quick rebuild: Complete stack with GPU acceleration + install models + ngrok (no AR.IO, Chatterbox installed during build)
	@make rebuild PROFILE=standard-gpu
	@echo "$(YELLOW)⏳ Waiting for GPU services to be ready...$(NC)"
	@for i in {1..30}; do \
		if docker ps | grep -q -E "ollama-gpu.*(Up|Running)"; then \
			echo "$(GREEN)✅ Ollama GPU service is ready$(NC)"; \
			break; \
		fi; \
		echo "Waiting for Ollama GPU service... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)⚠️ Ollama GPU service didn't start in time, trying anyway...$(NC)"
	@for i in {1..30}; do \
		if docker ps | grep -q -E "tts-service-gpu.*(Up|Running)"; then \
			echo "$(GREEN)✅ TTS GPU service is ready$(NC)"; \
			break; \
		fi; \
		echo "Waiting for TTS GPU service... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)⚠️ TTS GPU service didn't start in time, trying anyway...$(NC)"
	@echo "$(YELLOW)⏳ Waiting for Ollama API to be ready...$(NC)"
	@for i in {1..20}; do \
		if curl -s "http://localhost:$${OLLAMA_PORT:-11434}/api/tags" >/dev/null; then \
			echo "$(GREEN)✅ Ollama API is ready$(NC)"; \
			break; \
		fi; \
		echo "Waiting for Ollama API... ($$i/20)"; \
		sleep 3; \
	done || echo "$(YELLOW)⚠️ Ollama API didn't respond in time, trying anyway...$(NC)"
	@echo "$(YELLOW)🤖 Installing LLM models automatically...$(NC)"
	@make install-models
	@echo "$(GREEN)🎭 Chatterbox TTS installed during Docker build - GPU profile ready!$(NC)"

rebuild-max-decentralized: ## Quick rebuild: Complete stack with local AR.IO gateway (CPU)
	@make rebuild PROFILE=max-decentralized
	@echo "$(YELLOW)⏳ Waiting for services to be ready...$(NC)"
	@for i in {1..30}; do \
		if docker ps | grep -q -E "ollama.*(Up|Running)"; then \
			echo "$(GREEN)✅ Ollama service is ready$(NC)"; \
			break; \
		fi; \
		echo "Waiting for Ollama service... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)⚠️ Ollama service didn't start in time, trying anyway...$(NC)"
	@for i in {1..30}; do \
		if docker ps | grep -q -E "ario-gateway.*(Up|Running)"; then \
			echo "$(GREEN)✅ AR.IO gateway is ready (syncing)$(NC)"; \
			break; \
		fi; \
		echo "Waiting for AR.IO gateway... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)⚠️ AR.IO gateway didn't start in time, trying anyway...$(NC)"
	@echo "$(YELLOW)🤖 Installing LLM models automatically...$(NC)"
	@make install-models
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-max-decentralized-gpu: ## Quick rebuild: Complete stack with local AR.IO gateway + GPU acceleration
	@make rebuild PROFILE=max-decentralized-gpu
	@echo "$(YELLOW)⏳ Waiting for GPU services to be ready...$(NC)"
	@for i in {1..30}; do \
		if docker ps | grep -q -E "ollama-gpu.*(Up|Running)"; then \
			echo "$(GREEN)✅ Ollama GPU service is ready$(NC)"; \
			break; \
		fi; \
		echo "Waiting for Ollama GPU service... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)⚠️ Ollama GPU service didn't start in time, trying anyway...$(NC)"
	@for i in {1..30}; do \
		if docker ps | grep -q -E "ario-gateway.*(Up|Running)"; then \
			echo "$(GREEN)✅ AR.IO gateway is ready (syncing)$(NC)"; \
			break; \
		fi; \
		echo "Waiting for AR.IO gateway... ($$i/30)"; \
		sleep 2; \
	done || echo "$(YELLOW)⚠️ AR.IO gateway didn't start in time, trying anyway...$(NC)"
	@echo "$(YELLOW)⏳ Waiting for Ollama API to be ready...$(NC)"
	@for i in {1..20}; do \
		if curl -s "http://localhost:$${OLLAMA_PORT:-11434}/api/tags" >/dev/null; then \
			echo "$(GREEN)✅ Ollama API is ready$(NC)"; \
			break; \
		fi; \
		echo "Waiting for Ollama API... ($$i/20)"; \
		sleep 3; \
	done || echo "$(YELLOW)⚠️ Ollama API didn't respond in time, trying anyway...$(NC)"
	@echo "$(YELLOW)🤖 Installing LLM models automatically...$(NC)"
	@make install-models
	@echo "$(GREEN)🎭 Chatterbox TTS installed during Docker build - Max-Decentralized GPU profile ready!$(NC)"

rebuild-chatterbox: ## Quick rebuild: Standard deployment with Chatterbox TTS focus (CPU) + ngrok
	@make rebuild PROFILE=chatterbox
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-chatterbox-gpu: ## Quick rebuild: Chatterbox TTS with GPU acceleration (RTX 4090 optimized) + ngrok
	@make rebuild PROFILE=chatterbox-gpu
	@echo "$(YELLOW)🎭 Installing GPU-optimized Chatterbox TTS model...$(NC)"

rebuild-backend-only: ## Quick rebuild: Backend services only for distributed Mac/iOS client architecture + ngrok
	@echo "$(BLUE)🍎 Rebuilding backend-only services for Mac/iOS clients...$(NC)"
	@echo "$(YELLOW)📱 This profile expects STT/VAD/Smart Turn to run on Mac/iOS clients$(NC)"
	@./deploy-backend-only.sh

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
	@DOMAIN=""; \
	if [ -f .env ]; then \
		DOMAIN=$$(grep -v '^#' .env | grep -E "^NGROK_DOMAIN=" | cut -d'=' -f2-); \
	fi; \
	if [ -z "$$DOMAIN" ]; then DOMAIN="api.oip.onl"; fi; \
	if command -v curl >/dev/null 2>&1 && curl -s --max-time 3 http://localhost:4040/api/tunnels >/dev/null; then \
		echo "$(GREEN)🔗 ngrok: ✅ Running$(NC)"; \
		echo "$(GREEN)🌐 API: https://$$DOMAIN$(NC)"; \
		echo "$(BLUE)Active tunnels:$(NC)"; \
		curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[] | "  \(.public_url) -> \(.config.addr)"' 2>/dev/null || echo "  Check http://localhost:4040 for tunnel details"; \
	else \
		if docker ps --format '{{.Names}}' | grep -q 'ngrok'; then \
			echo "$(YELLOW)⚠️  ngrok container running but API not reachable on 4040$(NC)"; \
		else \
			echo "$(RED)❌ ngrok: Not running$(NC)"; \
			echo "$(YELLOW)Start with: make start-ngrok$(NC)"; \
		fi; \
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
	@DOMAIN=""; \
	if [ -f .env ]; then \
		DOMAIN=$$(grep -v '^#' .env | grep -E "^NGROK_DOMAIN=" | cut -d'=' -f2-); \
	fi; \
	if [ -z "$$DOMAIN" ]; then DOMAIN="api.oip.onl"; fi; \
	echo "  📋 Full command: $(GREEN)ngrok http --domain=$$DOMAIN $${PORT:-3005}$(NC)";
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

# Elasticsearch Migration
migrate-elasticsearch-data: ## Migrate Elasticsearch from Docker volume to host bind mount
	@echo "$(BLUE)📦 Elasticsearch Data Migration Tool$(NC)"
	@echo "$(YELLOW)This will migrate your Elasticsearch data from Docker-managed volume to host filesystem$(NC)"
	@echo ""
	@if [ -f .env ]; then \
		export $$(grep -v '^#' .env | grep -E "^ELASTICSEARCH_DATA_PATH=" | xargs); \
	fi; \
	ES_DATA_PATH="$${ELASTICSEARCH_DATA_PATH:-./elasticsearch_data}"; \
	echo "$(BLUE)Target path: $$ES_DATA_PATH$(NC)"; \
	if [ -d "$$ES_DATA_PATH" ] && [ "$$(ls -A $$ES_DATA_PATH 2>/dev/null)" ]; then \
		echo "$(YELLOW)⚠️  Target directory already exists and is not empty$(NC)"; \
		echo "$(YELLOW)Skipping migration to avoid overwriting existing data$(NC)"; \
		exit 0; \
	fi; \
	echo "$(BLUE)🔍 Looking for old Docker volume...$(NC)"; \
	OLD_VOLUME_NAME="$${COMPOSE_PROJECT_NAME:-oip-arweave-indexer}_esdata"; \
	if ! docker volume inspect $$OLD_VOLUME_NAME >/dev/null 2>&1; then \
		echo "$(YELLOW)⚠️  Old Docker volume '$$OLD_VOLUME_NAME' not found$(NC)"; \
		echo "$(BLUE)Creating fresh directory for Elasticsearch data...$(NC)"; \
		mkdir -p "$$ES_DATA_PATH"; \
		sudo chown -R 1000:1000 "$$ES_DATA_PATH" 2>/dev/null || chown -R 1000:1000 "$$ES_DATA_PATH" 2>/dev/null || echo "$(YELLOW)⚠️  Could not set ownership (may need sudo)$(NC)"; \
		echo "$(GREEN)✅ Fresh Elasticsearch data directory ready$(NC)"; \
		exit 0; \
	fi; \
	echo "$(GREEN)✅ Found old volume: $$OLD_VOLUME_NAME$(NC)"; \
	echo "$(BLUE)📋 Stopping Elasticsearch to ensure data consistency...$(NC)"; \
	docker-compose stop elasticsearch 2>/dev/null || true; \
	sleep 2; \
	echo "$(BLUE)📂 Creating target directory...$(NC)"; \
	mkdir -p "$$ES_DATA_PATH"; \
	echo "$(BLUE)🚚 Copying data from Docker volume to host filesystem...$(NC)"; \
	echo "$(YELLOW)This may take several minutes depending on data size...$(NC)"; \
	docker run --rm \
		-v "$$OLD_VOLUME_NAME:/source:ro" \
		-v "$$(cd "$$(dirname "$$ES_DATA_PATH")" && pwd)/$$(basename "$$ES_DATA_PATH"):/target" \
		alpine:latest \
		sh -c "cp -av /source/. /target/ && chown -R 1000:1000 /target" || \
	docker run --rm \
		-v "$$OLD_VOLUME_NAME:/source:ro" \
		-v "$$(cd "$$(dirname "$$ES_DATA_PATH")" && pwd)/$$(basename "$$ES_DATA_PATH"):/target" \
		alpine:latest \
		sh -c "cp -av /source/. /target/"; \
	echo "$(GREEN)✅ Data migration completed$(NC)"; \
	echo "$(BLUE)🔍 Verifying data...$(NC)"; \
	if [ -d "$$ES_DATA_PATH/nodes" ]; then \
		echo "$(GREEN)✅ Elasticsearch data structure verified$(NC)"; \
		echo ""; \
		echo "$(GREEN)📊 Migration Summary:$(NC)"; \
		echo "  Old volume: $$OLD_VOLUME_NAME"; \
		echo "  New location: $$ES_DATA_PATH"; \
		echo "  Size: $$(du -sh "$$ES_DATA_PATH" 2>/dev/null | cut -f1 || echo 'unknown')"; \
		echo ""; \
		echo "$(BLUE)💡 Next steps:$(NC)"; \
		echo "  1. Start services: make up PROFILE=<your-profile>"; \
		echo "  2. Verify Elasticsearch is working"; \
		echo "  3. Remove old volume: make clean-old-es-volume"; \
	else \
		echo "$(RED)⚠️  Data verification failed - Elasticsearch data structure not found$(NC)"; \
	fi

clean-old-es-volume: ## Remove old Elasticsearch Docker volume (after successful migration)
	@echo "$(YELLOW)⚠️  This will permanently delete the old Elasticsearch Docker volume$(NC)"
	@echo "$(YELLOW)Only do this after verifying your migrated data works correctly!$(NC)"
	@echo "$(YELLOW)Press Ctrl+C to cancel, or wait 10 seconds to continue...$(NC)"
	@sleep 10
	@OLD_VOLUME_NAME="$${COMPOSE_PROJECT_NAME:-oip-arweave-indexer}_esdata"; \
	if docker volume inspect $$OLD_VOLUME_NAME >/dev/null 2>&1; then \
		echo "$(BLUE)🗑️  Removing old Docker volume: $$OLD_VOLUME_NAME$(NC)"; \
		docker volume rm $$OLD_VOLUME_NAME && \
		echo "$(GREEN)✅ Old volume removed successfully$(NC)" || \
		echo "$(RED)❌ Failed to remove volume. Make sure all containers using it are stopped.$(NC)"; \
	else \
		echo "$(YELLOW)Volume $$OLD_VOLUME_NAME not found$(NC)"; \
	fi

check-es-storage: ## Check Elasticsearch storage location and disk space
	@echo "$(BLUE)📊 Elasticsearch Storage Information$(NC)"
	@echo ""
	@if [ -f .env ]; then \
		export $$(grep -v '^#' .env | grep -E "^ELASTICSEARCH_DATA_PATH=" | xargs); \
	fi; \
	ES_DATA_PATH="$${ELASTICSEARCH_DATA_PATH:-./elasticsearch_data}"; \
	echo "$(YELLOW)Configured path:$(NC) $$ES_DATA_PATH"; \
	if [ -d "$$ES_DATA_PATH" ]; then \
		echo "$(GREEN)✅ Directory exists$(NC)"; \
		echo "$(YELLOW)Size:$(NC) $$(du -sh "$$ES_DATA_PATH" 2>/dev/null | cut -f1 || echo 'unknown')"; \
		echo "$(YELLOW)Disk space available:$(NC) $$(df -h "$$ES_DATA_PATH" | tail -1 | awk '{print $$4}')"; \
		echo "$(YELLOW)Mount point:$(NC) $$(df -h "$$ES_DATA_PATH" | tail -1 | awk '{print $$6}')"; \
		if [ -d "$$ES_DATA_PATH/nodes" ]; then \
			echo "$(GREEN)✅ Contains Elasticsearch data$(NC)"; \
		else \
			echo "$(YELLOW)⚠️  No Elasticsearch data found yet$(NC)"; \
		fi; \
	else \
		echo "$(YELLOW)⚠️  Directory does not exist yet$(NC)"; \
		echo "$(BLUE)It will be created when you start Elasticsearch$(NC)"; \
	fi; \
	echo ""; \
	OLD_VOLUME_NAME="$${COMPOSE_PROJECT_NAME:-oip-arweave-indexer}_esdata"; \
	if docker volume inspect $$OLD_VOLUME_NAME >/dev/null 2>&1; then \
		echo "$(YELLOW)⚠️  Old Docker volume still exists:$(NC) $$OLD_VOLUME_NAME"; \
		echo "$(BLUE)💡 Run 'make migrate-elasticsearch-data' to migrate to bind mount$(NC)"; \
	else \
		echo "$(GREEN)✅ No old Docker volume found$(NC)"; \
	fi

check-ario-storage: ## Check AR.IO gateway storage location and disk space
	@echo "$(BLUE)📊 AR.IO Gateway Storage Information$(NC)"
	@echo ""
	@if [ -f .env ]; then \
		export $$(grep -v '^#' .env | grep -E "^ARIO_GATEWAY_DATA_PATH=" | xargs); \
		export $$(grep -v '^#' .env | grep -E "^ARIO_START_BLOCK_HEIGHT=" | xargs); \
		export $$(grep -v '^#' .env | grep -E "^ARIO_MAX_STORAGE_GB=" | xargs); \
	fi; \
	ARIO_DATA_PATH="$${ARIO_GATEWAY_DATA_PATH:-./ario_gateway_data}"; \
	echo "$(YELLOW)Configured path:$(NC) $$ARIO_DATA_PATH"; \
	if [ -d "$$ARIO_DATA_PATH" ]; then \
		echo "$(GREEN)✅ Directory exists$(NC)"; \
		echo "$(YELLOW)Current size:$(NC) $$(du -sh "$$ARIO_DATA_PATH" 2>/dev/null | cut -f1 || echo 'unknown')"; \
		echo "$(YELLOW)Disk space available:$(NC) $$(df -h "$$ARIO_DATA_PATH" | tail -1 | awk '{print $$4}')"; \
		echo "$(YELLOW)Mount point:$(NC) $$(df -h "$$ARIO_DATA_PATH" | tail -1 | awk '{print $$6}')"; \
		echo ""; \
		echo "$(BLUE)Storage breakdown:$(NC)"; \
		if [ -d "$$ARIO_DATA_PATH" ]; then \
			du -sh "$$ARIO_DATA_PATH"/* 2>/dev/null | sort -h | tail -10 || echo "  (no subdirectories yet)"; \
		fi; \
	else \
		echo "$(YELLOW)⚠️  Directory does not exist yet$(NC)"; \
		echo "$(BLUE)It will be created when you start the AR.IO gateway$(NC)"; \
	fi; \
	echo ""; \
	if [ -n "$$ARIO_START_BLOCK_HEIGHT" ]; then \
		echo "$(GREEN)✅ Start block height configured:$(NC) $$ARIO_START_BLOCK_HEIGHT"; \
		echo "$(BLUE)Gateway will sync from block $$ARIO_START_BLOCK_HEIGHT onwards$(NC)"; \
	else \
		echo "$(YELLOW)⚠️  Start block height not set$(NC)"; \
		echo "$(BLUE)Gateway will sync from genesis (block 0) - this may take a long time$(NC)"; \
		echo "$(BLUE)💡 Set ARIO_START_BLOCK_HEIGHT in .env to start from a specific block$(NC)"; \
	fi; \
	echo ""; \
	if [ -n "$$ARIO_MAX_STORAGE_GB" ]; then \
		echo "$(GREEN)✅ Max storage limit configured:$(NC) $$ARIO_MAX_STORAGE_GB GB"; \
	else \
		echo "$(YELLOW)⚠️  Max storage limit not set$(NC)"; \
		echo "$(BLUE)Gateway will cache on demand without hard limit$(NC)"; \
		echo "$(BLUE)💡 Set ARIO_MAX_STORAGE_GB in .env to limit cache size$(NC)"; \
	fi; \
	echo ""; \
	echo "$(BLUE)💡 Note: AR.IO gateway caches data on demand$(NC)"; \
	echo "$(BLUE)   It doesn't store the full Arweave dataset - only what you access$(NC)"; \
	echo "$(BLUE)   Block importing logs show metadata indexing, not full data storage$(NC)"

check-ario-env: ## Check AR.IO gateway environment variables in running container
	@echo "$(BLUE)🔍 AR.IO Gateway Environment Variables$(NC)"
	@echo ""
	@echo "$(YELLOW)Step 1: Checking .env file:$(NC)"; \
	if [ -f .env ]; then \
		echo "$(GREEN)✅ .env file found$(NC)"; \
		echo ""; \
		echo "$(BLUE)START_HEIGHT variables in .env:$(NC)"; \
		grep -E "^START_HEIGHT=|^ARIO_START_BLOCK_HEIGHT=" .env | grep -v "^#" || echo "$(YELLOW)⚠️  No START_HEIGHT variables found in .env$(NC)"; \
		echo ""; \
		echo "$(BLUE)Checking exact format (showing raw lines):$(NC)"; \
		grep -E "^START_HEIGHT|^ARIO_START_BLOCK_HEIGHT" .env | head -2; \
	else \
		echo "$(RED)❌ .env file not found$(NC)"; \
	fi; \
	echo ""; \
	echo "$(YELLOW)Step 2: What Docker Compose will substitute:$(NC)"; \
	if [ -f .env ]; then \
		export $$(grep -v '^#' .env | xargs); \
		echo "START_HEIGHT from shell: $${START_HEIGHT:-NOT SET}"; \
		echo "ARIO_START_BLOCK_HEIGHT from shell: $${ARIO_START_BLOCK_HEIGHT:-NOT SET}"; \
	fi; \
	echo ""; \
	if docker ps | grep -q ario-gateway; then \
		echo "$(GREEN)✅ Gateway container is running$(NC)"; \
		echo ""; \
		echo "$(YELLOW)Step 3: Environment variables in container:$(NC)"; \
		CONTAINER_ID=$$(docker ps -q -f name=ario-gateway); \
		if [ -n "$$CONTAINER_ID" ]; then \
			echo "$(BLUE)Looking for START_HEIGHT specifically:$(NC)"; \
			docker exec $$CONTAINER_ID env | grep "^START_HEIGHT" || echo "$(RED)❌ START_HEIGHT NOT FOUND in container$(NC)"; \
			echo ""; \
			echo "$(BLUE)All START/ARIO related variables:$(NC)"; \
			docker exec $$CONTAINER_ID env | grep -E "(START|ARIO)" | sort || echo "$(YELLOW)⚠️  No START/ARIO variables found$(NC)"; \
			echo ""; \
			echo "$(BLUE)All environment variables (first 30):$(NC)"; \
			docker exec $$CONTAINER_ID env | sort | head -30; \
		else \
			echo "$(RED)❌ Could not find gateway container$(NC)"; \
		fi; \
	else \
		echo "$(YELLOW)⚠️  Gateway container is not running$(NC)"; \
		echo "$(BLUE)Start it with: make standard-gpu$(NC)"; \
	fi; \
	echo ""; \
	echo "$(YELLOW)💡 If START_HEIGHT is not in container but is in .env:$(NC)"; \
	echo "$(BLUE)   1. Recreate container: docker-compose stop ario-gateway && docker-compose rm -f ario-gateway$(NC)"; \
	echo "$(BLUE)   2. Restart: make standard-gpu$(NC)"; \
	echo ""; \
	echo "$(YELLOW)⚠️  IMPORTANT: START_HEIGHT may only work on FIRST initialization$(NC)"; \
	echo "$(BLUE)   If gateway has already synced blocks, it may ignore START_HEIGHT$(NC)"; \
	echo ""; \
	if docker ps | grep -q ario-gateway; then \
		echo "$(BLUE)Checking data directory INSIDE container:$(NC)"; \
		CONTAINER_ID=$$(docker ps -q -f name=ario-gateway); \
		if [ -n "$$CONTAINER_ID" ]; then \
			echo "$(YELLOW)Files in /data (container path):$(NC)"; \
			docker exec $$CONTAINER_ID ls -la /data 2>/dev/null || echo "$(YELLOW)   /data directory empty or doesn't exist$(NC)"; \
			echo ""; \
			echo "$(YELLOW)Looking for database files:$(NC)"; \
			docker exec $$CONTAINER_ID find /data -type f \( -name "*.db" -o -name "*.sqlite*" \) 2>/dev/null | head -10 || echo "$(BLUE)   No database files found$(NC)"; \
			echo ""; \
			echo "$(YELLOW)Gateway logs mentioning START_HEIGHT or block height:$(NC)"; \
			docker logs $$CONTAINER_ID 2>&1 | grep -iE "(start|height|block.*import)" | head -10 || echo "$(BLUE)   No relevant log entries$(NC)"; \
		fi; \
	fi

reset-ario-gateway: ## Reset AR.IO gateway to start from a specific block height (requires START_HEIGHT or ARIO_START_BLOCK_HEIGHT in .env)
	@echo "$(YELLOW)⚠️  WARNING: This will delete all AR.IO gateway data and restart from the configured block height$(NC)"
	@echo ""
	@read -p "Are you sure you want to reset the AR.IO gateway? (yes/no): " confirm; \
	if [ "$$confirm" != "yes" ]; then \
		echo "$(RED)❌ Reset cancelled$(NC)"; \
		exit 1; \
	fi; \
	echo ""; \
	if [ -f .env ]; then \
		export $$(grep -v '^#' .env | grep -E "^ARIO_GATEWAY_DATA_PATH=" | xargs); \
		export $$(grep -v '^#' .env | grep -E "^START_HEIGHT=" | xargs); \
		export $$(grep -v '^#' .env | grep -E "^ARIO_START_BLOCK_HEIGHT=" | xargs); \
	fi; \
	ARIO_DATA_PATH="$${ARIO_GATEWAY_DATA_PATH:-./ario_gateway_data}"; \
	START_HEIGHT_VAL="$${START_HEIGHT:-$$ARIO_START_BLOCK_HEIGHT}"; \
	if [ -z "$$START_HEIGHT_VAL" ]; then \
		echo "$(RED)❌ Error: START_HEIGHT or ARIO_START_BLOCK_HEIGHT not set in .env$(NC)"; \
		echo "$(BLUE)💡 Set START_HEIGHT=<block_height> in .env (AR.IO gateway expects this name)$(NC)"; \
		echo "$(BLUE)   Or use ARIO_START_BLOCK_HEIGHT=<block_height> for backward compatibility$(NC)"; \
		exit 1; \
	fi; \
	echo "$(BLUE)📋 Configuration:$(NC)"; \
	echo "  Start block height: $$START_HEIGHT_VAL"; \
	echo "  Data path: $$ARIO_DATA_PATH"; \
	echo ""; \
	echo "$(YELLOW)🛑 Stopping and removing AR.IO gateway container...$(NC)"; \
	docker-compose stop ario-gateway 2>/dev/null || true; \
	docker-compose rm -f ario-gateway 2>/dev/null || true; \
	echo "$(YELLOW)🗑️  Deleting gateway data directory...$(NC)"; \
	if [ -d "$$ARIO_DATA_PATH" ]; then \
		echo "$(BLUE)   Looking for database files that might override START_HEIGHT...$(NC)"; \
		find "$$ARIO_DATA_PATH" -type f \( -name "*.db" -o -name "*.sqlite*" -o -name "*lmdb*" \) 2>/dev/null | while read db; do \
			echo "$(YELLOW)   Found database: $$db$(NC)"; \
		done; \
		echo "$(BLUE)   Deleting ALL files including hidden ones...$(NC)"; \
		rm -rf "$$ARIO_DATA_PATH"/* "$$ARIO_DATA_PATH"/.* 2>/dev/null; \
		rmdir "$$ARIO_DATA_PATH" 2>/dev/null || true; \
		if [ -d "$$ARIO_DATA_PATH" ]; then \
			rm -rf "$$ARIO_DATA_PATH"; \
		fi; \
		echo "$(GREEN)✅ Data directory deleted$(NC)"; \
	else \
		echo "$(BLUE)ℹ️  Data directory doesn't exist on host (checking container...)$(NC)"; \
	fi; \
	echo "$(BLUE)   Also checking INSIDE container for persistent data...$(NC)"; \
	if docker ps -q -f name=ario-gateway | grep -q .; then \
		echo "$(YELLOW)   Container is running - stopping it first...$(NC)"; \
		docker-compose stop ario-gateway 2>/dev/null || true; \
	fi; \
	echo "$(BLUE)   If container has data in /data, it will be cleared on next start$(NC)"; \
	echo "$(BLUE)   (Volume mount will create fresh empty directory)$(NC)"; \
	echo ""; \
	echo "$(BLUE)💡 Verifying START_HEIGHT will be set correctly...$(NC)"; \
	if docker-compose config 2>/dev/null | grep -q "START_HEIGHT=$$START_HEIGHT_VAL"; then \
		echo "$(GREEN)✅ START_HEIGHT environment variable configured correctly: $$START_HEIGHT_VAL$(NC)"; \
	else \
		echo "$(YELLOW)⚠️  Warning: START_HEIGHT might not be set correctly$(NC)"; \
		echo "$(BLUE)   Expected: START_HEIGHT=$$START_HEIGHT_VAL$(NC)"; \
		echo "$(BLUE)   Check that START_HEIGHT=$$START_HEIGHT_VAL is in your .env file$(NC)"; \
		echo "$(BLUE)   Run 'make check-ario-env' to verify environment variables$(NC)"; \
	fi; \
	echo ""; \
	echo "$(GREEN)✅ Gateway reset complete$(NC)"; \
	echo "$(BLUE)💡 Start the gateway with: make standard-gpu (or your profile)$(NC)"; \
	echo "$(BLUE)   It will now sync from block $$START_HEIGHT_VAL$(NC)"; \
	echo "$(BLUE)   Note: The gateway container will be recreated with the new START_HEIGHT setting$(NC)"; \
	echo "$(BLUE)   After starting, run 'make check-ario-env' to verify the environment variable is set$(NC)"

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

dev-frontend: ## Development: Start frontend development server (npx serve)
	@echo "$(BLUE)🚀 Starting frontend development server...$(NC)"
	@./scripts/dev-frontend.sh

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

# Mac Client Services Management
mac-stt-services: ## Start Mac STT services (Smart Turn, STT, Interface Server) with logging
	@echo "$(BLUE)🍎 Starting Mac STT Services Stack...$(NC)"
	@echo "$(YELLOW)📱 This starts the client-side services for Mac voice interface$(NC)"
	@echo "$(GREEN)Services starting:$(NC)"
	@echo "  🧠 Smart Turn Service (port 8014)"
	@echo "  🎤 STT Service (port 8013)" 
	@echo "  🌐 Interface Server (port 3001)"
	@echo ""
	@mkdir -p logs
	@echo "$(BLUE)📋 Logs will be saved to:$(NC)"
	@echo "  📄 logs/smart-turn-service.log"
	@echo "  📄 logs/stt-service.log"
	@echo "  📄 logs/interface-server.log"
	@echo ""
	@echo "$(YELLOW)💡 Monitor logs with:$(NC)"
	@echo "  make mac-logs-smart-turn    # Smart Turn service logs"
	@echo "  make mac-logs-stt          # STT service logs"
	@echo "  make mac-logs-interface    # Interface server logs"
	@echo "  make mac-logs-all          # All services logs"
	@echo ""
	@cd mac-client && \
	echo "$(GREEN)🧠 Starting Smart Turn Service...$(NC)" && \
	source mac-client-env/bin/activate && \
	(nohup python mac_smart_turn_service.py > ../logs/smart-turn-service.log 2>&1 & echo $$! > ../logs/smart-turn-service.pid) && \
	echo "$(GREEN)🎤 Starting STT Service...$(NC)" && \
	(nohup python mac_stt_service.py > ../logs/stt-service.log 2>&1 & echo $$! > ../logs/stt-service.pid) && \
	echo "$(GREEN)🌐 Starting Interface Server...$(NC)" && \
	(nohup node voice_interface_server.js > ../logs/interface-server.log 2>&1 & echo $$! > ../logs/interface-server.pid)
	@sleep 3
	@echo ""
	@echo "$(GREEN)✅ All Mac STT services started!$(NC)"
	@echo "$(BLUE)🔍 Service Status:$(NC)"
	@make mac-status

mac-stop: ## Stop all Mac STT services
	@echo "$(BLUE)🛑 Stopping Mac STT Services...$(NC)"
	@if [ -f logs/smart-turn-service.pid ]; then \
		PID=$$(cat logs/smart-turn-service.pid); \
		if kill -0 $$PID 2>/dev/null; then \
			echo "$(YELLOW)Stopping Smart Turn Service (PID: $$PID)...$(NC)"; \
			kill $$PID; \
		fi; \
		rm -f logs/smart-turn-service.pid; \
	fi
	@if [ -f logs/stt-service.pid ]; then \
		PID=$$(cat logs/stt-service.pid); \
		if kill -0 $$PID 2>/dev/null; then \
			echo "$(YELLOW)Stopping STT Service (PID: $$PID)...$(NC)"; \
			kill $$PID; \
		fi; \
		rm -f logs/stt-service.pid; \
	fi
	@if [ -f logs/interface-server.pid ]; then \
		PID=$$(cat logs/interface-server.pid); \
		if kill -0 $$PID 2>/dev/null; then \
			echo "$(YELLOW)Stopping Interface Server (PID: $$PID)...$(NC)"; \
			kill $$PID; \
		fi; \
		rm -f logs/interface-server.pid; \
	fi
	@echo "$(GREEN)🔗 All Mac STT services stopped$(NC)"

mac-status: ## Check status of Mac STT services
	@echo "$(BLUE)Mac STT Services Status:$(NC)"
	@if [ -f logs/smart-turn-service.pid ]; then \
		PID=$$(cat logs/smart-turn-service.pid); \
		if kill -0 $$PID 2>/dev/null; then \
			echo "$(GREEN)🧠 Smart Turn Service: ✅ Running (PID: $$PID)$(NC)"; \
		else \
			echo "$(RED)🧠 Smart Turn Service: ❌ Stopped$(NC)"; \
		fi; \
	else \
		echo "$(RED)🧠 Smart Turn Service: ❌ Not started$(NC)"; \
	fi
	@if [ -f logs/stt-service.pid ]; then \
		PID=$$(cat logs/stt-service.pid); \
		if kill -0 $$PID 2>/dev/null; then \
			echo "$(GREEN)🎤 STT Service: ✅ Running (PID: $$PID)$(NC)"; \
		else \
			echo "$(RED)🎤 STT Service: ❌ Stopped$(NC)"; \
		fi; \
	else \
		echo "$(RED)🎤 STT Service: ❌ Not started$(NC)"; \
	fi
	@if [ -f logs/interface-server.pid ]; then \
		PID=$$(cat logs/interface-server.pid); \
		if kill -0 $$PID 2>/dev/null; then \
			echo "$(GREEN)🌐 Interface Server: ✅ Running (PID: $$PID)$(NC)"; \
		else \
			echo "$(RED)🌐 Interface Server: ❌ Stopped$(NC)"; \
		fi; \
	else \
		echo "$(RED)🌐 Interface Server: ❌ Not started$(NC)"; \
	fi
	@echo ""
	@echo "$(BLUE)Port Status:$(NC)"
	@if lsof -i :8014 >/dev/null 2>&1; then \
		echo "$(GREEN)  Port 8014 (Smart Turn): ✅ Active$(NC)"; \
	else \
		echo "$(RED)  Port 8014 (Smart Turn): ❌ Free$(NC)"; \
	fi
	@if lsof -i :8013 >/dev/null 2>&1; then \
		echo "$(GREEN)  Port 8013 (STT): ✅ Active$(NC)"; \
	else \
		echo "$(RED)  Port 8013 (STT): ❌ Free$(NC)"; \
	fi
	@if lsof -i :3001 >/dev/null 2>&1; then \
		echo "$(GREEN)  Port 3001 (Interface): ✅ Active$(NC)"; \
	else \
		echo "$(RED)  Port 3001 (Interface): ❌ Free$(NC)"; \
	fi

mac-restart: ## Restart all Mac STT services
	@echo "$(BLUE)🔄 Restarting Mac STT Services...$(NC)"
	@make mac-stop
	@sleep 2
	@make mac-stt-services

mac-logs-smart-turn: ## Show Smart Turn service logs
	@echo "$(BLUE)🧠 Smart Turn Service Logs:$(NC)"
	@if [ -f logs/smart-turn-service.log ]; then \
		tail -f logs/smart-turn-service.log; \
	else \
		echo "$(YELLOW)No Smart Turn service log found. Start services with: make mac-stt-services$(NC)"; \
	fi

mac-logs-stt: ## Show STT service logs  
	@echo "$(BLUE)🎤 STT Service Logs:$(NC)"
	@if [ -f logs/stt-service.log ]; then \
		tail -f logs/stt-service.log; \
	else \
		echo "$(YELLOW)No STT service log found. Start services with: make mac-stt-services$(NC)"; \
	fi

mac-logs-interface: ## Show Interface server logs
	@echo "$(BLUE)🌐 Interface Server Logs:$(NC)"
	@if [ -f logs/interface-server.log ]; then \
		tail -f logs/interface-server.log; \
	else \
		echo "$(YELLOW)No Interface server log found. Start services with: make mac-stt-services$(NC)"; \
	fi

mac-logs-all: ## Show all Mac STT service logs (multiplexed)
	@echo "$(BLUE)📋 All Mac STT Service Logs:$(NC)"
	@if [ -f logs/smart-turn-service.log ] && [ -f logs/stt-service.log ] && [ -f logs/interface-server.log ]; then \
		echo "$(YELLOW)💡 Press Ctrl+C to stop monitoring$(NC)"; \
		tail -f logs/smart-turn-service.log logs/stt-service.log logs/interface-server.log; \
	else \
		echo "$(YELLOW)Some log files missing. Start services with: make mac-stt-services$(NC)"; \
		echo "$(BLUE)Available logs:$(NC)"; \
		ls -la logs/*.log 2>/dev/null || echo "  No logs found"; \
	fi

# Memory Configuration Management
set-memory-8gb: ## Set Node.js heap to 8GB
	@echo "$(BLUE)Setting memory allocation to 8GB...$(NC)"
	@./set-memory.sh 8192

set-memory-16gb: ## Set Node.js heap to 16GB (recommended for 128GB systems)
	@echo "$(BLUE)Setting memory allocation to 16GB...$(NC)"
	@./set-memory.sh 16384

set-memory-32gb: ## Set Node.js heap to 32GB
	@echo "$(BLUE)Setting memory allocation to 32GB...$(NC)"
	@./set-memory.sh 32768

set-memory-64gb: ## Set Node.js heap to 64GB (for high-volume indexing)
	@echo "$(BLUE)Setting memory allocation to 64GB...$(NC)"
	@./set-memory.sh 65536

check-memory-config: ## Check current memory configuration from .env
	@echo "$(BLUE)Current Memory Configuration:$(NC)"
	@if [ -f .env ]; then \
		if grep -q "NODE_OPTIONS=" .env; then \
			HEAP_SIZE=$$(grep "NODE_OPTIONS=" .env | grep -oP 'max-old-space-size=\K[0-9]+' 2>/dev/null || grep "NODE_OPTIONS=" .env | sed -n 's/.*max-old-space-size=\([0-9]*\).*/\1/p'); \
			if [ -n "$$HEAP_SIZE" ]; then \
				HEAP_SIZE_GB=$$(echo "scale=2; $$HEAP_SIZE / 1024" | bc); \
				echo "$(GREEN)✓ Heap Size: $$HEAP_SIZE MB ($${HEAP_SIZE_GB}GB)$(NC)"; \
				NODE_OPTS=$$(grep "NODE_OPTIONS=" .env | cut -d'=' -f2-); \
				echo "$(BLUE)  Full Options: $$NODE_OPTS$(NC)"; \
			else \
				echo "$(YELLOW)⚠️  NODE_OPTIONS set but no heap size found$(NC)"; \
				grep "NODE_OPTIONS=" .env; \
			fi; \
		else \
			echo "$(YELLOW)⚠️  NODE_OPTIONS not configured in .env$(NC)"; \
			echo "$(BLUE)Default Node.js heap will be used (~4GB on 64-bit systems)$(NC)"; \
			echo ""; \
			echo "$(YELLOW)To configure memory:$(NC)"; \
			echo "  make set-memory-16gb    # Recommended for your 128GB system"; \
		fi; \
	else \
		echo "$(RED)❌ .env file not found$(NC)"; \
	fi; \
	echo ""; \
	if command -v free >/dev/null 2>&1; then \
		TOTAL_MEM=$$(free -m | awk '/^Mem:/{print $$2}'); \
		echo "$(BLUE)System Memory: $${TOTAL_MEM}MB$(NC)"; \
	elif command -v sysctl >/dev/null 2>&1; then \
		TOTAL_MEM=$$(sysctl -n hw.memsize 2>/dev/null | awk '{print int($$1/1024/1024)}'); \
		if [ -n "$$TOTAL_MEM" ]; then \
			echo "$(BLUE)System Memory: $${TOTAL_MEM}MB$(NC)"; \
		fi; \
	fi

# GUN Records Backup & Restore
backup-gun-records: ## Backup all GUN records from Elasticsearch to JSON file
	@echo "$(BLUE)📦 Backing up GUN records from Elasticsearch...$(NC)"
	@if [ ! -f scripts/backup-gun-records.js ]; then \
		echo "$(RED)❌ Backup script not found: scripts/backup-gun-records.js$(NC)"; \
		exit 1; \
	fi; \
	CONTAINER_NAME=$$(docker ps --format "{{.Names}}" | grep -E "oip|fitnessally" | grep -v elasticsearch | grep -v kibana | grep -v ngrok | head -1); \
	if [ -z "$$CONTAINER_NAME" ]; then \
		echo "$(RED)❌ No OIP container found. Is the service running?$(NC)"; \
		echo "$(YELLOW)💡 Try: make status$(NC)"; \
		exit 1; \
	fi; \
	echo "$(GREEN)✅ Found container: $$CONTAINER_NAME$(NC)"; \
	echo "$(BLUE)📂 Copying backup script to container...$(NC)"; \
	docker exec $$CONTAINER_NAME mkdir -p /usr/src/app/scripts; \
	docker cp scripts/backup-gun-records.js $$CONTAINER_NAME:/usr/src/app/scripts/backup-gun-records.js; \
	echo "$(BLUE)🚀 Running backup script...$(NC)"; \
	docker exec -w /usr/src/app $$CONTAINER_NAME node scripts/backup-gun-records.js || \
	(docker exec -it -w /usr/src/app $$CONTAINER_NAME node scripts/backup-gun-records.js); \
	EXIT_CODE=$$?; \
	echo "$(BLUE)🧹 Cleaning up...$(NC)"; \
	docker exec $$CONTAINER_NAME rm -f /usr/src/app/scripts/backup-gun-records.js; \
	if [ $$EXIT_CODE -eq 0 ]; then \
		echo "$(GREEN)✅ Backup completed successfully$(NC)"; \
		echo "$(BLUE)💡 Backup file saved to project directory$(NC)"; \
	else \
		echo "$(RED)❌ Backup failed with exit code $$EXIT_CODE$(NC)"; \
		exit $$EXIT_CODE; \
	fi

restore-gun-backup: ## Restore GUN records from backup file with proper format (use FILE=backup.json)
	@if [ -z "$(FILE)" ]; then \
		echo "$(RED)❌ FILE parameter required$(NC)"; \
		echo "$(YELLOW)Usage: make restore-gun-backup FILE=gun-backup-2025-11-14.json$(NC)"; \
		exit 1; \
	fi; \
	if [ ! -f "$(FILE)" ]; then \
		echo "$(RED)❌ Backup file not found: $(FILE)$(NC)"; \
		exit 1; \
	fi; \
	if [ ! -f scripts/restore-gun-backup.js ]; then \
		echo "$(RED)❌ Restore script not found: scripts/restore-gun-backup.js$(NC)"; \
		exit 1; \
	fi; \
	echo "$(BLUE)📦 Restoring GUN records from $(FILE) with proper data/oip stringification...$(NC)"; \
	CONTAINER_NAME=$$(docker ps --format "{{.Names}}" | grep -E "oip|fitnessally" | grep -v elasticsearch | grep -v kibana | grep -v ngrok | head -1); \
	if [ -z "$$CONTAINER_NAME" ]; then \
		echo "$(RED)❌ No OIP container found. Is the service running?$(NC)"; \
		exit 1; \
	fi; \
	echo "$(GREEN)✅ Found container: $$CONTAINER_NAME$(NC)"; \
	echo "$(BLUE)📂 Copying restore script to container...$(NC)"; \
	docker exec $$CONTAINER_NAME mkdir -p /usr/src/app/scripts; \
	docker cp scripts/restore-gun-backup.js $$CONTAINER_NAME:/usr/src/app/scripts/restore-gun-backup.js; \
	echo "$(BLUE)📂 Copying backup file to container...$(NC)"; \
	docker cp "$(FILE)" $$CONTAINER_NAME:/usr/src/app/backup-to-restore.json; \
	echo "$(BLUE)🚀 Running restore script...$(NC)"; \
	docker exec -w /usr/src/app $$CONTAINER_NAME node scripts/restore-gun-backup.js backup-to-restore.json; \
	EXIT_CODE=$$?; \
	echo "$(BLUE)🧹 Cleaning up...$(NC)"; \
	docker exec $$CONTAINER_NAME rm -f /usr/src/app/scripts/restore-gun-backup.js /usr/src/app/backup-to-restore.json; \
	if [ $$EXIT_CODE -eq 0 ]; then \
		echo "$(GREEN)✅ Restore completed successfully$(NC)"; \
		echo "$(YELLOW)💡 Records are now in GUN with proper format and registered for sync$(NC)"; \
	else \
		echo "$(RED)❌ Restore failed with exit code $$EXIT_CODE$(NC)"; \
		exit $$EXIT_CODE; \
	fi

restore-gun-records: ## Restore GUN records from backup file (use FILE=backup.json, REPUBLISH=true to also republish to GUN)
	@if [ -z "$(FILE)" ]; then \
		echo "$(RED)❌ FILE parameter required$(NC)"; \
		echo "$(YELLOW)Usage: make restore-gun-records FILE=gun-backup-2025-11-13.json$(NC)"; \
		echo "$(YELLOW)       make restore-gun-records FILE=gun-backup-2025-11-13.json REPUBLISH=true$(NC)"; \
		exit 1; \
	fi; \
	if [ ! -f "$(FILE)" ]; then \
		echo "$(RED)❌ Backup file not found: $(FILE)$(NC)"; \
		exit 1; \
	fi; \
	if [ ! -f scripts/restore-gun-records.js ]; then \
		echo "$(RED)❌ Restore script not found: scripts/restore-gun-records.js$(NC)"; \
		exit 1; \
	fi; \
	if [ "$(REPUBLISH)" = "true" ]; then \
		echo "$(BLUE)📦 Restoring GUN records from $(FILE) AND republishing to GUN network...$(NC)"; \
	else \
		echo "$(BLUE)📦 Restoring GUN records from $(FILE) to Elasticsearch only...$(NC)"; \
		echo "$(YELLOW)💡 To also republish to GUN network, add REPUBLISH=true$(NC)"; \
	fi; \
	CONTAINER_NAME=$$(docker ps --format "{{.Names}}" | grep -E "oip|fitnessally" | grep -v elasticsearch | grep -v kibana | grep -v ngrok | head -1); \
	if [ -z "$$CONTAINER_NAME" ]; then \
		echo "$(RED)❌ No OIP container found. Is the service running?$(NC)"; \
		exit 1; \
	fi; \
	echo "$(GREEN)✅ Found container: $$CONTAINER_NAME$(NC)"; \
	echo "$(BLUE)📂 Copying restore script to container...$(NC)"; \
	docker exec $$CONTAINER_NAME mkdir -p /usr/src/app/scripts; \
	docker cp scripts/restore-gun-records.js $$CONTAINER_NAME:/usr/src/app/scripts/restore-gun-records.js; \
	echo "$(BLUE)📂 Copying backup file to container...$(NC)"; \
	docker cp "$(FILE)" $$CONTAINER_NAME:/usr/src/app/backup-restore.json; \
	echo "$(BLUE)🚀 Running restore script...$(NC)"; \
	if [ "$(REPUBLISH)" = "true" ]; then \
		docker exec -w /usr/src/app -e REPUBLISH_TO_GUN=true $$CONTAINER_NAME node scripts/restore-gun-records.js backup-restore.json; \
	else \
		docker exec -w /usr/src/app $$CONTAINER_NAME node scripts/restore-gun-records.js backup-restore.json; \
	fi; \
	EXIT_CODE=$$?; \
	echo "$(BLUE)🧹 Cleaning up...$(NC)"; \
	docker exec $$CONTAINER_NAME rm -f /usr/src/app/scripts/restore-gun-records.js /usr/src/app/backup-restore.json; \
	if [ $$EXIT_CODE -eq 0 ]; then \
		echo "$(GREEN)✅ Restore completed successfully$(NC)"; \
	else \
		echo "$(RED)❌ Restore failed with exit code $$EXIT_CODE$(NC)"; \
		exit $$EXIT_CODE; \
	fi