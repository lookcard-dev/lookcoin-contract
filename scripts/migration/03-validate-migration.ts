#!/usr/bin/env tsx

/**
 * Validation Migration Script
 * 
 * Comprehensive validation of the LevelDB to JSON migration.
 * Compares data between both storage systems to ensure integrity.
 * 
 * Usage: tsx scripts/migration/03-validate-migration.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { LevelDBStateManager } from '../utils/LevelDBStateManager';
import { JSONStateManager } from '../utils/JSONStateManager';
import { ContractType } from '../utils/IStateManager';

interface ValidationResult {
  chainId: number;
  network: string;
  status: 'matched' | 'mismatch' | 'missing-in-json' | 'missing-in-leveldb';
  contractName: string;
  differences?: string[];
}

interface ValidationSummary {
  timestamp: string;
  totalContracts: number;
  matched: number;
  mismatched: number;
  missingInJson: number;
  missingInLevelDB: number;
  validationResults: ValidationResult[];
  isValid: boolean;
  recommendations: string[];
}

async function main(): Promise<void> {
  console.log('🔍 Starting Migration Validation...\n');

  try {
    // Initialize both state managers
    const levelDBManager = new LevelDBStateManager({
      debugMode: false,
      dbPath: path.join(process.cwd(), 'leveldb')
    });
    
    const jsonManager = new JSONStateManager({
      debugMode: false,
      jsonPath: path.join(process.cwd(), 'deployments'),
      atomicWrites: false,
      backupEnabled: false,
      enableCache: false
    });
    
    await levelDBManager.initialize();
    await jsonManager.initialize();
    
    console.log('✅ State managers initialized\n');

    // Get all chain IDs from both systems
    const levelDBChainIds = await getAllChainIds(levelDBManager);
    const jsonChainIds = await getAllChainIds(jsonManager);
    
    const allChainIds = new Set([...levelDBChainIds, ...jsonChainIds]);
    
    console.log(`📊 Found ${allChainIds.size} unique chain IDs across both systems`);
    console.log(`  LevelDB chains: ${levelDBChainIds.join(', ')}`);
    console.log(`  JSON chains: ${jsonChainIds.join(', ')}\n`);

    // Validation results
    const validationResults: ValidationResult[] = [];
    let totalContracts = 0;
    let matched = 0;
    let mismatched = 0;
    let missingInJson = 0;
    let missingInLevelDB = 0;

    // Validate each chain
    for (const chainId of Array.from(allChainIds)) {
      const networkName = getNetworkName(chainId);
      console.log(`\n🌐 Validating ${networkName} (Chain ID: ${chainId})`);
      console.log('=' .repeat(50));

      // Skip test network
      if (chainId === 31337) {
        console.log('⏭️  Skipping test network');
        continue;
      }

      // Get contracts from both systems
      const levelDBContracts = await levelDBManager.getAllContracts(chainId);
      const jsonContracts = await jsonManager.getAllContracts(chainId);
      
      // Create maps for comparison
      const levelDBMap = new Map<string, ContractType>();
      const jsonMap = new Map<string, ContractType>();
      
      for (const contract of levelDBContracts) {
        levelDBMap.set(contract.contractName, contract);
      }
      
      for (const contract of jsonContracts) {
        jsonMap.set(contract.contractName, contract);
      }
      
      const allContractNames = new Set([
        ...Array.from(levelDBMap.keys()),
        ...Array.from(jsonMap.keys())
      ]);
      
      console.log(`  Found ${allContractNames.size} unique contracts`);
      console.log(`  LevelDB: ${levelDBMap.size} contracts`);
      console.log(`  JSON: ${jsonMap.size} contracts`);
      
      // Compare each contract
      for (const contractName of Array.from(allContractNames)) {
        totalContracts++;
        const levelDBContract = levelDBMap.get(contractName);
        const jsonContract = jsonMap.get(contractName);
        
        if (!levelDBContract) {
          // Contract exists in JSON but not in LevelDB
          validationResults.push({
            chainId,
            network: networkName,
            status: 'missing-in-leveldb',
            contractName
          });
          missingInLevelDB++;
          console.log(`  ⚠️  ${contractName}: Only in JSON (not in LevelDB)`);
        } else if (!jsonContract) {
          // Contract exists in LevelDB but not in JSON
          validationResults.push({
            chainId,
            network: networkName,
            status: 'missing-in-json',
            contractName
          });
          missingInJson++;
          console.log(`  ❌ ${contractName}: Missing in JSON`);
        } else {
          // Both exist, compare them
          const differences = compareContracts(levelDBContract, jsonContract);
          
          if (differences.length === 0) {
            validationResults.push({
              chainId,
              network: networkName,
              status: 'matched',
              contractName
            });
            matched++;
            console.log(`  ✅ ${contractName}: Matched`);
          } else {
            validationResults.push({
              chainId,
              network: networkName,
              status: 'mismatch',
              contractName,
              differences
            });
            mismatched++;
            console.log(`  ⚠️  ${contractName}: Mismatch`);
            for (const diff of differences) {
              console.log(`      - ${diff}`);
            }
          }
        }
      }
      
      // Network summary
      const networkResults = validationResults.filter(r => r.chainId === chainId);
      const networkMatched = networkResults.filter(r => r.status === 'matched').length;
      const networkMismatched = networkResults.filter(r => r.status === 'mismatch').length;
      const networkMissingJson = networkResults.filter(r => r.status === 'missing-in-json').length;
      const networkMissingLevelDB = networkResults.filter(r => r.status === 'missing-in-leveldb').length;
      
      console.log(`\nNetwork Validation Summary:`);
      console.log(`  ✅ Matched: ${networkMatched}`);
      console.log(`  ⚠️  Mismatched: ${networkMismatched}`);
      console.log(`  ❌ Missing in JSON: ${networkMissingJson}`);
      console.log(`  ℹ️  Missing in LevelDB: ${networkMissingLevelDB}`);
    }

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (missingInJson > 0) {
      recommendations.push(
        `${missingInJson} contracts are missing in JSON. Run 02-sync-to-json.ts to migrate them.`
      );
    }
    
    if (mismatched > 0) {
      recommendations.push(
        `${mismatched} contracts have data mismatches. Review the differences and re-sync if needed.`
      );
    }
    
    if (missingInLevelDB > 0) {
      recommendations.push(
        `${missingInLevelDB} contracts exist only in JSON. This is expected for new deployments after migration.`
      );
    }
    
    if (missingInJson === 0 && mismatched === 0) {
      recommendations.push(
        'Migration validation successful! All contracts match between LevelDB and JSON.'
      );
      recommendations.push(
        'You can now safely switch to JSON backend by updating state.ts'
      );
    }

    // Create validation summary
    const summary: ValidationSummary = {
      timestamp: new Date().toISOString(),
      totalContracts,
      matched,
      mismatched,
      missingInJson,
      missingInLevelDB,
      validationResults,
      isValid: missingInJson === 0 && mismatched === 0,
      recommendations
    };

    // Save validation report
    const reportDir = path.join(process.cwd(), 'leveldb-backup');
    await fs.mkdir(reportDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFile = path.join(reportDir, `validation-report-${timestamp}.json`);
    
    await fs.writeFile(reportFile, JSON.stringify(summary, null, 2), 'utf-8');
    
    // Display final summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 VALIDATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Contracts: ${totalContracts}`);
    console.log(`✅ Matched: ${matched} (${(matched/totalContracts*100).toFixed(1)}%)`);
    console.log(`⚠️  Mismatched: ${mismatched} (${(mismatched/totalContracts*100).toFixed(1)}%)`);
    console.log(`❌ Missing in JSON: ${missingInJson} (${(missingInJson/totalContracts*100).toFixed(1)}%)`);
    console.log(`ℹ️  Missing in LevelDB: ${missingInLevelDB} (${(missingInLevelDB/totalContracts*100).toFixed(1)}%)`);
    console.log(`\nValidation Status: ${summary.isValid ? '✅ PASSED' : '❌ FAILED'}`);
    
    console.log('\n📝 Recommendations:');
    for (const recommendation of recommendations) {
      console.log(`  • ${recommendation}`);
    }
    
    console.log(`\n✅ Validation Report: ${reportFile}`);

    // Check critical infrastructure contracts
    await validateCriticalContracts(levelDBManager, jsonManager);

    // Close managers
    await levelDBManager.close();
    await jsonManager.close();
    
    // Exit with appropriate code
    if (!summary.isValid) {
      console.log('\n❌ Validation failed. Please review the report and fix issues before proceeding.');
      process.exit(1);
    }
    
    console.log('\n✅ Validation Complete!');
    console.log('📝 Next steps:');
    console.log('  1. Review the validation report');
    console.log('  2. If validation passed, update state.ts to use JSON backend');
    console.log('  3. Run deployment scripts to verify everything works');

  } catch (error) {
    console.error('\n❌ Validation failed:', error);
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

async function getAllChainIds(manager: LevelDBStateManager | JSONStateManager): Promise<number[]> {
  const chainIds = new Set<number>();
  
  try {
    // Try to get contracts for known chain IDs
    const knownChainIds = [56, 97, 84532, 11155420, 23295, 23294, 8453, 10, 31337];
    
    for (const chainId of knownChainIds) {
      const contracts = await manager.getAllContracts(chainId);
      if (contracts.length > 0) {
        chainIds.add(chainId);
      }
    }
  } catch (error) {
    console.warn('Failed to get chain IDs:', error);
  }
  
  return Array.from(chainIds).sort((a, b) => a - b);
}

function compareContracts(levelDBContract: ContractType, jsonContract: ContractType): string[] {
  const differences: string[] = [];
  
  // Compare key fields
  if (levelDBContract.address !== jsonContract.address) {
    differences.push(`Address mismatch: ${levelDBContract.address} vs ${jsonContract.address}`);
  }
  
  if (levelDBContract.factoryByteCodeHash !== jsonContract.factoryByteCodeHash) {
    differences.push(`ByteCode hash mismatch: ${levelDBContract.factoryByteCodeHash} vs ${jsonContract.factoryByteCodeHash}`);
  }
  
  if (levelDBContract.implementationHash !== jsonContract.implementationHash) {
    differences.push(`Implementation hash mismatch: ${levelDBContract.implementationHash} vs ${jsonContract.implementationHash}`);
  }
  
  if (levelDBContract.proxyAddress !== jsonContract.proxyAddress) {
    differences.push(`Proxy address mismatch: ${levelDBContract.proxyAddress} vs ${jsonContract.proxyAddress}`);
  }
  
  // Compare deployment args (array comparison)
  const levelDBArgs = JSON.stringify(levelDBContract.deploymentArgs || []);
  const jsonArgs = JSON.stringify(jsonContract.deploymentArgs || []);
  if (levelDBArgs !== jsonArgs) {
    differences.push(`Deployment args mismatch`);
  }
  
  return differences;
}

async function validateCriticalContracts(
  levelDBManager: LevelDBStateManager, 
  jsonManager: JSONStateManager
): Promise<void> {
  console.log('\n🔍 Validating Critical Infrastructure Contracts...');
  
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

  let allCriticalValid = true;
  
  for (const critical of criticalContracts) {
    const levelDBContract = await levelDBManager.getContract(critical.chainId, critical.name);
    const jsonContract = await jsonManager.getContract(critical.chainId, critical.name);
    
    if (!levelDBContract && !jsonContract) {
      console.log(`  ⏭️  ${critical.name} not deployed on ${critical.network}`);
    } else if (!jsonContract) {
      console.log(`  ❌ ${critical.name} MISSING in JSON on ${critical.network}`);
      allCriticalValid = false;
    } else if (!levelDBContract) {
      console.log(`  ℹ️  ${critical.name} only in JSON on ${critical.network} (new deployment)`);
    } else {
      const differences = compareContracts(levelDBContract, jsonContract);
      if (differences.length === 0) {
        console.log(`  ✅ ${critical.name} validated on ${critical.network}`);
      } else {
        console.log(`  ⚠️  ${critical.name} has mismatches on ${critical.network}`);
        allCriticalValid = false;
      }
    }
  }

  if (!allCriticalValid) {
    console.error('\n⚠️  WARNING: Critical infrastructure contracts have issues!');
    console.error('Please fix these before proceeding with the migration.');
  } else {
    console.log('\n✅ All critical infrastructure contracts validated!');
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});