# Supply Oracle Architecture

## Overview

The Supply Oracle monitors cross-chain token supply to prevent inflation attacks and ensure total supply integrity. This document explains the efficient architecture for production deployment.

## Recommended Architecture: Single-Chain Oracle

### Why Single Chain?

Instead of deploying SupplyOracle on every chain (expensive and complex), deploy it on **ONE chain only**:

1. **Home Chain Deployment**: Deploy SupplyOracle only on BSC (your home chain)
2. **Read from All Chains**: Oracle nodes read supply data from all chains via RPC
3. **Write to One Chain**: All updates go to the single SupplyOracle on BSC
4. **Cost Efficient**: 3 transactions every 15 minutes instead of 27

### Architecture Diagram

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Oracle Node 1 │     │   Oracle Node 2 │     │   Oracle Node 3 │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │ Reads supply from     │                       │
         ├──────────────────────┐│┌──────────────────────┤
         │                      │││                      │
    ┌────▼────┐            ┌────▼▼▼────┐           ┌────▼────┐
    │   BSC   │            │   Base    │           │Optimism │
    │LookCoin │            │ LookCoin  │           │LookCoin │
    └─────────┘            └───────────┘           └─────────┘
         │                       │                       │
         │ All submit updates to │                       │
         └───────────┬───────────┘                       │
                     │                                   │
                ┌────▼────────────────────────────────────┘
                │                                          
          ┌─────▼─────────┐                               
          │ Supply Oracle │  (Deployed ONLY on BSC)       
          │               │                               
          │ Requires 3    │                               
          │ signatures    │                               
          └───────────────┘                               
```

## Implementation Details

### 1. Deployment Strategy

```typescript
// Deploy SupplyOracle only on BSC
if (network === 'bsc' || network === 'bsc-testnet') {
  // Deploy SupplyOracle
  const supplyOracle = await deploySupplyOracle();
} else {
  // Other chains: Skip SupplyOracle deployment
  console.log("SupplyOracle only deployed on home chain (BSC)");
}
```

### 2. Oracle Operation

Each oracle node:
1. **Reads** supply data from all chains via RPC
2. **Submits** updates only to BSC SupplyOracle
3. **Monitors** for discrepancies

```typescript
// Simplified oracle operation
async function runOracle() {
  // Step 1: Read from all chains
  const bscSupply = await readSupply('bsc');
  const baseSupply = await readSupply('base');
  const opSupply = await readSupply('optimism');
  
  // Step 2: Submit to BSC SupplyOracle only
  const bscProvider = new ethers.JsonRpcProvider(BSC_RPC);
  const wallet = new ethers.Wallet(ORACLE_KEY, bscProvider);
  const supplyOracle = new ethers.Contract(ORACLE_ADDRESS, ABI, wallet);
  
  const nonce = Date.now();
  await supplyOracle.updateSupply(56, bscSupply.total, bscSupply.locked, nonce);
  await supplyOracle.updateSupply(8453, baseSupply.total, baseSupply.locked, nonce);
  await supplyOracle.updateSupply(10, opSupply.total, opSupply.locked, nonce);
}
```

### 3. Cost Analysis

**Multi-Chain Deployment (Expensive):**
- 3 chains × 3 oracles × 3 updates = 27 transactions
- Cost: ~$0.10 × 27 = $2.70 per update
- Daily: $259.20
- Monthly: $7,776

**Single-Chain Deployment (Efficient):**
- 1 chain × 3 oracles × 3 updates = 9 transactions
- Cost: ~$0.10 × 9 = $0.90 per update
- Daily: $86.40
- Monthly: $2,592

**Savings: 66% reduction in gas costs**

## Security Considerations

### 1. Bridge Control

The SupplyOracle on BSC can still pause bridges on other chains through cross-chain messages:

```solidity
// Option 1: Direct pause (if bridges have pause function)
function pauseRemoteBridge(uint32 chainId, address bridge) external {
  // Send cross-chain message to pause bridge
}

// Option 2: Supply validation in bridges
// Bridges check with BSC SupplyOracle before minting
```

### 2. Decentralization

- Deploy oracle nodes in different regions
- Use different RPC providers
- Separate infrastructure for each oracle
- No shared dependencies

### 3. Fallback Mechanism

If BSC is down:
- Bridges can have local rate limits
- Emergency pause mechanisms
- Manual intervention procedures

## Operational Setup

### 1. AWS Lambda Configuration

```yaml
# Lambda 1 (US East)
Environment:
  ORACLE_ID: "1"
  ORACLE_PRIVATE_KEY: ${ssm:/lookcoin/oracle1/key}
  SUPPLY_ORACLE_ADDRESS: "0x..." # BSC address only
  BSC_RPC: "https://bsc-dataseed1.binance.org/"
  BASE_RPC: "https://mainnet.base.org"
  OP_RPC: "https://mainnet.optimism.io"

# Lambda 2 (EU West)
Environment:
  ORACLE_ID: "2"
  ORACLE_PRIVATE_KEY: ${ssm:/lookcoin/oracle2/key}
  # Same oracle address, different RPC endpoints
  BSC_RPC: "https://bsc-dataseed2.defibit.io/"
  # ... etc

# Lambda 3 (AP Southeast)
Environment:
  ORACLE_ID: "3"
  ORACLE_PRIVATE_KEY: ${ssm:/lookcoin/oracle3/key}
  # Same oracle address, different RPC endpoints
  BSC_RPC: "https://bsc-dataseed3.ninicoin.io/"
  # ... etc
```

### 2. EventBridge Rule

```yaml
OracleScheduleRule:
  Type: AWS::Events::Rule
  Properties:
    ScheduleExpression: "rate(15 minutes)"
    Targets:
      - Arn: !GetAtt Oracle1Lambda.Arn
      - Arn: !GetAtt Oracle2Lambda.Arn  
      - Arn: !GetAtt Oracle3Lambda.Arn
```

### 3. Monitoring

- CloudWatch alarms for failed executions
- Discord/Slack alerts for supply discrepancies
- Grafana dashboard for supply metrics

## Migration Path

If you've already deployed SupplyOracle on multiple chains:

1. **Keep Existing**: Continue using multi-chain setup
2. **Gradual Migration**: 
   - Deploy new single oracle on BSC
   - Run both in parallel initially
   - Migrate once confident
3. **Emergency Fallback**: Keep multi-chain code ready

## Best Practices

1. **Oracle Coordination**:
   - Use timestamp-based nonces
   - Ensure clock synchronization (NTP)
   - Handle timezone differences

2. **Error Handling**:
   - Retry failed RPC calls
   - Skip chains that are unreachable
   - Alert on persistent failures

3. **Gas Optimization**:
   - Batch updates in single transaction
   - Use multicall where possible
   - Monitor gas prices

4. **Security**:
   - Rotate oracle keys regularly
   - Use hardware wallets for production
   - Implement rate limiting

## Conclusion

The single-chain oracle architecture provides:
- 66% reduction in operational costs
- Simplified deployment and maintenance
- Centralized security monitoring
- Maintains same security guarantees

This is the recommended approach for production deployment of the LookCoin Supply Oracle system.