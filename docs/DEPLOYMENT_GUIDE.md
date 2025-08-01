# LookCoin Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying LookCoin across multiple chains with proper supply management.

## Global Supply Management

LookCoin has a **global supply cap of 5 billion LOOK tokens** managed through a burn-and-mint mechanism across all chains.

### Key Principles

1. **Home Chain (BSC)**: The BSC deployment is the home chain and should mint the full supply (as configured in `TOTAL_SUPPLY`) initially
2. **Secondary Chains**: All other chains (Base, Optimism, Akashic) start with 0 supply and receive tokens only through bridges
3. **Supply Monitoring**: The SupplyOracle monitors total supply across all chains and automatically pauses bridges if supply exceeds the configured limit

## Deployment Process

### Step 1: Deploy to Home Chain (BSC)

```bash
# Deploy to BSC (testnet or mainnet)
npm run deploy:bsc-testnet  # or deploy:bsc-mainnet
```

### Step 2: Setup Home Chain

```bash
# Configure roles and settings
npm run setup:bsc-testnet  # or setup:bsc-mainnet
```

During setup, the script will:
1. **Check and update SupplyOracle's expected supply** - If not set to 5 billion LOOK, it will automatically update it
2. **Check if tokens have been minted** - If not, it will provide the exact command to mint them
3. **Configure all necessary roles** - Grant roles to MPC vault, dev team, and bridge modules

### Step 3: Initial Token Minting (BSC Only)

After deployment and setup on BSC, mint the full supply:

```javascript
// This command will be provided by the setup script
// Example for MPC Vault:
const mpcVault = "0x..."; // Your MPC vault address
const amount = ethers.parseEther("5000000000"); // 5 billion LOOK
await lookCoin.mint(mpcVault, amount);
```

**Important**: 
- Only mint on the home chain (BSC)
- The MPC vault must have MINTER_ROLE (granted during setup)
- This is a one-time operation

### Step 4: Deploy to Secondary Chains

Deploy to other chains without minting any tokens:

```bash
# Deploy to secondary chains
npm run deploy:base-sepolia
npm run deploy:optimism-sepolia
npm run deploy:akashic-mainnet

# Setup each chain
npm run setup:base-sepolia
npm run setup:optimism-sepolia
npm run setup:akashic-mainnet
```

### Step 5: Configure Cross-Chain Connections

After all chains are deployed, configure the cross-chain connections:

```bash
# Configure each network (requires deployment artifacts from other chains)
npm run configure:bsc-testnet
npm run configure:base-sepolia
npm run configure:optimism-sepolia
npm run configure:akashic-mainnet
```

## Supply Verification

### Automatic Supply Configuration

The setup script automatically ensures the SupplyOracle has the correct 5 billion LOOK expected supply:
- If the current expected supply doesn't match 5 billion, it will be updated automatically
- This requires the deployer to have DEFAULT_ADMIN_ROLE on the SupplyOracle
- If the deployer lacks permissions, the script will provide manual update instructions

### Check Individual Chain Supply

Run the helper script on any deployed chain:

```bash
npx hardhat run scripts/utils/check-global-supply.ts --network bsc-testnet
```

This will show:
- Current chain's minted, burned, and circulating supply
- SupplyOracle's expected global supply (should be 5 billion LOOK)
- Recommendations for any required actions

### Monitor Cross-Chain Supply

The SupplyOracle provides global supply monitoring:

```javascript
// Check global supply health
const oracle = await ethers.getContractAt("SupplyOracle", supplyOracleAddress);
const { expectedSupply, actualSupply, isHealthy } = await oracle.getGlobalSupply();

console.log(`Expected: ${ethers.formatEther(expectedSupply)} LOOK`);
console.log(`Actual: ${ethers.formatEther(actualSupply)} LOOK`);
console.log(`Healthy: ${isHealthy}`);
```

## Common Issues and Solutions

### Issue: "No tokens have been minted on the home chain"

**Solution**: Run the mint command provided by the setup script on BSC to mint 5 billion LOOK to the MPC vault.

### Issue: "SupplyOracle expected supply doesn't match the 5 billion cap"

**Solution**: The setup script will automatically update it if the deployer has admin rights. If not:
```javascript
// Admin can manually update:
await supplyOracle.updateExpectedSupply("5000000000000000000000000000");  // 5 billion LOOK
```

### Issue: "Destination chain not configured" error when bridging

**Solution**: Ensure you've run the configure script for both source and destination chains.

### Issue: Supply mismatch causes bridge pause

**Solution**: This is a safety feature. If total supply across chains exceeds 5 billion by more than the tolerance threshold (default 1000 LOOK), bridges are automatically paused. Admin intervention required.

## Security Considerations

1. **Never mint tokens on secondary chains** - They should only receive tokens through bridges
2. **Monitor SupplyOracle regularly** - It's the guardian of supply consistency
3. **Keep bridge modules updated** - They enforce the burn-and-mint mechanism
4. **Regular reconciliation** - SupplyOracle reconciles every 15 minutes by default

## Production Checklist

- [ ] Deploy to BSC (home chain) first
- [ ] Mint exactly 5 billion LOOK on BSC to MPC vault
- [ ] Verify SupplyOracle has expectedSupply = 5 billion
- [ ] Deploy to all secondary chains with 0 initial supply
- [ ] Configure all cross-chain connections
- [ ] Test small bridge transfers before large operations
- [ ] Monitor SupplyOracle health status
- [ ] Set up automated monitoring for supply discrepancies