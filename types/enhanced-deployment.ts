/**
 * Enhanced LookCoin Deployment Types
 * 
 * Comprehensive TypeScript interfaces for LookCoin deployment management
 * with full infrastructure contract support and backward compatibility.
 * 
 * Schema Version: 2.0.0
 */

// ============================================================================
// Core Interface Definitions
// ============================================================================

export interface EnhancedDeployment {
  schemaVersion: '2.0.0';
  network: string;
  chainId: number;
  metadata: DeploymentMetadata;
  contracts: ContractRegistry;
  configuration?: DeploymentConfiguration;
  topology?: NetworkTopology;
  verification?: VerificationData;
  performance?: PerformanceConfig;
  legacy?: LegacyCompatibility;
}

// ============================================================================
// Metadata and Basic Information
// ============================================================================

export interface DeploymentMetadata {
  deployer: string;
  timestamp: string; // ISO date-time
  lastUpdated?: string; // ISO date-time
  deploymentMode: DeploymentMode;
  protocolsEnabled?: Protocol[];
  networkTier?: NetworkTier;
  migrationHistory?: MigrationRecord[];
}

export type DeploymentMode = 'standard' | 'multi-protocol' | 'simple';
export type Protocol = 'layerZero' | 'celer' | 'hyperlane';
export type NetworkTier = 'mainnet' | 'testnet' | 'dev';

export interface MigrationRecord {
  from: string;
  to: string;
  timestamp: string; // ISO date-time
  migrator?: string;
}

// ============================================================================
// Contract Registry Structure
// ============================================================================

export interface ContractRegistry {
  core: CoreContracts;
  protocol?: ProtocolContracts;
  infrastructure?: InfrastructureContracts;
}

export interface CoreContracts {
  LookCoin: ProxyContract;
  SupplyOracle: ProxyContract;
}

export interface ProtocolContracts {
  LayerZeroModule?: DirectContract;
  CelerIMModule?: ProxyContract;
  HyperlaneModule?: ProxyContract;
}

export interface InfrastructureContracts {
  CrossChainRouter?: ProxyContract;
  FeeManager?: ProxyContract;
  SecurityManager?: ProxyContract;
  ProtocolRegistry?: ProxyContract;
}

// ============================================================================
// Contract Types
// ============================================================================

export interface ProxyContract {
  proxy: string; // Address
  implementation: string; // Address
  admin?: string; // Address (for transparent proxies)
  upgradeHistory?: UpgradeRecord[];
}

export interface DirectContract {
  address: string; // Address
  deploymentTx?: string; // Transaction hash
}

export interface UpgradeRecord {
  timestamp: string; // ISO date-time
  fromImplementation: string; // Address
  toImplementation: string; // Address
  txHash?: string; // Transaction hash
  reason?: string;
}

// ============================================================================
// Configuration Management
// ============================================================================

export interface DeploymentConfiguration {
  governance?: GovernanceConfig;
  protocols?: ProtocolConfigurations;
  security?: SecurityConfig;
}

export interface GovernanceConfig {
  vault?: string; // Address
  timelock?: string; // Address
}

export interface ProtocolConfigurations {
  layerZero?: LayerZeroConfig;
  celer?: CelerConfig;
  hyperlane?: HyperlaneConfig;
}

export interface SecurityConfig {
  pauseGuardians?: string[]; // Addresses
  emergencyDelay?: number; // Seconds
}

// ============================================================================
// Protocol-Specific Configurations
// ============================================================================

export interface LayerZeroConfig {
  endpoint?: string; // Address
  lzChainId?: number;
  dvnConfig?: DVNConfiguration;
  gasLimits?: Record<string, number>; // chainId -> gasLimit
}

export interface DVNConfiguration {
  requiredDVNs?: string[]; // Addresses
  optionalDVNs?: string[]; // Addresses
  threshold?: number;
}

export interface CelerConfig {
  messageBus?: string; // Address
  celerChainId?: number;
  feeConfig?: CelerFeeConfig;
}

export interface CelerFeeConfig {
  baseFeeRate?: number; // Basis points (0-10000)
  minFee?: string; // BigInt as string
  maxFee?: string; // BigInt as string
}

export interface HyperlaneConfig {
  mailbox?: string; // Address
  domainId?: number;
  interchainSecurityModule?: string; // Address
  hook?: string; // Address
}

// ============================================================================
// Network Topology and Routing
// ============================================================================

export interface NetworkTopology {
  connectedChains?: ChainConnection[];
  routingPaths?: Record<string, RoutingConfig>; // chainId -> config
}

export interface ChainConnection {
  chainId: number;
  networkName?: string;
  protocols: Protocol[];
  enabled?: boolean;
  lastHealthCheck?: string; // ISO date-time
}

export interface RoutingConfig {
  preferredProtocol?: Protocol;
  fallbackProtocols?: Protocol[];
  maxTransferAmount?: string; // BigInt as string
}

// ============================================================================
// Verification and Integrity
// ============================================================================

export interface VerificationData {
  implementationHashes?: Record<string, string>; // contractName -> hash
  proxyHashes?: Record<string, string>; // contractName -> hash
  constructorArgs?: Record<string, SerializableValue[]>; // contractName -> args
}

export type SerializableValue = 
  | string 
  | number 
  | boolean 
  | BigIntSerialized;

export interface BigIntSerialized {
  type: 'BigInt';
  value: string; // BigInt as string
}

// ============================================================================
// Performance and Caching
// ============================================================================

export interface PerformanceConfig {
  cacheConfig?: CacheConfiguration;
  indexing?: IndexingConfiguration;
}

export interface CacheConfiguration {
  ttl?: number; // Seconds
  maxSize?: number; // Number of entries
}

export interface IndexingConfiguration {
  contractsByName?: Record<string, string>; // contractName -> address
  contractsByProtocol?: ProtocolIndexing;
}

export interface ProtocolIndexing {
  layerZero?: string[]; // Contract addresses
  celer?: string[]; // Contract addresses
  hyperlane?: string[]; // Contract addresses
}

// ============================================================================
// Legacy Compatibility
// ============================================================================

export interface LegacyCompatibility {
  v1Compatible?: LegacyV1Format;
}

export interface LegacyV1Format {
  deployer?: string;
  timestamp?: string;
  contracts?: LegacyContracts;
  config?: LegacyConfig;
  implementationHashes?: Record<string, string>;
}

export interface LegacyContracts {
  LookCoin?: LegacyContractEntry;
  CelerIMModule?: LegacyContractEntry;
  SupplyOracle?: LegacyContractEntry;
}

export interface LegacyContractEntry {
  proxy?: string;
  implementation?: string;
}

export interface LegacyConfig {
  layerZeroEndpoint?: string;
  celerMessageBus?: string;
  governanceVault?: string;
}

// ============================================================================
// Utility Types and Enums
// ============================================================================

export type ContractName = 
  // Core contracts
  | 'LookCoin'
  | 'SupplyOracle'
  // Protocol contracts
  | 'LayerZeroModule'
  | 'CelerIMModule'
  | 'HyperlaneModule'
  // Infrastructure contracts
  | 'CrossChainRouter'
  | 'FeeManager'
  | 'SecurityManager'
  | 'ProtocolRegistry';

export type ContractCategory = 'core' | 'protocol' | 'infrastructure';

export interface ContractReference {
  name: ContractName;
  category: ContractCategory;
  address: string;
  isProxy: boolean;
}

// ============================================================================
// Validation and Type Guards
// ============================================================================

export function isProxyContract(contract: ProxyContract | DirectContract): contract is ProxyContract {
  return 'proxy' in contract && 'implementation' in contract;
}

export function isDirectContract(contract: ProxyContract | DirectContract): contract is DirectContract {
  return 'address' in contract && !('proxy' in contract);
}

export function isBigIntSerialized(value: SerializableValue): value is BigIntSerialized {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'BigInt';
}

export function isEnhancedDeployment(data: any): data is EnhancedDeployment {
  return (
    typeof data === 'object' &&
    data !== null &&
    data.schemaVersion === '2.0.0' &&
    typeof data.network === 'string' &&
    typeof data.chainId === 'number' &&
    typeof data.metadata === 'object' &&
    typeof data.contracts === 'object'
  );
}

// ============================================================================
// Contract Organization Helpers
// ============================================================================

export interface ContractsByCategory {
  core: Array<{ name: keyof CoreContracts; contract: ProxyContract }>;
  protocol: Array<{ name: keyof ProtocolContracts; contract: ProxyContract | DirectContract }>;
  infrastructure: Array<{ name: keyof InfrastructureContracts; contract: ProxyContract }>;
}

export function organizeContractsByCategory(contracts: ContractRegistry): ContractsByCategory {
  const result: ContractsByCategory = {
    core: [],
    protocol: [],
    infrastructure: []
  };

  // Core contracts
  Object.entries(contracts.core).forEach(([name, contract]) => {
    result.core.push({ 
      name: name as keyof CoreContracts, 
      contract: contract as ProxyContract 
    });
  });

  // Protocol contracts
  if (contracts.protocol) {
    Object.entries(contracts.protocol).forEach(([name, contract]) => {
      if (contract) {
        result.protocol.push({ 
          name: name as keyof ProtocolContracts, 
          contract 
        });
      }
    });
  }

  // Infrastructure contracts
  if (contracts.infrastructure) {
    Object.entries(contracts.infrastructure).forEach(([name, contract]) => {
      if (contract) {
        result.infrastructure.push({ 
          name: name as keyof InfrastructureContracts, 
          contract: contract as ProxyContract 
        });
      }
    });
  }

  return result;
}

// ============================================================================
// Migration and Compatibility Types
// ============================================================================

export interface DeploymentMigrator {
  canMigrate(data: any): boolean;
  migrate(data: any): EnhancedDeployment;
  validate(deployment: EnhancedDeployment): boolean;
}

export interface MigrationResult {
  success: boolean;
  deployment?: EnhancedDeployment;
  errors?: string[];
  warnings?: string[];
}

// ============================================================================
// Export Collections for Convenience
// ============================================================================

export * from './enhanced-deployment';

// Re-export commonly used types
export type {
  EnhancedDeployment as Deployment,
  ContractRegistry as Contracts,
  DeploymentMetadata as Metadata,
  ProtocolConfigurations as ProtocolConfig
};