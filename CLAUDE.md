# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

LookCoin Contract is the smart contract repository for LookCoin (LOOK), the omnichain fungible token that serves as the primary payment method for LookCard's crypto-backed credit/debit card system. The token implements native LayerZero OFT V2 with support for multiple bridge protocols through modular architecture.

## Key Features

- **Native LayerZero OFT V2**: Direct integration for gas-efficient cross-chain transfers
- **Multi-Protocol Support**: LayerZero, Celer IM, and Hyperlane (planned)
- **Unified Burn-and-Mint**: All protocols use consistent token mechanics
- **5 Billion Supply Cap**: Maximum supply limit with cross-chain tracking
- **UUPS Upgradeable**: Future-proof with secure upgrade mechanism
- **MPC Governance**: External multi-party computation vault for security

## Quick Start

### Prerequisites

- Node.js 20+ with npm
- Hardhat environment
- `.env` file with required variables (see `.env.example`)

### Basic Commands

```bash
# Install dependencies
npm install

# Compile contracts
npm run compile

# Run tests
npm test

# Deploy (see deployment guide for network-specific commands)
npm run deploy:<network>
```

## Architecture

### Contract Structure

```text
contracts/
├── LookCoin.sol              # Main token with native LayerZero OFT V2
├── bridges/                  # Protocol modules (Celer, future Hyperlane)
├── xchain/                   # Multi-protocol infrastructure (BSC only)
└── security/                 # SupplyOracle for cross-chain monitoring
```

### Deployment Architecture

- **Standard Mode**: Single protocol deployments (Base, Optimism, Sapphire)
- **Multi-Protocol Mode**: Full infrastructure (BSC mainnet/testnet only)
- **Simple Mode**: Development optimization (skip infrastructure)

## Three-Stage Deployment Process

### Stage 1: Deploy

Creates contracts on a single network:

```bash
npm run deploy:bsc-mainnet       # Multi-protocol deployment
npm run deploy:base-sepolia      # Standard deployment
npm run deploy:sapphire-mainnet  # Celer-only deployment
```

### Stage 2: Setup

Configures roles and local settings:

```bash
npm run setup:<network>
```

### Stage 3: Configure

Establishes cross-chain connections (requires other networks deployed):

```bash
npm run configure:<network>
```

**Important**: Always follow Deploy → Setup → Configure sequence

## Network Support

| Network | Chain ID | Status | Protocols | Mode |
|---------|----------|--------|-----------|------|
| BSC Mainnet | 56 | ✅ Deployed | LayerZero, Celer | Multi-protocol |
| BSC Testnet | 97 | ✅ Deployed | LayerZero, Celer | Multi-protocol |
| Base Sepolia | 84532 | ✅ Deployed | LayerZero | Standard |
| Optimism Sepolia | 11155420 | ✅ Deployed | LayerZero | Standard |
| Sapphire Mainnet | 23295 | ✅ Deployed | Celer | Standard |
| Base Mainnet | 8453 | ⏳ Planned | LayerZero, Hyperlane | Standard |
| Optimism Mainnet | 10 | ⏳ Planned | LayerZero, Celer, Hyperlane | Multi-protocol |
| Akashic | 9070 | ⏳ Planned | Hyperlane (self-hosted) | Standard |

## Token Supply Management

### Global Supply Cap

- **Maximum**: 5,000,000,000 LOOK
- **Home Chain**: BSC (only chain where minting occurs)
- **Current Minted**: 20,000 LOOK (BSC Mainnet)

### Supply Monitoring

- SupplyOracle deployed on every chain
- 15-minute reconciliation cycles
- Multi-signature validation (3 signatures required)
- Automatic pause on 1% deviation

### Manual Minting (BSC Only)

```javascript
// Minting is NOT automatic - must be done manually after deployment
const lookCoin = await ethers.getContractAt("LookCoin", "0x...");
await lookCoin.mint("0xMpcVault...", ethers.parseEther("20000"));
```

## Security Architecture

### Role-Based Access Control

- **DEFAULT_ADMIN_ROLE**: Full administrative control (MPC Vault)
- **MINTER_ROLE**: Token minting (MPC Vault + Bridge modules)
- **BURNER_ROLE**: Token burning (MPC Vault + Bridge modules + LookCoin)
- **PAUSER_ROLE**: Emergency pause (MPC Vault)
- **UPGRADER_ROLE**: Contract upgrades (MPC Vault + Dev Team)
- **OPERATOR_ROLE**: Operational tasks (Dev Team)
- **ORACLE_ROLE**: Supply updates (3+ Oracle operators)

### Emergency Procedures

```solidity
// Pause all operations
lookCoin.pause()

// Disable specific bridge
crossChainRouter.pauseProtocol(Protocol.Celer)

// Force supply reconciliation
supplyOracle.forceReconcile()
```

## Bridge Operations

### Dual-Path Architecture

1. **Direct OFT Path** (LayerZero only): `LookCoin.sendFrom()`
2. **Router Path** (All protocols): `CrossChainRouter.bridgeToken()`

### Fee Structure

- **LayerZero**: Native token fees only (~0.01 ETH/BNB)
- **Celer IM**: 0.5% bridge fee (10-1000 LOOK) + native token fees
- **Hyperlane**: (Planned) Native token fees only

## Development Workflow

### Testing

```bash
npm test                    # All tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests
npm run test:gas           # With gas reporting
npm run coverage           # Coverage report
```

### Contract Verification

```bash
npm run verify             # Verify on block explorer
```

### Debug Options

```bash
DEBUG_DEPLOYMENT=true npm run deploy:<network>    # Verbose logging
SKIP_UPGRADE_CHECK=true npm run deploy:<network>  # Skip upgrade checks
npm run deploy:<network> -- --simple-mode         # Simple deployment
```

## Unified State Management

### Deployment Schema v3.0.0

LookCoin uses a **Unified JSON State Management** system that consolidates all deployment data into single files per network. This replaced the previous LevelDB storage system in August 2025.

#### Current Architecture
```
deployments/unified/
├── bscmainnet.unified.json      # Complete BSC mainnet state
├── bsctestnet.unified.json      # Complete BSC testnet state  
├── basesepolia.unified.json     # Complete Base Sepolia state
├── optimismsepolia.unified.json # Complete Optimism Sepolia state
└── sapphiremainnet.unified.json # Complete Sapphire mainnet state
```

#### Key Features
- **Single Source of Truth**: All deployment data in one file per network
- **Extended Fields**: Preserves all contract metadata using extended data pattern
- **BigInt Support**: Handles large numbers with custom serialization
- **Version Control**: Git-friendly format with schema versioning
- **Performance Optimized**: Multi-level caching and batch operations

#### State Management Commands
```bash
# Validate current deployment state
npm run state:validate

# Create comprehensive backup
npm run state:backup

# Restore from backup
npm run state:restore

# Performance benchmarking
npm run benchmark
```

#### Unified Schema Structure
```json
{
  "schemaVersion": "3.0.0",
  "network": "bscmainnet", 
  "chainId": 56,
  "contracts": {
    "core": { "LookCoin": {...}, "SupplyOracle": {...} },
    "protocol": { "LayerZeroModule": {...}, "CelerIMModule": {...} },
    "infrastructure": { "CrossChainRouter": {...}, "FeeManager": {...} }
  },
  "configuration": { "protocols": {...}, "governance": {...} },
  "topology": { "connectedChains": [...], "routingPaths": {...} }
}
```

### Migration Status
- ✅ **Migration Complete**: LevelDB → Unified JSON (August 2025)  
- ✅ **Data Preservation**: 100% data integrity maintained (26/26 contracts)
- ✅ **Performance**: Within acceptable ranges (≤3x latency)
- ✅ **Backup Systems**: Comprehensive backup and rollback procedures

### Extended Fields Pattern
The unified system uses an extended fields pattern to preserve all LevelDB data:

```json
{
  "contracts": {
    "core": {
      "LookCoin": {
        "implementation": "0x8f8C..."  // Address (not hash)
      }
    }
  },
  "extended_LookCoin": {
    "implementationHash": "0x035df...",  // Hash stored here
    "factoryByteCodeHash": "0x12345...",
    "deploymentArgs": [...],
    "timestamp": 1753441878006
  }
}
```

## Configuration Management

All network and protocol configurations are centralized in `hardhat.config.ts` and unified JSON files:

- Network RPC endpoints and chain IDs
- Protocol endpoints and parameters
- DVN settings for LayerZero
- Fee structures and limits
- Cross-network topology and routing

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| "No deployment found" | Run deploy script first |
| "Cross-tier configuration detected" | Use `--force-cross-tier` flag |
| "Destination chain not configured" | Run configure script on both chains |
| "Supply mismatch causes bridge pause" | Admin intervention required |

## Important Notes

1. **No automatic minting**: All token minting must be done manually
2. **BSC is home chain**: Only chain where new tokens can be minted
3. **Deployment order matters**: Deploy → Setup → Configure
4. **CrossChainRouter**: Only deployed on BSC (multi-protocol mode)
5. **Hyperlane**: Infrastructure planned but not yet deployed

## References

For detailed information, see:

- `docs/TECHNICAL.md` - Complete technical architecture
- `docs/DEPLOYMENT.md` - Detailed deployment guide
- `docs/SECURITY.md` - Security procedures and audit results
- `docs/USER_FLOW.md` - Bridge usage instructions
- `docs/ADDRESSES.md` - Deployed contract addresses
