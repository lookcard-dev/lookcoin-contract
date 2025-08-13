---
description: Complete developer onboarding guide for LookCoin smart contract development
cover: .gitbook/assets/developer-guide-cover.png
coverY: 0
---

# Developer Onboarding Guide

{% hint style="success" %}
**Welcome!** This comprehensive guide will help you get up and running with LookCoin smart contract development in under 30 minutes.
{% endhint %}

## Overview

This guide covers everything you need to know to start contributing to the LookCoin ecosystem:

- **Environment Setup** - Tools, dependencies, and configuration
- **Codebase Tour** - Understanding the project structure
- **Development Workflow** - Best practices and processes
- **Testing Strategy** - How to write and run tests
- **Deployment Process** - Three-stage deployment system

**Before You Start**:
- [Quick Start Guide](QUICK_START.md) - 5-minute setup for immediate testing
- [Technical Architecture](TECHNICAL.md) - System design overview
- [Best Practices](BEST_PRACTICES.md) - Development standards and guidelines

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js v18+** - JavaScript runtime
- **npm or yarn** - Package manager
- **Git** - Version control
- **VS Code** (recommended) - Code editor with Solidity extensions
- **Hardhat** - Ethereum development environment

### Recommended VS Code Extensions

- Solidity (Juan Blanco)
- Prettier - Code formatter
- GitLens
- TypeScript and JavaScript Language Features

## Quick Setup

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/lookcard-dev/lookcoin-contract.git
cd lookcoin-contract

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### 2. Configure Environment

Edit your `.env` file with the following required variables:

```bash
# Core Configuration
GOVERNANCE_VAULT=0x...              # MPC vault wallet address
DEV_TEAM_ADDRESS=0x...             # Your dev team address (optional)

# Network RPC URLs (add the ones you need)
BSC_MAINNET_RPC=https://bsc-dataseed.binance.org/
BSC_TESTNET_RPC=https://data-seed-prebsc-1-s1.binance.org:8545/
BASE_SEPOLIA_RPC=https://sepolia.base.org
OPTIMISM_SEPOLIA_RPC=https://sepolia.optimism.io

# Private Keys (for deployment - use test wallets only!)
DEPLOYER_PRIVATE_KEY=0x...
MINTER_PRIVATE_KEY=0x...
```

### 3. Initial Setup Commands

```bash
# Compile contracts
npm run compile

# Check contract sizes
npm run size

# Run tests to verify setup
npm test
```

## Understanding the Codebase

### Project Structure

```
lookcoin-contract/
├── contracts/                  # Smart contracts
│   ├── LookCoin.sol           # Main token contract
│   ├── bridges/               # Bridge modules
│   │   ├── CelerIMModule.sol  # Celer integration
│   │   ├── HyperlaneModule.sol # Hyperlane integration
│   │   └── LayerZeroModule.sol # LayerZero integration
│   ├── xchain/                # Cross-chain infrastructure
│   │   ├── CrossChainRouter.sol # Multi-protocol router
│   │   ├── FeeManager.sol      # Fee management
│   │   ├── ProtocolRegistry.sol # Protocol registration
│   │   └── SecurityManager.sol  # Security controls
│   └── security/              # Security components
│       └── SupplyOracle.sol   # Supply monitoring
├── scripts/                   # Deployment & utility scripts
├── test/                      # Test suites
├── docs/                      # Documentation
└── deployments/              # Deployment artifacts
```

### Core Concepts

#### 1. Omnichain Architecture
LookCoin is designed to work seamlessly across multiple blockchains:
- **Home Chain**: BSC (where tokens are initially minted)
- **Secondary Chains**: Base, Optimism, Sapphire (receive tokens via bridges)
- **Burn-and-Mint**: All bridges use consistent token mechanics

#### 2. Multi-Protocol Support
- **LayerZero OFT V2**: Native integration for gas-efficient transfers
- **Celer IM**: Message-based bridging with SGN validation
- **Hyperlane**: Modular security (planned deployment)

#### 3. Security Model
- **Role-Based Access Control**: Granular permissions for different operations
- **Supply Oracle**: Cross-chain supply monitoring and reconciliation
- **Emergency Controls**: Pause mechanisms and circuit breakers

## Development Workflow

### 1. Making Changes

Always work on feature branches:

```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make your changes
# Test your changes
npm test

# Run security checks
npm run security-check

# Commit with descriptive messages
git commit -m "feat: add new bridge functionality"
```

### 2. Testing Strategy

Run tests at different levels:

```bash
# Unit tests - test individual contracts
npm run test:unit

# Integration tests - test cross-chain flows
npm run test:integration

# Security tests - test attack vectors
npm run test:security

# Gas analysis
npm run test:gas

# Coverage report
npm run coverage
```

### 3. Code Standards

Follow these conventions:

- **Solidity Style**: Use official Solidity style guide
- **Comments**: Document complex functions with NatSpec
- **Gas Optimization**: Consider gas costs in implementations
- **Security First**: Always consider security implications

### Example Test Structure

```javascript
describe("LookCoin Bridge Operations", function() {
  beforeEach(async function() {
    // Setup test environment
    const { lookCoin, user1, user2 } = await loadFixture(deployLookCoinFixture);
    this.lookCoin = lookCoin;
    this.user1 = user1;
    this.user2 = user2;
  });

  it("should bridge tokens via LayerZero", async function() {
    // Test LayerZero bridge functionality
    const amount = ethers.parseEther("100");
    await expect(this.lookCoin.connect(this.user1).bridgeToken(
      10, // Optimism
      this.user2.address,
      amount
    )).to.emit(this.lookCoin, "TokensBridged");
  });
});
```

## Deployment Process

LookCoin uses a three-stage deployment process:

### Stage 1: Deploy
Creates contracts on target network:
```bash
npm run deploy:bsc-testnet
npm run deploy:base-sepolia
```

### Stage 2: Setup  
Configures roles and local settings:
```bash
npm run setup:bsc-testnet
npm run setup:base-sepolia
```

### Stage 3: Configure
Establishes cross-chain connections:
```bash
npm run configure:bsc-testnet
npm run configure:base-sepolia
```

**Important**: Always follow Deploy → Setup → Configure sequence!

## Common Development Tasks

### Adding a New Bridge Protocol

1. **Create Bridge Module**: Implement `ILookBridgeModule` interface
2. **Add Protocol Registration**: Update `ProtocolRegistry`
3. **Configure Network Support**: Update `hardhat.config.ts`
4. **Write Tests**: Add comprehensive test coverage
5. **Update Documentation**: Document the new integration

### Debugging Deployment Issues

```bash
# Enable verbose logging
DEBUG_DEPLOYMENT=true npm run deploy:network

# Skip upgrade checks (development only)
SKIP_UPGRADE_CHECK=true npm run deploy:network

# Use simple mode (skip infrastructure)
npm run deploy:network -- --simple-mode
```

### Running Security Audits

```bash
# Run automated security scan
npm run security-audit

# Generate security report
npm run security-report

# Check for known vulnerabilities
npm run vulnerability-check
```

## Key Files to Know

### Configuration Files

- **`hardhat.config.ts`**: Network and protocol configurations
- **`.env`**: Environment variables and secrets
- **`package.json`**: Dependencies and scripts

### Smart Contracts

- **`LookCoin.sol`**: Main token with native LayerZero OFT V2
- **`CrossChainRouter.sol`**: Multi-protocol bridge router (BSC only)
- **`SupplyOracle.sol`**: Cross-chain supply monitoring

### Test Files

- **`test/unit/LookCoin.test.ts`**: Core token functionality tests
- **`test/integration/CrossChainTransfers.test.ts`**: End-to-end bridge tests
- **`test/helpers/fixtures.ts`**: Test setup utilities

## Best Practices

### Security Guidelines

1. **Never commit private keys** - Use environment variables
2. **Test on testnets first** - Always deploy to testnet before mainnet
3. **Verify contracts** - Run verification after deployment
4. **Follow access control** - Use appropriate roles for operations
5. **Monitor gas usage** - Optimize for user experience

### Code Quality

1. **Write comprehensive tests** - Aim for >90% coverage
2. **Document complex logic** - Use NatSpec comments
3. **Keep functions small** - Single responsibility principle
4. **Handle edge cases** - Consider all possible scenarios
5. **Use events liberally** - Help with debugging and monitoring

### Git Workflow

1. **Feature branches** - Never push directly to main/develop
2. **Descriptive commits** - Use conventional commit format
3. **Small, focused PRs** - Easier to review and merge
4. **Keep history clean** - Rebase when appropriate
5. **Tag releases** - Use semantic versioning

## Getting Help

### Documentation Resources

- **Technical Architecture**: [docs/TECHNICAL.md](TECHNICAL.md)
- **Deployment Guide**: [docs/DEPLOYMENT.md](DEPLOYMENT.md)  
- **Security Overview**: [docs/SECURITY.md](SECURITY.md)
- **User Flow Guide**: [docs/USER_FLOW.md](USER_FLOW.md)

### External Resources

- **LayerZero Docs**: https://layerzero.gitbook.io/docs/
- **Celer Docs**: https://celer.network/docs/
- **OpenZeppelin**: https://docs.openzeppelin.com/contracts/
- **Hardhat Docs**: https://hardhat.org/docs

### Support Channels

- **GitHub Issues**: Report bugs and feature requests
- **Team Slack**: Internal development discussions
- **Code Reviews**: Submit PRs for review
- **Documentation**: Update docs as you learn

## Next Steps

1. **Read the Technical Architecture** - Understand the system design
2. **Run the Test Suite** - Verify your setup works
3. **Deploy to Testnet** - Try the deployment process
4. **Make a Small Change** - Practice the development workflow
5. **Review Open Issues** - See how you can contribute

Welcome to the team! 🚀

---

**Need immediate help?** Check our [Troubleshooting Guide](TROUBLESHOOTING.md) or create a GitHub issue.