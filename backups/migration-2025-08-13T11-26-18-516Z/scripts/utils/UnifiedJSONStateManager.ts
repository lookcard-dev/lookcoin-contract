/**
 * UnifiedJSONStateManager Implementation
 * 
 * Specialized state manager for the Unified JSON schema format (v3.0.0).
 * This handles the hierarchical structure with categories (core, protocol, infrastructure, legacy).
 * 
 * Key Features:
 * - Supports Unified JSON schema v3.0.0 with categorized contracts
 * - Extracts contract data from all categories
 * - Handles legacy contract name mapping
 * - Preserves timestamps and implementation hashes
 * - Compatible with IStateManager interface for comparison
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

interface UnifiedJSONDeployment {
  schemaVersion: string;
  fileVersion: number;
  network: string;
  chainId: number;
  networkTier: string;
  metadata: {
    deployer: string;
    deploymentMode: string;
    timestamp: string;
    lastUpdated: string;
    protocolsEnabled: string[];
    protocolsDeployed: string[];
    protocolsConfigured: string[];
    migrationHistory?: Array<{
      from: string;
      to: string;
      timestamp: string;
      migrator: string;
      notes?: string;
    }>;
    dataSources?: {
      originalFormat: string;
      importedFrom: string[];
      consolidatedAt: string;
    };
  };
  contracts: {
    core?: { [name: string]: ContractEntry };
    protocol?: { [name: string]: ContractEntry };
    infrastructure?: { [name: string]: ContractEntry };
    legacy?: { [name: string]: LegacyContractEntry };
  };
  configuration?: {
    governance?: { vault: string };
    protocols?: { [protocol: string]: { [key: string]: string } };
  };
  implementationHashes?: { [name: string]: string };
  factoryBytecodeHashes?: { [name: string]: string };
}

interface ContractEntry {
  address?: string;
  proxy: string;
  implementation: string;
  deployedAt?: string;
  timestamp?: number;
}

interface LegacyContractEntry {
  currentName: string;
  currentCategory: string;
}

export class UnifiedJSONStateManager implements IStateManager {
  private basePath: string;
  private config: StateManagerConfig;
  private isInitialized = false;
  private metrics: BackendMetrics = {
    readLatency: 0,
    writeLatency: 0,
    queryLatency: 0,
    errorRate: 0
  };

  // Network mapping for file names
  private readonly NETWORK_MAP: Record<number, string> = {
    56: 'bscmainnet',
    97: 'bsctestnet', 
    84532: 'basesepolia',
    11155420: 'optimismsepolia',
    23295: 'sapphiremainnet',
    23294: 'sapphiretestnet',
    8453: 'basemainnet',
    10: 'optimismmainnet'
  };

  constructor(config: StateManagerConfig = {}) {
    this.config = {
      debugMode: process.env.DEBUG_DEPLOYMENT === 'true',
      validateOnWrite: true,
      backupEnabled: false,
      jsonPath: path.join(process.cwd(), "deployments", "unified"),
      ...config
    };
    this.basePath = this.config.jsonPath!;
  }

  /**
   * Initialize the Unified JSON storage system
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Ensure base directory exists
      await fs.mkdir(this.basePath, { recursive: true });
      this.isInitialized = true;
      
      if (this.config.debugMode) {
        console.log(`[DEBUG] UnifiedJSONStateManager initialized at: ${this.basePath}`);
      }
    } catch (error) {
      throw new StateManagerError(
        StateManagerErrorCode.BACKEND_UNAVAILABLE,
        `Failed to initialize Unified JSON storage: ${error instanceof Error ? error.message : String(error)}`,
        { basePath: this.basePath, error }
      );
    }
  }

  /**
   * Close and cleanup resources
   */
  async close(): Promise<void> {
    try {
      this.isInitialized = false;
      
      if (this.config.debugMode) {
        console.log(`[DEBUG] UnifiedJSONStateManager closed`);
      }
    } catch (error) {
      if (this.config.debugMode) {
        console.error(`[DEBUG] Error closing UnifiedJSONStateManager:`, error);
      }
    }
  }

  /**
   * Retrieve contract by chainId and name
   */
  async getContract(chainId: number, contractName: string): Promise<ContractType | null> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      const deployment = await this.loadUnifiedDeployment(chainId);
      if (!deployment) {
        if (this.config.debugMode) {
          console.log(`[DEBUG] No unified deployment file found for chain ${chainId}`);
        }
        this.updateReadMetrics(Date.now() - startTime, false);
        return null;
      }

      const contract = this.extractContractFromUnifiedDeployment(deployment, contractName);
      if (!contract) {
        if (this.config.debugMode) {
          console.log(`[DEBUG] ${contractName} not found in unified deployment for chain ${chainId}`);
        }
        this.updateReadMetrics(Date.now() - startTime, false);
        return null;
      }

      if (this.config.debugMode) {
        console.log(`[DEBUG] Retrieved ${contractName} from Unified JSON for chain ${chainId}`);
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
   * Store contract (Not implemented for comparison tool)
   */
  async putContract(chainId: number, contract: ContractType): Promise<void> {
    throw new StateManagerError(
      StateManagerErrorCode.WRITE_FAILED,
      'UnifiedJSONStateManager is read-only for comparison purposes',
      { chainId, contract }
    );
  }

  /**
   * Get all contracts for a specific chain
   */
  async getAllContracts(chainId: number): Promise<ContractType[]> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      const deployment = await this.loadUnifiedDeployment(chainId);
      if (!deployment) {
        this.updateQueryMetrics(Date.now() - startTime, false);
        return [];
      }

      const contracts = this.extractAllContractsFromUnifiedDeployment(deployment);
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
   * Export all data (Not implemented for comparison tool)
   */
  async exportAll(options: ExportOptions): Promise<string> {
    throw new StateManagerError(
      StateManagerErrorCode.BACKEND_UNAVAILABLE,
      'Export not implemented for UnifiedJSONStateManager',
      { options }
    );
  }

  /**
   * Import data (Not implemented for comparison tool)
   */
  async importAll(data: string, overwrite: boolean = false): Promise<void> {
    throw new StateManagerError(
      StateManagerErrorCode.VALIDATION_FAILED,
      'Import not implemented for UnifiedJSONStateManager',
      { data: data.substring(0, 100) }
    );
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
        const deployment = await this.loadUnifiedDeployment(chainId);
        if (!deployment) {
          warnings.push(`No unified deployment file for chain ${chainId}`);
          continue;
        }

        const contracts = this.extractAllContractsFromUnifiedDeployment(deployment);
        contractCount += contracts.length;

        for (const contract of contracts) {
          // Validate contract data
          if (!this.validateContractType(contract)) {
            errors.push(`Invalid contract data: ${contract.contractName} on chain ${chainId}`);
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
   * Delete a contract (Not implemented for comparison tool)
   */
  async deleteContract(chainId: number, contractName: string): Promise<boolean> {
    throw new StateManagerError(
      StateManagerErrorCode.WRITE_FAILED,
      'Delete not implemented for UnifiedJSONStateManager',
      { chainId, contractName }
    );
  }

  /**
   * Get backend type
   */
  getBackendType(): string {
    return 'unified-json';
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

  private getFilePath(chainId: number): string {
    const networkName = this.NETWORK_MAP[chainId] || `chain${chainId}`;
    return path.join(this.basePath, `${networkName}.unified.json`);
  }

  private async loadUnifiedDeployment(chainId: number): Promise<UnifiedJSONDeployment | null> {
    const filePath = this.getFilePath(chainId);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const deployment = JSON.parse(content);
      return deployment as UnifiedJSONDeployment;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private extractContractFromUnifiedDeployment(deployment: UnifiedJSONDeployment, contractName: string): ContractType | null {
    // Search through all categories
    const categories = ['core', 'protocol', 'infrastructure'] as const;
    
    for (const category of categories) {
      const categoryContracts = deployment.contracts[category];
      if (categoryContracts && categoryContracts[contractName]) {
        return this.convertToContractType(deployment, contractName, categoryContracts[contractName]);
      }
    }

    // Check legacy contracts
    if (deployment.contracts.legacy && deployment.contracts.legacy[contractName]) {
      const legacyEntry = deployment.contracts.legacy[contractName];
      const currentCategory = legacyEntry.currentCategory as keyof typeof deployment.contracts;
      const currentName = legacyEntry.currentName;
      
      if (currentCategory !== 'legacy' && deployment.contracts[currentCategory]?.[currentName]) {
        return this.convertToContractType(deployment, contractName, deployment.contracts[currentCategory]![currentName]);
      }
    }

    return null;
  }

  private extractAllContractsFromUnifiedDeployment(deployment: UnifiedJSONDeployment): ContractType[] {
    const contracts: ContractType[] = [];

    // Extract from all categories
    const categories = ['core', 'protocol', 'infrastructure'] as const;
    
    for (const category of categories) {
      const categoryContracts = deployment.contracts[category];
      if (categoryContracts) {
        for (const [contractName, contractEntry] of Object.entries(categoryContracts)) {
          const contract = this.convertToContractType(deployment, contractName, contractEntry);
          if (contract) {
            contracts.push(contract);
          }
        }
      }
    }

    // Handle legacy contracts (which map to current contracts)
    if (deployment.contracts.legacy) {
      for (const [legacyName] of Object.entries(deployment.contracts.legacy)) {
        // Only add if not already included under current name
        if (!contracts.find(c => c.contractName === legacyName)) {
          const contract = this.extractContractFromUnifiedDeployment(deployment, legacyName);
          if (contract) {
            // Use the legacy name for the contract
            contract.contractName = legacyName;
            contracts.push(contract);
          }
        }
      }
    }

    return contracts;
  }

  private convertToContractType(deployment: UnifiedJSONDeployment, contractName: string, contractEntry: ContractEntry): ContractType | null {
    if (!contractEntry.proxy || !contractEntry.implementation) {
      return null;
    }

    // Get timestamp from contract or deployment metadata
    let timestamp = Date.now();
    if (contractEntry.timestamp) {
      timestamp = contractEntry.timestamp;
    } else if (contractEntry.deployedAt) {
      timestamp = new Date(contractEntry.deployedAt).getTime();
    } else if (deployment.metadata.timestamp) {
      timestamp = new Date(deployment.metadata.timestamp).getTime();
    }

    return {
      contractName,
      chainId: deployment.chainId,
      networkName: deployment.network,
      address: contractEntry.implementation,
      proxyAddress: contractEntry.proxy !== contractEntry.implementation ? contractEntry.proxy : undefined,
      factoryByteCodeHash: deployment.factoryBytecodeHashes?.[contractName] || '',
      implementationHash: deployment.implementationHashes?.[contractName],
      deploymentArgs: [], // Not available in unified format
      timestamp
    };
  }

  private async getAllChainIds(): Promise<number[]> {
    try {
      const files = await fs.readdir(this.basePath);
      const chainIds: number[] = [];

      for (const file of files) {
        if (file.endsWith('.unified.json')) {
          const networkName = file.replace('.unified.json', '');
          const chainId = Object.entries(this.NETWORK_MAP).find(([_, name]) => name === networkName)?.[0];
          if (chainId) {
            chainIds.push(parseInt(chainId, 10));
          }
        }
      }

      return chainIds.sort((a, b) => a - b);
    } catch {
      return [];
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

  private updateReadMetrics(latency: number, hasError: boolean): void {
    this.metrics.readLatency = (this.metrics.readLatency + latency) / 2;
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