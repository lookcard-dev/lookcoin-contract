/**
 * UnifiedJSONStateManager Implementation - FIXED VERSION
 * 
 * Enhanced state manager that supports both legacy fragmented JSON files
 * and the new unified schema v3.0.0. Provides seamless migration path with
 * automatic detection and conversion capabilities.
 * 
 * FIXES APPLIED:
 * - Correct field mapping between ContractType and ContractInfo
 * - Preserve all required fields including factoryByteCodeHash and deploymentArgs
 * - Store implementation address instead of hash in ContractInfo
 * - Maintain per-contract timestamps
 * - Add proper data validation and recovery
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

// Enhanced ContractInfo to store all required fields
interface ExtendedContractInfo extends ContractInfo {
  // Additional fields to preserve ContractType data
  factoryByteCodeHash?: string;
  implementationHash?: string;
  deploymentArgs?: unknown[];
  timestamp?: number;
}

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
      autoMigrate: true,
      ...config
    };
    this.basePath = this.config.jsonPath!;
    this.unifiedPath = path.join(this.basePath, 'unified');
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await fs.mkdir(this.basePath, { recursive: true });
      await fs.mkdir(this.unifiedPath, { recursive: true });
      
      if (this.config.autoMigrate) {
        await this.detectAndMigrate();
      }
      
      if (this.config.enableCache) {
        await this.warmupCache();
      }
      
      this.isInitialized = true;
      
      if (this.config.debugMode) {
        console.log(`[DEBUG] UnifiedJSONStateManager initialized`);
        console.log(`[DEBUG] Base path: ${this.basePath}`);
        console.log(`[DEBUG] Unified path: ${this.unifiedPath}`);
      }
    } catch (error) {
      throw new StateManagerError(
        StateManagerErrorCode.BACKEND_UNAVAILABLE,
        `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
        { basePath: this.basePath, error }
      );
    }
  }

  async close(): Promise<void> {
    try {
      for (const [, watcher] of Array.from(this.fileWatchers)) {
        if (watcher && typeof (watcher as { close?: () => void }).close === 'function') {
          (watcher as { close: () => void }).close();
        }
      }
      this.fileWatchers.clear();
      
      await Promise.all(Array.from(this.fileLocks.values()));
      this.fileLocks.clear();
      
      this.cache.clear();
      this.isInitialized = false;
      
      if (this.config.debugMode) {
        console.log('[DEBUG] UnifiedJSONStateManager closed');
      }
    } catch (error) {
      console.error('Error closing UnifiedJSONStateManager:', error);
    }
  }

  async getContract(chainId: number, contractName: string): Promise<ContractType | null> {
    const startTime = Date.now();
    
    try {
      const deployment = await this.loadDeployment(chainId);
      if (!deployment) {
        return null;
      }
      
      const contract = this.findContract(deployment, contractName);
      if (!contract) {
        return null;
      }
      
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

  async putContract(chainId: number, contract: ContractType): Promise<void> {
    const startTime = Date.now();
    
    try {
      let deployment = await this.loadDeployment(chainId);
      if (!deployment) {
        deployment = await this.createEmptyDeployment(chainId, contract.networkName);
      }
      
      this.updateContract(deployment, contract);
      
      deployment.metadata.lastUpdated = new Date().toISOString();
      deployment.fileVersion = (deployment.fileVersion || 0) + 1;
      
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

  async queryContracts(options: QueryOptions): Promise<ContractType[]> {
    const startTime = Date.now();
    
    try {
      let allContracts: ContractType[] = [];
      
      if (options.chainId) {
        allContracts = await this.getAllContracts(options.chainId);
      } else {
        const chainIds = await this.getAllChainIds();
        for (const chainId of chainIds) {
          const contracts = await this.getAllContracts(chainId);
          allContracts.push(...contracts);
        }
      }
      
      let filtered = allContracts;
      
      if (options.contractName) {
        filtered = filtered.filter(c => c.contractName === options.contractName);
      }
      
      if (options.networkName) {
        filtered = filtered.filter(c => c.networkName === options.networkName);
      }
      
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

  async importAll(data: string, overwrite = false): Promise<void> {
    try {
      const importData = JSON.parse(data);
      
      for (const [chainIdStr, deployment] of Object.entries(importData)) {
        const chainId = parseInt(chainIdStr);
        
        if (isUnifiedDeployment(deployment)) {
          if (overwrite || !(await this.deploymentExists(chainId))) {
            await this.saveDeployment(chainId, deployment as UnifiedDeployment);
          }
        } else {
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
        
        const validation = validateUnifiedDeployment(deployment);
        errors.push(...validation.errors);
        warnings.push(...validation.warnings);
        
        if (deployment.contracts.core) {
          contractCount += Object.keys(deployment.contracts.core).length;
        }
        if (deployment.contracts.protocol) {
          contractCount += Object.keys(deployment.contracts.protocol).length;
        }
        if (deployment.contracts.infrastructure) {
          contractCount += Object.keys(deployment.contracts.infrastructure).length;
        }
        
        // Verify critical fields are preserved
        const contracts = await this.getAllContracts(chainId);
        for (const contract of contracts) {
          if (!contract.factoryByteCodeHash) {
            warnings.push(`Missing factoryByteCodeHash for ${contract.contractName} on chain ${chainId}`);
          }
          if (!contract.timestamp) {
            warnings.push(`Missing timestamp for ${contract.contractName} on chain ${chainId}`);
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

  async getMetrics(): Promise<BackendMetrics> {
    this.metrics.cacheHitRate = this.cacheStats.hits / 
      (this.cacheStats.hits + this.cacheStats.misses) || 0;
    
    return { ...this.metrics };
  }

  async hasContract(chainId: number, contractName: string): Promise<boolean> {
    const contract = await this.getContract(chainId, contractName);
    return contract !== null;
  }

  async deleteContract(chainId: number, contractName: string): Promise<boolean> {
    try {
      const deployment = await this.loadDeployment(chainId);
      if (!deployment) return false;
      
      let deleted = false;
      
      // Check all categories
      if (deployment.contracts.core[contractName as keyof typeof deployment.contracts.core]) {
        delete deployment.contracts.core[contractName as keyof typeof deployment.contracts.core];
        deleted = true;
      }
      
      if (deployment.contracts.protocol?.[contractName]) {
        delete deployment.contracts.protocol[contractName];
        deleted = true;
      }
      
      if (deployment.contracts.infrastructure?.[contractName]) {
        delete deployment.contracts.infrastructure[contractName];
        deleted = true;
      }
      
      if (deleted) {
        // Also remove from extended data storage
        if (deployment.verification?.implementationHashes?.[contractName]) {
          delete deployment.verification.implementationHashes[contractName];
        }
        
        // Remove from extended fields storage
        const extendedKey = `extended_${contractName}`;
        if ((deployment as any)[extendedKey]) {
          delete (deployment as any)[extendedKey];
        }
        
        await this.saveDeployment(chainId, deployment);
      }
      
      return deleted;
    } catch {
      return false;
    }
  }

  getBackendType(): string {
    return 'unified-json';
  }

  async isHealthy(): Promise<boolean> {
    try {
      await fs.access(this.unifiedPath);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Private Helper Methods - FIXED IMPLEMENTATIONS
  // ============================================================================

  private async detectAndMigrate(): Promise<void> {
    if (this.config.debugMode) {
      console.log('[DEBUG] Detecting and migrating existing files...');
    }
    
    const files = await fs.readdir(this.basePath);
    const networks = new Set<string>();
    
    for (const file of files) {
      if (file.endsWith('.json') && !file.includes('unified')) {
        const match = file.match(/^(?:enhanced-|config-)?(.+)\.json$/);
        if (match) {
          networks.add(match[1]);
        }
      }
    }
    
    for (const network of networks) {
      const unifiedPath = path.join(this.unifiedPath, `${network}.unified.json`);
      
      try {
        await fs.access(unifiedPath);
        if (this.config.debugMode) {
          console.log(`[DEBUG] Unified file already exists for ${network}`);
        }
      } catch {
        if (this.config.debugMode) {
          console.log(`[DEBUG] No unified file for ${network}, migration may be needed`);
        }
      }
    }
  }

  private async loadDeployment(chainId: number): Promise<UnifiedDeployment | null> {
    const cacheKey = `deployment-${chainId}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 60000) {
      this.cacheStats.hits++;
      cached.accessed = Date.now();
      return cached.data as UnifiedDeployment;
    }
    
    this.cacheStats.misses++;
    
    const network = await this.getNetworkName(chainId);
    if (!network) {
      return null;
    }
    
    const unifiedPath = path.join(this.unifiedPath, `${network}.unified.json`);
    
    try {
      const content = await fs.readFile(unifiedPath, 'utf-8');
      const deployment = JSON.parse(content) as UnifiedDeployment;
      
      if (isUnifiedDeployment(deployment)) {
        this.updateCache(cacheKey, deployment, 'unified');
        return deployment;
      }
    } catch {
      // Try legacy format
    }
    
    const legacyDeployment = await this.loadLegacyDeployment(chainId, network);
    if (legacyDeployment) {
      this.updateCache(cacheKey, legacyDeployment, 'standard');
      
      if (this.config.autoMigrate) {
        await this.saveDeployment(chainId, legacyDeployment);
      }
      
      return legacyDeployment;
    }
    
    return null;
  }

  private async loadLegacyDeployment(chainId: number, network: string): Promise<UnifiedDeployment | null> {
    const standardPath = path.join(this.basePath, `${network}.json`);
    
    try {
      const content = await fs.readFile(standardPath, 'utf-8');
      const standard = JSON.parse(content);
      
      return this.convertLegacyToUnified(standard, network);
    } catch {
      return null;
    }
  }

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

  private convertLegacyContracts(contracts: any): any {
    const result: any = {
      core: {},
      protocol: {},
      infrastructure: {}
    };
    
    if (!contracts) return result;
    
    Object.entries(contracts).forEach(([name, contract]: [string, any]) => {
      const cleanName = name.split(':').pop() || name;
      const contractInfo: ExtendedContractInfo = {
        proxy: contract.proxyAddress,
        implementation: contract.address, // Store implementation ADDRESS not hash
        address: contract.address,
        factoryByteCodeHash: contract.factoryByteCodeHash,
        implementationHash: contract.implementationHash,
        deploymentArgs: contract.deploymentArgs,
        timestamp: contract.timestamp,
        deployedAt: contract.timestamp ? new Date(contract.timestamp).toISOString() : undefined
      };
      
      if (cleanName === 'LookCoin' || cleanName === 'SupplyOracle') {
        result.core[cleanName] = contractInfo;
      } else if (cleanName.includes('Module')) {
        result.protocol[cleanName] = contractInfo;
      } else {
        result.infrastructure[cleanName] = contractInfo;
      }
    });
    
    if (Object.keys(result.protocol).length === 0) delete result.protocol;
    if (Object.keys(result.infrastructure).length === 0) delete result.infrastructure;
    
    return result;
  }

  private async saveDeployment(chainId: number, deployment: UnifiedDeployment): Promise<void> {
    const network = deployment.network;
    const filePath = path.join(this.unifiedPath, `${network}.unified.json`);
    
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
    
    this.updateCache(`deployment-${chainId}`, deployment, 'unified');
  }

  private async doAtomicWrite(filePath: string, data: any): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    
    const content = this.config.prettyPrint 
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
    
    await fs.writeFile(tempPath, content, 'utf-8');
    
    if (this.config.backupEnabled) {
      await this.createBackup(filePath);
    }
    
    await fs.rename(tempPath, filePath);
  }

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
      
      if (this.config.backupRetention) {
        await this.cleanOldBackups(backupDir, this.config.backupRetention);
      }
    } catch {
      // Backup failed, but don't block operation
    }
  }

  private async cleanOldBackups(backupDir: string, retention: number): Promise<void> {
    const files = await fs.readdir(backupDir);
    const backups = files
      .filter(f => f.endsWith('.backup'))
      .sort()
      .reverse();
    
    for (let i = retention; i < backups.length; i++) {
      await fs.unlink(path.join(backupDir, backups[i])).catch(() => {});
    }
  }

  private findContract(deployment: UnifiedDeployment, contractName: string): ExtendedContractInfo | null {
    // Check core contracts
    if (deployment.contracts.core[contractName as keyof typeof deployment.contracts.core]) {
      const contract = deployment.contracts.core[contractName as keyof typeof deployment.contracts.core];
      return this.enrichContractInfo(contract, contractName, deployment);
    }
    
    // Check protocol contracts
    if (deployment.contracts.protocol?.[contractName]) {
      const contract = deployment.contracts.protocol[contractName];
      return this.enrichContractInfo(contract, contractName, deployment);
    }
    
    // Check infrastructure contracts
    if (deployment.contracts.infrastructure?.[contractName]) {
      const contract = deployment.contracts.infrastructure[contractName];
      return this.enrichContractInfo(contract, contractName, deployment);
    }
    
    // Check legacy names
    if (deployment.contracts.legacy?.[contractName]) {
      const legacy = deployment.contracts.legacy[contractName];
      return this.findContract(deployment, legacy.currentName);
    }
    
    return null;
  }

  /**
   * Enrich ContractInfo with extended fields stored elsewhere
   */
  private enrichContractInfo(
    contract: ContractInfo, 
    contractName: string, 
    deployment: UnifiedDeployment
  ): ExtendedContractInfo {
    const extended: ExtendedContractInfo = { ...contract };
    
    // Try to get extended fields from custom storage location
    const extendedKey = `extended_${contractName}`;
    const extendedData = (deployment as any)[extendedKey];
    
    if (extendedData) {
      extended.factoryByteCodeHash = extendedData.factoryByteCodeHash;
      extended.implementationHash = extendedData.implementationHash;
      extended.deploymentArgs = extendedData.deploymentArgs;
      extended.timestamp = extendedData.timestamp;
    } else {
      // Fallback: try to get from verification section
      if (deployment.verification?.implementationHashes?.[contractName]) {
        extended.implementationHash = deployment.verification.implementationHashes[contractName];
      }
    }
    
    return extended;
  }

  /**
   * FIXED: Update contract in deployment with proper field mapping
   */
  private updateContract(deployment: UnifiedDeployment, contract: ContractType): void {
    const contractInfo: ExtendedContractInfo = {
      address: contract.address,
      proxy: contract.proxyAddress,
      implementation: contract.proxyAddress ? contract.address : undefined, // Implementation ADDRESS
      deployedAt: new Date(contract.timestamp).toISOString(),
      timestamp: contract.timestamp
    };
    
    // Store extended fields in a separate location to maintain schema compatibility
    const extendedData = {
      factoryByteCodeHash: contract.factoryByteCodeHash,
      implementationHash: contract.implementationHash, // Store the HASH separately
      deploymentArgs: contract.deploymentArgs,
      timestamp: contract.timestamp
    };
    
    // Store extended data in deployment (custom field)
    (deployment as any)[`extended_${contract.contractName}`] = extendedData;
    
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
    
    // Update implementation hashes in verification section
    if (contract.implementationHash) {
      if (!deployment.verification.implementationHashes) {
        deployment.verification.implementationHashes = {};
      }
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
   * FIXED: Convert ContractInfo to ContractType with proper field mapping
   */
  private convertToContractType(
    name: string,
    contract: ContractInfo | ExtendedContractInfo,
    deployment: UnifiedDeployment
  ): ContractType {
    const extended = contract as ExtendedContractInfo;
    
    // Get extended data if stored separately
    const extendedData = (deployment as any)[`extended_${name}`];
    
    return {
      contractName: name,
      chainId: deployment.chainId,
      networkName: deployment.network,
      address: contract.implementation || contract.address || contract.proxy || '0x0',
      factoryByteCodeHash: extended.factoryByteCodeHash || extendedData?.factoryByteCodeHash || '',
      implementationHash: extended.implementationHash || 
                         extendedData?.implementationHash || 
                         deployment.verification?.implementationHashes?.[name] || '',
      proxyAddress: contract.proxy,
      deploymentArgs: extended.deploymentArgs || extendedData?.deploymentArgs || [],
      timestamp: extended.timestamp || 
                extendedData?.timestamp || 
                (contract.deployedAt ? new Date(contract.deployedAt).getTime() : Date.now())
    };
  }

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

  private async getAllChainIds(): Promise<number[]> {
    const chainIds = new Set<number>();
    
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

  private async deploymentExists(chainId: number): Promise<boolean> {
    const deployment = await this.loadDeployment(chainId);
    return deployment !== null;
  }

  private async getNetworkName(chainId: number): Promise<string | null> {
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

  private inferNetworkTier(network: string): 'mainnet' | 'testnet' | 'dev' {
    if (network.includes('mainnet')) return 'mainnet';
    if (network.includes('testnet') || network.includes('sepolia') || network.includes('goerli')) return 'testnet';
    return 'dev';
  }

  private computeChecksum(data: any): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex').substring(0, 16);
  }

  private updateCache(key: string, data: any, format: FileFormat): void {
    if (!this.config.enableCache) return;
    
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

  private async warmupCache(): Promise<void> {
    if (this.config.debugMode) {
      console.log('[DEBUG] Warming up cache...');
    }
    
    try {
      const chainIds = await this.getAllChainIds();
      for (const chainId of chainIds.slice(0, 10)) {
        await this.loadDeployment(chainId);
      }
    } catch {
      // Cache warmup is optional
    }
  }
}

export default UnifiedJSONStateManager;