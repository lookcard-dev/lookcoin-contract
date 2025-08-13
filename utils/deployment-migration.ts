/**
 * Deployment Migration and Backward Compatibility
 * 
 * Handles migration between deployment schema versions and maintains
 * backward compatibility with legacy LevelDB and JSON v1 formats.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { Level } from 'level';
import {
  EnhancedDeployment,
  DeploymentMetadata,
  ContractRegistry,
  CoreContracts,
  ProtocolContracts,
  InfrastructureContracts,
  DeploymentConfiguration,
  LegacyV1Format,
  MigrationResult,
  DeploymentMigrator,
  Protocol,
  DeploymentMode,
  NetworkTier,
  isEnhancedDeployment
} from '../types/enhanced-deployment';
import { validateEnhancedDeployment } from './enhanced-deployment-validation';
import { getAllContracts } from './state';

// ============================================================================
// Migration Interface Implementation
// ============================================================================

export class DeploymentMigrationManager implements DeploymentMigrator {
  private readonly supportedVersions = ['1.0.0', '1.1.0', '2.0.0'];

  canMigrate(data: any): boolean {
    // Check if it's already v2.0.0 enhanced format
    if (isEnhancedDeployment(data)) {
      return false; // No migration needed
    }

    // Check if it's a v1.x JSON format
    if (this.isV1Format(data)) {
      return true;
    }

    // Check if it has indicators of being migration-worthy
    return this.hasDeploymentStructure(data);
  }

  migrate(data: any): EnhancedDeployment {
    if (isEnhancedDeployment(data)) {
      return data; // Already migrated
    }

    if (this.isV1Format(data)) {
      return this.migrateFromV1(data);
    }

    throw new Error('Unsupported data format for migration');
  }

  validate(deployment: EnhancedDeployment): boolean {
    const result = validateEnhancedDeployment(deployment);
    return result.isValid;
  }

  private isV1Format(data: any): boolean {
    return (
      typeof data === 'object' &&
      data !== null &&
      typeof data.network === 'string' &&
      typeof data.chainId === 'number' &&
      typeof data.contracts === 'object' &&
      (!data.schemaVersion || data.schemaVersion.startsWith('1.'))
    );
  }

  private hasDeploymentStructure(data: any): boolean {
    return (
      typeof data === 'object' &&
      data !== null &&
      (data.network || data.chainId || data.contracts)
    );
  }

  private migrateFromV1(v1Data: any): EnhancedDeployment {
    const migrationTimestamp = new Date().toISOString();
    
    // Extract basic information
    const network = v1Data.network || 'unknown';
    const chainId = v1Data.chainId || 0;
    const deployer = v1Data.deployer || '0x0000000000000000000000000000000000000000';
    const timestamp = v1Data.timestamp || v1Data.lastDeployed || migrationTimestamp;

    // Determine deployment mode and protocols
    const { deploymentMode, protocolsEnabled } = this.analyzeV1Deployment(v1Data);

    // Build metadata
    const metadata: DeploymentMetadata = {
      deployer,
      timestamp,
      lastUpdated: migrationTimestamp,
      deploymentMode,
      protocolsEnabled,
      networkTier: this.determineNetworkTier(chainId),
      migrationHistory: [{
        from: 'v1.x',
        to: '2.0.0',
        timestamp: migrationTimestamp,
        migrator: 'DeploymentMigrationManager'
      }]
    };

    // Build contract registry
    const contracts = this.buildContractRegistry(v1Data);

    // Build configuration
    const configuration = this.buildConfiguration(v1Data);

    // Build enhanced deployment
    const enhanced: EnhancedDeployment = {
      schemaVersion: '2.0.0',
      network,
      chainId,
      metadata,
      contracts,
      configuration,
      verification: {
        implementationHashes: v1Data.implementationHashes || {}
      },
      legacy: {
        v1Compatible: this.buildLegacyCompatibility(v1Data)
      }
    };

    return enhanced;
  }

  private analyzeV1Deployment(v1Data: any): { deploymentMode: DeploymentMode; protocolsEnabled: Protocol[] } {
    const protocols: Protocol[] = [];
    
    // Check for LayerZero
    if (v1Data.config?.layerZeroEndpoint && v1Data.config.layerZeroEndpoint !== '0x0000000000000000000000000000000000000000') {
      protocols.push('layerZero');
    }

    // Check for Celer
    if (v1Data.contracts?.CelerIMModule || v1Data.config?.celerMessageBus) {
      protocols.push('celer');
    }

    // Check for infrastructure contracts (indicates multi-protocol BSC deployment)
    const hasInfrastructure = 
      v1Data.infrastructureContracts ||
      v1Data.protocolContracts ||
      (v1Data.contracts && (
        v1Data.contracts.CrossChainRouter ||
        v1Data.contracts.FeeManager ||
        v1Data.contracts.SecurityManager ||
        v1Data.contracts.ProtocolRegistry
      ));

    // Determine deployment mode
    let deploymentMode: DeploymentMode;
    if (hasInfrastructure || protocols.length > 1) {
      deploymentMode = 'multi-protocol';
    } else if (protocols.length === 0) {
      deploymentMode = 'simple';
    } else {
      deploymentMode = 'standard';
    }

    return { deploymentMode, protocolsEnabled: protocols };
  }

  private determineNetworkTier(chainId: number): NetworkTier {
    const mainnetChains = [1, 56, 8453, 10, 137, 43114, 23295];
    const testnetChains = [97, 84532, 11155420, 80001, 43113, 23294];
    
    if (mainnetChains.includes(chainId)) return 'mainnet';
    if (testnetChains.includes(chainId)) return 'testnet';
    return 'dev';
  }

  private buildContractRegistry(v1Data: any): ContractRegistry {
    // Core contracts (required)
    const core: CoreContracts = {
      LookCoin: {
        proxy: v1Data.contracts.LookCoin?.proxy || '0x0000000000000000000000000000000000000000',
        implementation: v1Data.contracts.LookCoin?.implementation || '0x0000000000000000000000000000000000000000'
      },
      SupplyOracle: {
        proxy: v1Data.contracts.SupplyOracle?.proxy || '0x0000000000000000000000000000000000000000',
        implementation: v1Data.contracts.SupplyOracle?.implementation || '0x0000000000000000000000000000000000000000'
      }
    };

    // Protocol contracts (optional)
    const protocol: ProtocolContracts = {};
    
    // LayerZero Module (direct contract, not proxy)
    if (v1Data.protocolContracts?.layerZeroModule) {
      protocol.LayerZeroModule = {
        address: v1Data.protocolContracts.layerZeroModule
      };
    }

    // Celer IM Module (proxy contract)
    if (v1Data.contracts?.CelerIMModule || v1Data.protocolContracts?.celerIMModule) {
      protocol.CelerIMModule = {
        proxy: v1Data.contracts?.CelerIMModule?.proxy || v1Data.protocolContracts?.celerIMModule || '0x0000000000000000000000000000000000000000',
        implementation: v1Data.contracts?.CelerIMModule?.implementation || '0x0000000000000000000000000000000000000000'
      };
    }

    // Infrastructure contracts (BSC only)
    const infrastructure: InfrastructureContracts = {};
    
    if (v1Data.infrastructureContracts) {
      const infra = v1Data.infrastructureContracts;
      
      if (infra.crossChainRouter) {
        infrastructure.CrossChainRouter = {
          proxy: infra.crossChainRouter,
          implementation: '0x0000000000000000000000000000000000000000' // Will be updated during deployment
        };
      }
      
      if (infra.feeManager) {
        infrastructure.FeeManager = {
          proxy: infra.feeManager,
          implementation: '0x0000000000000000000000000000000000000000'
        };
      }
      
      if (infra.securityManager) {
        infrastructure.SecurityManager = {
          proxy: infra.securityManager,
          implementation: '0x0000000000000000000000000000000000000000'
        };
      }
      
      if (infra.protocolRegistry) {
        infrastructure.ProtocolRegistry = {
          proxy: infra.protocolRegistry,
          implementation: '0x0000000000000000000000000000000000000000'
        };
      }
    }

    const registry: ContractRegistry = { core };
    
    if (Object.keys(protocol).length > 0) {
      registry.protocol = protocol;
    }
    
    if (Object.keys(infrastructure).length > 0) {
      registry.infrastructure = infrastructure;
    }

    return registry;
  }

  private buildConfiguration(v1Data: any): DeploymentConfiguration | undefined {
    const config: DeploymentConfiguration = {};

    // Governance configuration
    if (v1Data.config?.governanceVault) {
      config.governance = {
        vault: v1Data.config.governanceVault
      };
    }

    // Protocol configurations
    const protocols: any = {};
    
    if (v1Data.config?.layerZeroEndpoint) {
      protocols.layerZero = {
        endpoint: v1Data.config.layerZeroEndpoint
      };
    }
    
    if (v1Data.config?.celerMessageBus) {
      protocols.celer = {
        messageBus: v1Data.config.celerMessageBus
      };
    }

    if (Object.keys(protocols).length > 0) {
      config.protocols = protocols;
    }

    return Object.keys(config).length > 0 ? config : undefined;
  }

  private buildLegacyCompatibility(v1Data: any): LegacyV1Format {
    return {
      deployer: v1Data.deployer,
      timestamp: v1Data.timestamp || v1Data.lastDeployed,
      contracts: {
        LookCoin: v1Data.contracts?.LookCoin,
        CelerIMModule: v1Data.contracts?.CelerIMModule,
        SupplyOracle: v1Data.contracts?.SupplyOracle
      },
      config: v1Data.config,
      implementationHashes: v1Data.implementationHashes
    };
  }
}

// ============================================================================
// LevelDB Migration Support
// ============================================================================

export class LevelDBMigrator {
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || join(process.cwd(), 'leveldb');
  }

  async migrateFromLevelDB(chainId: number): Promise<EnhancedDeployment | null> {
    try {
      const contracts = await getAllContracts(chainId);
      if (contracts.length === 0) {
        return null;
      }

      const migrationTimestamp = new Date().toISOString();
      const networkName = contracts[0]?.networkName || 'unknown';

      // Build enhanced deployment from LevelDB data
      const enhanced: EnhancedDeployment = {
        schemaVersion: '2.0.0',
        network: networkName,
        chainId,
        metadata: {
          deployer: '0x0000000000000000000000000000000000000000', // Not stored in LevelDB
          timestamp: new Date(Math.min(...contracts.map(c => c.timestamp))).toISOString(),
          lastUpdated: migrationTimestamp,
          deploymentMode: this.inferDeploymentMode(contracts),
          protocolsEnabled: this.inferProtocols(contracts),
          networkTier: this.determineNetworkTier(chainId),
          migrationHistory: [{
            from: 'LevelDB',
            to: '2.0.0',
            timestamp: migrationTimestamp,
            migrator: 'LevelDBMigrator'
          }]
        },
        contracts: this.buildContractsFromLevelDB(contracts),
        verification: {
          implementationHashes: this.extractImplementationHashes(contracts)
        }
      };

      return enhanced;
    } catch (error) {
      console.error('Failed to migrate from LevelDB:', error);
      return null;
    }
  }

  private inferDeploymentMode(contracts: any[]): DeploymentMode {
    const contractNames = contracts.map(c => c.contractName);
    
    const hasInfrastructure = contractNames.some(name => 
      ['CrossChainRouter', 'FeeManager', 'SecurityManager', 'ProtocolRegistry'].includes(name)
    );
    
    const protocolCount = contractNames.filter(name =>
      ['LayerZeroModule', 'CelerIMModule', 'HyperlaneModule'].includes(name)
    ).length;

    if (hasInfrastructure || protocolCount > 1) {
      return 'multi-protocol';
    } else if (protocolCount === 0) {
      return 'simple';
    } else {
      return 'standard';
    }
  }

  private inferProtocols(contracts: any[]): Protocol[] {
    const contractNames = contracts.map(c => c.contractName);
    const protocols: Protocol[] = [];
    
    if (contractNames.includes('LayerZeroModule')) protocols.push('layerZero');
    if (contractNames.includes('CelerIMModule')) protocols.push('celer');
    if (contractNames.includes('HyperlaneModule')) protocols.push('hyperlane');
    
    return protocols;
  }

  private determineNetworkTier(chainId: number): NetworkTier {
    const mainnetChains = [1, 56, 8453, 10, 137, 43114, 23295];
    const testnetChains = [97, 84532, 11155420, 80001, 43113, 23294];
    
    if (mainnetChains.includes(chainId)) return 'mainnet';
    if (testnetChains.includes(chainId)) return 'testnet';
    return 'dev';
  }

  private buildContractsFromLevelDB(contracts: any[]): ContractRegistry {
    const registry: ContractRegistry = {
      core: {
        LookCoin: { proxy: '0x0000000000000000000000000000000000000000', implementation: '0x0000000000000000000000000000000000000000' },
        SupplyOracle: { proxy: '0x0000000000000000000000000000000000000000', implementation: '0x0000000000000000000000000000000000000000' }
      }
    };

    const protocol: ProtocolContracts = {};
    const infrastructure: InfrastructureContracts = {};

    for (const contract of contracts) {
      const entry = {
        proxy: contract.proxyAddress || contract.address,
        implementation: contract.address
      };

      switch (contract.contractName) {
        case 'LookCoin':
          registry.core.LookCoin = entry;
          break;
        case 'SupplyOracle':
          registry.core.SupplyOracle = entry;
          break;
        case 'LayerZeroModule':
          protocol.LayerZeroModule = { address: contract.address };
          break;
        case 'CelerIMModule':
          protocol.CelerIMModule = entry;
          break;
        case 'HyperlaneModule':
          protocol.HyperlaneModule = entry;
          break;
        case 'CrossChainRouter':
          infrastructure.CrossChainRouter = entry;
          break;
        case 'FeeManager':
          infrastructure.FeeManager = entry;
          break;
        case 'SecurityManager':
          infrastructure.SecurityManager = entry;
          break;
        case 'ProtocolRegistry':
          infrastructure.ProtocolRegistry = entry;
          break;
      }
    }

    if (Object.keys(protocol).length > 0) {
      registry.protocol = protocol;
    }
    
    if (Object.keys(infrastructure).length > 0) {
      registry.infrastructure = infrastructure;
    }

    return registry;
  }

  private extractImplementationHashes(contracts: any[]): Record<string, string> {
    const hashes: Record<string, string> = {};
    
    for (const contract of contracts) {
      if (contract.implementationHash) {
        hashes[contract.contractName] = contract.implementationHash;
      }
    }
    
    return hashes;
  }
}

// ============================================================================
// Migration Orchestration
// ============================================================================

export class MigrationOrchestrator {
  private jsonMigrator: DeploymentMigrationManager;
  private levelDBMigrator: LevelDBMigrator;

  constructor() {
    this.jsonMigrator = new DeploymentMigrationManager();
    this.levelDBMigrator = new LevelDBMigrator();
  }

  async migrateDeployment(source: 'json' | 'leveldb', input: any | number): Promise<MigrationResult> {
    try {
      let enhanced: EnhancedDeployment;

      if (source === 'json') {
        if (!this.jsonMigrator.canMigrate(input)) {
          return {
            success: false,
            errors: ['Input data cannot be migrated or is already in v2.0.0 format']
          };
        }
        enhanced = this.jsonMigrator.migrate(input);
      } else if (source === 'leveldb') {
        const chainId = input as number;
        const migrated = await this.levelDBMigrator.migrateFromLevelDB(chainId);
        if (!migrated) {
          return {
            success: false,
            errors: [`No LevelDB data found for chain ID ${chainId}`]
          };
        }
        enhanced = migrated;
      } else {
        return {
          success: false,
          errors: ['Invalid migration source']
        };
      }

      // Validate the migrated deployment
      const validation = validateEnhancedDeployment(enhanced);
      const warnings = validation.warnings || [];
      
      if (!validation.isValid) {
        return {
          success: false,
          deployment: enhanced,
          errors: validation.errors.map(e => typeof e === 'string' ? e : e.message),
          warnings
        };
      }

      return {
        success: true,
        deployment: enhanced,
        warnings
      };
    } catch (error) {
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown migration error']
      };
    }
  }

  async migrateAllDeployments(deploymentDir: string): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];
    
    if (!existsSync(deploymentDir)) {
      return [{
        success: false,
        errors: ['Deployment directory does not exist']
      }];
    }

    const fs = await import('fs/promises');
    const files = await fs.readdir(deploymentDir);
    
    for (const file of files) {
      if (file.endsWith('.json') && !file.includes('config') && !file.includes('enhanced')) {
        const filePath = join(deploymentDir, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);
          
          const result = await this.migrateDeployment('json', data);
          result.deployment && (result.deployment.metadata.migrationHistory = [
            ...(result.deployment.metadata.migrationHistory || []),
            { from: file, to: 'enhanced-' + file, timestamp: new Date().toISOString(), migrator: 'MigrationOrchestrator' }
          ]);
          
          results.push(result);
          
          // Save the enhanced deployment if migration succeeded
          if (result.success && result.deployment) {
            const enhancedFile = join(deploymentDir, 'enhanced-' + file);
            await fs.writeFile(enhancedFile, JSON.stringify(result.deployment, null, 2));
          }
        } catch (error) {
          results.push({
            success: false,
            errors: [`Failed to process ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`]
          });
        }
      }
    }

    return results;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

export function isLegacyDeployment(data: any): boolean {
  return new DeploymentMigrationManager().canMigrate(data);
}

export function extractLegacyCompatibility(enhanced: EnhancedDeployment): LegacyV1Format | undefined {
  return enhanced.legacy?.v1Compatible;
}

export function createBackwardCompatibleView(enhanced: EnhancedDeployment): any {
  const legacy = extractLegacyCompatibility(enhanced);
  if (!legacy) {
    // Generate from enhanced format
    return {
      network: enhanced.network,
      chainId: enhanced.chainId,
      deployer: enhanced.metadata.deployer,
      timestamp: enhanced.metadata.timestamp,
      deploymentMode: enhanced.metadata.deploymentMode,
      protocolsDeployed: enhanced.metadata.protocolsEnabled,
      contracts: {
        LookCoin: enhanced.contracts.core.LookCoin,
        SupplyOracle: enhanced.contracts.core.SupplyOracle,
        ...(enhanced.contracts.protocol?.CelerIMModule && { CelerIMModule: enhanced.contracts.protocol.CelerIMModule })
      },
      config: {
        layerZeroEndpoint: enhanced.configuration?.protocols?.layerZero?.endpoint || '0x0000000000000000000000000000000000000000',
        celerMessageBus: enhanced.configuration?.protocols?.celer?.messageBus || '0x0000000000000000000000000000000000000000',
        governanceVault: enhanced.configuration?.governance?.vault
      },
      implementationHashes: enhanced.verification?.implementationHashes
    };
  }
  return legacy;
}

// ============================================================================
// Export Main Classes
// ============================================================================

export {
  DeploymentMigrationManager,
  LevelDBMigrator,
  MigrationOrchestrator
};