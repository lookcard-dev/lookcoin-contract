#!/usr/bin/env tsx
/**
 * Data Recovery Script
 * 
 * Recovers missing fields from LevelDB backup and merges them into unified JSON files.
 * This script addresses the critical data structure issues where:
 * - factoryByteCodeHash is missing
 * - deploymentArgs are not preserved
 * - implementation field contains hash instead of address
 * - per-contract timestamps are missing
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface LevelDBContract {
  contractName: string;
  chainId: number;
  networkName: string;
  address: string;
  factoryByteCodeHash: string;
  implementationHash?: string;
  proxyAddress?: string;
  deploymentArgs?: unknown[];
  timestamp: number;
}

interface UnifiedDeployment {
  schemaVersion: string;
  network: string;
  chainId: number;
  contracts: {
    core?: Record<string, any>;
    protocol?: Record<string, any>;
    infrastructure?: Record<string, any>;
  };
  verification?: {
    implementationHashes?: Record<string, string>;
  };
  [key: string]: any;
}

class DataRecoveryTool {
  private leveldbBackupPath: string;
  private unifiedPath: string;
  private debugMode: boolean;
  private dryRun: boolean;
  private recoveryStats = {
    filesProcessed: 0,
    fieldsRecovered: 0,
    contractsUpdated: 0,
    errors: [] as string[]
  };

  constructor(options: {
    leveldbBackupPath?: string;
    unifiedPath?: string;
    debugMode?: boolean;
    dryRun?: boolean;
  } = {}) {
    const projectRoot = path.resolve(__dirname, '../..');
    this.leveldbBackupPath = options.leveldbBackupPath || 
      path.join(projectRoot, 'leveldb-analysis-report-1754996362937.json');
    this.unifiedPath = options.unifiedPath || 
      path.join(projectRoot, 'deployments/unified');
    this.debugMode = options.debugMode ?? true;
    this.dryRun = options.dryRun ?? false;
  }

  /**
   * Main recovery process
   */
  async recover(): Promise<void> {
    console.log('🔄 Starting data recovery process...');
    console.log(`📁 LevelDB backup: ${this.leveldbBackupPath}`);
    console.log(`📁 Unified directory: ${this.unifiedPath}`);
    console.log(`🏃 Mode: ${this.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log('');

    try {
      // Load LevelDB backup
      const leveldbData = await this.loadLevelDBBackup();
      if (!leveldbData) {
        throw new Error('Failed to load LevelDB backup');
      }

      // Process each network
      for (const [network, networkData] of Object.entries(leveldbData.networks)) {
        await this.processNetwork(network, networkData);
      }

      // Print summary
      this.printSummary();

    } catch (error) {
      console.error('❌ Recovery failed:', error);
      throw error;
    }
  }

  /**
   * Load LevelDB backup data
   */
  private async loadLevelDBBackup(): Promise<any> {
    try {
      const content = await fs.readFile(this.leveldbBackupPath, 'utf-8');
      const data = JSON.parse(content);
      
      if (this.debugMode) {
        console.log(`✅ Loaded LevelDB backup with ${data.summary.totalEntries} entries`);
        console.log(`   Networks: ${data.summary.networksFound.join(', ')}`);
        console.log('');
      }
      
      return data;
    } catch (error) {
      console.error('❌ Failed to load LevelDB backup:', error);
      return null;
    }
  }

  /**
   * Process a single network
   */
  private async processNetwork(network: string, networkData: any): Promise<void> {
    console.log(`\n📊 Processing network: ${network} (Chain ID: ${networkData.chainId})`);
    
    // Map network names (LevelDB uses different names than unified)
    const networkMapping: Record<string, string> = {
      'optimismsepolia': 'optimismsepolia',
      'sapphiretestnet': 'sapphiremainnet', // Note: LevelDB has it as testnet but file is mainnet
      'bscmainnet': 'bscmainnet',
      'basesepolia': 'basesepolia',
      'bsctestnet': 'bsctestnet',
      'opSepolia': 'optimismsepolia'
    };

    const unifiedNetwork = networkMapping[networkData.networkName] || network;
    const unifiedFilePath = path.join(this.unifiedPath, `${unifiedNetwork}.unified.json`);

    try {
      // Load unified file
      const unified = await this.loadUnifiedFile(unifiedFilePath);
      if (!unified) {
        console.log(`   ⚠️  No unified file found for ${unifiedNetwork}, skipping`);
        return;
      }

      // Process each contract
      let updated = false;
      for (const contract of networkData.contracts) {
        if (await this.recoverContractFields(unified, contract)) {
          updated = true;
          this.recoveryStats.contractsUpdated++;
        }
      }

      // Save if updated
      if (updated && !this.dryRun) {
        await this.saveUnifiedFile(unifiedFilePath, unified);
        console.log(`   ✅ Saved updates to ${path.basename(unifiedFilePath)}`);
      } else if (updated && this.dryRun) {
        console.log(`   🔍 [DRY RUN] Would save updates to ${path.basename(unifiedFilePath)}`);
      }

      this.recoveryStats.filesProcessed++;

    } catch (error) {
      const errorMsg = `Failed to process ${network}: ${error}`;
      console.error(`   ❌ ${errorMsg}`);
      this.recoveryStats.errors.push(errorMsg);
    }
  }

  /**
   * Load unified deployment file
   */
  private async loadUnifiedFile(filePath: string): Promise<UnifiedDeployment | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        console.error(`   ❌ Error loading ${filePath}:`, error);
      }
      return null;
    }
  }

  /**
   * Save unified deployment file
   */
  private async saveUnifiedFile(filePath: string, data: UnifiedDeployment): Promise<void> {
    // Create backup first
    const backupPath = filePath.replace('.json', `.backup-${Date.now()}.json`);
    try {
      await fs.copyFile(filePath, backupPath);
      if (this.debugMode) {
        console.log(`   📋 Created backup: ${path.basename(backupPath)}`);
      }
    } catch {
      // File might not exist yet
    }

    // Save updated file
    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * Recover missing fields for a contract
   */
  private async recoverContractFields(
    unified: UnifiedDeployment, 
    leveldbContract: LevelDBContract
  ): Promise<boolean> {
    const contractName = this.cleanContractName(leveldbContract.contractName);
    let updated = false;
    let fieldsRecovered = 0;

    // Find contract in unified structure
    const contractInfo = this.findContract(unified, contractName);
    if (!contractInfo) {
      if (this.debugMode) {
        console.log(`   ⚠️  Contract ${contractName} not found in unified file`);
      }
      return false;
    }

    console.log(`   📝 Checking ${contractName}...`);

    // Fix implementation field (should be address, not hash)
    if (contractInfo.contract.implementation && 
        contractInfo.contract.implementation.startsWith('0x') && 
        contractInfo.contract.implementation.length === 66) {
      // This looks like a hash, replace with address
      const oldValue = contractInfo.contract.implementation;
      contractInfo.contract.implementation = leveldbContract.address;
      console.log(`      ✓ Fixed implementation: hash → address`);
      fieldsRecovered++;
      updated = true;
    }

    // Store extended fields in custom location
    const extendedKey = `extended_${contractName}`;
    let extendedData = unified[extendedKey] || {};
    
    // Recover factoryByteCodeHash
    if (leveldbContract.factoryByteCodeHash && !extendedData.factoryByteCodeHash) {
      extendedData.factoryByteCodeHash = leveldbContract.factoryByteCodeHash;
      console.log(`      ✓ Recovered factoryByteCodeHash`);
      fieldsRecovered++;
      updated = true;
    }

    // Recover implementationHash
    if (leveldbContract.implementationHash && !extendedData.implementationHash) {
      extendedData.implementationHash = leveldbContract.implementationHash;
      console.log(`      ✓ Recovered implementationHash`);
      fieldsRecovered++;
      updated = true;
    }

    // Recover deploymentArgs
    if (leveldbContract.deploymentArgs && 
        leveldbContract.deploymentArgs.length > 0 && 
        !extendedData.deploymentArgs) {
      extendedData.deploymentArgs = leveldbContract.deploymentArgs;
      console.log(`      ✓ Recovered deploymentArgs (${leveldbContract.deploymentArgs.length} args)`);
      fieldsRecovered++;
      updated = true;
    }

    // Recover timestamp
    if (leveldbContract.timestamp && !extendedData.timestamp) {
      extendedData.timestamp = leveldbContract.timestamp;
      console.log(`      ✓ Recovered timestamp`);
      fieldsRecovered++;
      updated = true;
    }

    // Store extended data if we have any
    if (Object.keys(extendedData).length > 0) {
      unified[extendedKey] = extendedData;
    }

    // Update verification section with implementation hash
    if (leveldbContract.implementationHash) {
      if (!unified.verification) {
        unified.verification = {};
      }
      if (!unified.verification.implementationHashes) {
        unified.verification.implementationHashes = {};
      }
      if (!unified.verification.implementationHashes[contractName]) {
        unified.verification.implementationHashes[contractName] = leveldbContract.implementationHash;
        console.log(`      ✓ Added to verification.implementationHashes`);
        fieldsRecovered++;
        updated = true;
      }
    }

    if (fieldsRecovered > 0) {
      this.recoveryStats.fieldsRecovered += fieldsRecovered;
      console.log(`      📊 Recovered ${fieldsRecovered} fields`);
    } else {
      console.log(`      ✅ All fields present`);
    }

    return updated;
  }

  /**
   * Find contract in unified structure
   */
  private findContract(
    unified: UnifiedDeployment, 
    contractName: string
  ): { contract: any; category: string } | null {
    // Check core contracts
    if (unified.contracts.core?.[contractName]) {
      return { 
        contract: unified.contracts.core[contractName], 
        category: 'core' 
      };
    }

    // Check protocol contracts
    if (unified.contracts.protocol?.[contractName]) {
      return { 
        contract: unified.contracts.protocol[contractName], 
        category: 'protocol' 
      };
    }

    // Check infrastructure contracts
    if (unified.contracts.infrastructure?.[contractName]) {
      return { 
        contract: unified.contracts.infrastructure[contractName], 
        category: 'infrastructure' 
      };
    }

    return null;
  }

  /**
   * Clean contract name (remove namespace prefix)
   */
  private cleanContractName(name: string): string {
    // Remove "contracts/xchain/CrossChainRouter.sol:" prefix
    const parts = name.split(':');
    return parts[parts.length - 1];
  }

  /**
   * Print recovery summary
   */
  private printSummary(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 RECOVERY SUMMARY');
    console.log('='.repeat(60));
    console.log(`Files processed: ${this.recoveryStats.filesProcessed}`);
    console.log(`Contracts updated: ${this.recoveryStats.contractsUpdated}`);
    console.log(`Fields recovered: ${this.recoveryStats.fieldsRecovered}`);
    
    if (this.recoveryStats.errors.length > 0) {
      console.log(`\n❌ Errors (${this.recoveryStats.errors.length}):`);
      for (const error of this.recoveryStats.errors) {
        console.log(`   - ${error}`);
      }
    }

    if (this.dryRun) {
      console.log('\n🔍 DRY RUN MODE - No files were modified');
      console.log('💡 Run without --dry-run to apply changes');
    }

    console.log('='.repeat(60));
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const options = {
    debugMode: !args.includes('--quiet'),
    dryRun: args.includes('--dry-run'),
    leveldbBackupPath: args.find(a => a.startsWith('--backup='))?.split('=')[1],
    unifiedPath: args.find(a => a.startsWith('--unified='))?.split('=')[1]
  };

  console.log('🚀 LookCoin Data Recovery Tool\n');

  const tool = new DataRecoveryTool(options);
  
  try {
    await tool.recover();
    console.log('\n✅ Recovery completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Recovery failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { DataRecoveryTool };