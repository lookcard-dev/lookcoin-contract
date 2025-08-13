/**
 * UnifiedJSONStateManager Implementation
 * 
 * Enhanced state manager that supports both legacy fragmented JSON files
 * and the new unified schema v3.0.0. Provides seamless migration path with
 * automatic detection and conversion capabilities.
 * 
 * Key Features:
 * - Automatic format detection (legacy vs unified)
 * - Transparent migration from fragmented to unified
 * - Backwards compatibility with existing code
 * - Atomic operations with file locking
 * - Comprehensive caching and performance optimization
 * - Built-in validation and integrity checks
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { 
  IStateManager, 
  ContractType, 
  QueryOptions, 
  ExportOptions,
  BackendMetrics,
  StateManagerError,
  StateManagerErrorCode,
  StateManagerConfig 
} from "./IStateManager";
import {
  UnifiedDeployment,
  ContractInfo,
  isUnifiedDeployment,
  validateUnifiedDeployment
} from '../../schemas/unified-deployment-schema';

// File format detection
type FileFormat = 'unified' | 'standard' | 'enhanced' | 'unknown';

interface FileMetadata {
  format: FileFormat;
  path: string;
  version?: string;
  lastModified?: Date;
}

interface CacheEntry {
  data: UnifiedDeployment | ContractType;
  format: FileFormat;
  timestamp: number;
  accessed: number;
  checksum: string;
}

export class UnifiedJSONStateManager implements IStateManager {
  private basePath: string;
  private unifiedPath: string;
  private cache: Map<string, CacheEntry> = new Map();
  private config: StateManagerConfig;
  private isInitialized = false;
  private fileWatchers = new Map<string, unknown>();
  private fileLocks = new Map<string, Promise<void>>();
  
  // Metrics tracking
  private metrics: BackendMetrics = {
    readLatency: 0,
    writeLatency: 0,
    queryLatency: 0,
    errorRate: 0,
    cacheHitRate: 0
  };
  
  private cacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0
  };

  constructor(config: StateManagerConfig = {}) {
    this.config = {
      debugMode: process.env.DEBUG_DEPLOYMENT === 'true',
      validateOnWrite: true,
      backupEnabled: true,
      jsonPath: path.join(process.cwd(), "deployments"),
      enableCache: true,
      cacheSize: 1000,
      atomicWrites: true,
      prettyPrint: true,
      backupRetention: 5,
      autoMigrate: true, // Automatically migrate to unified format
      ...config
    };
    this.basePath = this.config.jsonPath!;
    this.unifiedPath = path.join(this.basePath, 'unified');
  }

  /**
   * Initialize the state manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Ensure directories exist
      await fs.mkdir(this.basePath, { recursive: true });
      await fs.mkdir(this.unifiedPath, { recursive: true });
      
      // Auto-detect and migrate existing files if needed
      if (this.config.autoMigrate) {
        await this.detectAndMigrate();
      }
      
      // Initialize cache
      if (this.config.enableCache) {
        await this.warmupCache();
      }
      
      this.isInitialized = true;
      
      if (this.config.debugMode) {
        console.log(`[DEBUG] UnifiedJSONStateManager initialized`);
        console.log(`[DEBUG] Base path: ${this.basePath}`);
        console.log(`[DEBUG] Unified path: ${this.unifiedPath}`);
        console.log(`[DEBUG] Auto-migrate: ${this.config.autoMigrate}`);
      }
    } catch (error) {
      throw new StateManagerError(
        StateManagerErrorCode.BACKEND_UNAVAILABLE,
        `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
        { basePath: this.basePath, error }
      );
    }
  }

  /**
   * Close and cleanup resources
   */
  async close(): Promise<void> {
    try {
      // Clear file watchers
      for (const [, watcher] of Array.from(this.fileWatchers)) {
        if (watcher && typeof (watcher as { close?: () => void }).close === 'function') {
          (watcher as { close: () => void }).close();
        }
      }
      this.fileWatchers.clear();
      
      // Wait for pending locks
      await Promise.all(Array.from(this.fileLocks.values()));
      this.fileLocks.clear();
      
      // Clear cache
      this.cache.clear();
      
      this.isInitialized = false;
      
      if (this.config.debugMode) {
        console.log('[DEBUG] UnifiedJSONStateManager closed');
      }
    } catch (error) {
      console.error('Error closing UnifiedJSONStateManager:', error);
    }
  }

  /**
   * Get a specific contract
   */
  async getContract(chainId: number, contractName: string): Promise<ContractType | null> {
    const startTime = Date.now();
    
    try {
      const deployment = await this.loadDeployment(chainId);
      if (!deployment) {
        return null;
      }
      
      // Search in all contract categories
      const contract = this.findContract(deployment, contractName);
      if (!contract) {
        return null;
      }
      
      // Convert to ContractType format
      const result = this.convertToContractType(
        contractName,
        contract,
        deployment
      );
      
      this.metrics.readLatency = Date.now() - startTime;
      return result;
      
    } catch (error) {
      this.metrics.errorRate++;
      throw new StateManagerError(
        StateManagerErrorCode.NOT_FOUND,
        `Failed to get contract ${contractName} on chain ${chainId}`,
        { chainId, contractName, error }
      );
    }
  }

  /**
   * Store or update a contract
   */
  async putContract(chainId: number, contract: ContractType): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Load or create deployment
      let deployment = await this.loadDeployment(chainId);
      if (!deployment) {
        deployment = await this.createEmptyDeployment(chainId, contract.networkName);
      }
      
      // Update contract in deployment
      this.updateContract(deployment, contract);
      
      // Update metadata
      deployment.metadata.lastUpdated = new Date().toISOString();
      deployment.fileVersion = (deployment.fileVersion || 0) + 1;
      
      // Validate if configured
      if (this.config.validateOnWrite) {
        const validation = validateUnifiedDeployment(deployment);
        if (!validation.valid) {
          throw new StateManagerError(
            StateManagerErrorCode.VALIDATION_FAILED,
            `Validation failed: ${validation.errors.join(', ')}`,
            { validation }
          );
        }
      }
      
      // Save deployment
      await this.saveDeployment(chainId, deployment);
      
      this.metrics.writeLatency = Date.now() - startTime;
      
    } catch (error) {
      this.metrics.errorRate++;
      throw new StateManagerError(
        StateManagerErrorCode.WRITE_FAILED,
        `Failed to put contract ${contract.contractName}`,
        { chainId, contract, error }
      );
    }
  }

  /**
   * Get all contracts for a chain
   */
  async getAllContracts(chainId: number): Promise<ContractType[]> {
    const startTime = Date.now();
    
    try {
      const deployment = await this.loadDeployment(chainId);
      if (!deployment) {
        return [];
      }
      
      const contracts: ContractType[] = [];
      
      // Extract from all categories
      if (deployment.contracts.core) {
        Object.entries(deployment.contracts.core).forEach(([name, contract]) => {
          contracts.push(this.convertToContractType(name, contract, deployment));
        });
      }
      
      if (deployment.contracts.protocol) {
        Object.entries(deployment.contracts.protocol).forEach(([name, contract]) => {
          contracts.push(this.convertToContractType(name, contract, deployment));
        });
      }
      
      if (deployment.contracts.infrastructure) {
        Object.entries(deployment.contracts.infrastructure).forEach(([name, contract]) => {
          contracts.push(this.convertToContractType(name, contract, deployment));
        });
      }
      
      this.metrics.readLatency = Date.now() - startTime;
      return contracts;
      
    } catch (error) {
      this.metrics.errorRate++;
      return [];
    }
  }

  /**
   * Query contracts with filters
   */
  async queryContracts(options: QueryOptions): Promise<ContractType[]> {
    const startTime = Date.now();
    
    try {
      let allContracts: ContractType[] = [];
      
      // If specific chainId, load only that
      if (options.chainId) {
        allContracts = await this.getAllContracts(options.chainId);
      } else {
        // Load all chains
        const chainIds = await this.getAllChainIds();
        for (const chainId of chainIds) {
          const contracts = await this.getAllContracts(chainId);
          allContracts.push(...contracts);
        }
      }
      
      // Apply filters
      let filtered = allContracts;
      
      if (options.contractName) {
        filtered = filtered.filter(c => c.contractName === options.contractName);
      }
      
      if (options.networkName) {
        filtered = filtered.filter(c => c.networkName === options.networkName);
      }
      
      // Apply sorting
      if (options.sortBy) {
        filtered.sort((a, b) => {
          const aVal = a[options.sortBy!];
          const bVal = b[options.sortBy!];
          const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
          return options.sortOrder === 'desc' ? -comparison : comparison;
        });
      }
      
      this.metrics.queryLatency = Date.now() - startTime;
      return filtered;
      
    } catch (error) {
      this.metrics.errorRate++;
      return [];
    }
  }

  /**
   * Export all data
   */
  async exportAll(options: ExportOptions): Promise<string> {
    try {
      const chainIds = options.chainIds || await this.getAllChainIds();
      const exportData: Record<string, any> = {};
      
      for (const chainId of chainIds) {
        const deployment = await this.loadDeployment(chainId);
        if (deployment) {
          if (options.format === 'json') {
            exportData[chainId.toString()] = deployment;
          } else {
            // Convert to legacy format if needed
            exportData[chainId.toString()] = await this.getAllContracts(chainId);
          }
        }
      }
      
      return options.prettyPrint 
        ? JSON.stringify(exportData, null, 2)
        : JSON.stringify(exportData);
        
    } catch (error) {
      throw new StateManagerError(
        StateManagerErrorCode.SERIALIZATION_FAILED,
        `Export failed: ${error instanceof Error ? error.message : String(error)}`,
        { error }
      );
    }
  }

  /**
   * Import data
   */
  async importAll(data: string, overwrite = false): Promise<void> {
    try {
      const importData = JSON.parse(data);
      
      for (const [chainIdStr, deployment] of Object.entries(importData)) {
        const chainId = parseInt(chainIdStr);
        
        // Check if it's unified format
        if (isUnifiedDeployment(deployment)) {
          if (overwrite || !(await this.deploymentExists(chainId))) {
            await this.saveDeployment(chainId, deployment as UnifiedDeployment);
          }
        } else {
          // Handle legacy format
          const contracts = deployment as ContractType[];
          for (const contract of contracts) {
            if (overwrite || !(await this.getContract(chainId, contract.contractName))) {
              await this.putContract(chainId, contract);
            }
          }
        }
      }
    } catch (error) {
      throw new StateManagerError(
        StateManagerErrorCode.SERIALIZATION_FAILED,
        `Import failed: ${error instanceof Error ? error.message : String(error)}`,
        { error }
      );
    }
  }

  /**
   * Validate data integrity
   */
  async validateIntegrity(): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
    contractCount: number;
    lastValidated: number;
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let contractCount = 0;
    
    try {
      const chainIds = await this.getAllChainIds();
      
      for (const chainId of chainIds) {
        const deployment = await this.loadDeployment(chainId);
        
        if (!deployment) {
          warnings.push(`No deployment found for chain ${chainId}`);
          continue;
        }
        
        // Validate unified deployment
        const validation = validateUnifiedDeployment(deployment);
        errors.push(...validation.errors);
        warnings.push(...validation.warnings);
        
        // Count contracts
        if (deployment.contracts.core) {
          contractCount += Object.keys(deployment.contracts.core).length;
        }
        if (deployment.contracts.protocol) {
          contractCount += Object.keys(deployment.contracts.protocol).length;
        }
        if (deployment.contracts.infrastructure) {
          contractCount += Object.keys(deployment.contracts.infrastructure).length;
        }
        
        // Verify checksums
        const computedChecksums = {
          contracts: this.computeChecksum(deployment.contracts),
          configuration: this.computeChecksum(deployment.configuration),
          topology: this.computeChecksum(deployment.topology)
        };
        
        const storedChecksums = deployment.verification?.dataIntegrity?.checksums;
        if (storedChecksums) {
          if (storedChecksums.contracts !== computedChecksums.contracts) {
            errors.push(`Checksum mismatch for contracts on chain ${chainId}`);
          }
          if (storedChecksums.configuration !== computedChecksums.configuration) {
            errors.push(`Checksum mismatch for configuration on chain ${chainId}`);
          }
          if (storedChecksums.topology !== computedChecksums.topology) {
            errors.push(`Checksum mismatch for topology on chain ${chainId}`);
          }
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        contractCount,
        lastValidated: Date.now()
      };
      
    } catch (error) {
      errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
      return {
        isValid: false,
        errors,
        warnings,
        contractCount,
        lastValidated: Date.now()
      };
    }
  }

  /**
   * Get performance metrics
   */
  async getMetrics(): Promise<BackendMetrics> {
    this.metrics.cacheHitRate = this.cacheStats.hits / 
      (this.cacheStats.hits + this.cacheStats.misses) || 0;
    
    return { ...this.metrics };
  }

  /**
   * Check if contract exists
   */
  async hasContract(chainId: number, contractName: string): Promise<boolean> {
    const contract = await this.getContract(chainId, contractName);
    return contract !== null;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Detect existing files and migrate if needed
   */
  private async detectAndMigrate(): Promise<void> {
    if (this.config.debugMode) {
      console.log('[DEBUG] Detecting and migrating existing files...');
    }
    
    const files = await fs.readdir(this.basePath);
    const networks = new Set<string>();
    
    // Identify unique networks
    for (const file of files) {
      if (file.endsWith('.json') && !file.includes('unified')) {
        const match = file.match(/^(?:enhanced-|config-)?(.+)\.json$/);
        if (match) {
          networks.add(match[1]);
        }
      }
    }
    
    // Check each network for migration needs
    for (const network of networks) {
      const unifiedPath = path.join(this.unifiedPath, `${network}.unified.json`);
      
      try {
        // Check if unified file already exists
        await fs.access(unifiedPath);
        if (this.config.debugMode) {
          console.log(`[DEBUG] Unified file already exists for ${network}`);
        }
      } catch {
        // Unified file doesn't exist, consider migration
        if (this.config.debugMode) {
          console.log(`[DEBUG] No unified file for ${network}, migration may be needed`);
        }
        
        // Note: Actual migration would be triggered here if autoMigrate is true
        // For now, we'll just log it
      }
    }
  }

  /**
   * Load deployment for a chain
   */
  private async loadDeployment(chainId: number): Promise<UnifiedDeployment | null> {
    // Check cache first
    const cacheKey = `deployment-${chainId}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 60000) { // 1 minute cache
      this.cacheStats.hits++;
      cached.accessed = Date.now();
      return cached.data as UnifiedDeployment;
    }
    
    this.cacheStats.misses++;
    
    // Try to load unified file first
    const network = await this.getNetworkName(chainId);
    if (!network) {
      return null;
    }
    
    const unifiedPath = path.join(this.unifiedPath, `${network}.unified.json`);
    
    try {
      const content = await fs.readFile(unifiedPath, 'utf-8');
      const deployment = JSON.parse(content) as UnifiedDeployment;
      
      if (isUnifiedDeployment(deployment)) {
        // Update cache
        this.updateCache(cacheKey, deployment, 'unified');
        return deployment;
      }
    } catch {
      // Unified file doesn't exist, try legacy formats
    }
    
    // Try to load and convert legacy format
    const legacyDeployment = await this.loadLegacyDeployment(chainId, network);
    if (legacyDeployment) {
      // Update cache
      this.updateCache(cacheKey, legacyDeployment, 'standard');
      
      // Optionally save as unified format
      if (this.config.autoMigrate) {
        await this.saveDeployment(chainId, legacyDeployment);
      }
      
      return legacyDeployment;
    }
    
    return null;
  }

  /**
   * Load and convert legacy deployment
   */
  private async loadLegacyDeployment(chainId: number, network: string): Promise<UnifiedDeployment | null> {
    const standardPath = path.join(this.basePath, `${network}.json`);
    
    try {
      const content = await fs.readFile(standardPath, 'utf-8');
      const standard = JSON.parse(content);
      
      // Convert to unified format
      return this.convertLegacyToUnified(standard, network);
    } catch {
      return null;
    }
  }

  /**
   * Convert legacy format to unified
   */
  private convertLegacyToUnified(legacy: any, network: string): UnifiedDeployment {
    const now = new Date().toISOString();
    
    return {
      schemaVersion: '3.0.0',
      fileVersion: 1,
      network,
      chainId: legacy.chainId,
      networkTier: this.inferNetworkTier(network),
      
      metadata: {
        deployer: legacy.deployer || '0x0',
        deploymentMode: legacy.deploymentMode || 'standard',
        timestamp: legacy.timestamp || now,
        lastUpdated: now,
        protocolsEnabled: legacy.protocolsDeployed || [],
        protocolsDeployed: legacy.protocolsDeployed || [],
        protocolsConfigured: [],
        migrationHistory: [{
          from: 'v1.0.0',
          to: '3.0.0',
          timestamp: now,
          migrator: 'UnifiedJSONStateManager'
        }],
        dataSources: {
          originalFormat: 'json-v1',
          importedFrom: [`${network}.json`],
          consolidatedAt: now
        }
      },
      
      contracts: this.convertLegacyContracts(legacy.contracts),
      
      configuration: {
        governance: {
          vault: legacy.config?.governanceVault || '0x0'
        },
        protocols: {},
        security: {
          pauseEnabled: true,
          emergencyDelay: 86400
        }
      },
      
      topology: {
        connectedChains: [],
        tierValidation: {
          crossTierAllowed: false,
          crossTierDetected: false,
          validatedAt: now
        },
        configurationStatus: {
          lastConfigured: now,
          pendingConfigurations: [],
          failedConfigurations: []
        }
      },
      
      verification: {
        contractVerification: {},
        implementationHashes: legacy.implementationHashes || {},
        dataIntegrity: {
          lastValidated: now,
          checksums: {
            contracts: '',
            configuration: '',
            topology: ''
          }
        }
      },
      
      operations: {
        deploymentHistory: [],
        upgradeHistory: []
      }
    };
  }

  /**
   * Convert legacy contracts structure
   */
  private convertLegacyContracts(contracts: any): any {
    const result: any = {
      core: {},
      protocol: {},
      infrastructure: {}
    };
    
    if (!contracts) return result;
    
    Object.entries(contracts).forEach(([name, contract]: [string, any]) => {
      const cleanName = name.split(':').pop() || name;
      const contractInfo: ContractInfo = {
        proxy: contract.proxy,
        implementation: contract.implementation,
        address: contract.address
      };
      
      if (cleanName === 'LookCoin' || cleanName === 'SupplyOracle') {
        result.core[cleanName] = contractInfo;
      } else if (cleanName.includes('Module')) {
        result.protocol[cleanName] = contractInfo;
      } else {
        result.infrastructure[cleanName] = contractInfo;
      }
    });
    
    // Clean up empty objects
    if (Object.keys(result.protocol).length === 0) delete result.protocol;
    if (Object.keys(result.infrastructure).length === 0) delete result.infrastructure;
    
    return result;
  }

  /**
   * Save deployment to disk
   */
  private async saveDeployment(chainId: number, deployment: UnifiedDeployment): Promise<void> {
    const network = deployment.network;
    const filePath = path.join(this.unifiedPath, `${network}.unified.json`);
    
    // Acquire lock for atomic write
    const lockKey = `lock-${chainId}`;
    if (this.fileLocks.has(lockKey)) {
      await this.fileLocks.get(lockKey);
    }
    
    const lockPromise = this.doAtomicWrite(filePath, deployment);
    this.fileLocks.set(lockKey, lockPromise);
    
    try {
      await lockPromise;
    } finally {
      this.fileLocks.delete(lockKey);
    }
    
    // Update cache
    this.updateCache(`deployment-${chainId}`, deployment, 'unified');
  }

  /**
   * Perform atomic write
   */
  private async doAtomicWrite(filePath: string, data: any): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    
    // Write to temp file
    const content = this.config.prettyPrint 
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
    
    await fs.writeFile(tempPath, content, 'utf-8');
    
    // Create backup if configured
    if (this.config.backupEnabled) {
      await this.createBackup(filePath);
    }
    
    // Atomic rename
    await fs.rename(tempPath, filePath);
  }

  /**
   * Create backup of file
   */
  private async createBackup(filePath: string): Promise<void> {
    try {
      const backupDir = path.join(path.dirname(filePath), 'backups');
      await fs.mkdir(backupDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(
        backupDir,
        `${path.basename(filePath)}.${timestamp}.backup`
      );
      
      await fs.copyFile(filePath, backupPath);
      
      // Clean old backups
      if (this.config.backupRetention) {
        await this.cleanOldBackups(backupDir, this.config.backupRetention);
      }
    } catch {
      // Backup failed, but don't block operation
    }
  }

  /**
   * Clean old backup files
   */
  private async cleanOldBackups(backupDir: string, retention: number): Promise<void> {
    const files = await fs.readdir(backupDir);
    const backups = files
      .filter(f => f.endsWith('.backup'))
      .sort()
      .reverse();
    
    // Keep only the most recent 'retention' backups
    for (let i = retention; i < backups.length; i++) {
      await fs.unlink(path.join(backupDir, backups[i])).catch(() => {});
    }
  }

  /**
   * Find contract in deployment
   */
  private findContract(deployment: UnifiedDeployment, contractName: string): ContractInfo | null {
    // Check core contracts
    if (deployment.contracts.core[contractName as keyof typeof deployment.contracts.core]) {
      return deployment.contracts.core[contractName as keyof typeof deployment.contracts.core];
    }
    
    // Check protocol contracts
    if (deployment.contracts.protocol?.[contractName]) {
      return deployment.contracts.protocol[contractName];
    }
    
    // Check infrastructure contracts
    if (deployment.contracts.infrastructure?.[contractName]) {
      return deployment.contracts.infrastructure[contractName];
    }
    
    // Check legacy names
    if (deployment.contracts.legacy?.[contractName]) {
      const legacy = deployment.contracts.legacy[contractName];
      return this.findContract(deployment, legacy.currentName);
    }
    
    return null;
  }

  /**
   * Update contract in deployment
   */
  private updateContract(deployment: UnifiedDeployment, contract: ContractType): void {
    const contractInfo: ContractInfo = {
      address: contract.address,
      proxy: contract.proxyAddress,
      implementation: contract.implementationHash,
      deployedAt: new Date(contract.timestamp).toISOString()
    };
    
    // Determine category and update
    const name = contract.contractName;
    
    if (name === 'LookCoin' || name === 'SupplyOracle') {
      deployment.contracts.core[name as keyof typeof deployment.contracts.core] = contractInfo;
    } else if (name.includes('Module')) {
      if (!deployment.contracts.protocol) {
        deployment.contracts.protocol = {};
      }
      deployment.contracts.protocol[name] = contractInfo;
    } else {
      if (!deployment.contracts.infrastructure) {
        deployment.contracts.infrastructure = {};
      }
      deployment.contracts.infrastructure[name] = contractInfo;
    }
    
    // Update implementation hashes
    if (contract.implementationHash) {
      deployment.verification.implementationHashes[name] = contract.implementationHash;
    }
    
    // Add to deployment history
    deployment.operations.deploymentHistory.push({
      contractName: name,
      action: 'deployed',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Convert ContractInfo to ContractType
   */
  private convertToContractType(
    name: string,
    contract: ContractInfo,
    deployment: UnifiedDeployment
  ): ContractType {
    return {
      contractName: name,
      chainId: deployment.chainId,
      networkName: deployment.network,
      address: contract.address || contract.proxy || '0x0',
      factoryByteCodeHash: deployment.verification.implementationHashes[name] || '',
      implementationHash: contract.implementation,
      proxyAddress: contract.proxy,
      deploymentArgs: contract.constructor,
      timestamp: contract.deployedAt ? new Date(contract.deployedAt).getTime() : Date.now()
    };
  }

  /**
   * Create empty deployment
   */
  private async createEmptyDeployment(chainId: number, network: string): Promise<UnifiedDeployment> {
    const now = new Date().toISOString();
    
    return {
      schemaVersion: '3.0.0',
      fileVersion: 1,
      network,
      chainId,
      networkTier: this.inferNetworkTier(network),
      
      metadata: {
        deployer: '0x0',
        deploymentMode: 'standard',
        timestamp: now,
        lastUpdated: now,
        protocolsEnabled: [],
        protocolsDeployed: [],
        protocolsConfigured: [],
        migrationHistory: [],
        dataSources: {
          originalFormat: 'unified',
          consolidatedAt: now
        }
      },
      
      contracts: {
        core: {
          LookCoin: {} as ContractInfo,
          SupplyOracle: {} as ContractInfo
        }
      },
      
      configuration: {
        governance: { vault: '0x0' },
        protocols: {},
        security: {
          pauseEnabled: true,
          emergencyDelay: 86400
        }
      },
      
      topology: {
        connectedChains: [],
        tierValidation: {
          crossTierAllowed: false,
          crossTierDetected: false,
          validatedAt: now
        },
        configurationStatus: {
          lastConfigured: now,
          pendingConfigurations: [],
          failedConfigurations: []
        }
      },
      
      verification: {
        contractVerification: {},
        implementationHashes: {},
        dataIntegrity: {
          lastValidated: now,
          checksums: {
            contracts: '',
            configuration: '',
            topology: ''
          }
        }
      },
      
      operations: {
        deploymentHistory: [],
        upgradeHistory: []
      }
    };
  }

  /**
   * Get all chain IDs
   */
  private async getAllChainIds(): Promise<number[]> {
    const chainIds = new Set<number>();
    
    // Check unified directory
    try {
      const unifiedFiles = await fs.readdir(this.unifiedPath);
      for (const file of unifiedFiles) {
        if (file.endsWith('.unified.json')) {
          const content = await fs.readFile(path.join(this.unifiedPath, file), 'utf-8');
          const deployment = JSON.parse(content);
          if (deployment.chainId) {
            chainIds.add(deployment.chainId);
          }
        }
      }
    } catch {
      // Directory might not exist
    }
    
    // Check legacy files
    const legacyFiles = await fs.readdir(this.basePath);
    for (const file of legacyFiles) {
      if (file.endsWith('.json') && !file.includes('unified') && !file.includes('config') && !file.includes('enhanced')) {
        try {
          const content = await fs.readFile(path.join(this.basePath, file), 'utf-8');
          const deployment = JSON.parse(content);
          if (deployment.chainId) {
            chainIds.add(deployment.chainId);
          }
        } catch {
          // Invalid file
        }
      }
    }
    
    return Array.from(chainIds);
  }

  /**
   * Check if deployment exists
   */
  private async deploymentExists(chainId: number): Promise<boolean> {
    const deployment = await this.loadDeployment(chainId);
    return deployment !== null;
  }

  /**
   * Get network name from chain ID
   */
  private async getNetworkName(chainId: number): Promise<string | null> {
    // Try to find from existing files
    const files = await fs.readdir(this.basePath);
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = await fs.readFile(path.join(this.basePath, file), 'utf-8');
          const data = JSON.parse(content);
          if (data.chainId === chainId) {
            return data.network;
          }
        } catch {
          // Continue
        }
      }
    }
    
    // Fallback to known mappings
    const knownNetworks: Record<number, string> = {
      56: 'bscmainnet',
      97: 'bsctestnet',
      84532: 'basesepolia',
      11155420: 'optimismsepolia',
      23295: 'sapphiremainnet',
      23294: 'sapphiretestnet'
    };
    
    return knownNetworks[chainId] || null;
  }

  /**
   * Infer network tier from name
   */
  private inferNetworkTier(network: string): 'mainnet' | 'testnet' | 'dev' {
    if (network.includes('mainnet')) return 'mainnet';
    if (network.includes('testnet') || network.includes('sepolia') || network.includes('goerli')) return 'testnet';
    return 'dev';
  }

  /**
   * Compute checksum for data
   */
  private computeChecksum(data: any): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex').substring(0, 16);
  }

  /**
   * Update cache entry
   */
  private updateCache(key: string, data: any, format: FileFormat): void {
    if (!this.config.enableCache) return;
    
    // Evict old entries if cache is full
    if (this.cache.size >= (this.config.cacheSize || 1000)) {
      const oldestKey = Array.from(this.cache.entries())
        .sort((a, b) => a[1].accessed - b[1].accessed)[0][0];
      this.cache.delete(oldestKey);
      this.cacheStats.evictions++;
    }
    
    this.cache.set(key, {
      data,
      format,
      timestamp: Date.now(),
      accessed: Date.now(),
      checksum: this.computeChecksum(data)
    });
  }

  /**
   * Warm up cache on initialization
   */
  private async warmupCache(): Promise<void> {
    if (this.config.debugMode) {
      console.log('[DEBUG] Warming up cache...');
    }
    
    try {
      const chainIds = await this.getAllChainIds();
      for (const chainId of chainIds.slice(0, 10)) { // Cache first 10 chains
        await this.loadDeployment(chainId);
      }
    } catch {
      // Cache warmup is optional
    }
  }
}

// Export as default for drop-in replacement
export default UnifiedJSONStateManager;