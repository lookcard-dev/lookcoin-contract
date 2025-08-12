# LookCoin - Omnichain Fungible Token

> **LookCoin (LOOK)** is an advanced omnichain fungible token implementing native LayerZero OFT V2 with multi-protocol bridge support, serving as the primary payment method for LookCard's crypto-backed credit/debit card ecosystem.

**Quick Links:**
- 🚀 [Quick Start Guide](docs/QUICK_START.md) - Get running in 5 minutes
- 👨‍💻 [Developer Onboarding](docs/DEVELOPER_ONBOARDING.md) - Complete setup guide
- 📖 [Technical Architecture](docs/TECHNICAL.md) - Deep dive into the system
- 🔐 [Security Framework](docs/SECURITY.md) - Security model and audits
- 🛠 [API Reference](docs/API_REFERENCE.md) - Complete contract interface

## Overview

### Key Features

- **Omnichain Compatibility**: Seamless transfers across BSC, Base, Optimism, Oasis Sapphire, and Akashic Chain
- **Multi-Bridge Architecture**: Redundancy and flexibility with three distinct bridge mechanisms
- **Fintech-Grade Security**: Supply reconciliation and emergency controls
- **UUPS Upgradeable**: Future-proof design with proxy pattern implementation
- **MPC Vault Governance**: External MPC vault wallet for secure off-chain governance

### Supported Networks

| Network | Status | Chain ID | Bridge Protocols | Documentation |
|---------|--------|----------|------------------|---------------|
| **BSC Mainnet** | ✅ Live | 56 | LayerZero, Celer IM | [Addresses](docs/ADDRESSES.md#bsc-mainnet) |
| **BSC Testnet** | ✅ Live | 97 | LayerZero, Celer IM | [Addresses](docs/ADDRESSES.md#bsc-testnet) |
| **Base Sepolia** | ✅ Live | 84532 | LayerZero | [Addresses](docs/ADDRESSES.md#base-sepolia) |
| **Optimism Sepolia** | ✅ Live | 11155420 | LayerZero | [Addresses](docs/ADDRESSES.md#optimism-sepolia) |
| **Oasis Sapphire Testnet** | ✅ Live | 23295 | Celer IM | [Addresses](docs/ADDRESSES.md#oasis-sapphire-testnet) |
| **Base Mainnet** | 🔄 Planned | 8453 | LayerZero, Hyperlane | [Deployment Guide](docs/DEPLOYMENT.md) |
| **Optimism Mainnet** | 🔄 Planned | 10 | LayerZero, Celer IM, Hyperlane | [Deployment Guide](docs/DEPLOYMENT.md) |
| **Akashic Chain** | 🔄 Planned | 9070 | Hyperlane | [Deployment Guide](docs/DEPLOYMENT.md) |

## Architecture

### Contract Structure

```
contracts/
├── LookCoin.sol              # Main token (OFTV2Upgradeable)
├── bridges/
│   ├── CelerIMModule.sol     # Celer IM bridge (burn-and-mint)
│   ├── HyperlaneModule.sol   # Hyperlane bridge (burn-and-mint)
│   └── LayerZeroModule.sol   # LayerZero module (burn-and-mint)
└── security/
    └── SupplyOracle.sol      # Cross-chain supply monitoring
```

### Bridge Mechanisms

#### LayerZero OFT V2 (Burn-and-Mint)

- Native integration in LookCoin contract
- DVN validation: 2 required, 1 optional, 66% threshold
- Supported on BSC, Base, and Optimism

#### Celer IM (Burn-and-Mint)

- Separate bridge module with MessageBus integration
- SGN consensus validation
- Supported on BSC, Optimism, and Oasis Sapphire

#### Hyperlane (Burn-and-Mint)

- Modular security via ISM (Interchain Security Modules)
- Self-hosted infrastructure for complete control
- Supports BSC, Base, Optimism, and Akashic

## Security Features

### Supply Reconciliation

- **15-Minute Monitoring**: Automated cross-chain supply tracking
- **Tolerance Threshold**: 1% deviation triggers alerts
- **Automatic Response**: Bridge pausing on supply mismatches
- **MPC Vault Updates**: Supply changes require MPC vault wallet authorization

### Emergency Controls

- **Circuit Breaker**: Immediate pause capability
- **Selective Pause**: Individual bridge shutdown
- **Recovery Procedures**: Documented incident response
- **Timelock Bypass**: 2-hour emergency operations

## Deployment Process

LookCoin uses a three-stage deployment process to ensure proper contract setup and cross-chain connectivity:

### Deployment Stages

| Stage         | Script         | Purpose                                   | Prerequisites                            | Networks                                                      |
| ------------- | -------------- | ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| **Deploy**    | `deploy.ts`    | Create contracts and deployment artifacts | Network RPC access                       | All networks                                                  |
| **Setup**     | `setup.ts`     | Configure local roles and settings        | Deploy stage complete                    | All networks                                                  |
| **Configure** | `configure.ts` | Establish cross-chain connections         | Deployment artifacts from other networks | base-sepolia, bsc-testnet, optimism-sepolia, sapphire-mainnet |

**Important**: The home chain (BSC) should mint the full supply (as configured in `hardhat.config.ts` `TOTAL_SUPPLY`) after deployment. Secondary chains receive tokens only through bridges. See [DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) for detailed instructions.

### Stage 1: Deploy

Creates smart contracts and generates deployment artifacts on a single network:

```bash
# Deploy to specific networks
npm run deploy:bsc-testnet
npm run deploy:base-sepolia
npm run deploy:op-sepolia
npm run deploy:sapphire-mainnet
```

This stage uses Hardhat Ignition modules to deploy the LookCoin contract, bridge modules, and security infrastructure, creating a `deployment.json` file with contract addresses.

### Stage 2: Setup

Configures local roles and registers bridges post-deployment:

```bash
# Setup after deployment
npm run setup:bsc-testnet
npm run setup:base-sepolia
npm run setup:op-sepolia
npm run setup:sapphire-mainnet
```

This stage performs comprehensive local configuration:

**Role Assignments:**
- **MPC Vault** receives:
  - `MINTER_ROLE` - For minting tokens in business operations
  - `BURNER_ROLE` - For burning tokens in supply management
- **Dev Team** (if configured via `DEV_TEAM_ADDRESS`) receives:
  - `PROTOCOL_ADMIN_ROLE` - For configuring protocol settings
  - `ROUTER_ADMIN_ROLE` - For managing CrossChainRouter
  - `UPGRADER_ROLE` - For contract upgrades (redundancy with MPC vault)
  - `OPERATOR_ROLE` - On all infrastructure and protocol contracts
- **Bridge Modules** receive:
  - `MINTER_ROLE` and `BURNER_ROLE` - For burn-and-mint operations
  - `BRIDGE_ROLE` - For bridge-specific operations
- **LookCoin Contract** receives:
  - `BURNER_ROLE` - To enable direct LayerZero OFT functionality

**Infrastructure Setup:**
- Registers bridges with SupplyOracle for cross-chain tracking
- Configures CrossChainRouter with protocol modules (if deployed)
- Sets LayerZero endpoint for direct OFT transfers

### Stage 3: Configure

Establishes cross-chain connections between multiple networks:

```bash
# Configure cross-chain connections (only available for networks with deployment artifacts)
npm run configure:bsc-testnet
npm run configure:base-sepolia
npm run configure:optimism-sepolia
npm run configure:sapphire-mainnet
```

**Note**: Configure scripts are only available for networks that have deployment artifacts from other networks. This stage requires the `loadOtherChainDeployments()` function to scan the `/deployments` directory for JSON files from other networks to establish LayerZero trusted remotes, Celer IM remote modules, and cross-chain bridge registrations.

### Supply Management

- **Total Supply**: Configured in `hardhat.config.ts` as `TOTAL_SUPPLY` (currently 5 billion LOOK)
- **Home Chain**: BSC mints the full supply initially
- **Secondary Chains**: Start with 0 supply, receive tokens via bridges
- **Supply Monitoring**: SupplyOracle enforces the configured supply cap across all chains

### Deployment File Naming

Deployment files follow the canonical CHAIN_CONFIG key format (lowercase, no spaces or dashes) to ensure consistency with the network lookup logic:

- `basesepolia.json` (Base Sepolia)
- `bsctestnet.json` (BSC Testnet)
- `optimismsepolia.json` (Optimism Sepolia)
- `sapphiremainnet.json` (Sapphire Mainnet)

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed information about the naming convention and technical implementation.

### Execution Order

Always follow this sequence: **Deploy → Setup → Configure**

Currently, only 4 networks support all three stages because these are the only networks with the necessary deployment artifacts for cross-chain configuration.

### Supply Reconciliation

After deployment across multiple chains, use the reconciliation script to monitor and update cross-chain supply:

```bash
# Run reconciliation from any deployed network
npm run reconcile:bsc-testnet
npm run reconcile:base-sepolia
npm run reconcile:optimism-sepolia
```

The reconciliation script:
- Queries supply data from all deployed chains
- Calculates total supply across the ecosystem
- Updates SupplyOracle with accurate cross-chain data
- Detects supply discrepancies beyond tolerance threshold
- Triggers automatic bridge pausing if supply exceeds the configured total supply

**Note**: Reconciliation requires ORACLE_ROLE on the SupplyOracle contract.

## Development Setup

### Prerequisites

- Node.js v18+
- npm or yarn
- Hardhat

### Installation

```bash
# Clone repository
git clone https://github.com/lookcard/lookcoin-contract.git
cd lookcoin-contract

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your configuration:
# - GOVERNANCE_VAULT: MPC vault wallet address
# - DEV_TEAM_ADDRESS: Dev team address for technical roles (optional)
# - Network RPC URLs and private keys
```

### Compilation

```bash
# Compile contracts
npm run compile

# Check contract sizes
npm run size
```

### Testing

The test suite is organized into unit and integration tests for comprehensive coverage.

#### Test Structure

```bash
test/
├── unit/                    # Isolated contract testing
│   ├── lookcoin/           # Core token functionality
│   ├── bridges/            # Bridge module tests
│   ├── router/             # Cross-chain router tests
│   ├── feeManager/         # Fee management tests
│   ├── protocolRegistry/   # Protocol registry tests
│   └── security/           # Security component tests
└── integration/            # End-to-end testing
    ├── crossChainFlows.test.ts
    ├── security.test.ts
    └── consolidatedDeployment.test.ts
```

#### Running Tests

```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit
npm run test:unit:lookcoin    # Core token tests
npm run test:unit:bridges     # Bridge tests
npm run test:unit:router      # Router tests
npm run test:unit:security    # Security tests

# Integration tests
npm run test:integration
npm run test:integration:flows     # Cross-chain flows
npm run test:integration:security  # Security integration

# With gas reporting
npm run test:gas

# Coverage reports
npm run coverage
npm run coverage:unit
npm run coverage:integration
```

See [TESTCASE.md](./TESTCASE.md) for detailed test documentation.

## Ignition Deployment

The project uses Hardhat Ignition for modular deployment:

### Deployment Modules

- `LookCoinModule`: Main token deployment with UUPS proxy
- `CelerModule`: Celer IM bridge deployment
- `HyperlaneModule`: Hyperlane bridge deployment
- `OracleModule`: Supply oracle deployment
- `MocksModule`: Test infrastructure

### Deploy to Networks

```bash
# Testnet deployments
npm run deploy:bsc-testnet
npm run deploy:base-sepolia
npm run deploy:op-sepolia
npm run deploy:sapphire-testnet

# Mainnet deployments
npm run deploy:bsc-mainnet
npm run deploy:base-mainnet
npm run deploy:op-mainnet
npm run deploy:sapphire
```

### Configuration Parameters

```typescript
// LookCoinModule parameters
{
  governanceVault: "0x...", // MPC vault wallet address
  lzEndpoint: "0x...",      // LayerZero endpoint
  totalSupply: "5000000000", // 5B tokens (home chain only)
  chainId: 56,              // Target chain
  dvns: [...],              // DVN addresses
  requiredDVNs: 2,
  optionalDVNs: 1,
  dvnThreshold: 66
}
```

## Cross-Chain Operations

### LayerZero Transfer (BSC to Base)

```solidity
// User initiates transfer through LayerZero-enabled UI
// Tokens are burned on BSC and minted on Base
```

### Celer IM Transfer (BSC to Optimism)

```solidity
// Lock tokens on source chain
celerIMModule.lockAndBridge(
    dstChainId,
    recipient,
    amount,
    { value: messageFee }
);
```

### Hyperlane Transfer (BSC to Akashic)

```solidity
// Transfer tokens via Hyperlane
hyperlaneModule.bridgeToken(
    9070, // Akashic chain ID
    recipient,
    amount,
    { value: messageFee }
);
```

## Governance and Upgrades

### MPC Vault Wallet

- **Type**: External MPC vault for secure off-chain governance
- **Controls**: All administrative functions and critical operations
- **Security**: Multi-party computation ensures no single point of failure
- **Operations**: Direct execution without on-chain timelock delays

### Upgrade Process

1. Deploy new implementation
2. Authorize upgrade through MPC vault
3. Execute upgrade transaction
4. Verify new implementation

### Emergency Procedures

1. **Pause Operations**: Immediate halt via PAUSER_ROLE
2. **Assess Impact**: Review affected chains and bridges
3. **Implement Fix**: Deploy patches as needed
4. **Resume Operations**: Coordinated restart

## Monitoring and Security

### Supply Monitoring

- Real-time tracking across all chains
- 15-minute reconciliation cycles
- Automatic alerts on discrepancies
- Dashboard integration available

### Security Audits

- Smart contract audits by leading firms
- Quarterly security reviews
- Bug bounty program active
- Incident response procedures documented

### Monitoring Setup

```bash
# Configure monitoring endpoints
export MONITORING_API_KEY="..."
export ALERT_WEBHOOK="..."

# Run monitoring service
npm run monitor
```

## Network Configuration

### RPC Endpoints

```
BSC: https://bsc-dataseed.binance.org/
Base: https://mainnet.base.org
Optimism: https://mainnet.optimism.io
Sapphire: https://sapphire.oasis.io
Akashic: https://rpc.akashic.city
```

### Bridge Addresses

| Network  | LayerZero Endpoint                         | Celer MessageBus                           |
| -------- | ------------------------------------------ | ------------------------------------------ |
| BSC      | 0x3c2269811836af69497E5F486A85D7316753cf62 | 0x95714818fdd7a5454F73Da9c777B3ee6EbAEEa6B |
| Base     | 0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7 | Not Supported                              |
| Optimism | 0x3c2269811836af69497E5F486A85D7316753cf62 | 0x0D71D18126E03646eb09FEc929e2ae87b7CAE69d |
| Sapphire | Not Supported                              | 0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5 |

## Documentation

### For New Users
- 🚀 **[Quick Start Guide](docs/QUICK_START.md)** - Get running in 5 minutes
- 📋 **[User Flow Guide](docs/guides/user-flow.md)** - Step-by-step bridging instructions
- 📝 **[Contract Addresses](docs/ADDRESSES.md)** - Live contract addresses

### For Developers
- 👨‍💻 **[Developer Onboarding](docs/DEVELOPER_ONBOARDING.md)** - Complete setup guide
- 🛠 **[API Reference](docs/API_REFERENCE.md)** - Contract interfaces and functions
- 📖 **[Technical Architecture](docs/TECHNICAL.md)** - System design deep dive
- ⚙️ **[Deployment Guide](docs/DEPLOYMENT.md)** - Three-stage deployment process
- 🧨 **[Testing Guide](docs/TESTING.md)** - Comprehensive testing procedures

### For Operators
- 🔐 **[Security Framework](docs/SECURITY.md)** - Security model and audits
- 👁️ **[Oracle System](docs/ORACLE.md)** - Supply monitoring system
- 🚑 **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and solutions
- ✅ **[Best Practices](docs/BEST_PRACTICES.md)** - Development and operational guidelines

### Security & Compliance
- 🔍 **[Audit Report](docs/security/audit-report.md)** - Professional security audit results

### External Resources
- [LayerZero OFT V2 Documentation](https://layerzero.gitbook.io/docs/)
- [Celer IM Documentation](https://celer.network/docs/)
- [OpenZeppelin Security Guidelines](https://docs.openzeppelin.com/contracts/)
- [Hardhat Development Environment](https://hardhat.org/docs)

## Getting Started

{% tabs %}
{% tab title="New to LookCoin?" %}
**Start here** if you're new to the project:

1. 🚀 Read the [Quick Start Guide](docs/QUICK_START.md)
2. 📝 Check [Contract Addresses](docs/ADDRESSES.md) for live deployments
3. 📋 Follow the [User Flow Guide](docs/guides/user-flow.md) to bridge tokens
4. ❓ Need help? See [Troubleshooting](docs/TROUBLESHOOTING.md)
{% endtab %}

{% tab title="Developer?" %}
**Perfect** for developers integrating LookCoin:

1. 👨‍💻 Complete [Developer Onboarding](docs/DEVELOPER_ONBOARDING.md)
2. 📖 Study [Technical Architecture](docs/TECHNICAL.md)
3. 🛠 Reference [API Documentation](docs/API_REFERENCE.md)
4. ✅ Follow [Best Practices](docs/BEST_PRACTICES.md)
5. 🧨 Write tests using [Testing Guide](docs/TESTCASE.md)
{% endtab %}

{% tab title="DevOps/Operations?" %}
**Essential** for deployment and operations:

1. ⚙️ Master [Deployment Guide](docs/DEPLOYMENT.md)
2. 🔐 Review [Security Framework](docs/SECURITY.md)
3. 👁️ Understand [Oracle System](docs/ORACLE.md)
4. 🚑 Bookmark [Troubleshooting Guide](docs/TROUBLESHOOTING.md)
5. 🔍 Check [Audit Reports](docs/security/audit-report.md)
{% endtab %}
{% endtabs %}

## Community and Support

- **GitHub**: [github.com/lookcard/lookcoin-contract](https://github.com/lookcard/lookcoin-contract)
- **Issues**: [Report bugs and request features](https://github.com/lookcard/lookcoin-contract/issues)
- **Documentation**: [Complete documentation site](https://docs.lookcard.io)
- **Support**: support@lookcard.io

### Contributing

We welcome contributions! Please:

1. Read [Developer Onboarding](docs/DEVELOPER_ONBOARDING.md) first
2. Follow [Best Practices](docs/BEST_PRACTICES.md) guidelines
3. Ensure test coverage remains above 90%
4. All contributions require security review approval

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**⚠️ Important**: This is a financial infrastructure project. Always verify contract addresses and perform due diligence before interacting with smart contracts.
