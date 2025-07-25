# Design Document

## Overview

This design consolidates the LookCoin deployment system into a unified three-phase approach that eliminates confusion between multiple deployment scripts while maintaining clear separation of concerns. The system will replace the current dual-script approach (`deploy.ts`/`deploy-multi-protocol.ts` and `configure.ts`/`configure-multi-protocol.ts`) with a single, intelligent script for each phase that automatically detects and handles both standard and multi-protocol deployments.

## Architecture

### Three-Phase Deployment Architecture

The deployment system follows a strict three-phase architecture:

```
Phase 1: Deploy
├── Contract deployment/upgrade
├── Proxy creation and initialization
├── Implementation deployment
└── Artifact generation

Phase 2: Setup
├── Role assignment (local)
├── Local contract configuration
├── Bridge registration (local)
└── Rate limit configuration

Phase 3: Configure
├── Cross-chain trusted remotes
├── Bridge module connections
├── Cross-chain parameter setup
└── Multi-network coordination
```

### Script Consolidation Strategy

Instead of maintaining separate scripts for different deployment modes, the system uses a single intelligent script per phase that:

1. **Auto-detects deployment mode** based on network configuration
2. **Dynamically loads protocol modules** based on network support
3. **Handles both standard and multi-protocol scenarios** seamlessly
4. **Maintains backward compatibility** with existing deployments

### Network-Centric Design

Each script operates on a single network at a time:

- **Deploy**: Deploys contracts to the target network only
- **Setup**: Configures local settings on the target network only
- **Configure**: Sets up cross-chain connections FROM the target network to other networks

## Components and Interfaces

### 1. Unified Deployment Script (`scripts/deploy.ts`)

**Purpose**: Single script that handles all deployment scenarios

**Key Features**:

- Merges functionality from `deploy.ts` and `deploy-multi-protocol.ts`
- Auto-detects protocol support from network configuration
- Deploys appropriate contracts based on `chainConfig.protocols`
- Maintains existing safety features (rollback, retry, gas estimation)

**Interface**:

```typescript
interface DeploymentConfig {
  networkName: string;
  chainId: number;
  protocols: ProtocolSupport;
  governanceVault: string;
}

interface ProtocolSupport {
  layerZero?: boolean;
  celer?: boolean;
  ibc?: boolean;
  xerc20?: boolean;
  hyperlane?: boolean;
}
```

### 2. Unified Setup Script (`scripts/setup.ts`)

**Purpose**: Handles local contract configuration for a single network

**Key Features**:

- Configures roles and permissions
- Sets up local bridge registrations
- Configures rate limits and security parameters
- Operates only on the current network

**Interface**:

```typescript
interface SetupConfig {
  deployment: Deployment;
  chainConfig: ChainConfig;
  localOnly: true; // Enforces single-network operation
}
```

### 3. Unified Configuration Script (`scripts/configure.ts`)

**Purpose**: Handles cross-chain parameter setup for a single network

**Key Features**:

- Merges functionality from `configure.ts` and `configure-multi-protocol.ts`
- Loads deployment artifacts from other networks
- Configures cross-chain connections FROM current network
- Handles tier validation and safety checks

**Interface**:

```typescript
interface CrossChainConfig {
  currentNetwork: string;
  otherNetworks: Map<number, Deployment>;
  tierValidation: TierValidationConfig;
  protocolConfigs: ProtocolConfigMap;
}
```

### 4. Enhanced Deployment Utilities

**Protocol Detection Service**:

```typescript
class ProtocolDetector {
  detectSupportedProtocols(chainConfig: ChainConfig): ProtocolSupport;
  shouldDeployProtocol(protocol: string, chainConfig: ChainConfig): boolean;
  getProtocolConfig(protocol: string, chainConfig: ChainConfig): ProtocolConfig;
}
```

**Deployment Orchestrator**:

```typescript
class DeploymentOrchestrator {
  async deployCore(config: DeploymentConfig): Promise<CoreContracts>;
  async deployProtocols(config: DeploymentConfig): Promise<ProtocolContracts>;
  async deployInfrastructure(config: DeploymentConfig): Promise<InfraContracts>;
}
```

## Data Models

### Enhanced Deployment Artifact

```typescript
interface Deployment {
  network: string;
  chainId: number;
  timestamp: string;
  deployer: string;

  // Core contracts (always deployed)
  contracts: {
    LookCoin: ContractInfo;
    SupplyOracle: ContractInfo;
  };

  // Protocol-specific contracts (conditionally deployed)
  protocolContracts?: {
    LayerZeroModule?: ContractInfo;
    CelerIMModule?: ContractInfo;
    IBCModule?: ContractInfo;
    XERC20Module?: ContractInfo;
    HyperlaneModule?: ContractInfo;
  };

  // Infrastructure contracts (multi-protocol mode)
  infrastructureContracts?: {
    CrossChainRouter?: ContractInfo;
    FeeManager?: ContractInfo;
    SecurityManager?: ContractInfo;
    ProtocolRegistry?: ContractInfo;
  };

  // Deployment metadata
  deploymentMode: "standard" | "multi-protocol";
  protocolsDeployed: string[];
  config: ChainConfig;
  implementationHashes: Record<string, string>;
}
```

### Protocol Configuration Map

```typescript
interface ProtocolConfigMap {
  layerZero?: LayerZeroConfig;
  celer?: CelerConfig;
  ibc?: IBCConfig;
  xerc20?: XERC20Config;
  hyperlane?: HyperlaneConfig;
}

interface LayerZeroConfig {
  endpoint: string;
  lzChainId: number;
  requiredDVNs: string[];
  optionalDVNs: string[];
  confirmations: number;
}
```

## Error Handling

### Deployment Error Recovery

1. **Rollback State Management**: Enhanced state tracking for partial deployments
2. **Resume Capability**: Ability to resume from last successful step
3. **Validation Checkpoints**: Pre-deployment validation to catch issues early
4. **Network-Specific Error Handling**: Custom error handling per network type

### Cross-Tier Safety

1. **Tier Detection**: Automatic detection of mainnet/testnet/dev tiers
2. **Cross-Tier Warnings**: Clear warnings when connecting across tiers
3. **Safety Overrides**: Explicit flags required for cross-tier operations
4. **Audit Trail**: Complete logging of cross-tier decisions

## Testing Strategy

### Unit Testing

1. **Protocol Detection Tests**: Verify correct protocol detection logic
2. **Deployment Mode Tests**: Test standard vs multi-protocol mode selection
3. **Configuration Merging Tests**: Verify proper config consolidation
4. **Error Handling Tests**: Test rollback and resume functionality

### Integration Testing

1. **End-to-End Deployment Tests**: Full deployment cycle on testnets
2. **Cross-Chain Configuration Tests**: Multi-network setup validation
3. **Backward Compatibility Tests**: Legacy deployment artifact handling
4. **Network-Specific Tests**: Protocol-specific deployment scenarios

### Network Testing Matrix

```
Network Type    | Protocols           | Test Scenarios
----------------|--------------------|-----------------
BSC Testnet     | LZ, Celer, IBC     | Full multi-protocol
Base Sepolia    | LZ, XERC20         | Standard + XERC20
OP Sepolia      | LZ, Celer, XERC20  | Multi-protocol
Sapphire        | Celer, Hyperlane   | Alternative protocols
```

## Implementation Phases

### Phase 1: Script Consolidation

- Merge deployment scripts into unified `deploy.ts`
- Implement protocol detection logic
- Add deployment mode auto-selection
- Maintain backward compatibility

### Phase 2: Configuration Unification

- Merge configuration scripts into unified `configure.ts`
- Implement cross-chain parameter setup
- Add tier validation enhancements
- Update setup script for local-only operations

### Phase 3: Documentation and Testing

- Update DEPLOYMENT.md with new workflow
- Create comprehensive test suite
- Update npm scripts in package.json
- Add migration guides for existing deployments

### Phase 4: Cleanup and Optimization

- Remove legacy scripts
- Optimize deployment performance
- Add advanced monitoring and logging
- Create deployment analytics dashboard

## Migration Strategy

### Backward Compatibility

1. **Artifact Format Migration**: Automatic upgrade of legacy deployment files
2. **Script Compatibility**: Temporary support for old script names with deprecation warnings
3. **Configuration Migration**: Automatic detection and upgrade of old configuration formats

### Rollout Plan

1. **Development Networks**: Deploy and test on development networks first
2. **Testnet Validation**: Full validation on all supported testnets
3. **Mainnet Preparation**: Comprehensive testing and validation
4. **Gradual Migration**: Network-by-network migration with rollback capability

## Performance Considerations

### Deployment Optimization

1. **Parallel Contract Deployment**: Deploy independent contracts in parallel
2. **Gas Optimization**: Intelligent gas estimation and optimization
3. **Network-Specific Tuning**: Custom deployment parameters per network
4. **Caching**: Cache compilation artifacts and deployment data

### Configuration Efficiency

1. **Batch Operations**: Group related configuration calls
2. **Lazy Loading**: Load cross-chain data only when needed
3. **Connection Pooling**: Reuse network connections across operations
4. **Progress Tracking**: Real-time progress updates for long operations
