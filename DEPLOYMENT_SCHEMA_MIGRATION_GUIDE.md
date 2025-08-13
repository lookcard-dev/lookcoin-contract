# Deployment Schema Migration Guide
**LookCoin Contract State Management Evolution: LevelDB to Unified JSON Schema**

---

## Table of Contents
- [Overview](#overview)
- [Schema Evolution](#schema-evolution)
- [Field Mapping and Transformations](#field-mapping-and-transformations)
- [Extended Fields Pattern](#extended-fields-pattern)
- [Cross-Network Consistency](#cross-network-consistency)
- [State Management Architecture](#state-management-architecture)
- [Implementation Guide](#implementation-guide)
- [Migration Examples](#migration-examples)
- [Troubleshooting](#troubleshooting)

---

## Overview

This guide provides comprehensive technical documentation for the LookCoin deployment schema migration from LevelDB binary storage to Unified JSON format. The migration introduces a new state management architecture while maintaining 100% backward compatibility and data integrity.

### Migration Scope

**From**: LevelDB binary key-value storage with fragmented JSON files  
**To**: Unified JSON schema v3.0.0 with consolidated state management  
**Scope**: 26 smart contracts across 5 blockchain networks  
**Result**: 100% data preservation with enhanced operational capabilities

### Key Benefits

- **Single Source of Truth**: All deployment data in one file per network
- **Human Readable**: JSON format enables easy debugging and version control
- **Extended Capabilities**: Rich metadata and network topology management
- **Performance Optimized**: Caching, indexing, and query optimization
- **Version Controlled**: Git-friendly format with clear schema versioning

---

## Schema Evolution

### Legacy Format (Pre-Migration)

#### LevelDB Structure
```
leveldb/
├── 000187.log                    # Transaction log
├── CURRENT                       # Current version pointer
├── MANIFEST-000185               # Database manifest
└── [binary data files]          # Contract data in binary format

Key Format: {network}:{address}
Value Format: JSON-serialized ContractInfo
```

#### Fragmented JSON Files
```
deployments/
├── bscmainnet.json              # Basic contract addresses
├── enhanced-bscmainnet.json     # Rich operational data
├── config-bscmainnet.json       # Configuration status
└── [multiple files per network] # Data fragmentation
```

**Problems with Legacy Format**:
- Data duplication across multiple files
- Binary format difficult to debug
- No version control for schema
- Limited query capabilities
- Complex cross-network operations

### Unified Schema v3.0.0 (Post-Migration)

#### Single File per Network
```
deployments/unified/
├── bscmainnet.unified.json      # Complete deployment state
├── bsctestnet.unified.json      # All data consolidated
├── basesepolia.unified.json     # Consistent schema
├── optimismsepolia.unified.json
└── sapphiremainnet.unified.json
```

#### Schema Structure
```typescript
interface UnifiedDeployment {
  // Schema versioning
  schemaVersion: '3.0.0';
  fileVersion: number;           // Optimistic locking
  
  // Network identity
  network: string;               // Human-readable name
  chainId: number;              // Blockchain chain ID
  networkTier: 'mainnet' | 'testnet' | 'dev';
  
  // Complete metadata
  metadata: DeploymentMetadata;
  
  // All contracts organized by type
  contracts: {
    core: Record<string, ContractInfo>;          // LookCoin, SupplyOracle
    protocol: Record<string, ContractInfo>;      // LayerZero, Celer modules
    infrastructure: Record<string, ContractInfo>; // Router, FeeManager
    legacy: Record<string, string>;             // Name mappings
  };
  
  // Complete configuration
  configuration: NetworkConfiguration;
  
  // Network topology
  topology: NetworkTopology;
  
  // Operational data
  verification: VerificationInfo;
  operations: OperationalInfo;
  emergency: EmergencyInfo;
}
```

---

## Field Mapping and Transformations

### Core Contract Information

#### LevelDB to JSON Mapping
```typescript
// LevelDB ContractType → Unified JSON ContractInfo
interface ContractMapping {
  // Direct field mappings
  name: string;                    // Preserved as-is
  address: string;                 // Preserved as-is (proxy address)
  
  // Critical transformation: Implementation handling
  implementation: string;          // CHANGED: Now stores ADDRESS not hash
  implementationHash: string;      // NEW: Hash moved to extended fields
  
  // Timestamp precision preservation
  deployedAt: bigint;             // Preserved with BigInt serialization
  
  // Constructor arguments with BigInt support
  constructorArgs: any[];         // Enhanced serialization
  
  // Enhanced proxy information
  proxy?: ProxyInfo;              // Expanded proxy metadata
  
  // Additional metadata
  metadata?: ContractMetadata;    // Rich operational data
}
```

#### Critical Implementation Field Fix

**Problem**: LevelDB stored implementation hash in `implementation` field, causing upgrade detection failures

**Solution**: Extended fields pattern separates address and hash
```typescript
// Standard contract info (schema compatible)
{
  "name": "LookCoin",
  "address": "0x7d919E3ac306BBA4e5c85E40fB665126586C992d",
  "implementation": "0x8f8C...4e3f", // ✅ ADDRESS (not hash)
  "deployedAt": "1753441878006"
}

// Extended fields (additional data)
{
  "extended_LookCoin": {
    "implementationHash": "0x035df318...", // ✅ HASH stored here
    "factoryByteCodeHash": "0x12345...",
    "deploymentArgs": [...],
    "timestamp": 1753441878006
  }
}
```

### BigInt Serialization

#### Challenge
JavaScript BigInt values cannot be JSON serialized natively:
```javascript
JSON.stringify({ value: 123n }); // TypeError: Cannot serialize BigInt
```

#### Solution: Custom Serialization Pattern
```typescript
interface BigIntSerialization {
  serializeBigInt(value: bigint): string;
  deserializeBigInt(value: string): bigint;
  serializeConstructorArgs(args: any[]): any[];
}

// Serialization examples
const timestamp = 1753441878006n;
const serialized = timestamp.toString(); // "1753441878006"

// Constructor args with mixed types
const args = [
  "LookCoin",                              // string
  5000000000000000000000000000n,          // BigInt
  "0x1a44076050125825900e736c501f859c50fE728c" // address
];

// Serialized format
const serializedArgs = [
  "LookCoin",
  { "_type": "bigint", "_value": "5000000000000000000000000000" },
  "0x1a44076050125825900e736c501f859c50fE728c"
];
```

### Network Configuration Mapping

#### Protocol Configuration Transformation
```typescript
// LevelDB: Scattered configuration data
// JSON: Centralized protocol configuration

interface ProtocolConfiguration {
  layerZero?: {
    endpoint: string;
    chainId: number;
    dvnConfigs: DVNConfig[];
    gasLimits: Record<string, string>;
  };
  
  celer?: {
    messageBus: string;
    chainId: number;
    feeStructure: {
      bridgeFeeBasisPoints: number;
      minBridgeFee: string;
      maxBridgeFee: string;
    };
  };
  
  hyperlane?: {
    mailbox: string;
    domain: number;
    ismConfig: InterchainSecurityModuleConfig;
  };
}
```

---

## Extended Fields Pattern

### Pattern Overview

The extended fields pattern enables backward compatibility while preserving all LevelDB data that doesn't fit the standard schema.

#### Pattern Implementation
```typescript
// Standard schema fields (backward compatible)
const standardContract = {
  name: "LookCoin",
  address: "0x7d919E3ac306BBA4e5c85E40fB665126586C992d",
  implementation: "0x8f8C4e3f...", // Address
  deployedAt: "1753441878006"
};

// Extended fields (additional LevelDB data)
const extendedFields = {
  [`extended_${contractName}`]: {
    implementationHash: "0x035df318...", // Original hash
    factoryByteCodeHash: "0x12345...",   // Factory data
    deploymentArgs: [...],               // Constructor params
    timestamp: 1753441878006,           // Original timestamp
    upgradeHistory: [...],              // Upgrade tracking
    deploymentContext: {...}           // Deployment metadata
  }
};
```

#### Extended Fields Implementation

```typescript
class UnifiedJSONStateManager {
  // Store contract with extended fields
  async updateContract(address: string, contractType: ContractType): Promise<void> {
    // Standard fields for schema compatibility
    const contractInfo: ContractInfo = {
      name: contractType.name,
      address: contractType.address,
      implementation: contractType.implementation, // Store ADDRESS
      deployedAt: contractType.deployedAt
    };
    
    // Extended fields for additional data
    const extendedKey = `extended_${contractType.name}`;
    const extendedData = {
      implementationHash: contractType.implementationHash, // Store HASH
      factoryByteCodeHash: contractType.factoryByteCodeHash,
      deploymentArgs: contractType.deploymentArgs,
      timestamp: Number(contractType.deployedAt)
    };
    
    // Update both standard and extended sections
    deployment.contracts[address] = contractInfo;
    deployment[extendedKey] = extendedData;
  }
  
  // Retrieve contract with extended data merged
  async convertToContractType(contractInfo: ContractInfo): Promise<ContractType> {
    const extendedKey = `extended_${contractInfo.name}`;
    const extendedData = this.deployment[extendedKey] || {};
    
    return {
      name: contractInfo.name,
      address: contractInfo.address,
      implementation: contractInfo.implementation,
      implementationHash: extendedData.implementationHash || 
                         this.deriveHashFromAddress(contractInfo.implementation),
      factoryByteCodeHash: extendedData.factoryByteCodeHash,
      deploymentArgs: extendedData.deploymentArgs || [],
      deployedAt: BigInt(contractInfo.deployedAt)
    };
  }
}
```

### Extended Fields Examples

#### BSC Mainnet Extended Data
```json
{
  "extended_LookCoin": {
    "implementationHash": "0x035df318e7b4d02767fc5d749d77c0cd1f8a24e45950df940b71de21b6b81d49",
    "factoryByteCodeHash": "0x12345...",
    "deploymentArgs": [
      "0x6Fb9955AA9d3f77CB3281633FC6e57B249a26b21",
      { "_type": "bigint", "_value": "5000000000000000000000000000" }
    ],
    "timestamp": 1753441878006
  },
  
  "extended_CelerIMModule": {
    "implementationHash": "0x987fbc...",
    "factoryByteCodeHash": "0x54321...",
    "deploymentArgs": [
      "0x95714818fdd7a5454f73da9c777b3ee6ebaeea6b",
      "0x7d919E3ac306BBA4e5c85E40fB665126586C992d"
    ],
    "timestamp": 1753441899234
  }
}
```

---

## Cross-Network Consistency

### Network Topology Management

#### Unified Network Definitions
```typescript
interface NetworkTopology {
  connectedChains: ConnectedChain[];
  tierValidation: TierValidation;
  configurationStatus: ConfigurationStatus;
  routingPaths: Record<string, RoutingPath>;
}

interface ConnectedChain {
  chainId: number;
  networkName: string;
  protocols: string[];          // ['layerZero', 'celer', 'hyperlane']
  enabled: boolean;
  lastConfigured: string;
  configurationHash: string;
}
```

#### Cross-Network Validation Rules

1. **Chain ID Consistency**: Each network must have unique chain ID
2. **Protocol Availability**: Protocol support must match network capabilities
3. **Configuration Symmetry**: Cross-chain configs must be bidirectional
4. **Address Uniqueness**: Contract addresses must be unique within network
5. **Version Compatibility**: Schema versions must be compatible

#### Example: BSC Mainnet Topology
```json
{
  "topology": {
    "connectedChains": [
      {
        "chainId": 97,
        "networkName": "bsctestnet",
        "protocols": ["layerZero", "celer"],
        "enabled": true,
        "lastConfigured": "2025-08-13T10:30:00.000Z",
        "configurationHash": "0xabcd1234..."
      },
      {
        "chainId": 84532,
        "networkName": "basesepolia",
        "protocols": ["layerZero"],
        "enabled": true,
        "lastConfigured": "2025-08-13T10:35:00.000Z",
        "configurationHash": "0xefgh5678..."
      }
    ],
    "routingPaths": {
      "97": {
        "preferredProtocol": "layerZero",
        "fallbackProtocols": ["celer"],
        "maxTransferAmount": "5000000000000000000000000"
      }
    }
  }
}
```

### Configuration Status Tracking

#### Multi-Network Configuration State
```typescript
interface ConfigurationStatus {
  deploymentPhase: 'deployed' | 'setup' | 'configured';
  lastUpdated: string;
  configurationHash: string;
  pendingOperations: PendingOperation[];
  crossNetworkConsistency: ConsistencyStatus;
}

// Example configuration tracking
{
  "configurationStatus": {
    "deploymentPhase": "configured",
    "lastUpdated": "2025-08-13T10:30:00.000Z",
    "configurationHash": "0x123abc...",
    "pendingOperations": [],
    "crossNetworkConsistency": {
      "status": "consistent",
      "lastValidated": "2025-08-13T10:29:00.000Z",
      "inconsistencies": []
    }
  }
}
```

---

## State Management Architecture

### IStateManager Interface

#### Unified State Management Interface
```typescript
interface IStateManager {
  // Core CRUD operations
  getContract(address: string): Promise<ContractInfo | null>;
  putContract(address: string, info: ContractInfo): Promise<void>;
  deleteContract(address: string): Promise<void>;
  
  // Query operations
  getAllContracts(): Promise<ContractInfo[]>;
  queryContracts(filter: ContractFilter): Promise<ContractInfo[]>;
  
  // Batch operations
  putContracts(contracts: Map<string, ContractInfo>): Promise<void>;
  
  // Deployment-specific operations
  fetchDeployOrUpgradeProxy(args: DeploymentArgs): Promise<ContractDeployment>;
  
  // Migration operations
  migrateDeploymentFormat(deployment: LegacyDeployment): EnhancedDeployment;
  
  // Utility operations
  exists(address: string): Promise<boolean>;
  close(): Promise<void>;
}
```

### UnifiedJSONStateManager Implementation

#### Core Methods
```typescript
class UnifiedJSONStateManager implements IStateManager {
  private readonly filePath: string;
  private deployment: UnifiedDeployment;
  private cache: Map<string, ContractInfo> = new Map();
  
  constructor(network: string) {
    this.filePath = path.join(process.cwd(), 'deployments/unified', `${network}.unified.json`);
  }
  
  // Load deployment data with validation
  private async loadDeployment(): Promise<void> {
    if (!fs.existsSync(this.filePath)) {
      this.deployment = this.createEmptyDeployment();
      return;
    }
    
    const data = await fs.promises.readFile(this.filePath, 'utf-8');
    this.deployment = JSON.parse(data);
    
    // Validate schema version
    if (this.deployment.schemaVersion !== '3.0.0') {
      throw new Error(`Unsupported schema version: ${this.deployment.schemaVersion}`);
    }
    
    // Rebuild cache from deployment data
    this.rebuildCache();
  }
  
  // Convert extended data back to ContractType
  async convertToContractType(contractInfo: ContractInfo): Promise<ContractType> {
    const extendedKey = `extended_${contractInfo.name}`;
    const extendedData = this.deployment[extendedKey] || {};
    
    return {
      name: contractInfo.name,
      address: contractInfo.address,
      implementation: contractInfo.implementation,
      implementationHash: extendedData.implementationHash || 
                         await this.deriveImplementationHash(contractInfo.implementation),
      factoryByteCodeHash: extendedData.factoryByteCodeHash,
      deploymentArgs: this.deserializeArgs(extendedData.deploymentArgs || []),
      deployedAt: BigInt(contractInfo.deployedAt)
    };
  }
  
  // Store contract with extended fields
  async updateContract(address: string, contractType: ContractType): Promise<void> {
    await this.ensureLoaded();
    
    // Store standard fields (schema compatible)
    const contractInfo: ContractInfo = {
      name: contractType.name,
      address: contractType.address,
      implementation: contractType.implementation, // ADDRESS not hash
      deployedAt: contractType.deployedAt.toString()
    };
    
    // Store extended fields
    const extendedKey = `extended_${contractType.name}`;
    this.deployment[extendedKey] = {
      implementationHash: contractType.implementationHash,
      factoryByteCodeHash: contractType.factoryByteCodeHash,
      deploymentArgs: this.serializeArgs(contractType.deploymentArgs),
      timestamp: Number(contractType.deployedAt)
    };
    
    // Update contracts based on type
    const contractCategory = this.determineContractCategory(contractType.name);
    this.deployment.contracts[contractCategory][contractType.name] = contractInfo;
    
    // Update cache
    this.cache.set(address.toLowerCase(), contractInfo);
    
    // Persist to file
    await this.persistDeployment();
  }
}
```

### StateManagerFactory Integration

#### Automatic Backend Selection
```typescript
class StateManagerFactory {
  static async createManager(
    network: string,
    options: StateManagerOptions = {}
  ): Promise<IStateManager> {
    const config = this.resolveConfiguration(network, options);
    
    switch (config.backend) {
      case 'unified-json':
        return new UnifiedJSONStateManager(network);
        
      case 'leveldb':
        return new LevelDBStateManager(network);
        
      case 'auto':
      default:
        return this.createAutoManager(network, config);
    }
  }
  
  private static async createAutoManager(
    network: string,
    config: StateManagerConfig
  ): Promise<IStateManager> {
    // Prefer unified JSON if available
    const unifiedPath = path.join(process.cwd(), 'deployments/unified', `${network}.unified.json`);
    if (fs.existsSync(unifiedPath)) {
      try {
        const manager = new UnifiedJSONStateManager(network);
        await manager.validate();
        return manager;
      } catch (error) {
        console.warn('Unified JSON validation failed, falling back to LevelDB');
      }
    }
    
    // Fallback to LevelDB
    return new LevelDBStateManager(network);
  }
}
```

---

## Implementation Guide

### Migration Steps

#### 1. Pre-Migration Validation
```bash
# Validate current LevelDB data
npm run migration:validate-leveldb

# Export LevelDB data for comparison
npm run migration:export-leveldb

# Create backup of current state
npm run migration:create-backup
```

#### 2. Enable Unified JSON Manager
```typescript
// In deployment scripts, update StateManager usage
const stateManager = await StateManagerFactory.createManager(network, {
  backend: 'unified-json',
  enableFallback: true  // Fallback to LevelDB on errors
});
```

#### 3. Migrate Existing Data
```bash
# Migrate LevelDB data to unified format
npm run migration:leveldb-to-unified

# Validate migration completeness
npm run migration:validate-migration

# Test deployment operations
npm run test:deployment-with-unified
```

#### 4. Consolidate Fragmented Files
```bash
# Consolidate existing JSON files
npm run migration:consolidate-json-files

# Validate unified files
npm run migration:validate-unified-files

# Archive old files
npm run migration:archive-legacy-files
```

### Development Integration

#### Using UnifiedJSONStateManager
```typescript
import { StateManagerFactory } from './scripts/utils/StateManagerFactory';

// Create state manager (automatically selects unified JSON)
const stateManager = await StateManagerFactory.createManager('bscmainnet');

// Standard operations work transparently
const lookCoin = await stateManager.getContract('0x7d919E3ac306BBA4e5c85E40fB665126586C992d');

// Deploy or upgrade proxy (handles extended fields automatically)
const deployment = await stateManager.fetchDeployOrUpgradeProxy({
  contractName: 'LookCoin',
  implementation: '0x8f8C4e3f...',
  constructorArgs: [...]
});

// Batch operations for efficiency
const allContracts = await stateManager.getAllContracts();
```

#### Deployment Script Integration
```typescript
// deployment.ts - No changes required to existing scripts
import { getStateManager } from './utils/state';

const deploy = async () => {
  const stateManager = await getStateManager(); // Uses unified JSON automatically
  
  // Existing deployment logic works unchanged
  const lookCoin = await deployments.deploy('LookCoin', {
    // ... deployment args
  });
  
  // State manager handles extended fields transparently
  await stateManager.updateContract(lookCoin.address, {
    name: 'LookCoin',
    address: lookCoin.address,
    implementation: lookCoin.implementation,
    // ... other fields
  });
};
```

### Testing and Validation

#### Unit Tests for State Management
```typescript
describe('UnifiedJSONStateManager', () => {
  let stateManager: UnifiedJSONStateManager;
  
  beforeEach(async () => {
    stateManager = new UnifiedJSONStateManager('testnet');
  });
  
  it('should store and retrieve contract with extended fields', async () => {
    const contractType: ContractType = {
      name: 'LookCoin',
      address: '0x123...',
      implementation: '0x456...',
      implementationHash: '0x789...',
      factoryByteCodeHash: '0xabc...',
      deploymentArgs: ['arg1', 123n, 'arg3'],
      deployedAt: BigInt(Date.now())
    };
    
    await stateManager.updateContract(contractType.address, contractType);
    const retrieved = await stateManager.getContract(contractType.address);
    
    expect(retrieved).toBeDefined();
    expect(retrieved.name).toBe(contractType.name);
    expect(retrieved.implementation).toBe(contractType.implementation);
    
    // Verify extended fields are preserved
    const convertedBack = await stateManager.convertToContractType(retrieved);
    expect(convertedBack.implementationHash).toBe(contractType.implementationHash);
    expect(convertedBack.factoryByteCodeHash).toBe(contractType.factoryByteCodeHash);
  });
  
  it('should handle BigInt serialization correctly', async () => {
    const bigIntValue = 5000000000000000000000000000n;
    const args = ['string', bigIntValue, '0x123...'];
    
    const serialized = stateManager.serializeArgs(args);
    const deserialized = stateManager.deserializeArgs(serialized);
    
    expect(deserialized[1]).toBe(bigIntValue);
    expect(typeof deserialized[1]).toBe('bigint');
  });
});
```

#### Integration Tests
```typescript
describe('Deployment Integration', () => {
  it('should deploy contract using unified state manager', async () => {
    const stateManager = await StateManagerFactory.createManager('testnet');
    
    // Test deploy, setup, configure cycle
    await deployLookCoin(stateManager);
    await setupLookCoin(stateManager);
    await configureLookCoin(stateManager);
    
    // Verify all operations completed successfully
    const contracts = await stateManager.getAllContracts();
    expect(contracts.length).toBeGreaterThan(0);
  });
});
```

---

## Migration Examples

### Example 1: BSC Mainnet Migration

#### Before: LevelDB + Fragmented JSON
```
LevelDB entries:
- BSCMAINNET:0x7d919E3ac306BBA4e5c85E40fB665126586C992d
- BSCMAINNET:0x9177A126C719A943BdF05fbC1dC089DCa458cb9e
- BSCMAINNET:0x4B4C4286328181Ecd9E14Ff31f9dCF67b6E201Bb

JSON files:
- bscmainnet.json (basic addresses)
- enhanced-bscmainnet.json (rich metadata)
```

#### After: Unified JSON
```json
{
  "schemaVersion": "3.0.0",
  "fileVersion": 1,
  "network": "bscmainnet",
  "chainId": 56,
  "networkTier": "mainnet",
  
  "metadata": {
    "deployment": {
      "timestamp": "2025-07-25T11:11:18.006Z",
      "deployer": "0x6Fb9955AA9d3f77CB3281633FC6e57B249a26b21",
      "deploymentMode": "multi-protocol"
    },
    "migration": {
      "source": "leveldb",
      "migratedAt": "2025-08-13T10:30:00.000Z",
      "dataQuality": "100%",
      "preservedFields": 30
    }
  },
  
  "contracts": {
    "core": {
      "LookCoin": {
        "name": "LookCoin",
        "address": "0x7d919E3ac306BBA4e5c85E40fB665126586C992d",
        "implementation": "0x8f8C4e3f...", 
        "deployedAt": "1753441878006"
      },
      "SupplyOracle": {
        "name": "SupplyOracle",
        "address": "0x4B4C4286328181Ecd9E14Ff31f9dCF67b6E201Bb",
        "implementation": "0x9a8B5d2f...",
        "deployedAt": "1753441899234"
      }
    },
    "protocol": {
      "CelerIMModule": {
        "name": "CelerIMModule",
        "address": "0x9177A126C719A943BdF05fbC1dC089DCa458cb9e",
        "implementation": "0x7c6D3e4a...",
        "deployedAt": "1753441922456"
      }
    }
  },
  
  "configuration": {
    "protocols": {
      "layerZero": {
        "endpoint": "0x1a44076050125825900e736c501f859c50fE728c",
        "chainId": 102
      },
      "celer": {
        "messageBus": "0x95714818fdd7a5454f73da9c777b3ee6ebaeea6b",
        "chainId": 56
      }
    }
  },
  
  "extended_LookCoin": {
    "implementationHash": "0x035df318e7b4d02767fc5d749d77c0cd1f8a24e45950df940b71de21b6b81d49",
    "factoryByteCodeHash": "0x12345...",
    "deploymentArgs": [
      "0x6Fb9955AA9d3f77CB3281633FC6e57B249a26b21",
      { "_type": "bigint", "_value": "5000000000000000000000000000" }
    ],
    "timestamp": 1753441878006
  }
}
```

### Example 2: Cross-Network Configuration

#### Multi-Network Topology Setup
```json
{
  "topology": {
    "connectedChains": [
      {
        "chainId": 97,
        "networkName": "bsctestnet",
        "protocols": ["layerZero", "celer"],
        "enabled": true,
        "configurationHash": "0xabcd1234..."
      },
      {
        "chainId": 84532,
        "networkName": "basesepolia", 
        "protocols": ["layerZero"],
        "enabled": true,
        "configurationHash": "0xefgh5678..."
      }
    ],
    "routingPaths": {
      "97": {
        "preferredProtocol": "layerZero",
        "fallbackProtocols": ["celer"],
        "estimatedGas": "200000",
        "maxTransferAmount": "5000000000000000000000000"
      }
    },
    "configurationStatus": {
      "deploymentPhase": "configured",
      "lastUpdated": "2025-08-13T10:30:00.000Z",
      "crossNetworkConsistency": {
        "status": "consistent",
        "lastValidated": "2025-08-13T10:29:00.000Z",
        "inconsistencies": []
      }
    }
  }
}
```

### Example 3: BigInt Handling

#### Constructor Arguments with BigInt
```typescript
// Original deployment args with BigInt values
const constructorArgs = [
  "LookCoin",                           // string
  "LOOK",                              // string  
  5000000000000000000000000000n,       // BigInt (max supply)
  "0x1a44076050125825900e736c501f859c50fE728c", // address
  "0x6Fb9955AA9d3f77CB3281633FC6e57B249a26b21"  // governance
];

// Serialized in JSON
{
  "deploymentArgs": [
    "LookCoin",
    "LOOK",
    { "_type": "bigint", "_value": "5000000000000000000000000000" },
    "0x1a44076050125825900e736c501f859c50fE728c",
    "0x6Fb9955AA9d3f77CB3281633FC6e57B249a26b21"
  ]
}

// Deserialized back to original types
const deserializedArgs = [
  "LookCoin",                           // string
  "LOOK",                              // string
  5000000000000000000000000000n,       // BigInt (restored)
  "0x1a44076050125825900e736c501f859c50fE728c", // address
  "0x6Fb9955AA9d3f77CB3281633FC6e57B249a26b21"  // governance
];
```

---

## Troubleshooting

### Common Issues and Solutions

#### 1. Schema Version Mismatch
**Problem**: `Unsupported schema version: 2.0.0`

**Cause**: Attempting to use enhanced JSON file with unified manager

**Solution**:
```bash
# Migrate enhanced format to unified format
npm run migration:enhanced-to-unified --network bscmainnet

# Or regenerate unified file from LevelDB
npm run migration:leveldb-to-unified --network bscmainnet
```

#### 2. Extended Fields Missing
**Problem**: `implementationHash undefined` in deployment operations

**Cause**: Extended fields not properly migrated or corrupted

**Solution**:
```bash
# Recover missing extended fields
npm run migration:recover-extended-fields --network bscmainnet

# Validate recovery
npm run migration:validate-extended-fields --network bscmainnet
```

#### 3. BigInt Serialization Errors
**Problem**: `TypeError: Cannot serialize BigInt`

**Cause**: Direct JSON.stringify on objects containing BigInt values

**Solution**:
```typescript
// Use custom serialization
const serialized = stateManager.serializeArgs(constructorArgs);

// Or handle manually
const safeArgs = constructorArgs.map(arg => 
  typeof arg === 'bigint' ? arg.toString() : arg
);
```

#### 4. File Corruption
**Problem**: `JSON parsing failed` or `Invalid deployment format`

**Cause**: Interrupted write operation or manual file editing

**Solution**:
```bash
# Restore from backup
npm run migration:restore-from-backup --network bscmainnet --date 2025-08-13

# Or rebuild from LevelDB
npm run migration:rebuild-unified --network bscmainnet
```

#### 5. Performance Issues
**Problem**: Slow read/write operations

**Cause**: Large file size or inefficient caching

**Solutions**:
```typescript
// Enable caching in StateManager
const stateManager = await StateManagerFactory.createManager('bscmainnet', {
  enableCaching: true,
  cacheSize: 1000,
  cacheTTL: 300000 // 5 minutes
});

// Use batch operations for multiple updates
const updates = new Map([
  ['0x123...', contractInfo1],
  ['0x456...', contractInfo2]
]);
await stateManager.putContracts(updates);
```

### Validation Commands

#### Data Integrity Validation
```bash
# Validate specific network
npm run migration:validate --network bscmainnet

# Validate all networks  
npm run migration:validate --all

# Compare with LevelDB
npm run migration:compare-with-leveldb --network bscmainnet

# Validate extended fields
npm run migration:validate-extended-fields --all
```

#### Performance Validation
```bash
# Run performance benchmarks
npm run benchmark --network bscmainnet

# Quick performance check
npm run benchmark:quick --network bscmainnet

# Memory usage analysis
npm run benchmark:memory --network bscmainnet
```

#### Cross-Network Validation
```bash
# Validate cross-network consistency
npm run migration:validate-cross-network

# Check topology consistency  
npm run migration:validate-topology

# Verify configuration symmetry
npm run migration:validate-configuration-symmetry
```

### Recovery Procedures

#### Complete System Recovery
```bash
# 1. Stop all operations
export EMERGENCY_MODE=true

# 2. Restore from latest backup
npm run migration:emergency-restore

# 3. Validate restoration
npm run migration:validate-emergency-restore

# 4. Resume operations
export EMERGENCY_MODE=false
```

#### Partial Data Recovery
```bash
# Recover specific contract
npm run migration:recover-contract --address 0x123... --network bscmainnet

# Recover extended fields only
npm run migration:recover-extended-fields --network bscmainnet

# Rebuild cache
npm run migration:rebuild-cache --network bscmainnet
```

---

## Performance Considerations

### Optimization Strategies

#### 1. Caching Implementation
```typescript
class OptimizedUnifiedJSONStateManager extends UnifiedJSONStateManager {
  private l1Cache: Map<string, ContractInfo> = new Map(); // In-memory
  private l2Cache: LRUCache<string, ContractInfo>;        // LRU cache
  
  constructor(network: string) {
    super(network);
    this.l2Cache = new LRUCache({ max: 1000, ttl: 5 * 60 * 1000 });
  }
  
  async getContract(address: string): Promise<ContractInfo | null> {
    const key = address.toLowerCase();
    
    // L1 Cache check
    if (this.l1Cache.has(key)) {
      return this.l1Cache.get(key)!;
    }
    
    // L2 Cache check
    if (this.l2Cache.has(key)) {
      const contract = this.l2Cache.get(key)!;
      this.l1Cache.set(key, contract);
      return contract;
    }
    
    // Load from file
    const contract = await super.getContract(address);
    if (contract) {
      this.l1Cache.set(key, contract);
      this.l2Cache.set(key, contract);
    }
    
    return contract;
  }
}
```

#### 2. Batch Operations
```typescript
// Efficient batch processing
async putContracts(contracts: Map<string, ContractInfo>): Promise<void> {
  await this.ensureLoaded();
  
  // Update all contracts in memory first
  for (const [address, contractInfo] of contracts) {
    const category = this.determineContractCategory(contractInfo.name);
    this.deployment.contracts[category][contractInfo.name] = contractInfo;
    this.cache.set(address.toLowerCase(), contractInfo);
  }
  
  // Single file write operation
  await this.persistDeployment();
}
```

#### 3. Memory Management
```typescript
// Memory-efficient large dataset handling
async getAllContracts(): Promise<ContractInfo[]> {
  await this.ensureLoaded();
  
  const contracts: ContractInfo[] = [];
  
  // Stream through contract categories to avoid large memory allocation
  for (const category of ['core', 'protocol', 'infrastructure']) {
    const categoryContracts = this.deployment.contracts[category] || {};
    for (const contractInfo of Object.values(categoryContracts)) {
      contracts.push(contractInfo);
    }
  }
  
  return contracts;
}
```

### Performance Benchmarks

#### Expected Performance Ranges
- **Single Read**: 20-40ms (≤2x LevelDB)
- **Single Write**: 50-90ms (≤3x LevelDB) 
- **Batch Read (50)**: 150-250ms (≤1.5x LevelDB)
- **Batch Write (50)**: 800-1200ms (≤1.5x LevelDB)
- **Memory Usage**: 50-100MB (≤1.5x LevelDB)

#### Performance Monitoring
```typescript
// Built-in performance monitoring
const monitor = new PerformanceMonitor();

const timingId = monitor.startTiming('contract_read');
const contract = await stateManager.getContract(address);
const duration = monitor.endTiming(timingId);

if (duration > 100) { // Log slow operations
  console.warn(`Slow read operation: ${duration}ms for ${address}`);
}
```

---

This comprehensive guide provides everything needed to understand, implement, and troubleshoot the LookCoin deployment schema migration. The unified JSON architecture establishes a robust foundation for future development while maintaining the reliability and performance standards required for production operations.