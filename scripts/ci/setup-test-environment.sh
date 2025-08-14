#!/bin/bash

# ==============================================================================
# CI Test Environment Setup Script
# ==============================================================================
#
# Comprehensive environment preparation script for CI/CD testing pipeline.
# Sets up all necessary dependencies, configurations, and optimizations
# for running the complete LookCoin contract test suite.
#
# Features:
# - Environment validation and setup
# - Dependency optimization
# - Memory and performance tuning
# - Security configurations
# - Multi-platform support
# - Error handling and recovery
# - Detailed logging and monitoring
#
# Usage: ./scripts/ci/setup-test-environment.sh [options]
#
# ==============================================================================

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Script configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
readonly LOG_FILE="${PROJECT_ROOT}/setup-test-environment.log"
readonly TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# Color codes for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly MAGENTA='\033[0;35m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m' # No Color

# Configuration variables with defaults
VERBOSE=${VERBOSE:-false}
SKIP_DEPS=${SKIP_DEPS:-false}
OPTIMIZE_FOR_CI=${OPTIMIZE_FOR_CI:-true}
PARALLEL_JOBS=${PARALLEL_JOBS:-$(nproc 2>/dev/null || echo "2")}
MEMORY_LIMIT=${MEMORY_LIMIT:-"6144"}
ENABLE_COVERAGE=${ENABLE_COVERAGE:-true}
SECURITY_SCAN=${SECURITY_SCAN:-true}
PERFORMANCE_TESTS=${PERFORMANCE_TESTS:-true}

# System requirements
readonly MIN_NODE_VERSION="18"
readonly MIN_RAM_GB="4"
readonly MIN_DISK_GB="10"

# ==============================================================================
# Utility Functions
# ==============================================================================

log() {
    local level="$1"
    shift
    local message="$*"
    local color_code=""
    
    case "$level" in
        "INFO")  color_code="$BLUE" ;;
        "WARN")  color_code="$YELLOW" ;;
        "ERROR") color_code="$RED" ;;
        "SUCCESS") color_code="$GREEN" ;;
        "DEBUG") color_code="$CYAN" ;;
        *) color_code="$NC" ;;
    esac
    
    echo -e "${color_code}[$(date -u +"%H:%M:%S")] [$level] $message${NC}"
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [$level] $message" >> "$LOG_FILE"
}

debug() {
    if [[ "$VERBOSE" == "true" ]]; then
        log "DEBUG" "$@"
    fi
}

success() {
    log "SUCCESS" "$@"
}

warn() {
    log "WARN" "$@"
}

error() {
    log "ERROR" "$@"
}

info() {
    log "INFO" "$@"
}

# Error handler
handle_error() {
    local exit_code=$?
    local line_number=$1
    error "Script failed at line $line_number with exit code $exit_code"
    error "Check the log file: $LOG_FILE"
    
    # Attempt to provide helpful error context
    if command -v tail >/dev/null 2>&1; then
        echo -e "\n${RED}Last 10 log entries:${NC}"
        tail -n 10 "$LOG_FILE" 2>/dev/null || echo "Could not read log file"
    fi
    
    exit $exit_code
}

trap 'handle_error ${LINENO}' ERR

# ==============================================================================
# System Detection and Validation
# ==============================================================================

detect_system() {
    info "🔍 Detecting system configuration..."
    
    # Detect OS
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        export OS="linux"
        export PACKAGE_MANAGER=""
        
        if command -v apt-get >/dev/null 2>&1; then
            export PACKAGE_MANAGER="apt"
        elif command -v yum >/dev/null 2>&1; then
            export PACKAGE_MANAGER="yum"
        elif command -v pacman >/dev/null 2>&1; then
            export PACKAGE_MANAGER="pacman"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        export OS="macos"
        export PACKAGE_MANAGER="brew"
    else
        export OS="unknown"
        export PACKAGE_MANAGER="unknown"
    fi
    
    # Detect architecture
    export ARCH="$(uname -m)"
    
    # Detect CI environment
    if [[ -n "${CI:-}" || -n "${GITHUB_ACTIONS:-}" || -n "${JENKINS_URL:-}" ]]; then
        export IS_CI="true"
        export OPTIMIZE_FOR_CI="true"
    else
        export IS_CI="false"
    fi
    
    # Detect available resources
    export AVAILABLE_RAM_GB="$(free -g 2>/dev/null | awk '/^Mem:/{print $2}' || echo "8")"
    export AVAILABLE_DISK_GB="$(df -BG . 2>/dev/null | awk 'NR==2{gsub("G",""); print $4}' || echo "50")"
    
    debug "OS: $OS"
    debug "Package Manager: $PACKAGE_MANAGER"
    debug "Architecture: $ARCH"
    debug "CI Environment: $IS_CI"
    debug "Available RAM: ${AVAILABLE_RAM_GB}GB"
    debug "Available Disk: ${AVAILABLE_DISK_GB}GB"
}

validate_system_requirements() {
    info "✅ Validating system requirements..."
    
    local validation_failed=false
    
    # Check Node.js version
    if command -v node >/dev/null 2>&1; then
        local node_version
        node_version="$(node -v | sed 's/v//' | cut -d. -f1)"
        if [[ "$node_version" -lt "$MIN_NODE_VERSION" ]]; then
            error "Node.js version $node_version is below minimum required version $MIN_NODE_VERSION"
            validation_failed=true
        else
            success "Node.js version: $(node -v)"
        fi
    else
        error "Node.js is not installed"
        validation_failed=true
    fi
    
    # Check npm
    if command -v npm >/dev/null 2>&1; then
        success "npm version: $(npm -v)"
    else
        error "npm is not installed"
        validation_failed=true
    fi
    
    # Check memory requirements
    if [[ "$AVAILABLE_RAM_GB" -lt "$MIN_RAM_GB" ]]; then
        warn "Available RAM (${AVAILABLE_RAM_GB}GB) is below recommended minimum (${MIN_RAM_GB}GB)"
        warn "Some tests may fail due to memory constraints"
        
        # Adjust memory limit for low-memory systems
        if [[ "$AVAILABLE_RAM_GB" -le 2 ]]; then
            export MEMORY_LIMIT="2048"
            warn "Reducing Node.js memory limit to ${MEMORY_LIMIT}MB"
        elif [[ "$AVAILABLE_RAM_GB" -le 4 ]]; then
            export MEMORY_LIMIT="4096"
            warn "Reducing Node.js memory limit to ${MEMORY_LIMIT}MB"
        fi
    fi
    
    # Check disk space
    if [[ "$AVAILABLE_DISK_GB" -lt "$MIN_DISK_GB" ]]; then
        error "Available disk space (${AVAILABLE_DISK_GB}GB) is below minimum required (${MIN_DISK_GB}GB)"
        validation_failed=true
    fi
    
    # Check for required system tools
    local required_tools=("git" "curl" "tar" "gzip")
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            error "Required tool '$tool' is not installed"
            validation_failed=true
        fi
    done
    
    if [[ "$validation_failed" == "true" ]]; then
        error "System validation failed. Please address the above issues."
        exit 1
    fi
    
    success "System validation completed successfully"
}

# ==============================================================================
# Environment Setup
# ==============================================================================

setup_environment_variables() {
    info "🌍 Setting up environment variables..."
    
    # Node.js optimization
    export NODE_OPTIONS="--max-old-space-size=${MEMORY_LIMIT}"
    export NODE_ENV="${NODE_ENV:-test}"
    
    # Enable garbage collection optimization for tests
    export NODE_OPTIONS="$NODE_OPTIONS --expose-gc --optimize-for-size"
    
    # Hardhat/Ethereum configuration
    export HARDHAT_NETWORK="${HARDHAT_NETWORK:-hardhat}"
    export HARDHAT_VERBOSE="${HARDHAT_VERBOSE:-false}"
    export HARDHAT_MAX_MEMORY="${HARDHAT_MAX_MEMORY:-$MEMORY_LIMIT}"
    
    # Test configuration
    export DEBUG_MIGRATION_TESTS="${DEBUG_MIGRATION_TESTS:-false}"
    export RUN_GAS_BENCHMARKS="${RUN_GAS_BENCHMARKS:-$PERFORMANCE_TESTS}"
    export REPORT_GAS="${REPORT_GAS:-$PERFORMANCE_TESTS}"
    export ENABLE_SECURITY_TESTS="${ENABLE_SECURITY_TESTS:-$SECURITY_SCAN}"
    
    # CI-specific optimizations
    if [[ "$IS_CI" == "true" ]]; then
        export CI_OPTIMIZE="true"
        export HARDHAT_VERBOSE="false"
        export FORCE_COLOR="1"  # Ensure colored output in CI
        
        # GitHub Actions specific
        if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
            export GITHUB_TOKEN="${GITHUB_TOKEN:-}"
            export RUNNER_TEMP="${RUNNER_TEMP:-/tmp}"
        fi
    fi
    
    # Performance tuning
    export UV_THREADPOOL_SIZE="$PARALLEL_JOBS"
    export MAKEFLAGS="-j$PARALLEL_JOBS"
    
    # Coverage configuration
    if [[ "$ENABLE_COVERAGE" == "true" ]]; then
        export COVERAGE="true"
        export SOLIDITY_COVERAGE="true"
    fi
    
    debug "NODE_OPTIONS: $NODE_OPTIONS"
    debug "PARALLEL_JOBS: $PARALLEL_JOBS"
    debug "MEMORY_LIMIT: ${MEMORY_LIMIT}MB"
    
    success "Environment variables configured"
}

create_directories() {
    info "📁 Creating necessary directories..."
    
    local directories=(
        "reports"
        "reports/orchestration"
        "reports/coverage"
        "reports/security"
        "reports/performance"
        "reports/final"
        "cache"
        "artifacts"
        "typechain-types"
        "node_modules/.cache"
        "temp"
    )
    
    for dir in "${directories[@]}"; do
        local full_path="${PROJECT_ROOT}/$dir"
        if [[ ! -d "$full_path" ]]; then
            mkdir -p "$full_path"
            debug "Created directory: $dir"
        fi
    done
    
    success "Directories created successfully"
}

# ==============================================================================
# Dependencies and Tools
# ==============================================================================

install_system_dependencies() {
    if [[ "$SKIP_DEPS" == "true" ]]; then
        info "⏭️  Skipping system dependency installation"
        return 0
    fi
    
    info "📦 Installing system dependencies..."
    
    case "$PACKAGE_MANAGER" in
        "apt")
            sudo apt-get update -qq
            sudo apt-get install -y -qq \
                build-essential \
                python3 \
                python3-pip \
                libc6-dev \
                libudev-dev \
                libusb-1.0-0-dev
            ;;
        "yum")
            sudo yum update -y -q
            sudo yum groupinstall -y -q "Development Tools"
            sudo yum install -y -q python3 python3-pip libudev-devel libusb-devel
            ;;
        "brew")
            # macOS with Homebrew
            if ! command -v brew >/dev/null 2>&1; then
                warn "Homebrew not found. Please install it manually if needed."
            else
                brew update
                # Most dependencies should already be available on macOS
                if ! command -v python3 >/dev/null 2>&1; then
                    brew install python3
                fi
            fi
            ;;
        *)
            warn "Unknown package manager. Skipping system dependency installation."
            ;;
    esac
    
    success "System dependencies installed"
}

optimize_npm_configuration() {
    info "⚡ Optimizing npm configuration..."
    
    # Set npm configuration for better CI performance
    npm config set audit-level moderate
    npm config set fund false
    npm config set update-notifier false
    npm config set progress false
    
    # Increase network timeout for slower connections
    npm config set network-timeout 300000
    
    # Enable parallel installations if supported
    if npm --version | grep -qE '^[7-9]|^[1-9][0-9]'; then
        npm config set maxsockets "$PARALLEL_JOBS"
    fi
    
    # CI-specific optimizations
    if [[ "$IS_CI" == "true" ]]; then
        npm config set cache "${PROJECT_ROOT}/node_modules/.cache/npm"
        npm config set prefer-offline true
        npm config set no-audit true
    fi
    
    success "npm configuration optimized"
}

install_node_dependencies() {
    info "📦 Installing Node.js dependencies..."
    
    cd "$PROJECT_ROOT"
    
    # Use npm ci for faster, reproducible installs in CI
    if [[ "$IS_CI" == "true" && -f "package-lock.json" ]]; then
        info "Using npm ci for reproducible installation..."
        npm ci --no-audit --no-fund --silent
    else
        info "Using npm install..."
        npm install --no-audit --no-fund --silent
    fi
    
    # Verify critical dependencies are installed
    local critical_deps=("hardhat" "ethers" "@openzeppelin/contracts" "chai")
    for dep in "${critical_deps[@]}"; do
        if ! npm list "$dep" >/dev/null 2>&1; then
            error "Critical dependency '$dep' is not installed"
            exit 1
        fi
    done
    
    success "Node.js dependencies installed successfully"
}

install_additional_tools() {
    info "🔧 Installing additional testing tools..."
    
    # Install Foundry for Solidity testing if not present and needed
    if [[ "$PERFORMANCE_TESTS" == "true" ]]; then
        if ! command -v forge >/dev/null 2>&1; then
            info "Installing Foundry..."
            curl -L https://foundry.paradigm.xyz | bash
            export PATH="$HOME/.foundry/bin:$PATH"
            foundryup
        else
            debug "Foundry already installed: $(forge --version)"
        fi
    fi
    
    # Install Slither for security analysis if not present and needed
    if [[ "$SECURITY_SCAN" == "true" ]]; then
        if ! command -v slither >/dev/null 2>&1; then
            info "Installing Slither..."
            if command -v python3 >/dev/null 2>&1 && command -v pip3 >/dev/null 2>&1; then
                pip3 install slither-analyzer --user
                export PATH="$HOME/.local/bin:$PATH"
            else
                warn "Cannot install Slither: Python3 and pip3 are required"
            fi
        else
            debug "Slither already installed: $(slither --version)"
        fi
    fi
    
    success "Additional tools installation completed"
}

# ==============================================================================
# Project Configuration
# ==============================================================================

setup_hardhat_configuration() {
    info "⚙️  Configuring Hardhat for testing..."
    
    cd "$PROJECT_ROOT"
    
    # Verify Hardhat configuration exists
    if [[ ! -f "hardhat.config.ts" ]]; then
        error "hardhat.config.ts not found in project root"
        exit 1
    fi
    
    # Create a test-specific Hardhat config if needed
    if [[ "$IS_CI" == "true" ]]; then
        local test_config="${PROJECT_ROOT}/hardhat.test.config.js"
        cat > "$test_config" << EOF
// Test-specific Hardhat configuration for CI
const config = require('./hardhat.config.ts');

// Override settings for CI testing
config.mocha = {
  timeout: 300000, // 5 minutes
  reporter: 'spec',
  bail: false,
  parallel: false, // Disable parallel for stability
};

config.networks.hardhat.allowUnlimitedContractSize = true;
config.networks.hardhat.accounts = {
  count: 20, // More test accounts
  accountsBalance: '1000000000000000000000000', // 1M ETH per account
};

// Enable gas reporting in CI
config.gasReporter = {
  enabled: process.env.REPORT_GAS !== undefined,
  currency: 'USD',
  outputFile: 'reports/gas-report.txt',
  noColors: true,
};

module.exports = config;
EOF
        export HARDHAT_CONFIG="$test_config"
        debug "Created test-specific Hardhat config"
    fi
    
    success "Hardhat configuration completed"
}

compile_contracts() {
    info "🔨 Compiling smart contracts..."
    
    cd "$PROJECT_ROOT"
    
    # Clear previous compilation artifacts
    if [[ -d "artifacts" ]]; then
        rm -rf artifacts
    fi
    if [[ -d "cache" ]]; then
        rm -rf cache/
    fi
    if [[ -d "typechain-types" ]]; then
        rm -rf typechain-types
    fi
    
    # Compile contracts
    npm run compile
    
    # Verify compilation artifacts
    if [[ ! -d "artifacts" || ! -d "typechain-types" ]]; then
        error "Contract compilation failed - missing artifacts"
        exit 1
    fi
    
    # Count compiled contracts
    local contract_count
    contract_count="$(find artifacts/contracts -name "*.json" | grep -v ".dbg.json" | wc -l)"
    info "Successfully compiled $contract_count contracts"
    
    success "Contract compilation completed"
}

# ==============================================================================
# Performance Optimization
# ==============================================================================

optimize_for_testing() {
    info "🚀 Applying testing optimizations..."
    
    # Set up parallel processing if supported
    if [[ "$PARALLEL_JOBS" -gt 1 ]]; then
        export MOCHA_PARALLEL="true"
        debug "Enabled parallel processing with $PARALLEL_JOBS jobs"
    fi
    
    # Memory optimization
    export NODE_OPTIONS="$NODE_OPTIONS --max_old_space_size=$MEMORY_LIMIT"
    
    # Enable experimental features for better performance
    export NODE_OPTIONS="$NODE_OPTIONS --experimental-vm-modules --experimental-json-modules"
    
    # Optimize V8 garbage collection
    export NODE_OPTIONS="$NODE_OPTIONS --gc-interval=100"
    
    # Set up temp directory with sufficient space
    local temp_dir="${PROJECT_ROOT}/temp"
    export TMPDIR="$temp_dir"
    export TMP="$temp_dir"
    export TEMP="$temp_dir"
    
    success "Testing optimizations applied"
}

setup_monitoring() {
    info "📊 Setting up test monitoring..."
    
    # Create monitoring script
    cat > "${PROJECT_ROOT}/monitor-tests.sh" << 'EOF'
#!/bin/bash
# Test monitoring helper script
export MONITOR_MEMORY=true
export MONITOR_PERFORMANCE=true

# Monitor memory usage during tests
monitor_memory() {
    while true; do
        ps aux | grep -E "(node|hardhat)" | grep -v grep >> memory-usage.log
        sleep 10
    done
}

# Start monitoring if requested
if [[ "${MONITOR_MEMORY:-}" == "true" ]]; then
    monitor_memory &
    echo $! > monitor.pid
fi
EOF
    chmod +x "${PROJECT_ROOT}/monitor-tests.sh"
    
    success "Test monitoring configured"
}

# ==============================================================================
# Validation and Health Checks
# ==============================================================================

run_health_checks() {
    info "🏥 Running environment health checks..."
    
    local health_check_failed=false
    
    # Check Node.js and npm
    if ! node --version >/dev/null 2>&1; then
        error "Node.js health check failed"
        health_check_failed=true
    fi
    
    if ! npm --version >/dev/null 2>&1; then
        error "npm health check failed"
        health_check_failed=true
    fi
    
    # Check Hardhat
    cd "$PROJECT_ROOT"
    if ! npx hardhat --version >/dev/null 2>&1; then
        error "Hardhat health check failed"
        health_check_failed=true
    fi
    
    # Check contract compilation
    if [[ ! -d "artifacts" || ! -d "typechain-types" ]]; then
        error "Contract artifacts health check failed"
        health_check_failed=true
    fi
    
    # Check memory availability
    local available_memory_mb
    available_memory_mb="$(free -m 2>/dev/null | awk '/^Mem:/{print $7}' || echo "2048")"
    if [[ "$available_memory_mb" -lt 1024 ]]; then
        warn "Low memory detected: ${available_memory_mb}MB available"
        warn "Some tests may fail due to memory constraints"
    fi
    
    # Test basic contract interaction
    info "Testing basic contract compilation..."
    if ! timeout 60 npx hardhat compile >/dev/null 2>&1; then
        error "Basic contract compilation test failed"
        health_check_failed=true
    fi
    
    if [[ "$health_check_failed" == "true" ]]; then
        error "Health checks failed. Environment is not ready for testing."
        exit 1
    fi
    
    success "All health checks passed"
}

generate_environment_report() {
    info "📋 Generating environment report..."
    
    local report_file="${PROJECT_ROOT}/reports/environment-report.json"
    
    cat > "$report_file" << EOF
{
    "timestamp": "$TIMESTAMP",
    "system": {
        "os": "$OS",
        "arch": "$ARCH",
        "package_manager": "$PACKAGE_MANAGER",
        "is_ci": "$IS_CI",
        "available_ram_gb": "$AVAILABLE_RAM_GB",
        "available_disk_gb": "$AVAILABLE_DISK_GB"
    },
    "node": {
        "version": "$(node --version)",
        "memory_limit_mb": "$MEMORY_LIMIT",
        "parallel_jobs": "$PARALLEL_JOBS"
    },
    "npm": {
        "version": "$(npm --version)"
    },
    "configuration": {
        "verbose": "$VERBOSE",
        "skip_deps": "$SKIP_DEPS",
        "enable_coverage": "$ENABLE_COVERAGE",
        "security_scan": "$SECURITY_SCAN",
        "performance_tests": "$PERFORMANCE_TESTS"
    },
    "hardhat": {
        "version": "$(cd "$PROJECT_ROOT" && npx hardhat --version | head -n1 || echo 'unknown')"
    },
    "tools": {
        "foundry_available": "$(command -v forge >/dev/null 2>&1 && echo 'true' || echo 'false')",
        "slither_available": "$(command -v slither >/dev/null 2>&1 && echo 'true' || echo 'false')"
    }
}
EOF
    
    success "Environment report saved to: $report_file"
}

# ==============================================================================
# Main Execution
# ==============================================================================

show_help() {
    cat << EOF
CI Test Environment Setup Script

Usage: $0 [OPTIONS]

OPTIONS:
    -v, --verbose           Enable verbose output
    -s, --skip-deps         Skip system dependency installation
    --no-optimize          Disable CI optimizations
    --parallel-jobs N      Set number of parallel jobs (default: CPU cores)
    --memory-limit N       Set Node.js memory limit in MB (default: 6144)
    --no-coverage          Disable coverage collection
    --no-security          Disable security scanning
    --no-performance       Disable performance tests
    -h, --help             Show this help message

ENVIRONMENT VARIABLES:
    VERBOSE               Enable verbose output (true/false)
    SKIP_DEPS            Skip dependency installation (true/false)
    OPTIMIZE_FOR_CI      Enable CI optimizations (true/false)
    PARALLEL_JOBS        Number of parallel jobs
    MEMORY_LIMIT         Node.js memory limit in MB
    ENABLE_COVERAGE      Enable coverage collection (true/false)
    SECURITY_SCAN        Enable security scanning (true/false)
    PERFORMANCE_TESTS    Enable performance tests (true/false)

EXAMPLES:
    # Basic setup
    $0

    # Verbose setup with custom memory limit
    $0 --verbose --memory-limit 8192

    # CI setup without system dependencies
    $0 --skip-deps --no-performance

    # Development setup with all features
    $0 --verbose --parallel-jobs 4
EOF
}

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -s|--skip-deps)
                SKIP_DEPS=true
                shift
                ;;
            --no-optimize)
                OPTIMIZE_FOR_CI=false
                shift
                ;;
            --parallel-jobs)
                PARALLEL_JOBS="$2"
                shift 2
                ;;
            --memory-limit)
                MEMORY_LIMIT="$2"
                shift 2
                ;;
            --no-coverage)
                ENABLE_COVERAGE=false
                shift
                ;;
            --no-security)
                SECURITY_SCAN=false
                shift
                ;;
            --no-performance)
                PERFORMANCE_TESTS=false
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

main() {
    # Initialize log file
    echo "=== CI Test Environment Setup - $TIMESTAMP ===" > "$LOG_FILE"
    
    info "🚀 Starting CI Test Environment Setup..."
    info "Project: LookCoin Contract Test Suite"
    info "Timestamp: $TIMESTAMP"
    info "Log file: $LOG_FILE"
    
    # Parse command line arguments
    parse_arguments "$@"
    
    # Main setup sequence
    detect_system
    validate_system_requirements
    setup_environment_variables
    create_directories
    
    install_system_dependencies
    optimize_npm_configuration
    install_node_dependencies
    install_additional_tools
    
    setup_hardhat_configuration
    compile_contracts
    
    optimize_for_testing
    setup_monitoring
    
    run_health_checks
    generate_environment_report
    
    success "🎉 CI Test Environment Setup completed successfully!"
    info "Environment is ready for comprehensive testing"
    info "Run tests with: npm test"
    info "Run orchestrated tests with: tsx scripts/test/test-orchestrator.ts"
    
    # Display summary
    echo
    echo "=== SETUP SUMMARY ==="
    echo "Node.js: $(node --version)"
    echo "npm: $(npm --version)"
    echo "Memory Limit: ${MEMORY_LIMIT}MB"
    echo "Parallel Jobs: $PARALLEL_JOBS"
    echo "Coverage Enabled: $ENABLE_COVERAGE"
    echo "Security Scan: $SECURITY_SCAN"
    echo "Performance Tests: $PERFORMANCE_TESTS"
    echo "CI Optimizations: $OPTIMIZE_FOR_CI"
    echo "===================="
    
    # Set exit code for CI systems
    if [[ "$IS_CI" == "true" ]]; then
        echo "::set-output name=setup_status::success"
        echo "::set-output name=node_version::$(node --version)"
        echo "::set-output name=memory_limit::${MEMORY_LIMIT}"
    fi
}

# Execute main function with all arguments
main "$@"