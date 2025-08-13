/**
 * IStateManager Interface - State Management Abstraction Layer
 * 
 * This interface provides a unified abstraction layer enabling seamless switching
 * between LevelDB and JSON storage backends while maintaining 100% backward compatibility.
 * 
 * Design Principles:
 * - Zero behavioral changes to existing deployments
 * - Support for all current LevelDB operations
 * - Network-aware operations (chainId-based)
 * - BigInt serialization support
 * - Async/await patterns with proper error handling
 * 
 * Critical Production Requirement:
 * - No contract redeployments allowed - interface must maintain existing behavior
 */

export interface ContractType {
  contractName: string;
  chainId: number;
  networkName: string;
  address: string;
  factoryByteCodeHash: string;
  implementationHash?: string;
  proxyAddress?: string;
  deploymentArgs?: unknown[];
  timestamp: number;
}

/**
 * Query options for complex filtering operations
 */
export interface QueryOptions {
  chainId?: number;
  contractName?: string;
  networkName?: string;
  includeInfrastructure?: boolean;
  sortBy?: 'timestamp' | 'contractName' | 'chainId';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Export format options for data migration
 */
export interface ExportOptions {
  format: 'leveldb' | 'json';
  chainIds?: number[];
  includeMetadata?: boolean;
  prettyPrint?: boolean;
}

/**
 * Migration status for backend transitions
 */
export interface MigrationStatus {
  isActive: boolean;
  sourceBackend: string;
  targetBackend: string;
  progress: number;
  errors: string[];
  startTime?: number;
  endTime?: number;
}

/**
 * Backend performance metrics
 */
export interface BackendMetrics {
  readLatency: number;
  writeLatency: number;
  queryLatency: number;
  errorRate: number;
  cacheHitRate?: number;
}

/**
 * State Manager Error Types
 */
export enum StateManagerErrorCode {
  NOT_FOUND = 'STATE_NOT_FOUND',
  WRITE_FAILED = 'STATE_WRITE_FAILED',
  BACKEND_UNAVAILABLE = 'BACKEND_UNAVAILABLE',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  MIGRATION_FAILED = 'MIGRATION_FAILED',
  LOCK_TIMEOUT = 'LOCK_TIMEOUT',
  SERIALIZATION_FAILED = 'SERIALIZATION_FAILED'
}

export class StateManagerError extends Error {
  constructor(
    public code: StateManagerErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'StateManagerError';
  }
}

/**
 * Main State Manager Interface
 * 
 * Provides unified access to contract state regardless of underlying storage backend.
 * All implementations must maintain the exact same behavior as the current LevelDB system.
 */
export interface IStateManager {
  /**
   * Initialize the state manager and underlying storage
   * Must be idempotent - safe to call multiple times
   */
  initialize(): Promise<void>;

  /**
   * Gracefully shutdown the state manager and release resources
   */
  close(): Promise<void>;

  /**
   * Retrieve a specific contract by chainId and name
   * Returns null if contract not found (matches current LevelDB behavior)
   * 
   * @param chainId - Network chain ID
   * @param contractName - Contract name (e.g., 'LookCoin', 'SupplyOracle')
   * @throws StateManagerError on storage errors
   */
  getContract(chainId: number, contractName: string): Promise<ContractType | null>;

  /**
   * Store or update a contract entry
   * Handles BigInt serialization automatically
   * 
   * @param chainId - Network chain ID
   * @param contract - Contract data to store
   * @throws StateManagerError on validation or write failures
   */
  putContract(chainId: number, contract: ContractType): Promise<void>;

  /**
   * Retrieve all contracts for a specific chain
   * Returns empty array if no contracts found
   * 
   * @param chainId - Network chain ID
   * @returns Array of contracts for the specified chain
   */
  getAllContracts(chainId: number): Promise<ContractType[]>;

  /**
   * Advanced query interface for complex filtering
   * Supports multiple criteria and sorting options
   * 
   * @param options - Query criteria and options
   * @returns Filtered array of contracts
   */
  queryContracts(options: QueryOptions): Promise<ContractType[]>;

  /**
   * Export all contract data for migration or backup
   * Supports multiple export formats
   * 
   * @param options - Export format and filtering options
   * @returns Serialized contract data
   */
  exportAll(options: ExportOptions): Promise<string>;

  /**
   * Import contract data from external source
   * Supports validation and conflict resolution
   * 
   * @param data - Serialized contract data
   * @param overwrite - Whether to overwrite existing contracts
   * @throws StateManagerError on validation or import failures
   */
  importAll(data: string, overwrite?: boolean): Promise<void>;

  /**
   * Validate the integrity of stored data
   * Checks for corruption, missing fields, or inconsistencies
   * 
   * @returns Validation report with any issues found
   */
  validateIntegrity(): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
    contractCount: number;
    lastValidated: number;
  }>;

  /**
   * Get performance metrics for the current backend
   * Useful for monitoring and optimization
   */
  getMetrics(): Promise<BackendMetrics>;

  /**
   * Check if a contract exists without retrieving full data
   * More efficient than getContract for existence checks
   * 
   * @param chainId - Network chain ID
   * @param contractName - Contract name to check
   */
  hasContract(chainId: number, contractName: string): Promise<boolean>;

  /**
   * Delete a specific contract entry
   * Use with extreme caution - primarily for testing and cleanup
   * 
   * @param chainId - Network chain ID
   * @param contractName - Contract name to delete
   */
  deleteContract(chainId: number, contractName: string): Promise<boolean>;

  /**
   * Get the backend type identifier
   * Returns 'leveldb' or 'json' for current implementation
   */
  getBackendType(): string;

  /**
   * Check if the backend is healthy and operational
   * Used for health checks and monitoring
   */
  isHealthy(): Promise<boolean>;
}

/**
 * Factory Interface for creating state manager instances
 * Supports configuration and backend selection
 */
export interface IStateManagerFactory {
  /**
   * Create a state manager instance for specified backend
   * 
   * @param backend - Backend type ('leveldb' | 'json')
   * @param config - Backend-specific configuration
   * @returns Configured state manager instance
   */
  createStateManager(
    backend: 'leveldb' | 'json',
    config?: StateManagerConfig
  ): Promise<IStateManager>;

  /**
   * Create a migration-enabled state manager
   * Supports dual-write during transitions
   * 
   * @param sourceBackend - Current backend type
   * @param targetBackend - Target backend type
   * @param config - Migration configuration
   * @returns Migration-capable state manager
   */
  createMigrationManager(
    sourceBackend: 'leveldb' | 'json',
    targetBackend: 'leveldb' | 'json',
    config?: MigrationConfig
  ): Promise<IStateManager>;
}

/**
 * Configuration options for state manager implementations
 */
export interface StateManagerConfig {
  // Common options
  debugMode?: boolean;
  validateOnWrite?: boolean;
  backupEnabled?: boolean;

  // LevelDB specific
  dbPath?: string;
  leveldbOptions?: {
    createIfMissing?: boolean;
    errorIfExists?: boolean;
    cacheSize?: number;
    writeBufferSize?: number;
  };

  // JSON specific
  jsonPath?: string;
  enableCache?: boolean;
  cacheSize?: number;
  atomicWrites?: boolean;
  prettyPrint?: boolean;
  backupRetention?: number;
}

/**
 * Migration-specific configuration
 */
export interface MigrationConfig extends StateManagerConfig {
  dualWriteEnabled?: boolean;
  fallbackOnError?: boolean;
  validationEnabled?: boolean;
  progressCallback?: (progress: number) => void;
  batchSize?: number;
  lockTimeout?: number;
}

/**
 * Utility functions for state management operations
 */
export interface StateManagerUtils {
  /**
   * Serialize BigInt values for JSON storage
   * Handles nested objects and arrays
   */
  serializeBigInt(obj: unknown): unknown;

  /**
   * Deserialize BigInt values from JSON storage
   * Restores original BigInt instances
   */
  deserializeBigInt(obj: unknown): unknown;

  /**
   * Generate compound keys for storage
   * Format: "chainId-contractName"
   */
  generateKey(chainId: number, contractName: string): string;

  /**
   * Parse compound keys to extract components
   */
  parseKey(key: string): { chainId: number; contractName: string };

  /**
   * Validate contract data structure
   * Ensures all required fields are present and valid
   */
  validateContractType(contract: unknown): contract is ContractType;

  /**
   * Create backup filename with timestamp
   */
  generateBackupFilename(prefix: string, chainId?: number): string;

  /**
   * Compare two contracts for equality
   * Handles BigInt comparisons correctly
   */
  compareContracts(a: ContractType, b: ContractType): boolean;
}