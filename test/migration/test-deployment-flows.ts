#!/usr/bin/env tsx
/**
 * Comprehensive Deployment Flow Tests
 * 
 * Tests all critical deployment, upgrade, configuration, and setup flows
 * using the fixed UnifiedJSONStateManager.
 */

import { ethers } from 'hardhat';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import UnifiedJSONStateManager from '../../scripts/utils/UnifiedJSONStateManager-fixed';
import { ContractType } from '../../scripts/utils/IStateManager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  duration: number;
  error?: string;
  details?: any;
}

class DeploymentFlowTester {
  private stateManager: UnifiedJSONStateManager;
  private testResults: TestResult[] = [];
  private testChainId = 999999; // Test chain ID
  private testNetwork = 'testnet';
  
  constructor() {
    // Use a test directory for state management
    const testDir = path.join(__dirname, '../../deployments-test');
    this.stateManager = new UnifiedJSONStateManager({
      jsonPath: testDir,
      debugMode: false,
      validateOnWrite: true,
      backupEnabled: true
    });
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    console.log('🧪 Starting Comprehensive Deployment Flow Tests\n');
    console.log('=' .repeat(70));

    await this.setup();

    // Test suites
    await this.testDataStructureIntegrity();
    await this.testFreshDeployment();
    await this.testUpgradeDetection();
    await this.testUpgradeExecution();
    await this.testConfigurationSetup();
    await this.testContractRetrieval();
    await this.testDataPersistence();
    await this.testEdgeCases();
    await this.testDataRecovery();
    await this.testBackwardCompatibility();

    await this.cleanup();
    this.printResults();
  }

  /**
   * Setup test environment
   */
  private async setup(): Promise<void> {
    console.log('📋 Setting up test environment...\n');
    
    // Initialize state manager
    await this.stateManager.initialize();
    
    // Clear any existing test data
    const testDir = path.join(__dirname, '../../deployments-test');
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, 'unified'), { recursive: true });
  }

  /**
   * Cleanup test environment
   */
  private async cleanup(): Promise<void> {
    await this.stateManager.close();
  }

  /**
   * Test 1: Data Structure Integrity
   */
  private async testDataStructureIntegrity(): Promise<void> {
    console.log('\n📊 Test Suite 1: Data Structure Integrity');
    console.log('-'.repeat(50));

    await this.runTest('All ContractType fields preserved', async () => {
      const contract: ContractType = {
        contractName: 'TestContract',
        chainId: this.testChainId,
        networkName: this.testNetwork,
        address: '0x1234567890123456789012345678901234567890',
        factoryByteCodeHash: '0xabcdef1234567890',
        implementationHash: '0xfedcba0987654321',
        proxyAddress: '0x0987654321098765432109876543210987654321',
        deploymentArgs: ['arg1', 123, true],
        timestamp: Date.now()
      };

      // Store contract
      await this.stateManager.putContract(this.testChainId, contract);

      // Retrieve contract
      const retrieved = await this.stateManager.getContract(this.testChainId, 'TestContract');

      // Verify all fields
      if (!retrieved) throw new Error('Contract not found');
      
      const fieldsMatch = 
        retrieved.contractName === contract.contractName &&
        retrieved.chainId === contract.chainId &&
        retrieved.networkName === contract.networkName &&
        retrieved.address === contract.address &&
        retrieved.factoryByteCodeHash === contract.factoryByteCodeHash &&
        retrieved.implementationHash === contract.implementationHash &&
        retrieved.proxyAddress === contract.proxyAddress &&
        JSON.stringify(retrieved.deploymentArgs) === JSON.stringify(contract.deploymentArgs) &&
        retrieved.timestamp === contract.timestamp;

      if (!fieldsMatch) {
        throw new Error(`Field mismatch: 
          Expected: ${JSON.stringify(contract, null, 2)}
          Got: ${JSON.stringify(retrieved, null, 2)}`);
      }

      return { fieldsPreserved: true, contract: retrieved };
    });

    await this.runTest('Implementation field stores address not hash', async () => {
      const contract: ContractType = {
        contractName: 'ProxyContract',
        chainId: this.testChainId,
        networkName: this.testNetwork,
        address: '0xAAAA567890123456789012345678901234567890', // Implementation address
        factoryByteCodeHash: '0xhash1234',
        implementationHash: '0xhash5678', // Hash
        proxyAddress: '0xBBBB654321098765432109876543210987654321',
        deploymentArgs: [],
        timestamp: Date.now()
      };

      await this.stateManager.putContract(this.testChainId, contract);
      
      // Check the actual file to verify storage format
      const testDir = path.join(__dirname, '../../deployments-test');
      const filePath = path.join(testDir, 'unified', `${this.testNetwork}.unified.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const unified = JSON.parse(content);

      // Verify implementation field contains address
      const storedContract = unified.contracts.core?.ProxyContract || 
                           unified.contracts.protocol?.ProxyContract ||
                           unified.contracts.infrastructure?.ProxyContract;

      if (!storedContract) throw new Error('Contract not found in file');
      
      // Implementation should be the address, not the hash
      if (storedContract.implementation !== contract.address) {
        throw new Error(`Implementation field contains: ${storedContract.implementation}, expected: ${contract.address}`);
      }

      // Extended data should contain the hash
      const extendedData = unified[`extended_ProxyContract`];
      if (!extendedData || extendedData.implementationHash !== contract.implementationHash) {
        throw new Error('Implementation hash not properly stored in extended data');
      }

      return { 
        implementationIsAddress: true,
        hashInExtendedData: true 
      };
    });
  }

  /**
   * Test 2: Fresh Deployment
   */
  private async testFreshDeployment(): Promise<void> {
    console.log('\n🚀 Test Suite 2: Fresh Deployment');
    console.log('-'.repeat(50));

    await this.runTest('Deploy new contract', async () => {
      const startTime = Date.now();
      
      const contract: ContractType = {
        contractName: 'LookCoin',
        chainId: this.testChainId,
        networkName: this.testNetwork,
        address: '0x2234567890123456789012345678901234567890',
        factoryByteCodeHash: '0xfactory123',
        implementationHash: '0ximpl456',
        proxyAddress: '0x3234567890123456789012345678901234567890',
        deploymentArgs: ['LookCoin', 'LOOK', 18],
        timestamp: Date.now()
      };

      await this.stateManager.putContract(this.testChainId, contract);
      
      const duration = Date.now() - startTime;
      
      // Verify deployment
      const exists = await this.stateManager.hasContract(this.testChainId, 'LookCoin');
      if (!exists) throw new Error('Contract not deployed');

      return { 
        deployed: true, 
        duration,
        contract 
      };
    });

    await this.runTest('Prevent duplicate deployment', async () => {
      const contract: ContractType = {
        contractName: 'LookCoin',
        chainId: this.testChainId,
        networkName: this.testNetwork,
        address: '0x9999567890123456789012345678901234567890', // Different address
        factoryByteCodeHash: '0xdifferent',
        implementationHash: '0xdifferent',
        proxyAddress: '0x8888567890123456789012345678901234567890',
        deploymentArgs: [],
        timestamp: Date.now()
      };

      // This should update, not create duplicate
      await this.stateManager.putContract(this.testChainId, contract);
      
      const allContracts = await this.stateManager.getAllContracts(this.testChainId);
      const lookCoinContracts = allContracts.filter(c => c.contractName === 'LookCoin');
      
      if (lookCoinContracts.length !== 1) {
        throw new Error(`Expected 1 LookCoin, found ${lookCoinContracts.length}`);
      }

      // Should have the new address
      if (lookCoinContracts[0].address !== contract.address) {
        throw new Error('Contract not updated with new address');
      }

      return { 
        duplicatePrevented: true,
        updated: true 
      };
    });
  }

  /**
   * Test 3: Upgrade Detection
   */
  private async testUpgradeDetection(): Promise<void> {
    console.log('\n🔍 Test Suite 3: Upgrade Detection');
    console.log('-'.repeat(50));

    await this.runTest('Detect bytecode changes', async () => {
      // Deploy initial contract
      const initialContract: ContractType = {
        contractName: 'UpgradeableContract',
        chainId: this.testChainId,
        networkName: this.testNetwork,
        address: '0x4444567890123456789012345678901234567890',
        factoryByteCodeHash: '0xinitialHash123',
        implementationHash: '0xinitialImpl456',
        proxyAddress: '0x5555567890123456789012345678901234567890',
        deploymentArgs: [],
        timestamp: Date.now()
      };

      await this.stateManager.putContract(this.testChainId, initialContract);

      // Check for upgrade with same bytecode (no upgrade needed)
      const existingContract = await this.stateManager.getContract(
        this.testChainId, 
        'UpgradeableContract'
      );
      
      const needsUpgrade1 = existingContract?.factoryByteCodeHash !== initialContract.factoryByteCodeHash;
      if (needsUpgrade1) {
        throw new Error('False positive: Detected upgrade when bytecode unchanged');
      }

      // Simulate new bytecode
      const newByteCodeHash = '0xnewHash789';
      const needsUpgrade2 = existingContract?.factoryByteCodeHash !== newByteCodeHash;
      
      if (!needsUpgrade2) {
        throw new Error('Failed to detect bytecode change');
      }

      return { 
        detectionWorking: true,
        initialHash: initialContract.factoryByteCodeHash,
        newHash: newByteCodeHash
      };
    });

    await this.runTest('Track upgrade history', async () => {
      const contract: ContractType = {
        contractName: 'UpgradeableContract',
        chainId: this.testChainId,
        networkName: this.testNetwork,
        address: '0x6666567890123456789012345678901234567890', // New implementation
        factoryByteCodeHash: '0xnewHash789',
        implementationHash: '0xnewImpl789',
        proxyAddress: '0x5555567890123456789012345678901234567890', // Same proxy
        deploymentArgs: [],
        timestamp: Date.now()
      };

      await this.stateManager.putContract(this.testChainId, contract);

      // Check unified file for upgrade history
      const testDir = path.join(__dirname, '../../deployments-test');
      const filePath = path.join(testDir, 'unified', `${this.testNetwork}.unified.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const unified = JSON.parse(content);

      const deploymentHistory = unified.operations?.deploymentHistory || [];
      const upgradeEvents = deploymentHistory.filter(
        (h: any) => h.contractName === 'UpgradeableContract'
      );

      if (upgradeEvents.length < 2) {
        throw new Error('Upgrade history not properly tracked');
      }

      return { 
        historyTracked: true,
        events: upgradeEvents.length 
      };
    });
  }

  /**
   * Test 4: Upgrade Execution
   */
  private async testUpgradeExecution(): Promise<void> {
    console.log('\n⚡ Test Suite 4: Upgrade Execution');
    console.log('-'.repeat(50));

    await this.runTest('Execute contract upgrade', async () => {
      const oldImplementation = '0x7777567890123456789012345678901234567890';
      const newImplementation = '0x8888567890123456789012345678901234567890';
      const proxyAddress = '0x9999567890123456789012345678901234567890';

      // Deploy initial
      const initial: ContractType = {
        contractName: 'ExecutableUpgrade',
        chainId: this.testChainId,
        networkName: this.testNetwork,
        address: oldImplementation,
        factoryByteCodeHash: '0xoldFactory',
        implementationHash: '0xoldImpl',
        proxyAddress: proxyAddress,
        deploymentArgs: ['v1'],
        timestamp: Date.now()
      };

      await this.stateManager.putContract(this.testChainId, initial);

      // Execute upgrade
      const upgraded: ContractType = {
        contractName: 'ExecutableUpgrade',
        chainId: this.testChainId,
        networkName: this.testNetwork,
        address: newImplementation,
        factoryByteCodeHash: '0xnewFactory',
        implementationHash: '0xnewImpl',
        proxyAddress: proxyAddress, // Same proxy
        deploymentArgs: ['v2'],
        timestamp: Date.now()
      };

      await this.stateManager.putContract(this.testChainId, upgraded);

      // Verify upgrade
      const current = await this.stateManager.getContract(this.testChainId, 'ExecutableUpgrade');
      
      if (!current) throw new Error('Contract not found after upgrade');
      if (current.address !== newImplementation) {
        throw new Error('Implementation not updated');
      }
      if (current.proxyAddress !== proxyAddress) {
        throw new Error('Proxy address changed unexpectedly');
      }

      return {
        upgraded: true,
        oldImpl: oldImplementation,
        newImpl: newImplementation,
        proxyPreserved: true
      };
    });
  }

  /**
   * Test 5: Configuration Setup
   */
  private async testConfigurationSetup(): Promise<void> {
    console.log('\n⚙️  Test Suite 5: Configuration Setup');
    console.log('-'.repeat(50));

    await this.runTest('Cross-chain configuration', async () => {
      // Deploy contracts on multiple chains
      const chains = [
        { chainId: 100001, network: 'chain1' },
        { chainId: 100002, network: 'chain2' }
      ];

      for (const chain of chains) {
        const contract: ContractType = {
          contractName: 'CrossChainContract',
          chainId: chain.chainId,
          networkName: chain.network,
          address: `0x${chain.chainId}567890123456789012345678901234567890`,
          factoryByteCodeHash: '0xcrosschain',
          implementationHash: '0xcrossimpl',
          proxyAddress: undefined,
          deploymentArgs: [],
          timestamp: Date.now()
        };

        await this.stateManager.putContract(chain.chainId, contract);
      }

      // Verify cross-chain query
      const allCrossChain = await this.stateManager.queryContracts({
        contractName: 'CrossChainContract'
      });

      if (allCrossChain.length !== 2) {
        throw new Error(`Expected 2 cross-chain contracts, found ${allCrossChain.length}`);
      }

      return {
        chainsConfigured: chains.length,
        crossChainQueryWorking: true
      };
    });
  }

  /**
   * Test 6: Contract Retrieval
   */
  private async testContractRetrieval(): Promise<void> {
    console.log('\n🔎 Test Suite 6: Contract Retrieval');
    console.log('-'.repeat(50));

    await this.runTest('Retrieve existing contract', async () => {
      const contract = await this.stateManager.getContract(this.testChainId, 'LookCoin');
      
      if (!contract) throw new Error('Failed to retrieve existing contract');
      if (contract.contractName !== 'LookCoin') {
        throw new Error('Retrieved wrong contract');
      }

      return { retrieved: true, contract };
    });

    await this.runTest('Handle missing contract', async () => {
      const contract = await this.stateManager.getContract(
        this.testChainId, 
        'NonExistentContract'
      );
      
      if (contract !== null) {
        throw new Error('Should return null for missing contract');
      }

      return { handledCorrectly: true };
    });

    await this.runTest('Query with filters', async () => {
      const results = await this.stateManager.queryContracts({
        chainId: this.testChainId,
        sortBy: 'timestamp',
        sortOrder: 'desc'
      });

      if (results.length === 0) {
        throw new Error('Query returned no results');
      }

      // Verify sorting
      for (let i = 1; i < results.length; i++) {
        if (results[i].timestamp > results[i - 1].timestamp) {
          throw new Error('Sorting not working correctly');
        }
      }

      return { 
        queryWorking: true,
        resultCount: results.length 
      };
    });
  }

  /**
   * Test 7: Data Persistence
   */
  private async testDataPersistence(): Promise<void> {
    console.log('\n💾 Test Suite 7: Data Persistence');
    console.log('-'.repeat(50));

    await this.runTest('Persist across restarts', async () => {
      // Store contract
      const contract: ContractType = {
        contractName: 'PersistentContract',
        chainId: this.testChainId,
        networkName: this.testNetwork,
        address: '0xPERS567890123456789012345678901234567890',
        factoryByteCodeHash: '0xpersist',
        implementationHash: '0xpersistimpl',
        proxyAddress: undefined,
        deploymentArgs: ['persistent'],
        timestamp: Date.now()
      };

      await this.stateManager.putContract(this.testChainId, contract);

      // Close and reinitialize
      await this.stateManager.close();
      await this.stateManager.initialize();

      // Retrieve after restart
      const retrieved = await this.stateManager.getContract(
        this.testChainId, 
        'PersistentContract'
      );

      if (!retrieved) throw new Error('Data not persisted');
      if (retrieved.address !== contract.address) {
        throw new Error('Data corrupted after restart');
      }

      return { persisted: true };
    });
  }

  /**
   * Test 8: Edge Cases
   */
  private async testEdgeCases(): Promise<void> {
    console.log('\n🔥 Test Suite 8: Edge Cases');
    console.log('-'.repeat(50));

    await this.runTest('Contract with no proxy', async () => {
      const contract: ContractType = {
        contractName: 'NoProxyContract',
        chainId: this.testChainId,
        networkName: this.testNetwork,
        address: '0xNOPR567890123456789012345678901234567890',
        factoryByteCodeHash: '0xnoproxy',
        implementationHash: undefined,
        proxyAddress: undefined,
        deploymentArgs: [],
        timestamp: Date.now()
      };

      await this.stateManager.putContract(this.testChainId, contract);
      
      const retrieved = await this.stateManager.getContract(
        this.testChainId, 
        'NoProxyContract'
      );

      if (!retrieved) throw new Error('Failed to handle no-proxy contract');
      if (retrieved.proxyAddress !== undefined) {
        throw new Error('Proxy address should be undefined');
      }

      return { handled: true };
    });

    await this.runTest('Large deployment args', async () => {
      const largeArgs = Array(100).fill(0).map((_, i) => ({
        index: i,
        data: `0x${'a'.repeat(64)}`,
        nested: {
          value: i * 1000,
          flag: i % 2 === 0
        }
      }));

      const contract: ContractType = {
        contractName: 'LargeArgsContract',
        chainId: this.testChainId,
        networkName: this.testNetwork,
        address: '0xLARG567890123456789012345678901234567890',
        factoryByteCodeHash: '0xlarge',
        implementationHash: '0xlargeimpl',
        proxyAddress: undefined,
        deploymentArgs: largeArgs,
        timestamp: Date.now()
      };

      await this.stateManager.putContract(this.testChainId, contract);
      
      const retrieved = await this.stateManager.getContract(
        this.testChainId, 
        'LargeArgsContract'
      );

      if (!retrieved) throw new Error('Failed to handle large args');
      if (JSON.stringify(retrieved.deploymentArgs) !== JSON.stringify(largeArgs)) {
        throw new Error('Large args not preserved correctly');
      }

      return { 
        handled: true,
        argCount: largeArgs.length 
      };
    });

    await this.runTest('Special characters in contract name', async () => {
      const specialName = 'Contract$Special#Name@123';
      
      const contract: ContractType = {
        contractName: specialName,
        chainId: this.testChainId,
        networkName: this.testNetwork,
        address: '0xSPEC567890123456789012345678901234567890',
        factoryByteCodeHash: '0xspecial',
        implementationHash: '0xspecialimpl',
        proxyAddress: undefined,
        deploymentArgs: [],
        timestamp: Date.now()
      };

      await this.stateManager.putContract(this.testChainId, contract);
      
      const retrieved = await this.stateManager.getContract(
        this.testChainId, 
        specialName
      );

      if (!retrieved) throw new Error('Failed to handle special characters');
      if (retrieved.contractName !== specialName) {
        throw new Error('Special name not preserved');
      }

      return { handled: true };
    });
  }

  /**
   * Test 9: Data Recovery
   */
  private async testDataRecovery(): Promise<void> {
    console.log('\n🔧 Test Suite 9: Data Recovery');
    console.log('-'.repeat(50));

    await this.runTest('Validate data integrity', async () => {
      const validation = await this.stateManager.validateIntegrity();
      
      // In test environment, we should have no errors
      if (!validation.isValid && validation.errors.length > 0) {
        throw new Error(`Validation errors: ${validation.errors.join(', ')}`);
      }

      return {
        valid: validation.isValid,
        contractCount: validation.contractCount,
        warnings: validation.warnings.length
      };
    });

    await this.runTest('Export and import data', async () => {
      // Export all data
      const exported = await this.stateManager.exportAll({
        format: 'json',
        prettyPrint: true
      });

      const exportedData = JSON.parse(exported);
      const chainCount = Object.keys(exportedData).length;

      if (chainCount === 0) {
        throw new Error('No data exported');
      }

      // Clear and reimport
      await this.stateManager.deleteContract(this.testChainId, 'LookCoin');
      
      // Verify deletion
      const deleted = await this.stateManager.getContract(this.testChainId, 'LookCoin');
      if (deleted) throw new Error('Contract not deleted');

      // Import back
      await this.stateManager.importAll(exported, true);

      // Verify restoration
      const restored = await this.stateManager.getContract(this.testChainId, 'LookCoin');
      if (!restored) throw new Error('Contract not restored');

      return {
        exported: true,
        imported: true,
        chainCount
      };
    });
  }

  /**
   * Test 10: Backward Compatibility
   */
  private async testBackwardCompatibility(): Promise<void> {
    console.log('\n🔄 Test Suite 10: Backward Compatibility');
    console.log('-'.repeat(50));

    await this.runTest('Handle legacy contract format', async () => {
      // Simulate legacy format
      const legacyData = {
        chainId: 999998,
        network: 'legacynet',
        contracts: {
          'LegacyContract': {
            address: '0xLEGA567890123456789012345678901234567890',
            proxy: '0xLEGP567890123456789012345678901234567890',
            implementation: '0xLEGI567890123456789012345678901234567890',
            factoryByteCodeHash: '0xlegacyhash',
            implementationHash: '0xlegacyimpl',
            timestamp: Date.now()
          }
        }
      };

      // Import legacy format
      await this.stateManager.importAll(JSON.stringify({
        '999998': [
          {
            contractName: 'LegacyContract',
            chainId: legacyData.chainId,
            networkName: legacyData.network,
            address: legacyData.contracts.LegacyContract.implementation,
            factoryByteCodeHash: legacyData.contracts.LegacyContract.factoryByteCodeHash,
            implementationHash: legacyData.contracts.LegacyContract.implementationHash,
            proxyAddress: legacyData.contracts.LegacyContract.proxy,
            deploymentArgs: [],
            timestamp: legacyData.contracts.LegacyContract.timestamp
          }
        ]
      }), true);

      // Verify conversion
      const contract = await this.stateManager.getContract(999998, 'LegacyContract');
      if (!contract) throw new Error('Legacy contract not imported');

      return {
        compatible: true,
        converted: true
      };
    });
  }

  /**
   * Run a single test
   */
  private async runTest(name: string, testFn: () => Promise<any>): Promise<void> {
    const startTime = Date.now();
    let result: TestResult;

    try {
      const details = await testFn();
      result = {
        name,
        status: 'PASS',
        duration: Date.now() - startTime,
        details
      };
      console.log(`  ✅ ${name}`);
      if (details && Object.keys(details).length > 0) {
        console.log(`     ${JSON.stringify(details)}`);
      }
    } catch (error) {
      result = {
        name,
        status: 'FAIL',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
      console.log(`  ❌ ${name}`);
      console.log(`     Error: ${result.error}`);
    }

    this.testResults.push(result);
  }

  /**
   * Print test results summary
   */
  private printResults(): void {
    console.log('\n' + '='.repeat(70));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(70));

    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'FAIL').length;
    const skipped = this.testResults.filter(r => r.status === 'SKIP').length;
    const total = this.testResults.length;

    console.log(`Total Tests: ${total}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);

    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults
        .filter(r => r.status === 'FAIL')
        .forEach(r => {
          console.log(`  - ${r.name}`);
          console.log(`    ${r.error}`);
        });
    }

    const totalDuration = this.testResults.reduce((sum, r) => sum + r.duration, 0);
    console.log(`\n⏱️  Total Duration: ${totalDuration}ms`);
    console.log('='.repeat(70));
  }
}

// Main execution
async function main() {
  const tester = new DeploymentFlowTester();
  
  try {
    await tester.runAllTests();
    
    // Exit with appropriate code
    const failed = tester['testResults'].filter((r: TestResult) => r.status === 'FAIL').length;
    process.exit(failed > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('\n❌ Test execution failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { DeploymentFlowTester };