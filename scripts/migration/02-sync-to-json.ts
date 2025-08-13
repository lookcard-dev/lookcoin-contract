#!/usr/bin/env tsx

/**
 * Sync to JSON Script
 * 
 * Migrates missing contracts from LevelDB export to JSON deployment files.
 * Focuses on the 13 infrastructure contracts missing from JSON files.
 * 
 * Usage: tsx scripts/migration/02-sync-to-json.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { JSONStateManager } from '../utils/JSONStateManager';
import { ContractType } from '../utils/IStateManager';

interface MigrationResult {
  network: string;
  chainId: number;
  added: string[];
  updated: string[];
  skipped: string[];
}

async function main(): Promise<void> {
  console.log('🔄 Starting JSON Sync Migration...\n');

  try {
    // Find latest export file
    const backupDir = path.join(process.cwd(), 'leveldb-backup');
    const files = await fs.readdir(backupDir);
    const exportFiles = files.filter(f => f.startsWith('leveldb-export-') && f.endsWith('.json'));
    
    if (exportFiles.length === 0) {
      console.error('❌ No export files found. Please run 01-export-leveldb.ts first');
      process.exit(1);
    }

    // Use the latest export
    exportFiles.sort();
    const latestExport = exportFiles[exportFiles.length - 1];
    const exportPath = path.join(backupDir, latestExport);
    
    console.log(`📂 Using export file: ${latestExport}\n`);
    
    // Load export data
    const exportContent = await fs.readFile(exportPath, 'utf-8');
    const exportData = JSON.parse(exportContent);
    const contracts = exportData.contracts || {};
    
    console.log(`📊 Found ${Object.keys(contracts).length} contracts in export\n`);

    // Initialize JSON state manager
    const jsonManager = new JSONStateManager({
      debugMode: false,
      jsonPath: path.join(process.cwd(), 'deployments'),
      atomicWrites: true,
      backupEnabled: true,
      enableCache: false
    });
    
    await jsonManager.initialize();
    console.log('✅ JSON State Manager initialized\n');

    // Group contracts by chainId
    const contractsByChain: Record<number, ContractType[]> = {};
    for (const [, contract] of Object.entries(contracts)) {
      const c = contract as Record<string, unknown>;
      const chainId = c.chainId as number;
      
      // Skip test network
      if (chainId === 31337) {
        console.log(`⏭️  Skipping test contract: ${c.contractName as string} on chain ${chainId}`);
        continue;
      }
      
      if (!contractsByChain[chainId]) {
        contractsByChain[chainId] = [];
      }
      
      contractsByChain[chainId].push(c as unknown as ContractType);
    }

    // Process each network
    const results: MigrationResult[] = [];
    
    for (const [chainId, chainContracts] of Object.entries(contractsByChain)) {
      const networkName = getNetworkName(Number(chainId));
      console.log(`\n🌐 Processing ${networkName} (Chain ID: ${chainId})`);
      console.log('=' .repeat(50));
      
      const result: MigrationResult = {
        network: networkName,
        chainId: Number(chainId),
        added: [],
        updated: [],
        skipped: []
      };

      for (const contract of chainContracts) {
        try {
          // Check if contract already exists in JSON
          const existing = await jsonManager.getContract(Number(chainId), contract.contractName);
          
          if (existing) {
            // Check if update needed (different implementation hash)
            if (existing.implementationHash !== contract.implementationHash ||
                existing.factoryByteCodeHash !== contract.factoryByteCodeHash) {
              await jsonManager.putContract(Number(chainId), contract);
              result.updated.push(contract.contractName);
              console.log(`  ✅ Updated: ${contract.contractName}`);
            } else {
              result.skipped.push(contract.contractName);
              console.log(`  ⏭️  Skipped: ${contract.contractName} (already exists)`);
            }
          } else {
            // Add new contract
            await jsonManager.putContract(Number(chainId), contract);
            result.added.push(contract.contractName);
            console.log(`  ✅ Added: ${contract.contractName}`);
          }
        } catch (error) {
          console.error(`  ❌ Failed to process ${contract.contractName}:`, error);
        }
      }
      
      results.push(result);
      
      // Display network summary
      console.log(`\nNetwork Summary:`);
      console.log(`  Added: ${result.added.length} contracts`);
      if (result.added.length > 0) {
        for (const name of result.added) {
          console.log(`    + ${name}`);
        }
      }
      console.log(`  Updated: ${result.updated.length} contracts`);
      console.log(`  Skipped: ${result.skipped.length} contracts`);
    }

    // Save migration report
    const reportDir = path.join(process.cwd(), 'leveldb-backup');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFile = path.join(reportDir, `migration-report-${timestamp}.json`);
    
    const report = {
      timestamp: new Date().toISOString(),
      sourceFile: latestExport,
      results,
      summary: {
        totalNetworks: results.length,
        totalAdded: results.reduce((sum, r) => sum + r.added.length, 0),
        totalUpdated: results.reduce((sum, r) => sum + r.updated.length, 0),
        totalSkipped: results.reduce((sum, r) => sum + r.skipped.length, 0)
      }
    };
    
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2), 'utf-8');
    
    // Display final summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Networks Processed: ${report.summary.totalNetworks}`);
    console.log(`Contracts Added: ${report.summary.totalAdded}`);
    console.log(`Contracts Updated: ${report.summary.totalUpdated}`);
    console.log(`Contracts Skipped: ${report.summary.totalSkipped}`);
    console.log(`\n✅ Migration Report: ${reportFile}`);

    // Verify critical infrastructure contracts
    await verifyCriticalContracts(jsonManager);

    // Close JSON manager
    await jsonManager.close();
    
    console.log('\n✅ JSON Sync Complete!');
    console.log('📝 Next step: Run 03-validate-migration.ts to verify data integrity');

  } catch (error) {
    console.error('\n❌ Sync failed:', error);
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

async function verifyCriticalContracts(jsonManager: JSONStateManager): Promise<void> {
  console.log('\n🔍 Verifying Critical Infrastructure Contracts...');
  
  const criticalContracts = [
    { chainId: 56, name: 'CrossChainRouter', network: 'BSC Mainnet' },
    { chainId: 56, name: 'FeeManager', network: 'BSC Mainnet' },
    { chainId: 56, name: 'SecurityManager', network: 'BSC Mainnet' },
    { chainId: 56, name: 'ProtocolRegistry', network: 'BSC Mainnet' },
    { chainId: 97, name: 'CrossChainRouter', network: 'BSC Testnet' },
    { chainId: 97, name: 'FeeManager', network: 'BSC Testnet' },
    { chainId: 97, name: 'SecurityManager', network: 'BSC Testnet' },
    { chainId: 97, name: 'ProtocolRegistry', network: 'BSC Testnet' }
  ];

  let allFound = true;
  for (const critical of criticalContracts) {
    const contract = await jsonManager.getContract(critical.chainId, critical.name);
    if (contract) {
      console.log(`  ✅ ${critical.name} found on ${critical.network}`);
    } else {
      console.log(`  ❌ ${critical.name} MISSING on ${critical.network}`);
      allFound = false;
    }
  }

  if (!allFound) {
    console.error('\n⚠️  WARNING: Some critical infrastructure contracts are missing!');
    console.error('This may cause deployment issues. Please investigate.');
  } else {
    console.log('\n✅ All critical infrastructure contracts verified!');
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});