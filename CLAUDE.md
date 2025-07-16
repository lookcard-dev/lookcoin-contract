# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

LookCoin Contract is the smart contract repository for LookCoin (LOOK), the omnichain fungible token that serves as the primary payment method for LookCard's crypto-backed credit/debit card system. The token implements a triple-bridge architecture for cross-chain transfers using LayerZero OFT V2, Celer IM, and IBC protocols.

## Architecture

### Contract Structure
```
contracts/
├── LookCoin.sol              # Main ERC20 token contract (UUPS upgradeable)
├── bridges/                  # Cross-chain bridge implementations
│   ├── CelerIMModule.sol     # Celer Inter-chain Messaging (lock-and-mint)
│   └── IBCModule.sol         # IBC Protocol for Cosmos ecosystem
└── security/                 # Security infrastructure
    ├── RateLimiter.sol       # Rate limiting with sliding window algorithm
    └── SupplyOracle.sol      # Cross-chain supply monitoring and reconciliation
```

### Key Technical Features
- **Upgradeable Design**: UUPS proxy pattern with OpenZeppelin contracts
- **Triple-Bridge Architecture**: LayerZero (burn-and-mint), Celer IM (lock-and-mint), IBC (Cosmos)
- **Role-Based Access Control**: Granular permissions with AccessControl
- **Rate Limiting**: 500K tokens per transaction, 3 transactions per hour per account
- **Emergency Controls**: Pause capability with emergency recovery procedures
- **Supply Reconciliation**: 15-minute monitoring cycles to detect cross-chain anomalies

## Development Commands

### Core Development
```bash
# Install dependencies
npm install

# Compile contracts
npm run compile

# Run tests
npm test

# Run tests with gas reporting
npm run test:gas

# Generate test coverage report
npm run coverage

# Check contract sizes
npm run size

# Run linter
npm run lint

# Format code
npm run format
```

### Deployment Commands
```bash
# Deploy to specific networks
npm run deploy:bsc-testnet
npm run deploy:bsc-mainnet
npm run deploy:base-sepolia
npm run deploy:base-mainnet
npm run deploy:op-sepolia
npm run deploy:op-mainnet
npm run deploy:akashic-mainnet

# Verify contracts on block explorers
npm run verify

# Configure cross-chain connections (after deployment)
npm run configure:bridges
```

### Testing Specific Contracts
```bash
# Test specific contract
npx hardhat test test/LookCoin.test.ts

# Test with specific network fork
npx hardhat test --network hardhat

# Run integration tests
npm run test:integration

# Run security tests  
npm run test:security
```

## Technology Stack

- **Smart Contract Language**: Solidity 0.8.28
- **Development Framework**: Hardhat with TypeScript
- **Testing**: Chai, Hardhat test helpers, TypeChain for type safety
- **Security**: OpenZeppelin contracts, custom security modules
- **Cross-chain**: LayerZero OFT V2, Celer IM SDK, IBC Protocol
- **Tools**: Solidity coverage, gas reporter, contract sizer, Slither for static analysis

## Multi-Chain Architecture

### Supported Networks
- **BSC** (Chain ID: 56) - Home chain with full token supply
- **Base** (Chain ID: 8453) - LayerZero OFT deployment
- **Optimism** (Chain ID: 10) - Celer IM deployment  
- **Akashic** (Chain ID: 9070) - IBC deployment for Cosmos

### Bridge Operations
1. **LayerZero OFT V2**: Burn-and-mint mechanism for Base
2. **Celer IM**: Lock-and-mint mechanism for Optimism
3. **IBC Protocol**: Native Cosmos interoperability for Akashic

## Security Patterns

### Governance Model
- **MPC Vault Wallet**: External MPC vault provides secure off-chain governance
- **Direct Execution**: Administrative operations execute immediately without on-chain delays
- **Role Separation**: Distinct roles for bridge operators, security admins, and supply monitors
- **Security**: Multi-party computation ensures no single point of failure

### Rate Limiting
- Per-account limits: 500K tokens per transaction, 3 transactions per hour
- Global daily limit: 20% of total supply
- Sliding window algorithm for accurate rate tracking
- Emergency bypass for critical operations

### Supply Monitoring
- Real-time cross-chain balance tracking
- 15-minute reconciliation cycles
- Automatic pause on 1% supply deviation
- Manual reconciliation tools for administrators

## Development Workflow

### Setting Up Environment
1. Clone repository and install dependencies
2. Copy `.env.example` to `.env` and configure:
   - GOVERNANCE_VAULT address for MPC vault wallet
   - Private keys for deployment accounts
   - RPC endpoints for each network
   - Block explorer API keys
   - LayerZero and Celer configuration

### Making Changes
1. Modify contracts in `contracts/` directory
2. Update tests in `test/` directory
3. Run `npm run compile` to ensure compilation
4. Run `npm test` to verify functionality
5. Check gas usage with `npm run test:gas`
6. Verify contract sizes with `npm run size`

### Deployment Process
1. Test thoroughly on testnets first
2. Run deployment script for target network
3. Verify contracts on block explorer
4. Configure cross-chain connections
5. Test bridge operations end-to-end
6. Monitor supply reconciliation

## Contract Verification

After deployment, verify contracts:
```bash
npx hardhat verify --network <network-name> <contract-address> <constructor-args>
```

For upgradeable contracts, verify both proxy and implementation.

## Important Considerations

### Gas Optimization
- Optimizer enabled with 9999 runs for deployment efficiency
- Rate limiter uses efficient storage patterns
- Batch operations available for governance actions

### Upgrade Process
1. Deploy new implementation contract
2. Authorize upgrade through MPC vault wallet
3. Execute upgrade transaction
4. Verify new implementation

### Emergency Procedures
- Pause all operations: Call `pause()` with EMERGENCY_ROLE
- Disable specific bridge: Call `disableBridge()` 
- Force supply reconciliation: Call `forceReconcile()`
- Recovery requires MPC vault wallet authorization