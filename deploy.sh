#!/bin/bash

# OIP Arweave Deployment Script
# Easily switch between different deployment configurations

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "OIP Arweave Deployment Script"
    echo ""
    echo "Usage: $0 [COMMAND] [PROFILE]"
    echo ""
    echo "Commands:"
    echo "  up      - Start services"
    echo "  down    - Stop services"
    echo "  build   - Build and start services"
    echo "  logs    - Show logs"
    echo "  status  - Show service status"
    echo "  help    - Show this help message"
    echo ""
    echo "Profiles:"
    echo "  minimal              - Core only: elasticsearch, kibana, oip (no extra services, no canvas - fastest build)"
    echo "  minimal-with-scrape  - Core + scraping: elasticsearch, kibana, oip with canvas support"
    echo "  standard             - Distributed: Full stack with AI chat (elasticsearch, kibana, ipfs, oip, speech-synthesizer, ngrok, ollama, text-generator)"
    echo "  standard-monolithic  - Monolithic: Core services in one container (lacks modern AI, uses Dockerfile-full)"
    echo "  gpu                  - GPU-optimized OIP + text-generator (connects to external network)"
    echo "  oip-gpu-only         - Only GPU-optimized OIP service (minimal, for existing stacks)"
    echo "  standard-gpu         - Complete stack with GPU acceleration"
    echo ""
    echo "Examples:"
    echo "  $0 up minimal           # Start core services only (elasticsearch, kibana, oip - no canvas)"
    echo "  $0 up minimal-with-scrape # Start core services + scraping (elasticsearch, kibana, oip + canvas)"
    echo "  $0 up standard          # Start full stack on standard machine"
    echo "  $0 up gpu               # Start GPU-optimized deployment"
    echo "  $0 build gpu-only       # Build and start minimal GPU service only"
    echo "  $0 down                 # Stop all services"
    echo "  $0 logs oip-gpu         # Show logs for GPU OIP service"
}

# Function to check if .env file exists
check_env_file() {
    if [ ! -f .env ]; then
        print_error ".env file not found!"
        print_warning "Please copy 'example env' to '.env' and configure it manually"
        print_info "Command: cp \"example env\" .env"
        print_error "Deployment cancelled to protect your configuration"
        exit 1
    else
        print_success "Found .env file - using your configuration"
    fi
}

# Function to validate profile
validate_profile() {
    local profile=$1
    case $profile in
        minimal|minimal-with-scrape|standard|standard-monolithic|gpu|oip-gpu-only|standard-gpu)
            return 0
            ;;
        *)
            print_error "Invalid profile: $profile"
            show_usage
            exit 1
            ;;
    esac
}

# Function to start services
start_services() {
    local profile=${1:-standard}
    validate_profile $profile
    check_env_file
    
    print_info "Starting OIP Arweave with profile: $profile"
    
    # Special handling for GPU profiles that need external network
    if [[ "$profile" == "gpu" || "$profile" == "oip-gpu-only" ]]; then
        print_info "Checking for external network 'oiparweave_oip-network'..."
        if ! docker network inspect oiparweave_oip-network >/dev/null 2>&1; then
            print_warning "External network 'oiparweave_oip-network' not found."
            print_info "Creating network..."
            docker network create oiparweave_oip-network
        fi
    fi
    
    docker-compose --profile $profile up -d
    print_success "Services started with profile: $profile"
    
    # Show running services
    print_info "Running services:"
    docker-compose ps
}

# Function to build and start services
build_services() {
    local profile=${1:-standard}
    validate_profile $profile
    check_env_file
    
    print_info "Building and starting OIP Arweave with profile: $profile"
    
    # Special handling for GPU profiles that need external network
    if [[ "$profile" == "gpu" || "$profile" == "oip-gpu-only" ]]; then
        print_info "Checking for external network 'oiparweave_oip-network'..."
        if ! docker network inspect oiparweave_oip-network >/dev/null 2>&1; then
            print_warning "External network 'oiparweave_oip-network' not found."
            print_info "Creating network..."
            docker network create oiparweave_oip-network
        fi
    fi
    
    docker-compose --profile $profile up -d --build
    print_success "Services built and started with profile: $profile"
    
    # Show running services
    print_info "Running services:"
    docker-compose ps
}

# Function to stop services
stop_services() {
    print_info "Stopping all OIP Arweave services..."
    docker-compose down
    print_success "All services stopped"
}

# Function to show logs
show_logs() {
    local service=$1
    if [ -n "$service" ]; then
        print_info "Showing logs for service: $service"
        docker-compose logs -f $service
    else
        print_info "Showing logs for all services"
        docker-compose logs -f
    fi
}

# Function to show status
show_status() {
    print_info "Service status:"
    docker-compose ps
    echo ""
    print_info "Network information:"
    docker network ls | grep oip || echo "No OIP networks found"
}

# Main script logic
case "${1:-help}" in
    up)
        start_services $2
        ;;
    build)
        build_services $2
        ;;
    down)
        stop_services
        ;;
    logs)
        show_logs $2
        ;;
    status)
        show_status
        ;;
    help|--help|-h)
        show_usage
        ;;
    *)
        print_error "Unknown command: $1"
        show_usage
        exit 1
        ;;
esac 