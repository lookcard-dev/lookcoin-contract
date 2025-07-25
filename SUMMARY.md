# Table of contents

* [Introduction](README.md)

## Documentation

* [Technical Architecture](docs/TECHNICAL.md)
* [Deployment Guide](docs/DEPLOYMENT.md)
* [Security Overview](docs/SECURITY.md)
* [Contract Addresses](docs/ADDRESSES.md)
* [Configuration Guide](docs/CONFIGURATION.md)
* [User Flow](docs/USER_FLOW.md)
* [Test Cases](docs/TESTCASE.md)
* [Timeline](docs/TIMELINE.md)
* [Ownership](docs/OWNERSHIP.md)

## Smart Contracts

### Core Contracts
* [LookCoin (LOOK)](contracts/LookCoin.sol)
* [Supply Oracle](contracts/security/SupplyOracle.sol)
* [Rate Limiter](contracts/security/RateLimiter.sol)

### Bridge Modules
* [Celer IM Module](contracts/bridges/CelerIMModule.sol)
* [Hyperlane Module](contracts/bridges/HyperlaneModule.sol)
* [LayerZero Module](contracts/bridges/LayerZeroModule.sol)

### Cross-Chain Infrastructure
* [CrossChain Router](contracts/xchain/CrossChainRouter.sol)
* [Fee Manager](contracts/xchain/FeeManager.sol)
* [Protocol Registry](contracts/xchain/ProtocolRegistry.sol)
* [Security Manager](contracts/xchain/SecurityManager.sol)

### Contract Interfaces
* [ICrossChainRouter](contracts/interfaces/ICrossChainRouter.sol)
* [ILookBridgeModule](contracts/interfaces/ILookBridgeModule.sol)
* [ILookCoin](contracts/interfaces/ILookCoin.sol)

## Deployment & Configuration

### Scripts
* [Deploy Script](scripts/deploy.ts)
* [Setup Script](scripts/setup.ts)
* [Configure Script](scripts/configure.ts)

### Utilities
* [Deployment Orchestrator](scripts/utils/deploymentOrchestrator.ts)
* [Protocol Configurators](scripts/utils/protocolConfigurators.ts)
* [Protocol Detector](scripts/utils/protocolDetector.ts)
* [Deployment State Manager](scripts/utils/state.ts)
* [Network Tier Validator](scripts/utils/network-tier-validator.ts)

### Security Scripts
* [Security Audit](scripts/security/runSecurityAudit.ts)
* [Vulnerability Scanner](scripts/security/vulnerabilityScanner.ts)

## Testing

### Unit Tests
* [LookCoin OFT Tests](test/LookCoin-OFT.test.ts)
* [Supply Oracle Tests](test/SupplyOracle.test.ts)
* [Protocol Registry Tests](test/ProtocolRegistry.test.ts)
* [Celer IM Tests](test/celer.test.ts)
* [Security Tests](test/Security.test.ts)

### Integration Tests
* [Consolidated Deployment](test/integration/consolidatedDeployment.test.ts)
* [Ignition Validation](test/ignition-validation.test.ts)

### Utility Tests
* [Deployment Orchestrator Tests](test/utils/deploymentOrchestrator.test.ts)
* [Protocol Detector Tests](test/utils/protocolDetector.test.ts)

## Configuration Files

* [Hardhat Configuration](hardhat.config.ts)
* [Package Configuration](package.json)
* [TypeScript Configuration](tsconfig.json)
* [Environment Template](.env.example)

## Resources

* [GitHub Repository](https://github.com/lookcard-dev/lookcoin-contract)
* [LookCard Documentation](https://support.lookcard.io)
* [Support & Issues](https://github.com/lookcard-dev/lookcoin-contract/issues)
