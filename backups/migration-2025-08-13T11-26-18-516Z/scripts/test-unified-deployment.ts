#!/usr/bin/env npx tsx

/**
 * Test script for validating the unified JSON state manager integration
 * 
 * This script tests:
 * 1. Loading existing deployments from unified format
 * 2. Simulating a new deployment
 * 3. Simulating an upgrade
 * 4. Verifying data persistence
 */

import { HardhatRuntimeEnvironment } from "hardhat/types";
import * as path from "path";
import * as fs from "fs/promises";

// Set environment to use unified backend
process.env.STATE_BACKEND = 'unified';
process.env.DEBUG_DEPLOYMENT = 'true';

import { fetchDeployOrUpgradeProxy, getContract, putContract, getAllContracts } from "./utils/state";
import { getBytecodeHash } from "./utils/deployment";

const TEST_CHAIN_ID = 97; // BSC Testnet
const TEST_NETWORK = 'bsctestnet';

interface TestResult {
  test: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function logTest(test: string, passed: boolean, error?: string, details?: any): void {
  results.push({ test, passed, error, details });
  const symbol = passed ? '✅' : '❌';
  console.log(`${symbol} ${test}`);
  if (error) {
    console.log(`   Error: ${error}`);
  }
  if (details) {
    console.log(`   Details:`, details);
  }
}

async function testLoadExistingDeployment(): Promise<void> {
  console.log('\n📋 Testing: Load existing deployment from unified format...');
  
  try {
    // Test loading a known contract
    const lookCoin = await getContract(TEST_CHAIN_ID, 'LookCoin');
    
    if (!lookCoin) {
      logTest('Load LookCoin contract', false, 'Contract not found');
      return;
    }
    
    // Verify critical fields
    const hasRequiredFields = 
      lookCoin.contractName === 'LookCoin' &&
      lookCoin.chainId === TEST_CHAIN_ID &&
      lookCoin.networkName === TEST_NETWORK &&
      lookCoin.address &&
      lookCoin.proxyAddress &&
      lookCoin.factoryByteCodeHash &&
      lookCoin.implementationHash &&
      lookCoin.timestamp;
    
    logTest('Load LookCoin contract', hasRequiredFields, 
      !hasRequiredFields ? 'Missing required fields' : undefined,
      {
        contractName: lookCoin.contractName,
        address: lookCoin.address,
        proxyAddress: lookCoin.proxyAddress,
        hasFactoryHash: !!lookCoin.factoryByteCodeHash,
        hasImplHash: !!lookCoin.implementationHash,
        hasTimestamp: !!lookCoin.timestamp
      }
    );
    
    // Test loading all contracts
    const allContracts = await getAllContracts(TEST_CHAIN_ID);
    logTest('Load all contracts', allContracts.length > 0, 
      allContracts.length === 0 ? 'No contracts found' : undefined,
      { count: allContracts.length }
    );
    
    // Verify each contract has required fields
    let allValid = true;
    for (const contract of allContracts) {
      if (!contract.factoryByteCodeHash || !contract.timestamp) {
        allValid = false;
        console.log(`   ⚠️  ${contract.contractName} missing fields:`, {
          hasFactoryHash: !!contract.factoryByteCodeHash,
          hasTimestamp: !!contract.timestamp
        });
      }
    }
    
    logTest('All contracts have required fields', allValid);
    
  } catch (error) {
    logTest('Load existing deployment', false, 
      error instanceof Error ? error.message : String(error));
  }
}

async function testSimulateNewDeployment(): Promise<void> {
  console.log('\n📋 Testing: Simulate new deployment...');
  
  try {
    const testContract = {
      contractName: 'TestContract',
      chainId: TEST_CHAIN_ID,
      networkName: TEST_NETWORK,
      address: '0x' + '1'.repeat(40),
      factoryByteCodeHash: '0x' + 'a'.repeat(64),
      implementationHash: '0x' + 'b'.repeat(64),
      proxyAddress: '0x' + '2'.repeat(40),
      deploymentArgs: ['arg1', 'arg2'],
      timestamp: Date.now()
    };
    
    // Store the contract
    await putContract(TEST_CHAIN_ID, testContract);
    
    // Retrieve it back
    const retrieved = await getContract(TEST_CHAIN_ID, 'TestContract');
    
    if (!retrieved) {
      logTest('Store and retrieve test contract', false, 'Contract not found after storage');
      return;
    }
    
    // Verify all fields match
    const fieldsMatch = 
      retrieved.contractName === testContract.contractName &&
      retrieved.address === testContract.address &&
      retrieved.factoryByteCodeHash === testContract.factoryByteCodeHash &&
      retrieved.implementationHash === testContract.implementationHash &&
      retrieved.proxyAddress === testContract.proxyAddress &&
      JSON.stringify(retrieved.deploymentArgs) === JSON.stringify(testContract.deploymentArgs) &&
      retrieved.timestamp === testContract.timestamp;
    
    logTest('Store and retrieve test contract', fieldsMatch,
      !fieldsMatch ? 'Fields do not match' : undefined,
      {
        stored: testContract,
        retrieved: {
          contractName: retrieved.contractName,
          address: retrieved.address,
          factoryByteCodeHash: retrieved.factoryByteCodeHash?.substring(0, 10) + '...',
          implementationHash: retrieved.implementationHash?.substring(0, 10) + '...',
          proxyAddress: retrieved.proxyAddress,
          deploymentArgs: retrieved.deploymentArgs,
          timestamp: retrieved.timestamp
        }
      }
    );
    
  } catch (error) {
    logTest('Simulate new deployment', false,
      error instanceof Error ? error.message : String(error));
  }
}

async function testSimulateUpgrade(): Promise<void> {
  console.log('\n📋 Testing: Simulate contract upgrade...');
  
  try {
    // Get an existing contract
    const existingContract = await getContract(TEST_CHAIN_ID, 'LookCoin');
    
    if (!existingContract) {
      logTest('Get existing contract for upgrade', false, 'LookCoin not found');
      return;
    }
    
    // Simulate an upgrade by changing the implementation hash
    const upgradedContract = {
      ...existingContract,
      implementationHash: '0x' + 'c'.repeat(64),
      factoryByteCodeHash: '0x' + 'd'.repeat(64),
      address: '0x' + '3'.repeat(40), // New implementation address
      timestamp: Date.now()
    };
    
    // Store the upgraded contract
    await putContract(TEST_CHAIN_ID, upgradedContract);
    
    // Retrieve and verify
    const retrieved = await getContract(TEST_CHAIN_ID, 'LookCoin');
    
    if (!retrieved) {
      logTest('Upgrade contract', false, 'Contract not found after upgrade');
      return;
    }
    
    const upgradeSuccessful = 
      retrieved.implementationHash === upgradedContract.implementationHash &&
      retrieved.factoryByteCodeHash === upgradedContract.factoryByteCodeHash &&
      retrieved.address === upgradedContract.address &&
      retrieved.proxyAddress === existingContract.proxyAddress; // Proxy should remain the same
    
    logTest('Upgrade contract', upgradeSuccessful,
      !upgradeSuccessful ? 'Upgrade fields not properly updated' : undefined,
      {
        originalImplHash: existingContract.implementationHash?.substring(0, 10) + '...',
        newImplHash: retrieved.implementationHash?.substring(0, 10) + '...',
        proxyUnchanged: retrieved.proxyAddress === existingContract.proxyAddress
      }
    );
    
    // Restore original contract
    await putContract(TEST_CHAIN_ID, existingContract);
    
  } catch (error) {
    logTest('Simulate upgrade', false,
      error instanceof Error ? error.message : String(error));
  }
}

async function testDataPersistence(): Promise<void> {
  console.log('\n📋 Testing: Data persistence...');
  
  try {
    // Check if the unified file exists
    const unifiedPath = path.join(process.cwd(), 'deployments', 'unified', `${TEST_NETWORK}.unified.json`);
    
    try {
      await fs.access(unifiedPath);
      logTest('Unified file exists', true, undefined, { path: unifiedPath });
    } catch {
      logTest('Unified file exists', false, 'File not found', { path: unifiedPath });
      return;
    }
    
    // Read and parse the file
    const content = await fs.readFile(unifiedPath, 'utf-8');
    const deployment = JSON.parse(content);
    
    // Check for extended fields
    const hasExtendedFields = Object.keys(deployment).some(key => key.startsWith('extended_'));
    logTest('Extended fields present', hasExtendedFields, 
      !hasExtendedFields ? 'No extended fields found' : undefined,
      {
        extendedFields: Object.keys(deployment).filter(key => key.startsWith('extended_'))
      }
    );
    
    // Verify TestContract is persisted
    const hasTestContract = 
      deployment.contracts.infrastructure?.TestContract ||
      deployment.contracts.protocol?.TestContract ||
      deployment.contracts.core?.TestContract;
    
    logTest('TestContract persisted', !!hasTestContract,
      !hasTestContract ? 'TestContract not found in file' : undefined);
    
    // Check extended data for TestContract
    const testContractExtended = deployment.extended_TestContract;
    logTest('TestContract extended data', !!testContractExtended,
      !testContractExtended ? 'Extended data not found' : undefined,
      testContractExtended ? {
        hasFactoryHash: !!testContractExtended.factoryByteCodeHash,
        hasImplHash: !!testContractExtended.implementationHash,
        hasDeploymentArgs: !!testContractExtended.deploymentArgs,
        hasTimestamp: !!testContractExtended.timestamp
      } : undefined
    );
    
  } catch (error) {
    logTest('Data persistence', false,
      error instanceof Error ? error.message : String(error));
  }
}

async function testBackupCreation(): Promise<void> {
  console.log('\n📋 Testing: Backup file creation...');
  
  try {
    const backupDir = path.join(process.cwd(), 'deployments', 'unified', 'backups');
    
    try {
      const files = await fs.readdir(backupDir);
      const backupFiles = files.filter(f => f.includes(TEST_NETWORK) && f.endsWith('.backup'));
      
      logTest('Backup files created', backupFiles.length > 0,
        backupFiles.length === 0 ? 'No backup files found' : undefined,
        { count: backupFiles.length, recent: backupFiles.slice(-3) }
      );
      
    } catch {
      logTest('Backup directory exists', false, 'Backup directory not found');
    }
    
  } catch (error) {
    logTest('Backup creation', false,
      error instanceof Error ? error.message : String(error));
  }
}

async function main(): Promise<void> {
  console.log('========================================');
  console.log('🧪 Testing Unified JSON State Manager');
  console.log('========================================');
  console.log(`Environment: STATE_BACKEND=${process.env.STATE_BACKEND}`);
  console.log(`Debug Mode: ${process.env.DEBUG_DEPLOYMENT}`);
  console.log(`Test Network: ${TEST_NETWORK} (Chain ID: ${TEST_CHAIN_ID})`);
  
  // Run tests in sequence
  await testLoadExistingDeployment();
  await testSimulateNewDeployment();
  await testSimulateUpgrade();
  await testDataPersistence();
  await testBackupCreation();
  
  // Summary
  console.log('\n========================================');
  console.log('📊 Test Summary');
  console.log('========================================');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  
  console.log(`Total Tests: ${total}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
  
  if (failed > 0) {
    console.log('\n⚠️  Failed Tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.test}: ${r.error || 'Unknown error'}`);
    });
  }
  
  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Run the tests
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});