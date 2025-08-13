---
description: Common issues and solutions for LookCoin smart contract operations
cover: .gitbook/assets/troubleshooting-cover.png
coverY: 0
---

# Troubleshooting Guide

{% hint style="warning" %}
**Quick Help**: For immediate assistance, check the [Quick Start Guide](QUICK_START.md#troubleshooting) for common setup issues.
{% endhint %}

## How to Use This Guide

This troubleshooting guide is organized by problem category. Use the table of contents to jump to your specific issue:

1. **Deployment Issues** - Problems during contract deployment
2. **Bridge Operations** - Cross-chain transfer failures
3. **Supply Oracle Issues** - Supply monitoring and reconciliation
4. **Testing Issues** - Development and testing problems
5. **Performance Issues** - Gas optimization and efficiency

**Related Resources**:
- [Deployment Guide](deployment/guide.md) - Complete deployment instructions
- [API Reference](API_REFERENCE.md) - Contract interface documentation
- [Best Practices](BEST_PRACTICES.md) - Prevention guidelines

## Deployment Issues

### "No deployment found for network"

**Problem**: Deployment script fails to find existing deployment artifacts.

**Cause**: Missing deployment JSON file or incorrect network configuration.

**Solutions**:

1. **Run deployment first**:
   ```bash
   npm run deploy:bsc-testnet
   ```

2. **Check deployment file exists**:
   ```bash
   ls deployments/bsctestnet.json
   ```

3. **Verify network name matches configuration**:
   - Check `hardhat.config.ts` network names
   - Ensure file naming follows canonical format (lowercase, no dashes)

### "Cross-tier configuration detected"

**Problem**: Configuration script detects mixed testnet/mainnet deployments.

**Cause**: Attempting to configure connections between different network tiers.

**Solutions**:

1. **Use force flag for intentional cross-tier setup**:
   ```bash
   npm run configure:bsc-testnet -- --force-cross-tier
   ```

2. **Deploy to matching network tier**:
   - Testnet to testnet (bsc-testnet ↔ base-sepolia)
   - Mainnet to mainnet (bsc-mainnet ↔ base-mainnet)

3. **Check deployment artifacts**:
   ```bash
   # Verify all deployments are same tier
   grep -r "chainId" deployments/
   ```

### "Insufficient funds for gas"

**Problem**: Deployer account lacks native tokens for gas fees.

**Solutions**:

1. **Fund deployer wallet**:
   - **BSC Testnet**: https://testnet.binance.org/faucet-smart
   - **Base Sepolia**: https://bridge.base.org/deposit
   - **Optimism Sepolia**: https://bridge.optimism.io/

2. **Check balance**:
   ```bash
   # Use appropriate network RPC
   curl -X POST https://data-seed-prebsc-1-s1.binance.org:8545/ \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["YOUR_ADDRESS","latest"],"id":1}'
   ```

3. **Reduce gas limit** (if safe to do so):
   ```typescript
   // In hardhat.config.ts
   networks: {
     bscTestnet: {
       gasLimit: 5000000 // Reduce if needed
     }
   }
   ```

### "Contract verification failed"

**Problem**: Block explorer verification fails after deployment.

**Solutions**:

1. **Wait for indexing** (5-10 minutes after deployment):
   ```bash
   npm run verify:bsc-testnet
   ```

2. **Check constructor arguments**:
   ```bash
   # Verify arguments match deployment
   grep -A 10 "constructor" contracts/LookCoin.sol
   ```

3. **Use flatten source** (if needed):
   ```bash
   npx hardhat flatten contracts/LookCoin.sol > LookCoin_flattened.sol
   ```

## Bridge Operation Issues

### "Bridge transaction reverts"

**Problem**: Cross-chain bridge transactions fail with revert.

**Diagnosis**:
```bash
# Check transaction details
npx hardhat run scripts/debug-transaction.ts --network bsc-testnet
```

**Common Causes & Solutions**:

1. **Insufficient balance**:
   ```solidity
   // Check token balance
   uint256 balance = lookCoin.balanceOf(userAddress);
   require(balance >= amount, "Insufficient balance");
   ```

2. **Missing allowance** (for `sendFrom`):
   ```solidity
   // Approve tokens first
   lookCoin.approve(bridgeAddress, amount);
   ```

3. **Destination chain not configured**:
   ```bash
   # Configure cross-chain connections
   npm run configure:source-network
   npm run configure:destination-network
   ```

4. **Insufficient native gas**:
   ```javascript
   // Estimate fees first
   const fees = await lookCoin.estimateSendFee(
     dstChainId,
     recipient,
     amount,
     false,
     "0x"
   );
   
   // Send with proper value
   await lookCoin.bridgeToken(dstChainId, recipient, amount, {
     value: fees.nativeFee
   });
   ```

### "LayerZero message not received"

**Problem**: Bridge transaction succeeds on source but doesn't arrive on destination.

**Diagnosis**:

1. **Check LayerZero scan**:
   - Visit: https://layerzeroscan.com/
   - Search transaction hash
   - Monitor message status

2. **Verify trusted remotes**:
   ```javascript
   const trustedRemote = await lookCoin.trustedRemoteLookup(dstChainId);
   console.log("Trusted remote:", trustedRemote);
   ```

**Solutions**:

1. **Wait for message processing** (can take 5-15 minutes)

2. **Retry with higher gas** (if message failed):
   ```javascript
   const adapterParams = ethers.solidityPacked(
     ["uint16", "uint256"],
     [1, 200000] // 200k gas limit
   );
   ```

3. **Contact LayerZero support** for stuck messages

### "Celer message execution failed"

**Problem**: Celer bridge message fails during execution.

**Diagnosis**:
```javascript
// Check Celer message status
const messageStatus = await celerMessageBus.executedMessages(messageId);
```

**Solutions**:

1. **Wait for SGN consensus** (5-20 minutes typical)

2. **Check remote module registration**:
   ```bash
   # Verify remote modules are registered
   npm run verify-celer-config
   ```

3. **Manual message execution** (if supported):
   ```javascript
   // Execute message manually if needed
   await celerMessageBus.executeMessage(
     srcChainId,
     messageBytes,
     executor
   );
   ```

## Supply Oracle Issues

### "Supply deviation detected"

**Problem**: Supply oracle detects mismatch and pauses bridges.

**Diagnosis**:
```javascript
const globalSupply = await supplyOracle.getGlobalSupply();
const expectedSupply = 5000000000; // 5B cap
const deviation = Math.abs(globalSupply - expectedSupply);
```

**Solutions**:

1. **Run manual reconciliation**:
   ```bash
   npm run reconcile:bsc-mainnet
   ```

2. **Check individual chain supplies**:
   ```javascript
   for (const chainId of [56, 10, 8453]) {
     const supply = await supplyOracle.getSupplyByChain(chainId);
     console.log(`Chain ${chainId}:`, supply);
   }
   ```

3. **Admin intervention** (if deviation is valid):
   ```javascript
   // Requires ORACLE_ROLE
   await supplyOracle.forceReconcile(newSupplyData);
   ```

### "Oracle signatures invalid"

**Problem**: Supply oracle rejects update due to insufficient signatures.

**Requirements**: Minimum 3 oracle signatures needed.

**Solutions**:

1. **Coordinate oracle operators**:
   - Ensure all oracle operators submit signatures
   - Verify signature timing (within valid window)

2. **Check oracle role assignments**:
   ```javascript
   const hasRole = await supplyOracle.hasRole(ORACLE_ROLE, oracleAddress);
   ```

3. **Emergency override** (MPC vault only):
   ```javascript
   // Requires DEFAULT_ADMIN_ROLE
   await supplyOracle.emergencyUpdate(supplyData);
   ```

## Testing Issues

### "Test failures on fresh install"

**Problem**: Tests fail immediately after repository clone.

**Solutions**:

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Compile contracts**:
   ```bash
   npm run compile
   ```

3. **Clear hardhat cache**:
   ```bash
   rm -rf artifacts/ cache/
   npm run compile
   ```

4. **Check node version** (requires Node.js 18+):
   ```bash
   node --version
   ```

### "Fork tests failing"

**Problem**: Mainnet fork tests fail with RPC errors.

**Solutions**:

1. **Check RPC endpoint**:
   ```bash
   # Test RPC connectivity
   curl -X POST https://bsc-dataseed.binance.org/ \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   ```

2. **Use alternative RPC**:
   ```typescript
   // In hardhat.config.ts
   networks: {
     hardhat: {
       forking: {
         url: "https://rpc.ankr.com/bsc", // Alternative RPC
         blockNumber: 12345678
       }
     }
   }
   ```

3. **Increase timeout**:
   ```typescript
   // In test files
   this.timeout(60000); // 60 second timeout
   ```

## Gas and Performance Issues

### "Transaction gas limit exceeded"

**Problem**: Deployment or function calls exceed block gas limit.

**Solutions**:

1. **Optimize contract size**:
   ```bash
   # Check contract sizes
   npm run size
   ```

2. **Increase gas limit**:
   ```typescript
   // In function call
   await contract.function({
     gasLimit: 5000000
   });
   ```

3. **Split large operations**:
   ```javascript
   // Batch operations instead of single large call
   for (const batch of batches) {
     await contract.processBatch(batch);
   }
   ```

### "High gas costs"

**Problem**: Operations consume excessive gas.

**Analysis**:
```bash
# Generate gas report
npm run test:gas
```

**Optimizations**:

1. **Use `bridgeToken()` instead of `sendFrom()`** for simple transfers
2. **Batch operations** when possible
3. **Optimize adapter parameters** for LayerZero
4. **Time transactions** during low network congestion

## Security Issues

### "Access control error"

**Problem**: Function calls fail with access control errors.

**Diagnosis**:
```javascript
const hasRole = await contract.hasRole(REQUIRED_ROLE, address);
console.log(`Address ${address} has required role:`, hasRole);
```

**Solutions**:

1. **Grant required role**:
   ```javascript
   // Requires admin role
   await contract.grantRole(REQUIRED_ROLE, address);
   ```

2. **Use correct signer**:
   ```javascript
   const contractWithSigner = contract.connect(authorizedSigner);
   await contractWithSigner.restrictedFunction();
   ```

3. **Check role hierarchy**:
   ```javascript
   // Verify admin role structure
   const adminRole = await contract.getRoleAdmin(REQUIRED_ROLE);
   ```

### "Reentrancy guard error"

**Problem**: Function fails with reentrancy protection.

**Cause**: Function called recursively or from within callback.

**Solutions**:

1. **Avoid recursive calls**
2. **Complete state changes before external calls**
3. **Use pull payment pattern** instead of push payments

## Performance Monitoring

### Enable Debug Logging

```bash
# Enable deployment debugging
DEBUG_DEPLOYMENT=true npm run deploy:network

# Enable transaction debugging
DEBUG_TX=true npm run setup:network
```

### Monitor Events

```javascript
// Monitor bridge events
lookCoin.on("TokensBridged", (from, dstChainId, to, amount, event) => {
  console.log(`Bridge: ${amount} LOOK from ${from} to chain ${dstChainId}`);
  console.log(`Transaction: ${event.transactionHash}`);
});

// Monitor supply oracle events
supplyOracle.on("SupplyMismatch", (expected, actual, deviation, event) => {
  console.warn(`Supply mismatch detected: ${deviation} deviation`);
});
```

### Gas Tracking

```javascript
// Track gas usage
const tx = await contract.function();
const receipt = await tx.wait();
console.log(`Gas used: ${receipt.gasUsed.toString()}`);
console.log(`Gas price: ${tx.gasPrice?.toString()}`);
```

## Getting Additional Help

### Documentation Resources
- **Technical Architecture**: [TECHNICAL.md](TECHNICAL.md)
- **Deployment Guide**: [DEPLOYMENT.md](DEPLOYMENT.md)
- **User Flow**: [USER_FLOW.md](USER_FLOW.md)
- **API Reference**: [API_REFERENCE.md](API_REFERENCE.md)

### External Resources
- **LayerZero Docs**: https://layerzero.gitbook.io/docs/
- **Celer Docs**: https://celer.network/docs/
- **Hardhat Docs**: https://hardhat.org/docs/

### Support Channels
- **GitHub Issues**: Create detailed issue with error logs
- **Discord/Slack**: Real-time support from dev team
- **Email**: support@lookcard.io for critical issues

---

**💡 Pro Tip**: Always include full error messages, transaction hashes, and relevant logs when seeking help.