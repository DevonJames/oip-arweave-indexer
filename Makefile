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
	@echo "  make install-models            # Install LLM models only (if already running)"
	@echo "  make install-chatterbox        # Install/update Chatterbox TTS model"
	@echo "  make status                    # Check service status"
	@echo "  make logs SERVICE=chatterbox-tts # View Chatterbox TTS logs"
	@echo ""
	@echo "$(YELLOW)ngrok Integration:$(NC)"
	@echo "  🌐 API available at: $(GREEN)https://api.oip.onl$(NC)"
	@echo "  🔧 Requires ~/.ngrok.yml configuration (see setup below)"

# Default profile - now uses Chatterbox as primary TTS
PROFILE ?= standard

# Check if ngrok is available and configured
check-ngrok:
	@if ! command -v ngrok >/dev/null 2>&1; then \
		echo "$(YELLOW)⚠️  ngrok not installed. Install with:$(NC)"; \
		echo "   $(BLUE)# macOS$(NC)"; \
		echo "   brew install ngrok"; \
		echo "   $(BLUE)# Linux$(NC)"; \
		echo "   curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo 'deb https://ngrok-agent.s3.amazonaws.com buster main' | sudo tee /etc/apt/sources.list.d/ngrok.list && sudo apt update && sudo apt install ngrok"; \
		echo ""; \
		echo "$(YELLOW)Then configure ~/.ngrok.yml:$(NC)"; \
		echo "$(BLUE)version: \"2\"$(NC)"; \
		echo "$(BLUE)authtoken: YOUR_NGROK_AUTHTOKEN_HERE$(NC)"; \
		echo ""; \
		echo "$(BLUE)tunnels:$(NC)"; \
		echo "$(BLUE)  oip-api:$(NC)"; \
		echo "$(BLUE)    proto: http$(NC)"; \
		echo "$(BLUE)    addr: 8000$(NC)"; \
		echo "$(BLUE)    domain: api.oip.onl$(NC)"; \
		echo ""; \
		echo "$(GREEN)Get your authtoken from: https://dashboard.ngrok.com/get-started/your-authtoken$(NC)"; \
		exit 1; \
	fi
	@if [ ! -f ~/.ngrok.yml ]; then \
		echo "$(YELLOW)⚠️  ~/.ngrok.yml not found. Creating template...$(NC)"; \
		echo "version: \"2\"" > ~/.ngrok.yml; \
		echo "authtoken: YOUR_NGROK_AUTHTOKEN_HERE" >> ~/.ngrok.yml; \
		echo "" >> ~/.ngrok.yml; \
		echo "tunnels:" >> ~/.ngrok.yml; \
		echo "  oip-api:" >> ~/.ngrok.yml; \
		echo "    proto: http" >> ~/.ngrok.yml; \
		echo "    addr: 8000" >> ~/.ngrok.yml; \
		echo "    domain: api.oip.onl" >> ~/.ngrok.yml; \
		echo ""; \
		echo "$(GREEN)✅ Template created at ~/.ngrok.yml$(NC)"; \
		echo "$(YELLOW)⚠️  Please edit ~/.ngrok.yml and add your ngrok authtoken$(NC)"; \
		echo "$(GREEN)Get your authtoken from: https://dashboard.ngrok.com/get-started/your-authtoken$(NC)"; \
		exit 1; \
	fi
	@if grep -q "YOUR_NGROK_AUTHTOKEN_HERE" ~/.ngrok.yml; then \
		echo "$(RED)❌ Please update your authtoken in ~/.ngrok.yml$(NC)"; \
		echo "$(GREEN)Get your authtoken from: https://dashboard.ngrok.com/get-started/your-authtoken$(NC)"; \
		exit 1; \
	fi

# Start ngrok tunnel
start-ngrok: check-ngrok
	@if ! pgrep -f "ngrok start" > /dev/null; then \
		echo "$(BLUE)🔗 Starting ngrok tunnel for api.oip.onl...$(NC)"; \
		(ngrok start oip-api --config ~/.ngrok.yml > /dev/null 2>&1 &); \
		sleep 3; \
		if pgrep -f "ngrok start" > /dev/null; then \
			echo "$(GREEN)🔗 ngrok: ✅ API available at https://api.oip.onl$(NC)"; \
		else \
			echo "$(RED)❌ ngrok failed to start. Check your configuration.$(NC)"; \
			exit 1; \
		fi; \
	else \
		echo "$(GREEN)🔗 ngrok: ✅ Already running$(NC)"; \
	fi

# Stop ngrok
stop-ngrok:
	@if pgrep -f "ngrok start" > /dev/null; then \
		echo "$(BLUE)🛑 Stopping ngrok tunnel...$(NC)"; \
		pkill -f "ngrok start" || true; \
		sleep 1; \
		echo "$(GREEN)🔗 ngrok stopped$(NC)"; \
	else \
		echo "$(YELLOW)🔗 ngrok: not running$(NC)"; \
	fi

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

up: validate-profile check-env check-network start-ngrok ## Start services with specified profile + ngrok
	@echo "$(BLUE)Starting OIP Arweave with profile: $(PROFILE)$(NC)"
	@if [ "$(PROFILE)" = "chatterbox" ] || [ "$(PROFILE)" = "chatterbox-gpu" ]; then \
		echo "$(YELLOW)🎭 Deploying with Chatterbox TTS as primary voice engine...$(NC)"; \
	fi
	docker-compose --profile $(PROFILE) up -d
	@echo "$(GREEN)Services started successfully$(NC)"
	@make status

build: validate-profile check-env check-network start-ngrok ## Build and start services with specified profile + ngrok
	@echo "$(BLUE)Building and starting OIP Arweave with profile: $(PROFILE)$(NC)"
	@if [ "$(PROFILE)" = "chatterbox" ] || [ "$(PROFILE)" = "chatterbox-gpu" ]; then \
		echo "$(YELLOW)🎭 Building with Chatterbox TTS integration...$(NC)"; \
	fi
	docker-compose --profile $(PROFILE) up -d --build
	@echo "$(GREEN)Services built and started successfully$(NC)"
	@make status

rebuild: validate-profile check-env check-network start-ngrok ## Rebuild and start services with --no-cache and specified profile + ngrok
	@echo "$(BLUE)Rebuilding OIP Arweave with --no-cache and profile: $(PROFILE)$(NC)"
	@if [ "$(PROFILE)" = "chatterbox" ] || [ "$(PROFILE)" = "chatterbox-gpu" ]; then \
		echo "$(YELLOW)🎭 Rebuilding with Chatterbox TTS from scratch...$(NC)"; \
	fi
	docker-compose --profile $(PROFILE) build --no-cache
	docker-compose --profile $(PROFILE) up -d
	@echo "$(GREEN)Services rebuilt and started successfully$(NC)"
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
	@if pgrep -f "ngrok start" > /dev/null; then \
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

# Quick deployment targets for common scenarios
minimal: ## Quick deploy: Core services only (elasticsearch, kibana, oip - no canvas) + ngrok
	@make up PROFILE=minimal

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
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-standard-monolithic: ## Quick rebuild: Monolithic (all services in one container + separate AI services) + ngrok
	@make rebuild PROFILE=standard-monolithic
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-gpu: ## Quick rebuild: GPU-optimized deployment with Chatterbox TTS + ngrok
	@make rebuild PROFILE=gpu
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-oip-gpu-only: ## Quick rebuild: GPU OIP service only + ngrok
	@make rebuild PROFILE=oip-gpu-only

rebuild-standard-gpu: ## Quick rebuild: Complete stack with GPU acceleration + Chatterbox TTS + install models + ngrok
	@make rebuild PROFILE=standard-gpu
	@echo "$(YELLOW)🤖 Installing LLM models automatically...$(NC)"
	@make install-models
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-chatterbox: ## Quick rebuild: Standard deployment with Chatterbox TTS focus (CPU) + ngrok
	@make rebuild PROFILE=chatterbox
	@echo "$(YELLOW)🎭 Installing Chatterbox TTS model...$(NC)"
	@make install-chatterbox

rebuild-chatterbox-gpu: ## Quick rebuild: Chatterbox TTS with GPU acceleration (RTX 4090 optimized) + ngrok
	@make rebuild PROFILE=chatterbox-gpu
	@echo "$(YELLOW)🎭 Installing GPU-optimized Chatterbox TTS model...$(NC)"
	@make install-chatterbox

# LLM Model Management
install-models: ## Install LLM models using Ollama
	@echo "$(BLUE)Installing LLM models for AI Chat...$(NC)"
	@chmod +x ./install_llm_models.sh
	@./install_llm_models.sh

# Chatterbox TTS Model Management
install-chatterbox: ## Install/update Chatterbox TTS model (Resemble AI)
	@echo "$(BLUE)Installing Chatterbox TTS model from Resemble AI...$(NC)"
	@TTS_FOUND=false; \
	if docker-compose ps | grep -q chatterbox-tts; then \
		echo "$(YELLOW)Installing Chatterbox model in dedicated chatterbox-tts container...$(NC)"; \
		docker-compose exec chatterbox-tts python -c "from chatterbox.tts import ChatterboxTTS; model = ChatterboxTTS.from_pretrained(device='cuda' if __import__('torch').cuda.is_available() else 'cpu'); print('✅ Chatterbox TTS model installed successfully!')"; \
		TTS_FOUND=true; \
	elif docker-compose ps | grep -q tts-service; then \
		echo "$(YELLOW)Installing Chatterbox model in tts-service container...$(NC)"; \
		docker-compose exec tts-service python -c "from chatterbox.tts import ChatterboxTTS; model = ChatterboxTTS.from_pretrained(device='cuda' if __import__('torch').cuda.is_available() else 'cpu'); print('✅ Chatterbox TTS model installed successfully!')"; \
		TTS_FOUND=true; \
	elif docker-compose ps | grep -q oip; then \
		echo "$(YELLOW)Installing Chatterbox model in main OIP container...$(NC)"; \
		docker-compose exec oip bash -c "pip install chatterbox-tts && python -c \"from chatterbox.tts import ChatterboxTTS; model = ChatterboxTTS.from_pretrained(device='cuda' if __import__('torch').cuda.is_available() else 'cpu'); print('✅ Chatterbox TTS model installed successfully in OIP container!')\""; \
		TTS_FOUND=true; \
	elif docker-compose ps | grep -q oip-gpu; then \
		echo "$(YELLOW)Installing Chatterbox model in GPU OIP container...$(NC)"; \
		docker-compose exec oip-gpu bash -c "pip install chatterbox-tts && python -c \"from chatterbox.tts import ChatterboxTTS; model = ChatterboxTTS.from_pretrained(device='cuda' if __import__('torch').cuda.is_available() else 'cpu'); print('✅ Chatterbox TTS model installed successfully in GPU OIP container!')\""; \
		TTS_FOUND=true; \
	fi; \
	if [ "$$TTS_FOUND" = "false" ]; then \
		echo "$(RED)No suitable container found for Chatterbox TTS installation.$(NC)"; \
		echo "$(YELLOW)Available containers:$(NC)"; \
		docker-compose ps --format "table {{.Service}}\t{{.State}}"; \
		echo "$(YELLOW)Try starting services first with 'make standard' or 'make chatterbox'$(NC)"; \
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
	@if pgrep -f "ngrok start" > /dev/null; then \
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
		docker-compose ps --format "table {{.Service}}\t{{.State}}"; \
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
		docker-compose ps --format "table {{.Service}}\t{{.State}}"; \
	fi 