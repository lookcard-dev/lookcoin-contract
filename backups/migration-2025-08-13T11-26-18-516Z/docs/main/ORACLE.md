# Supply Oracle Architecture

## Overview

The Supply Oracle monitors cross-chain token supply to prevent inflation attacks and ensure total supply integrity. This document explains the current multi-chain architecture and future optimization options.

## Current Architecture: Multi-Chain Oracle

### Implementation Status

LookCoin currently deploys SupplyOracle on **every chain** for local bridge control:

1. **Per-Chain Deployment**: Each chain has its own SupplyOracle instance
2. **Local Bridge Control**: Each oracle controls bridges on its own chain
3. **Multi-Sig Updates**: Each oracle requires 3 signatures for supply updates
4. **Batch Updates**: Supports batch updates to reduce gas costs

### Architecture Diagram

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Oracle Node 1 │     │   Oracle Node 2 │     │   Oracle Node 3 │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │ Reads supply from all chains and submits to each
         ├──────────────────────┐│┌──────────────────────┤
         │                      │││                      │
    ┌────▼────┐            ┌────▼▼▼────┐           ┌────▼────┐
    │   BSC   │            │   Base    │           │Optimism │
    │LookCoin │            │ LookCoin  │           │LookCoin │
    │  Oracle │            │  Oracle   │           │  Oracle  │
    └─────────┘            └───────────┘           └─────────┘
         │                       │                       │
         │ Each chain has its    │                       │
         │ own SupplyOracle      │                       │
         │                       │                       │
    ┌────▼────┐            ┌────▼────┐            ┌────▼────┐
    │  Local  │            │  Local  │            │  Local  │
    │ Bridges │            │ Bridges │            │ Bridges │
    └─────────┘            └─────────┘            └─────────┘
```

## Implementation Details

### 1. Deployment Strategy

```typescript
// Deploy SupplyOracle on every chain
const supplyOracle = await deploySupplyOracle();
// Each chain controls its own bridges locally
```

### 2. Oracle Operation

Each oracle node:
1. **Reads** supply data from all chains via RPC
2. **Submits** updates to **each chain's SupplyOracle**
3. **Monitors** for discrepancies
4. **Uses batch updates** when supported to reduce gas costs

```typescript
// Current multi-chain oracle operation
async function runOracle() {
  // Step 1: Read from all chains
  const chainSupplies = await readAllChainSupplies();
  
  // Step 2: Submit to each chain's SupplyOracle
  for (const chain of deployedChains) {
    const provider = new ethers.JsonRpcProvider(chain.rpc);
    const wallet = new ethers.Wallet(ORACLE_KEY, provider);
    const supplyOracle = new ethers.Contract(chain.oracleAddress, ABI, wallet);
    
    const nonce = Date.now();
    
    // Use batch update if available
    if (supplyOracle.batchUpdateSupply) {
      await supplyOracle.batchUpdateSupply(chainSupplies, nonce);
    } else {
      // Fallback to individual updates
      for (const supply of chainSupplies) {
        await supplyOracle.updateSupply(supply.chainId, supply.total, supply.locked, nonce);
      }
    }
  }
}
```

### 3. Cost Analysis

**Current Multi-Chain Deployment:**
- With batch updates: 3 chains × 3 oracles × 1 batch = 9 transactions
- Without batch: 3 chains × 3 oracles × 3 updates = 27 transactions
- Cost with batch: ~$0.10 × 9 = $0.90 per update
- Daily: $86.40
- Monthly: $2,592

**Alternative Single-Chain Deployment (Future Optimization):**
- 1 chain × 3 oracles × 1 batch = 3 transactions
- Cost: ~$0.10 × 3 = $0.30 per update
- Daily: $28.80
- Monthly: $864

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
- Bridges can have local security limits
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
   - Implement security controls

## Conclusion

The single-chain oracle architecture provides:
- 66% reduction in operational costs
- Simplified deployment and maintenance
- Centralized security monitoring
- Maintains same security guarantees

This is the recommended approach for production deployment of the LookCoin Supply Oracle system.