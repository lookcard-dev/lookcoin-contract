# Timelock Integration Guide

## Overview

The MinimalTimelock contract provides time-delayed execution of administrative functions for the LookCoin system. This ensures that any critical governance actions have a mandatory delay period, allowing stakeholders to review and potentially respond to proposed changes.

## Key Features

- **2-day minimum delay** for all scheduled operations
- **Role-based access control** with separate proposer and executor roles
- **Upgrade-safe design** that doesn't modify existing contract storage
- **Emergency cancellation** capability for authorized addresses

## Deployment

### 1. Deploy Timelock Contract

```bash
npm run deploy:timelock
```

This will deploy the MinimalTimelock contract and save the address to your deployment files.

### 2. Grant Roles to Timelock

After deployment, grant the necessary roles to the timelock contract:

```javascript
// Grant roles that should require timelock
await lookCoin.grantRole(UPGRADER_ROLE, timelockAddress);
await lookCoin.grantRole(PROTOCOL_ADMIN_ROLE, timelockAddress);
await lookCoin.grantRole(ROUTER_ADMIN_ROLE, timelockAddress);
```

### 3. Revoke Direct Admin Access (Optional)

Once the timelock is tested and operational, consider revoking direct admin roles:

```javascript
// Revoke direct access, keeping only through timelock
await lookCoin.revokeRole(UPGRADER_ROLE, adminAddress);
await lookCoin.revokeRole(PROTOCOL_ADMIN_ROLE, adminAddress);
```

## Usage

### Scheduling an Operation

```javascript
// Prepare the call data
const callData = lookCoin.interface.encodeFunctionData("setTrustedRemote", [
  dstChainId,
  trustedRemoteAddress
]);

// Schedule with 2-day delay
const delay = 2 * 24 * 60 * 60; // 2 days in seconds
await timelock.schedule(
  lookCoinAddress,
  0, // ETH value (0 for no ETH)
  callData,
  delay
);
```

### Executing an Operation

After the delay period has passed:

```javascript
// Execute the scheduled operation
await timelock.execute(
  lookCoinAddress,
  0,
  callData
);
```

### Cancelling an Operation

In case of emergency or if an operation needs to be cancelled:

```javascript
const operationId = await timelock.hashOperation(
  lookCoinAddress,
  0,
  callData
);

await timelock.cancel(operationId);
```

## Critical Operations Requiring Timelock

The following operations should be executed through the timelock:

1. **Contract Upgrades** - Any upgrade to implementation contracts
2. **Trusted Remote Configuration** - Setting or changing cross-chain endpoints
3. **Protocol Configuration** - Changing fees, limits, or security parameters
4. **Bridge Module Updates** - Adding or removing bridge modules
5. **Emergency Pause/Unpause** - System-wide pause operations

## Security Considerations

1. **Minimum Delay**: The 2-day delay cannot be reduced, ensuring adequate review time
2. **Role Separation**: Proposer and executor roles should be held by different entities
3. **Monitoring**: All scheduled operations emit events that should be monitored
4. **Emergency Response**: Keep CANCELLER_ROLE assigned to a secure multisig for emergencies

## Integration Testing

Run the timelock tests:

```bash
npx hardhat test test/MinimalTimelock.test.ts
```

## Example: Upgrading LookCoin Through Timelock

```javascript
// 1. Deploy new implementation
const NewLookCoin = await ethers.getContractFactory("LookCoin");
const newImplementation = await NewLookCoin.deploy();

// 2. Schedule upgrade
const callData = lookCoin.interface.encodeFunctionData("upgradeToAndCall", [
  newImplementation.address,
  "0x" // No initialization data
]);

await timelock.schedule(
  lookCoinAddress,
  0,
  callData,
  2 * 24 * 60 * 60 // 2 days
);

// 3. Wait 2 days...

// 4. Execute upgrade
await timelock.execute(
  lookCoinAddress,
  0,
  callData
);
```

## Monitoring

Monitor these events for governance activity:

- `CallScheduled` - New operation scheduled
- `CallExecuted` - Operation executed
- `CallCancelled` - Operation cancelled

## Emergency Procedures

In case of critical security issues:

1. Use CANCELLER_ROLE to cancel any pending malicious operations
2. Use PAUSER_ROLE (if not timelocked) to pause the system
3. Schedule and execute fixes through normal timelock process
4. Consider shorter delays only for critical security fixes (requires contract modification)