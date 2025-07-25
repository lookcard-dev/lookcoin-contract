# LookCoin - Omnichain Fungible Token

LookCoin (LOOK) is an omnichain fungible token implementing LayerZero OFT V2, serving as the primary payment method for LookCard's crypto-backed credit/debit card system. The token features a triple-bridge architecture supporting cross-chain transfers via LayerZero OFT V2, Celer IM, and IBC Protocol.

## Overview

### Key Features

- **Omnichain Compatibility**: Seamless transfers across BSC, Base, Optimism, Oasis Sapphire, and Akashic Chain
- **Triple-Bridge Architecture**: Redundancy and flexibility with three distinct bridge mechanisms
- **Fintech-Grade Security**: Rate limiting, supply reconciliation, and emergency controls
- **UUPS Upgradeable**: Future-proof design with proxy pattern implementation
- **MPC Vault Governance**: External MPC vault wallet for secure off-chain governance

### Supported Chains

| Chain          | Chain ID | Bridge Support           |
| -------------- | -------- | ------------------------ |
| BSC            | 56       | LayerZero, Celer IM, IBC |
| Base           | 8453     | LayerZero                |
| Optimism       | 10       | LayerZero, Celer IM      |
| Oasis Sapphire | 23295    | Celer IM                 |
| Akashic        | 9070     | IBC                      |

## Architecture

### Contract Structure

```
contracts/
├── LookCoin.sol              # Main token (OFTV2Upgradeable, RateLimiter)
├── bridges/
│   ├── CelerIMModule.sol     # Celer IM bridge (lock-and-mint)
│   └── IBCModule.sol         # IBC bridge (lock-and-mint)
└── security/
    ├── RateLimiter.sol       # Sliding window rate limiting
    └── SupplyOracle.sol      # Cross-chain supply monitoring
```

### Bridge Mechanisms

#### LayerZero OFT V2 (Burn-and-Mint)

- Native integration in LookCoin contract
- DVN validation: 2 required, 1 optional, 66% threshold
- Supported on BSC, Base, and Optimism

#### Celer IM (Lock-and-Mint)

- Separate bridge module with MessageBus integration
- SGN consensus validation
- Supported on BSC, Optimism, and Oasis Sapphire

#### Hyperlane (Burn-and-Mint) - Planned

- Modular security via ISM (Interchain Security Modules)
- Self-hosted infrastructure for complete control
- Will support BSC, Base, Optimism, and Akashic

## Security Features

### Rate Limiting

- **Per-Transaction Limit**: 500K LOOK maximum
- **Per-Account Hourly Limit**: 1.5M LOOK (3 transactions)
- **Global Daily Limit**: 20% of total supply
- **Sliding Window Algorithm**: Accurate rate tracking
- **Emergency Bypass**: Available for authorized operations

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

This stage assigns MINTER_ROLE and BURNER_ROLE to appropriate contracts and registers local bridges with the SupplyOracle.

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
# Edit .env with your configuration
```

### Compilation

```bash
# Compile contracts
npm run compile

# Check contract sizes
npm run size
```

### Testing

```bash
# Run all tests
npm test

# Run with gas reporting
npm run test:gas

# Generate coverage report
npm run coverage

# Run specific test suites
npm run test:integration
npm run test:security
```

## Ignition Deployment

The project uses Hardhat Ignition for modular deployment:

### Deployment Modules

- `LookCoinModule`: Main token deployment with UUPS proxy
- `CelerModule`: Celer IM bridge deployment
- `IBCModule`: IBC bridge deployment
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
  totalSupply: "1000000000", // 1B tokens
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

### IBC Transfer (BSC to Akashic)

```solidity
// Lock tokens for IBC transfer
ibcModule.lockForIBC(
    "akashic1...", // Bech32 address
    amount
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

## References and Documentation

### Technical Documentation

- [TECHNICAL.md](docs/TECHNICAL.md) - Detailed technical specifications
- [TIMELINE.md](docs/TIMELINE.md) - Deployment timeline and milestones
- [USER_FLOW.md](docs/USER_FLOW.md) - User guide for cross-chain bridging operations
- [CLAUDE.md](CLAUDE.md) - AI assistant guidance

### External Resources

- [LayerZero OFT V2 Documentation](https://layerzero.gitbook.io/docs/)
- [Celer IM Documentation](https://celer.network/docs/)
- [IBC Protocol Specification](https://github.com/cosmos/ibc)

### Security Best Practices

- [OpenZeppelin Security](https://docs.openzeppelin.com/contracts/)
- [Smart Contract Security Verification Standard](https://github.com/securing/SCSVS)

## Community and Support

### Resources

- GitHub: [github.com/lookcard/lookcoin-contract](https://github.com/lookcard/lookcoin-contract)
- Documentation: [docs.lookcard.io](https://docs.lookcard.io)
- Support: support@lookcard.io

### Contributing

Please read our contributing guidelines before submitting PRs. All contributions must pass security review and maintain test coverage above 90%.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**⚠️ Important**: This is a financial infrastructure project. Always verify contract addresses and perform due diligence before interacting with smart contracts.
