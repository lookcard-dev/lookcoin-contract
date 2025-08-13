---
description: Complete smart contract interface documentation for LookCoin ecosystem
cover: .gitbook/assets/lookcard-cover.png
coverY: 0
---

# API Reference

{% hint style="info" %}
**Complete Reference**: This document covers all public functions, events, and interfaces for the LookCoin smart contract ecosystem.
{% endhint %}

## Overview

The LookCoin ecosystem consists of several interconnected smart contracts that work together to provide omnichain token functionality. This reference covers:

- **Core Contracts**: LookCoin token, CrossChainRouter, SupplyOracle
- **Bridge Modules**: LayerZero, Celer IM, and Hyperlane integrations
- **Security Components**: Access control, pause mechanisms, supply monitoring
- **Integration Patterns**: Frontend and backend integration examples

**Related Documentation**:
- [Technical Architecture](TECHNICAL.md) - System design overview
- [User Flow Guide](guides/user-flow.md) - Step-by-step usage instructions
- [Best Practices](BEST_PRACTICES.md) - Development and integration guidelines

## Core Contracts

### LookCoin Token Contract

The main LookCoin contract implementing native LayerZero OFT V2 functionality.

#### Core Functions

##### `bridgeToken(uint16 dstChainId, address to, uint256 amount)`

Simplified cross-chain transfer function for end users.

**Parameters:**
- `dstChainId` - LayerZero destination chain ID
- `to` - Recipient address on destination chain  
- `amount` - Token amount to bridge (18 decimals)

**Usage:**
```solidity
// Bridge 100 LOOK tokens to Optimism
lookCoin.bridgeToken(111, recipientAddress, 100 * 10**18);
```

##### `sendFrom(address from, uint16 dstChainId, bytes32 toAddress, uint256 amount, LzCallParams calldata callParams)`

Full LayerZero OFT V2 send functionality with advanced parameters.

**Parameters:**
- `from` - Token sender address
- `dstChainId` - LayerZero destination chain ID
- `toAddress` - Recipient address (bytes32 format)
- `amount` - Token amount to bridge
- `callParams` - LayerZero adapter parameters

**Usage:**
```solidity
LzCallParams memory callParams = LzCallParams({
    refundAddress: msg.sender,
    zroPaymentAddress: address(0),
    adapterParams: "0x"
});

lookCoin.sendFrom(
    msg.sender,
    111, // Optimism
    bytes32(uint256(uint160(recipient))),
    amount,
    callParams
);
```

##### `estimateSendFee(uint16 dstChainId, bytes32 toAddress, uint256 amount, bool useZro, bytes calldata adapterParams)`

Estimate gas fees for cross-chain transfer.

**Returns:** `(nativeFee, zroFee)` - Fee estimation in native token and ZRO

##### `mint(address to, uint256 amount)`

Mint new tokens (restricted to MINTER_ROLE).

**Access Control:** Requires `MINTER_ROLE`

##### `burn(uint256 amount)`

Burn tokens from caller's balance.

##### `burnFrom(address account, uint256 amount)`

Burn tokens from specified account (requires allowance or BURNER_ROLE).

#### View Functions

##### `totalSupply()` → `uint256`

Returns current total supply across all chains.

##### `balanceOf(address account)` → `uint256`

Returns token balance for specific account.

##### `allowance(address owner, address spender)` → `uint256`

Returns spending allowance.

##### `paused()` → `bool`

Returns contract pause status.

#### Events

```solidity
event TokensBridged(
    address indexed from,
    uint16 indexed dstChainId,
    address indexed to,
    uint256 amount
);

event TokensMinted(address indexed to, uint256 amount);
event TokensBurned(address indexed from, uint256 amount);
```

### CrossChainRouter Contract

Multi-protocol bridge router for unified cross-chain operations (deployed on BSC only).

#### Core Functions

##### `bridgeToken(Protocol protocol, uint256 dstChainId, address recipient, uint256 amount)`

Route tokens through specified bridge protocol.

**Parameters:**
- `protocol` - Bridge protocol enum (LayerZero, Celer, Hyperlane)
- `dstChainId` - Destination chain ID
- `recipient` - Recipient address
- `amount` - Token amount

**Usage:**
```solidity
// Bridge via Celer to Optimism
router.bridgeToken(
    Protocol.Celer,
    10, // Optimism chain ID
    recipientAddress,
    100 * 10**18
);
```

##### `getOptimalRoute(uint256 dstChainId, uint256 amount)` → `Protocol`

Get recommended bridge protocol for destination chain.

##### `estimateFee(Protocol protocol, uint256 dstChainId, uint256 amount)` → `uint256`

Estimate bridging fees for specific protocol and route.

#### Admin Functions

##### `registerProtocol(Protocol protocol, address moduleAddress)`

Register new bridge module (PROTOCOL_ADMIN_ROLE required).

##### `pauseProtocol(Protocol protocol)`

Pause specific bridge protocol (PAUSER_ROLE required).

### SupplyOracle Contract

Cross-chain supply monitoring and reconciliation system.

#### Core Functions

##### `updateSupply(uint256 chainId, uint256 totalSupply, uint256 bridgedSupply)`

Update supply data for specific chain (ORACLE_ROLE required).

**Parameters:**
- `chainId` - Target chain identifier
- `totalSupply` - Current total supply on chain
- `bridgedSupply` - Amount bridged to/from chain

##### `reconcile()`

Trigger supply reconciliation across all monitored chains.

##### `getGlobalSupply()` → `uint256`

Returns calculated global supply across all chains.

##### `getSupplyByChain(uint256 chainId)` → `SupplyData`

Get supply data for specific chain.

**Returns:**
```solidity
struct SupplyData {
    uint256 totalSupply;
    uint256 bridgedIn;
    uint256 bridgedOut;
    uint256 lastUpdate;
}
```

#### Events

```solidity
event SupplyUpdated(
    uint256 indexed chainId,
    uint256 totalSupply,
    uint256 bridgedSupply,
    uint256 timestamp
);

event SupplyMismatch(
    uint256 expectedSupply,
    uint256 actualSupply,
    uint256 deviation
);
```

## Bridge Modules

### CelerIMModule

Celer Inter-chain Messaging bridge implementation.

#### Core Functions

##### `bridgeToken(uint64 dstChainId, address recipient, uint256 amount, uint64 nonce)`

Bridge tokens via Celer IM protocol.

##### `executeMessage(address sender, uint64 srcChainId, bytes calldata message, address executor)`

Execute incoming cross-chain message from Celer.

### LayerZeroModule  

LayerZero bridge module for CrossChainRouter integration.

#### Core Functions

##### `bridgeToken(uint16 dstChainId, address recipient, uint256 amount)`

Bridge tokens via LayerZero protocol.

##### `lzReceive(uint16 srcChainId, bytes calldata srcAddress, uint64 nonce, bytes calldata payload)`

Receive and process LayerZero messages.

### HyperlaneModule (Planned)

Hyperlane bridge implementation (not yet deployed).

## Access Control Roles

### Core Roles

| Role | Purpose | Holders |
|------|---------|---------|
| `DEFAULT_ADMIN_ROLE` | Full administrative control | MPC Vault |
| `MINTER_ROLE` | Token minting | MPC Vault, Bridge Modules |
| `BURNER_ROLE` | Token burning | MPC Vault, Bridge Modules, LookCoin |
| `PAUSER_ROLE` | Emergency pause | MPC Vault |
| `UPGRADER_ROLE` | Contract upgrades | MPC Vault, Dev Team |

### Operational Roles

| Role | Purpose | Holders |
|------|---------|---------|
| `OPERATOR_ROLE` | Daily operations | Dev Team |
| `PROTOCOL_ADMIN_ROLE` | Protocol configuration | Dev Team |
| `ROUTER_ADMIN_ROLE` | Router management | Dev Team |
| `ORACLE_ROLE` | Supply updates | Oracle Operators (3+) |
| `BRIDGE_ROLE` | Bridge operations | Bridge Modules |

## Chain Configurations

### LayerZero Chain IDs

| Network | LayerZero Chain ID | Native Chain ID |
|---------|-------------------|-----------------|
| BSC Mainnet | 102 | 56 |
| BSC Testnet | 10102 | 97 |
| Base Sepolia | 10160 | 84532 |
| Optimism Sepolia | 10232 | 11155420 |

### Native Chain IDs

| Network | Chain ID | Bridge Support |
|---------|----------|----------------|
| BSC Mainnet | 56 | LayerZero, Celer |
| Optimism Mainnet | 10 | LayerZero, Celer |
| Base Mainnet | 8453 | LayerZero |
| Oasis Sapphire | 23295 | Celer |

## Error Codes

### Common Errors

| Error | Description | Solution |
|-------|-------------|----------|
| `AccessControlUnauthorizedAccount` | Insufficient permissions | Verify role assignment |
| `EnforcedPause` | Contract is paused | Wait for unpause or contact admin |
| `ERC20InsufficientBalance` | Insufficient token balance | Verify balance before transaction |
| `ERC20InsufficientAllowance` | Insufficient spending allowance | Increase allowance |

### Bridge-Specific Errors

| Error | Description | Solution |
|-------|-------------|----------|
| `LzApp__InvalidEndpointCaller` | Invalid LayerZero endpoint | Verify endpoint configuration |
| `CelerIM__InvalidSender` | Invalid Celer message sender | Check remote module registration |
| `SupplyOracle__ExceedsDeviation` | Supply deviation too high | Wait for reconciliation |

## Integration Examples

### Frontend Integration

```javascript
// Connect to LookCoin contract
const lookCoin = new ethers.Contract(contractAddress, abi, signer);

// Bridge tokens to Optimism
const tx = await lookCoin.bridgeToken(
    111, // Optimism LayerZero chain ID
    recipientAddress,
    ethers.parseEther("100") // 100 LOOK tokens
);

await tx.wait();
```

### Backend Integration

```javascript
// Monitor bridge events
lookCoin.on("TokensBridged", (from, dstChainId, to, amount, event) => {
    console.log(`Bridge initiated: ${amount} LOOK from ${from} to chain ${dstChainId}`);
});

// Check global supply
const oracle = new ethers.Contract(oracleAddress, oracleAbi, provider);
const globalSupply = await oracle.getGlobalSupply();
```

## Gas Optimization Tips

1. **Use `bridgeToken()` for simple transfers** - More gas efficient than `sendFrom()`
2. **Batch operations** - Combine multiple actions in single transaction
3. **Optimize adapter parameters** - Use minimal necessary gas settings
4. **Monitor gas prices** - Time transactions for lower network fees

## Security Considerations

1. **Verify contract addresses** - Always use official contract addresses
2. **Check allowances** - Minimize token allowances to necessary amounts
3. **Monitor supply oracle** - Watch for supply deviation alerts
4. **Use proper access control** - Verify role-based permissions

---

**Related Documentation:**
- [User Flow Guide](USER_FLOW.md) - Step-by-step usage instructions
- [Technical Architecture](TECHNICAL.md) - System design overview
- [Security Overview](SECURITY.md) - Security model details