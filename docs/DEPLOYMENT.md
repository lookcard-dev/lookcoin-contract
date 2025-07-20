# LookCoin Deployment Guide

This guide provides comprehensive instructions for deploying the LookCoin omnichain token system across multiple blockchain networks.

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Quick Start](#quick-start)
- [Supported Networks](#supported-networks)
- [Deployment Process](#deployment-process)
- [Network-Specific Commands](#network-specific-commands)
- [Post-Deployment Configuration](#post-deployment-configuration)
- [Contract Verification](#contract-verification)
- [Admin Role Transfer](#admin-role-transfer)
- [Monitoring and Maintenance](#monitoring-and-maintenance)
- [Troubleshooting](#troubleshooting)

## Introduction

LookCoin is an omnichain fungible token that serves as the primary payment method for LookCard's crypto-backed credit/debit card system. The deployment process involves:

1. Deploying the main LookCoin contract (UUPS upgradeable)
2. Deploying bridge modules (LayerZero OFT, Celer IM, IBC)
3. Setting up cross-chain connections
4. Configuring governance and security controls

## Prerequisites

Before deploying, ensure you have:

- **Node.js v18+** and npm installed
- **Git** for repository management
- **Hardhat** (installed via npm)
- **Network RPC access** for target chains
- **Sufficient native tokens** for deployment gas fees
- **Block explorer API keys** for contract verification

## Environment Setup

1. Clone the repository and install dependencies:

```bash
git clone https://github.com/lookcard/lookcoin-contract.git
cd lookcoin-contract
npm install
```

2. Copy the environment template:

```bash
cp .env.example .env
```

3. Configure your `.env` file with the following variables:

### Required Environment Variables

```bash
# Deployer private key (must have sufficient gas on all target networks)
DEPLOYER_PRIVATE_KEY=your_private_key_here

# Network RPC URLs
BSC_RPC_URL=https://bsc-dataseed.binance.org/
BSC_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545/
BASE_RPC_URL=https://mainnet.base.org
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
OPTIMISM_RPC_URL=https://mainnet.optimism.io
OPTIMISM_SEPOLIA_RPC_URL=https://sepolia.optimism.io
SAPPHIRE_RPC_URL=https://sapphire.oasis.io
SAPPHIRE_TESTNET_RPC_URL=https://testnet.sapphire.oasis.io
AKASHIC_RPC_URL=https://rpc-mainnet.akashicrecords.io

# Block Explorer API Keys
BSCSCAN_API_KEY=your_bscscan_api_key
BASESCAN_API_KEY=your_basescan_api_key
OPTIMISM_API_KEY=your_optimism_api_key

# Optional: For gas reporting
COINMARKETCAP_API_KEY=your_coinmarketcap_api_key

# MPC Vault Wallet Address (for production)
# This is the address of your external MPC vault wallet
GOVERNANCE_VAULT=0x... # MPC vault wallet address

# Optional: Network-specific vault addresses (if different)
# Leave empty to use GOVERNANCE_VAULT for all networks
GOVERNANCE_VAULT_BSC=
GOVERNANCE_VAULT_BASE=
GOVERNANCE_VAULT_OPTIMISM=
```

## Quick Start

Here's a quick example to deploy to BSC testnet:

1. **Ensure environment is configured** (see above)

2. **Compile contracts**:

```bash
npm run compile
```

3. **Deploy to BSC testnet**:

```bash
npm run deploy:bsc-testnet
```

4. **Configure cross-chain connections**:

```bash
# Choose the appropriate network-specific configure script:
npm run configure:bsc-testnet
npm run configure:base-sepolia
npm run configure:optimism-sepolia
npm run configure:sapphire-mainnet
```

5. **Verify contracts** (optional):

```bash
npm run verify
```

## Supported Networks

LookCoin supports deployment on the following networks:

| Network                    | Chain ID | Network Name     | LayerZero | Celer IM | IBC | RPC Endpoint                                    |
| -------------------------- | -------- | ---------------- | --------- | -------- | --- | ----------------------------------------------- |
| **BSC Mainnet**            | 56       | bsc-mainnet      |           |          |     | https://bsc-dataseed.binance.org/               |
| **BSC Testnet**            | 97       | bsc-testnet      |           |          |     | https://data-seed-prebsc-1-s1.binance.org:8545/ |
| **Base Mainnet**           | 8453     | base-mainnet     |           |          |     | https://mainnet.base.org                        |
| **Base Sepolia**           | 84532    | base-sepolia     |           |          |     | https://sepolia.base.org                        |
| **Optimism Mainnet**       | 10       | op-mainnet       |           |          |     | https://mainnet.optimism.io                     |
| **Optimism Sepolia**       | 11155420 | op-sepolia       |           |          |     | https://sepolia.optimism.io                     |
| **Oasis Sapphire**         | 23295    | sapphire         |           |          |     | https://sapphire.oasis.io                       |
| **Oasis Sapphire Testnet** | 23295    | sapphire-testnet |           |          |     | https://testnet.sapphire.oasis.io               |
| **Akashic Mainnet**        | 9070     | akashic-mainnet  |           |          |     | https://rpc-mainnet.akashicrecords.io           |

### LayerZero Endpoints

- BSC Mainnet: `0x1a44076050125825900e736c501f859c50fE728c`
- BSC Testnet: `0x6EDCE65403992e310A62460808c4b910D972f10f`
- Base Mainnet: `0x1a44076050125825900e736c501f859c50fE728c`
- Base Sepolia: `0x6EDCE65403992e310A62460808c4b910D972f10f`
- Optimism Mainnet: `0x1a44076050125825900e736c501f859c50fE728c`
- Optimism Sepolia: `0x6EDCE65403992e310A62460808c4b910D972f10f`
- Sapphire: Not supported by LayerZero (use Celer IM)
- Akashic: Not supported by LayerZero (use IBC)

### Celer MessageBus

- BSC Mainnet: `0x95714818fdd7a5454f73da9c777b3ee6ebaeea6b`
- BSC Testnet: `0xAd204986D6cB67A5Bc76a3CB8974823F43Cb9AAA`
- Base: Not supported by Celer (use LayerZero)
- Optimism Mainnet: `0x0D71D18126E03646eb09FEc929e2ae87b7CAE69d`
- Optimism Sepolia: Not supported on testnet
- Oasis Sapphire: `0x9Bb46D5100d2Db4608112026951c9C965b233f4D`
- Oasis Sapphire Testnet: `0x9Bb46D5100d2Db4608112026951c9C965b233f4D`
- Akashic: Not supported by Celer (use IBC)

## Deployment File Naming Convention

LookCoin deployment files follow a standardized naming convention to ensure consistency between network lookup logic and deployment file storage:

### Naming Format

- **Pattern**: `{chainConfigKey}.json`
- **Examples**:
  - `basesepolia.json` (Base Sepolia)
  - `bsctestnet.json` (BSC Testnet)
  - `optimismsepolia.json` (Optimism Sepolia)
  - `sapphiremainnet.json` (Sapphire Mainnet)

### Key Characteristics

- **Lowercase**: All filenames are in lowercase
- **No spaces or dashes**: Spaces are removed, not converted to dashes
- **CHAIN_CONFIG alignment**: Names match the keys in `hardhat.config.ts` CHAIN_CONFIG
- **Human-readable network name**: Each deployment JSON file contains a `network` field with the human-readable network name

### Technical Implementation

The naming convention is implemented in `scripts/utils/deployment.ts`:

```typescript
// Canonical naming format: lowercase, no spaces or dashes
const fileName = networkName.toLowerCase().replace(/\s+/g, "") + ".json";
```

This ensures that when `getNetworkName(chainId)` returns a CHAIN_CONFIG key like `"basesepolia"`, the deployment utility functions can correctly locate the corresponding `basesepolia.json` file.

### Backward Compatibility

The deployment system includes backward compatibility for legacy hyphenated filenames (e.g., `base-sepolia.json`). If a canonical filename is not found, the system will automatically check for the legacy format and display a deprecation warning.

## Deployment Process

The deployment process (implemented in `scripts/deploy.ts`) follows this sequence:

### 1. Contract Deployment Order

1. **LookCoin (UUPS Proxy)**
   - Deploys implementation contract
   - Deploys UUPS proxy pointing to implementation
   - Initializes with name, symbol, and initial supply
   - Configures LayerZero endpoint (if supported)

2. **CelerIMModule** (if Celer is supported on the network)
   - Deploys with LookCoin address and MessageBus address
   - Registers Celer chain IDs for cross-chain messaging

3. **IBCModule** (BSC chains only)
   - Deploys with LookCoin address
   - Configures initial validator set (21 validators)

4. **SupplyOracle**
   - Deploys with LookCoin address
   - Monitors cross-chain supply for reconciliation

5. **MPCMultisig**
   - Deploys with configured signers (3-of-5 threshold)
   - Sets up timelock delays (48 hours standard, 24 hours emergency)

### 2. Role Assignment

After deployment, roles are automatically assigned:

- **MINTER_ROLE**: Granted to bridge modules (CelerIMModule, IBCModule)
- **BURNER_ROLE**: Granted to LookCoin itself (for self-burning in cross-chain transfers)
- **DEFAULT_ADMIN_ROLE**: Transferred to MPCMultisig contract
- **PAUSER_ROLE**: Granted to security monitoring addresses
- **ORACLE_ROLE**: Granted to SupplyOracle contract

### 3. Bridge Registration

All deployed bridges are registered with the SupplyOracle:

- LayerZero (native to LookCoin contract)
- Celer IM Module (if deployed)
- IBC Module (if deployed)

### 4. Deployment Artifacts

Deployment information is saved to:

- `deployments/{network}/deployment.json` - Contract addresses and configuration
- `deployments/{network}/artifacts/` - Contract ABIs and bytecode

## Network-Specific Commands

### Testnet Deployments

```bash
# BSC Testnet (Chain ID: 97)
npm run deploy:bsc-testnet

# Base Sepolia (Chain ID: 84532)
npm run deploy:base-sepolia

# Optimism Sepolia (Chain ID: 11155420)
npm run deploy:op-sepolia

# Oasis Sapphire Testnet (Chain ID: 23295)
npm run deploy:sapphire-testnet

```

### Mainnet Deployments

```bash
# BSC Mainnet (Chain ID: 56)
npm run deploy:bsc-mainnet

# Base Mainnet (Chain ID: 8453)
npm run deploy:base-mainnet

# Optimism Mainnet (Chain ID: 10)
npm run deploy:op-mainnet

# Oasis Sapphire (Chain ID: 23295)
npm run deploy:sapphire

# Akashic Mainnet (Chain ID: 9070)
npm run deploy:akashic-mainnet
```

## Post-Deployment Configuration

### Three-Stage Deployment Process

LookCoin deployment follows a three-stage process to ensure proper contract setup and cross-chain connectivity:

#### Stage 1: Deploy

**Purpose**: Creates contracts and deployment artifacts on a single network
**Script**: `scripts/deploy.ts`
**What it does**:

- Deploys all smart contracts (LookCoin, bridge modules, SupplyOracle)
- Creates deployment artifacts in `deployments/{network}/deployment.json`
- Initializes contracts with basic parameters
- Does not configure cross-chain connections

#### Stage 2: Setup

**Purpose**: Configures local roles and settings post-deployment on a single network
**Script**: `scripts/setup.ts`
**What it does**:

- Assigns MINTER_ROLE to bridge modules (CelerIMModule, IBCModule)
- Grants BURNER_ROLE to LookCoin contract for LayerZero burns
- Registers local bridges with SupplyOracle for the current network only
- Configures rate limiting parameters
- Operates on a single network using only local deployment artifacts

#### Stage 3: Configure

**Purpose**: Establishes cross-chain connections between multiple networks
**Script**: `scripts/configure.ts`
**What it does**:

- Sets up LayerZero trusted remotes using contract addresses from other networks
- Configures Celer IM remote modules for cross-chain messaging
- Registers bridges from ALL networks in the local SupplyOracle
- Implements cross-tier validation to prevent mainnet/testnet mixing
- Requires deployment artifacts from multiple networks via `loadOtherChainDeployments()`

### Available Configuration Scripts

```bash
# Configure cross-chain connections (only available for networks with deployment artifacts)
npm run configure:bsc-testnet          # BSC Testnet
npm run configure:base-sepolia         # Base Sepolia
npm run configure:optimism-sepolia     # Optimism Sepolia
npm run configure:sapphire-mainnet     # Oasis Sapphire Mainnet
```

**Technical Dependency**: Configure scripts are only available for networks that have deployment artifacts from other networks. The `configure.ts` script uses `loadOtherChainDeployments()` to scan the `/deployments` directory for JSON files from other networks. This function loads contract addresses required for setting up LayerZero trusted remotes and Celer IM remote modules.

**Execution Order**: Always follow this sequence: **Deploy → Setup → Configure**

The configuration script (`scripts/configure.ts`) performs:

### 1. LayerZero Configuration

- Sets trusted remote addresses for each LayerZero-enabled chain
- Configures DVN (Decentralized Verifier Network) settings:
  - BSC: LayerZero Labs (0xfD6865c841c2d64565562fCc7e05e619A30615f0), Google Cloud (0xd56e4eab23cb81f43168f9f45211eb027b9ac7cc), Nethermind (0x31f748a368a893bdb5abb67ec95f232507601a73)
  - Base: LayerZero Labs (0x9e059a54699a285714207b43b055483e78faac25), Google Cloud (0xd56e4eab23cb81f43168f9f45211eb027b9ac7cc), Nethermind (0xcd37ca043f8479064e10635020c65ffc005d36f6)
  - Optimism: LayerZero Labs (0x6a02d83e8d433304bba74ef1c427913958187142), Google Cloud (0xd56e4eab23cb81f43168f9f45211eb027b9ac7cc), Nethermind (0xa7b5189bca84cd304d8553977c7c614329750d99)
- Sets up send/receive libraries
- Configures execution and verification settings
- Required DVNs: 1 (typically LayerZero Labs)
- Optional DVNs: 2 (Google Cloud, Nethermind) with threshold of 1

### 2. Celer IM Configuration

- Registers remote module addresses on each Celer-enabled chain
- Sets message fees (typically 0.001 ETH equivalent)
- Configures chain ID mappings (BSC: 56, Optimism: 10, Sapphire: 23295)
- Bridge fee structure: 0.1% (10 basis points), minimum 1 LOOK, maximum 100 LOOK

### 3. IBC Configuration (Akashic only)

- Registers Akashic chain parameters (Chain ID: 9070)
- Sets up validator public keys (21 validators minimum)
- Configures consensus requirements (2/3 majority, threshold: 14)
- Sets packet timeout parameters (1 hour)
- Unbonding period: 14 days
- Channel ID: channel-0, Port ID: transfer

### 4. Supply Oracle Setup

- Registers all bridge endpoints across chains
- Sets initial supply baselines
- Configures monitoring intervals (15 minutes)
- Sets deviation thresholds (1% for automatic pause)

### 5. Rate Limiting Configuration

- Per-account limits: 500K tokens per transaction
- Hourly limits: 3 transactions per hour per account
- Global daily limit: 20% of total supply
- Tier-based limits for different user categories

## Contract Verification

To verify contracts on block explorers:

1. **Ensure API keys are configured** in `.env`

2. **Run verification command**:

```bash
npm run verify
```

3. **Manual verification** (if needed):

```bash
# Verify specific contract
npx hardhat verify --network <network-name> <contract-address> <constructor-args>

# Example for BSC mainnet
npx hardhat verify --network bsc-mainnet 0x123... "LookCoin" "LOOK" "1000000000000000000000000000"
```

### Verification Tips

- For upgradeable contracts, verify both proxy and implementation
- Constructor arguments must match deployment parameters exactly
- Some explorers may take time to index new contracts
- Use `--constructor-args` flag for complex arguments

## Admin Role Assignment

During deployment, all admin roles are automatically assigned to the MPC vault wallet:

1. **Verify vault address is correct**:
   - Confirm GOVERNANCE_VAULT environment variable
   - Double-check the address before deployment

2. **Automatic role assignment**:
   - DEFAULT_ADMIN_ROLE → MPC Vault Wallet
   - UPGRADER_ROLE → MPC Vault Wallet
   - PAUSER_ROLE → MPC Vault Wallet
   - All roles assigned during contract initialization

3. **Post-deployment verification**:
   - Check role assignments on block explorer
   - Verify vault has all necessary permissions
   - Test basic operations through vault

## Monitoring and Maintenance

### Event Monitoring

Set up monitoring for critical events:

- `Transfer` events for token movements
- `CrossChainTransfer` for bridge operations
- `SupplyMismatch` for reconciliation alerts
- `EmergencyPause` for security incidents

### Supply Reconciliation

- Monitor SupplyOracle contract for deviations
- Set up alerts for >0.5% supply discrepancies
- Review reconciliation reports every 15 minutes
- Investigate any automatic pauses

### Emergency Procedures

1. **To pause all operations**:
   - Call `pause()` with EMERGENCY_ROLE account
   - All transfers and bridge operations will halt

2. **To disable specific bridge**:
   - Call `disableBridge(bridgeId)` through MPC multisig
   - Only affects the specified bridge

3. **To force supply reconciliation**:
   - Call `forceReconcile()` through MPC multisig
   - Manually adjusts supply tracking

## Troubleshooting

### Common Issues

#### Network Connectivity

- **Error**: "Network connection timeout"
- **Solution**: Check RPC URL is correct and accessible
- **Alternative**: Use backup RPC endpoints

#### Gas Estimation Failures

- **Error**: "Cannot estimate gas"
- **Solution**: Ensure account has sufficient native tokens
- **Check**: Contract size limits (24KB max)

#### Role Assignment Issues

- **Error**: "AccessControl: account is missing role"
- **Solution**: Verify deployment account has admin rights
- **Fix**: Re-run role assignment with correct account

#### Cross-Chain Configuration

- **Error**: "Invalid remote address"
- **Solution**: Ensure all chains are deployed before configuration
- **Check**: Deployment artifacts contain correct addresses

#### Verification Failures

- **Error**: "Contract source code not verified"
- **Solution**: Check API key is valid and network is supported
- **Fix**: Try manual verification with exact constructor arguments

### Debug Commands

```bash
# Check deployment status
npx hardhat run scripts/status.ts --network <network>

# Verify role assignments
npx hardhat run scripts/check-roles.ts --network <network>

# Test bridge connectivity
npx hardhat run scripts/test-bridge.ts --network <network>
```

### Support Resources

- GitHub Issues: https://github.com/lookcard/lookcoin-contract/issues
- Technical Documentation: See CLAUDE.md for detailed architecture
- Security Audits: Available in `/audits` directory
