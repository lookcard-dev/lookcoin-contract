# Breaking Changes: Bridge Function Standardization

## Overview

This document details the breaking changes introduced by standardizing function names from `bridgeToken` to `bridge` across the LookCoin cross-chain infrastructure.

## Security Fixes Implemented

### 1. Critical Security Fix in CrossChainRouter

**Issue**: The previous `bridge` function in CrossChainRouter had a critical vulnerability where it did not verify that tokens were actually burned by the bridge module.

**Fix**: The new implementation includes proper burn verification:
```solidity
// Verify tokens were burned
require(token.allowance(address(this), module) == 0, 
    "Module did not burn tokens");
```

### 2. Consistent Transfer ID Generation

**Issue**: Different transfer ID generation methods could lead to collisions or tracking failures.

**Fix**: Standardized transfer ID generation across all functions using:
```solidity
transferId = ILookBridgeModule(module).bridge{value: msg.value}(
    destinationChain,
    recipient,
    amount,
    params
);
```

## Breaking Changes

### 1. ILookBridgeModule Interface

**Before**:
```solidity
function bridgeToken(
    uint256 destinationChain,
    address recipient,
    uint256 amount,
    bytes calldata params
) external payable returns (bytes32 transferId);
```

**After**:
```solidity
function bridge(
    uint256 destinationChain,
    address recipient,
    uint256 amount,
    bytes calldata params
) external payable returns (bytes32 transferId);
```

### 2. CrossChainRouter

- Primary function is now `bridge` with proper security checks
- `bridgeToken` is deprecated but maintained for backward compatibility
- Function signature for `bridge` has been standardized:
  ```solidity
  function bridge(
      uint256 destinationChain,
      address recipient,
      uint256 amount,
      Protocol protocol,
      bytes calldata params
  ) external payable returns (bytes32 transferId);
  ```

### 3. Bridge Modules

All bridge modules now implement `bridge` as the primary function:
- **LayerZeroModule**: `bridgeToken` → `bridge`
- **CelerIMModule**: Standardized on `bridge`, legacy params moved to `bridgeWithLegacyParams`
- **HyperlaneModule**: `bridgeToken` → `bridge`

## Migration Guide

### For Frontend/DApp Developers

1. **Update function calls**:
   ```javascript
   // Before
   await router.bridgeToken(destinationChain, recipient, amount, protocol, params, { value: fee });
   
   // After
   await router.bridge(destinationChain, recipient, amount, protocol, params, { value: fee });
   ```

2. **Update ABI files**: Regenerate contract ABIs after upgrade

3. **Handle both functions during transition**:
   ```javascript
   try {
     // Try new function first
     await router.bridge(...args);
   } catch (error) {
     // Fallback to old function if not upgraded yet
     await router.bridgeToken(...args);
   }
   ```

### For Smart Contract Integrations

1. **Update interface imports**:
   ```solidity
   import "./interfaces/ILookBridgeModule.sol"; // Updated interface
   ```

2. **Update function calls**:
   ```solidity
   // Before
   ILookBridgeModule(module).bridgeToken(destination, recipient, amount, params);
   
   // After
   ILookBridgeModule(module).bridge(destination, recipient, amount, params);
   ```

### For Backend Services

1. **Update API endpoints** that interact with bridge functions
2. **Update monitoring/indexing** services to track new function selectors
3. **Update gas estimation** logic for new function names

## Backward Compatibility

### Temporary Compatibility Layer

The `bridgeToken` function is maintained in CrossChainRouter as a deprecated function that delegates to `bridge`:

```solidity
/**
 * @dev DEPRECATED: Use bridge() instead. Kept for backward compatibility.
 * @notice This function will be removed in a future version
 */
function bridgeToken(...) external payable returns (bytes32) {
    return this.bridge{value: msg.value}(...);
}
```

### Deprecation Timeline

1. **Current Release**: Both functions available, `bridgeToken` marked as deprecated
2. **Next Major Release**: Warning events emitted when using `bridgeToken`
3. **Future Release**: Complete removal of `bridgeToken`

## Testing Recommendations

1. **Test both old and new functions** during transition period
2. **Verify gas costs** remain similar
3. **Test upgrade path** on testnet before mainnet
4. **Monitor for failed transactions** during migration

## Security Considerations

1. **Audit Changes**: All changes have been designed to maintain upgrade safety
2. **No Storage Layout Changes**: Contract storage remains unchanged
3. **Event Compatibility**: Existing events are maintained
4. **Access Control**: All security roles and permissions preserved

## Support

For questions or issues during migration:
- Review test cases in `/test` directory
- Check deployment scripts in `/scripts` directory
- Contact the development team for assistance

## Function Selector Reference

| Contract | Old Function | Old Selector | New Function | New Selector |
|----------|-------------|--------------|--------------|--------------|
| ILookBridgeModule | bridgeToken | 0x... | bridge | 0x... |
| CrossChainRouter | bridgeToken | 0x... | bridge | 0x... |
| LayerZeroModule | bridgeToken | 0x... | bridge | 0x... |
| CelerIMModule | bridgeToken | 0x... | bridge | 0x... |
| HyperlaneModule | bridgeToken | 0x... | bridge | 0x... |

*Note: Actual selectors will be computed after deployment*