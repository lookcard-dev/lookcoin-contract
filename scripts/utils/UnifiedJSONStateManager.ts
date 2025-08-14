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
import { existsSync } from 'fs';
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

/**
 * Get the network tier based on chain ID
 */
function getNetworkTier(chainId: number): 'mainnet' | 'testnet' | 'dev' | 'unknown' {
  // Mainnet chain IDs
  const mainnetChainIds = [56, 8453, 10, 23294, 9070]; // BSC, Base, Optimism, Sapphire, Akashic
  if (mainnetChainIds.includes(chainId)) {
    return 'mainnet';
  }

  // Testnet chain IDs  
  const testnetChainIds = [97, 84532, 11155420, 23295]; // BSC Testnet, Base Sepolia, Optimism Sepolia, Sapphire Testnet
  if (testnetChainIds.includes(chainId)) {
    return 'testnet';
  }

  // Hardhat network
  if (chainId === 31337) {
    return 'dev';
  }

  return 'unknown';
}

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
    governance?: { 
      vault?: string;
      admin?: string;
      operators?: string[];
      upgraders?: string[];
    };
    protocols?: { [protocol: string]: { [key: string]: string } };
  };
  topology?: {
    connectedChains?: number[];
    routingPaths?: any;
  };
  verification?: {
    contractVerification?: Record<string, any>;
    implementationHashes?: Record<string, string>;
  };
  implementationHashes?: { [name: string]: string };
  factoryBytecodeHashes?: { [name: string]: string };
  // Allow extended fields at root level
  [key: string]: any;
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
    23295: 'sapphiretestnet',
    23294: 'sapphiremainnet',
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
   * Store contract - updates or adds a contract in the unified deployment
   */
  async putContract(chainId: number, contract: ContractType): Promise<void> {
    await this.ensureInitialized();
    const startTime = Date.now();

    try {
      // Load existing deployment or create new one
      let deployment = await this.loadUnifiedDeployment(chainId);
      
      if (!deployment) {
        // Create new deployment structure
        deployment = this.createEmptyDeployment(chainId);
      }

      // Update the contract in the appropriate category
      const updated = this.updateContract(deployment, contract);
      
      if (!updated) {
        throw new StateManagerError(
          StateManagerErrorCode.WRITE_FAILED,
          `Failed to update contract ${contract.contractName} in deployment`,
          { chainId, contract }
        );
      }

      // Save the updated deployment
      await this.saveUnifiedDeployment(chainId, deployment);
      
      if (this.config.debugMode) {
        console.log(`[DEBUG] Stored ${contract.contractName} to Unified JSON for chain ${chainId}`);
        console.log(`[DEBUG]   - Implementation hash: ${contract.implementationHash}`);
      }

      this.updateReadMetrics(Date.now() - startTime, false);
    } catch (error) {
      this.updateReadMetrics(Date.now() - startTime, true);
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async importAll(data: string, _overwrite?: boolean): Promise<void> {
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
          const contractName = contract.contractName;
          
          // Validate contract data
          if (!this.validateContractType(contract)) {
            errors.push(`Invalid contract data: ${contractName} on chain ${chainId}`);
            continue;
          }

          // Check for missing required fields
          if (!contract.address || !contract.factoryByteCodeHash) {
            warnings.push(`Missing fields in contract: ${contractName} on chain ${chainId}`);
          }

          // Validate chainId consistency
          if (contract.chainId !== chainId) {
            errors.push(`ChainId mismatch for ${contractName}: ${contract.chainId} vs ${chainId}`);
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

    // Get bytecode hashes from extended fields or verification section
    const extendedKey = `extended_${contractName}`;
    const extendedData = (deployment as any)[extendedKey];
    
    let factoryByteCodeHash = '';
    let implementationHash = '';
    let deploymentArgs: any[] = [];
    
    // First try to get from extended fields (primary source)
    if (extendedData) {
      factoryByteCodeHash = extendedData.factoryByteCodeHash || '';
      implementationHash = extendedData.implementationHash || '';
      deploymentArgs = extendedData.deploymentArgs || [];
      // Update timestamp if available in extended data
      if (extendedData.timestamp) {
        timestamp = extendedData.timestamp;
      }
    }
    
    // Fallback to verification.implementationHashes if not in extended
    if (!implementationHash && deployment.verification?.implementationHashes?.[contractName]) {
      implementationHash = deployment.verification.implementationHashes[contractName];
      factoryByteCodeHash = factoryByteCodeHash || implementationHash; // Use same hash if factory hash not found
    }
    
    // Final fallback to old location (for backward compatibility)
    if (!implementationHash) {
      factoryByteCodeHash = deployment.factoryBytecodeHashes?.[contractName] || '';
      implementationHash = deployment.implementationHashes?.[contractName] || '';
    }

    return {
      contractName,
      chainId: deployment.chainId,
      networkName: deployment.network,
      address: contractEntry.implementation,
      proxyAddress: contractEntry.proxy !== contractEntry.implementation ? contractEntry.proxy : undefined,
      factoryByteCodeHash,
      implementationHash,
      deploymentArgs,
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
          const chainId = Object.entries(this.NETWORK_MAP).find(([, name]) => name === networkName)?.[0];
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

  /**
   * Create an empty deployment structure
   */
  private createEmptyDeployment(chainId: number): UnifiedJSONDeployment {
    const networkName = this.NETWORK_MAP[chainId] || `chain${chainId}`;
    const networkTier = getNetworkTier(chainId);
    
    return {
      schemaVersion: '3.0.0',
      fileVersion: 1,
      network: networkName,
      chainId,
      networkTier,
      metadata: {
        deployer: '',
        deploymentMode: 'standard',
        timestamp: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        protocolsEnabled: [],
        protocolsDeployed: [],
        protocolsConfigured: []
      },
      contracts: {
        core: {},
        protocol: {},
        infrastructure: {}
      },
      configuration: {
        protocols: {},
        governance: {
          admin: '',
          operators: [],
          upgraders: []
        }
      },
      topology: {
        connectedChains: [],
        routingPaths: {}
      },
      verification: {
        contractVerification: {},
        implementationHashes: {}
      }
    };
  }

  /**
   * Update a contract in the deployment structure
   */
  private updateContract(deployment: UnifiedJSONDeployment, contract: ContractType): boolean {
    const { contractName, proxyAddress, address: implementation } = contract;
    
    // Determine which category the contract belongs to
    let category: 'core' | 'protocol' | 'infrastructure' = 'core';
    
    if (contractName === 'LookCoin' || contractName === 'SupplyOracle') {
      category = 'core';
    } else if (contractName.includes('Module') || contractName === 'LayerZeroModule' || 
               contractName === 'CelerIMModule' || contractName === 'HyperlaneModule') {
      category = 'protocol';
    } else if (contractName === 'CrossChainRouter' || contractName === 'FeeManager' || 
               contractName === 'SecurityManager' || contractName === 'ProtocolRegistry') {
      category = 'infrastructure';
    }
    
    // Update the contract entry
    if (!deployment.contracts[category]) {
      deployment.contracts[category] = {};
    }
    
    deployment.contracts[category][contractName] = {
      proxy: proxyAddress || implementation,
      implementation
    };
    
    // Store extended data with bytecode hashes
    const extendedKey = `extended_${contractName}`;
    (deployment as any)[extendedKey] = {
      factoryByteCodeHash: contract.factoryByteCodeHash,
      implementationHash: contract.implementationHash,
      deploymentArgs: contract.deploymentArgs,
      timestamp: contract.timestamp
    };
    
    // Also update verification section for compatibility
    if (!deployment.verification) {
      deployment.verification = {
        contractVerification: {},
        implementationHashes: {}
      };
    }
    
    if (contract.implementationHash) {
      deployment.verification.implementationHashes![contractName] = contract.implementationHash;
    }
    
    // Update metadata
    deployment.metadata.lastUpdated = new Date().toISOString();
    
    return true;
  }

  /**
   * Save the unified deployment to disk
   */
  private async saveUnifiedDeployment(chainId: number, deployment: UnifiedJSONDeployment): Promise<void> {
    const networkName = this.NETWORK_MAP[chainId] || `chain${chainId}`;
    const filePath = path.join(this.basePath, `${networkName}.unified.json`);
    
    // Ensure directory exists
    await fs.mkdir(this.basePath, { recursive: true });
    
    // Create backup if file exists
    if (existsSync(filePath) && this.config.backupEnabled) {
      const backupPath = `${filePath}.backup-${Date.now()}`;
      try {
        await fs.copyFile(filePath, backupPath);
      } catch (error) {
        if (this.config.debugMode) {
          console.log(`[DEBUG] Failed to create backup: ${error}`);
        }
      }
    }
    
    // Save with pretty print (default to pretty print for readability)
    const content = this.config.prettyPrint !== false 
      ? JSON.stringify(deployment, null, 2)
      : JSON.stringify(deployment);
    
    // Try atomic write if configured, with fallback to direct write
    if (this.config.atomicWrites !== false) {
      const tempPath = `${filePath}.tmp-${Date.now()}`;
      try {
        // Write to temp file first
        await fs.writeFile(tempPath, content, 'utf8');
        // Rename atomically
        await fs.rename(tempPath, filePath);
      } catch (error) {
        if (this.config.debugMode) {
          console.log(`[DEBUG] Atomic write failed, falling back to direct write: ${error}`);
        }
        // Fallback to direct write
        await fs.writeFile(filePath, content, 'utf8');
        // Clean up temp file if it exists
        try {
          await fs.unlink(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    } else {
      await fs.writeFile(filePath, content, 'utf8');
    }
  }
}