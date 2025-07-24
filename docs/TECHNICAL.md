# LookCoin Technical Architecture

## Executive Summary

LookCoin (LOOK) is the native platform token of the LookCard ecosystem, designed as a native multi-protocol omnichain fungible token. The token implements a unified cross-chain architecture through the CrossChainRouter, supporting multiple bridge protocols: LayerZero's OFT V2 standard (BSC, Base, Optimism), Celer IM's cross-chain messaging (BSC, Optimism, Oasis Sapphire), and Hyperlane for cross-chain messaging. The architecture employs protocol abstraction through a modular design where each bridge protocol implements the ILookBridgeModule interface, enabling seamless protocol selection based on destination chain, cost optimization, speed requirements, or security preferences. The system maintains a unified global supply model with appropriate mechanics for each protocol (burn-and-mint for LayerZero and Hyperlane, lock-and-mint for Celer IM), ensuring consistent token supply across all deployments while providing redundancy, optimal routing, and enhanced cross-chain capabilities.

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
- **Multi-Protocol Support**: Native implementation of LayerZero OFT V2 and Hyperlane standards
- **Upgradeable Contracts**: UUPS proxy pattern for future enhancements
- **Access Control**: Role-based permissions with granular controls
- **Protocol Abstraction**: ILookBridgeModule interface for unified bridge operations

## Omnichain Architecture Overview

LookCoin implements a native multi-protocol architecture through the CrossChainRouter, enabling optimal protocol selection for each cross-chain transfer:

### Multi-Protocol Router Architecture

```mermaid
graph TB
    subgraph "User Interface"
        UI[User/dApp]
    end
    
    subgraph "Core Infrastructure"
        CCR[CrossChainRouter]
        FM[FeeManager]
        SM[SecurityManager]
        PR[ProtocolRegistry]
    end
    
    subgraph "Protocol Modules"
        LZ[LayerZeroModule]
        CM[CelerIMModule]
        HM[HyperlaneModule]
    end
    
    UI --> CCR
    CCR --> FM
    CCR --> SM
    CCR --> PR
    CCR --> LZ
    CCR --> CM
    CCR --> HM
```

### LayerZero Integration (Protocol ID: 0)

- **Supported Chains**: BSC, Base, Optimism
- **Mechanism**: Burn-and-mint for supply consistency
- **Security**: Decentralized Verifier Network (DVN) validation
- **Messaging**: Ultra Light Node (ULN) for cross-chain communication
- **Module**: LayerZeroModule implementing ILookBridgeModule

### Celer IM Integration (Protocol ID: 1)

- **Supported Chains**: BSC, Optimism, Oasis Sapphire
- **Mechanism**: Lock-and-mint through cBridge liquidity pools
- **Security**: State Guardian Network (SGN) validation
- **Messaging**: MessageBus for arbitrary cross-chain communication
- **Module**: CelerIMModule implementing ILookBridgeModule

### Hyperlane Integration (Protocol ID: 2)

- **Supported Chains**: BSC, Base, Optimism, Akashic (all self-hosted)
- **Mechanism**: Burn-and-mint with mailbox system
- **Security**: Modular security via Interchain Security Modules (ISM)
- **Messaging**: Self-hosted Hyperlane mailbox for message passing
- **Module**: HyperlaneModule implementing ILookBridgeModule

#### Self-Hosted Hyperlane Infrastructure

LookCard operates its own complete Hyperlane infrastructure across all supported chains:

- **Custom Mailboxes**: LookCard-deployed mailbox contracts on each chain
- **Self-Operated Relayers**: Dedicated relayer infrastructure for all routes
- **Custom Warp Routes**: Tailored warp route configuration for LOOK token
- **Controlled Validators**: LookCard-managed validator set for enhanced security
- **Custom ISM**: Optimized Interchain Security Module configuration
- **Self-Hosted Gas Paymasters**: Independent gas payment system

#### Current Status

- **Phase 1 (Current)**: Using public Hyperlane infrastructure as temporary solution
- **Phase 2 (Planned)**: Migration to fully self-hosted infrastructure
- **Benefits of Self-Hosting**:
  - Enhanced performance and reliability
  - Full control over security parameters
  - Optimized gas costs and fee structure
  - No dependency on third-party relayers
  - Custom features specific to LookCard ecosystem

```mermaid
graph TB
    subgraph "Multi-Protocol Omnichain Network"
        BSC[BSC<br/>LOOK Token<br/>Home Chain]
        BASE[Base<br/>LOOK Token]
        OPT[Optimism<br/>LOOK Token]
        SAPPHIRE[Oasis Sapphire<br/>LOOK Token]
        AKASHIC[Akashic<br/>LOOK Token]
    end

    subgraph "Protocol Usage"
        BSC <--> |LayerZero OFT V2| BASE
        BSC <--> |LayerZero OFT V2| OPT
        BASE <--> |LayerZero OFT V2| OPT
        
        BSC <-.-> |Celer IM| OPT
        BSC <-.-> |Celer IM| SAPPHIRE
        OPT <-.-> |Celer IM| SAPPHIRE
        
        BSC <--> |Hyperlane| BASE
        BSC <--> |Hyperlane| OPT
        BSC <--> |Hyperlane| AKASHIC
        BASE <--> |Hyperlane| AKASHIC
        OPT <--> |Hyperlane| AKASHIC
    end

    style BSC fill:#f9d71c
    style BASE fill:#0052cc
    style OPT fill:#ff0420
    style SAPPHIRE fill:#0ca789
    style AKASHIC fill:#7c3aed
```

## Dual-Path Architecture

LookCoin implements a unique dual-path architecture for LayerZero, providing maximum flexibility:

### Path 1: Direct OFT (LayerZero Only)
```mermaid
graph LR
    User --> |sendFrom| LookCoin
    LookCoin --> |native OFT| LayerZero_Endpoint
    LayerZero_Endpoint --> |message| Remote_Chain
```

**Characteristics:**
- Direct integration in LookCoin contract
- Most gas-efficient for LayerZero
- Uses `sendFrom()` function
- Bypasses router overhead
- Ideal for programmatic integrations

### Path 2: Module-Based (All Protocols)
```mermaid
graph LR
    User --> |bridgeToken| CrossChainRouter
    CrossChainRouter --> |protocol selection| Module{Module}
    Module --> |LayerZero| LayerZeroModule
    Module --> |Celer| CelerIMModule  
    Module --> |Hyperlane| HyperlaneModule
    LayerZeroModule --> Remote1[Remote Chain]
    CelerIMModule --> Remote2[Remote Chain]
    HyperlaneModule --> Remote3[Remote Chain]
```

**Characteristics:**
- Unified interface for all protocols
- Protocol abstraction layer
- Automatic route optimization
- Consistent error handling
- Future protocol extensibility

### Implementation Details

```solidity
// Path 1: Direct OFT call
lookCoin.sendFrom(
    from,
    dstChainId,
    toAddress,
    amount,
    refundAddress,
    zroPaymentAddress,
    adapterParams
);

// Path 2: Router call
crossChainRouter.bridgeToken(
    destinationChain,
    recipient,
    amount,
    protocol, // LayerZero, Celer, or Hyperlane
    params
);
```

## Chain Deployment Matrix

| Chain Name     | Supported Protocols                        | Network ID | Protocol IDs | Status  |
| -------------- | ------------------------------------------ | ---------- | ------------ | ------- |
| BSC            | LayerZero, Celer IM, Hyperlane           | 56         | 0, 1, 2      | Planned |
| Base           | LayerZero, Hyperlane                      | 8453       | 0, 2         | Planned |
| Optimism       | LayerZero, Celer IM, Hyperlane           | 10         | 0, 1, 2      | Planned |
| Oasis Sapphire | Celer IM                                  | 23295      | 1            | Planned |
| Akashic        | Hyperlane (self-hosted)                   | 9070       | 2            | Planned |

### Protocol Selection Matrix

| Source → Destination | Optimal Protocol | Alternative Protocols | Selection Criteria |
| -------------------- | ---------------- | --------------------- | ------------------ |
| BSC → Base          | LayerZero        | Hyperlane             | Direct support     |
| BSC → Optimism      | LayerZero        | Celer IM, Hyperlane   | Speed vs. cost     |
| Base → Optimism     | LayerZero        | Hyperlane             | Fast finality      |
| * → Sapphire        | Celer IM         | -                     | Only option        |
| * → Akashic         | Hyperlane        | -                     | Self-hosted only   |

## Cross-Chain Flow Diagrams

### Multi-Protocol Router Flow

```mermaid
sequenceDiagram
    participant User
    participant Router as CrossChainRouter
    participant FM as FeeManager
    participant SM as SecurityManager
    participant Module as Protocol Module
    participant Dest as Destination Chain

    User->>Router: bridgeToken(dest, amount, protocol)
    Router->>FM: estimateFee(protocol, dest, amount)
    FM-->>Router: Return fee estimate
    Router->>SM: validateTransfer(protocol, amount)
    SM-->>Router: Approve/Reject
    Router->>Module: bridgeToken(dest, recipient, amount)
    Module->>Module: Protocol-specific operations
    Module->>Dest: Cross-chain message
    Dest->>Dest: Mint/unlock tokens
    Dest->>User: Credit tokens
```

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


### Hyperlane Burn-and-Mint Flow

```mermaid
sequenceDiagram
    participant User
    participant Source as Source Chain<br/>HyperlaneModule
    participant Mailbox as Hyperlane<br/>Mailbox
    participant ISM as Interchain<br/>Security Module
    participant Dest as Destination Chain

    User->>Source: Initiate transfer
    Source->>Source: Burn LOOK tokens
    Source->>Mailbox: Dispatch message
    Mailbox->>Mailbox: Pay gas fees
    Mailbox->>ISM: Route message
    ISM->>ISM: Verify security
    ISM->>Dest: Deliver message
    Dest->>Dest: Mint LOOK tokens
    Dest->>User: Credit tokens

    Note over Source,Dest: Modular security verification
```

### Celer IM Burn-and-Mint Flow

```mermaid
sequenceDiagram
    participant User
    participant SourceChain as Source Chain<br/>(e.g., BSC)
    participant MessageBus as MessageBus
    participant SGN as State Guardian<br/>Network
    participant DestChain as Destination Chain<br/>(e.g., Optimism)

    User->>SourceChain: Initiate transfer
    SourceChain->>SourceChain: Burn LOOK tokens
    SourceChain->>MessageBus: Send cross-chain message
    MessageBus->>SGN: Request validation
    SGN->>SGN: Multi-signature validation
    SGN->>MessageBus: Approve transfer
    MessageBus->>DestChain: Deliver message
    DestChain->>DestChain: Mint LOOK tokens
    DestChain->>User: Credit tokens

    Note over SourceChain,DestChain: All protocols now use burn-and-mint for consistency
```

Note: Celer IM was updated to use burn-and-mint (instead of lock-and-mint) to maintain consistency across all protocols and eliminate token custody risks.

### Supply Reconciliation with Multi-Protocol Support

```mermaid
sequenceDiagram
    participant Oracle as Supply Oracle
    participant Router as CrossChainRouter
    participant Modules as Protocol Modules
    participant SM as SecurityManager
    participant Alert as Alert System

    loop Every 15 minutes
        Oracle->>Router: Query active protocols
        Router->>Modules: Get supply per protocol
        Modules-->>Oracle: Return protocol balances
        Oracle->>Oracle: Calculate global supply (LayerZero, Celer, Hyperlane)
        Oracle->>SM: Report metrics
        alt Supply anomaly detected
            SM->>SM: Check anomaly thresholds
            SM->>Router: Pause affected protocol
            SM->>Alert: Notify operators
        else Rate limit exceeded
            SM->>Modules: Enforce protocol limits
        end
    end
```

## Smart Contract Design

### Contract Architecture

#### Multi-Protocol Architecture

```solidity
// Core router pattern
contract CrossChainRouter {
    mapping(Protocol => ILookBridgeModule) public protocolModules;
    
    function bridgeToken(
        uint256 destinationChain,
        address recipient,
        uint256 amount,
        Protocol protocol,
        bytes calldata params
    ) external payable {
        ILookBridgeModule module = protocolModules[protocol];
        module.bridgeToken(destinationChain, recipient, amount, params);
    }
}

// Unified bridge interface
interface ILookBridgeModule {
    function bridgeToken(
        uint256 destinationChain,
        address recipient,
        uint256 amount,
        bytes calldata params
    ) external payable returns (bytes32 transferId);
    
    function estimateFee(
        uint256 destinationChain,
        uint256 amount,
        bytes calldata params
    ) external view returns (uint256 fee, uint256 estimatedTime);
}
```

#### Key Components

- **Token Core**: Multi-standard ERC-20 with LayerZero OFT V2 and Hyperlane support
- **CrossChainRouter**: Central hub for protocol selection and routing
- **Protocol Modules**: Modular bridge implementations (LayerZero, Celer, Hyperlane)
- **Infrastructure**: FeeManager, SecurityManager, ProtocolRegistry
- **Access Control**: Unified role-based permissions across all contracts

### Contract Modules

#### Core Token Module (LookCoin.sol)

- ERC-20 with multi-protocol extensions
- LayerZero OFT V2 native implementation
- Hyperlane message handling
- Unified mint/burn access control
- CrossChainRouter integration
#### CrossChainRouter Module

- Protocol selection logic
- Route optimization (cost, speed, security)
- Unified fee aggregation
- Security validation
- Emergency protocol control

#### Protocol Modules

**LayerZeroModule**:
- OFT V2 message handling
- DVN configuration
- Trusted remote management
- Gas optimization

**CelerIMModule**:
- MessageBus integration
- SGN validation
- Burn/mint mechanics (updated from lock/unlock)
- Fee parameter management (0.5%, min 10, max 1000 LOOK)

**HyperlaneModule**:
- Mailbox integration
- ISM configuration
- Gas payment handling
- Domain routing

#### Infrastructure Modules

**FeeManager**:
- Multi-protocol fee estimation
- Dynamic fee adjustment
- Fee collection and distribution
- Protocol-specific parameters

**SecurityManager**:
- Global rate limiting
- Per-protocol limits
- Anomaly detection
- Emergency response

**ProtocolRegistry**:
- Protocol registration
- Version management
- Chain support tracking
- Protocol metadata

## Security & Ownership Model

### MPC Vault Governance

- **Type**: External MPC vault wallet (off-chain governance)
- **Security**: Multi-party computation ensures no single point of failure
- **Operations**: Direct execution of administrative functions
- **Key Management**: Secure key distribution managed by MPC vault provider
- **Access Control**: All contract admin roles assigned to vault address

### Multi-Protocol Security Architecture

#### Protocol-Specific Security Models

**LayerZero Security**:
```yaml
DVN Configuration:
  - Required DVNs: 2
  - Optional DVNs: 1
  - Verification Threshold: 66%
  - Timeout Period: 600 seconds
  - Executor: Decentralized execution network
```

**Celer IM Security**:
- **Validator Set**: SGN validators with staked CELR tokens
- **Trust Model**: Non-custodial liquidity pool management
- **Validation Process**: Multi-signature validation by SGN
- **Slashing Conditions**: Penalties for malicious behavior or downtime
- **Liquidity Security**: Real-time pool monitoring


**Hyperlane Security**:
- **ISM Types**: Multisig, Aggregation, Routing ISMs
- **Validator Sets**: Configurable per destination
- **Proof Verification**: Merkle tree validation
- **Gas Payment**: Required prepayment via IGP

#### Unified Security Layer

**SecurityManager Features**:
- Cross-protocol anomaly detection
- Global daily transfer limits
- Per-protocol rate limiting
- Automated circuit breakers
- Real-time monitoring integration

### Security Layers

1. **Smart Contract Level**: Audited code with formal verification
2. **Bridge Level**: DVN/Validator consensus requirements
3. **Operational Level**: MPC multisig for admin functions
4. **Monitoring Level**: Real-time anomaly detection

### Access Control & Role Assignment

#### Role Overview

The LookCoin ecosystem implements granular role-based access control using OpenZeppelin's AccessControl pattern. All contracts share a unified role hierarchy with the MPC vault serving as the governance authority.

| Contract                   | Role Constant        | Gated Functions                               | Capabilities                    | Default Assignee | Revocability |
| -------------------------- | -------------------- | --------------------------------------------- | ------------------------------- | ---------------- | ------------ |
| **LookCoin.sol**           |                      |                                               |                                 |                  |              |
|                            | `DEFAULT_ADMIN_ROLE` | `grantRole()`, `revokeRole()`                 | Grant/revoke all roles          | MPC Vault        | No           |
|                            | `MINTER_ROLE`        | `mint()`                                      | Mint new tokens                 | Protocol Modules | Yes          |
|                            | `BURNER_ROLE`        | `burn()`, `burnFrom()`                        | Burn tokens                     | Protocol Modules | Yes          |
|                            | `PAUSER_ROLE`        | `pause()`, `unpause()`                        | Pause/unpause transfers         | MPC Vault        | Yes          |
|                            | `UPGRADER_ROLE`      | `upgradeToAndCall()`                          | Upgrade contract implementation | MPC Vault        | Yes          |
|                            | `BRIDGE_ROLE`        | `setAuthorizedBridge()`, `setCrossChainRouter()` | Configure bridge access     | MPC Vault        | Yes          |
| **CrossChainRouter.sol**   |                      |                                               |                                 |                  |              |
|                            | `DEFAULT_ADMIN_ROLE` | `grantRole()`, `revokeRole()`                 | Grant/revoke all roles          | MPC Vault        | No           |
|                            | `OPERATOR_ROLE`      | `registerProtocol()`, `setChainProtocolSupport()` | Manage protocols          | MPC Vault        | Yes          |
|                            | `EMERGENCY_ROLE`     | `pauseProtocol()`, `unpauseProtocol()`        | Emergency protocol control      | MPC Vault        | Yes          |
| **LayerZeroModule.sol**    |                      |                                               |                                 |                  |              |
|                            | `DEFAULT_ADMIN_ROLE` | `grantRole()`, `revokeRole()`                 | Grant/revoke all roles          | MPC Vault        | No           |
|                            | `OPERATOR_ROLE`      | `setTrustedRemote()`, `setMinDstGas()`        | Configure LayerZero            | MPC Vault        | Yes          |
| **CelerIMModule.sol**      |                      |                                               |                                 |                  |              |
|                            | `DEFAULT_ADMIN_ROLE` | `grantRole()`, `revokeRole()`                 | Grant/revoke all roles          | MPC Vault        | No           |
|                            | `OPERATOR_ROLE`      | `setRemoteModule()`, `setFeeParameters()`     | Configure Celer IM             | MPC Vault        | Yes          |
| **HyperlaneModule.sol**    |                      |                                               |                                 |                  |              |
|                            | `DEFAULT_ADMIN_ROLE` | `grantRole()`, `revokeRole()`                 | Grant/revoke all roles          | MPC Vault        | No           |
|                            | `OPERATOR_ROLE`      | `setTrustedSender()`, `setGasConfig()`        | Configure Hyperlane            | MPC Vault        | Yes          |
| **SecurityManager.sol**    |                      |                                               |                                 |                  |              |
|                            | `DEFAULT_ADMIN_ROLE` | `grantRole()`, `revokeRole()`                 | Grant/revoke all roles          | MPC Vault        | No           |
|                            | `OPERATOR_ROLE`      | `setProtocolLimits()`, `setAnomalyThresholds()` | Configure security           | MPC Vault        | Yes          |
|                            | `EMERGENCY_ROLE`     | `emergencyPause()`, `forceReconcile()`        | Emergency response              | MPC Vault        | Yes          |

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

The multi-protocol system implements carefully orchestrated role dependencies:

1. **Protocol Module Permissions**: All protocol modules (LayerZero, Celer, Hyperlane) require appropriate roles on the LookCoin contract:
   - LayerZero & Hyperlane modules: `MINTER_ROLE` and `BURNER_ROLE` for burn-and-mint
   - CelerIMModule: `MINTER_ROLE` for lock-and-mint

2. **Router Integration**: The CrossChainRouter requires registration in LookCoin via `setCrossChainRouter()` to enable protocol routing.

3. **Security Integration**: Protocol modules must be registered with SecurityManager for rate limiting and anomaly detection.

4. **Fee Management**: FeeManager requires protocol module addresses for accurate fee estimation across protocols.

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
  - Assigns roles to protocol modules based on their requirements:
    - LayerZero/Hyperlane: `MINTER_ROLE` and `BURNER_ROLE`
    - CelerIM: `MINTER_ROLE`
  - Registers CrossChainRouter with LookCoin
  - Configures local protocol parameters
  - Sets up infrastructure contracts (FeeManager, SecurityManager)

**Stage 3: Configure (Cross-Chain Configuration)**

- **Script**: `scripts/configure.ts`
- **Purpose**: Establishes cross-chain connections across all protocols
- **Operations**:
  - Registers all protocol modules with CrossChainRouter
  - Sets chain-protocol support mappings
  - Configures cross-chain trusted endpoints:
    - LayerZero trusted remotes
    - Celer remote modules
    - Hyperlane trusted senders
  - Updates ProtocolRegistry with supported chains per protocol
  - Configures FeeManager with protocol modules

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
2. Call CelerIMModule.pause() with ADMIN_ROLE
3. Call SecurityManager.pauseProtocol() for specific protocols
4. Oracle detects pause and halts monitoring
```

**Multi-Protocol Transfer Flow**:

```solidity
// User bridges from BSC to Optimism (protocol selection)
1. User calls CrossChainRouter.bridgeToken()
2. Router selects optimal protocol (LayerZero vs Celer)
3. Router calls selected module.bridgeToken()
4. Module executes protocol-specific operations
5. Destination receives and processes message
6. SecurityManager validates and tracks transfer
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
// Multi-protocol supply reconciliation
async function reconcileSupply() {
  const protocolSupplies = {};
  
  // Get supply per protocol (excluding disabled protocols)
  for (const protocol of ['LayerZero', 'Celer', 'Hyperlane']) {
    protocolSupplies[protocol] = await getProtocolSupply(protocol);
  }
  
  const totalSupply = Object.values(protocolSupplies).reduce((a, b) => a + b, 0);
  
  // Check for anomalies
  if (totalSupply !== EXPECTED_TOTAL_SUPPLY) {
    const affectedProtocol = identifyAnomalousProtocol(protocolSupplies);
    await securityManager.pauseProtocol(affectedProtocol);
    await alertOperators(affectedProtocol);
  }
}
```

### Incident Response Framework

#### Response Levels

1. **Level 1**: Automated response (pause bridges)
2. **Level 2**: Operator intervention required
3. **Level 3**: MPC vault action needed
4. **Level 4**: Community notification and action

#### Protocol Failure Scenarios

- **Single Protocol Failure**: Isolate and pause affected protocol only
- **Communication Failure**: Automatic failover to alternative protocol
- **Validation Failure**: Protocol-specific investigation
- **Supply Mismatch**: Per-protocol supply tracking enables targeted response
- **Contract Compromise**: Emergency pause via SecurityManager

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

1. **Stage 1**: MPC vault wallet (current)
2. **Stage 2**: Token holder voting rights
3. **Stage 3**: Full DAO governance
4. **Stage 4**: Autonomous protocol

#### Community Involvement

- Governance token distribution
- Proposal creation rights
- Parameter adjustment voting
- Treasury management

## Protocol Implementation Details

### Delegation Pattern Architecture

The LookCoin system implements a sophisticated delegation pattern that separates core token functionality from protocol-specific logic. This architecture was chosen over traditional inheritance to maintain upgrade safety and provide flexibility for future protocol additions.

#### Why Delegation Instead of Inheritance?

1. **Storage Layout Safety**: Adding new parent contracts post-deployment would break the storage layout for UUPS upgradeable contracts
2. **Modular Updates**: Protocol modules can be upgraded independently without touching the core token
3. **Security Isolation**: Each protocol runs in its own security context with specific access controls
4. **Flexible Integration**: New protocols can be added without modifying existing code

#### Architecture Overview

```
LookCoin Contract (Core Token)
├── Direct Integrations (for backward compatibility)
│   ├── LayerZero OFT V2 (ILayerZeroReceiver)
│   └── Hyperlane (IMessageRecipient)
│
└── Delegated Operations (via CrossChainRouter)
    ├── LayerZeroModule (enhanced LayerZero features)
    ├── CelerIMModule (Celer IM protocol)
    └── HyperlaneModule (enhanced Hyperlane features)
```

### Direct Protocol Integrations

These protocols are integrated directly into the LookCoin contract for backward compatibility and gas efficiency:

#### LayerZero OFT V2
- **Interface**: `ILayerZeroReceiver`
- **Functions**: `lzReceive()`, `bridgeToken()`
- **Storage**: `trustedRemoteLookup`, `processedNonces`
- **Purpose**: Maintains compatibility with existing LayerZero deployments

#### Hyperlane
- **Interface**: `IMessageRecipient`
- **Functions**: `handle()`, `bridgeTokenHyperlane()`
- **Storage**: `hyperlaneMailbox`, `supportedHyperlaneDomains`
- **Purpose**: Direct message receipt from Hyperlane mailbox

### Modular Protocol Implementations

These protocols are implemented as separate contracts that interact with LookCoin through defined interfaces:

#### CelerIMModule
```solidity
contract CelerIMModule is ILookBridgeModule, IMessageReceiverApp {
    // Completely separate contract
    // Holds MINTER_ROLE on LookCoin
    // Implements Celer's IMessageReceiverApp
    // Manages its own remote module registry
}
```

**Key Features**:
- Lock-and-mint mechanism for cross-chain transfers
- SGN (State Guardian Network) validation
- Independent fee calculation
- Separate upgrade path from core token

#### HyperlaneModule
```solidity
contract HyperlaneModule is ILookBridgeModule {
    // Enhanced Hyperlane functionality
    // Complements direct Hyperlane integration
    // Manages gas payment and routing
}
```

**Key Features**:
- Advanced gas payment strategies
- Multi-domain routing
- ISM (Interchain Security Module) configuration
- Transfer tracking and monitoring

### Protocol Selection Flow

1. **User Initiates Transfer**
   ```solidity
   lookCoin.bridgeToken(chainId, recipient, amount)
   ```

2. **LookCoin Delegates to Router**
   ```solidity
   crossChainRouter.bridgeToken{value: msg.value}(
       chainId, recipient, amount, protocol, params
   )
   ```

3. **Router Selects Protocol Module**
   ```solidity
   ILookBridgeModule module = protocolModules[protocol];
   module.bridgeToken(chainId, recipient, amount, params);
   ```

4. **Module Executes Protocol-Specific Logic**
   - LayerZero: Burns tokens and sends OFT message
   - Celer: Locks tokens and sends IM message
   - Hyperlane: Burns tokens and dispatches via mailbox

### Access Control Integration

Each protocol module requires specific roles on the LookCoin contract:

| Module | Required Roles | Purpose |
|--------|---------------|---------|
| LayerZeroModule | MINTER_ROLE, BURNER_ROLE | Burn on send, mint on receive |
| CelerIMModule | MINTER_ROLE | Mint on receive (tokens locked on source) |
| HyperlaneModule | MINTER_ROLE, BURNER_ROLE | Burn on send, mint on receive |

### Benefits of the Delegation Pattern

1. **Upgrade Safety**: Core token storage layout never changes
2. **Protocol Isolation**: Issues in one protocol don't affect others
3. **Gas Optimization**: Direct calls for simple operations, delegation for complex ones
4. **Future Flexibility**: New protocols can be added without modifying existing code
5. **Granular Control**: Each protocol can be paused/upgraded independently

### Migration Path for New Protocols

Adding a new cross-chain protocol follows this pattern:

1. **Create Protocol Module**
   ```solidity
   contract NewProtocolModule is ILookBridgeModule {
       // Implement protocol-specific logic
   }
   ```

2. **Deploy and Configure**
   ```typescript
   const module = await deployNewProtocolModule();
   await lookCoin.grantRole(MINTER_ROLE, module.address);
   ```

3. **Register with Router**
   ```solidity
   await crossChainRouter.registerProtocol(
       Protocol.NewProtocol,
       module.address
   );
   ```

4. **Update Infrastructure**
   - Add to ProtocolRegistry
   - Configure in FeeManager
   - Update SecurityManager limits

This architecture ensures that LookCoin can evolve with the cross-chain ecosystem while maintaining security, efficiency, and backward compatibility.

## References

### Technical Documentation

- [LayerZero V2 Documentation](https://docs.layerzero.network/v2)
- [LayerZero OFT V2 Standard](https://docs.layerzero.network/v2/developers/evm/oft/quickstart)
- [Celer Network Documentation](https://docs.celer.network)
- [Celer IM Integration Guide](https://docs.celer.network/developer/celer-im)
- [Hyperlane Documentation](https://docs.hyperlane.xyz)
- [Hyperlane Message Format](https://docs.hyperlane.xyz/docs/reference/messaging/message-format)
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
