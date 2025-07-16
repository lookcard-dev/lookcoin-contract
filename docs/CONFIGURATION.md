# LookCoin Centralized Configuration System

This document describes the centralized configuration system implemented for the LookCoin omnichain token project.

## Overview

The centralized configuration system consolidates all cross-chain configuration into a single source of truth located in `hardhat.config.ts`. This approach eliminates configuration duplication, reduces errors, and simplifies multi-chain deployment management.

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
    layerZero: { /* LayerZero specific config */ },
    celer: { /* Celer IM specific config */ },
    ibc: { /* IBC specific config */ },
    oracle: { /* Supply oracle config */ },
    rateLimiter: { /* Rate limiting config */ },
    remoteModules: { /* Cross-chain module mappings */ }
  },
  // ... other networks
}
```

### Key Configuration Sections

1. **LayerZero Configuration**
   - Endpoint addresses
   - Chain IDs for LayerZero protocol
   - DVN (Decentralized Verifier Network) settings
   - Confirmation requirements

2. **Celer IM Configuration**
   - MessageBus addresses
   - Celer-specific chain IDs
   - Fee parameters (percentage, min, max)
   - Fee collector addresses

3. **IBC Configuration**
   - Channel and port IDs
   - Validator sets
   - Consensus thresholds
   - Timeout parameters

4. **Oracle Configuration**
   - Bridge registrations per network
   - Update intervals
   - Tolerance thresholds

5. **Rate Limiter Configuration**
   - Per-account transaction limits
   - Time windows
   - Global daily limits

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
      endpoint: "0x...",
      lzChainId: 40123,
      dvns: ["0x...", "0x..."],
      // ... other LayerZero settings
    },
    // ... other configurations
  }
}
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
    lzEndpoint = "0x1a44076050125825900e736c501f859c50fE728c";
    break;
  case 97:
    lzEndpoint = "0x6EDCE65403992e310A62460808c4b910D972f10f";
    break;
  // ... more cases
}
```

#### After (Centralized):
```typescript
// In deploy.ts
import { getChainConfig } from "../hardhat.config";

const chainConfig = getChainConfig(networkName);
const lzEndpoint = chainConfig.layerZero.endpoint;
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

## Best Practices

1. **Always regenerate parameter files** after modifying `CHAIN_CONFIG`
2. **Run validation** before deployments to catch configuration errors early
3. **Use helper functions** like `getChainConfig()` instead of direct access
4. **Test configuration changes** in testnet before mainnet deployments
5. **Document any network-specific quirks** in comments within `CHAIN_CONFIG`

## Future Enhancements

- Dynamic configuration loading from external sources
- Configuration versioning and migration tools
- Network-specific configuration validation rules
- Automated configuration diff reporting