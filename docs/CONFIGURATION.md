# LookCoin Centralized Configuration System

This document describes the centralized configuration system implemented for the LookCoin omnichain token project.

## Overview

The centralized configuration system consolidates all cross-chain configuration into a single source of truth located in `hardhat.config.ts`. This approach eliminates configuration duplication, reduces errors, and simplifies multi-chain deployment management.

## Operational Deployment Flow

The centralized configuration system supports LookCoin's three-stage deployment process, providing configuration parameters for each stage while maintaining strict validation and tier isolation:

### Stage 1: Deploy

**Configuration Role**: The centralized `CHAIN_CONFIG` provides deployment parameters for contract creation
**How it works**:

- `scripts/deploy.ts` uses `getChainConfig(network)` to retrieve network-specific parameters
- Provides LayerZero endpoints, governance vault addresses, and initial supply settings
- Creates deployment artifacts in `deployments/{network}.json` using centralized configuration
- No cross-chain dependencies - operates purely from centralized config

### Stage 2: Setup

**Configuration Role**: The centralized config provides role assignment and local bridge registration parameters
**How it works**:

- `scripts/setup.ts` uses centralized config to determine which roles to assign to which contracts
- Configures rate limiting parameters from `CHAIN_CONFIG.rateLimiter`
- Registers only local bridges with SupplyOracle based on network's supported bridge types
- Operates on single network using centralized config + local deployment artifacts

### Stage 3: Configure

**Configuration Role**: The centralized config provides cross-chain connection parameters AND requires deployment artifacts from other networks
**How it works**:

- `scripts/configure.ts` uses centralized config to determine which networks to connect to
- Calls `loadOtherChainDeployments()` to scan `/deployments` directory for JSON files from other networks
- Combines centralized config parameters with actual deployed contract addresses
- Establishes LayerZero trusted remotes using addresses from deployment artifacts
- Sets up Celer IM remote modules using both centralized config and deployed contract addresses
- Implements network tier validation to prevent mainnet/testnet mixing

### Technical Dependencies

The configure stage has a unique dependency structure:

- **Centralized Configuration**: Provides network parameters, bridge settings, and cross-chain mappings
- **Deployment Artifacts**: Required from other networks to load actual contract addresses
- **Tier Validation**: Uses centralized config to classify networks and prevent cross-tier configuration

This explains why configure scripts are only available for 4 networks (base-sepolia, bsc-testnet, optimism-sepolia, sapphire-mainnet) - these are the only networks with deployment artifacts from other networks available in the `/deployments` directory. As more networks are deployed, their configure scripts will become available automatically.

## Architecture

### Configuration Structure

The main configuration object `CHAIN_CONFIG` in `hardhat.config.ts` contains comprehensive settings for each supported network:

```typescript
export const CHAIN_CONFIG: { [network: string]: ChainConfig } = {
  bsc: {
    chainId: 56,
    name: "BSC Mainnet",
    totalSupply: "10000000000000000000000000000", // 10 billion tokens
    governanceVault: "0x...", // MPC vault address
    layerZero: {
      /* LayerZero specific config */
    },
    celer: {
      /* Celer IM specific config */
    },
    ibc: {
      /* IBC specific config */
    },
    oracle: {
      /* Supply oracle config */
    },
    rateLimiter: {
      /* Rate limiting config */
    },
    remoteModules: {
      /* Cross-chain module mappings */
    },
  },
  // ... other networks
};
```

### Key Configuration Sections

1. **LayerZero Configuration**
   - Endpoint addresses (V2 endpoints):
     - Mainnet networks: `0x1a44076050125825900e736c501f859c50fE728c`
     - Testnet networks: `0x6EDCE65403992e310A62460808c4b910D972f10f`
   - Chain IDs for LayerZero protocol
   - DVN (Decentralized Verifier Network) settings:
     - BSC: LayerZero Labs, Google Cloud, Nethermind
     - Base: LayerZero Labs, Google Cloud, Nethermind
     - Optimism: LayerZero Labs, Google Cloud, Nethermind
   - Confirmation requirements

2. **Celer IM Configuration**
   - MessageBus addresses
   - Celer-specific chain IDs
   - Fee parameters:
     - Fee percentage: 0.1% (10 basis points)
     - Minimum fee: 1 LOOK
     - Maximum fee: 100 LOOK
   - Fee collector addresses

3. **IBC Configuration**
   - Chain ID: 9070 (Akashic)
   - Channel ID: channel-0
   - Port ID: transfer
   - Validator sets:
     - Minimum validators: 21
     - Threshold: 14 (2/3 majority)
   - Unbonding period: 14 days
   - Packet timeout: 1 hour

4. **Oracle Configuration**
   - Bridge registrations per network
   - Update intervals
   - Tolerance thresholds

5. **Rate Limiter Configuration**
   - Per-account transaction limits
   - Time windows
   - Global daily limits

### Bridge Support Matrix

| Network  | LayerZero | Celer IM | IBC |
| -------- | --------- | -------- | --- |
| BSC      | ✓         | ✓        | ✗   |
| Base     | ✓         | ✗        | ✗   |
| Optimism | ✓         | ✓        | ✗   |
| Sapphire | ✗         | ✓        | ✗   |
| Akashic  | ✗         | ✗        | ✓   |

## Usage

### Adding a New Network

To add a new network, add an entry to `CHAIN_CONFIG`:

```typescript
export const CHAIN_CONFIG = {
  // ... existing networks
  newNetwork: {
    chainId: 12345,
    name: "New Network",
    totalSupply: "0", // For non-home chains
    governanceVault: process.env.GOVERNANCE_VAULT || "0x...",
    layerZero: {
      endpoint: "0x1a44076050125825900e736c501f859c50fE728c", // V2 mainnet endpoint
      lzChainId: 40123,
      dvns: ["0x...", "0x..."], // Network-specific DVN addresses
      // ... other LayerZero settings
    },
    celer: {
      messageBus: "0x...",
      celerChainId: 12345,
      fees: {
        percentage: 10, // 0.1%
        minFee: "1000000000000000000", // 1 LOOK
        maxFee: "100000000000000000000", // 100 LOOK
      },
    },
    // ... other configurations
  },
};
```

### Generating Ignition Parameters

After modifying the configuration, regenerate the Ignition parameter files:

```bash
npm run config:generate
```

This command runs the config generator script that creates JSON parameter files from the centralized configuration.

### Validating Configuration

To validate the configuration for completeness and consistency:

```bash
npm run config:validate
```

### Checking for Hardcoded Values

To scan the codebase for any remaining hardcoded configuration values:

```bash
npm run lint:config
```

## Migration Guide

### From Scattered Configuration

1. **Environment Variables**: Previously stored in `.env` files, now centralized in `CHAIN_CONFIG`
2. **Hardcoded Values**: Previously scattered in scripts, now referenced via `getChainConfig(network)`
3. **JSON Parameters**: Previously manually maintained, now auto-generated

### Code Changes

#### Before (Scattered):

```typescript
// In deploy.ts
switch (chainId) {
  case 56:
    lzEndpoint = "0x3c2269811836af69497E5F486A85D7316753cf62"; // Old V1 endpoint
    break;
  case 97:
    lzEndpoint = "0x83c73Da98cf733B03315aFa8758834b36a195b87"; // Old V1 endpoint
    break;
  // ... more cases
}
```

#### After (Centralized):

```typescript
// In deploy.ts
import { getChainConfig } from "../hardhat.config";

const chainConfig = getChainConfig(networkName);
const lzEndpoint = chainConfig.layerZero.endpoint; // V2 endpoint from centralized config
// For mainnet: 0x1a44076050125825900e736c501f859c50fE728c
// For testnet: 0x6EDCE65403992e310A62460808c4b910D972f10f
```

## Configuration Files

### Auto-Generated Files

The following files are auto-generated and should not be edited manually:

- `ignition/parameters/*.json` - Generated from `CHAIN_CONFIG`

### Source Files

- `hardhat.config.ts` - Central configuration source
- `scripts/utils/config-generator.ts` - Configuration generator utility

## Testing

The test suite uses a dedicated configuration utility (`test/utils/testConfig.ts`) that provides:

- Common test constants derived from the centralized config
- Helper functions for mock deployments
- Test-specific configuration overrides

Example usage in tests:

```typescript
import { TEST_CHAINS, ROLES, getChainConfig } from "./utils/testConfig";

// Use centralized chain IDs
const bscChainId = TEST_CHAINS.BSC;

// Use pre-calculated role hashes
const minterRole = ROLES.MINTER_ROLE;

// Get configuration for a specific network
const bscConfig = getChainConfig("bsc");
```

## Troubleshooting

### Common Issues

1. **Configuration Not Found Error**
   - Ensure the network name matches exactly (case-sensitive)
   - Check that the network is defined in `CHAIN_CONFIG`

2. **Parameter Generation Fails**
   - Validate configuration with `npm run config:validate`
   - Check for missing required fields

3. **Deployment Scripts Fail**
   - Ensure parameter files are regenerated after config changes
   - Verify governance vault address is set correctly

### Debug Commands

```bash
# Validate specific network configuration
npm run config:validate -- <network-name>

# Generate parameters for specific network
npm run config:generate -- <network-name>

# Check deployment configuration
npx hardhat run scripts/utils/config-generator.ts validate
```

## Network Tier Isolation

### Overview

Network tier isolation is a critical security feature that prevents accidental cross-tier configuration between mainnet and testnet environments. This protection helps prevent serious security vulnerabilities where testnet contracts could be granted trust relationships with mainnet contracts.

### Understanding Network Tiers

Networks are classified into three tiers:

1. **mainnet** - Production networks with real value (BSC Mainnet, Base, Optimism, etc.)
2. **testnet** - Test networks for development and testing (BSC Testnet, Base Sepolia, etc.)
3. **dev** - Local development networks (Hardhat)

### Security Risks of Cross-Tier Configuration

Cross-tier configuration can lead to severe security vulnerabilities:

- **Supply Manipulation**: Testnet contracts could mint unlimited tokens and affect mainnet supply calculations
- **Oracle Deception**: Supply oracle could be tricked by testnet transactions into incorrect reconciliation
- **Rate Limit Bypass**: Attackers could use testnet tokens to bypass mainnet rate limits
- **Trust Exploitation**: Mainnet contracts trusting testnet addresses could be exploited

### Default Protection

By default, the configuration script (`configure.ts`) will:

1. **Detect** cross-tier deployment attempts
2. **Block** configuration if mainnet/testnet mixing is detected
3. **Provide** clear error messages explaining the issue
4. **Suggest** safe alternatives

Example error:

```
Cross-tier configuration detected but not allowed!

Current network is mainnet tier, but found deployments from:
  - BSC Testnet (chain 97, testnet tier)
  - Base Sepolia (chain 84532, testnet tier)

To allow cross-tier configuration, use --force-cross-tier flag or set CROSS_TIER_OK=1
```

### Override Procedures

In rare cases where cross-tier configuration is intentionally required (e.g., testing cross-tier bridge behavior), you can override the protection:

#### Method 1: Command-Line Flag

```bash
npx hardhat run scripts/configure.ts --network bsc-mainnet -- --force-cross-tier
```

#### Method 2: Environment Variable

```bash
CROSS_TIER_OK=1 npx hardhat run scripts/configure.ts --network bsc-mainnet
```

#### Safety Confirmation

When overrides are used, the script will:

1. Display a prominent warning about the risks
2. List all cross-tier connections that will be established
3. Require manual confirmation (unless in CI mode)

### Troubleshooting

#### Common Issues

1. **"Unknown network tier" error**
   - Ensure the network is properly configured in `hardhat.config.ts`
   - Check that the `tier` property is set for the network

2. **Deployment files causing conflicts**
   - Keep separate deployment directories for mainnet and testnet
   - Clean up old deployment files: `rm deployments/*-testnet.json`

3. **CI/CD pipeline failures**
   - Ensure deployment artifacts are separated by environment
   - Use `CI=true` environment variable to skip interactive confirmations

#### Identifying Tier Conflicts

To see which deployments are causing issues:

```bash
# List all deployment files
ls -la deployments/

# Check specific deployment tier
cat deployments/bsc-testnet.json | grep chainId
```

### Best Practices

1. **Separate Deployment Directories**

   ```bash
   deployments/
   ├── mainnet/
   │   ├── bsc-mainnet.json
   │   └── base-mainnet.json
   └── testnet/
       ├── bsc-testnet.json
       └── base-sepolia.json
   ```

2. **CI/CD Configuration**
   - Use separate deployment jobs for mainnet and testnet
   - Store deployment artifacts in environment-specific locations
   - Never mix mainnet and testnet artifacts in the same pipeline

3. **Configuration Reviews**
   - Always review the configuration summary before confirming
   - Check for tier warnings in the output (marked with ⚠️)
   - Verify the `tierValidation` section in saved configurations

4. **Emergency Response**
   - If cross-tier configuration is discovered in production:
     1. Immediately pause affected contracts
     2. Revoke cross-tier trust relationships
     3. Audit for any suspicious activity
     4. Reconfigure with proper tier isolation

### Historical Context

This network tier isolation feature was added after discovering a critical vulnerability where the configuration script could establish trust relationships between mainnet and testnet contracts without any warnings. This could have allowed attackers to:

- Mint tokens on testnet and affect mainnet supply calculations
- Bypass rate limits using testnet transactions
- Manipulate oracle data through testnet activity

The protection system now ensures such misconfigurations are caught early and require explicit, conscious override decisions.

## Best Practices

1. **Always regenerate parameter files** after modifying `CHAIN_CONFIG`
2. **Run validation** before deployments to catch configuration errors early
3. **Use helper functions** like `getChainConfig()` instead of direct access
4. **Test configuration changes** in testnet before mainnet deployments
5. **Document any network-specific quirks** in comments within `CHAIN_CONFIG`
6. **Maintain tier separation** between mainnet and testnet deployments
7. **Review tier warnings** in configuration output before proceeding

## Revision History

| Date    | Version | Description                                                                                                             |
| ------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| 2024-12 | 1.0.0   | Initial centralized configuration migration                                                                             |
| 2025-01 | 1.1.0   | Major updates: LayerZero V2 endpoints, revised Celer fee structure (0.1%), corrected chain IDs, added DVN configuration |

### Key Changes in Version 1.1.0

1. **LayerZero V2 Migration**
   - Updated all endpoints from V1 to V2 addresses
   - Added DVN (Decentralized Verifier Network) configuration for BSC, Base, and Optimism
   - Maintained backward compatibility through centralized configuration

2. **Fee Structure Optimization**
   - Reduced Celer IM bridge fees from 0.5% to 0.1% (10 basis points)
   - Lowered minimum fee from 10 LOOK to 1 LOOK
   - Decreased maximum fee from 1,000 LOOK to 100 LOOK

3. **Chain ID Corrections**
   - Fixed Oasis Sapphire mainnet chain ID: 23294
   - Corrected Oasis Sapphire testnet chain ID: 23295
   - Confirmed Akashic chain ID: 9070

4. **Enhanced IBC Configuration**
   - Added complete validator set parameters
   - Specified consensus thresholds and timeouts
   - Documented channel and port IDs

## Future Enhancements

- Dynamic configuration loading from external sources
- Configuration versioning and migration tools
- Network-specific configuration validation rules
- Automated configuration diff reporting
