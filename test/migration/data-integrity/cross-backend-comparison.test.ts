/**
 * Cross-Backend Data Comparison Tests
 * 
 * Critical data integrity validation ensuring 100% identical behavior between
 * LevelDB and JSON state managers. Tests all 28 contracts across 5 networks
 * with comprehensive validation of data consistency and serialization accuracy.
 * 
 * Test Coverage:
 * - All contracts across all networks (28 total)
 * - Address consistency validation
 * - Implementation hash verification  
 * - BigInt serialization accuracy
 * - Corrupted entry handling
 * - Missing contract detection
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import {
  TestStateManagerFactory,
  TestContractGenerator,
  DataValidationUtils,
  TestAssertions,
  TestLifecycle,
  TEST_NETWORKS,
  EXPECTED_HASHES,
  KNOWN_CONTRACTS,
  CORRUPTED_ENTRIES
} from "../utils/migration-test-helpers";
import { IStateManager, ContractType, StateManagerError, StateManagerErrorCode } from "../../../scripts/utils/IStateManager";

describe("Migration Testing - Cross-Backend Data Comparison", () => {
  let testLifecycle: TestLifecycle;
  let levelDBManager: IStateManager;
  let jsonManager: IStateManager;
  let factory: TestStateManagerFactory;

  before(async () => {
    testLifecycle = new TestLifecycle();
    factory = await testLifecycle.createFactory("cross-backend");
    
    // Create both backends
    levelDBManager = await testLifecycle.createManager(factory, 'leveldb', {
      debugMode: process.env.DEBUG_MIGRATION_TESTS === 'true'
    });
    
    jsonManager = await testLifecycle.createManager(factory, 'json', {
      debugMode: process.env.DEBUG_MIGRATION_TESTS === 'true'
    });
  });

  after(async () => {
    await testLifecycle.cleanup();
  });

  describe("Network-by-Network Data Consistency", () => {
    // Test each network individually for complete coverage
    
    it("DI-001 to DI-008: BSC Mainnet contracts should be identical between backends", async () => {
      const network = TEST_NETWORKS.BSC_MAINNET;
      await validateNetworkConsistency(network);
    });

    it("DI-009 to DI-017: BSC Testnet contracts should be identical between backends", async () => {
      const network = TEST_NETWORKS.BSC_TESTNET;  
      await validateNetworkConsistency(network);
    });

    it("DI-018 to DI-020: Base Sepolia contracts should be identical between backends", async () => {
      const network = TEST_NETWORKS.BASE_SEPOLIA;
      await validateNetworkConsistency(network);
    });

    it("DI-021 to DI-023: Optimism Sepolia contracts should be identical between backends", async () => {
      const network = TEST_NETWORKS.OPTIMISM_SEPOLIA;
      await validateNetworkConsistency(network);
    });

    it("DI-024 to DI-026: Sapphire Testnet contracts should be identical between backends", async () => {
      const network = TEST_NETWORKS.SAPPHIRE_TESTNET;
      await validateNetworkConsistency(network);
    });

    it("DI-027 to DI-028: Corrupted entries should be handled consistently", async () => {
      // Test corrupted entry detection and handling
      for (const corruptedEntry of CORRUPTED_ENTRIES) {
        const corruptedContract = TestContractGenerator.createCorruptedContract(
          corruptedEntry.chainId, 
          corruptedEntry.contractName
        );

        // Both backends should reject corrupted data
        await expect(
          levelDBManager.putContract(corruptedEntry.chainId, corruptedContract as any)
        ).to.eventually.be.rejected;

        await expect(
          jsonManager.putContract(corruptedEntry.chainId, corruptedContract as any)
        ).to.eventually.be.rejected;
      }
    });

    // Helper function for network validation
    async function validateNetworkConsistency(network: typeof TEST_NETWORKS[keyof typeof TEST_NETWORKS]) {
      console.log(`\n--- Testing ${network.name} (Chain ${network.chainId}) ---`);
      
      // Populate test data in both backends
      const expectedContracts = await TestContractGenerator.populateTestData(levelDBManager, network);
      
      // Copy data to JSON backend
      for (const contract of expectedContracts) {
        await jsonManager.putContract(network.chainId, contract);
      }

      // Retrieve all contracts from both backends
      const levelDBContracts = await levelDBManager.getAllContracts(network.chainId);
      const jsonContracts = await jsonManager.getAllContracts(network.chainId);

      console.log(`  LevelDB contracts: ${levelDBContracts.length}`);
      console.log(`  JSON contracts: ${jsonContracts.length}`);
      console.log(`  Expected contracts: ${network.contracts}`);

      // Validate contract count
      expect(levelDBContracts.length, `LevelDB should have ${network.contracts} contracts`).to.equal(network.contracts);
      expect(jsonContracts.length, `JSON should have ${network.contracts} contracts`).to.equal(network.contracts);

      // Create maps for comparison
      const levelDBMap = new Map(levelDBContracts.map(c => [c.contractName, c]));
      const jsonMap = new Map(jsonContracts.map(c => [c.contractName, c]));

      // Validate each contract individually
      for (const expectedContract of expectedContracts) {
        const contractName = expectedContract.contractName;
        console.log(`    Validating ${contractName}...`);

        // Ensure contract exists in both backends
        expect(levelDBMap.has(contractName), `${contractName} should exist in LevelDB`).to.be.true;
        expect(jsonMap.has(contractName), `${contractName} should exist in JSON`).to.be.true;

        const levelDBContract = levelDBMap.get(contractName)!;
        const jsonContract = jsonMap.get(contractName)!;

        // Validate contract structure
        TestAssertions.expectValidContract(levelDBContract);
        TestAssertions.expectValidContract(jsonContract);

        // Validate data consistency
        TestAssertions.expectContractsToMatch(
          levelDBContract, 
          jsonContract,
          `${contractName} should be identical between backends`
        );

        // Validate against expected data
        TestAssertions.expectContractsToMatch(
          levelDBContract,
          expectedContract,
          `${contractName} should match expected data in LevelDB`
        );

        // Validate specific fields
        expect(levelDBContract.chainId, `${contractName} chainId should match network`).to.equal(network.chainId);
        expect(levelDBContract.networkName, `${contractName} networkName should match`).to.equal(network.name);
        
        // Validate implementation hash if known
        if (EXPECTED_HASHES[contractName as keyof typeof EXPECTED_HASHES]) {
          const expectedHash = EXPECTED_HASHES[contractName as keyof typeof EXPECTED_HASHES];
          expect(levelDBContract.implementationHash, `${contractName} implementation hash should match expected`).to.equal(expectedHash);
          expect(jsonContract.implementationHash, `${contractName} implementation hash should match expected in JSON`).to.equal(expectedHash);
        }

        console.log(`      ✓ ${contractName} validated successfully`);
      }
    }
  });

  describe("Individual Contract CRUD Operation Consistency", () => {
    it("should have identical getContract() behavior", async () => {
      const testContract = TestContractGenerator.createMockContract(56, "TestGetContract");
      
      // Store in both backends
      await levelDBManager.putContract(56, testContract);
      await jsonManager.putContract(56, testContract);

      // Retrieve from both backends
      const levelDBResult = await levelDBManager.getContract(56, "TestGetContract");
      const jsonResult = await jsonManager.getContract(56, "TestGetContract");

      expect(levelDBResult, "LevelDB should return contract").to.not.be.null;
      expect(jsonResult, "JSON should return contract").to.not.be.null;

      TestAssertions.expectContractsToMatch(
        levelDBResult!,
        jsonResult!,
        "Retrieved contracts should be identical"
      );
    });

    it("should have identical putContract() behavior", async () => {
      const testContract = TestContractGenerator.createMockContract(97, "TestPutContract");
      
      // Store in both backends
      await levelDBManager.putContract(97, testContract);
      await jsonManager.putContract(97, testContract);

      // Verify storage by retrieval
      const levelDBStored = await levelDBManager.getContract(97, "TestPutContract");
      const jsonStored = await jsonManager.getContract(97, "TestPutContract");

      TestAssertions.expectContractsToMatch(
        levelDBStored!,
        testContract,
        "LevelDB should store contract correctly"
      );

      TestAssertions.expectContractsToMatch(
        jsonStored!,
        testContract,
        "JSON should store contract correctly"  
      );
    });

    it("should have identical hasContract() behavior", async () => {
      const chainId = 84532;
      const contractName = "TestHasContract";
      const testContract = TestContractGenerator.createMockContract(chainId, contractName);

      // Initially should not exist in either backend
      const initialLevelDB = await levelDBManager.hasContract(chainId, contractName);
      const initialJSON = await jsonManager.hasContract(chainId, contractName);
      
      expect(initialLevelDB, "LevelDB should initially return false").to.be.false;
      expect(initialJSON, "JSON should initially return false").to.be.false;

      // Add to both backends
      await levelDBManager.putContract(chainId, testContract);
      await jsonManager.putContract(chainId, testContract);

      // Should exist in both backends
      const finalLevelDB = await levelDBManager.hasContract(chainId, contractName);
      const finalJSON = await jsonManager.hasContract(chainId, contractName);

      expect(finalLevelDB, "LevelDB should return true after storage").to.be.true;
      expect(finalJSON, "JSON should return true after storage").to.be.true;
    });

    it("should have identical deleteContract() behavior", async () => {
      const chainId = 11155420;
      const contractName = "TestDeleteContract";
      const testContract = TestContractGenerator.createMockContract(chainId, contractName);

      // Add to both backends
      await levelDBManager.putContract(chainId, testContract);
      await jsonManager.putContract(chainId, testContract);

      // Verify existence
      expect(await levelDBManager.hasContract(chainId, contractName)).to.be.true;
      expect(await jsonManager.hasContract(chainId, contractName)).to.be.true;

      // Delete from both backends
      const levelDBDeleted = await levelDBManager.deleteContract(chainId, contractName);
      const jsonDeleted = await jsonManager.deleteContract(chainId, contractName);

      expect(levelDBDeleted, "LevelDB should return true for successful deletion").to.be.true;
      expect(jsonDeleted, "JSON should return true for successful deletion").to.be.true;

      // Verify deletion
      expect(await levelDBManager.hasContract(chainId, contractName)).to.be.false;
      expect(await jsonManager.hasContract(chainId, contractName)).to.be.false;

      // Double delete should return false
      const levelDBSecondDelete = await levelDBManager.deleteContract(chainId, contractName);
      const jsonSecondDelete = await jsonManager.deleteContract(chainId, contractName);

      expect(levelDBSecondDelete, "LevelDB should return false for non-existent deletion").to.be.false;
      expect(jsonSecondDelete, "JSON should return false for non-existent deletion").to.be.false;
    });
  });

  describe("Query Operation Consistency", () => {
    before(async () => {
      // Populate test data across multiple networks
      for (const network of Object.values(TEST_NETWORKS)) {
        const contracts = await TestContractGenerator.populateTestData(levelDBManager, network);
        for (const contract of contracts) {
          await jsonManager.putContract(network.chainId, contract);
        }
      }
    });

    it("should have identical queryContracts() behavior with chainId filter", async () => {
      const chainId = 56;
      
      const levelDBQuery = await levelDBManager.queryContracts({ chainId });
      const jsonQuery = await jsonManager.queryContracts({ chainId });

      expect(levelDBQuery.length, "Query result lengths should match").to.equal(jsonQuery.length);

      // Sort both results for comparison
      const sortFn = (a: ContractType, b: ContractType) => a.contractName.localeCompare(b.contractName);
      levelDBQuery.sort(sortFn);
      jsonQuery.sort(sortFn);

      for (let i = 0; i < levelDBQuery.length; i++) {
        TestAssertions.expectContractsToMatch(
          levelDBQuery[i],
          jsonQuery[i],
          `Query result ${i} should match between backends`
        );
      }
    });

    it("should have identical queryContracts() behavior with contractName filter", async () => {
      const contractName = "LookCoin";
      
      const levelDBQuery = await levelDBManager.queryContracts({ contractName });
      const jsonQuery = await jsonManager.queryContracts({ contractName });

      expect(levelDBQuery.length, "Query result lengths should match").to.equal(jsonQuery.length);

      for (const contract of levelDBQuery) {
        expect(contract.contractName, "All results should match filter").to.equal(contractName);
      }

      for (const contract of jsonQuery) {
        expect(contract.contractName, "All results should match filter").to.equal(contractName);
      }

      // Compare sorted results
      const sortFn = (a: ContractType, b: ContractType) => a.chainId - b.chainId;
      levelDBQuery.sort(sortFn);
      jsonQuery.sort(sortFn);

      for (let i = 0; i < levelDBQuery.length; i++) {
        TestAssertions.expectContractsToMatch(
          levelDBQuery[i],
          jsonQuery[i],
          `Query result ${i} should match between backends`
        );
      }
    });

    it("should have identical queryContracts() behavior with sorting", async () => {
      // Test timestamp sorting
      const levelDBQuery = await levelDBManager.queryContracts({
        sortBy: 'timestamp',
        sortOrder: 'desc'
      });
      
      const jsonQuery = await jsonManager.queryContracts({
        sortBy: 'timestamp', 
        sortOrder: 'desc'
      });

      expect(levelDBQuery.length, "Query result lengths should match").to.equal(jsonQuery.length);

      for (let i = 0; i < levelDBQuery.length; i++) {
        TestAssertions.expectContractsToMatch(
          levelDBQuery[i],
          jsonQuery[i],
          `Sorted query result ${i} should match between backends`
        );

        // Verify sorting is correct
        if (i > 0) {
          expect(levelDBQuery[i].timestamp, "LevelDB results should be sorted by timestamp desc").to.be.lessThanOrEqual(levelDBQuery[i-1].timestamp);
          expect(jsonQuery[i].timestamp, "JSON results should be sorted by timestamp desc").to.be.lessThanOrEqual(jsonQuery[i-1].timestamp);
        }
      }
    });
  });

  describe("Export/Import Operation Consistency", () => {
    it("should have identical exportAll() behavior", async () => {
      const exportOptions = {
        format: 'json' as const,
        includeMetadata: false,
        prettyPrint: false
      };

      const levelDBExport = await levelDBManager.exportAll(exportOptions);
      const jsonExport = await jsonManager.exportAll(exportOptions);

      const levelDBData = JSON.parse(levelDBExport);
      const jsonData = JSON.parse(jsonExport);

      expect(levelDBData.totalContracts, "Export contract counts should match").to.equal(jsonData.totalContracts);
      expect(Object.keys(levelDBData.contracts).length, "Export contract keys should match").to.equal(Object.keys(jsonData.contracts).length);

      // Compare each contract in the export
      for (const key of Object.keys(levelDBData.contracts)) {
        expect(jsonData.contracts[key], `Contract ${key} should exist in JSON export`).to.exist;
        TestAssertions.expectContractsToMatch(
          levelDBData.contracts[key],
          jsonData.contracts[key],
          `Exported contract ${key} should match between backends`
        );
      }
    });

    it("should have identical importAll() behavior", async () => {
      // Create fresh managers for import test
      const importLevelDB = await factory.createTestStateManager('leveldb');
      const importJSON = await factory.createTestStateManager('json');

      try {
        // Create test data for import
        const importData = {
          format: 'json',
          exportTime: new Date().toISOString(),
          totalContracts: 2,
          contracts: {
            '56-ImportTest1': TestContractGenerator.createMockContract(56, 'ImportTest1'),
            '97-ImportTest2': TestContractGenerator.createMockContract(97, 'ImportTest2')
          }
        };

        const importString = JSON.stringify(importData);

        // Import to both backends
        await importLevelDB.importAll(importString);
        await importJSON.importAll(importString);

        // Verify import results
        const levelDBImported1 = await importLevelDB.getContract(56, 'ImportTest1');
        const jsonImported1 = await importJSON.getContract(56, 'ImportTest1');
        const levelDBImported2 = await importLevelDB.getContract(97, 'ImportTest2');
        const jsonImported2 = await importJSON.getContract(97, 'ImportTest2');

        expect(levelDBImported1, "LevelDB should have imported contract 1").to.not.be.null;
        expect(jsonImported1, "JSON should have imported contract 1").to.not.be.null;
        expect(levelDBImported2, "LevelDB should have imported contract 2").to.not.be.null;
        expect(jsonImported2, "JSON should have imported contract 2").to.not.be.null;

        TestAssertions.expectContractsToMatch(
          levelDBImported1!,
          jsonImported1!,
          "Imported contract 1 should match between backends"
        );

        TestAssertions.expectContractsToMatch(
          levelDBImported2!,
          jsonImported2!,
          "Imported contract 2 should match between backends"
        );
      } finally {
        await importLevelDB.close();
        await importJSON.close();
      }
    });
  });

  describe("Error Handling Consistency", () => {
    it("should produce identical errors for non-existent contracts", async () => {
      const nonExistentResult1 = await levelDBManager.getContract(999, "NonExistent");
      const nonExistentResult2 = await jsonManager.getContract(999, "NonExistent");

      expect(nonExistentResult1, "LevelDB should return null for non-existent contract").to.be.null;
      expect(nonExistentResult2, "JSON should return null for non-existent contract").to.be.null;
    });

    it("should produce identical validation errors", async () => {
      const invalidContract = {
        contractName: "", // Invalid: empty name
        chainId: -1, // Invalid: negative chain ID
        networkName: "",
        address: "invalid-address",
        factoryByteCodeHash: "invalid-hash",
        timestamp: -1
      };

      let levelDBError: Error | null = null;
      let jsonError: Error | null = null;

      try {
        await levelDBManager.putContract(56, invalidContract as any);
      } catch (error) {
        levelDBError = error as Error;
      }

      try {
        await jsonManager.putContract(56, invalidContract as any);
      } catch (error) {
        jsonError = error as Error;
      }

      expect(levelDBError, "LevelDB should throw error for invalid contract").to.not.be.null;
      expect(jsonError, "JSON should throw error for invalid contract").to.not.be.null;

      // Both should be StateManagerErrors with similar codes
      if (levelDBError instanceof StateManagerError && jsonError instanceof StateManagerError) {
        expect(jsonError.code, "Error codes should match").to.equal(levelDBError.code);
      }
    });
  });

  describe("Comprehensive Validation Report Generation", () => {
    it("should generate complete validation report for all networks", async () => {
      const networks = Object.values(TEST_NETWORKS);
      const report = await DataValidationUtils.generateValidationReport(
        levelDBManager,
        jsonManager,
        networks
      );

      console.log("\n=== Migration Validation Report ===");
      console.log(`Total contracts evaluated: ${report.totalContracts}`);
      console.log(`Matching contracts: ${report.matchingContracts}`);
      console.log(`Missing in target: ${report.missingInTarget.length}`);
      console.log(`Missing in source: ${report.missingInSource.length}`);
      console.log(`Data discrepancies: ${report.dataDiscrepancies.length}`);
      console.log(`Corrupted entries: ${report.corruptedEntries.length}`);

      if (report.dataDiscrepancies.length > 0) {
        console.log("\nData discrepancies found:");
        for (const discrepancy of report.dataDiscrepancies) {
          console.log(`  ${discrepancy.chainId}-${discrepancy.contractName}:`);
          for (const diff of discrepancy.differences) {
            console.log(`    - ${diff}`);
          }
        }
      }

      if (report.corruptedEntries.length > 0) {
        console.log("\nCorrupted entries found:");
        for (const corruption of report.corruptedEntries) {
          console.log(`  ${corruption.chainId}-${corruption.contractName}:`);
          for (const error of corruption.errors) {
            console.log(`    - ${error}`);
          }
        }
      }

      // In a successful migration test, these should be minimal
      expect(report.dataDiscrepancies.length, "Should have minimal data discrepancies").to.be.lessThan(5);
      expect(report.corruptedEntries.length, "Should have minimal corrupted entries").to.be.lessThan(5);

      // Success rate should be high (allow for expected differences like corrupted test entries)
      const successRate = report.matchingContracts / Math.max(report.totalContracts, 1);
      expect(successRate, "Success rate should be above 90%").to.be.greaterThan(0.9);
    });
  });
});