# LookCoin - Omnichain Fungible Token

LookCoin (LOOK) is an omnichain fungible token implementing LayerZero OFT V2, serving as the primary payment method for LookCard's crypto-backed credit/debit card system. The token features a triple-bridge architecture supporting cross-chain transfers via LayerZero OFT V2, Celer IM, and IBC Protocol.

## Overview

### Key Features
- **Omnichain Compatibility**: Seamless transfers across BSC, Base, Optimism, Oasis Sapphire, and Akashic Chain
- **Triple-Bridge Architecture**: Redundancy and flexibility with three distinct bridge mechanisms
- **Fintech-Grade Security**: Rate limiting, supply reconciliation, and emergency controls
- **UUPS Upgradeable**: Future-proof design with proxy pattern implementation
- **MPC Multisig Governance**: 3-of-5 threshold for critical operations

### Supported Chains
| Chain | Chain ID | Bridge Support |
|-------|----------|----------------|
| BSC | 56 | LayerZero, Celer IM, IBC |
| Base | 8453 | LayerZero |
| Optimism | 10 | LayerZero, Celer IM |
| Oasis Sapphire | 23295 | Celer IM |
| Akashic | 12641 | IBC |

## Architecture

### Contract Structure
```
contracts/
├── LookCoin.sol              # Main token (OFTV2Upgradeable, RateLimiter)
├── bridges/
│   ├── CelerIMModule.sol     # Celer IM bridge (lock-and-mint)
│   └── IBCModule.sol         # IBC bridge (lock-and-mint)
├── security/
│   ├── RateLimiter.sol       # Sliding window rate limiting
│   └── SupplyOracle.sol      # Cross-chain supply monitoring
└── governance/
    └── MPCMultisig.sol       # 3-of-5 multisig governance
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

#### IBC Protocol (Lock-and-Mint)
- Cosmos ecosystem integration via BSC bridge
- 21 validator minimum with 2/3 majority consensus
- 14-day unbonding period for security

## Security Features

### Rate Limiting
- **Sliding Window Algorithm**: Per-user and global limits
- **Transaction Limits**: 500K tokens per transaction, 3 transactions per hour
- **User Tiers**: Configurable multipliers for different user types
- **Operation Types**: Distinct limits for MINT, BURN, BRIDGE_IN, BRIDGE_OUT

### Supply Reconciliation
- **15-Minute Monitoring**: Automated cross-chain supply tracking
- **Tolerance Threshold**: 1% deviation triggers alerts
- **Automatic Response**: Bridge pausing on supply mismatches
- **Multi-Signature Updates**: 3 signatures required for supply changes

### Emergency Controls
- **Circuit Breaker**: Immediate pause capability
- **Selective Pause**: Individual bridge shutdown
- **Recovery Procedures**: Documented incident response
- **Timelock Bypass**: 2-hour emergency operations

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
  admin: "0x...",           // Admin address
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

### MPC Multisig
- **Signers**: LookCard, Binance Labs, Security Partners
- **Threshold**: 3-of-5 for execution
- **Timelock**: 48 hours standard, 2 hours emergency
- **Key Rotation**: Quarterly schedule

### Upgrade Process
1. Deploy new implementation
2. Create proposal through multisig
3. Wait for timelock period
4. Execute upgrade
5. Verify new implementation

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
| Network | LayerZero Endpoint | Celer MessageBus |
|---------|-------------------|------------------|
| BSC | 0x3c2269811836af69497E5F486A85D7316753cf62 | 0x95714818fdd7a5454F73Da9c777B3ee6EbAEEa6B |
| Base | 0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7 | Not Supported |
| Optimism | 0x3c2269811836af69497E5F486A85D7316753cf62 | 0x0D71D18126E03646eb09FEc929e2ae87b7CAE69d |
| Sapphire | Not Supported | 0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5 |

## References and Documentation

### Technical Documentation
- [TECHNICAL.md](docs/TECHNICAL.md) - Detailed technical specifications
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