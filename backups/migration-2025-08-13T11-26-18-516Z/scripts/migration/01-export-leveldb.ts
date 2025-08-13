#!/usr/bin/env tsx

/**
 * LevelDB Export Script
 * 
 * Exports all contract data from LevelDB to a JSON backup file.
 * This preserves all deployment data before migration to JSON storage.
 * 
 * Usage: tsx scripts/migration/01-export-leveldb.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { LevelDBStateManager } from '../utils/LevelDBStateManager';

interface ExportSummary {
  totalContracts: number;
  networks: Record<number, {
    chainId: number;
    networkName: string;
    contractCount: number;
    contracts: string[];
  }>;
  exportTime: string;
  exportFile: string;
}

async function main(): Promise<void> {
  console.log('🚀 Starting LevelDB Export...\n');

  try {
    // Initialize LevelDB state manager
    const levelDBManager = new LevelDBStateManager({
      debugMode: true,
      dbPath: path.join(process.cwd(), 'leveldb')
    });
    
    await levelDBManager.initialize();
    console.log('✅ LevelDB initialized\n');

    // Export all data
    console.log('📦 Exporting all contracts...');
    const exportData = await levelDBManager.exportAll({
      format: 'json',
      includeMetadata: true,
      prettyPrint: true
    });

    // Parse export data for summary
    const parsedExport = JSON.parse(exportData);
    const contracts = parsedExport.contracts || {};
    
    // Create backup directory
    const backupDir = path.join(process.cwd(), 'leveldb-backup');
    await fs.mkdir(backupDir, { recursive: true });
    
    // Generate timestamp for backup file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `leveldb-export-${timestamp}.json`);
    
    // Write backup file
    await fs.writeFile(backupFile, exportData, 'utf-8');
    console.log(`✅ Export saved to: ${backupFile}\n`);

    // Generate summary
    const summary: ExportSummary = {
      totalContracts: Object.keys(contracts).length,
      networks: {},
      exportTime: new Date().toISOString(),
      exportFile: backupFile
    };

    // Organize by network
    for (const [, contract] of Object.entries(contracts)) {
      const contractData = contract as Record<string, unknown>;
      const chainId = contractData.chainId as number;
      
      if (!summary.networks[chainId]) {
        summary.networks[chainId] = {
          chainId,
          networkName: (contractData.networkName as string) || getNetworkName(chainId),
          contractCount: 0,
          contracts: []
        };
      }
      
      summary.networks[chainId].contractCount++;
      summary.networks[chainId].contracts.push(contractData.contractName as string);
    }

    // Display summary
    console.log('📊 Export Summary:');
    console.log('================');
    console.log(`Total Contracts: ${summary.totalContracts}`);
    console.log(`Export Time: ${summary.exportTime}`);
    console.log(`Backup File: ${summary.exportFile}\n`);

    console.log('Networks Exported:');
    for (const network of Object.values(summary.networks)) {
      console.log(`\n${network.networkName} (Chain ID: ${network.chainId})`);
      console.log(`  Contracts: ${network.contractCount}`);
      for (const contractName of network.contracts) {
        console.log(`    - ${contractName}`);
      }
    }

    // Save summary
    const summaryFile = path.join(backupDir, `export-summary-${timestamp}.json`);
    await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2), 'utf-8');
    console.log(`\n✅ Summary saved to: ${summaryFile}`);

    // Validate export
    const validation = await validateExport(parsedExport);
    if (validation.isValid) {
      console.log('\n✅ Export validation passed!');
    } else {
      console.error('\n❌ Export validation failed:');
      for (const error of validation.errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    // Close database
    await levelDBManager.close();
    console.log('\n✅ LevelDB Export Complete!');
    console.log('📝 Next step: Run 02-sync-to-json.ts to migrate data to JSON files');

  } catch (error) {
    console.error('\n❌ Export failed:', error);
    process.exit(1);
  }
}

function getNetworkName(chainId: number): string {
  const networkMap: Record<number, string> = {
    56: 'bscmainnet',
    97: 'bsctestnet',
    84532: 'basesepolia',
    11155420: 'optimismsepolia',
    23295: 'sapphiremainnet',
    23294: 'sapphiretestnet',
    8453: 'basemainnet',
    10: 'optimismmainnet',
    31337: 'localhost'
  };
  return networkMap[chainId] || `chain${chainId}`;
}

async function validateExport(exportData: Record<string, unknown>): Promise<{
  isValid: boolean;
  errors: string[];
}> {
  const errors: string[] = [];

  // Check structure
  if (!exportData.contracts) {
    errors.push('Missing contracts field in export');
  }

  if (!exportData.metadata) {
    errors.push('Missing metadata field in export');
  }

  // Validate each contract
  const contracts = (exportData.contracts || {}) as Record<string, unknown>;
  for (const [key, contract] of Object.entries(contracts)) {
    const c = contract as Record<string, unknown>;
    
    // Check required fields
    if (!c.contractName) {
      errors.push(`Contract ${key} missing contractName`);
    }
    if (!c.chainId) {
      errors.push(`Contract ${key} missing chainId`);
    }
    if (!c.address) {
      errors.push(`Contract ${key} missing address`);
    }
    if (!c.factoryByteCodeHash) {
      errors.push(`Contract ${key} missing factoryByteCodeHash`);
    }
    
    // Check for known issues (Chain ID 31337)
    if (c.chainId === 31337) {
      errors.push(`Contract ${c.contractName} has test chain ID 31337 - should be excluded`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});