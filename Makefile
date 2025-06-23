# OIP Arweave Makefile
# Alternative interface for managing Docker deployments

.PHONY: help up down build logs status clean
.DEFAULT_GOAL := help

# Colors
GREEN := \033[0;32m
YELLOW := \033[1;33m
BLUE := \033[0;34m
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
	@echo "  $(GREEN)minimal$(NC)     - Core only: elasticsearch, kibana, oip"
	@echo "  $(GREEN)standard$(NC)    - Distributed: Full stack (default)"
	@echo "  $(GREEN)full$(NC)        - Monolithic: All services in one container"
	@echo "  $(GREEN)gpu$(NC)         - GPU-optimized deployment"
	@echo "  $(GREEN)gpu-only$(NC)    - Only GPU OIP service"
	@echo "  $(GREEN)full-gpu$(NC)    - Full distributed stack with GPU features"
	@echo ""
	@echo "$(YELLOW)Examples:$(NC)"
	@echo "  make up PROFILE=minimal"
	@echo "  make up PROFILE=standard"
	@echo "  make build PROFILE=gpu"
	@echo "  make logs SERVICE=oip-gpu"

# Default profile
PROFILE ?= standard

# Validate profile
validate-profile:
	@case "$(PROFILE)" in \
		minimal|standard|full|gpu|gpu-only|full-gpu) ;; \
		*) echo "$(RED)Error: Invalid profile '$(PROFILE)'. Use: minimal, standard, full, gpu, gpu-only, or full-gpu$(NC)"; exit 1 ;; \
	esac

# Check if .env file exists
check-env:
	@if [ ! -f .env ]; then \
		echo "$(YELLOW)Warning: .env file not found$(NC)"; \
		if [ -f "example env" ]; then \
			cp "example env" .env; \
			echo "$(BLUE)Copied example env to .env - please edit with your configuration$(NC)"; \
		else \
			echo "$(RED)Error: No example env file found. Please create .env manually$(NC)"; \
			exit 1; \
		fi \
	fi

# Ensure network exists for GPU profiles
check-network:
	@if echo "$(PROFILE)" | grep -q "gpu"; then \
		if ! docker network inspect oiparweave_oip-network >/dev/null 2>&1; then \
			echo "$(BLUE)Creating external network 'oiparweave_oip-network'...$(NC)"; \
			docker network create oiparweave_oip-network; \
		fi \
	fi

up: validate-profile check-env check-network ## Start services with specified profile
	@echo "$(BLUE)Starting OIP Arweave with profile: $(PROFILE)$(NC)"
	docker-compose --profile $(PROFILE) up -d
	@echo "$(GREEN)Services started successfully$(NC)"
	@make status

build: validate-profile check-env check-network ## Build and start services with specified profile
	@echo "$(BLUE)Building and starting OIP Arweave with profile: $(PROFILE)$(NC)"
	docker-compose --profile $(PROFILE) up -d --build
	@echo "$(GREEN)Services built and started successfully$(NC)"
	@make status

rebuild: validate-profile check-env check-network ## Rebuild and start services with --no-cache and specified profile
	@echo "$(BLUE)Rebuilding OIP Arweave with --no-cache and profile: $(PROFILE)$(NC)"
	docker-compose --profile $(PROFILE) build --no-cache
	docker-compose --profile $(PROFILE) up -d
	@echo "$(GREEN)Services rebuilt and started successfully$(NC)"
	@make status

down: ## Stop all services
	@echo "$(BLUE)Stopping all OIP Arweave services...$(NC)"
	docker-compose down
	@echo "$(GREEN)All services stopped$(NC)"

restart: validate-profile ## Restart services with specified profile
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

status: ## Show service status
	@echo "$(BLUE)Service Status:$(NC)"
	@docker-compose ps || echo "No services running"
	@echo ""
	@echo "$(BLUE)Networks:$(NC)"
	@docker network ls | grep oip || echo "No OIP networks found"

clean: ## Stop services and remove containers, networks, volumes
	@echo "$(YELLOW)Warning: This will remove all containers, networks, and volumes$(NC)"
	@echo "$(YELLOW)Press Ctrl+C to cancel, or wait 5 seconds to continue...$(NC)"
	@sleep 5
	docker-compose down -v --remove-orphans
	@echo "$(GREEN)Cleanup completed$(NC)"

# Quick deployment targets for common scenarios
minimal: ## Quick deploy: Core services only (elasticsearch, kibana, oip)
	@make up PROFILE=minimal

standard: ## Quick deploy: Distributed full stack
	@make up PROFILE=standard

full: ## Quick deploy: Monolithic (all services in one container)
	@make up PROFILE=full

gpu: ## Quick deploy: GPU-optimized deployment
	@make up PROFILE=gpu

gpu-only: ## Quick deploy: GPU OIP service only
	@make up PROFILE=gpu-only

full-gpu: ## Quick deploy: Distributed stack with GPU features
	@make up PROFILE=full-gpu

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

dev-logs-oip: ## Development: Show only OIP logs
	@if docker-compose ps | grep -q oip-gpu; then \
		docker-compose logs -f oip-gpu; \
	else \
		docker-compose logs -f oip; \
	fi 