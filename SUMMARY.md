# Table of contents

- [Introduction](README.md)

## Documentation

- [Technical Architecture](docs/TECHNICAL.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Security Overview](docs/SECURITY.md)
- [Contract Addresses](docs/ADDRESSES.md)
- [Configuration Guide](docs/CONFIGURATION.md)
- [User Flow](docs/USER_FLOW.md)
- [Test Cases](docs/TESTCASE.md)
- [XERC20 Removal Summary](docs/XERC20_REMOVAL_SUMMARY.md)
- [Timeline](docs/TIMELINE.md)

## Smart Contracts

- [Core Contracts](contracts/README.md)
  - [LookCoin (LOOK)](contracts/LookCoin.sol)
  - [Supply Oracle](contracts/security/SupplyOracle.sol)
  - [Rate Limiter](contracts/security/RateLimiter.sol)
- [Bridge Modules](contracts/bridges/README.md)
  - [Celer IM Module](contracts/bridges/CelerIMModule.sol)
  - [Hyperlane Module](contracts/bridges/HyperlaneModule.sol)
  - [LayerZero Module](contracts/bridges/LayerZeroModule.sol)
- [Cross-Chain Infrastructure](contracts/xchain/README.md)
  - [CrossChain Router](contracts/xchain/CrossChainRouter.sol)
  - [Fee Manager](contracts/xchain/FeeManager.sol)
  - [Protocol Registry](contracts/xchain/ProtocolRegistry.sol)
  - [Security Manager](contracts/xchain/SecurityManager.sol)

## Deployment & Configuration

- [Deployment Scripts](scripts/README.md)
  - [Deploy Script](scripts/deploy.ts)
  - [Setup Script](scripts/setup.ts)
  - [Configure Script](scripts/configure.ts)
- [Deployment Utilities](scripts/utils/README.md)
  - [Deployment Orchestrator](scripts/utils/deploymentOrchestrator.ts)
  - [Protocol Configurators](scripts/utils/protocolConfigurators.ts)
  - [Protocol Detector](scripts/utils/protocolDetector.ts)

## Testing

- [Test Suite](test/README.md)
  - [Unit Tests](test/README.md#unit-tests)
  - [Integration Tests](test/README.md#integration-tests)
  - [Security Tests](test/README.md#security-tests)

## Security

- [Security Audits](audits/README.md)
- [Security Scripts](scripts/security/README.md)
  - [Security Audit](scripts/security/runSecurityAudit.ts)
  - [Vulnerability Scanner](scripts/security/vulnerabilityScanner.ts)

## Network Configuration

- [Supported Networks](docs/TECHNICAL.md#supported-networks)
- [Protocol Support Matrix](docs/TECHNICAL.md#chain-deployment-matrix)
- [RPC Configuration](hardhat.config.ts)

## API Reference

- [Contract Interfaces](contracts/interfaces/README.md)
  - [ICrossChainRouter](contracts/interfaces/ICrossChainRouter.sol)
  - [ILookBridgeModule](contracts/interfaces/ILookBridgeModule.sol)
  - [ILookCoin](contracts/interfaces/ILookCoin.sol)

## Resources

- [GitHub Repository](https://github.com/lookcard-dev/lookcoin-contract)
- [LookCard Documentation](https://support.lookcard.io)
- [Support & Issues](https://github.com/lookcard-dev/lookcoin-contract/issues)
