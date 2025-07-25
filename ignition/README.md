# Hardhat Ignition Modules

This directory contains Hardhat Ignition deployment modules for the LookCoin omnichain token system. The modules have been enhanced with comprehensive parameter validation and error handling to ensure reliable deployments across different networks.

## Overview

The deployment system consists of six main modules that work together to deploy and configure the complete LookCoin ecosystem:

1. **LookCoinModule** - Deploys the main LookCoin token contract with LayerZero OFT V2 support
2. **HyperlaneModule** - Deploys the Hyperlane bridge module for cross-chain messaging
3. **CelerModule** - Deploys the Celer IM bridge module for cross-chain messaging
4. **OracleModule** - Deploys the supply oracle for cross-chain supply monitoring
5. **MocksModule** - Deploys mock contracts for testing environments
6. **Parameter Validation** - Utility module for validating deployment parameters

## Parameter Requirements

All modules use string-based parameters to avoid Hardhat Ignition's limitations with complex types. Parameters are validated before use to ensure type safety.

### LookCoinModule Parameters

| Parameter       | Type    | Required | Default      | Description                                          |
| --------------- | ------- | -------- | ------------ | ---------------------------------------------------- |
| governanceVault | address | Yes      | account[0]   | MPC vault wallet address for governance              |
| lzEndpoint      | address | No       | ZeroAddress  | LayerZero endpoint address (ZeroAddress disables LZ) |
| totalSupply     | string  | No       | "1000000000" | Total token supply in ether units                    |
| chainId         | number  | No       | 56           | Current chain ID                                     |
| dvns            | string  | No       | ""           | Comma-separated DVN addresses                        |
| requiredDVNs    | number  | No       | 2            | Number of required DVNs                              |
| optionalDVNs    | number  | No       | 1            | Number of optional DVNs                              |
| dvnThreshold    | number  | No       | 66           | DVN threshold percentage (1-100)                     |

### HyperlaneModule Parameters

| Parameter        | Type    | Required | Default     | Description                                  |
| ---------------- | ------- | -------- | ----------- | -------------------------------------------- |
| lookCoin         | address | Yes      | -           | LookCoin contract address                    |
| mailbox          | address | Yes      | -           | Hyperlane mailbox address                    |
| governanceVault  | address | No       | account[0]  | Governance vault address                     |
| gasPaymaster     | address | No       | ZeroAddress | Gas paymaster address                        |
| domain           | number  | No       | 56          | Hyperlane domain ID                          |
| trustedSenders   | string  | No       | "{}"        | JSON string of trusted senders by domain     |
| gasConfig        | string  | No       | "{}"        | JSON string of gas configs by domain         |

### CelerModule Parameters

| Parameter            | Type    | Required | Default         | Description                            |
| -------------------- | ------- | -------- | --------------- | -------------------------------------- |
| messageBus           | address | No       | ZeroAddress     | Celer message bus address              |
| lookCoin             | address | Yes      | -               | LookCoin contract address              |
| governanceVault      | address | No       | account[0]      | Governance vault address               |
| chainId              | number  | No       | 56              | Current chain ID                       |
| remoteModules        | string  | No       | "{}"            | JSON string of remote module addresses |
| celerSupportedChains | string  | No       | "56,10,23295"   | Comma-separated supported chain IDs    |
| feePercentage        | number  | No       | 50              | Fee percentage in basis points         |
| minFee               | string  | No       | "10"            | Minimum fee in ether units             |
| maxFee               | string  | No       | "1000"          | Maximum fee in ether units             |
| feeCollector         | address | No       | governanceVault | Fee collector address                  |

### OracleModule Parameters

| Parameter              | Type    | Required | Default                | Description                              |
| ---------------------- | ------- | -------- | ---------------------- | ---------------------------------------- |
| governanceVault        | address | No       | account[0]             | Governance vault address                 |
| totalSupply            | string  | No       | "1000000000"           | Total supply in ether units              |
| reconciliationInterval | number  | No       | 900                    | Reconciliation interval in seconds       |
| toleranceThreshold     | string  | No       | "1000"                 | Tolerance threshold in ether units       |
| requiredSignatures     | number  | No       | 3                      | Required oracle signatures               |
| bridgeRegistrations    | string  | No       | "{}"                   | JSON string of bridge addresses by chain |
| supportedChains        | string  | No       | "56,8453,10,23295,999" | Comma-separated chain IDs                |

### MocksModule Parameters

| Parameter           | Type   | Required | Default                | Description             |
| ------------------- | ------ | -------- | ---------------------- | ----------------------- |
| mockBaseChainId     | number | No       | 56                     | Base chain ID for mocks |
| mockSupportedChains | string | No       | "56,8453,10,23295,999" | Supported chains        |
| celerFeeBase        | string | No       | "0.001"                | Base fee in ether units |
| celerFeePerByte     | string | No       | "0.000000001"          | Fee per byte in ether   |
| hyperlaneGasLimit   | number | No       | 200000                 | Hyperlane gas limit     |
| hyperlaneFee        | string | No       | "0.01"                 | Hyperlane fee in ether  |
| networkLatency      | number | No       | 1000                   | Network latency in ms   |
| packetLoss          | number | No       | 0                      | Packet loss percentage  |
| networkJitter       | number | No       | 100                    | Network jitter in ms    |

## Deployment Instructions

### 1. Prepare Parameter File

Create a parameter file for your target network in `ignition/parameters/`. Example files are provided for:

- `bsc-mainnet.json` - BSC mainnet deployment
- `bsc-testnet.json` - BSC testnet deployment
- `base-mainnet.json` - Base mainnet deployment
- `op-mainnet.json` - Optimism mainnet deployment
- `local-hardhat.json` - Local testing

### 2. Deploy Individual Modules

Deploy modules in the following order:

```bash
# 1. Deploy LookCoin first
npx hardhat ignition deploy ignition/modules/LookCoinModule.ts \
  --parameters ignition/parameters/bsc-mainnet.json \
  --network bsc-mainnet

# 2. Deploy bridge modules (can be done in parallel)
npx hardhat ignition deploy ignition/modules/HyperlaneModule.ts \
  --parameters ignition/parameters/bsc-mainnet.json \
  --network bsc-mainnet

npx hardhat ignition deploy ignition/modules/CelerModule.ts \
  --parameters ignition/parameters/bsc-mainnet.json \
  --network bsc-mainnet

# 3. Deploy oracle
npx hardhat ignition deploy ignition/modules/OracleModule.ts \
  --parameters ignition/parameters/bsc-mainnet.json \
  --network bsc-mainnet

# 4. Deploy mocks (only for testing)
npx hardhat ignition deploy ignition/modules/MocksModule.ts \
  --parameters ignition/parameters/local-hardhat.json \
  --network hardhat
```

## Three-Stage Deployment Process

LookCoin uses a three-stage deployment process to ensure proper contract setup and cross-chain connectivity:

### Stage 1: Deploy

**Purpose**: Creates contracts and deployment artifacts using Hardhat Ignition modules
**What it does**:

- Deploys all smart contracts (LookCoin, bridge modules, SupplyOracle) using Ignition modules
- Creates deployment artifacts in `deployments/{network}.json`
- Initializes contracts with basic parameters from centralized configuration
- Assigns only administrative roles (no operational roles)

### Stage 2: Setup

**Purpose**: Assigns operational roles and configures local settings post-deployment
**What it does**:

- Assigns MINTER_ROLE to HyperlaneModule and CelerIMModule on the LookCoin contract
- Grants BURNER_ROLE to LookCoin contract itself for LayerZero burns
- Registers local bridges with SupplyOracle for the current network only
- Configures rate limiting parameters
- Operates on a single network using only local deployment artifacts

### Stage 3: Configure

**Purpose**: Establishes cross-chain connections between multiple networks
**What it does**:

- Sets up LayerZero trusted remotes using contract addresses from other networks
- Configures Celer IM remote modules for cross-chain messaging
- Registers bridges from ALL networks in the local SupplyOracle
- Requires deployment artifacts from other networks via `loadOtherChainDeployments()`

### Post-Deployment Configuration

After Ignition deployment, follow the three-stage process:

```bash
# Stage 1: Deploy (using Ignition modules above)
npm run deploy:bsc-testnet

# Stage 2: Setup (configure local roles and settings)
npm run setup:bsc-testnet

# Stage 3: Configure (establish cross-chain connections)
# Only available for networks with deployment artifacts from other chains
npm run configure:bsc-testnet          # BSC Testnet
npm run configure:base-sepolia         # Base Sepolia
npm run configure:optimism-sepolia     # Optimism Sepolia
npm run configure:sapphire-mainnet     # Oasis Sapphire Mainnet
```

**Execution Order**: Always follow this sequence: **Deploy (Ignition) → Setup → Configure**

**Note**: Configure scripts are only available for networks that have deployment artifacts from other networks. The `configure.ts` script requires deployment JSON files from other networks to load contract addresses for cross-chain setup. Currently, only 4 networks support the configure stage: base-sepolia, bsc-testnet, optimism-sepolia, and sapphire-mainnet, representing all networks with the necessary deployment artifacts for cross-chain configuration.

## Troubleshooting Guide

### Common Errors and Solutions

#### 1. Parameter Type Issues

**Error**: "Parameter validation failed: expected valid address, got undefined"

**Solution**: Ensure all addresses in parameter files are properly formatted (0x-prefixed, 40 hex characters). Use string format for all parameters.

#### 2. Array Parameter Issues

**Error**: "Hyperlane requires valid mailbox address"

**Solution**: Ensure the mailbox address is properly configured for your network:

```json
"mailbox": "0x1234567890123456789012345678901234567890"
```

#### 3. BigInt Parameter Issues

**Error**: "Cannot convert X to BigInt"

**Solution**: Provide all token amounts as strings in ether units:

```json
"totalSupply": "1000000000",  // 1 billion tokens
"minFee": "10"                 // 10 tokens
```

#### 4. ZeroAddress Issues

**Error**: "Parameter 'lookCoin' validation failed: expected non-zero address"

**Solution**: Ensure you've deployed LookCoin first and updated the parameter file with its address before deploying bridge modules.

#### 5. Remote Module Configuration

**Error**: "remoteModules must be different from current chain ID"

**Solution**: Ensure remote module addresses are for different chains:

```json
"remoteModules": "{\"10\":\"0x...\",\"8453\":\"0x...\"}"
```

### Network-Specific Failures

#### BSC Mainnet

- Ensure sufficient BNB for gas fees
- Use correct LayerZero endpoint: `0x3c2269811836af69497E5F486A85D7316753cf62`
- Verify Celer message bus: `0xAd204986D6cB67A5Bc76a3CB8974823F43Cb9AAA`

#### Base Mainnet

- LayerZero endpoint: `0x1a44076050125825900e736c501f859c50fE728c`
- No Celer support on Base - use LayerZero for bridging

#### Optimism Mainnet

- Celer message bus: `0x4066D196A423b2b3B8B054f4F40efB47a74E200C`
- No LayerZero OFT support - use Celer for bridging

## Parameter File Examples

### Minimal Testing Configuration

```json
{
  "LookCoinModule": {
    "governanceVault": "0xYourGovernanceVault",
    "totalSupply": "1000000"
  }
}
```

### Full Production Configuration

See `ignition/parameters/bsc-mainnet.json` for a complete example with all parameters configured.

### Custom Network Configuration

To add support for a new network:

1. Create a new parameter file: `ignition/parameters/[network]-mainnet.json`
2. Update chain-specific addresses (endpoints, message bus, etc.)
3. Configure supported chains for bridges
4. Adjust fee parameters based on network gas costs

## Validation Rules

The parameter validation system enforces the following rules:

1. **Addresses** - Must be valid Ethereum addresses (0x + 40 hex chars)
2. **Non-Zero Addresses** - Critical addresses cannot be ZeroAddress
3. **Chain IDs** - Must be positive integers
4. **Domain IDs** - Must match Hyperlane domain configuration
5. **Fee Relationships** - minFee must be less than maxFee
6. **Percentages** - Must be between 0-100 or 0-10000 (basis points)
7. **Timeouts** - Must be positive numbers
8. **Arrays** - Provided as comma-separated strings
9. **Objects** - Provided as JSON strings

## Security Considerations

1. **Parameter Files** - Never commit files with real private keys or sensitive addresses
2. **Governance Vault** - Use a secure MPC vault wallet for production
3. **Validator Addresses** - Verify all validator addresses before deployment
4. **Bridge Addresses** - Double-check remote module addresses match deployed contracts
5. **Fee Configuration** - Set appropriate fees to prevent abuse
6. **Rate Limits** - Configure based on expected usage patterns

## Support

For issues or questions:

1. Check the troubleshooting guide above
2. Review parameter validation error messages
3. Ensure contracts are compiled: `npm run compile`
4. Verify network configuration in `hardhat.config.ts`
5. Check deployment logs in `ignition/deployments/`
