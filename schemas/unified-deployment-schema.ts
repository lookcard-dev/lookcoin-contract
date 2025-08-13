/**
 * Unified Deployment Schema v3.0.0
 * 
 * This schema consolidates ALL deployment state into a single file per network,
 * eliminating fragmentation between standard, enhanced, and config files.
 * 
 * Key Features:
 * - Single source of truth per network
 * - Complete backwards compatibility
 * - Version tracking and migration history
 * - Extensible for future requirements
 * - Full cross-chain topology support
 */

export interface UnifiedDeployment {
  // ============================================================================
  // Schema & Version Management
  // ============================================================================
  schemaVersion: '3.0.0';
  fileVersion: number; // Incremented on each write for optimistic locking
  
  // ============================================================================
  // Network Identity
  // ============================================================================
  network: string; // e.g., 'bscmainnet', 'basesepolia'
  chainId: number; // e.g., 56, 84532
  networkTier: 'mainnet' | 'testnet' | 'dev';
  
  // ============================================================================
  // Deployment Metadata
  // ============================================================================
  metadata: {
    // Basic deployment info
    deployer: string; // Address of original deployer
    deploymentMode: 'standard' | 'multi-protocol' | 'simple';
    timestamp: string; // ISO 8601 initial deployment time
    lastUpdated: string; // ISO 8601 last modification time
    
    // Protocol information
    protocolsEnabled: Array<'layerZero' | 'celer' | 'hyperlane'>;
    protocolsDeployed: Array<'layerZero' | 'celer' | 'hyperlane'>; // Actually deployed
    protocolsConfigured: Array<'layerZero' | 'celer' | 'hyperlane'>; // Fully configured
    
    // Migration tracking
    migrationHistory: Array<{
      from: string; // Previous schema version
      to: string; // New schema version
      timestamp: string; // ISO 8601
      migrator?: string; // Tool or script that performed migration
      notes?: string; // Any migration notes
    }>;
    
    // Data source tracking
    dataSources: {
      originalFormat: 'leveldb' | 'json-v1' | 'json-v2' | 'unified';
      importedFrom?: string[]; // Files that were merged to create this
      consolidatedAt?: string; // When files were consolidated
    };
  };
  
  // ============================================================================
  // Contract Registry - ALL contracts in one place
  // ============================================================================
  contracts: {
    // Core contracts (always present)
    core: {
      LookCoin: ContractInfo;
      SupplyOracle: ContractInfo;
    };
    
    // Protocol modules (present based on deployment mode)
    protocol?: {
      LayerZeroModule?: ContractInfo;
      CelerIMModule?: ContractInfo;
      HyperlaneModule?: ContractInfo;
    };
    
    // Infrastructure (BSC multi-protocol only)
    infrastructure?: {
      CrossChainRouter?: ContractInfo;
      FeeManager?: ContractInfo;
      SecurityManager?: ContractInfo;
      ProtocolRegistry?: ContractInfo;
    };
    
    // Legacy contract names mapping (for backwards compatibility)
    legacy?: {
      [legacyName: string]: {
        currentName: string;
        currentCategory: 'core' | 'protocol' | 'infrastructure';
      };
    };
  };
  
  // ============================================================================
  // Configuration - All protocol and system configs
  // ============================================================================
  configuration: {
    // Governance configuration
    governance: {
      vault: string; // MPC vault address
      timelock?: string; // Timelock address if applicable
      multisig?: string; // Multisig address if different from vault
      operators?: string[]; // Operator addresses
      guardians?: string[]; // Pause guardian addresses
    };
    
    // Protocol-specific configurations
    protocols: {
      layerZero?: {
        endpoint: string; // LayerZero endpoint address
        lzChainId: number; // LayerZero chain ID
        dvnConfig?: {
          requiredDVNs: string[]; // Required DVN addresses
          optionalDVNs?: string[]; // Optional DVN addresses
          threshold: number; // DVN threshold
        };
        gasLimits?: Record<string, number>; // chainId -> gasLimit
        remotes: RemoteChainConfig[]; // Connected chains via LayerZero
      };
      
      celer?: {
        messageBus: string; // Celer message bus address
        celerChainId: number; // Celer chain ID
        feeConfig?: {
          baseFeeRate: number; // Basis points
          minFee: string; // Wei string
          maxFee: string; // Wei string
        };
        remotes: RemoteChainConfig[]; // Connected chains via Celer
      };
      
      hyperlane?: {
        mailbox: string; // Hyperlane mailbox address
        hyperlaneChainId: number; // Hyperlane domain ID
        igp?: string; // Interchain gas paymaster
        ism?: string; // Interchain security module
        hook?: string; // Default hook address
        remotes: RemoteChainConfig[]; // Connected chains via Hyperlane
        status: 'not-ready' | 'ready' | 'active';
      };
    };
    
    // Security configuration
    security: {
      pauseEnabled: boolean;
      emergencyDelay: number; // Seconds
      rateLimits?: {
        daily?: string; // Wei string
        perTransaction?: string; // Wei string
      };
      blacklist?: string[]; // Blacklisted addresses
      whitelist?: string[]; // Whitelisted addresses
    };
    
    // Supply oracle configuration
    supplyOracle?: {
      reconciliationInterval: number; // Seconds
      toleranceThreshold: number; // Basis points
      operators: string[]; // Oracle operator addresses
      requiredSignatures: number;
      lastReconciliation?: string; // ISO 8601
    };
  };
  
  // ============================================================================
  // Network Topology - Complete cross-chain view
  // ============================================================================
  topology: {
    // Summary of all connections
    connectedChains: ConnectedChain[];
    
    // Tier validation
    tierValidation: {
      crossTierAllowed: boolean;
      crossTierDetected: boolean;
      overrideMethod?: 'force' | 'config' | 'none';
      validatedAt: string; // ISO 8601
    };
    
    // Cross-chain configuration status
    configurationStatus: {
      lastConfigured: string; // ISO 8601
      pendingConfigurations: string[]; // Protocol names pending config
      failedConfigurations: Array<{
        protocol: string;
        error: string;
        timestamp: string;
      }>;
    };
  };
  
  // ============================================================================
  // Verification & Validation
  // ============================================================================
  verification: {
    // Contract verification status
    contractVerification: {
      [contractName: string]: {
        verified: boolean;
        verifiedAt?: string; // ISO 8601
        explorer?: string; // Explorer URL
        compiler?: string; // Compiler version
        optimizer?: boolean;
        runs?: number;
      };
    };
    
    // Implementation hashes for upgrade verification
    implementationHashes: {
      [contractName: string]: string; // Bytecode hash
    };
    
    // Data integrity
    dataIntegrity: {
      lastValidated: string; // ISO 8601
      checksums: {
        contracts: string; // Hash of contracts object
        configuration: string; // Hash of configuration object
        topology: string; // Hash of topology object
      };
    };
  };
  
  // ============================================================================
  // Operational Metadata
  // ============================================================================
  operations: {
    // Deployment history
    deploymentHistory: Array<{
      contractName: string;
      action: 'deployed' | 'upgraded' | 'configured';
      timestamp: string; // ISO 8601
      txHash?: string;
      gasUsed?: string;
      notes?: string;
    }>;
    
    // Upgrade history
    upgradeHistory: Array<{
      contractName: string;
      fromImplementation: string;
      toImplementation: string;
      timestamp: string; // ISO 8601
      txHash: string;
      reason?: string;
    }>;
    
    // Maintenance windows
    maintenanceWindows?: Array<{
      start: string; // ISO 8601
      end: string; // ISO 8601
      reason: string;
      affectedProtocols?: string[];
    }>;
    
    // Performance metrics
    metrics?: {
      totalTransactions?: number;
      totalVolume?: string; // Wei string
      averageGasUsed?: string;
      lastUpdated?: string; // ISO 8601
    };
  };
  
  // ============================================================================
  // Emergency & Recovery
  // ============================================================================
  emergency?: {
    // Circuit breaker status
    circuitBreaker: {
      enabled: boolean;
      triggeredAt?: string; // ISO 8601
      reason?: string;
      estimatedRecovery?: string; // ISO 8601
    };
    
    // Backup references
    backups: Array<{
      timestamp: string; // ISO 8601
      location: string; // File path or identifier
      checksum: string; // File checksum
      type: 'full' | 'incremental';
    }>;
    
    // Recovery points
    recoveryPoints: Array<{
      id: string;
      timestamp: string; // ISO 8601
      description: string;
      dataHash: string;
    }>;
  };
}

// ============================================================================
// Supporting Types
// ============================================================================

export interface ContractInfo {
  // Address information
  address?: string; // For non-proxy contracts
  proxy?: string; // Proxy address
  implementation?: string; // Implementation address
  admin?: string; // Proxy admin address
  
  // Deployment metadata
  deploymentTx?: string; // Transaction hash
  deployedAt?: string; // ISO 8601
  deployedBy?: string; // Deployer address
  
  // Contract metadata
  version?: string; // Contract version
  gitCommit?: string; // Git commit hash at deployment
  constructor?: any[]; // Constructor arguments
  
  // Verification
  verified?: boolean;
  verificationUrl?: string;
}

export interface RemoteChainConfig {
  chainId: number; // Remote chain ID
  network: string; // Network name
  networkTier: 'mainnet' | 'testnet' | 'dev';
  lookCoin: string; // LookCoin address on remote chain
  configuredAt?: string; // ISO 8601
  lastVerified?: string; // ISO 8601
  status: 'active' | 'pending' | 'failed';
}

export interface ConnectedChain {
  chainId: number;
  network: string;
  networkTier: 'mainnet' | 'testnet' | 'dev';
  protocols: Array<{
    name: 'layerZero' | 'celer' | 'hyperlane';
    status: 'active' | 'pending' | 'failed';
    lookCoin: string; // Address on remote chain
    lastSync?: string; // ISO 8601
  }>;
  isHomeChain: boolean; // True for BSC (minting chain)
}

// ============================================================================
// Migration Support Types
// ============================================================================

export interface MigrationContext {
  sourceFiles: {
    standard?: string; // Path to standard deployment file
    enhanced?: string; // Path to enhanced deployment file
    config?: string; // Path to config file
  };
  targetFile: string; // Path to unified file
  backupFile?: string; // Path to backup
  options: {
    preserveHistory: boolean;
    validateData: boolean;
    createBackup: boolean;
    dryRun: boolean;
  };
}

// ============================================================================
// Type Guards
// ============================================================================

export function isUnifiedDeployment(data: unknown): data is UnifiedDeployment {
  const d = data as any;
  return (
    d &&
    typeof d === 'object' &&
    d.schemaVersion === '3.0.0' &&
    typeof d.network === 'string' &&
    typeof d.chainId === 'number' &&
    d.metadata &&
    d.contracts &&
    d.configuration &&
    d.topology
  );
}

// ============================================================================
// Validation Functions
// ============================================================================

export function validateUnifiedDeployment(deployment: UnifiedDeployment): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Required fields validation
  if (!deployment.schemaVersion || deployment.schemaVersion !== '3.0.0') {
    errors.push('Invalid schema version');
  }
  
  if (!deployment.network || !deployment.chainId) {
    errors.push('Missing network or chainId');
  }
  
  if (!deployment.contracts?.core?.LookCoin) {
    errors.push('Missing core LookCoin contract');
  }
  
  if (!deployment.contracts?.core?.SupplyOracle) {
    errors.push('Missing core SupplyOracle contract');
  }
  
  // Protocol consistency checks
  const enabledProtocols = deployment.metadata?.protocolsEnabled || [];
  const deployedProtocols = deployment.metadata?.protocolsDeployed || [];
  
  for (const protocol of deployedProtocols) {
    if (!enabledProtocols.includes(protocol)) {
      warnings.push(`Protocol ${protocol} is deployed but not enabled`);
    }
  }
  
  // Cross-tier validation
  if (deployment.topology?.tierValidation?.crossTierDetected && 
      !deployment.topology?.tierValidation?.crossTierAllowed) {
    warnings.push('Cross-tier connections detected but not allowed');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}