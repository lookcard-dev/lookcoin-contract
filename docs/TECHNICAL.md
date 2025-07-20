# LookCoin Technical Architecture

## Executive Summary

LookCoin (LOOK) is the native platform token of the LookCard ecosystem, designed as an omnichain fungible token utilizing a triple-bridge architecture for seamless cross-chain transfers. The token integrates LayerZero's OFT V2 standard (BSC, Base, Optimism), Celer IM's cross-chain messaging (BSC, Optimism), and the Inter-Blockchain Communication (IBC) protocol (Akashic Chain via BSC), creating a comprehensive multi-chain token ecosystem. The architecture employs a unified global supply model with burn-and-mint mechanics on LayerZero-supported chains, lock-and-mint mechanics for both Celer IM and IBC bridges, ensuring consistent token supply across all deployments while providing redundancy and enhanced cross-chain capabilities. The architecture additionally supports Oasis Sapphire through Celer IM integration.

## Token Specification

### Core Token Properties

- **Token Name**: LookCoin
- **Token Symbol**: LOOK
- **Decimals**: 18
- **Total Supply**: Fixed supply model with cross-chain reconciliation
- **Standard**: ERC-20 base with LayerZero OFTV2 extension
- **Governance**: External MPC vault wallet for secure off-chain governance

### Technical Standards

- **ERC-20 Compliance**: Full compatibility with standard token interfaces
- **OFTV2 Implementation**: LayerZero's Omnichain Fungible Token V2 standard
- **Upgradeable Contracts**: Proxy pattern for future enhancements
- **Access Control**: Role-based permissions with granular controls

## Omnichain Architecture Overview

LookCoin implements a triple-bridge architecture to achieve comprehensive cross-chain functionality:

### LayerZero Integration

- **Supported Chains**: BSC, Base, Optimism
- **Mechanism**: Burn-and-mint for supply consistency
- **Security**: Decentralized Verifier Network (DVN) validation
- **Messaging**: Ultra Light Node (ULN) for cross-chain communication

### Celer IM Integration

- **Supported Chains**: BSC, Optimism, Oasis Sapphire
- **Mechanism**: Lock-and-mint through cBridge liquidity pools
- **Security**: State Guardian Network (SGN) validation
- **Messaging**: MessageBus for arbitrary cross-chain communication

### IBC Bridge Integration

- **Target Chain**: Akashic Chain
- **Mechanism**: Lock-and-mint through BSC bridge
- **Security**: IBC validator consensus
- **Interoperability**: Native IBC packet routing

```mermaid
graph TB
    subgraph "Omnichain Network"
        BSC[BSC<br/>LOOK Token]
        BASE[Base<br/>LOOK Token]
        OPT[Optimism<br/>LOOK Token]
        SAPPHIRE[Oasis Sapphire<br/>LOOK Token]
    end

    AKASHIC[Akashic Chain<br/>Wrapped LOOK]

    BSC <--> |LayerZero OFT V2| BASE
    BSC <--> |LayerZero OFT V2| OPT
    BASE <--> |LayerZero OFT V2| OPT

    BSC <-.-> |Celer IM| OPT
    BSC <-.-> |Celer IM| SAPPHIRE
    OPT <-.-> |Celer IM| SAPPHIRE

    BSC <--> |IBC Protocol| AKASHIC

    style BSC fill:#f9d71c
    style BASE fill:#0052cc
    style OPT fill:#ff0420
    style SAPPHIRE fill:#0ca789
    style AKASHIC fill:#00d4ff
```

## Chain Deployment Matrix

| Chain Name     | Bridge Types               | Network ID | Contract Address | Status  |
| -------------- | -------------------------- | ---------- | ---------------- | ------- |
| BSC            | LayerZero OFT V2, Celer IM | 56         | TBD              | Planned |
| Base           | LayerZero OFT V2           | 8453       | TBD              | Planned |
| Optimism       | LayerZero OFT V2, Celer IM | 10         | TBD              | Planned |
| Oasis Sapphire | Celer IM                   | 23295      | TBD              | Planned |
| Akashic Chain  | IBC Bridge                 | 9070       | TBD              | Planned |

## Cross-Chain Flow Diagrams

### LayerZero Burn-and-Mint Flow

```mermaid
sequenceDiagram
    participant User
    participant SourceChain as Source Chain<br/>(e.g., BSC)
    participant LZ as LayerZero<br/>Endpoint
    participant DVN as Decentralized<br/>Verifier Network
    participant DestChain as Destination Chain<br/>(e.g., Base)

    User->>SourceChain: Initiate transfer
    SourceChain->>SourceChain: Burn LOOK tokens
    SourceChain->>LZ: Send message + proof
    LZ->>DVN: Validate transaction
    DVN->>DVN: Consensus verification
    DVN->>LZ: Approve message
    LZ->>DestChain: Deliver message
    DestChain->>DestChain: Mint LOOK tokens
    DestChain->>User: Credit tokens

    Note over SourceChain,DestChain: Total supply remains constant
```

### IBC Lock-and-Mint Flow

```mermaid
sequenceDiagram
    participant User
    participant BSC as BSC<br/>Bridge Contract
    participant Relayer as IBC<br/>Relayer
    participant AkashicVal as Akashic<br/>Validators
    participant Akashic as Akashic Chain

    User->>BSC: Lock LOOK tokens
    BSC->>BSC: Emit lock event
    BSC->>Relayer: Create IBC packet
    Relayer->>AkashicVal: Submit packet
    AkashicVal->>AkashicVal: Validate packet
    AkashicVal->>Akashic: Approve minting
    Akashic->>Akashic: Mint wrapped LOOK
    Akashic->>User: Credit tokens

    Note over BSC,Akashic: Locked tokens = Minted tokens
```

### Celer IM Lock-and-Mint Flow

```mermaid
sequenceDiagram
    participant User
    participant SourceChain as Source Chain<br/>(e.g., BSC)
    participant MessageBus as MessageBus
    participant SGN as State Guardian<br/>Network
    participant DestChain as Destination Chain<br/>(e.g., Optimism)

    User->>SourceChain: Initiate transfer
    SourceChain->>SourceChain: Lock LOOK tokens
    SourceChain->>MessageBus: Send cross-chain message
    MessageBus->>SGN: Request validation
    SGN->>SGN: Multi-signature validation
    SGN->>MessageBus: Approve transfer
    MessageBus->>DestChain: Deliver message
    DestChain->>DestChain: Mint LOOK tokens
    DestChain->>User: Credit tokens

    Note over SourceChain,DestChain: Locked tokens = Minted tokens
```

Note: The same Celer IM lock-and-mint flow applies to transfers involving Oasis Sapphire as source or destination chain.

### Supply Reconciliation Mechanism

```mermaid
sequenceDiagram
    participant Oracle as Supply Oracle
    participant Chains as All Chains
    participant Monitor as Monitoring System
    participant Alert as Alert System

    loop Every 15 minutes
        Oracle->>Chains: Query total supply
        Chains-->>Oracle: Return balances
        Oracle->>Oracle: Calculate global supply
        Oracle->>Monitor: Report metrics
        alt Supply mismatch detected
            Monitor->>Alert: Trigger alert
            Alert->>Alert: Pause bridges
            Alert->>Alert: Notify operators
        end
    end
```

## Smart Contract Design

### Contract Architecture

#### Upgradeable Proxy Pattern

```solidity
// Proxy implementation pattern
contract LookCoinOFTV2 is OFTV2Upgradeable, UUPSUpgradeable {
    // Implementation details
}
```

#### Key Components

- **Token Core**: ERC-20 implementation with minting/burning capabilities
- **OFT V2 Module**: LayerZero cross-chain functionality
- **Access Control**: Role-based permissions system
- **Emergency Controls**: Pause mechanism for security incidents

### Contract Modules

#### Core Token Module

- Standard ERC-20 functions
- Mint/burn authorization logic
- Balance tracking and transfers
- Supply management

#### Cross-Chain Module

- LayerZero endpoint integration
- Celer IM MessageBus interface integration
- SGN signature verification logic
- cBridge liquidity pool handling
- Message encoding/decoding for LayerZero and Celer IM
- Fee calculation logic
- Chain-specific configurations

#### Security Module

- Emergency pause functionality
- Rate limiting mechanisms
- Whitelist/blacklist management
- Multi-signature requirements

#### Governance Module

- Proposal submission system
- Voting mechanisms
- Execution timelock
- Parameter adjustment

## Security & Ownership Model

### MPC Vault Governance

- **Type**: External MPC vault wallet (off-chain governance)
- **Security**: Multi-party computation ensures no single point of failure
- **Operations**: Direct execution of administrative functions
- **Key Management**: Secure key distribution managed by MPC vault provider
- **Access Control**: All contract admin roles assigned to vault address

### LayerZero Security Configuration

```yaml
DVN Configuration:
  - Required DVNs: 2
  - Optional DVNs: 1
  - Verification Threshold: 66%
  - Timeout Period: 600 seconds
```

### IBC Security Model

- **Validator Set**: Minimum 21 active validators
- **Trust Period**: 14-day unbonding period
- **Light Client**: On-chain verification
- **Packet Timeout**: 1-hour expiry

### Celer IM Security Model

- **Validator Set**: SGN validators with staked CELR tokens
- **Trust Model**: Non-custodial liquidity pool management
- **Validation Process**: Multi-signature validation by SGN
- **Slashing Conditions**: Penalties for malicious behavior or downtime
- **Liquidity Security**: Real-time pool monitoring and automated risk management

### Security Layers

1. **Smart Contract Level**: Audited code with formal verification
2. **Bridge Level**: DVN/Validator consensus requirements
3. **Operational Level**: MPC multisig for admin functions
4. **Monitoring Level**: Real-time anomaly detection

### Access Control & Role Assignment

#### Role Overview

The LookCoin ecosystem implements granular role-based access control using OpenZeppelin's AccessControl pattern. All contracts share a unified role hierarchy with the MPC vault serving as the governance authority.

| Contract              | Role Constant        | Gated Functions                               | Capabilities                    | Default Assignee | Revocability |
| --------------------- | -------------------- | --------------------------------------------- | ------------------------------- | ---------------- | ------------ |
| **LookCoin.sol**      |                      |                                               |                                 |                  |              |
|                       | `DEFAULT_ADMIN_ROLE` | `grantRole()`, `revokeRole()`                 | Grant/revoke all roles          | MPC Vault        | No           |
|                       | `MINTER_ROLE`        | `mint()`                                      | Mint new tokens                 | Bridge Modules   | Yes          |
|                       | `BURNER_ROLE`        | `burn()`, `burnFrom()`                        | Burn tokens                     | LookCoin (self)  | Yes          |
|                       | `PAUSER_ROLE`        | `pause()`, `unpause()`                        | Pause/unpause transfers         | MPC Vault        | Yes          |
|                       | `UPGRADER_ROLE`      | `upgradeToAndCall()`                          | Upgrade contract implementation | MPC Vault        | Yes          |
|                       | `BRIDGE_ROLE`        | `setTrustedRemote()`                          | Configure LayerZero endpoints   | MPC Vault        | Yes          |
| **IBCModule.sol**     |                      |                                               |                                 |                  |              |
|                       | `DEFAULT_ADMIN_ROLE` | `grantRole()`, `revokeRole()`                 | Grant/revoke all roles          | MPC Vault        | No           |
|                       | `ADMIN_ROLE`         | `setChannel()`, `pause()`, `unpause()`        | Configure IBC channels          | MPC Vault        | Yes          |
|                       | `OPERATOR_ROLE`      | `setSupplyOracle()`, `setRateLimiter()`       | Update dependencies             | MPC Vault        | Yes          |
|                       | `RELAYER_ROLE`       | `OnRecvPacket()`, `OnAcknowledgementPacket()` | Process IBC packets             | IBC Relayers     | Yes          |
| **CelerIMModule.sol** |                      |                                               |                                 |                  |              |
|                       | `DEFAULT_ADMIN_ROLE` | `grantRole()`, `revokeRole()`                 | Grant/revoke all roles          | MPC Vault        | No           |
|                       | `ADMIN_ROLE`         | `setMessageBus()`, `pause()`, `unpause()`     | Configure Celer IM              | MPC Vault        | Yes          |
|                       | `OPERATOR_ROLE`      | `setSupplyOracle()`, `setRateLimiter()`       | Update dependencies             | MPC Vault        | Yes          |
| **SupplyOracle.sol**  |                      |                                               |                                 |                  |              |
|                       | `DEFAULT_ADMIN_ROLE` | `grantRole()`, `revokeRole()`                 | Grant/revoke all roles          | MPC Vault        | No           |
|                       | `ORACLE_ROLE`        | `updateSupplyReport()`                        | Report chain supplies           | Off-chain Oracle | Yes          |
|                       | `OPERATOR_ROLE`      | `setThresholds()`, `registerBridge()`         | Configure monitoring            | MPC Vault        | Yes          |
|                       | `EMERGENCY_ROLE`     | `emergencyPause()`, `forceReconcile()`        | Emergency response              | MPC Vault        | Yes          |

#### Role Hierarchy

The role system follows a hierarchical structure where `DEFAULT_ADMIN_ROLE` serves as the root administrator:

```mermaid
graph TD
    A[DEFAULT_ADMIN_ROLE<br/>MPC Vault] --> B[Contract-Specific Admin Roles]
    B --> C[ADMIN_ROLE<br/>Bridges & Oracle]
    B --> D[UPGRADER_ROLE<br/>LookCoin]
    B --> E[PAUSER_ROLE<br/>LookCoin]
    C --> F[Operational Roles]
    F --> G[MINTER_ROLE]
    F --> H[BURNER_ROLE]
    F --> I[BRIDGE_ROLE]
    F --> J[OPERATOR_ROLE]
    F --> K[RELAYER_ROLE]
    F --> L[ORACLE_ROLE]
    C --> M[EMERGENCY_ROLE]
```

#### Cross-Contract Role Dependencies

The system implements carefully orchestrated role dependencies to enable secure cross-chain operations:

1. **Minting Permissions**: Bridge modules (IBCModule and CelerIMModule) require `MINTER_ROLE` on the LookCoin contract to mint tokens when receiving cross-chain transfers. This permission is granted post-deployment via setup scripts.

2. **Burning Permissions**: The LookCoin contract grants `BURNER_ROLE` to itself during initialization to enable LayerZero OFT burns. This self-delegation pattern ensures only the token contract can initiate burn operations.

3. **Oracle Registration**: The SupplyOracle contract must register each bridge module address to monitor their locked/minted supplies. Bridge contracts call `registerBridge()` during setup.

4. **Rate Limiter Sharing**: Both bridge modules reference the same RateLimiter instance, requiring `OPERATOR_ROLE` to update the limiter address if needed.

#### Role Assignment Lifecycle

The role assignment follows a three-stage pattern designed for security and operational efficiency, matching the deployment process:

**Stage 1: Contract Deployment**

- During deployment, only administrative roles are assigned to the `_admin` parameter (MPC vault)
- This includes `DEFAULT_ADMIN_ROLE`, `ADMIN_ROLE`, `PAUSER_ROLE`, `UPGRADER_ROLE`, `OPERATOR_ROLE`, and `EMERGENCY_ROLE`
- No operational permissions are granted during initialization to prevent unauthorized operations
- Creates deployment artifacts with contract addresses for use in subsequent stages

**Stage 2: Setup (Local Configuration)**

- **Script**: `scripts/setup.ts`
- **Purpose**: Configures roles and settings for the current network only
- **Operations**:
  - Assigns `MINTER_ROLE` to IBCModule and CelerIMModule on the LookCoin contract
  - Grants `BURNER_ROLE` to LookCoin contract itself for LayerZero burns
  - Registers local bridges with SupplyOracle for the current network only
  - Configures rate limiting parameters
  - Operates on a single network using only local deployment artifacts

**Stage 3: Configure (Cross-Chain Configuration)**

- **Script**: `scripts/configure.ts`
- **Purpose**: Establishes cross-chain connections and permissions
- **Operations**:
  - Sets up LayerZero trusted remotes using contract addresses from other networks
  - Configures Celer IM remote modules for cross-chain messaging
  - Registers bridges from ALL networks in the local SupplyOracle
  - Assigns `RELAYER_ROLE` to authorized IBC relayer addresses
  - Grants `ORACLE_ROLE` to the off-chain oracle service address
  - Bridge endpoints and channel configurations are established

**Technical Dependencies**:

- **Setup Stage**: Uses only local deployment artifacts and centralized configuration
- **Configure Stage**: Requires deployment artifacts from other networks via `loadOtherChainDeployments()`
- **Security**: Implements cross-tier validation to prevent mainnet/testnet mixing

#### Security Rationale

The role separation follows the principle of least privilege:

- **Governance Isolation**: MPC vault holds administrative roles but not operational roles, preventing accidental token minting/burning
- **Bridge Autonomy**: Each bridge module operates independently with its own `MINTER_ROLE` grant, allowing selective bridge disabling
- **Emergency Response**: `EMERGENCY_ROLE` provides rapid response capability without full admin access
- **Relayer Decentralization**: Multiple addresses can hold `RELAYER_ROLE` for redundancy

#### Operational Examples

**Emergency Pause Scenario**:

```solidity
// MPC vault initiates emergency pause
1. Call LookCoin.pause() with PAUSER_ROLE
2. Call IBCModule.pause() with ADMIN_ROLE
3. Call CelerIMModule.pause() with ADMIN_ROLE
4. Oracle detects pause and halts monitoring
```

**Cross-Chain Transfer Flow**:

```solidity
// User bridges from BSC to Optimism via Celer
1. User calls CelerIMModule.sendToken()
2. CelerIMModule locks tokens (no special role needed)
3. Celer validators relay message
4. Destination CelerIMModule.executeMessage()
5. Uses MINTER_ROLE to mint tokens to recipient
6. Oracle updates supply report with ORACLE_ROLE
```

**Contract Upgrade Process**:

```solidity
// Upgrading LookCoin implementation
1. Deploy new implementation contract
2. MPC vault calls upgradeToAndCall() with UPGRADER_ROLE
3. Roles persist through upgrade (stored in proxy)
4. No role reassignment needed
```

#### Role Management Procedures

**Granting a New Role**:

```typescript
// Only DEFAULT_ADMIN_ROLE can execute
await lookCoin.grantRole(MINTER_ROLE, newBridgeAddress);
```

**Revoking a Role**:

```typescript
// Revoke compromised oracle
await supplyOracle.revokeRole(ORACLE_ROLE, compromisedAddress);
```

**Role Verification**:

```typescript
// Check if address has role
const hasMinterRole = await lookCoin.hasRole(MINTER_ROLE, bridgeAddress);
```

**Emergency Role Rotation**:

1. Revoke role from compromised address
2. Grant role to new secure address
3. Update off-chain services to use new address
4. Monitor for any unauthorized attempts

#### Upgrade Impact on Roles

- Roles are stored in the proxy contract, not the implementation
- Upgrading contract logic does not affect role assignments
- New roles can be added in upgraded implementations
- Existing roles remain functional across upgrades
- Role constants must maintain same bytes32 values for compatibility

## Governance & Upgradeability

### Governance Workflow

```mermaid
graph LR
    A[Decision<br/>Required] --> B[MPC Vault<br/>Authorization]
    B --> C[Direct<br/>Execution]
    C --> D[Post-Execution<br/>Audit]

    style A fill:#e1f5e1
    style B fill:#ffe1e1
    style C fill:#e1e1ff
```

### Upgrade Procedures

#### Standard Upgrade Process

1. **Technical Review**: Specification and impact analysis
2. **Security Audit**: External audit for major changes
3. **MPC Vault Authorization**: Secure approval through vault
4. **Execution**: Direct upgrade transaction
5. **Verification**: Post-upgrade testing and monitoring

#### Emergency Response

- **Severity Levels**: Critical, High, Medium, Low
- **Immediate Action**: Direct execution through MPC vault
- **Pause First**: Immediate pause capability
- **Communication**: Real-time updates via official channels

### Cross-Chain Coordination

#### Upgrade Synchronization

- Coordinated upgrade windows
- Chain-by-chain rollout strategy
- Rollback procedures
- Version compatibility matrix

#### Parameter Adjustment

- Fee updates
- Rate limits
- Whitelist management
- Bridge configurations

## Risk Mitigation & Monitoring

### Supply Monitoring System

#### Real-Time Tracking

- **Metrics**: Total supply per chain, bridge volumes, transaction counts
- **Frequency**: 1-minute intervals for critical metrics
- **Storage**: Time-series database with 1-year retention
- **Dashboards**: Grafana visualization with alerts

#### Reconciliation Process

```javascript
// Pseudo-code for supply reconciliation across LayerZero, IBC, and Celer IM bridges
async function reconcileSupply() {
  const supplies = await Promise.all(SUPPORTED_CHAINS.map((chain) => chain.getTotalSupply()));

  const totalSupply = supplies.reduce((a, b) => a + b, 0);

  if (totalSupply !== EXPECTED_TOTAL_SUPPLY) {
    await pauseAllBridges(); // Pauses LayerZero, IBC, and Celer IM bridges
    await alertOperators();
    await initiateInvestigation();
  }
}
```

### Incident Response Framework

#### Response Levels

1. **Level 1**: Automated response (pause bridges)
2. **Level 2**: Operator intervention required
3. **Level 3**: MPC vault action needed
4. **Level 4**: Community notification and action

#### Bridge Failure Scenarios

- **Communication Failure**: Retry with exponential backoff
- **Validation Failure**: Manual investigation required
- **Supply Mismatch**: Automatic bridge pause
- **Contract Compromise**: Emergency pause all operations

### Security Requirements

#### Audit Schedule

- **Pre-Launch**: Full security audit by tier-1 firm
- **Quarterly**: Incremental audits for changes
- **Annual**: Comprehensive security review
- **Ad-Hoc**: Critical updates audit

#### Monitoring Infrastructure

- **Log Aggregation**: Centralized logging system
- **Anomaly Detection**: ML-based pattern recognition
- **Alert Routing**: PagerDuty integration
- **Incident Tracking**: JIRA-based workflow

## Future Considerations

### Roadmap Priorities

#### Phase 1: Foundation (Months 1-3)

- Deploy core contracts on primary chains
- Establish bridge connections
- Implement monitoring systems
- Complete security audits

#### Phase 2: Expansion (Months 4-6)

- Additional chain integrations (Arbitrum, Polygon)
- Enhanced governance features
- Liquidity incentive programs
- Mobile wallet integration

#### Phase 3: Maturation (Months 7-12)

- Governance decentralization
- Advanced DeFi integrations
- Cross-chain DEX aggregation
- Institutional features

### Technical Enhancements

#### Planned Upgrades

- **ZK-Proof Integration**: Privacy-preserving transfers
- **Account Abstraction**: Gasless transactions
- **Batch Operations**: Multi-transfer optimization
- **Dynamic Fees**: Market-based pricing

#### Scalability Improvements

- Layer 2 optimization
- State channel integration
- Compression algorithms
- Parallel processing

### Governance Evolution

#### Decentralization Path

1. **Stage 1**: MPCVault MPC multisig (current)
2. **Stage 2**: Token holder voting rights
3. **Stage 3**: Full DAO governance
4. **Stage 4**: Autonomous protocol

#### Community Involvement

- Governance token distribution
- Proposal creation rights
- Parameter adjustment voting
- Treasury management

## References

### Technical Documentation

- [LayerZero V2 Documentation](https://docs.layerzero.network/v2)
- [LayerZero OFT V2 Standard](https://docs.layerzero.network/v2/developers/evm/oft/quickstart)
- [Celer Network Documentation](https://docs.celer.network)
- [Celer IM Integration Guide](https://docs.celer.network/developer/celer-im)
- [cBridge Technical Specification](https://docs.celer.network/developer/cbridge-sdk)
- [IBC Protocol Specification](https://github.com/cosmos/ibc)
- [OpenZeppelin Upgradeable Contracts](https://docs.openzeppelin.com/contracts/4.x/upgradeable)

### Security Resources

- [MPC Wallet Best Practices](https://www.fireblocks.com/blog/mpc-wallet-technology/)
- [Bridge Security Considerations](https://ethereum.org/en/developers/docs/bridges/)
- [Smart Contract Security Verification](https://consensys.github.io/smart-contract-best-practices/)

### Governance Frameworks

- [Compound Governance](https://compound.finance/docs/governance)
- [OpenZeppelin Governor](https://docs.openzeppelin.com/contracts/4.x/governance)
- [Snapshot Voting](https://docs.snapshot.org/)

### Monitoring Tools

- [Tenderly Monitoring](https://tenderly.co/monitoring)
- [Defender Sentinel](https://docs.openzeppelin.com/defender/sentinel)
- [Grafana Dashboards](https://grafana.com/docs/)
