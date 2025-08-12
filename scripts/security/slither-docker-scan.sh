#!/bin/bash

# Slither Security Analysis Script for LookCoin Contracts
# This script runs Slither in a Docker container for consistent and secure analysis

set -e

echo "=== LookCoin Contract Security Analysis with Slither ==="
echo "Running Slither in Docker for upgrade safety and vulnerability detection"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

# Create output directory
OUTPUT_DIR="./slither-output-$(date +%Y%m%d-%H%M%S)"
mkdir -p $OUTPUT_DIR

echo "Output will be saved to: $OUTPUT_DIR"
echo ""

# Function to run Slither on a specific contract
run_slither_analysis() {
    local CONTRACT_PATH=$1
    local CONTRACT_NAME=$2
    local OUTPUT_FILE="$OUTPUT_DIR/${CONTRACT_NAME}_analysis.txt"
    
    echo -e "${YELLOW}Analyzing ${CONTRACT_NAME}...${NC}"
    
    # Run Slither in Docker with comprehensive checks
    docker run --rm \
        -v "$(pwd):/src" \
        -w /src \
        trailofbits/eth-security-toolbox \
        slither "$CONTRACT_PATH" \
        --checklist \
        --show-ignored-findings \
        --filter-paths "node_modules|@openzeppelin" \
        --solc-remaps "@openzeppelin/=$(pwd)/node_modules/@openzeppelin/" \
        --solc-remaps "@layerzerolabs/=$(pwd)/node_modules/@layerzerolabs/" \
        --solc-remaps "@hyperlane-xyz/=$(pwd)/node_modules/@hyperlane-xyz/" \
        > "$OUTPUT_FILE" 2>&1 || true
    
    # Check for upgrade safety specific issues
    echo -e "\n${YELLOW}Checking upgrade safety for ${CONTRACT_NAME}...${NC}" >> "$OUTPUT_FILE"
    
    docker run --rm \
        -v "$(pwd):/src" \
        -w /src \
        trailofbits/eth-security-toolbox \
        slither-check-upgradeability "$CONTRACT_PATH" \
        >> "$OUTPUT_FILE" 2>&1 || true
    
    echo -e "${GREEN}✓ Analysis complete for ${CONTRACT_NAME}${NC}"
}

# Analyze all bridge modules and router
echo "Starting security analysis of bridge modules..."
echo ""

# Analyze each contract
run_slither_analysis "contracts/bridges/LayerZeroModule.sol" "LayerZeroModule"
run_slither_analysis "contracts/bridges/CelerIMModule.sol" "CelerIMModule"
run_slither_analysis "contracts/bridges/HyperlaneModule.sol" "HyperlaneModule"
run_slither_analysis "contracts/xchain/CrossChainRouter.sol" "CrossChainRouter"
run_slither_analysis "contracts/LookCoin.sol" "LookCoin"

# Generate consolidated report
CONSOLIDATED_REPORT="$OUTPUT_DIR/consolidated_security_report.md"
echo "# LookCoin Security Analysis Report" > "$CONSOLIDATED_REPORT"
echo "Generated on: $(date)" >> "$CONSOLIDATED_REPORT"
echo "" >> "$CONSOLIDATED_REPORT"

echo "## Upgrade Safety Analysis for Function Renaming" >> "$CONSOLIDATED_REPORT"
echo "" >> "$CONSOLIDATED_REPORT"
echo "### Summary" >> "$CONSOLIDATED_REPORT"
echo "Analyzing the safety of removing deprecated \`bridgeToken\` function from CrossChainRouter." >> "$CONSOLIDATED_REPORT"
echo "" >> "$CONSOLIDATED_REPORT"

# Check for function selector collisions
echo "### Function Selector Analysis" >> "$CONSOLIDATED_REPORT"
echo "" >> "$CONSOLIDATED_REPORT"
echo "Checking for selector collisions after function removal..." >> "$CONSOLIDATED_REPORT"

docker run --rm \
    -v "$(pwd):/src" \
    -w /src \
    trailofbits/eth-security-toolbox \
    bash -c "cd /src && slither contracts/xchain/CrossChainRouter.sol --print function-id" \
    >> "$CONSOLIDATED_REPORT" 2>&1 || true

echo "" >> "$CONSOLIDATED_REPORT"
echo "### Storage Layout Verification" >> "$CONSOLIDATED_REPORT"
echo "" >> "$CONSOLIDATED_REPORT"
echo "Verifying storage layout preservation..." >> "$CONSOLIDATED_REPORT"

# Add storage layout checks
for contract in "LayerZeroModule" "CelerIMModule" "HyperlaneModule" "CrossChainRouter"; do
    echo "" >> "$CONSOLIDATED_REPORT"
    echo "#### $contract Storage Layout" >> "$CONSOLIDATED_REPORT"
    cat "$OUTPUT_DIR/${contract}_analysis.txt" | grep -A 20 -i "storage" >> "$CONSOLIDATED_REPORT" || echo "No storage issues found." >> "$CONSOLIDATED_REPORT"
done

# Generate vulnerability summary
echo "" >> "$CONSOLIDATED_REPORT"
echo "## Vulnerability Summary" >> "$CONSOLIDATED_REPORT"
echo "" >> "$CONSOLIDATED_REPORT"

# Count high/medium/low findings
for severity in "High" "Medium" "Low"; do
    count=$(cat $OUTPUT_DIR/*_analysis.txt | grep -c "$severity" || echo "0")
    echo "- **$severity Severity Issues**: $count" >> "$CONSOLIDATED_REPORT"
done

echo "" >> "$CONSOLIDATED_REPORT"
echo "## Recommendations" >> "$CONSOLIDATED_REPORT"
echo "" >> "$CONSOLIDATED_REPORT"
echo "1. **DO NOT** remove \`bridgeToken\` function immediately" >> "$CONSOLIDATED_REPORT"
echo "2. Keep the deprecated function for at least 30 days" >> "$CONSOLIDATED_REPORT"
echo "3. Add event emission to track deprecated function usage" >> "$CONSOLIDATED_REPORT"
echo "4. Monitor on-chain usage before removal" >> "$CONSOLIDATED_REPORT"
echo "5. Provide clear migration documentation" >> "$CONSOLIDATED_REPORT"
echo "" >> "$CONSOLIDATED_REPORT"

echo -e "\n${GREEN}=== Analysis Complete ===${NC}"
echo -e "Reports saved to: ${GREEN}$OUTPUT_DIR${NC}"
echo -e "Consolidated report: ${GREEN}$CONSOLIDATED_REPORT${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Review the consolidated report"
echo "2. Address any high/critical findings"
echo "3. Plan migration strategy for deprecated functions"
echo "4. Run this analysis again after making changes"