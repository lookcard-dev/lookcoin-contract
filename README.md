# LookCoin (LOOK) - Omnichain Token Contract

LookCoin (LOOK) is an omnichain fungible token implementing a triple-bridge architecture using LayerZero OFT V2, Celer IM, and IBC protocols. Designed for LookCard's crypto-backed credit/debit card ecosystem with fintech-grade security and governance.

## 🌐 Supported Chains

- **BSC (Binance Smart Chain)** - Primary chain with IBC support for Akashic
- **Base** - Ethereum L2 with LayerZero and Celer IM
- **Optimism** - Ethereum L2 with LayerZero and Celer IM
- **Akashic** - Cosmos-based chain via IBC

## 🏗️ Architecture Overview

### Bridge Mechanisms

1. **LayerZero OFT V2** - Burn-and-mint with DVN validation
   - 66% DVN consensus threshold
   - 600-second timeout for cross-chain validation
   - Native gas payment for cross-chain fees

2. **Celer IM** - Lock-and-mint with SGN consensus  
   - State Guardian Network validation
   - Liquidity pool integration via cBridge
   - Slippage protection and fee optimization

3. **IBC Protocol** - Lock-and-mint for Cosmos ecosystem
   - 21+ validator minimum with 2/3 consensus
   - 14-day unbonding period
   - 1-hour packet timeout

### Security Features

- **Upgradeable Proxy Pattern (UUPS)** with role-based upgrade control
- **MPC Multisig Governance** with 3-of-5 threshold and timelock
- **Rate Limiting** with sliding window algorithm
- **Emergency Pause** mechanisms with circuit breakers
- **Supply Reconciliation** with 15-minute monitoring intervals

## 📋 Prerequisites

- Node.js 18+
- npm or yarn
- Hardhat environment
- Private keys for deployment accounts

## ⚙️ Installation

```bash
# Clone repository
git clone <repository-url>
cd lookcoin-contract

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env with your configuration
```

## 🔧 Environment Variables

Create a `.env` file with the following variables:

```bash
# Network RPC URLs
BSC_RPC_URL=https://bsc-dataseed.binance.org/
BASE_RPC_URL=https://mainnet.base.org
OPTIMISM_RPC_URL=https://mainnet.optimism.io

# Private keys
DEPLOYER_PRIVATE_KEY=0x...

# API keys for verification
BSCSCAN_API_KEY=your_bscscan_api_key
BASESCAN_API_KEY=your_basescan_api_key
OPTIMISM_API_KEY=your_optimism_api_key

# MPC Multisig addresses (production)
MPC_MULTISIG_BSC=0x...
MPC_MULTISIG_BASE=0x...
MPC_MULTISIG_OPTIMISM=0x...
```

## 🚀 Development Commands

### Compilation and Testing

```bash
# Compile contracts
npm run compile

# Run tests
npm test

# Run tests with gas reporting
npm run test:gas

# Generate coverage report
npm run coverage

# Check contract sizes
npm run size
```

### Deployment

```bash
# Deploy to BSC
npm run deploy:bsc

# Deploy to Base
npm run deploy:base

# Deploy to Optimism
npm run deploy:optimism

# Configure cross-chain connections
npx hardhat run scripts/configure.ts --network <network>
```

### Contract Verification

```bash
# Verify all deployed contracts
npm run verify

# Verify specific contract
npx hardhat verify <contract-address> --network <network>
```

## 📁 Project Structure

```
contracts/
├── LookCoin.sol              # Main omnichain token contract
├── bridges/
│   ├── CelerIMModule.sol     # Celer IM bridge module
│   └── IBCModule.sol         # IBC bridge module
├── security/
│   ├── RateLimiter.sol       # Rate limiting utilities
│   └── SupplyOracle.sol      # Cross-chain supply monitoring
├── governance/
│   └── MPCMultisig.sol       # MPC multisig governance
test/
├── LookCoin.test.ts          # Core token tests
├── bridges/                  # Bridge-specific tests
├── security/                 # Security feature tests
├── integration/              # End-to-end tests
└── mocks/                    # Mock contracts for testing
scripts/
├── deploy.ts                 # Deployment script
└── configure.ts              # Cross-chain configuration
```

## 🔐 Security Model

### Role-Based Access Control

- **DEFAULT_ADMIN_ROLE** - MPC multisig governance
- **MINTER_ROLE** - Bridge modules for cross-chain minting  
- **BURNER_ROLE** - LayerZero module for burn operations
- **PAUSER_ROLE** - Emergency response team
- **UPGRADER_ROLE** - Contract upgrade authority

### MPC Multisig Governance

- **3-of-5 signature threshold** for all critical operations
- **Timelock mechanisms**: 48h standard, 2h emergency, 0h immediate pause
- **Key rotation**: Quarterly with 7-day delay
- **Geographically distributed** key shares

### Rate Limiting

- **Sliding window algorithm** with configurable periods
- **Per-user and global limits** to prevent abuse
- **Multiple operation types** (transfer, bridge, mint, burn)
- **Tier-based multipliers** for different user classes

### Emergency Response

- **4-level incident classification** with automated responses
- **Circuit breakers** for supply mismatches
- **Automatic bridge pausing** on anomaly detection
- **Supply reconciliation** every 15 minutes

## 🌉 Cross-Chain Operations

### LayerZero Transfer

```solidity
// Transfer from BSC to Base
lookCoin.sendFrom(
    sender,
    184,  // Base chain ID
    abi.encodePacked(recipient),
    amount,
    sender,
    address(0),
    "0x",
    { value: estimatedFee }
);
```

### Celer IM Transfer

```solidity
// Lock and bridge via Celer IM
celerModule.lockAndBridge(
    10,  // Optimism chain ID
    recipient,
    amount,
    { value: celerFee }
);
```

### IBC Transfer

```solidity
// Lock for IBC transfer to Akashic
ibcModule.lockForIBC(
    "akash1...", // Bech32 recipient
    amount
);
```

## 📊 Monitoring and Analytics

### Supply Reconciliation

The SupplyOracle monitors token supply across all chains:

- **15-minute reconciliation cycles**
- **Automatic mismatch detection**
- **Bridge pausing on discrepancies**
- **Real-time supply tracking**

### Rate Limit Monitoring

Track rate limit usage and capacity:

```solidity
// Check remaining capacity
(uint256 remainingTokens, uint256 remainingTx) = 
    lookCoin.getRemainingCapacity(user, OperationType.TRANSFER);
```

### Cross-Chain Events

Monitor cross-chain transfers via events:

- `CrossChainTransferInitiated`
- `CrossChainTransferReceived`
- `SupplyMismatchDetected`
- `BridgePaused/Unpaused`

## 🔄 Upgrade Process

### UUPS Proxy Upgrades

1. **Prepare new implementation**
2. **Submit upgrade proposal** to MPC multisig
3. **Collect 3-of-5 signatures**
4. **Wait for timelock period** (48h standard)
5. **Execute upgrade** through proxy

### Governance Workflow

```solidity
// 1. Propose upgrade transaction
uint256 txId = mpcMultisig.proposeTransaction(
    proxyAddress,
    0,
    upgradeCalldata,
    TxType.STANDARD
);

// 2. Collect signatures
mpcMultisig.signTransaction(txId);

// 3. Execute after timelock
mpcMultisig.executeTransaction(txId);
```

## 🧪 Testing

### Test Categories

- **Unit Tests** - Individual contract functionality
- **Integration Tests** - Cross-chain operations
- **Security Tests** - Access control and rate limiting
- **Stress Tests** - High-load scenarios

### Running Tests

```bash
# All tests
npm test

# Specific test suite
npx hardhat test test/LookCoin.test.ts

# With coverage
npm run coverage

# Gas analysis
npm run test:gas
```

## 📚 Documentation References

- [LayerZero V2 Documentation](https://docs.layerzero.network/)
- [Celer IM Documentation](https://cbridge-docs.celer.network/)
- [IBC Protocol Specification](https://github.com/cosmos/ibc)
- [OpenZeppelin Upgradeable Contracts](https://docs.openzeppelin.com/upgrades)

## ⚠️ Security Considerations

- **Never deploy without proper testing** on testnets first
- **Verify all contract addresses** before configuration
- **Test emergency procedures** regularly
- **Monitor supply reconciliation** continuously
- **Keep private keys secure** with hardware wallets
- **Use MPC for production** governance operations

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Implement changes with tests
4. Run security analysis
5. Submit pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For technical support or security issues:

- Create an issue in this repository
- Contact the development team
- Review the technical documentation in `docs/TECHNICAL.md`

---

**⚠️ IMPORTANT**: This is production-grade financial infrastructure. Ensure proper testing, auditing, and security reviews before mainnet deployment.