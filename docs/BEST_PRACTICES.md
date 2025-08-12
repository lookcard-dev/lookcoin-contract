---
description: Essential guidelines for working with LookCoin smart contracts safely and efficiently
cover: .gitbook/assets/best-practices-cover.png
coverY: 0
---

# Best Practices Guide

{% hint style="success" %}
**Security First**: These best practices are based on real-world experience and security audits. Following them will help you build secure, efficient applications.
{% endhint %}

## Guide Organization

This guide is structured for different audiences:

- **Developers** - Smart contract development and testing practices
- **Integrators** - Frontend and backend integration guidelines
- **Operators** - Deployment and maintenance procedures
- **Security Teams** - Security-focused recommendations

**Quick References**:
- [Developer Onboarding](DEVELOPER_ONBOARDING.md) - Getting started guide
- [API Reference](API_REFERENCE.md) - Contract interfaces
- [Security Overview](security/overview.md) - Security model details
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues and solutions

## Development Best Practices

### Smart Contract Development

#### Security First Approach

1. **Always Test on Testnets First**
   ```bash
   # Deploy to testnet before mainnet
   npm run deploy:bsc-testnet
   npm run test:integration
   ```

2. **Use Role-Based Access Control**
   ```solidity
   // Check permissions before sensitive operations
   require(hasRole(MINTER_ROLE, msg.sender), "Unauthorized");
   
   // Use modifiers for repeated checks
   modifier onlyMinter() {
       require(hasRole(MINTER_ROLE, msg.sender), "Unauthorized");
       _;
   }
   ```

3. **Implement Proper Reentrancy Protection**
   ```solidity
   // Use ReentrancyGuard for external calls
   function bridgeToken() external nonReentrant {
       // State changes before external calls
       _updateBalance();
       _externalCall();
   }
   ```

4. **Validate All Inputs**
   ```solidity
   function bridgeToken(uint16 dstChainId, address to, uint256 amount) external {
       require(to != address(0), "Invalid recipient");
       require(amount > 0, "Amount must be positive");
       require(supportedChains[dstChainId], "Unsupported destination");
   }
   ```

#### Code Quality Standards

1. **Use Descriptive Variable Names**
   ```solidity
   // Good
   uint256 crossChainBridgeAmount;
   uint256 destinationChainId;
   
   // Avoid
   uint256 amt;
   uint256 id;
   ```

2. **Document Complex Functions**
   ```solidity
   /**
    * @notice Bridges tokens cross-chain using burn-and-mint mechanism
    * @param dstChainId LayerZero destination chain ID
    * @param to Recipient address on destination chain
    * @param amount Token amount to bridge (18 decimals)
    * @dev Requires sufficient balance and allowance
    */
   function bridgeToken(uint16 dstChainId, address to, uint256 amount) external {
       // Implementation
   }
   ```

3. **Keep Functions Small and Focused**
   ```solidity
   // Single responsibility functions
   function _burnTokens(uint256 amount) internal {
       _burn(msg.sender, amount);
       emit TokensBurned(msg.sender, amount);
   }
   
   function _updateSupply(uint256 amount) internal {
       totalBurned += amount;
       _notifySupplyOracle();
   }
   ```

### Testing Best Practices

#### Test Coverage Standards

1. **Aim for >90% Test Coverage**
   ```bash
   # Run coverage analysis
   npm run coverage
   
   # Check coverage requirements
   npx hardhat coverage --testfiles "test/**/*.ts"
   ```

2. **Write Tests for Edge Cases**
   ```javascript
   describe("Edge Cases", function() {
     it("should handle zero amount transfers", async function() {
       await expect(lookCoin.bridgeToken(111, user.address, 0))
         .to.be.revertedWith("Amount must be positive");
     });
     
     it("should handle maximum supply", async function() {
       const maxSupply = ethers.parseEther("5000000000");
       await expect(lookCoin.mint(user.address, maxSupply.add(1)))
         .to.be.revertedWith("Exceeds supply cap");
     });
   });
   ```

3. **Test Integration Scenarios**
   ```javascript
   describe("Cross-Chain Integration", function() {
     it("should maintain supply consistency across bridges", async function() {
       // Bridge via LayerZero
       await lookCoin.bridgeToken(111, recipient, amount);
       
       // Bridge via Celer
       await router.bridgeToken(Protocol.Celer, 10, recipient, amount);
       
       // Verify global supply unchanged
       const globalSupply = await supplyOracle.getGlobalSupply();
       expect(globalSupply).to.equal(initialSupply);
     });
   });
   ```

#### Test Organization

1. **Use Descriptive Test Names**
   ```javascript
   // Good
   it("should allow MINTER_ROLE to mint tokens within supply cap")
   it("should reject bridging to unsupported destination chain")
   
   // Avoid
   it("mints tokens")
   it("bridge fails")
   ```

2. **Group Related Tests**
   ```javascript
   describe("Access Control", function() {
     describe("Minting", function() {
       it("should allow authorized minting");
       it("should reject unauthorized minting");
     });
     
     describe("Burning", function() {
       it("should allow token burning");
       it("should handle insufficient balance");
     });
   });
   ```

### Deployment Best Practices

#### Pre-Deployment Checklist

- [ ] All tests passing
- [ ] Security audit completed
- [ ] Gas optimization reviewed
- [ ] Contract size within limits
- [ ] Environment variables configured
- [ ] Network configuration verified
- [ ] Deployer wallet funded

#### Deployment Process

1. **Follow Three-Stage Process**
   ```bash
   # Always follow this order
   npm run deploy:network    # Stage 1: Deploy contracts
   npm run setup:network     # Stage 2: Configure roles
   npm run configure:network # Stage 3: Cross-chain setup
   ```

2. **Verify After Each Stage**
   ```bash
   # Check deployment artifacts
   cat deployments/network.json
   
   # Verify roles assigned
   npx hardhat run scripts/verify-roles.ts --network network
   
   # Test basic functionality
   npm run test:integration:network
   ```

3. **Document Deployment Parameters**
   ```bash
   # Create deployment report
   echo "Deployment: $(date)" >> deployment-log.md
   echo "Network: $NETWORK" >> deployment-log.md
   echo "Contracts:" >> deployment-log.md
   cat deployments/$NETWORK.json >> deployment-log.md
   ```

## Operational Best Practices

### Transaction Management

#### Gas Optimization

1. **Use Appropriate Functions**
   ```javascript
   // For simple transfers (most efficient)
   await lookCoin.bridgeToken(dstChainId, recipient, amount);
   
   // For advanced features (when needed)
   await lookCoin.sendFrom(from, dstChainId, recipient, amount, callParams);
   ```

2. **Optimize Adapter Parameters**
   ```javascript
   // Minimal gas for standard transfers
   const adapterParams = "0x";
   
   // Custom gas limit when needed
   const adapterParams = ethers.solidityPacked(
     ["uint16", "uint256"],
     [1, gasLimit]
   );
   ```

3. **Batch Operations When Possible**
   ```javascript
   // Instead of multiple individual calls
   await Promise.all([
     contract.operation1(),
     contract.operation2(),
     contract.operation3()
   ]);
   ```

#### Fee Management

1. **Always Estimate Fees First**
   ```javascript
   // Estimate LayerZero fees
   const fees = await lookCoin.estimateSendFee(
     dstChainId,
     recipient,
     amount,
     false,
     "0x"
   );
   
   // Send with estimated fee + buffer
   const feeBuffer = fees.nativeFee.mul(110).div(100); // 10% buffer
   await lookCoin.bridgeToken(dstChainId, recipient, amount, {
     value: feeBuffer
   });
   ```

2. **Handle Fee Refunds**
   ```javascript
   // Set refund address for excess fees
   const callParams = {
     refundAddress: msg.sender,
     zroPaymentAddress: ethers.ZeroAddress,
     adapterParams: "0x"
   };
   ```

### Monitoring and Maintenance

#### Supply Oracle Monitoring

1. **Set Up Automated Alerts**
   ```javascript
   // Monitor supply deviation events
   supplyOracle.on("SupplyMismatch", (expected, actual, deviation) => {
     if (deviation.gt(ethers.parseEther("50000000"))) { // 50M threshold
       sendAlert(`High supply deviation detected: ${deviation}`);
     }
   });
   ```

2. **Regular Reconciliation**
   ```bash
   # Schedule regular reconciliation (e.g., every 4 hours)
   0 */4 * * * /usr/local/bin/npm run reconcile:bsc-mainnet
   ```

3. **Health Checks**
   ```javascript
   // Regular health check script
   async function healthCheck() {
     const paused = await lookCoin.paused();
     const globalSupply = await supplyOracle.getGlobalSupply();
     const maxSupply = ethers.parseEther("5000000000");
     
     console.log("Contract paused:", paused);
     console.log("Global supply:", ethers.formatEther(globalSupply));
     console.log("Supply utilization:", globalSupply.mul(100).div(maxSupply) + "%");
   }
   ```

#### Bridge Monitoring

1. **Monitor Bridge Events**
   ```javascript
   // Track cross-chain transfers
   lookCoin.on("TokensBridged", async (from, dstChainId, to, amount, event) => {
     console.log(`Bridge initiated: ${ethers.formatEther(amount)} LOOK`);
     console.log(`From: ${from} to chain ${dstChainId}`);
     
     // Monitor for completion on destination chain
     setTimeout(() => checkBridgeCompletion(event.transactionHash), 600000); // 10 min
   });
   ```

2. **Track Bridge Performance**
   ```javascript
   const bridgeMetrics = {
     totalBridged: ethers.BigNumber.from(0),
     bridgeCount: 0,
     averageAmount: ethers.BigNumber.from(0),
     lastUpdate: Date.now()
   };
   
   // Update metrics on each bridge
   function updateMetrics(amount) {
     bridgeMetrics.totalBridged = bridgeMetrics.totalBridged.add(amount);
     bridgeMetrics.bridgeCount++;
     bridgeMetrics.averageAmount = bridgeMetrics.totalBridged.div(bridgeMetrics.bridgeCount);
     bridgeMetrics.lastUpdate = Date.now();
   }
   ```

## Security Best Practices

### Access Control Management

#### Role Assignment Guidelines

1. **Principle of Least Privilege**
   ```javascript
   // Grant minimum necessary permissions
   await contract.grantRole(OPERATOR_ROLE, operatorAddress); // Not ADMIN_ROLE
   ```

2. **Multi-Signature for Critical Operations**
   ```javascript
   // Use MPC vault for admin operations
   const mpcVault = "0x..."; // External MPC vault address
   await contract.grantRole(DEFAULT_ADMIN_ROLE, mpcVault);
   ```

3. **Regular Permission Audits**
   ```bash
   # Script to audit role assignments
   npx hardhat run scripts/audit-roles.ts --network mainnet
   ```

#### Private Key Security

1. **Never Commit Private Keys**
   ```bash
   # Use environment variables
   DEPLOYER_PRIVATE_KEY=0x...
   
   # Never in code
   const privateKey = "0x123..."; // DON'T DO THIS
   ```

2. **Use Hardware Wallets for Production**
   ```javascript
   // Ledger integration example
   const signer = new LedgerSigner(provider, "m/44'/60'/0'/0/0");
   ```

3. **Rotate Keys Regularly**
   ```bash
   # Generate new deployment keys
   openssl rand -hex 32
   ```

### Contract Interaction Safety

#### Input Validation

1. **Validate All Addresses**
   ```javascript
   function isValidAddress(address) {
     return ethers.isAddress(address) && address !== ethers.ZeroAddress;
   }
   
   // Always validate before use
   if (!isValidAddress(recipient)) {
     throw new Error("Invalid recipient address");
   }
   ```

2. **Check Contract States**
   ```javascript
   // Verify contract not paused
   const paused = await contract.paused();
   if (paused) {
     throw new Error("Contract is currently paused");
   }
   ```

3. **Validate Bridge Parameters**
   ```javascript
   const supportedChains = [56, 10, 8453, 23295]; // BSC, Optimism, Base, Sapphire
   
   if (!supportedChains.includes(dstChainId)) {
     throw new Error(`Unsupported destination chain: ${dstChainId}`);
   }
   ```

## Integration Best Practices

### Frontend Integration

#### User Experience Guidelines

1. **Always Show Fee Estimates**
   ```javascript
   // Display fees before transaction
   const fees = await lookCoin.estimateSendFee(dstChainId, recipient, amount, false, "0x");
   console.log(`Bridge fee: ${ethers.formatEther(fees.nativeFee)} ETH`);
   ```

2. **Provide Clear Status Updates**
   ```javascript
   // Show transaction progress
   const steps = [
     "Initiating bridge...",
     "Burning tokens on source chain...",
     "Sending cross-chain message...",
     "Minting tokens on destination...",
     "Bridge complete!"
   ];
   ```

3. **Handle Errors Gracefully**
   ```javascript
   try {
     await lookCoin.bridgeToken(dstChainId, recipient, amount, { value: fees.nativeFee });
   } catch (error) {
     if (error.code === 'INSUFFICIENT_FUNDS') {
       showError("Insufficient balance for bridge operation");
     } else if (error.message.includes('paused')) {
       showError("Bridge is temporarily paused");
     } else {
       showError("Bridge failed. Please try again later.");
     }
   }
   ```

### Backend Integration

#### API Design

1. **Implement Rate Limiting**
   ```javascript
   const rateLimit = require("express-rate-limit");
   
   const bridgeLimit = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 10, // 10 bridge requests per window
     message: "Too many bridge requests"
   });
   
   app.post("/api/bridge", bridgeLimit, bridgeHandler);
   ```

2. **Add Request Validation**
   ```javascript
   const { body, validationResult } = require('express-validator');
   
   const bridgeValidation = [
     body('amount').isNumeric().custom(value => value > 0),
     body('recipient').isEthereumAddress(),
     body('dstChainId').isIn([56, 10, 8453, 23295])
   ];
   ```

3. **Implement Idempotency**
   ```javascript
   // Use request IDs to prevent double-processing
   const processedRequests = new Set();
   
   app.post("/api/bridge", (req, res) => {
     const requestId = req.headers['idempotency-key'];
     if (processedRequests.has(requestId)) {
       return res.status(409).json({ error: "Request already processed" });
     }
     
     processedRequests.add(requestId);
     // Process bridge request
   });
   ```

## Performance Optimization

### Contract Optimization

1. **Minimize Storage Reads**
   ```solidity
   // Cache frequently accessed storage
   function optimizedFunction() external {
       uint256 cachedValue = expensiveStorageVar; // Read once
       // Use cachedValue multiple times
   }
   ```

2. **Use Events for Off-Chain Data**
   ```solidity
   // Store detailed data in events, not storage
   event DetailedBridgeInfo(
       address indexed user,
       uint256 amount,
       uint16 dstChainId,
       bytes32 bridgeId,
       uint256 timestamp
   );
   ```

3. **Optimize Loop Operations**
   ```solidity
   // Avoid unbounded loops
   function processBatch(address[] calldata users, uint256[] calldata amounts) external {
       require(users.length <= 100, "Batch too large"); // Limit batch size
       
       uint256 length = users.length;
       for (uint256 i = 0; i < length; ++i) {
           _processUser(users[i], amounts[i]);
       }
   }
   ```

### Infrastructure Optimization

1. **Use Connection Pooling**
   ```javascript
   // RPC connection pool
   const providers = [
     new ethers.JsonRpcProvider(RPC_URL_1),
     new ethers.JsonRpcProvider(RPC_URL_2),
     new ethers.JsonRpcProvider(RPC_URL_3)
   ];
   
   let currentProvider = 0;
   function getProvider() {
     const provider = providers[currentProvider];
     currentProvider = (currentProvider + 1) % providers.length;
     return provider;
   }
   ```

2. **Implement Caching**
   ```javascript
   const NodeCache = require("node-cache");
   const cache = new NodeCache({ stdTTL: 300 }); // 5 minute cache
   
   async function getCachedSupply(chainId) {
     const cacheKey = `supply_${chainId}`;
     let supply = cache.get(cacheKey);
     
     if (!supply) {
       supply = await supplyOracle.getSupplyByChain(chainId);
       cache.set(cacheKey, supply);
     }
     
     return supply;
   }
   ```

---

**Remember**: These best practices evolve with the ecosystem. Regularly review and update your implementation to incorporate new security standards and optimization techniques.