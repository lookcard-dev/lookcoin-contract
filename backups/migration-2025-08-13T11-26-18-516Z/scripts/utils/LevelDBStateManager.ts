/**
 * LevelDBStateManager Implementation
 * 
 * Wrapper around existing state.ts functionality to implement IStateManager interface.
 * Maintains 100% backward compatibility with zero behavioral changes.
 * 
 * Key Requirements:
 * - No changes to existing deployment behavior
 * - Preserve all current upgrade detection logic
 * - Maintain exact same error handling patterns
 * - Support all current BigInt serialization patterns
 */

import { Level } from "level";
import * as path from "path";
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

export class LevelDBStateManager implements IStateManager {
  private db: Level<string, ContractType> | null = null;
  private dbPath: string;
  private config: StateManagerConfig;
  private isInitialized = false;
  private metrics: BackendMetrics = {
    readLatency: 0,
    writeLatency: 0,
    queryLatency: 0,
    errorRate: 0
  };

  constructor(config: StateManagerConfig = {}) {
    this.config = {
      debugMode: process.env.DEBUG_DEPLOYMENT === 'true',
      validateOnWrite: true,
      backupEnabled: false,
      dbPath: path.join(process.cwd(), "leveldb"),
      leveldbOptions: {
        createIfMissing: true,
        ...config.leveldbOptions
      },
      ...config
    };
    this.dbPath = this.config.dbPath!;
  }

  /**
   * Initialize the LevelDB database
   * Maintains existing createDatabase() behavior exactly
   */
  async initialize(): Promise<void> {
    if (this.isInitialized && this.db) {
      return;
    }

    try {
      this.db = new Level<string, ContractType>(this.dbPath, {
        valueEncoding: "json",
        createIfMissing: this.config.leveldbOptions?.createIfMissing ?? true,
        ...this.config.leveldbOptions
      });
      
      await this.db.open();
      this.isInitialized = true;
      
      if (this.config.debugMode) {
        console.log(`[DEBUG] LevelDBStateManager initialized at: ${this.dbPath}`);
      }
    } catch (error) {
      throw new StateManagerError(
        StateManagerErrorCode.BACKEND_UNAVAILABLE,
        `Failed to initialize LevelDB: ${error instanceof Error ? error.message : String(error)}`,
        { dbPath: this.dbPath, error }
      );
    }
  }

  /**
   * Gracefully close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      try {
        await this.db.close();
        this.db = null;
        this.isInitialized = false;
        
        if (this.config.debugMode) {
          console.log(`[DEBUG] LevelDBStateManager closed`);
        }
      } catch (error) {
        if (this.config.debugMode) {
          console.error(`[DEBUG] Error closing LevelDBStateManager:`, error);
        }
      }
    }
  }

  /**
   * Retrieve contract - maintains exact same behavior as existing getContract()
   */
  async getContract(chainId: number, contractName: string): Promise<ContractType | null> {
    await this.ensureInitialized();
    const startTime = Date.now();
    const key = this.generateKey(chainId, contractName);

    try {
      const contract = await this.db!.get(key);
      
      if (this.config.debugMode) {
        console.log(`[DEBUG] Retrieved ${contractName} from LevelDB for chain ${chainId}`);
      }

      this.updateReadMetrics(Date.now() - startTime, false);
      return this.deserializeBigInt(contract) as ContractType;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "LEVEL_NOT_FOUND") {
        if (this.config.debugMode) {
          console.log(`[DEBUG] ${contractName} not found in LevelDB for chain ${chainId}`);
        }
        this.updateReadMetrics(Date.now() - startTime, false);
        return null;
      }
      
      console.error(`[ERROR] LevelDB error retrieving ${contractName}:`, error);
      this.updateReadMetrics(Date.now() - startTime, true);
      throw new StateManagerError(
        StateManagerErrorCode.BACKEND_UNAVAILABLE,
        `Failed to retrieve contract ${contractName} for chain ${chainId}`,
        { chainId, contractName, error }
      );
    }
  }

  /**
   * Store contract - maintains exact same behavior as existing putContract()
   */
  async putContract(chainId: number, contract: ContractType): Promise<void> {
    await this.ensureInitialized();
    const startTime = Date.now();
    const key = this.generateKey(chainId, contract.contractName);

    // Validate contract data if enabled
    if (this.config.validateOnWrite && !this.validateContractType(contract)) {
      throw new StateManagerError(
        StateManagerErrorCode.VALIDATION_FAILED,
        `Invalid contract data for ${(contract as ContractType).contractName}`,
        { chainId, contract }
      );
    }

    // Convert BigInt values to strings for serialization (maintain existing behavior)
    const serializedContract = this.serializeBigInt({
      ...contract,
      chainId, // Ensure chainId is consistent
      timestamp: contract.timestamp || Date.now()
    });

    try {
      await this.db!.put(key, serializedContract as ContractType);
      
      if (this.config.debugMode) {
        console.log(`[DEBUG] Stored ${contract.contractName} to LevelDB for chain ${chainId}`);
        console.log(`[DEBUG]   - Key: ${key}`);
        console.log(`[DEBUG]   - Implementation hash: ${contract.implementationHash}`);
      }

      this.updateWriteMetrics(Date.now() - startTime, false);
    } catch (error) {
      console.error(`[ERROR] Failed to store ${contract.contractName} in LevelDB:`, error);
      this.updateWriteMetrics(Date.now() - startTime, true);
      throw new StateManagerError(
        StateManagerErrorCode.WRITE_FAILED,
        `Failed to store contract ${contract.contractName} for chain ${chainId}`,
        { chainId, contract, error }
      );
    }
  }

  /**
   * Get all contracts for a chain - maintains exact same behavior as existing getAllContracts()
   */
  async getAllContracts(chainId: number): Promise<ContractType[]> {
    await this.ensureInitialized();
    const startTime = Date.now();
    const contracts: ContractType[] = [];

    try {
      for await (const [key, value] of this.db!.iterator()) {
        if (key.startsWith(`${chainId}-`)) {
          contracts.push(this.deserializeBigInt(value) as ContractType);
        }
      }

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
   * Advanced query interface with filtering and sorting
   */
  async queryContracts(options: QueryOptions): Promise<ContractType[]> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      let contracts: ContractType[] = [];

      if (options.chainId) {
        contracts = await this.getAllContracts(options.chainId);
      } else {
        // Get contracts from all chains
        for await (const [, value] of this.db!.iterator()) {
          contracts.push(this.deserializeBigInt(value) as ContractType);
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
   * Export all data in specified format
   */
  async exportAll(options: ExportOptions): Promise<string> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      const allContracts: Record<string, ContractType> = {};

      for await (const [key, value] of this.db!.iterator()) {
        const contract = this.deserializeBigInt(value) as ContractType;
        
        // Apply chain filter if specified
        if (options.chainIds && !options.chainIds.includes((contract as ContractType).chainId)) {
          continue;
        }

        allContracts[key] = contract as ContractType;
      }

      const exportData = {
        format: options.format,
        exportTime: new Date().toISOString(),
        totalContracts: Object.keys(allContracts).length,
        ...(options.includeMetadata && {
          metadata: {
            backendType: this.getBackendType(),
            dbPath: this.dbPath,
            metrics: await this.getMetrics()
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
      for await (const [key, value] of this.db!.iterator()) {
        contractCount++;
        
        // Validate key format
        if (!this.isValidKey(key)) {
          errors.push(`Invalid key format: ${key}`);
          continue;
        }

        // Validate contract data
        if (!this.validateContractType(value)) {
          errors.push(`Invalid contract data for key: ${key}`);
          continue;
        }

        // Check for missing required fields
        if (!value.address || !value.contractName || !value.factoryByteCodeHash) {
          warnings.push(`Missing fields in contract: ${key}`);
        }

        // Validate chainId consistency
        const { chainId } = this.parseKey(key);
        if (value.chainId !== chainId) {
          errors.push(`ChainId mismatch for key ${key}: ${value.chainId} vs ${chainId}`);
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
    return { ...this.metrics };
  }

  /**
   * Check if contract exists
   */
  async hasContract(chainId: number, contractName: string): Promise<boolean> {
    const contract = await this.getContract(chainId, contractName);
    return contract !== null;
  }

  /**
   * Delete a contract (use with caution)
   */
  async deleteContract(chainId: number, contractName: string): Promise<boolean> {
    await this.ensureInitialized();
    const key = this.generateKey(chainId, contractName);

    try {
      await this.db!.del(key);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "LEVEL_NOT_FOUND") {
        return false;
      }
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
    return 'leveldb';
  }

  /**
   * Check backend health
   */
  async isHealthy(): Promise<boolean> {
    try {
      if (!this.isInitialized || !this.db) {
        return false;
      }
      
      // Simple health check - try to read a non-existent key
      await this.db.get('health-check-key').catch(() => {
        // Expected to fail, this just tests connectivity
      });
      
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

  private isValidKey(key: string): boolean {
    try {
      const { chainId } = this.parseKey(key);
      return !isNaN(chainId) && chainId > 0;
    } catch {
      return false;
    }
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
    // For LevelDB, we maintain existing behavior - no automatic BigInt deserialization
    // This preserves 100% backward compatibility
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