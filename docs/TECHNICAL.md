# LookCoin Technical Architecture

## Executive Summary

LookCoin (LOOK) is the native platform token of the LookCard ecosystem, designed as a native multi-protocol omnichain fungible token. The token implements a unified cross-chain architecture through the CrossChainRouter, supporting multiple bridge protocols: LayerZero's OFT V2 standard (BSC, Base, Optimism), Celer IM's cross-chain messaging (BSC, Optimism, Oasis Sapphire), and Hyperlane for cross-chain messaging. The architecture employs protocol abstraction through a modular design where each bridge protocol implements the ILookBridgeModule interface, enabling seamless protocol selection based on destination chain, cost optimization, speed requirements, or security preferences. The system maintains a unified global supply model with appropriate mechanics for each protocol (burn-and-mint for LayerZero and Hyperlane, lock-and-mint for Celer IM), ensuring consistent token supply across all deployments while providing redundancy, optimal routing, and enhanced cross-chain capabilities.

## Token Specification

### Basic Properties
- **Name**: LookCoin
- **Symbol**: LOOK
- **Decimals**: 18
- **Total Supply**: Dynamic (tracked via totalMinted and totalBurned)
- **Circulating Supply**: totalMinted - totalBurned
- **Token Standard**: ERC20 with native cross-chain support
- **Deployment Status**: ✅ Live on BSC Mainnet and BSC Testnet

### Technical Standards
- **Base**: OpenZeppelin ERC20Upgradeable v5.1.0
- **Extensions**: ERC20PermitUpgradeable (EIP-2612 gasless approvals)
- **Proxy Pattern**: UUPS (Universal Upgradeable Proxy Standard)
- **Cross-chain**: Native LayerZero OFT V2 integration + modular bridge architecture
- **Security**: Pausable, ReentrancyGuard, AccessControl with granular roles
- **Solidity Version**: 0.8.28 with optimizer (9999 runs)

## Cross-Chain Architecture

### Native OFT V2 Integration
LookCoin implements LayerZero OFT V2 natively within the token contract:
- **sendFrom()**: Full OFT V2 send functionality with adapter params
- **bridgeToken()**: Simplified bridge interface for user convenience
- **lzReceive()**: Direct endpoint integration for receiving transfers
- **Trusted Remotes**: Per-chain peer contract configuration
- **Gas Management**: Configurable gas limits per destination chain

### Bridge Protocols

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

#### 1. LayerZero OFT V2 (Native)
- **Mechanism**: Burn-and-mint
- **Networks**: All supported chains
- **Security**: DVN (Decentralized Verifier Network) support
- **Features**: 
  - Native integration in LookCoin contract
  - Enforced options for minimum gas
  - Nonce-based replay protection
  - Trusted remote verification

#### 2. Celer IM (Inter-chain Messaging)
- **Mechanism**: Burn-and-mint
- **Networks**: BSC ⟷ Optimism, Sapphire
- **Security**: SGN (State Guardian Network) validators
- **Features**: 
  - Message-based transfers with executor pattern
  - Configurable chain support (no hardcoded chain IDs)
  - Remote module registration
  - Fee refund mechanism

#### 3. Hyperlane
- **Mechanism**: Burn-and-mint
- **Networks**: Configurable via domain mappings
- **Security**: Modular ISM (Interchain Security Modules)
- **Features**: 
  - Domain-based routing (no hardcoded chain IDs)
  - Configurable domain-to-chain mappings
  - Gas oracle integration
  - Message-based architecture

### Multi-Protocol Router Architecture

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

### Deployment Architecture

```
Multi-Chain Deployment
├── Core Contracts (All Chains)
│   ├── LookCoin.sol (UUPS upgradeable with native OFT V2)
│   └── SupplyOracle.sol (Cross-chain supply monitoring)
│
├── Protocol Modules (Chain-specific)
│   ├── CelerIMModule.sol (Chains with Celer support)
│   └── HyperlaneModule.sol (Chains with Hyperlane support)
│
├── Infrastructure (Multi-protocol chains only)
│   ├── CrossChainRouter.sol (Protocol selection & routing)
│   ├── FeeManager.sol (Unified fee management)
│   ├── SecurityManager.sol (Rate limiting & security)
│   └── ProtocolRegistry.sol (Module registration)
│
└── External Integrations
    ├── LayerZero Endpoint (Native in LookCoin)
    ├── Celer MessageBus (Via CelerIMModule)
    └── Hyperlane Mailbox (Via HyperlaneModule)
```

## Multi-Protocol Bridge Flow

1. **User Initiates Transfer**
   - Direct: Call `sendFrom()` for LayerZero OFT transfers
   - Simplified: Call `bridgeToken()` for automatic routing
   - Router: CrossChainRouter selects optimal protocol (if deployed)

2. **Protocol Selection (CrossChainRouter)**
   - Check protocol availability and configuration
   - Validate destination chain support
   - Route to appropriate bridge module

3. **Token Burning**
   - All protocols use burn-and-mint mechanism
   - Tokens burned on source chain
   - `totalBurned` counter updated
   - Events emitted for tracking

4. **Cross-Chain Message**
   - **LayerZero**: Direct endpoint.send() with OFT payload
   - **Celer**: MessageBus.sendMessage() with executor
   - **Hyperlane**: Mailbox.dispatch() with recipient

5. **Token Minting**
   - Destination validates message origin
   - Trusted source verification (remotes/modules)
   - Mints tokens to recipient
   - `totalMinted` counter updated
   - Supply oracle synchronization

## Chain Deployment Matrix

| Chain Name     | Supported Protocols                        | Network ID | Protocol IDs | Status        |
| -------------- | ------------------------------------------ | ---------- | ------------ | ------------- |
| BSC            | LayerZero, Celer IM, Hyperlane           | 56         | 0, 1, 2      | ✅ Deployed   |
| Base           | LayerZero, Hyperlane                      | 8453       | 0, 2         | Planned       |
| Optimism       | LayerZero, Celer IM, Hyperlane           | 10         | 0, 1, 2      | Planned       |
| Oasis Sapphire | Celer IM                                  | 23295      | 1            | Planned       |
| Akashic        | Hyperlane (self-hosted)                   | 9070       | 2            | Planned       |

## Supported Networks

The following table provides a comprehensive overview of all supported networks and their protocol compatibility. RPC endpoints are configured in `hardhat.config.ts`.

| Network                    | Chain ID | Network Key         | LayerZero | Celer IM | Hyperlane | Deployment Status | RPC Configuration     |
| -------------------------- | -------- | ------------------- | --------- | -------- | --------- | ----------------- | --------------------- |
| **BSC Mainnet**            | 56       | bsc                 | ✓         | ✓        | ✓         | ✅ Deployed       | See `hardhat.config.ts` line 12 |
| **BSC Testnet**            | 97       | bscTestnet          | ✓         | ✓        | ✓         | ✅ Deployed       | See `hardhat.config.ts` line 13 |
| **Base Mainnet**           | 8453     | base                | ✓         | ✗        | ✓         | ⏳ Pending        | See `hardhat.config.ts` line 14 |
| **Base Sepolia**           | 84532    | baseSepolia         | ✓         | ✗        | ✓         | ⏳ Pending        | See `hardhat.config.ts` line 15 |
| **Optimism Mainnet**       | 10       | optimism            | ✓         | ✓        | ✓         | ⏳ Pending        | See `hardhat.config.ts` line 16 |
| **Optimism Sepolia**       | 11155420 | opSepolia           | ✓         | ✓        | ✓         | ⏳ Pending        | See `hardhat.config.ts` line 17 |
| **Oasis Sapphire Mainnet** | 23294    | sapphire            | ✗         | ✓        | ✗         | ⏳ Pending        | See `hardhat.config.ts` line 18 |
| **Oasis Sapphire Testnet** | 23295    | sapphireTestnet     | ✗         | ✓        | ✗         | ⏳ Pending        | See `hardhat.config.ts` line 19 |
| **Akashic Mainnet**        | 9070     | akashic             | ✗         | ✗        | ✓*        | ⏳ Pending        | See `hardhat.config.ts` line 20 |
| **Akashic Testnet**        | 9071     | akashicTestnet      | ✗         | ✗        | ✓*        | ⏳ Pending        | See `hardhat.config.ts` line 21 |

**Notes:**
- ✓ = Supported
- ✗ = Not Supported
- ✓* = Supported via self-hosted Hyperlane infrastructure
- Network keys are used in deployment scripts and configuration
- All RPC endpoints can be overridden via environment variables (e.g., `BSC_RPC_URL`, `BASE_RPC_URL`)

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

## Deployment Process

### Prerequisites
- Node.js 20+ with npm
- Hardhat development environment
- Environment variables:
  - `GOVERNANCE_VAULT`: MPC vault wallet address
  - Private keys for deployment accounts
  - RPC endpoints for target networks (see hardhat.config.ts)
  - Block explorer API keys for verification

### Three-Stage Deployment Process

#### Stage 1: Deploy
Creates contracts and deployment artifacts on a single network:

```bash
# Deploy to specific networks
npm run deploy:bsc-testnet
npm run deploy:bsc-mainnet
npm run deploy:base-sepolia
npm run deploy:base-mainnet
npm run deploy:op-sepolia
npm run deploy:op-mainnet
```

#### Stage 2: Setup
Configures local roles and settings post-deployment:

```bash
# Setup contracts on deployed network
npm run setup:bsc-testnet
npm run setup:base-sepolia
npm run setup:op-sepolia
npm run setup:sapphire-mainnet
```

Setup includes:
- Granting operational roles (MINTER, BURNER, BRIDGE)
- Registering bridge modules with CrossChainRouter
- Setting initial protocol fees
- Configuring rate limits

#### Stage 3: Configure
Establishes cross-chain connections between networks:

```bash
# Configure cross-chain connections
npm run configure:bsc-testnet
npm run configure:base-sepolia
npm run configure:optimism-sepolia
npm run configure:sapphire-mainnet
```

Configuration includes:
- Setting LayerZero trusted remotes
- Configuring Celer IM remote modules
- Setting Hyperlane domain mappings
- Registering cross-chain bridges

**Important**: Configure scripts require deployment artifacts from other networks

### Role-Based Access Control

- **DEFAULT_ADMIN_ROLE**: Full administrative control
- **MINTER_ROLE**: Can mint new tokens
- **BURNER_ROLE**: Can burn tokens (includes self-burn permission)
- **PAUSER_ROLE**: Can pause/unpause all operations
- **UPGRADER_ROLE**: Can authorize contract upgrades
- **BRIDGE_ROLE**: Can mint/burn for bridge operations
- **PROTOCOL_ADMIN_ROLE**: Can configure protocol settings (trusted remotes, gas limits)
- **ROUTER_ADMIN_ROLE**: Can set CrossChainRouter contract

## Security Considerations

### Rate Limiting (via SecurityManager)
- Per-transaction limit: 500,000 LOOK
- Per-account hourly limit: 1,500,000 LOOK (3 transactions)
- Global daily limit: 20% of total supply
- Sliding window algorithm for accurate tracking
- Emergency bypass for authorized operations

### Supply Monitoring
- Real-time tracking via totalMinted and totalBurned
- Cross-chain supply reconciliation every 15 minutes
- Automatic pause on 1% deviation detection
- Manual reconciliation tools for administrators
- Oracle-based reporting across all chains
- Circulating supply: totalMinted - totalBurned

### Emergency Procedures
1. **Pause All Operations**
   - PAUSER_ROLE holders can pause immediately
   - Affects all token transfers and bridge operations
   - Emits EmergencyPause event
   - Requires PAUSER_ROLE to unpause

2. **Bridge-Specific Pause**
   - Disable specific bridge module
   - Other protocols continue operating
   - Isolated incident response

3. **Supply Reconciliation**
   - Force manual reconciliation
   - Identify and isolate anomalies
   - Restore normal operations

### Governance Model
- **Type**: MPC Vault Wallet (Off-chain Multi-Party Computation)
- **Address**: Configured via GOVERNANCE_VAULT environment variable
- **Execution**: Direct on-chain execution without timelock
- **Scope**: All administrative functions via role-based permissions
- **Security**: No single point of failure, distributed key management

### Smart Contract Architecture

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

## Access Control & Role Management

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

## Contract Upgrade Process

### UUPS Upgrade Pattern

1. **Deploy New Implementation**: Create new version of contract logic
2. **Authorize Upgrade**: MPC vault calls `_authorizeUpgrade()` with UPGRADER_ROLE
3. **Execute Upgrade**: Call `upgradeToAndCall()` to switch implementation
4. **Verify**: Test all functionality post-upgrade

### Cross-Chain Coordination

- Coordinated upgrade windows across all chains
- Version compatibility maintained via deployment artifacts
- Rollback procedures documented per chain
- Storage layout compatibility enforced

## Monitoring & Incident Response

### Supply Monitoring System

- **Real-Time Tracking**: totalMinted and totalBurned counters
- **Cross-Chain Oracle**: 15-minute reconciliation cycles
- **Anomaly Detection**: 1% deviation triggers automatic pause
- **Manual Controls**: Force reconciliation available to admins

### Incident Response Levels

1. **Automated Response**: SecurityManager pauses affected protocol
2. **Operator Intervention**: Manual investigation and resolution
3. **MPC Vault Action**: Critical decisions requiring governance
4. **Public Communication**: Transparency for major incidents

### Protocol Failure Handling

- **Isolated Failures**: Pause single protocol, others continue
- **Supply Anomalies**: Automatic detection and response
- **Bridge Compromise**: Emergency pause with fund recovery
- **Network Issues**: Fallback to alternative protocols

## Technical Documentation References

### Protocol Documentation
- [LayerZero V2 OFT Standard](https://docs.layerzero.network/v2/developers/evm/oft/quickstart)
- [Celer IM Integration Guide](https://docs.celer.network/developer/celer-im)
- [Hyperlane Message Format](https://docs.hyperlane.xyz/docs/reference/messaging/message-format)
- [OpenZeppelin UUPS Pattern](https://docs.openzeppelin.com/contracts/4.x/api/proxy#UUPSUpgradeable)

### Security Resources
- [MPC Wallet Best Practices](https://www.fireblocks.com/blog/mpc-wallet-technology/)
- [Bridge Security Considerations](https://ethereum.org/en/developers/docs/bridges/)
- [Smart Contract Security Verification](https://consensys.github.io/smart-contract-best-practices/)


