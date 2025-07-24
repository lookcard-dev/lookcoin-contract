# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

LookCoin Contract is the smart contract repository for LookCoin (LOOK), the omnichain fungible token that serves as the primary payment method for LookCard's crypto-backed credit/debit card system. The token implements a triple-bridge architecture for cross-chain transfers using LayerZero OFT V2, Celer IM, and IBC protocols.

## Architecture

### Contract Structure

```
contracts/
├── LookCoin.sol              # Main ERC20 token contract with LayerZero OFT V2 (UUPS upgradeable)
├── bridges/                  # Cross-chain bridge implementations
│   ├── LayerZeroModule.sol   # LayerZero V2 bridge module (burn-and-mint)
│   ├── CelerIMModule.sol     # Celer Inter-chain Messaging (burn-and-mint)
│   ├── HyperlaneModule.sol   # Hyperlane bridge module (burn-and-mint)
│   └── IBCModule.sol         # IBC Protocol for Cosmos ecosystem
├── xchain/                   # Cross-chain infrastructure
│   ├── CrossChainRouter.sol  # Unified router for multi-protocol bridging
│   ├── FeeManager.sol        # Protocol-specific fee management
│   ├── SecurityManager.sol   # Rate limiting and security controls
│   └── ProtocolRegistry.sol  # Protocol registration and tracking
└── security/                 # Security infrastructure
    ├── RateLimiter.sol       # Rate limiting with sliding window algorithm
    └── SupplyOracle.sol      # Cross-chain supply monitoring and reconciliation
```

### Key Technical Features

- **Upgradeable Design**: UUPS proxy pattern with OpenZeppelin contracts
- **Native OFT V2**: LookCoin implements LayerZero OFT V2 standard directly for optimal gas efficiency
- **Multi-Bridge Architecture**: All protocols use burn-and-mint mechanism for unified liquidity
- **Dual-Path Support**: LayerZero can be used directly via LookCoin or through CrossChainRouter
- **Role-Based Access Control**: Granular permissions with AccessControl
- **Production Safety**: Validates remote addresses and reverts if destination chain not configured
- **Enforced Gas Options**: Configurable minimum gas per destination chain
- **Emergency Controls**: Pause capability with emergency recovery procedures
- **Supply Reconciliation**: 15-minute monitoring cycles to detect cross-chain anomalies

## Development Commands

### Core Development

```bash
# Install dependencies
npm install

# Compile contracts
npm run compile

# Run tests
npm test

# Run tests with gas reporting
npm run test:gas

# Generate test coverage report
npm run coverage

# Check contract sizes
npm run size

# Run linter
npm run lint

# Format code
npm run format
```

### Deployment Commands

LookCoin uses a three-stage deployment process:

#### Stage 1: Deploy

Creates contracts and deployment artifacts on a single network:

```bash
# Deploy to specific networks (full infrastructure)
npm run deploy:bsc-testnet
npm run deploy:bsc-mainnet
npm run deploy:base-sepolia
npm run deploy:base-mainnet
npm run deploy:op-sepolia
npm run deploy:op-mainnet
npm run deploy:akashic-mainnet

# Standalone LookCoin deployment (OFT only, no additional infrastructure)
npm run deploy:lookcoin-only        # Deploy only LookCoin contract as OFT
npm run configure:lookcoin-only     # Configure trusted remotes for standalone deployment
```

#### Stage 2: Setup

Configures local roles and settings post-deployment:

```bash
# Setup after deployment (available for all networks)
npm run setup:bsc-testnet
npm run setup:base-sepolia
npm run setup:op-sepolia
npm run setup:sapphire-mainnet
```

#### Stage 3: Configure

Establishes cross-chain connections between multiple networks:

```bash
# Configure cross-chain connections (only available for networks with deployment artifacts)
npm run configure:bsc-testnet          # BSC Testnet
npm run configure:base-sepolia         # Base Sepolia
npm run configure:optimism-sepolia     # Optimism Sepolia
npm run configure:sapphire-mainnet     # Oasis Sapphire Mainnet
```

**Note**: Configure scripts are only available for networks that have deployment artifacts from other networks. The `configure.ts` script requires deployment JSON files from other networks to establish LayerZero trusted remotes, Celer IM remote modules, and cross-chain bridge registrations.

#### Contract Verification

```bash
# Verify contracts on block explorers
npm run verify
```

**Execution Order**: Always follow this sequence: **Deploy → Setup → Configure**

### Testing Specific Contracts

```bash
# Test specific contract
npx hardhat test test/LookCoin.test.ts

# Test with specific network fork
npx hardhat test --network hardhat

# Run integration tests
npm run test:integration

# Run security tests
npm run test:security
```

## Technology Stack

- **Smart Contract Language**: Solidity 0.8.28
- **Development Framework**: Hardhat with TypeScript
- **Testing**: Chai, Hardhat test helpers, TypeChain for type safety
- **Security**: OpenZeppelin contracts, custom security modules
- **Cross-chain**: LayerZero OFT V2, Celer IM SDK, IBC Protocol
- **Tools**: Solidity coverage, gas reporter, contract sizer, Slither for static analysis

## Multi-Chain Architecture

### Supported Networks

- **BSC** (Chain ID: 56) - Home chain with full token supply
- **Base** (Chain ID: 8453) - LayerZero OFT deployment
- **Optimism** (Chain ID: 10) - Celer IM deployment
- **Akashic** (Chain ID: 9070) - IBC deployment for Cosmos

### Bridge Operations

1. **LayerZero OFT V2**: Native burn-and-mint with dual-path support (direct OFT or via CrossChainRouter)
2. **Celer IM**: Burn-and-mint mechanism via CelerIMModule
3. **Hyperlane**: Burn-and-mint mechanism via HyperlaneModule
4. **IBC Protocol**: Native Cosmos interoperability for Akashic

## Security Patterns

### Governance Model

- **MPC Vault Wallet**: External MPC vault provides secure off-chain governance
- **Direct Execution**: Administrative operations execute immediately without on-chain delays
- **Role Separation**: Distinct roles for bridge operators, security admins, and supply monitors
- **Security**: Multi-party computation ensures no single point of failure

### Rate Limiting

- Per-account limits: 500K tokens per transaction, 3 transactions per hour
- Global daily limit: 20% of total supply
- Sliding window algorithm for accurate rate tracking
- Emergency bypass for critical operations

### Supply Monitoring

- Real-time cross-chain balance tracking
- 15-minute reconciliation cycles
- Automatic pause on 1% supply deviation
- Manual reconciliation tools for administrators

## Development Workflow

### Setting Up Environment

1. Clone repository and install dependencies
2. Copy `.env.example` to `.env` and configure:
   - GOVERNANCE_VAULT address for MPC vault wallet
   - Private keys for deployment accounts
   - RPC endpoints for each network
   - Block explorer API keys
   - LayerZero and Celer configuration

### Making Changes

1. Modify contracts in `contracts/` directory
2. Update tests in `test/` directory
3. Run `npm run compile` to ensure compilation
4. Run `npm test` to verify functionality
5. Check gas usage with `npm run test:gas`
6. Verify contract sizes with `npm run size`

### Deployment Process

1. Test thoroughly on testnets first
2. **Deploy Stage**: Run deployment script for target network (`npm run deploy:<network>`)
3. **Setup Stage**: Configure local roles and settings (`npm run setup:<network>`)
4. **Configure Stage**: Establish cross-chain connections (`npm run configure:<network>` - only for networks with deployment artifacts)
5. Verify contracts on block explorer
6. Test bridge operations end-to-end
7. Monitor supply reconciliation

## Contract Verification

After deployment, verify contracts:

```bash
npx hardhat verify --network <network-name> <contract-address> <constructor-args>
```

For upgradeable contracts, verify both proxy and implementation.

## Important Considerations

### Gas Optimization

- Optimizer enabled with 9999 runs for deployment efficiency
- Rate limiter uses efficient storage patterns
- Batch operations available for governance actions

### Upgrade Process

1. Deploy new implementation contract
2. Authorize upgrade through MPC vault wallet
3. Execute upgrade transaction
4. Verify new implementation

### Emergency Procedures

- Pause all operations: Call `pause()` with EMERGENCY_ROLE
- Disable specific bridge: Call `disableBridge()`
- Force supply reconciliation: Call `forceReconcile()`
- Recovery requires MPC vault wallet authorization
