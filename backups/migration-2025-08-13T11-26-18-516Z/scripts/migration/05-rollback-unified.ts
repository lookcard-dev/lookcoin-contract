#!/usr/bin/env tsx

/**
 * Unified Schema Rollback Script
 * 
 * This script provides rollback capabilities for the unified schema migration.
 * It can restore the original fragmented files from backups or regenerate them
 * from the unified format if needed.
 * 
 * Features:
 * - Restore from automatic backups
 * - Split unified files back to fragmented format
 * - Verify data integrity after rollback
 * - Support for partial rollbacks
 * 
 * Usage:
 *   tsx scripts/migration/05-rollback-unified.ts [options]
 * 
 * Options:
 *   --network <name>    Rollback specific network
 *   --all              Rollback all networks
 *   --from-backup      Use backup files (default)
 *   --from-unified     Split unified back to fragments
 *   --verify           Verify data after rollback
 *   --dry-run          Simulate rollback without changes
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { 
  UnifiedDeployment,
  isUnifiedDeployment
} from '../../schemas/unified-deployment-schema';

interface RollbackConfig {
  network?: string;
  all: boolean;
  fromBackup: boolean;
  fromUnified: boolean;
  verify: boolean;
  dryRun: boolean;
  verbose: boolean;
  deploymentsDir: string;
  backupDir: string;
  unifiedDir: string;
}

interface RollbackResult {
  network: string;
  success: boolean;
  method: 'backup' | 'split' | 'none';
  filesRestored: string[];
  errors: string[];
  warnings: string[];
}

class UnifiedRollback {
  private config: RollbackConfig;
  private results: RollbackResult[] = [];

  constructor(config: RollbackConfig) {
    this.config = config;
  }

  async rollback(): Promise<void> {
    console.log('🔄 Starting Unified Schema Rollback...\n');
    
    // Get networks to rollback
    const networks = await this.getNetworksToRollback();
    
    if (networks.length === 0) {
      console.log('❌ No networks found to rollback');
      return;
    }
    
    console.log(`📦 Found ${networks.length} network(s) to rollback: ${networks.join(', ')}\n`);
    
    // Process each network
    for (const network of networks) {
      await this.rollbackNetwork(network);
    }
    
    // Verify if requested
    if (this.config.verify && !this.config.dryRun) {
      await this.verifyRollback();
    }
    
    // Print summary
    this.printSummary();
  }

  private async getNetworksToRollback(): Promise<string[]> {
    if (this.config.network) {
      return [this.config.network];
    }
    
    if (this.config.all) {
      // Find all unified files
      try {
        const files = await fs.readdir(this.config.unifiedDir);
        const networks = files
          .filter(f => f.endsWith('.unified.json'))
          .map(f => f.replace('.unified.json', ''));
        return networks;
      } catch {
        console.warn('⚠️  No unified directory found');
        return [];
      }
    }
    
    return [];
  }

  private async rollbackNetwork(network: string): Promise<void> {
    console.log(`\n🌐 Rolling back ${network}...`);
    console.log('=' .repeat(50));
    
    const result: RollbackResult = {
      network,
      success: false,
      method: 'none',
      filesRestored: [],
      errors: [],
      warnings: []
    };
    
    try {
      // Determine rollback method
      if (this.config.fromBackup) {
        await this.rollbackFromBackup(network, result);
      } else if (this.config.fromUnified) {
        await this.rollbackFromUnified(network, result);
      } else {
        // Auto-detect best method
        const hasBackup = await this.hasBackup(network);
        if (hasBackup) {
          await this.rollbackFromBackup(network, result);
        } else {
          await this.rollbackFromUnified(network, result);
        }
      }
      
      if (result.filesRestored.length > 0) {
        result.success = true;
        console.log(`  ✅ Rollback completed successfully`);
        console.log(`     Method: ${result.method}`);
        console.log(`     Files restored: ${result.filesRestored.length}`);
      } else {
        console.log(`  ⚠️  No files to rollback`);
      }
      
    } catch (error) {
      result.errors.push(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`  ❌ Error: ${result.errors[result.errors.length - 1]}`);
    }
    
    this.results.push(result);
  }

  private async rollbackFromBackup(network: string, result: RollbackResult): Promise<void> {
    console.log(`  📂 Looking for backup files...`);
    
    // Find most recent backup
    const backups = await this.findBackups(network);
    
    if (backups.length === 0) {
      result.warnings.push('No backup files found');
      console.log(`  ⚠️  No backup files found for ${network}`);
      
      // Try unified split as fallback
      if (await this.hasUnifiedFile(network)) {
        console.log(`  🔄 Falling back to unified split method`);
        await this.rollbackFromUnified(network, result);
      }
      return;
    }
    
    const latestBackup = backups[0]; // Sorted by date, most recent first
    console.log(`  💾 Found backup: ${path.basename(latestBackup.dir)}`);
    
    // Restore files from backup
    for (const file of latestBackup.files) {
      const sourcePath = path.join(latestBackup.dir, file);
      const destPath = path.join(this.config.deploymentsDir, file);
      
      if (this.config.dryRun) {
        console.log(`  🔍 [DRY RUN] Would restore: ${file}`);
      } else {
        await fs.copyFile(sourcePath, destPath);
        console.log(`  ✅ Restored: ${file}`);
      }
      
      result.filesRestored.push(file);
    }
    
    result.method = 'backup';
  }

  private async rollbackFromUnified(network: string, result: RollbackResult): Promise<void> {
    console.log(`  📄 Splitting unified file back to fragments...`);
    
    const unifiedPath = path.join(this.config.unifiedDir, `${network}.unified.json`);
    
    try {
      const content = await fs.readFile(unifiedPath, 'utf-8');
      const unified = JSON.parse(content) as UnifiedDeployment;
      
      if (!isUnifiedDeployment(unified)) {
        result.errors.push('Invalid unified deployment file');
        return;
      }
      
      // Generate standard deployment file
      const standard = this.generateStandardFile(unified);
      const standardPath = path.join(this.config.deploymentsDir, `${network}.json`);
      
      if (this.config.dryRun) {
        console.log(`  🔍 [DRY RUN] Would create: ${network}.json`);
        if (this.config.verbose) {
          console.log(JSON.stringify(standard, null, 2).substring(0, 300) + '...');
        }
      } else {
        await fs.writeFile(standardPath, JSON.stringify(standard, null, 2), 'utf-8');
        console.log(`  ✅ Created: ${network}.json`);
        result.filesRestored.push(`${network}.json`);
      }
      
      // Generate config file if needed
      if (unified.topology && unified.configuration) {
        const config = this.generateConfigFile(unified);
        const configPath = path.join(this.config.deploymentsDir, `config-${network}.json`);
        
        if (this.config.dryRun) {
          console.log(`  🔍 [DRY RUN] Would create: config-${network}.json`);
        } else {
          await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
          console.log(`  ✅ Created: config-${network}.json`);
          result.filesRestored.push(`config-${network}.json`);
        }
      }
      
      // Generate enhanced file if it had rich data
      if (this.hasEnhancedData(unified)) {
        const enhanced = this.generateEnhancedFile(unified);
        const enhancedPath = path.join(this.config.deploymentsDir, `enhanced-${network}.json`);
        
        if (this.config.dryRun) {
          console.log(`  🔍 [DRY RUN] Would create: enhanced-${network}.json`);
        } else {
          await fs.writeFile(enhancedPath, JSON.stringify(enhanced, null, 2), 'utf-8');
          console.log(`  ✅ Created: enhanced-${network}.json`);
          result.filesRestored.push(`enhanced-${network}.json`);
        }
      }
      
      result.method = 'split';
      
    } catch (error) {
      result.errors.push(`Failed to split unified file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private generateStandardFile(unified: UnifiedDeployment): any {
    const standard: any = {
      network: unified.network,
      chainId: unified.chainId,
      deployer: unified.metadata.deployer,
      timestamp: unified.metadata.timestamp,
      deploymentMode: unified.metadata.deploymentMode,
      protocolsDeployed: unified.metadata.protocolsDeployed,
      contracts: {},
      config: {
        governanceVault: unified.configuration.governance.vault
      },
      implementationHashes: unified.verification.implementationHashes,
      lastDeployed: unified.metadata.timestamp
    };
    
    // Convert contracts back to flat structure
    if (unified.contracts.core) {
      Object.entries(unified.contracts.core).forEach(([name, contract]) => {
        standard.contracts[name] = {
          proxy: contract.proxy,
          implementation: contract.implementation
        };
      });
    }
    
    if (unified.contracts.protocol) {
      Object.entries(unified.contracts.protocol).forEach(([name, contract]) => {
        standard.contracts[name] = {
          proxy: contract.proxy,
          implementation: contract.implementation,
          address: contract.address
        };
        
        // Add to protocol contracts mapping
        if (!standard.protocolContracts) {
          standard.protocolContracts = {};
        }
        const key = name.replace('Module', '').toLowerCase() + 'Module';
        standard.protocolContracts[key] = contract.proxy || contract.address;
      });
    }
    
    if (unified.contracts.infrastructure) {
      Object.entries(unified.contracts.infrastructure).forEach(([name, contract]) => {
        // Use fully qualified name for CrossChainRouter
        const contractKey = name === 'CrossChainRouter' 
          ? 'contracts/xchain/CrossChainRouter.sol:CrossChainRouter'
          : name;
        
        standard.contracts[contractKey] = {
          proxy: contract.proxy,
          implementation: contract.implementation
        };
        
        // Add to infrastructure contracts mapping
        if (!standard.infrastructureContracts) {
          standard.infrastructureContracts = {};
        }
        const key = name.charAt(0).toLowerCase() + name.slice(1);
        standard.infrastructureContracts[key] = contract.proxy;
      });
    }
    
    // Add protocol endpoints
    if (unified.configuration.protocols.layerZero) {
      standard.config.layerZeroEndpoint = unified.configuration.protocols.layerZero.endpoint;
    }
    
    if (unified.configuration.protocols.celer) {
      standard.config.celerMessageBus = unified.configuration.protocols.celer.messageBus;
    }
    
    // Add last upgraded timestamp if available
    const lastUpgrade = unified.operations?.upgradeHistory?.slice(-1)[0];
    if (lastUpgrade) {
      standard.lastUpgraded = lastUpgrade.timestamp;
    } else {
      standard.lastUpgraded = unified.metadata.lastUpdated;
    }
    
    return standard;
  }

  private generateConfigFile(unified: UnifiedDeployment): any {
    const config: any = {
      chainId: unified.chainId,
      network: unified.network,
      networkTier: unified.networkTier,
      deploymentMode: unified.metadata.deploymentMode,
      timestamp: unified.topology.configurationStatus.lastConfigured,
      tierValidation: unified.topology.tierValidation,
      protocolsConfigured: [],
      layerZeroRemotes: [],
      celerRemotes: [],
      hyperlaneRemotes: []
    };
    
    // Protocol configuration status
    for (const protocol of unified.metadata.protocolsEnabled) {
      config.protocolsConfigured.push({
        protocol: protocol.charAt(0).toUpperCase() + protocol.slice(1),
        configured: unified.metadata.protocolsConfigured.includes(protocol),
        details: unified.metadata.protocolsConfigured.includes(protocol) 
          ? 'Already configured' 
          : 'Pending configuration'
      });
    }
    
    // Extract remotes
    if (unified.configuration.protocols.layerZero?.remotes) {
      config.layerZeroRemotes = unified.configuration.protocols.layerZero.remotes.map(r => ({
        chainId: r.chainId,
        networkTier: r.networkTier,
        lookCoin: r.lookCoin
      }));
    }
    
    if (unified.configuration.protocols.celer?.remotes) {
      config.celerRemotes = unified.configuration.protocols.celer.remotes.map(r => ({
        chainId: r.chainId,
        networkTier: r.networkTier,
        lookCoin: r.lookCoin
      }));
    }
    
    if (unified.configuration.protocols.hyperlane?.remotes) {
      config.hyperlaneRemotes = unified.configuration.protocols.hyperlane.remotes.map(r => ({
        chainId: r.chainId,
        networkTier: r.networkTier,
        lookCoin: r.lookCoin
      }));
    }
    
    // Supply oracle config
    if (unified.configuration.supplyOracle) {
      config.supplyOracleConfig = {
        reconciliationInterval: `${unified.configuration.supplyOracle.reconciliationInterval} seconds`,
        toleranceThreshold: `${unified.configuration.supplyOracle.toleranceThreshold} basis points`
      };
    }
    
    // Hyperlane status
    if (unified.configuration.protocols.hyperlane) {
      config.hyperlaneStatus = unified.configuration.protocols.hyperlane.status || 'not ready';
    }
    
    return config;
  }

  private generateEnhancedFile(unified: UnifiedDeployment): any {
    return {
      schemaVersion: '2.0.0',
      network: unified.network,
      chainId: unified.chainId,
      metadata: {
        deployer: unified.metadata.deployer,
        timestamp: unified.metadata.timestamp,
        lastUpdated: unified.metadata.lastUpdated,
        deploymentMode: unified.metadata.deploymentMode,
        protocolsEnabled: unified.metadata.protocolsEnabled,
        networkTier: unified.networkTier,
        migrationHistory: unified.metadata.migrationHistory.filter(m => m.to !== '3.0.0')
      },
      contracts: {
        core: unified.contracts.core,
        protocol: unified.contracts.protocol || {},
        infrastructure: unified.contracts.infrastructure || {}
      },
      configuration: unified.configuration,
      topology: unified.topology,
      verification: unified.verification
    };
  }

  private hasEnhancedData(unified: UnifiedDeployment): boolean {
    // Check if the unified file has rich data that warrants an enhanced file
    return !!(
      unified.topology?.connectedChains?.length > 0 ||
      unified.configuration?.protocols?.layerZero?.dvnConfig ||
      unified.configuration?.protocols?.celer?.feeConfig ||
      unified.verification?.contractVerification &&
      Object.keys(unified.verification.contractVerification).length > 0
    );
  }

  private async findBackups(network: string): Promise<Array<{ dir: string; files: string[]; timestamp: Date }>> {
    const backups: Array<{ dir: string; files: string[]; timestamp: Date }> = [];
    
    try {
      const dirs = await fs.readdir(this.config.backupDir);
      
      for (const dir of dirs) {
        if (dir.includes(network)) {
          const dirPath = path.join(this.config.backupDir, dir);
          const stat = await fs.stat(dirPath);
          
          if (stat.isDirectory()) {
            const files = await fs.readdir(dirPath);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            
            if (jsonFiles.length > 0) {
              // Extract timestamp from directory name
              const timestampMatch = dir.match(/(\d{4}-\d{2}-\d{2}T[\d-]+Z)/);
              const timestamp = timestampMatch 
                ? new Date(timestampMatch[1].replace(/-/g, ':'))
                : stat.mtime;
              
              backups.push({
                dir: dirPath,
                files: jsonFiles,
                timestamp
              });
            }
          }
        }
      }
      
      // Sort by timestamp, most recent first
      backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
    } catch {
      // Backup directory might not exist
    }
    
    return backups;
  }

  private async hasBackup(network: string): Promise<boolean> {
    const backups = await this.findBackups(network);
    return backups.length > 0;
  }

  private async hasUnifiedFile(network: string): Promise<boolean> {
    const unifiedPath = path.join(this.config.unifiedDir, `${network}.unified.json`);
    try {
      await fs.access(unifiedPath);
      return true;
    } catch {
      return false;
    }
  }

  private async verifyRollback(): Promise<void> {
    console.log('\n🔍 Verifying rollback integrity...');
    
    for (const result of this.results) {
      if (!result.success) continue;
      
      console.log(`\n  Verifying ${result.network}:`);
      
      for (const file of result.filesRestored) {
        const filePath = path.join(this.config.deploymentsDir, file);
        
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);
          
          // Basic validation
          if (data.chainId && data.network) {
            console.log(`    ✅ ${file} - Valid structure`);
          } else {
            console.log(`    ⚠️  ${file} - Missing required fields`);
            result.warnings.push(`${file} may be incomplete`);
          }
        } catch (error) {
          console.log(`    ❌ ${file} - Invalid JSON`);
          result.errors.push(`${file} verification failed`);
        }
      }
    }
  }

  private printSummary(): void {
    console.log('\n' + '=' .repeat(70));
    console.log('📊 ROLLBACK SUMMARY');
    console.log('=' .repeat(70));
    
    const successful = this.results.filter(r => r.success);
    const failed = this.results.filter(r => !r.success);
    
    console.log(`\n✅ Successful: ${successful.length}`);
    successful.forEach(r => {
      console.log(`   ${r.network}: ${r.filesRestored.length} files restored (${r.method})`);
    });
    
    if (failed.length > 0) {
      console.log(`\n❌ Failed: ${failed.length}`);
      failed.forEach(r => {
        console.log(`   ${r.network}: ${r.errors.join(', ')}`);
      });
    }
    
    // Warnings
    const warnings = this.results.flatMap(r => r.warnings);
    if (warnings.length > 0) {
      console.log(`\n⚠️  Warnings:`);
      warnings.forEach(w => console.log(`   ${w}`));
    }
    
    if (this.config.dryRun) {
      console.log('\n⚠️  This was a DRY RUN - no files were actually changed');
    } else {
      console.log('\n💡 Tip: Run validation script to ensure data integrity');
    }
    
    console.log('\n' + '=' .repeat(70));
  }
}

// Parse command line arguments
function parseArgs(): RollbackConfig {
  const args = process.argv.slice(2);
  const config: RollbackConfig = {
    all: false,
    fromBackup: true,
    fromUnified: false,
    verify: false,
    dryRun: false,
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
      case '--from-backup':
        config.fromBackup = true;
        config.fromUnified = false;
        break;
      case '--from-unified':
        config.fromUnified = true;
        config.fromBackup = false;
        break;
      case '--verify':
        config.verify = true;
        break;
      case '--dry-run':
        config.dryRun = true;
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
Unified Schema Rollback Script

Rolls back the unified schema migration to the original fragmented files.

Usage:
  tsx scripts/migration/05-rollback-unified.ts [options]

Options:
  --network <name>    Rollback a specific network
  --all              Rollback all networks
  --from-backup      Restore from backup files (default)
  --from-unified     Split unified files back to fragments
  --verify           Verify data integrity after rollback
  --dry-run          Simulate rollback without changes
  --verbose          Show detailed output
  --help             Show this help message

Examples:
  # Rollback specific network from backup
  tsx scripts/migration/05-rollback-unified.ts --network bscmainnet
  
  # Rollback all networks with verification
  tsx scripts/migration/05-rollback-unified.ts --all --verify
  
  # Split unified back to fragments (no backup)
  tsx scripts/migration/05-rollback-unified.ts --all --from-unified
  
  # Dry run to see what would happen
  tsx scripts/migration/05-rollback-unified.ts --all --dry-run

Notes:
  - Backups are automatically created during migration
  - If no backup exists, the script will split the unified file
  - Always verify data integrity after rollback
`);
}

// Main execution
async function main(): Promise<void> {
  try {
    const config = parseArgs();
    const rollback = new UnifiedRollback(config);
    await rollback.rollback();
    
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