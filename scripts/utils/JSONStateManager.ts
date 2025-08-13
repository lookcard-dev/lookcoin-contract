/**
 * JSONStateManager Implementation
 * 
 * File-based storage implementation matching enhanced JSON schema with atomic operations,
 * memory caching, and support for complex queries. Designed for seamless migration from LevelDB.
 * 
 * Key Features:
 * - Atomic write operations for data consistency
 * - In-memory caching for performance optimization
 * - Support for the enhanced JSON schema with infrastructure contracts
 * - Network-aware operations matching LevelDB behavior
 * - BigInt serialization/deserialization
 * - Backup and rollback mechanisms
 */

import * as fs from 'fs/promises';
import * as path from 'path';
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

interface JSONDeployment {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  deploymentMode?: "standard" | "multi-protocol";
  protocolsDeployed?: string[];
  contracts: {
    [contractName: string]: {
      proxy: string;
      implementation?: string;
    };
  };
  protocolContracts?: {
    layerZeroModule?: string;
    celerIMModule?: string;
    hyperlaneModule?: string;
  };
  infrastructureContracts?: {
    crossChainRouter?: string;
    feeManager?: string;
    securityManager?: string;
    protocolRegistry?: string;
  };
  config?: {
    governanceVault?: string;
    layerZeroEndpoint?: string;
    celerMessageBus?: string;
    hyperlaneMailbox?: string;
  };
  implementationHashes?: {
    [contractName: string]: string;
  };
  lastDeployed?: string;
  lastUpgraded?: string;
}

interface CacheEntry {
  data: ContractType;
  timestamp: number;
  accessed: number;
}

export class JSONStateManager implements IStateManager {
  private basePath: string;
  private cache: Map<string, CacheEntry> = new Map();
  private config: StateManagerConfig;
  private isInitialized = false;
  private fileWatchers = new Map<string, unknown>();
  private metrics: BackendMetrics = {
    readLatency: 0,
    writeLatency: 0,
    queryLatency: 0,
    errorRate: 0,
    cacheHitRate: 0
  };

  // Cache statistics
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
      ...config
    };
    this.basePath = this.config.jsonPath!;
  }

  /**
   * Initialize the JSON storage system
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Ensure base directory exists
      await fs.mkdir(this.basePath, { recursive: true });

      // Initialize cache if enabled
      if (this.config.enableCache) {
        await this.warmupCache();
      }

      this.isInitialized = true;
      
      if (this.config.debugMode) {
        console.log(`[DEBUG] JSONStateManager initialized at: ${this.basePath}`);
        console.log(`[DEBUG] Cache enabled: ${this.config.enableCache}, size: ${this.config.cacheSize}`);
      }
    } catch (error) {
      throw new StateManagerError(
        StateManagerErrorCode.BACKEND_UNAVAILABLE,
        `Failed to initialize JSON storage: ${error instanceof Error ? error.message : String(error)}`,
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

      // Clear cache
      this.cache.clear();
      this.isInitialized = false;
      
      if (this.config.debugMode) {
        console.log(`[DEBUG] JSONStateManager closed`);
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error(`[DEBUG] Error closing JSONStateManager:`, error);
      }
    }
  }

  /**
   * Retrieve contract by chainId and name
   */
  async getContract(chainId: number, contractName: string): Promise<ContractType | null> {
    await this.ensureInitialized();
    const startTime = Date.now();
    const cacheKey = this.generateKey(chainId, contractName);

    try {
      // Check cache first
      if (this.config.enableCache && this.cache.has(cacheKey)) {
        const entry = this.cache.get(cacheKey)!;
        entry.accessed = Date.now();
        this.cacheStats.hits++;
        this.updateCacheHitRate();
        
        if (this.config.debugMode) {
          console.log(`[DEBUG] Cache hit for ${contractName} on chain ${chainId}`);
        }
        
        this.updateReadMetrics(Date.now() - startTime, false);
        return { ...entry.data }; // Return copy to prevent mutation
      }

      this.cacheStats.misses++;
      this.updateCacheHitRate();

      // Load from JSON file
      const deployment = await this.loadDeployment(chainId);
      if (!deployment) {
        if (this.config.debugMode) {
          console.log(`[DEBUG] No deployment file found for chain ${chainId}`);
        }
        this.updateReadMetrics(Date.now() - startTime, false);
        return null;
      }

      const contract = await this.extractContractFromDeployment(deployment, contractName);
      if (!contract) {
        if (this.config.debugMode) {
          console.log(`[DEBUG] ${contractName} not found in deployment for chain ${chainId}`);
        }
        this.updateReadMetrics(Date.now() - startTime, false);
        return null;
      }

      // Update cache
      if (this.config.enableCache) {
        await this.updateCache(cacheKey, contract);
      }

      if (this.config.debugMode) {
        console.log(`[DEBUG] Retrieved ${contractName} from JSON for chain ${chainId}`);
      }

      this.updateReadMetrics(Date.now() - startTime, false);
      return contract;
    } catch (error) {
      this.updateReadMetrics(Date.now() - startTime, true);
      throw new StateManagerError(
        StateManagerErrorCode.BACKEND_UNAVAILABLE,
        `Failed to retrieve contract ${contractName} for chain ${chainId}`,
        { chainId, contractName, error }
      );
    }
  }

  /**
   * Store or update contract
   */
  async putContract(chainId: number, contract: ContractType): Promise<void> {
    await this.ensureInitialized();
    const startTime = Date.now();
    const cacheKey = this.generateKey(chainId, contract.contractName);

    // Validate contract data
    if (this.config.validateOnWrite && !this.validateContractType(contract)) {
      throw new StateManagerError(
        StateManagerErrorCode.VALIDATION_FAILED,
        `Invalid contract data for ${(contract as ContractType).contractName}`,
        { chainId, contract }
      );
    }

    try {
      // Load existing deployment or create new
      let deployment = await this.loadDeployment(chainId);
      if (!deployment) {
        deployment = await this.createNewDeployment(chainId, contract);
      }

      // Update contract in deployment
      deployment = await this.updateContractInDeployment(deployment, contract);

      // Atomic write
      if (this.config.atomicWrites) {
        await this.atomicWriteDeployment(chainId, deployment);
      } else {
        await this.writeDeployment(chainId, deployment);
      }

      // Update cache
      if (this.config.enableCache) {
        await this.updateCache(cacheKey, contract);
      }

      if (this.config.debugMode) {
        console.log(`[DEBUG] Stored ${contract.contractName} to JSON for chain ${chainId}`);
        console.log(`[DEBUG]   - Implementation hash: ${contract.implementationHash}`);
      }

      this.updateWriteMetrics(Date.now() - startTime, false);
    } catch (error) {
      this.updateWriteMetrics(Date.now() - startTime, true);
      throw new StateManagerError(
        StateManagerErrorCode.WRITE_FAILED,
        `Failed to store contract ${contract.contractName} for chain ${chainId}`,
        { chainId, contract, error }
      );
    }
  }

  /**
   * Get all contracts for a specific chain
   */
  async getAllContracts(chainId: number): Promise<ContractType[]> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      const deployment = await this.loadDeployment(chainId);
      if (!deployment) {
        this.updateQueryMetrics(Date.now() - startTime, false);
        return [];
      }

      const contracts = await this.extractAllContractsFromDeployment(deployment);
      this.updateQueryMetrics(Date.now() - startTime, false);
      return contracts;
    } catch (error) {
      this.updateQueryMetrics(Date.now() - startTime, true);
      throw new StateManagerError(
        StateManagerErrorCode.BACKEND_UNAVAILABLE,
        `Failed to retrieve contracts for chain ${chainId}`,
        { chainId, error }
      );
    }
  }

  /**
   * Advanced query with filtering and sorting
   */
  async queryContracts(options: QueryOptions): Promise<ContractType[]> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      let contracts: ContractType[] = [];

      if (options.chainId) {
        contracts = await this.getAllContracts(options.chainId);
      } else {
        // Get contracts from all chain files
        const chainIds = await this.getAllChainIds();
        for (const chainId of chainIds) {
          const chainContracts = await this.getAllContracts(chainId);
          contracts.push(...chainContracts);
        }
      }

      // Apply filters
      let filtered = contracts;

      if (options.contractName) {
        filtered = filtered.filter(c => c.contractName === options.contractName);
      }

      if (options.networkName) {
        filtered = filtered.filter(c => c.networkName === options.networkName);
      }

      // Apply sorting
      if (options.sortBy) {
        filtered.sort((a, b) => {
          let aVal: string | number | undefined, bVal: string | number | undefined;
          
          switch (options.sortBy) {
            case 'timestamp':
              aVal = a.timestamp;
              bVal = b.timestamp;
              break;
            case 'contractName':
              aVal = a.contractName;
              bVal = b.contractName;
              break;
            case 'chainId':
              aVal = a.chainId;
              bVal = b.chainId;
              break;
            default:
              return 0;
          }

          const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
          return options.sortOrder === 'desc' ? -comparison : comparison;
        });
      }

      this.updateQueryMetrics(Date.now() - startTime, false);
      return filtered;
    } catch (error) {
      this.updateQueryMetrics(Date.now() - startTime, true);
      throw new StateManagerError(
        StateManagerErrorCode.BACKEND_UNAVAILABLE,
        `Failed to query contracts`,
        { options, error }
      );
    }
  }

  /**
   * Export all data
   */
  async exportAll(options: ExportOptions): Promise<string> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      const allContracts: Record<string, ContractType> = {};
      const chainIds = await this.getAllChainIds();

      for (const chainId of chainIds) {
        // Apply chain filter if specified
        if (options.chainIds && !options.chainIds.includes(chainId)) {
          continue;
        }

        const contracts = await this.getAllContracts(chainId);
        for (const contract of contracts) {
          const key = this.generateKey(chainId, contract.contractName);
          allContracts[key] = contract;
        }
      }

      const exportData = {
        format: options.format,
        exportTime: new Date().toISOString(),
        totalContracts: Object.keys(allContracts).length,
        ...(options.includeMetadata && {
          metadata: {
            backendType: this.getBackendType(),
            basePath: this.basePath,
            metrics: await this.getMetrics(),
            cacheStats: this.cacheStats
          }
        }),
        contracts: allContracts
      };

      const result = JSON.stringify(exportData, null, options.prettyPrint ? 2 : 0);
      this.updateQueryMetrics(Date.now() - startTime, false);
      return result;
    } catch (error) {
      this.updateQueryMetrics(Date.now() - startTime, true);
      throw new StateManagerError(
        StateManagerErrorCode.BACKEND_UNAVAILABLE,
        `Failed to export data`,
        { options, error }
      );
    }
  }

  /**
   * Import data from external source
   */
  async importAll(data: string, overwrite: boolean = false): Promise<void> {
    await this.ensureInitialized();

    try {
      const importData = JSON.parse(data);
      
      if (!importData.contracts) {
        throw new StateManagerError(
          StateManagerErrorCode.VALIDATION_FAILED,
          'Invalid import data: missing contracts field',
          { data: data.substring(0, 100) }
        );
      }

      const contracts = importData.contracts;
      let imported = 0;
      let skipped = 0;

      for (const [key, contract] of Object.entries(contracts)) {
        const { chainId, contractName } = this.parseKey(key);
        
        if (!overwrite && await this.hasContract(chainId, contractName)) {
          skipped++;
          continue;
        }

        await this.putContract(chainId, contract as ContractType);
        imported++;
      }

      if (this.config.debugMode) {
        console.log(`[DEBUG] Import completed: ${imported} imported, ${skipped} skipped`);
      }
    } catch (error) {
      if (error instanceof StateManagerError) {
        throw error;
      }
      throw new StateManagerError(
        StateManagerErrorCode.VALIDATION_FAILED,
        `Failed to import data: ${error instanceof Error ? error.message : String(error)}`,
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
    await this.ensureInitialized();
    const errors: string[] = [];
    const warnings: string[] = [];
    let contractCount = 0;

    try {
      const chainIds = await this.getAllChainIds();

      for (const chainId of chainIds) {
        const deployment = await this.loadDeployment(chainId);
        if (!deployment) {
          warnings.push(`No deployment file for chain ${chainId}`);
          continue;
        }

        const contracts = await this.extractAllContractsFromDeployment(deployment);
        contractCount += contracts.length;

        for (const contract of contracts) {
          // Validate contract data
          if (!this.validateContractType(contract)) {
            errors.push(`Invalid contract data: ${(contract as ContractType).contractName} on chain ${chainId}`);
            continue;
          }

          // Check for missing required fields
          if (!contract.address || !contract.factoryByteCodeHash) {
            warnings.push(`Missing fields in contract: ${contract.contractName} on chain ${chainId}`);
          }

          // Validate chainId consistency
          if (contract.chainId !== chainId) {
            errors.push(`ChainId mismatch for ${contract.contractName}: ${contract.chainId} vs ${chainId}`);
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
      return {
        isValid: false,
        errors: [`Validation failed: ${error instanceof Error ? error.message : String(error)}`],
        warnings,
        contractCount: 0,
        lastValidated: Date.now()
      };
    }
  }

  /**
   * Get performance metrics
   */
  async getMetrics(): Promise<BackendMetrics> {
    return { 
      ...this.metrics,
      cacheHitRate: this.cacheStats.hits + this.cacheStats.misses === 0 ? 0 : 
        this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses)
    };
  }

  /**
   * Check if contract exists
   */
  async hasContract(chainId: number, contractName: string): Promise<boolean> {
    const contract = await this.getContract(chainId, contractName);
    return contract !== null;
  }

  /**
   * Delete a contract
   */
  async deleteContract(chainId: number, contractName: string): Promise<boolean> {
    await this.ensureInitialized();

    try {
      const deployment = await this.loadDeployment(chainId);
      if (!deployment) {
        return false;
      }

      let found = false;

      // Remove from main contracts
      if (deployment.contracts[contractName]) {
        delete deployment.contracts[contractName];
        found = true;
      }

      // Remove from implementation hashes
      if (deployment.implementationHashes?.[contractName]) {
        delete deployment.implementationHashes[contractName];
      }

      if (!found) {
        return false;
      }

      // Write updated deployment
      if (this.config.atomicWrites) {
        await this.atomicWriteDeployment(chainId, deployment);
      } else {
        await this.writeDeployment(chainId, deployment);
      }

      // Remove from cache
      const cacheKey = this.generateKey(chainId, contractName);
      this.cache.delete(cacheKey);

      return true;
    } catch (error) {
      throw new StateManagerError(
        StateManagerErrorCode.WRITE_FAILED,
        `Failed to delete contract ${contractName} for chain ${chainId}`,
        { chainId, contractName, error }
      );
    }
  }

  /**
   * Get backend type
   */
  getBackendType(): string {
    return 'json';
  }

  /**
   * Check backend health
   */
  async isHealthy(): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        return false;
      }
      
      // Check if base directory is accessible
      await fs.access(this.basePath);
      
      return true;
    } catch {
      return false;
    }
  }

  // Private utility methods

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  private generateKey(chainId: number, contractName: string): string {
    return `${chainId}-${contractName}`;
  }

  private parseKey(key: string): { chainId: number; contractName: string } {
    const parts = key.split('-');
    if (parts.length < 2) {
      throw new StateManagerError(
        StateManagerErrorCode.VALIDATION_FAILED,
        `Invalid key format: ${key}`,
        { key }
      );
    }
    return {
      chainId: parseInt(parts[0], 10),
      contractName: parts.slice(1).join('-')
    };
  }

  private validateContractType(obj: unknown): obj is ContractType {
    return (
      obj !== null &&
      typeof obj === 'object' &&
      'contractName' in obj &&
      'chainId' in obj &&
      'networkName' in obj &&
      'address' in obj &&
      'factoryByteCodeHash' in obj &&
      'timestamp' in obj &&
      typeof (obj as Record<string, unknown>).contractName === 'string' &&
      typeof (obj as Record<string, unknown>).chainId === 'number' &&
      typeof (obj as Record<string, unknown>).networkName === 'string' &&
      typeof (obj as Record<string, unknown>).address === 'string' &&
      typeof (obj as Record<string, unknown>).factoryByteCodeHash === 'string' &&
      typeof (obj as Record<string, unknown>).timestamp === 'number'
    );
  }

  private getFilePath(chainId: number): string {
    const networkName = this.getNetworkName(chainId);
    return path.join(this.basePath, `${networkName}.json`);
  }

  private getNetworkName(chainId: number): string {
    const networkMap: Record<number, string> = {
      56: 'bscmainnet',
      97: 'bsctestnet',
      84532: 'basesepolia',
      11155420: 'optimismsepolia',
      23295: 'sapphiremainnet',
      23294: 'sapphiretestnet',
      8453: 'basemainnet',
      10: 'optimismmainnet'
    };
    return networkMap[chainId] || `chain${chainId}`;
  }

  private async loadDeployment(chainId: number): Promise<JSONDeployment | null> {
    const filePath = this.getFilePath(chainId);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const deployment = JSON.parse(content);
      return this.deserializeBigInt(deployment) as JSONDeployment;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async writeDeployment(chainId: number, deployment: JSONDeployment): Promise<void> {
    const filePath = this.getFilePath(chainId);
    const serialized = this.serializeBigInt(deployment);
    const content = JSON.stringify(serialized, null, this.config.prettyPrint ? 2 : 0);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  private async atomicWriteDeployment(chainId: number, deployment: JSONDeployment): Promise<void> {
    const filePath = this.getFilePath(chainId);
    const tempPath = `${filePath}.tmp`;
    const backupPath = `${filePath}.backup`;

    try {
      // Create backup if file exists
      if (this.config.backupEnabled) {
        try {
          await fs.access(filePath);
          await fs.copyFile(filePath, backupPath);
        } catch {
          // File doesn't exist, no backup needed
        }
      }

      // Write to temporary file
      const serialized = this.serializeBigInt(deployment);
      const content = JSON.stringify(serialized, null, this.config.prettyPrint ? 2 : 0);
      await fs.writeFile(tempPath, content, 'utf-8');

      // Atomic move
      await fs.rename(tempPath, filePath);

      // Clean up backup if successful
      if (this.config.backupEnabled) {
        try {
          await fs.unlink(backupPath);
        } catch {
          // Backup cleanup failed, but main operation succeeded
        }
      }
    } catch (error) {
      // Clean up temp file
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }

      // Restore from backup if available
      if (this.config.backupEnabled) {
        try {
          await fs.access(backupPath);
          await fs.rename(backupPath, filePath);
        } catch {
          // Backup restore failed
        }
      }

      throw error;
    }
  }

  private async createNewDeployment(chainId: number, contract: ContractType): Promise<JSONDeployment> {
    return {
      network: contract.networkName,
      chainId,
      deployer: "0x0000000000000000000000000000000000000000", // Will be updated
      timestamp: new Date().toISOString(),
      deploymentMode: "standard",
      protocolsDeployed: [],
      contracts: {},
      config: {},
      implementationHashes: {},
      lastDeployed: new Date().toISOString()
    };
  }

  private async updateContractInDeployment(deployment: JSONDeployment, contract: ContractType): Promise<JSONDeployment> {
    // Update basic contract info
    deployment.contracts[contract.contractName] = {
      proxy: contract.proxyAddress || contract.address,
      implementation: contract.address
    };

    // Update implementation hash
    if (!deployment.implementationHashes) {
      deployment.implementationHashes = {};
    }
    deployment.implementationHashes[contract.contractName] = contract.factoryByteCodeHash;

    // Update timestamps
    deployment.lastUpgraded = new Date().toISOString();

    return deployment;
  }

  private async extractContractFromDeployment(deployment: JSONDeployment, contractName: string): Promise<ContractType | null> {
    const contractInfo = deployment.contracts[contractName];
    if (!contractInfo) {
      return null;
    }

    return {
      contractName,
      chainId: deployment.chainId,
      networkName: deployment.network,
      address: contractInfo.implementation || contractInfo.proxy,
      factoryByteCodeHash: deployment.implementationHashes?.[contractName] || '',
      implementationHash: deployment.implementationHashes?.[contractName],
      proxyAddress: contractInfo.proxy !== contractInfo.implementation ? contractInfo.proxy : undefined,
      deploymentArgs: [], // Not stored in JSON format
      timestamp: new Date(deployment.lastDeployed || deployment.timestamp).getTime()
    };
  }

  private async extractAllContractsFromDeployment(deployment: JSONDeployment): Promise<ContractType[]> {
    const contracts: ContractType[] = [];

    for (const contractName of Object.keys(deployment.contracts)) {
      const contract = await this.extractContractFromDeployment(deployment, contractName);
      if (contract) {
        contracts.push(contract);
      }
    }

    return contracts;
  }

  private async getAllChainIds(): Promise<number[]> {
    try {
      const files = await fs.readdir(this.basePath);
      const chainIds: number[] = [];

      for (const file of files) {
        if (file.endsWith('.json') && !file.startsWith('config-')) {
          const filePath = path.join(this.basePath, file);
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const deployment = JSON.parse(content);
            if (deployment.chainId) {
              chainIds.push(deployment.chainId);
            }
          } catch {
            // Skip invalid files
          }
        }
      }

      return chainIds;
    } catch {
      return [];
    }
  }

  private async warmupCache(): Promise<void> {
    if (!this.config.enableCache) {
      return;
    }

    try {
      const chainIds = await this.getAllChainIds();
      for (const chainId of chainIds) {
        const contracts = await this.getAllContracts(chainId);
        for (const contract of contracts) {
          const key = this.generateKey(chainId, contract.contractName);
          await this.updateCache(key, contract);
        }
      }

      if (this.config.debugMode) {
        console.log(`[DEBUG] Cache warmed up with ${this.cache.size} contracts`);
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.warn(`[DEBUG] Cache warmup failed:`, error);
      }
    }
  }

  private async updateCache(key: string, contract: ContractType): Promise<void> {
    if (!this.config.enableCache) {
      return;
    }

    // Evict old entries if cache is full
    if (this.cache.size >= this.config.cacheSize!) {
      await this.evictOldestCacheEntry();
    }

    this.cache.set(key, {
      data: { ...contract },
      timestamp: Date.now(),
      accessed: Date.now()
    });
  }

  private async evictOldestCacheEntry(): Promise<void> {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (entry.accessed < oldestTime) {
        oldestTime = entry.accessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.cacheStats.evictions++;
    }
  }

  private updateCacheHitRate(): void {
    this.metrics.cacheHitRate = this.cacheStats.hits + this.cacheStats.misses === 0 ? 0 : 
      this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses);
  }

  private serializeBigInt(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map(item => this.serializeBigInt(item));
    }
    
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.serializeBigInt(value);
      }
      return result;
    }
    
    return typeof obj === 'bigint' ? obj.toString() : obj;
  }

  private deserializeBigInt(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map(item => this.deserializeBigInt(item));
    }
    
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.deserializeBigInt(value);
      }
      return result;
    }
    
    // For JSON backend, we could implement smart BigInt detection and restoration
    // For now, maintain strings to preserve precision
    return obj;
  }

  private updateReadMetrics(latency: number, hasError: boolean): void {
    this.metrics.readLatency = (this.metrics.readLatency + latency) / 2;
    if (hasError) {
      this.metrics.errorRate = Math.min(1, this.metrics.errorRate + 0.01);
    } else {
      this.metrics.errorRate = Math.max(0, this.metrics.errorRate - 0.001);
    }
  }

  private updateWriteMetrics(latency: number, hasError: boolean): void {
    this.metrics.writeLatency = (this.metrics.writeLatency + latency) / 2;
    if (hasError) {
      this.metrics.errorRate = Math.min(1, this.metrics.errorRate + 0.01);
    } else {
      this.metrics.errorRate = Math.max(0, this.metrics.errorRate - 0.001);
    }
  }

  private updateQueryMetrics(latency: number, hasError: boolean): void {
    this.metrics.queryLatency = (this.metrics.queryLatency + latency) / 2;
    if (hasError) {
      this.metrics.errorRate = Math.min(1, this.metrics.errorRate + 0.01);
    } else {
      this.metrics.errorRate = Math.max(0, this.metrics.errorRate - 0.001);
    }
  }
}