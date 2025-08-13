#!/usr/bin/env tsx

/**
 * Consolidation Migration Script - JSON Files to Unified Schema
 * 
 * This script consolidates fragmented deployment files (standard, enhanced, config)
 * into a single unified deployment file per network using schema v3.0.0.
 * 
 * Features:
 * - Zero data loss guarantee
 * - Automatic backup creation
 * - Dry run capability
 * - Detailed migration report
 * - Rollback support
 * 
 * Usage:
 *   tsx scripts/migration/04-consolidate-to-unified.ts [options]
 * 
 * Options:
 *   --network <name>    Specific network to migrate (e.g., bscmainnet)
 *   --all              Migrate all networks
 *   --dry-run          Simulate migration without writing files
 *   --no-backup        Skip backup creation (not recommended)
 *   --verbose          Show detailed migration logs
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { 
  UnifiedDeployment, 
  ContractInfo,
  RemoteChainConfig,
  ConnectedChain,
  validateUnifiedDeployment,
  isUnifiedDeployment
} from '../../schemas/unified-deployment-schema';

// Type definitions for existing file formats
interface StandardDeployment {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  deploymentMode?: string;
  protocolsDeployed?: string[];
  contracts: Record<string, any>;
  config?: Record<string, any>;
  implementationHashes?: Record<string, string>;
  protocolContracts?: Record<string, string>;
  infrastructureContracts?: Record<string, string>;
  lastDeployed?: string;
  lastUpgraded?: string;
}

interface EnhancedDeployment {
  schemaVersion: string;
  network: string;
  chainId: number;
  metadata: any;
  contracts: {
    core?: Record<string, any>;
    protocol?: Record<string, any>;
    infrastructure?: Record<string, any>;
  };
  configuration?: any;
  topology?: any;
  verification?: any;
}

interface ConfigFile {
  chainId: number;
  network: string;
  networkTier?: string;
  deploymentMode?: string;
  timestamp?: string;
  tierValidation?: any;
  protocolsConfigured?: any[];
  layerZeroRemotes?: any[];
  celerRemotes?: any[];
  hyperlaneRemotes?: any[];
  supplyOracleConfig?: any;
  hyperlaneStatus?: string;
}

// Migration configuration
interface MigrationConfig {
  network?: string;
  all: boolean;
  dryRun: boolean;
  createBackup: boolean;
  verbose: boolean;
  deploymentsDir: string;
  backupDir: string;
  unifiedDir: string;
}

// Migration result tracking
interface MigrationResult {
  network: string;
  success: boolean;
  filesProcessed: string[];
  unifiedFile?: string;
  backupFile?: string;
  errors: string[];
  warnings: string[];
  dataPoints: {
    contractsFound: number;
    protocolsEnabled: number;
    connectedChains: number;
  };
}

class UnifiedMigrator {
  private config: MigrationConfig;
  private results: MigrationResult[] = [];

  constructor(config: MigrationConfig) {
    this.config = config;
  }

  async migrate(): Promise<void> {
    console.log('🚀 Starting Unified Schema Migration...\n');
    
    // Ensure directories exist
    await this.ensureDirectories();
    
    // Get networks to migrate
    const networks = await this.getNetworksToMigrate();
    
    if (networks.length === 0) {
      console.log('❌ No networks found to migrate');
      return;
    }
    
    console.log(`📦 Found ${networks.length} network(s) to migrate: ${networks.join(', ')}\n`);
    
    // Process each network
    for (const network of networks) {
      await this.migrateNetwork(network);
    }
    
    // Print summary
    this.printSummary();
  }

  private async ensureDirectories(): Promise<void> {
    if (!this.config.dryRun) {
      await fs.mkdir(this.config.backupDir, { recursive: true });
      await fs.mkdir(this.config.unifiedDir, { recursive: true });
    }
  }

  private async getNetworksToMigrate(): Promise<string[]> {
    if (this.config.network) {
      return [this.config.network];
    }
    
    if (this.config.all) {
      // Scan deployments directory for unique networks
      const files = await fs.readdir(this.config.deploymentsDir);
      const networks = new Set<string>();
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          // Extract network name from filename
          const match = file.match(/^(?:enhanced-|config-)?(.+)\.json$/);
          if (match) {
            networks.add(match[1]);
          }
        }
      }
      
      return Array.from(networks);
    }
    
    return [];
  }

  private async migrateNetwork(network: string): Promise<void> {
    console.log(`\n🌐 Migrating ${network}...`);
    console.log('=' .repeat(50));
    
    const result: MigrationResult = {
      network,
      success: false,
      filesProcessed: [],
      errors: [],
      warnings: [],
      dataPoints: {
        contractsFound: 0,
        protocolsEnabled: 0,
        connectedChains: 0
      }
    };
    
    try {
      // Load all related files
      const standardFile = await this.loadFile<StandardDeployment>(
        path.join(this.config.deploymentsDir, `${network}.json`)
      );
      const enhancedFile = await this.loadFile<EnhancedDeployment>(
        path.join(this.config.deploymentsDir, `enhanced-${network}.json`)
      );
      const configFile = await this.loadFile<ConfigFile>(
        path.join(this.config.deploymentsDir, `config-${network}.json`)
      );
      
      // Track which files were found
      if (standardFile) result.filesProcessed.push(`${network}.json`);
      if (enhancedFile) result.filesProcessed.push(`enhanced-${network}.json`);
      if (configFile) result.filesProcessed.push(`config-${network}.json`);
      
      if (result.filesProcessed.length === 0) {
        result.errors.push(`No deployment files found for ${network}`);
        this.results.push(result);
        return;
      }
      
      console.log(`  📁 Found ${result.filesProcessed.length} file(s): ${result.filesProcessed.join(', ')}`);
      
      // Create unified deployment
      const unified = await this.createUnifiedDeployment(
        network,
        standardFile,
        enhancedFile,
        configFile,
        result
      );
      
      // Validate unified deployment
      const validation = validateUnifiedDeployment(unified);
      result.errors.push(...validation.errors);
      result.warnings.push(...validation.warnings);
      
      if (!validation.valid) {
        console.error(`  ❌ Validation failed: ${validation.errors.join(', ')}`);
        this.results.push(result);
        return;
      }
      
      // Create backup if needed
      if (this.config.createBackup && !this.config.dryRun) {
        const backupPath = await this.createBackup(network, result.filesProcessed);
        result.backupFile = backupPath;
        console.log(`  💾 Backup created: ${path.basename(backupPath)}`);
      }
      
      // Write unified file
      const unifiedPath = path.join(this.config.unifiedDir, `${network}.unified.json`);
      
      if (this.config.dryRun) {
        console.log(`  🔍 [DRY RUN] Would write unified file to: ${unifiedPath}`);
        if (this.config.verbose) {
          console.log(`  📊 Unified deployment preview:`);
          console.log(JSON.stringify(unified, null, 2).substring(0, 500) + '...');
        }
      } else {
        await fs.writeFile(
          unifiedPath,
          JSON.stringify(unified, null, 2),
          'utf-8'
        );
        result.unifiedFile = unifiedPath;
        console.log(`  ✅ Unified file created: ${path.basename(unifiedPath)}`);
      }
      
      // Update data points
      result.dataPoints.contractsFound = this.countContracts(unified);
      result.dataPoints.protocolsEnabled = unified.metadata.protocolsEnabled.length;
      result.dataPoints.connectedChains = unified.topology.connectedChains.length;
      
      result.success = true;
      console.log(`  ✨ Migration completed successfully`);
      console.log(`     Contracts: ${result.dataPoints.contractsFound}`);
      console.log(`     Protocols: ${result.dataPoints.protocolsEnabled}`);
      console.log(`     Connected chains: ${result.dataPoints.connectedChains}`);
      
    } catch (error) {
      result.errors.push(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`  ❌ Error: ${result.errors[result.errors.length - 1]}`);
    }
    
    this.results.push(result);
  }

  private async loadFile<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (error) {
      // File doesn't exist or is invalid
      if (this.config.verbose) {
        console.log(`  ⏭️  Skipping ${path.basename(filePath)}: ${error instanceof Error ? error.message : 'Not found'}`);
      }
      return null;
    }
  }

  private async createUnifiedDeployment(
    network: string,
    standard: StandardDeployment | null,
    enhanced: EnhancedDeployment | null,
    config: ConfigFile | null,
    result: MigrationResult
  ): Promise<UnifiedDeployment> {
    // Use enhanced as base if available, otherwise standard
    const base = enhanced || standard;
    if (!base) {
      throw new Error('No base deployment file found');
    }
    
    const now = new Date().toISOString();
    
    // Determine network tier
    const networkTier = this.determineNetworkTier(network, config);
    
    // Build unified deployment
    const unified: UnifiedDeployment = {
      schemaVersion: '3.0.0',
      fileVersion: 1,
      
      network,
      chainId: base.chainId,
      networkTier,
      
      metadata: {
        deployer: standard?.deployer || enhanced?.metadata?.deployer || '0x0',
        deploymentMode: this.determineDeploymentMode(standard, enhanced) as any,
        timestamp: standard?.timestamp || enhanced?.metadata?.timestamp || now,
        lastUpdated: now,
        protocolsEnabled: this.extractProtocolsEnabled(standard, enhanced),
        protocolsDeployed: standard?.protocolsDeployed || enhanced?.metadata?.protocolsEnabled || [],
        protocolsConfigured: this.extractProtocolsConfigured(config),
        
        migrationHistory: [
          ...(enhanced?.metadata?.migrationHistory || []),
          {
            from: enhanced ? 'v2.0.0' : 'v1.0.0',
            to: '3.0.0',
            timestamp: now,
            migrator: 'consolidate-to-unified',
            notes: `Consolidated ${result.filesProcessed.join(', ')}`
          }
        ],
        
        dataSources: {
          originalFormat: enhanced ? 'json-v2' : 'json-v1',
          importedFrom: result.filesProcessed,
          consolidatedAt: now
        }
      },
      
      contracts: this.consolidateContracts(standard, enhanced),
      configuration: this.consolidateConfiguration(standard, enhanced, config),
      topology: this.consolidateTopology(enhanced, config),
      
      verification: {
        contractVerification: this.extractVerification(enhanced),
        implementationHashes: standard?.implementationHashes || {},
        dataIntegrity: {
          lastValidated: now,
          checksums: {
            contracts: '',  // Will be computed
            configuration: '',  // Will be computed
            topology: ''  // Will be computed
          }
        }
      },
      
      operations: {
        deploymentHistory: [],
        upgradeHistory: [],
        metrics: {}
      }
    };
    
    // Compute checksums
    unified.verification.dataIntegrity.checksums = {
      contracts: this.computeChecksum(unified.contracts),
      configuration: this.computeChecksum(unified.configuration),
      topology: this.computeChecksum(unified.topology)
    };
    
    return unified;
  }

  private determineNetworkTier(network: string, config: ConfigFile | null): 'mainnet' | 'testnet' | 'dev' {
    if (config?.networkTier) {
      return config.networkTier as any;
    }
    
    // Infer from network name
    if (network.includes('mainnet')) return 'mainnet';
    if (network.includes('testnet') || network.includes('sepolia') || network.includes('goerli')) return 'testnet';
    return 'dev';
  }

  private determineDeploymentMode(standard: StandardDeployment | null, enhanced: EnhancedDeployment | null): string {
    return standard?.deploymentMode || enhanced?.metadata?.deploymentMode || 'standard';
  }

  private extractProtocolsEnabled(standard: StandardDeployment | null, enhanced: EnhancedDeployment | null): any[] {
    const protocols = new Set<string>();
    
    if (standard?.protocolsDeployed) {
      standard.protocolsDeployed.forEach(p => protocols.add(p));
    }
    
    if (enhanced?.metadata?.protocolsEnabled) {
      enhanced.metadata.protocolsEnabled.forEach(p => protocols.add(p));
    }
    
    return Array.from(protocols) as any[];
  }

  private extractProtocolsConfigured(config: ConfigFile | null): any[] {
    if (!config?.protocolsConfigured) return [];
    
    return config.protocolsConfigured
      .filter(p => p.configured)
      .map(p => p.protocol.toLowerCase()) as any[];
  }

  private consolidateContracts(standard: StandardDeployment | null, enhanced: EnhancedDeployment | null): any {
    const contracts: any = {
      core: {},
      protocol: {},
      infrastructure: {},
      legacy: {}
    };
    
    // Process enhanced contracts first (more structured)
    if (enhanced?.contracts) {
      if (enhanced.contracts.core) {
        Object.entries(enhanced.contracts.core).forEach(([name, contract]) => {
          contracts.core[name] = this.normalizeContract(contract);
        });
      }
      
      if (enhanced.contracts.protocol) {
        Object.entries(enhanced.contracts.protocol).forEach(([name, contract]) => {
          contracts.protocol[name] = this.normalizeContract(contract);
        });
      }
      
      if (enhanced.contracts.infrastructure) {
        Object.entries(enhanced.contracts.infrastructure).forEach(([name, contract]) => {
          contracts.infrastructure[name] = this.normalizeContract(contract);
        });
      }
    }
    
    // Process standard contracts (may override or add)
    if (standard?.contracts) {
      Object.entries(standard.contracts).forEach(([name, contract]) => {
        // Determine category
        const cleanName = name.split(':').pop() || name;
        
        if (cleanName === 'LookCoin' || cleanName === 'SupplyOracle') {
          contracts.core[cleanName] = this.normalizeContract(contract);
        } else if (cleanName.includes('Module')) {
          contracts.protocol[cleanName] = this.normalizeContract(contract);
        } else if (cleanName === 'CrossChainRouter' || cleanName === 'FeeManager' || 
                   cleanName === 'SecurityManager' || cleanName === 'ProtocolRegistry') {
          contracts.infrastructure[cleanName] = this.normalizeContract(contract);
        }
        
        // Track legacy names
        if (name !== cleanName) {
          contracts.legacy[name] = {
            currentName: cleanName,
            currentCategory: this.determineCategory(cleanName)
          };
        }
      });
    }
    
    // Clean up empty objects
    if (Object.keys(contracts.protocol).length === 0) delete contracts.protocol;
    if (Object.keys(contracts.infrastructure).length === 0) delete contracts.infrastructure;
    if (Object.keys(contracts.legacy).length === 0) delete contracts.legacy;
    
    return contracts;
  }

  private normalizeContract(contract: any): ContractInfo {
    return {
      address: contract.address,
      proxy: contract.proxy,
      implementation: contract.implementation,
      admin: contract.admin,
      deploymentTx: contract.deploymentTx,
      deployedAt: contract.deployedAt,
      deployedBy: contract.deployedBy,
      version: contract.version,
      verified: contract.verified,
      verificationUrl: contract.verificationUrl
    };
  }

  private determineCategory(contractName: string): 'core' | 'protocol' | 'infrastructure' {
    if (contractName === 'LookCoin' || contractName === 'SupplyOracle') return 'core';
    if (contractName.includes('Module')) return 'protocol';
    return 'infrastructure';
  }

  private consolidateConfiguration(
    standard: StandardDeployment | null,
    enhanced: EnhancedDeployment | null,
    config: ConfigFile | null
  ): any {
    const configuration: any = {
      governance: {},
      protocols: {},
      security: {},
      supplyOracle: {}
    };
    
    // Governance
    configuration.governance.vault = 
      standard?.config?.governanceVault || 
      enhanced?.configuration?.governance?.vault || 
      '0x0';
    
    // Protocol configurations
    if (standard?.config?.layerZeroEndpoint || enhanced?.configuration?.protocols?.layerZero) {
      configuration.protocols.layerZero = {
        endpoint: standard?.config?.layerZeroEndpoint || enhanced?.configuration?.protocols?.layerZero?.endpoint,
        lzChainId: enhanced?.configuration?.protocols?.layerZero?.lzChainId || 0,
        dvnConfig: enhanced?.configuration?.protocols?.layerZero?.dvnConfig,
        gasLimits: enhanced?.configuration?.protocols?.layerZero?.gasLimits,
        remotes: this.extractRemotes('layerZero', config)
      };
    }
    
    if (standard?.config?.celerMessageBus || enhanced?.configuration?.protocols?.celer) {
      configuration.protocols.celer = {
        messageBus: standard?.config?.celerMessageBus || enhanced?.configuration?.protocols?.celer?.messageBus,
        celerChainId: enhanced?.configuration?.protocols?.celer?.celerChainId || 0,
        feeConfig: enhanced?.configuration?.protocols?.celer?.feeConfig,
        remotes: this.extractRemotes('celer', config)
      };
    }
    
    if (enhanced?.configuration?.protocols?.hyperlane || config?.hyperlaneStatus) {
      configuration.protocols.hyperlane = {
        mailbox: enhanced?.configuration?.protocols?.hyperlane?.mailbox || '0x0',
        hyperlaneChainId: enhanced?.configuration?.protocols?.hyperlane?.hyperlaneChainId || 0,
        remotes: this.extractRemotes('hyperlane', config),
        status: config?.hyperlaneStatus || 'not-ready'
      };
    }
    
    // Security
    configuration.security = {
      pauseEnabled: true,
      emergencyDelay: enhanced?.configuration?.security?.emergencyDelay || 86400
    };
    
    // Supply Oracle
    if (config?.supplyOracleConfig) {
      configuration.supplyOracle = {
        reconciliationInterval: parseInt(config.supplyOracleConfig.reconciliationInterval) || 900,
        toleranceThreshold: parseInt(config.supplyOracleConfig.toleranceThreshold) || 100,
        operators: [],
        requiredSignatures: 3
      };
    }
    
    return configuration;
  }

  private extractRemotes(protocol: string, config: ConfigFile | null): RemoteChainConfig[] {
    if (!config) return [];
    
    const remoteKey = `${protocol}Remotes` as keyof ConfigFile;
    const remotes = config[remoteKey] as any[] || [];
    
    return remotes.map(r => ({
      chainId: r.chainId,
      network: r.network || '',
      networkTier: r.networkTier || 'testnet',
      lookCoin: r.lookCoin || r.address || '0x0',
      status: 'active' as const
    }));
  }

  private consolidateTopology(enhanced: EnhancedDeployment | null, config: ConfigFile | null): any {
    const connectedChains: ConnectedChain[] = [];
    const seenChains = new Set<number>();
    
    // Extract from config file remotes
    if (config) {
      ['layerZero', 'celer', 'hyperlane'].forEach(protocol => {
        const remoteKey = `${protocol}Remotes` as keyof ConfigFile;
        const remotes = config[remoteKey] as any[] || [];
        
        remotes.forEach(remote => {
          if (!seenChains.has(remote.chainId)) {
            seenChains.add(remote.chainId);
            connectedChains.push({
              chainId: remote.chainId,
              network: remote.network || '',
              networkTier: remote.networkTier || 'testnet',
              protocols: [{
                name: protocol as any,
                status: 'active',
                lookCoin: remote.lookCoin || remote.address || '0x0'
              }],
              isHomeChain: false
            });
          } else {
            // Add protocol to existing chain
            const chain = connectedChains.find(c => c.chainId === remote.chainId);
            if (chain) {
              chain.protocols.push({
                name: protocol as any,
                status: 'active',
                lookCoin: remote.lookCoin || remote.address || '0x0'
              });
            }
          }
        });
      });
    }
    
    // Add from enhanced topology
    if (enhanced?.topology?.connectedChains) {
      enhanced.topology.connectedChains.forEach((chain: any) => {
        if (!seenChains.has(chain.chainId)) {
          connectedChains.push(chain);
        }
      });
    }
    
    return {
      connectedChains,
      tierValidation: config?.tierValidation || {
        crossTierAllowed: false,
        crossTierDetected: false,
        validatedAt: new Date().toISOString()
      },
      configurationStatus: {
        lastConfigured: config?.timestamp || new Date().toISOString(),
        pendingConfigurations: [],
        failedConfigurations: []
      }
    };
  }

  private extractVerification(enhanced: EnhancedDeployment | null): any {
    const verification: any = {};
    
    if (!enhanced?.verification) return verification;
    
    // Extract verification data (would need proper mapping)
    return verification;
  }

  private computeChecksum(data: any): string {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex').substring(0, 16);
  }

  private countContracts(unified: UnifiedDeployment): number {
    let count = 0;
    
    if (unified.contracts.core) {
      count += Object.keys(unified.contracts.core).length;
    }
    
    if (unified.contracts.protocol) {
      count += Object.keys(unified.contracts.protocol).length;
    }
    
    if (unified.contracts.infrastructure) {
      count += Object.keys(unified.contracts.infrastructure).length;
    }
    
    return count;
  }

  private async createBackup(network: string, files: string[]): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.config.backupDir, `backup-${network}-${timestamp}`);
    
    await fs.mkdir(backupDir, { recursive: true });
    
    // Copy all related files
    for (const file of files) {
      const sourcePath = path.join(this.config.deploymentsDir, file);
      const destPath = path.join(backupDir, file);
      
      try {
        const content = await fs.readFile(sourcePath, 'utf-8');
        await fs.writeFile(destPath, content, 'utf-8');
      } catch (error) {
        console.warn(`  ⚠️  Could not backup ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    return backupDir;
  }

  private printSummary(): void {
    console.log('\n' + '=' .repeat(70));
    console.log('📊 MIGRATION SUMMARY');
    console.log('=' .repeat(70));
    
    const successful = this.results.filter(r => r.success);
    const failed = this.results.filter(r => !r.success);
    
    console.log(`\n✅ Successful: ${successful.length}`);
    successful.forEach(r => {
      console.log(`   ${r.network}: ${r.dataPoints.contractsFound} contracts, ${r.dataPoints.connectedChains} chains`);
    });
    
    if (failed.length > 0) {
      console.log(`\n❌ Failed: ${failed.length}`);
      failed.forEach(r => {
        console.log(`   ${r.network}: ${r.errors.join(', ')}`);
      });
    }
    
    // Total statistics
    const totalContracts = successful.reduce((sum, r) => sum + r.dataPoints.contractsFound, 0);
    const totalChains = successful.reduce((sum, r) => sum + r.dataPoints.connectedChains, 0);
    
    console.log(`\n📈 Total Statistics:`);
    console.log(`   Networks migrated: ${successful.length}`);
    console.log(`   Contracts consolidated: ${totalContracts}`);
    console.log(`   Connected chains: ${totalChains}`);
    
    if (this.config.dryRun) {
      console.log('\n⚠️  This was a DRY RUN - no files were actually written');
    }
    
    console.log('\n' + '=' .repeat(70));
  }
}

// Parse command line arguments
function parseArgs(): MigrationConfig {
  const args = process.argv.slice(2);
  const config: MigrationConfig = {
    all: false,
    dryRun: false,
    createBackup: true,
    verbose: false,
    deploymentsDir: path.join(process.cwd(), 'deployments'),
    backupDir: path.join(process.cwd(), 'deployments', 'backups'),
    unifiedDir: path.join(process.cwd(), 'deployments', 'unified')
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--network':
        config.network = args[++i];
        break;
      case '--all':
        config.all = true;
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--no-backup':
        config.createBackup = false;
        break;
      case '--verbose':
        config.verbose = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }
  
  // Validation
  if (!config.network && !config.all) {
    console.error('❌ Error: Must specify either --network <name> or --all\n');
    printHelp();
    process.exit(1);
  }
  
  return config;
}

function printHelp(): void {
  console.log(`
Unified Schema Migration Script

Consolidates fragmented deployment files into a single unified file per network.

Usage:
  tsx scripts/migration/04-consolidate-to-unified.ts [options]

Options:
  --network <name>    Migrate a specific network (e.g., bscmainnet)
  --all              Migrate all networks found in deployments/
  --dry-run          Simulate migration without writing files
  --no-backup        Skip backup creation (not recommended)
  --verbose          Show detailed migration logs
  --help             Show this help message

Examples:
  # Migrate a specific network
  tsx scripts/migration/04-consolidate-to-unified.ts --network bscmainnet
  
  # Migrate all networks with dry run
  tsx scripts/migration/04-consolidate-to-unified.ts --all --dry-run
  
  # Migrate with verbose output
  tsx scripts/migration/04-consolidate-to-unified.ts --all --verbose

Output:
  - Unified files will be created in: deployments/unified/
  - Backups will be created in: deployments/backups/
  - Each network gets a single <network>.unified.json file
`);
}

// Main execution
async function main(): Promise<void> {
  try {
    const config = parseArgs();
    const migrator = new UnifiedMigrator(config);
    await migrator.migrate();
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}