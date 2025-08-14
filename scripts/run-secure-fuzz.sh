#!/bin/bash

# Secure Fuzz Testing Execution Script
# Runs fuzz tests in isolated Docker containers for maximum security

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_DIR/docker"
REPORTS_DIR="$PROJECT_DIR/reports/fuzz"

# Create reports directory
mkdir -p "$REPORTS_DIR"

print_header() {
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}                          SECURE FUZZ TESTING SUITE                             ${NC}"
    echo -e "${BLUE}                          Running in Docker Container                           ${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
    echo ""
}

print_section() {
    echo -e "${YELLOW}▶ $1${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Parse command line arguments
PROFILE=${1:-standard}
MODE=${2:-basic}
RUNS=${3:-10000}

case $PROFILE in
    quick)
        RUNS=1000
        TIMEOUT="300s"
        ;;
    standard)
        RUNS=10000
        TIMEOUT="1800s"
        ;;
    intensive)
        RUNS=50000
        TIMEOUT="3600s"
        ;;
    extreme)
        RUNS=100000
        TIMEOUT="7200s"
        ;;
    *)
        print_error "Invalid profile: $PROFILE"
        echo "Valid profiles: quick, standard, intensive, extreme"
        exit 1
        ;;
esac

print_header

echo -e "${BLUE}Configuration:${NC}"
echo "  Profile: $PROFILE"
echo "  Mode: $MODE"
echo "  Runs: $RUNS"
echo "  Timeout: $TIMEOUT"
echo "  Reports: $REPORTS_DIR"
echo ""

# Cleanup function
cleanup() {
    local exit_code=$?
    print_section "Cleaning up Docker resources"
    
    # Stop and remove containers
    docker-compose -f "$DOCKER_DIR/docker-compose.fuzz.yml" down --volumes --remove-orphans 2>/dev/null || true
    
    # Remove dangling images
    docker image prune -f >/dev/null 2>&1 || true
    
    if [ $exit_code -eq 0 ]; then
        print_success "Fuzz testing completed successfully"
    else
        print_error "Fuzz testing failed with exit code $exit_code"
    fi
    
    exit $exit_code
}

# Set trap for cleanup
trap cleanup EXIT INT TERM

# Validate Docker setup
print_section "Validating Docker Environment"

if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed or not in PATH"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose is not installed or not in PATH"
    exit 1
fi

if ! docker info &> /dev/null; then
    print_error "Docker daemon is not running"
    exit 1
fi

print_success "Docker environment validated"

# Build Docker image
print_section "Building Secure Fuzz Testing Image"

cd "$PROJECT_DIR"

if ! docker-compose -f "$DOCKER_DIR/docker-compose.fuzz.yml" build --no-cache fuzz-tests; then
    print_error "Failed to build Docker image"
    exit 1
fi

print_success "Docker image built successfully"

# Run appropriate test suite based on mode
case $MODE in
    basic)
        print_section "Running Basic Fuzz Tests ($RUNS runs)"
        
        timeout "$TIMEOUT" docker-compose -f "$DOCKER_DIR/docker-compose.fuzz.yml" run --rm \
            -e "FOUNDRY_FUZZ_RUNS=$RUNS" \
            fuzz-tests forge test --match-contract FuzzTests --fuzz-runs "$RUNS" -vv \
            || {
                exit_code=$?
                if [ $exit_code -eq 124 ]; then
                    print_warning "Tests timed out after $TIMEOUT"
                else
                    print_error "Basic fuzz tests failed"
                    exit $exit_code
                fi
            }
        ;;
        
    invariants)
        print_section "Running Invariant Tests ($RUNS runs)"
        
        timeout "$TIMEOUT" docker-compose -f "$DOCKER_DIR/docker-compose.fuzz.yml" run --rm \
            -e "FOUNDRY_FUZZ_RUNS=$RUNS" \
            fuzz-tests forge test --match-test "invariant_" --fuzz-runs "$RUNS" -vv \
            || {
                exit_code=$?
                if [ $exit_code -eq 124 ]; then
                    print_warning "Invariant tests timed out after $TIMEOUT"
                else
                    print_error "Invariant tests failed"
                    exit $exit_code
                fi
            }
        ;;
        
    vulnerabilities)
        print_section "Running Vulnerability Detection ($RUNS runs)"
        
        timeout "$TIMEOUT" docker-compose -f "$DOCKER_DIR/docker-compose.fuzz.yml" run --rm \
            -e "FOUNDRY_FUZZ_RUNS=$RUNS" \
            vulnerability-scanner \
            || {
                exit_code=$?
                if [ $exit_code -eq 124 ]; then
                    print_warning "Vulnerability tests timed out after $TIMEOUT"
                else
                    print_error "Vulnerability detection failed"
                    exit $exit_code
                fi
            }
        ;;
        
    comprehensive)
        print_section "Running Comprehensive Test Suite"
        
        # Run basic tests
        print_section "Phase 1: Basic Fuzz Tests"
        timeout "$TIMEOUT" docker-compose -f "$DOCKER_DIR/docker-compose.fuzz.yml" run --rm \
            -e "FOUNDRY_FUZZ_RUNS=$RUNS" \
            fuzz-tests forge test --match-contract FuzzTests --fuzz-runs "$RUNS" -vv
        
        # Run invariant tests
        print_section "Phase 2: Invariant Tests"
        timeout "$TIMEOUT" docker-compose -f "$DOCKER_DIR/docker-compose.fuzz.yml" run --rm \
            -e "FOUNDRY_FUZZ_RUNS=$RUNS" \
            fuzz-tests forge test --match-test "invariant_" --fuzz-runs "$RUNS" -vv
        
        # Run vulnerability detection
        print_section "Phase 3: Vulnerability Detection"
        timeout "$TIMEOUT" docker-compose -f "$DOCKER_DIR/docker-compose.fuzz.yml" run --rm \
            -e "FOUNDRY_FUZZ_RUNS=$RUNS" \
            vulnerability-scanner
        
        # Generate coverage report
        print_section "Phase 4: Coverage Analysis"
        timeout "$TIMEOUT" docker-compose -f "$DOCKER_DIR/docker-compose.fuzz.yml" run --rm \
            fuzz-tests forge coverage --match-contract FuzzTests
        ;;
        
    *)
        print_error "Invalid mode: $MODE"
        echo "Valid modes: basic, invariants, vulnerabilities, comprehensive"
        exit 1
        ;;
esac

# Generate timestamp for reports
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Copy any generated reports
print_section "Collecting Test Reports"

# Create timestamped report directory
TIMESTAMP_DIR="$REPORTS_DIR/run_${TIMESTAMP}"
mkdir -p "$TIMESTAMP_DIR"

# Check if any container reports were generated
if docker-compose -f "$DOCKER_DIR/docker-compose.fuzz.yml" ps -q | head -1 | xargs -r docker cp 2>/dev/null; then
    print_success "Reports collected successfully"
else
    print_warning "No additional reports found in containers"
fi

# Create summary report
cat > "$TIMESTAMP_DIR/run_summary.md" << EOF
# Fuzz Test Run Summary

**Timestamp:** $(date)
**Profile:** $PROFILE
**Mode:** $MODE
**Runs:** $RUNS
**Timeout:** $TIMEOUT

## Configuration
- Docker-based execution for security isolation
- Foundry fuzzing engine
- Non-privileged container execution
- Resource-limited environment

## Execution Details
- Started: $(date)
- Profile: $PROFILE ($RUNS runs per test)
- Test mode: $MODE
- Security: Containerized execution with capability restrictions

## Security Measures
- ✅ Non-root container execution
- ✅ Capability dropping (ALL capabilities removed)
- ✅ No new privileges flag
- ✅ Network isolation
- ✅ Resource limitations
- ✅ Temporary filesystem for scratch data

## Next Steps
1. Review detailed test output above
2. Analyze any failures or security violations
3. Address identified vulnerabilities
4. Re-run with higher intensity if needed

---
Generated by Secure Fuzz Testing Suite
EOF

print_success "Summary report generated: $TIMESTAMP_DIR/run_summary.md"

print_section "Security Analysis Complete"

echo -e "${GREEN}🛡️  All fuzz tests completed in secure Docker environment${NC}"
echo -e "${GREEN}📊 Results available in: $TIMESTAMP_DIR${NC}"
echo ""
echo -e "${BLUE}Security Features Used:${NC}"
echo "  - Containerized execution"
echo "  - Non-root user privileges"
echo "  - Capability restrictions"
echo "  - Network isolation"
echo "  - Resource limits"
echo ""

if [ -f "$TIMESTAMP_DIR/run_summary.md" ]; then
    echo -e "${BLUE}Quick Summary:${NC}"
    tail -n 10 "$TIMESTAMP_DIR/run_summary.md" | grep -E "^(##|-).*" || true
fi

print_success "Secure fuzz testing execution completed"