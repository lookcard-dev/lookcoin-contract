/**
 * StateManagerFactory - Factory and Migration Architecture
 * 
 * Provides factory methods for creating state manager instances and managing 
 * migrations between different storage backends with dual-write capability,
 * fallback mechanisms, and data validation.
 * 
 * Key Features:
 * - Factory pattern for creating state manager instances
 * - Migration manager with dual-write capability
 * - Fallback mechanisms for failed operations
 * - Data validation hooks during transitions
 * - Progress tracking and error recovery
 * - Lock-based concurrency control
 */

import { 
  IStateManager, 
  IStateManagerFactory, 
  ContractType, 
  StateManagerConfig, 
  MigrationConfig,
  MigrationStatus,
  StateManagerError,
  StateManagerErrorCode,
  QueryOptions,
  ExportOptions,
  BackendMetrics
} from "./IStateManager";

import { JSONStateManager } from "./JSONStateManager";

/**
 * Migration-aware state manager that can write to two backends simultaneously
 * during transition periods, with fallback capabilities
 */
export class MigrationStateManager implements IStateManager {
  private sourceManager: IStateManager;
  private targetManager: IStateManager;
  private config: MigrationConfig;
  private migrationStatus: MigrationStatus;
  private lockMap = new Map<string, Promise<unknown>>();
  
  constructor(
    sourceManager: IStateManager,
    targetManager: IStateManager,
    config: MigrationConfig
  ) {
    this.sourceManager = sourceManager;
    this.targetManager = targetManager;
    this.config = {
      dualWriteEnabled: true,
      fallbackOnError: true,
      validationEnabled: true,
      batchSize: 100,
      lockTimeout: 30000,
      ...config
    };
    
    this.migrationStatus = {
      isActive: true,
      sourceBackend: sourceManager.getBackendType(),
      targetBackend: targetManager.getBackendType(),
      progress: 0,
      errors: [],
      startTime: Date.now()
    };
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.sourceManager.initialize(),
      this.targetManager.initialize()
    ]);
  }

  async close(): Promise<void> {
    // Clear any pending locks
    this.lockMap.clear();
    
    await Promise.all([
      this.sourceManager.close(),
      this.targetManager.close()
    ]);
  }

  async getContract(chainId: number, contractName: string): Promise<ContractType | null> {
    const lockKey = `get-${chainId}-${contractName}`;
    return this.withLock(lockKey, async () => {
      try {
        // Try target first (new system), then fallback to source
        const targetResult = await this.targetManager.getContract(chainId, contractName);
        if (targetResult) {
          return targetResult;
        }

        // Fallback to source
        const sourceResult = await this.sourceManager.getContract(chainId, contractName);
        
        // If found in source but not target, and dual-write is enabled, sync it
        if (sourceResult && this.config.dualWriteEnabled) {
          try {
            await this.targetManager.putContract(chainId, sourceResult);
            if (this.config.debugMode) {
              console.log(`[DEBUG] Auto-synced ${contractName} from source to target`);
            }
          } catch (error) {
            if (this.config.debugMode) {
              console.warn(`[DEBUG] Failed to auto-sync ${contractName}:`, error);
            }
          }
        }

        return sourceResult;
      } catch (error) {
        this.recordError(`getContract failed for ${contractName}`, error);
        throw error;
      }
    });
  }

  async putContract(chainId: number, contract: ContractType): Promise<void> {
    const lockKey = `put-${chainId}-${contract.contractName}`;
    return this.withLock(lockKey, async () => {
      const errors: Error[] = [];
      let targetWriteSucceeded = false;
      let sourceWriteSucceeded = false;

      try {
        // Always try to write to target (new system) first
        await this.targetManager.putContract(chainId, contract);
        targetWriteSucceeded = true;
        
        if (this.config.debugMode) {
          console.log(`[DEBUG] Successfully wrote ${contract.contractName} to target backend`);
        }
      } catch (error) {
        errors.push(error as Error);
        this.recordError(`Target write failed for ${contract.contractName}`, error);
      }

      // If dual-write is enabled, also write to source
      if (this.config.dualWriteEnabled) {
        try {
          await this.sourceManager.putContract(chainId, contract);
          sourceWriteSucceeded = true;
          
          if (this.config.debugMode) {
            console.log(`[DEBUG] Successfully wrote ${contract.contractName} to source backend (dual-write)`);
          }
        } catch (error) {
          errors.push(error as Error);
          this.recordError(`Source write failed for ${contract.contractName}`, error);
        }
      }

      // Determine success based on configuration
      const requiredWriteSucceeded = targetWriteSucceeded;
      const fallbackWriteSucceeded = this.config.dualWriteEnabled ? sourceWriteSucceeded : true;

      if (!requiredWriteSucceeded && (!this.config.fallbackOnError || !fallbackWriteSucceeded)) {
        throw new StateManagerError(
          StateManagerErrorCode.WRITE_FAILED,
          `Failed to write ${contract.contractName} to required backends`,
          { chainId, contract, errors }
        );
      }

      // Validation if enabled
      if (this.config.validationEnabled && targetWriteSucceeded) {
        try {
          await this.validateContractWrite(chainId, contract);
        } catch (error) {
          this.recordError(`Validation failed for ${contract.contractName}`, error);
          // Non-fatal validation errors
        }
      }

      // Update progress
      this.updateProgress();
    });
  }

  async getAllContracts(chainId: number): Promise<ContractType[]> {
    const lockKey = `getall-${chainId}`;
    return this.withLock(lockKey, async () => {
      try {
        // Try target first, fallback to source
        try {
          return await this.targetManager.getAllContracts(chainId);
        } catch (error) {
          if (this.config.fallbackOnError) {
            if (this.config.debugMode) {
              console.warn(`[DEBUG] Target getAllContracts failed, falling back to source:`, error);
            }
            return await this.sourceManager.getAllContracts(chainId);
          }
          throw error;
        }
      } catch (error) {
        this.recordError(`getAllContracts failed for chain ${chainId}`, error);
        throw error;
      }
    });
  }

  async queryContracts(options: QueryOptions): Promise<ContractType[]> {
    try {
      // Try target first, fallback to source
      try {
        return await this.targetManager.queryContracts(options);
      } catch (error) {
        if (this.config.fallbackOnError) {
          if (this.config.debugMode) {
            console.warn(`[DEBUG] Target queryContracts failed, falling back to source:`, error);
          }
          return await this.sourceManager.queryContracts(options);
        }
        throw error;
      }
    } catch (error) {
      this.recordError(`queryContracts failed`, error);
      throw error;
    }
  }

  async exportAll(options: ExportOptions): Promise<string> {
    // Export from source during migration (more complete data)
    return await this.sourceManager.exportAll(options);
  }

  async importAll(data: string, overwrite?: boolean): Promise<void> {
    // Import to both backends if dual-write is enabled
    const errors: Error[] = [];

    try {
      await this.targetManager.importAll(data, overwrite);
    } catch (error) {
      errors.push(error as Error);
      this.recordError('Target import failed', error);
    }

    if (this.config.dualWriteEnabled) {
      try {
        await this.sourceManager.importAll(data, overwrite);
      } catch (error) {
        errors.push(error as Error);
        this.recordError('Source import failed', error);
      }
    }

    if (errors.length > 0 && !this.config.fallbackOnError) {
      throw new StateManagerError(
        StateManagerErrorCode.WRITE_FAILED,
        'Import failed on required backends',
        { errors }
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
    const sourceValidation = await this.sourceManager.validateIntegrity();
    const targetValidation = await this.targetManager.validateIntegrity();

    // Combine validations
    return {
      isValid: sourceValidation.isValid && targetValidation.isValid,
      errors: [...sourceValidation.errors, ...targetValidation.errors],
      warnings: [...sourceValidation.warnings, ...targetValidation.warnings],
      contractCount: Math.max(sourceValidation.contractCount, targetValidation.contractCount),
      lastValidated: Date.now()
    };
  }

  async getMetrics(): Promise<BackendMetrics> {
    const sourceMetrics = await this.sourceManager.getMetrics();
    const targetMetrics = await this.targetManager.getMetrics();

    // Combine metrics (weighted average)
    return {
      readLatency: (sourceMetrics.readLatency + targetMetrics.readLatency) / 2,
      writeLatency: (sourceMetrics.writeLatency + targetMetrics.writeLatency) / 2,
      queryLatency: (sourceMetrics.queryLatency + targetMetrics.queryLatency) / 2,
      errorRate: Math.max(sourceMetrics.errorRate, targetMetrics.errorRate),
      cacheHitRate: targetMetrics.cacheHitRate || sourceMetrics.cacheHitRate
    };
  }

  async hasContract(chainId: number, contractName: string): Promise<boolean> {
    // Check target first, fallback to source
    if (await this.targetManager.hasContract(chainId, contractName)) {
      return true;
    }
    return await this.sourceManager.hasContract(chainId, contractName);
  }

  async deleteContract(chainId: number, contractName: string): Promise<boolean> {
    const lockKey = `delete-${chainId}-${contractName}`;
    return this.withLock(lockKey, async () => {
      let targetDeleted = false;
      let sourceDeleted = false;

      // Delete from target
      try {
        targetDeleted = await this.targetManager.deleteContract(chainId, contractName);
      } catch (error) {
        this.recordError(`Target delete failed for ${contractName}`, error);
      }

      // Delete from source if dual-write is enabled
      if (this.config.dualWriteEnabled) {
        try {
          sourceDeleted = await this.sourceManager.deleteContract(chainId, contractName);
        } catch (error) {
          this.recordError(`Source delete failed for ${contractName}`, error);
        }
      }

      return targetDeleted || sourceDeleted;
    });
  }

  getBackendType(): string {
    return `migration(${this.sourceManager.getBackendType()}->${this.targetManager.getBackendType()})`;
  }

  async isHealthy(): Promise<boolean> {
    const sourceHealthy = await this.sourceManager.isHealthy();
    const targetHealthy = await this.targetManager.isHealthy();
    
    // At least one backend must be healthy
    return sourceHealthy || targetHealthy;
  }

  // Migration-specific methods

  async getMigrationStatus(): Promise<MigrationStatus> {
    return { ...this.migrationStatus };
  }

  async completeMigration(): Promise<void> {
    this.migrationStatus.isActive = false;
    this.migrationStatus.endTime = Date.now();
    this.migrationStatus.progress = 100;
    
    // Optionally disable dual-write after successful migration
    this.config.dualWriteEnabled = false;
  }

  async rollbackMigration(): Promise<void> {
    // Switch primary operations back to source
    this.migrationStatus.isActive = false;
    this.migrationStatus.endTime = Date.now();
    this.migrationStatus.errors.push('Migration rolled back');
  }

  async performBulkMigration(): Promise<void> {
    if (!this.config.dualWriteEnabled) {
      throw new StateManagerError(
        StateManagerErrorCode.MIGRATION_FAILED,
        'Dual-write must be enabled for bulk migration',
        {}
      );
    }

    try {
      // Export all data from source
      const exportData = await this.sourceManager.exportAll({
        format: 'json',
        includeMetadata: false,
        prettyPrint: false
      });

      // Import to target with overwrite
      await this.targetManager.importAll(exportData, true);

      // Validate migration
      const validation = await this.targetManager.validateIntegrity();
      if (!validation.isValid) {
        throw new StateManagerError(
          StateManagerErrorCode.MIGRATION_FAILED,
          'Migration validation failed',
          { errors: validation.errors }
        );
      }

      this.migrationStatus.progress = 100;
      
      if (this.config.debugMode) {
        console.log(`[DEBUG] Bulk migration completed: ${validation.contractCount} contracts migrated`);
      }
    } catch (error) {
      this.recordError('Bulk migration failed', error);
      throw error;
    }
  }

  // Private utility methods

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    // Check for existing lock
    const existingLock = this.lockMap.get(key);
    if (existingLock) {
      await existingLock.catch(() => {}); // Wait for existing operation to complete
    }

    // Create new operation promise
    const operationPromise = this.executeWithTimeout(operation(), this.config.lockTimeout!);
    this.lockMap.set(key, operationPromise);

    try {
      const result = await operationPromise;
      return result;
    } finally {
      this.lockMap.delete(key);
    }
  }

  private async executeWithTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new StateManagerError(
          StateManagerErrorCode.LOCK_TIMEOUT,
          `Operation timed out after ${timeout}ms`,
          { timeout }
        ));
      }, timeout);

      promise
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timer));
    });
  }

  private async validateContractWrite(chainId: number, contract: ContractType): Promise<void> {
    // Verify the contract was written correctly by reading it back
    const retrieved = await this.targetManager.getContract(chainId, contract.contractName);
    if (!retrieved) {
      throw new StateManagerError(
        StateManagerErrorCode.VALIDATION_FAILED,
        `Contract ${contract.contractName} not found after write`,
        { chainId, contract }
      );
    }

    // Validate key fields
    if (retrieved.address !== contract.address ||
        retrieved.factoryByteCodeHash !== contract.factoryByteCodeHash) {
      throw new StateManagerError(
        StateManagerErrorCode.VALIDATION_FAILED,
        `Contract ${contract.contractName} data mismatch after write`,
        { expected: contract, actual: retrieved }
      );
    }
  }

  private recordError(message: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.migrationStatus.errors.push(`${message}: ${errorMessage}`);
    
    if (this.config.debugMode) {
      console.error(`[DEBUG] Migration error - ${message}:`, error);
    }
  }

  private updateProgress(): void {
    // Simple progress tracking - could be enhanced with actual contract counts
    if (this.config.progressCallback) {
      this.config.progressCallback(this.migrationStatus.progress);
    }
  }
}

/**
 * Factory implementation for creating state manager instances
 */
export class StateManagerFactory implements IStateManagerFactory {
  async createStateManager(
    backend: 'json',
    config?: StateManagerConfig
  ): Promise<IStateManager> {
    let manager: IStateManager;

    switch (backend) {
      case 'json':
        manager = new JSONStateManager(config);
        break;
      default:
        throw new StateManagerError(
          StateManagerErrorCode.BACKEND_UNAVAILABLE,
          `Unsupported backend: ${backend}`,
          { backend }
        );
    }

    await manager.initialize();
    return manager;
  }

  async createMigrationManager(
    sourceBackend: 'json',
    targetBackend: 'json',
    config?: MigrationConfig
  ): Promise<IStateManager> {
    if (sourceBackend === targetBackend) {
      throw new StateManagerError(
        StateManagerErrorCode.VALIDATION_FAILED,
        'Source and target backends cannot be the same',
        { sourceBackend, targetBackend }
      );
    }

    const sourceManager = await this.createStateManager(sourceBackend, config);
    const targetManager = await this.createStateManager(targetBackend, config);

    const migrationManager = new MigrationStateManager(sourceManager, targetManager, config || {});
    await migrationManager.initialize();

    return migrationManager;
  }
}

/**
 * Utility functions for state manager operations
 */
export class StateManagerUtils {
  static serializeBigInt(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map(item => StateManagerUtils.serializeBigInt(item));
    }
    
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = StateManagerUtils.serializeBigInt(value);
      }
      return result;
    }
    
    return typeof obj === 'bigint' ? obj.toString() : obj;
  }

  static deserializeBigInt(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map(item => StateManagerUtils.deserializeBigInt(item));
    }
    
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = StateManagerUtils.deserializeBigInt(value);
      }
      return result;
    }
    
    // Smart BigInt detection for strings that look like numbers
    if (typeof obj === 'string' && /^\d+$/.test(obj) && obj.length > 15) {
      try {
        return BigInt(obj);
      } catch {
        return obj;
      }
    }
    
    return obj;
  }

  static generateKey(chainId: number, contractName: string): string {
    return `${chainId}-${contractName}`;
  }

  static parseKey(key: string): { chainId: number; contractName: string } {
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

  static validateContractType(contract: unknown): contract is ContractType {
    return (
      contract !== null &&
      typeof contract === 'object' &&
      'contractName' in contract &&
      'chainId' in contract &&
      'networkName' in contract &&
      'address' in contract &&
      'factoryByteCodeHash' in contract &&
      'timestamp' in contract &&
      typeof (contract as Record<string, unknown>).contractName === 'string' &&
      typeof (contract as Record<string, unknown>).chainId === 'number' &&
      typeof (contract as Record<string, unknown>).networkName === 'string' &&
      typeof (contract as Record<string, unknown>).address === 'string' &&
      typeof (contract as Record<string, unknown>).factoryByteCodeHash === 'string' &&
      typeof (contract as Record<string, unknown>).timestamp === 'number'
    );
  }

  static generateBackupFilename(prefix: string, chainId?: number): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const chainSuffix = chainId ? `-chain${chainId}` : '';
    return `${prefix}-backup-${timestamp}${chainSuffix}.json`;
  }

  static compareContracts(a: ContractType, b: ContractType): boolean {
    return (
      a.contractName === b.contractName &&
      a.chainId === b.chainId &&
      a.networkName === b.networkName &&
      a.address === b.address &&
      a.factoryByteCodeHash === b.factoryByteCodeHash &&
      a.implementationHash === b.implementationHash &&
      a.proxyAddress === b.proxyAddress &&
      JSON.stringify(a.deploymentArgs) === JSON.stringify(b.deploymentArgs)
    );
  }
}