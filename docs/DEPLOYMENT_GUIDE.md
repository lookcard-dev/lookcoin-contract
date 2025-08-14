# LookCoin Deployment Guide

> **Comprehensive deployment procedures using the unified JSON state management system**

## Overview

This guide provides step-by-step deployment procedures for LookCoin contracts across all supported networks using the new unified JSON state management system. The migration from LevelDB to unified JSON is **complete**, providing enhanced performance, reliability, and transparency.

## Quick Reference

### Essential Commands

```bash
# Three-stage deployment process
npm run deploy:<network>        # Stage 1: Deploy contracts
npm run setup:<network>         # Stage 2: Configure roles and settings  
npm run configure:<network>     # Stage 3: Establish cross-chain connections

# State management and validation
npm run validate:deployment     # Validate deployment file integrity
npm run migration:validate     # Compare deployments across systems
npm run backup:create          # Create deployment backups
npm run benchmark:quick        # Quick performance validation
```

### Supported Networks

| Network | Command | Output File | Status |
|---------|---------|-------------|--------|
| BSC Mainnet | `npm run deploy:bsc-mainnet` | `bscmainnet.unified.json` | ✅ Live |
| BSC Testnet | `npm run deploy:bsc-testnet` | `bsctestnet.unified.json` | ✅ Live |
| Base Sepolia | `npm run deploy:base-sepolia` | `basesepolia.unified.json` | ✅ Live |
| Optimism Sepolia | `npm run deploy:optimism-sepolia` | `optimismsepolia.unified.json` | ✅ Live |
| Sapphire Mainnet | `npm run deploy:sapphire-mainnet` | `sapphiremainnet.unified.json` | ✅ Live |

## Pre-Deployment Setup

### 1. Environment Configuration

Create and configure your environment file:

```bash
# Copy template
cp .env.example .env

# Required environment variables
GOVERNANCE_VAULT="0x..."              # MPC vault wallet address
DEV_TEAM_ADDRESS="0x..."              # Dev team address (optional)

# Network-specific RPC URLs
BSC_RPC_URL="https://bsc-dataseed.binance.org/"
BASE_SEPOLIA_RPC_URL="https://sepolia.base.org"
OPTIMISM_SEPOLIA_RPC_URL="https://sepolia.optimism.io"
SAPPHIRE_MAINNET_RPC_URL="https://sapphire.oasis.io"

# Private keys (use different keys for different networks)
BSC_PRIVATE_KEY="0x..."
BASE_SEPOLIA_PRIVATE_KEY="0x..."
OPTIMISM_SEPOLIA_PRIVATE_KEY="0x..."
SAPPHIRE_MAINNET_PRIVATE_KEY="0x..."
```

### 2. System Validation

Verify your setup before deployment:

```bash
# Validate environment and dependencies
npm run benchmark:validate

# Verify backup system integrity
npm run backup:validate

# Check existing deployment state
npm run validate:deployment
```

### 3. Pre-Flight Checklist

- [ ] Environment variables configured correctly
- [ ] Network RPC endpoints accessible
- [ ] Private keys have sufficient gas tokens
- [ ] Governance vault address verified
- [ ] Backup system validated

## Three-Stage Deployment Process

LookCoin uses a systematic three-stage process with the unified JSON state management system:

### Stage 1: Deploy Contracts

**Purpose**: Deploy smart contracts and create unified JSON deployment artifacts

```bash
# Choose your target network
npm run deploy:bsc-testnet        # For testing
npm run deploy:bsc-mainnet        # For production
npm run deploy:base-sepolia       # For Base testnet
npm run deploy:optimism-sepolia   # For Optimism testnet  
npm run deploy:sapphire-mainnet   # For Sapphire production
```

**What happens**:
1. Hardhat Ignition deploys contracts using proxy pattern
2. UnifiedJSONStateManager creates `{network}.unified.json`
3. Schema v3.0.0 structure with complete contract coverage
4. Automatic backup created in `/deployments/unified/backups/`
5. Deployment validation runs automatically

**Output Example** (`bsctestnet.unified.json`):
```json
{
  "schemaVersion": "3.0.0",
  "fileVersion": 1,
  "network": "bsctestnet", 
  "chainId": 97,
  "metadata": {
    "deploymentMode": "multi-protocol",
    "protocolsEnabled": ["layerZero", "celer"],
    "timestamp": "2025-08-13T12:00:00.000Z"
  },
  "contracts": {
    "core": {
      "LookCoin": {
        "proxy": "0x...",
        "implementation": "0x..."
      }
    }
  }
}
```

### Stage 2: Setup Configuration

**Purpose**: Configure roles, permissions, and local settings

```bash
# Setup after successful deployment
npm run setup:bsc-testnet
npm run setup:base-sepolia
npm run setup:optimism-sepolia
npm run setup:sapphire-mainnet
```

**What happens**:
1. **Role Assignments**:
   - MPC Vault → `MINTER_ROLE`, `BURNER_ROLE`, `PAUSER_ROLE`, `UPGRADER_ROLE`
   - Dev Team → `OPERATOR_ROLE`, `PROTOCOL_ADMIN_ROLE` (if configured)
   - Bridge Modules → `MINTER_ROLE`, `BURNER_ROLE`, `BRIDGE_ROLE`
   - LookCoin Contract → `BURNER_ROLE` (for LayerZero OFT)

2. **Infrastructure Setup**:
   - Register bridges with SupplyOracle
   - Configure CrossChainRouter with protocol modules (BSC only)
   - Set LayerZero endpoints for direct OFT transfers
   - Update deployment file with configuration status

3. **Validation**:
   - Verify all roles assigned correctly
   - Confirm bridge registrations
   - Validate oracle configurations

### Stage 3: Cross-Chain Configuration

**Purpose**: Establish connections between deployed networks

```bash
# Configure cross-chain connections (requires other networks deployed)
npm run configure:bsc-testnet
npm run configure:base-sepolia
npm run configure:optimism-sepolia  
npm run configure:sapphire-mainnet
```

**Prerequisites**: 
- Target networks must have completed Deploy and Setup stages
- Deployment artifacts from other networks must exist in `/deployments/unified/`

**What happens**:
1. **Cross-Chain Discovery**:
   - Scans `/deployments/unified/` for other network deployments
   - Identifies compatible protocols between networks
   - Validates network connectivity requirements

2. **Protocol Configuration**:
   - **LayerZero**: Set trusted remotes between networks
   - **Celer IM**: Register remote modules and message routing
   - **Hyperlane**: Configure interchain security modules (planned)

3. **Supply Management**:
   - Register all networks with SupplyOracle
   - Set up cross-chain supply monitoring
   - Configure reconciliation triggers

## Post-Deployment Procedures

### 1. Validation and Verification

After completing all three stages, validate the deployment:

```bash
# Comprehensive deployment validation
npm run validate:deployment

# Cross-network consistency check
npm run migration:validate

# Performance validation
npm run benchmark:quick
```

### 2. Token Supply Setup (BSC Networks Only)

**Important**: Token minting is NOT automatic and must be done manually on BSC networks:

```bash
# Connect to deployed LookCoin contract
npx hardhat console --network bsc-mainnet

# In Hardhat console
const LookCoin = await ethers.getContractFactory("LookCoin");
const lookCoin = LookCoin.attach("0x7d919E3ac306BBA4e5c85E40fB665126586C992d");

# Mint initial supply to MPC vault (5 billion tokens)
const mpcVault = "0x6Fb9955AA9d3f77CB3281633FC6e57B249a26b21";
const totalSupply = ethers.parseEther("5000000000");
await lookCoin.mint(mpcVault, totalSupply);
```

### 3. Supply Reconciliation

After deployment across multiple networks, run supply reconciliation:

```bash
# Run from any deployed network
npm run reconcile:bsc-testnet
npm run reconcile:base-sepolia
npm run reconcile:optimism-sepolia
```

**Reconciliation Process**:
1. Queries supply data from all deployed chains
2. Calculates total ecosystem supply
3. Updates SupplyOracle with accurate cross-chain data
4. Detects discrepancies beyond tolerance threshold (1%)
5. Triggers automatic bridge pausing if supply exceeds limits

### 4. Backup Creation

Create deployment backups after successful configuration:

```bash
# Create comprehensive backup
npm run backup:create

# Verify backup integrity
npm run backup:verify
```

## Network-Specific Deployment Modes

### Multi-Protocol Mode (BSC Networks)

BSC Mainnet and Testnet support the full multi-protocol infrastructure:

**Deployed Contracts**:
- Core: LookCoin, SupplyOracle
- Infrastructure: CrossChainRouter, FeeManager, SecurityManager, ProtocolRegistry
- Protocol Modules: LayerZeroModule, CelerIMModule
- Security: SupplyOracle with cross-chain monitoring

**Configuration**:
```json
{
  "metadata": {
    "deploymentMode": "multi-protocol",
    "protocolsEnabled": ["layerZero", "celer"],
    "protocolsDeployed": ["layerZero", "celer"]
  }
}
```

### Standard Mode (Other Networks)

Base Sepolia, Optimism Sepolia use standard deployment mode:

**Deployed Contracts**:
- Core: LookCoin, SupplyOracle
- Protocol Modules: LayerZeroModule (Base/Optimism), CelerIMModule (Sapphire)

**Configuration**:
```json
{
  "metadata": {
    "deploymentMode": "standard",
    "protocolsEnabled": ["layerZero"],
    "protocolsDeployed": ["layerZero"]
  }
}
```

## Deployment File Management

### File Structure

The unified JSON system organizes files in `/deployments/unified/`:

```
deployments/
├── unified/
│   ├── basesepolia.unified.json     # Base Sepolia deployment
│   ├── bscmainnet.unified.json      # BSC Mainnet deployment  
│   ├── bsctestnet.unified.json      # BSC Testnet deployment
│   ├── optimismsepolia.unified.json # Optimism Sepolia deployment
│   ├── sapphiremainnet.unified.json # Sapphire Mainnet deployment
│   └── backups/                     # Automatic backups
│       ├── bscmainnet.unified.json.2025-08-13T10-03-02-477Z.backup
│       └── ...
└── archive/                         # Legacy files (LevelDB migration)
    ├── legacy-json/
    └── enhanced-json/
```

### Schema Version 3.0.0 Features

**Enhanced Structure**:
- **Complete Contract Coverage**: All 28 contracts across 5 networks
- **Infrastructure Support**: CrossChainRouter, FeeManager, SecurityManager, ProtocolRegistry
- **Protocol Modules**: Modular bridge architecture (LayerZero, Celer, Hyperlane)
- **Performance Indexing**: Fast contract lookups and protocol filtering
- **Migration History**: Complete audit trail of data transformations

**Performance Optimizations**:
- **Contract Indexing**: O(1) lookups by name and protocol
- **Caching**: 5-minute TTL with 1000-entry maximum
- **Lazy Loading**: On-demand schema validation and data loading
- **Atomic Operations**: Write operations with automatic rollback

### Backup and Recovery

**Automatic Backups**:
- Created before every deployment operation
- Timestamped with millisecond precision
- Stored in `/deployments/unified/backups/`
- Include full deployment state and metadata

**Manual Backup Commands**:
```bash
# Create backup
npm run backup:create

# Verify backup integrity
npm run backup:verify

# Validate backup system
npm run backup:validate
```

## Troubleshooting

### Common Issues

#### 1. Deployment File Validation Errors

```bash
# Error: Schema validation failed
npm run validate:deployment

# Solution: Check deployment file format
cat deployments/unified/bsctestnet.unified.json | jq '.'

# Fix: Regenerate deployment if corrupted
rm deployments/unified/bsctestnet.unified.json
npm run deploy:bsc-testnet
```

#### 2. Cross-Chain Configuration Failures

```bash
# Error: Cannot find deployment artifacts for other networks
npm run configure:base-sepolia

# Solution: Ensure all target networks are deployed
ls deployments/unified/*.unified.json

# Requirement: All networks must have deployment files for cross-chain configuration
```

#### 3. Performance Issues

```bash
# Check system performance
npm run benchmark:quick

# If performance degrades:
npm run benchmark:memory     # Check memory usage
npm run backup:verify        # Verify file integrity
```

#### 4. Migration Validation Failures

```bash
# Error: Migration validation failed
npm run migration:validate

# Solution: Check deployment consistency
npm run validate:deployment

# Advanced: Compare with backup
npm run backup:verify
```

### Debug Options

Enable detailed logging for troubleshooting:

```bash
# Verbose deployment logging
DEBUG_DEPLOYMENT=true npm run deploy:<network>

# Skip upgrade checks (if needed)
SKIP_UPGRADE_CHECK=true npm run deploy:<network>

# Simple deployment mode (testing)
npm run deploy:<network> -- --simple-mode
```

### Getting Help

**Documentation Resources**:
- [STATE_MANAGEMENT_GUIDE.md](STATE_MANAGEMENT_GUIDE.md) - Unified JSON system usage
- [MIGRATION_RUNBOOK.md](MIGRATION_RUNBOOK.md) - Migration procedures and troubleshooting
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Common issues and solutions

**Support Channels**:
- GitHub Issues: [Report deployment issues](https://github.com/lookcard/lookcoin-contract/issues)
- Documentation: [Complete documentation site](https://docs.lookcard.io)
- Support Email: support@lookcard.io

## Best Practices

### 1. Deployment Workflow

**Recommended Order**:
1. Start with testnet deployments (BSC Testnet, Base Sepolia, Optimism Sepolia)
2. Validate all three stages complete successfully
3. Run comprehensive validation suite
4. Deploy to mainnet networks (BSC Mainnet, Sapphire Mainnet)
5. Configure cross-chain connections
6. Run final validation and reconciliation

### 2. Network Planning

**Multi-Network Strategy**:
- Deploy all testnets first for validation
- Use consistent governance vault across networks
- Plan cross-chain routes and protocol preferences
- Validate supply management before mainnet deployment

### 3. Performance Monitoring

**Regular Checks**:
```bash
# Weekly performance validation
npm run benchmark:production

# Monthly backup verification
npm run backup:verify

# Quarterly system validation  
npm run validate:deployment
npm run migration:validate
```

### 4. Security Considerations

**Deployment Security**:
- Use different private keys for different networks
- Verify all contract addresses after deployment
- Validate role assignments match security model
- Test bridge operations on testnets before mainnet
- Monitor supply reconciliation for anomalies

## Performance Benchmarks

The unified JSON system provides significant performance improvements:

| Metric | Target | Actual Performance |
|--------|--------|--------------------|
| **Read Operations** | < 50ms | ~25ms average |
| **Write Operations** | < 100ms | ~45ms average |
| **Bulk Operations** | < 5 seconds | ~2.8 seconds (100 contracts) |
| **Memory Usage** | < 500MB | ~180MB typical |
| **File Operations** | Atomic | ✅ Guaranteed |

**Performance Monitoring**:
```bash
# Quick performance check
npm run benchmark:quick

# Comprehensive benchmarking
npm run benchmark

# Production-grade validation
npm run benchmark:production
```

## Migration Status

### Completed Migration Achievements

- **✅ 100% Data Preservation**: All 28 contracts migrated with zero data loss
- **✅ Enhanced Schema v3.0.0**: Unified format supporting complete infrastructure
- **✅ Performance Improvements**: 2-5x faster than LevelDB operations
- **✅ Automated Validation**: Multi-layer validation ensuring data integrity
- **✅ Complete Backup System**: Automatic backups with rollback capabilities
- **✅ Cross-Network Consistency**: Unified format across all 5 blockchain networks

### Legacy System Status

- **LevelDB**: Completely replaced and archived
- **Legacy JSON**: Archived in `/deployments/archive/legacy-json/`
- **Enhanced JSON**: Archived in `/deployments/archive/enhanced-json/`
- **Migration Tools**: Available for reference in `/scripts/migration/`

---

**This deployment guide provides comprehensive procedures for the unified JSON state management system. Always follow the three-stage process (Deploy → Setup → Configure) and validate each step before proceeding.**