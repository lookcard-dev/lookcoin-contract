# Test Fixes for Function Ambiguity - Sample Implementation

This document shows the specific changes needed to fix the 215 failing tests caused by burn function signature ambiguity.

## Problem Summary

Tests fail with:
```
TypeError: ambiguous function description (i.e. matches "burn(uint256)", "burn(address,uint256)")
```

## Solution: Explicit Function Signature Calls

### 1. Self-Burn Operations (User burning their own tokens)

**Before (causes error):**
```typescript
await contract.burn(amount);
```

**After (explicit signature):**
```typescript
await contract["burn(uint256)"](amount);
```

### 2. Burn-From Operations (Authorized burning from other addresses)

**Before (causes error):**
```typescript
await contract.burn(targetAddress, amount);
```

**After (explicit signature):**
```typescript
await contract["burn(address,uint256)"](targetAddress, amount);
```

## Specific File Fixes Required

### 1. test/unit/LookCoin.test.ts

**Lines to Update:**

```typescript
// Line 408: Self-burn test
// BEFORE:
await fixture.lookCoin.connect(fixture.user1).burn(amount);

// AFTER:
await fixture.lookCoin.connect(fixture.user1)["burn(uint256)"](amount);

// Line 434: Bridge role burn test  
// BEFORE:
await fixture.lookCoin.connect(fixture.bridgeOperator).burn(fixture.user1.address, amount);

// AFTER:
await fixture.lookCoin.connect(fixture.bridgeOperator)["burn(address,uint256)"](fixture.user1.address, amount);

// Line 443: Zero address test
// BEFORE:
await fixture.lookCoin.connect(fixture.burner).burn(ethers.ZeroAddress, AMOUNTS.TEN_TOKENS);

// AFTER:
await fixture.lookCoin.connect(fixture.burner)["burn(address,uint256)"](ethers.ZeroAddress, AMOUNTS.TEN_TOKENS);

// Line 451: Zero amount test
// BEFORE:
await fixture.lookCoin.connect(fixture.burner).burn(fixture.user1.address, 0);

// AFTER:
await fixture.lookCoin.connect(fixture.burner)["burn(address,uint256)"](fixture.user1.address, 0);

// Line 462: Insufficient balance test
// BEFORE:
await fixture.lookCoin.connect(fixture.burner).burn(fixture.user1.address, excessAmount);

// AFTER:
await fixture.lookCoin.connect(fixture.burner)["burn(address,uint256)"](fixture.user1.address, excessAmount);

// Line 491: Transfer event test
// BEFORE:
const tx = await fixture.lookCoin.connect(fixture.burner).burn(fixture.user1.address, amount);

// AFTER:
const tx = await fixture.lookCoin.connect(fixture.burner)["burn(address,uint256)"](fixture.user1.address, amount);

// Line 558: Pausable operations test
// BEFORE:
operation: (fixture) => fixture.lookCoin.connect(fixture.burner).burn(fixture.user1.address, AMOUNTS.TEN_TOKENS)

// AFTER:
operation: (fixture) => fixture.lookCoin.connect(fixture.burner)["burn(address,uint256)"](fixture.user1.address, AMOUNTS.TEN_TOKENS)
```

### 2. test/helpers/security.ts

**Lines to Update in testAccessControl function (~line 202):**

```typescript
// BEFORE:
await expect((contract.connect(authorizedSigner) as any)[functionName](...args))
  .to.not.be.reverted;

// AFTER - Add function signature disambiguation:
const contractMethod = functionName === "burn" && args.length === 2 
  ? contract["burn(address,uint256)"] 
  : functionName === "burn" && args.length === 1
  ? contract["burn(uint256)"]
  : (contract as any)[functionName];

await expect(contractMethod.connect(authorizedSigner)(...args))
  .to.not.be.reverted;
```

### 3. test/unit/security/securityEdgeCases.test.ts

**Lines to Update:**

```typescript
// Line 244: Self-burn test
// BEFORE:
await lookCoin.connect(user1).burn(amount);

// AFTER:
await lookCoin.connect(user1)["burn(uint256)"](amount);

// Line 257 & 275: Burn from other address tests
// BEFORE:
await lookCoin.connect(user2).burn(user1.address, amount);

// AFTER:
await lookCoin.connect(user2)["burn(address,uint256)"](user1.address, amount);

// Line 298: Comprehensive authorization test
// BEFORE:
await lookCoin.connect(burner).burn(user1.address, amount);

// AFTER:
await lookCoin.connect(burner)["burn(address,uint256)"](user1.address, amount);
```

## Automated Fix Implementation

### Option 1: Search and Replace Script

Create a script to automatically update test files:

```bash
#!/bin/bash

# Fix self-burn calls (single parameter)
find test/ -name "*.ts" -exec sed -i '' 's/\.burn(\([^,)]*\))/["burn(uint256)"](\1)/g' {} \;

# Fix burn-from calls (two parameters) 
find test/ -name "*.ts" -exec sed -i '' 's/\.burn(\([^,)]*\),\s*\([^)]*\))/["burn(address,uint256)"](\1, \2)/g' {} \;
```

### Option 2: TypeScript Helper Function

Create a helper function in test utilities:

```typescript
// test/helpers/burnHelpers.ts
export function safeBurn(contract: LookCoin, from?: string) {
  if (from) {
    return contract["burn(address,uint256)"].bind(contract);
  } else {
    return contract["burn(uint256)"].bind(contract);
  }
}

// Usage in tests:
await safeBurn(fixture.lookCoin)(amount);  // Self-burn
await safeBurn(fixture.lookCoin, fixture.user1.address)(fixture.user1.address, amount);  // Burn-from
```

## Verification Steps

1. **Run Tests After Fix:**
   ```bash
   npm test -- --grep "burn"
   ```

2. **Verify All Burn Function Variants Work:**
   ```typescript
   // Test both signatures explicitly
   await contract["burn(uint256)"](amount);
   await contract["burn(address,uint256)"](from, amount);
   ```

3. **Check Gas Costs Remain Identical:**
   Both functions should have identical gas usage since they use the same implementation.

## Risk Assessment of Fixes

- ✅ **Zero Security Risk:** Only changes test calling patterns, not contract behavior
- ✅ **Upgrade Safe:** No contract modifications required
- ✅ **Backward Compatible:** Existing integrations unaffected
- ✅ **Function Behavior Identical:** Both signatures use same underlying implementation

## Expected Results

After applying these fixes:
- ✅ All 215 failing tests should pass
- ✅ Contract security properties preserved
- ✅ No changes to production contract code
- ✅ Clear test intentions (self-burn vs burn-from)
- ✅ Improved test maintainability

This approach resolves the testing issue while maintaining the contract's security architecture and upgrade safety.