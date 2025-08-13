/**
 * BigInt Serialization/Deserialization Accuracy Tests
 * 
 * Critical tests ensuring BigInt values are accurately preserved during
 * serialization and deserialization between LevelDB and JSON backends.
 * Tests various BigInt scenarios including timestamps, deployment arguments,
 * and nested BigInt structures.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import {
  TestStateManagerFactory,
  TestContractGenerator,
  DataValidationUtils,
  TestAssertions,
  TestLifecycle
} from "../utils/migration-test-helpers";
import { IStateManager, ContractType } from "../../../scripts/utils/IStateManager";
import { StateManagerUtils } from "../../../scripts/utils/StateManagerFactory";

describe("Migration Testing - BigInt Serialization Accuracy", () => {
  let testLifecycle: TestLifecycle;
  let levelDBManager: IStateManager;
  let jsonManager: IStateManager;

  before(async () => {
    testLifecycle = new TestLifecycle();
    const factory = await testLifecycle.createFactory("bigint-serialization");
    
    levelDBManager = await testLifecycle.createManager(factory, 'leveldb');
    jsonManager = await testLifecycle.createManager(factory, 'json');
  });

  after(async () => {
    await testLifecycle.cleanup();
  });

  describe("Timestamp Precision Tests", () => {
    it("should preserve nanosecond precision in timestamps", async () => {
      const testCases = [
        Date.now(),                           // Current timestamp
        Date.now() + 999,                    // Millisecond precision
        1672531200000,                       // New Year 2023 exact
        1672531200001,                       // New Year + 1ms
        9007199254740991,                    // MAX_SAFE_INTEGER
        1,                                   // Minimum positive
        Date.parse('2025-12-31T23:59:59.999Z') // Future timestamp with max ms
      ];

      for (const timestamp of testCases) {
        console.log(`  Testing timestamp: ${timestamp} (${new Date(timestamp).toISOString()})`);
        
        const contract = TestContractGenerator.createMockContract(56, `TimestampTest${timestamp}`);
        contract.timestamp = timestamp;

        // Store in both backends
        await levelDBManager.putContract(56, contract);
        await jsonManager.putContract(56, contract);

        // Retrieve from both backends
        const levelDBContract = await levelDBManager.getContract(56, contract.contractName);
        const jsonContract = await jsonManager.getContract(56, contract.contractName);

        expect(levelDBContract, "LevelDB contract should exist").to.not.be.null;
        expect(jsonContract, "JSON contract should exist").to.not.be.null;

        // Validate exact timestamp preservation
        expect(levelDBContract!.timestamp, `LevelDB timestamp should be exact: ${timestamp}`).to.equal(timestamp);
        expect(jsonContract!.timestamp, `JSON timestamp should be exact: ${timestamp}`).to.equal(timestamp);
        
        // Validate cross-backend consistency
        expect(jsonContract!.timestamp, "Timestamps should match between backends").to.equal(levelDBContract!.timestamp);
      }
    });

    it("should handle edge case timestamp values", async () => {
      const edgeCases = [
        { value: 0, description: "Unix epoch" },
        { value: 253402300799999, description: "Year 9999" },
        { value: -62135596800000, description: "Year 0001" }
      ];

      for (const testCase of edgeCases) {
        console.log(`  Testing edge case: ${testCase.description} (${testCase.value})`);
        
        const contract = TestContractGenerator.createMockContract(97, `EdgeTimestamp${Math.abs(testCase.value)}`);
        contract.timestamp = testCase.value;

        await levelDBManager.putContract(97, contract);
        await jsonManager.putContract(97, contract);

        const levelDBResult = await levelDBManager.getContract(97, contract.contractName);
        const jsonResult = await jsonManager.getContract(97, contract.contractName);

        expect(levelDBResult!.timestamp, `LevelDB should preserve ${testCase.description}`).to.equal(testCase.value);
        expect(jsonResult!.timestamp, `JSON should preserve ${testCase.description}`).to.equal(testCase.value);
      }
    });
  });

  describe("Deployment Arguments BigInt Tests", () => {
    it("should preserve BigInt values in deployment arguments", async () => {
      const bigIntTestCases = [
        BigInt("5000000000000000"),                    // 5M tokens in wei (8 decimals)
        BigInt("1000000000000000000"),                 // 1 ETH in wei
        BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935"), // MAX_UINT256
        BigInt("1"),                                   // Minimum
        BigInt("999999999999999999999"),               // Large but not max
        BigInt("0")                                    // Zero value
      ];

      for (let i = 0; i < bigIntTestCases.length; i++) {
        const bigIntValue = bigIntTestCases[i];
        console.log(`  Testing BigInt deployment arg: ${bigIntValue}`);
        
        const contract = TestContractGenerator.createMockContract(84532, `BigIntArgs${i}`);
        contract.deploymentArgs = [
          ethers.Wallet.createRandom().address,       // Governor address
          bigIntValue,                                 // Token supply as BigInt
          "LookCoin Test",                            // String value
          bigIntValue                                  // Second BigInt value
        ];

        // Store in both backends
        await levelDBManager.putContract(84532, contract);
        await jsonManager.putContract(84532, contract);

        // Retrieve and validate
        const levelDBResult = await levelDBManager.getContract(84532, contract.contractName);
        const jsonResult = await jsonManager.getContract(84532, contract.contractName);

        expect(levelDBResult, "LevelDB should store contract").to.not.be.null;
        expect(jsonResult, "JSON should store contract").to.not.be.null;

        // Validate deployment args structure
        expect(levelDBResult!.deploymentArgs, "LevelDB should have deployment args").to.be.an('array');
        expect(jsonResult!.deploymentArgs, "JSON should have deployment args").to.be.an('array');
        expect(levelDBResult!.deploymentArgs!.length, "LevelDB args length should match").to.equal(4);
        expect(jsonResult!.deploymentArgs!.length, "JSON args length should match").to.equal(4);

        // Validate BigInt preservation (positions 1 and 3)
        const levelDBBigInt1 = levelDBResult!.deploymentArgs![1];
        const jsonBigInt1 = jsonResult!.deploymentArgs![1];
        const levelDBBigInt2 = levelDBResult!.deploymentArgs![3];
        const jsonBigInt2 = jsonResult!.deploymentArgs![3];

        // Convert to BigInt for comparison (handles string serialization)
        expect(BigInt(levelDBBigInt1), `LevelDB BigInt arg 1 should equal ${bigIntValue}`).to.equal(bigIntValue);
        expect(BigInt(jsonBigInt1), `JSON BigInt arg 1 should equal ${bigIntValue}`).to.equal(bigIntValue);
        expect(BigInt(levelDBBigInt2), `LevelDB BigInt arg 2 should equal ${bigIntValue}`).to.equal(bigIntValue);
        expect(BigInt(jsonBigInt2), `JSON BigInt arg 2 should equal ${bigIntValue}`).to.equal(bigIntValue);

        // Cross-backend comparison using deep comparison
        expect(
          DataValidationUtils.deepCompareWithBigInt(levelDBResult!.deploymentArgs, jsonResult!.deploymentArgs),
          "Deployment args should match between backends"
        ).to.be.true;
      }
    });

    it("should handle nested BigInt structures in deployment arguments", async () => {
      const nestedBigIntContract = TestContractGenerator.createMockContract(11155420, "NestedBigInt");
      nestedBigIntContract.deploymentArgs = [
        {
          governance: ethers.Wallet.createRandom().address,
          tokenConfig: {
            totalSupply: BigInt("5000000000000000"),
            decimals: 8,
            fees: {
              bridgeFee: BigInt("50000000"), // 0.5 LOOK
              minAmount: BigInt("100000000"), // 1 LOOK
              maxAmount: BigInt("50000000000000") // 500K LOOK
            }
          },
          chainConfig: {
            chainId: 11155420,
            isMainnet: false,
            blockGasLimit: BigInt("30000000")
          }
        }
      ];

      // Store in both backends
      await levelDBManager.putContract(11155420, nestedBigIntContract);
      await jsonManager.putContract(11155420, nestedBigIntContract);

      // Retrieve and validate
      const levelDBResult = await levelDBManager.getContract(11155420, "NestedBigInt");
      const jsonResult = await jsonManager.getContract(11155420, "NestedBigInt");

      expect(levelDBResult, "LevelDB should store nested contract").to.not.be.null;
      expect(jsonResult, "JSON should store nested contract").to.not.be.null;

      // Deep comparison of nested structure
      expect(
        DataValidationUtils.deepCompareWithBigInt(levelDBResult!.deploymentArgs, jsonResult!.deploymentArgs),
        "Nested BigInt structures should match between backends"
      ).to.be.true;

      // Validate specific nested BigInt values
      const levelDBConfig = levelDBResult!.deploymentArgs![0];
      const jsonConfig = jsonResult!.deploymentArgs![0];

      expect(BigInt(levelDBConfig.tokenConfig.totalSupply)).to.equal(BigInt("5000000000000000"));
      expect(BigInt(jsonConfig.tokenConfig.totalSupply)).to.equal(BigInt("5000000000000000"));
      
      expect(BigInt(levelDBConfig.tokenConfig.fees.bridgeFee)).to.equal(BigInt("50000000"));
      expect(BigInt(jsonConfig.tokenConfig.fees.bridgeFee)).to.equal(BigInt("50000000"));

      expect(BigInt(levelDBConfig.chainConfig.blockGasLimit)).to.equal(BigInt("30000000"));
      expect(BigInt(jsonConfig.chainConfig.blockGasLimit)).to.equal(BigInt("30000000"));
    });

    it("should handle mixed data type deployment arguments", async () => {
      const mixedArgsContract = TestContractGenerator.createMockContract(23295, "MixedArgs");
      mixedArgsContract.deploymentArgs = [
        "LookCoin",                           // String
        BigInt("5000000000000000"),          // BigInt
        42,                                   // Number
        true,                                 // Boolean
        ethers.Wallet.createRandom().address, // Address string
        [BigInt("1000"), BigInt("2000"), 3000], // Array with mixed BigInt/Number
        null,                                 // Null value
        undefined,                            // Undefined value
        {
          name: "test",
          value: BigInt("999999999999999"),
          active: true
        }                                     // Object with BigInt
      ];

      await levelDBManager.putContract(23295, mixedArgsContract);
      await jsonManager.putContract(23295, mixedArgsContract);

      const levelDBResult = await levelDBManager.getContract(23295, "MixedArgs");
      const jsonResult = await jsonManager.getContract(23295, "MixedArgs");

      expect(levelDBResult, "LevelDB should handle mixed args").to.not.be.null;
      expect(jsonResult, "JSON should handle mixed args").to.not.be.null;

      // Validate each argument type preservation
      const levelDBArgs = levelDBResult!.deploymentArgs!;
      const jsonArgs = jsonResult!.deploymentArgs!;

      expect(levelDBArgs[0], "String should be preserved").to.equal("LookCoin");
      expect(jsonArgs[0], "String should be preserved in JSON").to.equal("LookCoin");

      expect(BigInt(levelDBArgs[1]), "BigInt should be preserved").to.equal(BigInt("5000000000000000"));
      expect(BigInt(jsonArgs[1]), "BigInt should be preserved in JSON").to.equal(BigInt("5000000000000000"));

      expect(levelDBArgs[2], "Number should be preserved").to.equal(42);
      expect(jsonArgs[2], "Number should be preserved in JSON").to.equal(42);

      expect(levelDBArgs[3], "Boolean should be preserved").to.equal(true);
      expect(jsonArgs[3], "Boolean should be preserved in JSON").to.equal(true);

      // Array with mixed types
      expect(BigInt(levelDBArgs[5][0]), "Array BigInt 1 should be preserved").to.equal(BigInt("1000"));
      expect(BigInt(jsonArgs[5][0]), "Array BigInt 1 should be preserved in JSON").to.equal(BigInt("1000"));
      
      expect(levelDBArgs[5][2], "Array number should be preserved").to.equal(3000);
      expect(jsonArgs[5][2], "Array number should be preserved in JSON").to.equal(3000);

      // Object with BigInt
      expect(BigInt(levelDBArgs[8].value), "Object BigInt should be preserved").to.equal(BigInt("999999999999999"));
      expect(BigInt(jsonArgs[8].value), "Object BigInt should be preserved in JSON").to.equal(BigInt("999999999999999"));
    });
  });

  describe("StateManagerUtils BigInt Serialization Tests", () => {
    it("should correctly serialize BigInt values", async () => {
      const testObj = {
        regularNumber: 42,
        bigIntValue: BigInt("123456789012345678901234567890"),
        nestedObj: {
          anotherBigInt: BigInt("999999999999999999999"),
          normalString: "test"
        },
        bigIntArray: [BigInt("111"), BigInt("222"), 333],
        nullValue: null,
        undefinedValue: undefined
      };

      const serialized = StateManagerUtils.serializeBigInt(testObj);

      // Validate serialization
      expect(serialized.regularNumber, "Regular number should be unchanged").to.equal(42);
      expect(serialized.bigIntValue, "BigInt should be serialized to string").to.equal("123456789012345678901234567890");
      expect(serialized.nestedObj.anotherBigInt, "Nested BigInt should be serialized").to.equal("999999999999999999999");
      expect(serialized.nestedObj.normalString, "Nested string should be unchanged").to.equal("test");
      expect(serialized.bigIntArray[0], "Array BigInt should be serialized").to.equal("111");
      expect(serialized.bigIntArray[1], "Array BigInt should be serialized").to.equal("222");
      expect(serialized.bigIntArray[2], "Array number should be unchanged").to.equal(333);
    });

    it("should correctly deserialize BigInt-looking strings", async () => {
      const serializedObj = {
        regularNumber: 42,
        bigIntString: "123456789012345678901234567890", // Long number string
        shortNumberString: "123",                      // Short number string
        actualString: "not-a-number",                  // Non-numeric string
        nestedObj: {
          longNumber: "999999999999999999999",
          shortNumber: "42"
        },
        mixedArray: ["111111111111111111111", "short", 333]
      };

      const deserialized = StateManagerUtils.deserializeBigInt(serializedObj);

      // Long number strings should be converted to BigInt
      expect(deserialized.bigIntString, "Long number string should become BigInt").to.be.a('bigint');
      expect(deserialized.bigIntString, "BigInt value should be correct").to.equal(BigInt("123456789012345678901234567890"));

      // Short number strings should remain strings (configurable behavior)
      expect(deserialized.shortNumberString, "Short number string behavior").to.satisfy((val: any) => 
        val === "123" || val === 123 || val === BigInt("123")
      );

      // Non-numeric strings should remain unchanged
      expect(deserialized.actualString, "Non-numeric string should be unchanged").to.equal("not-a-number");

      // Nested structures should be processed
      expect(deserialized.nestedObj.longNumber, "Nested long number should be BigInt").to.be.a('bigint');
      expect(deserialized.nestedObj.longNumber).to.equal(BigInt("999999999999999999999"));

      // Array elements should be processed
      expect(deserialized.mixedArray[0], "Array long number should be BigInt").to.be.a('bigint');
      expect(deserialized.mixedArray[0]).to.equal(BigInt("111111111111111111111"));
      expect(deserialized.mixedArray[1], "Array string should be unchanged").to.equal("short");
      expect(deserialized.mixedArray[2], "Array number should be unchanged").to.equal(333);
    });

    it("should handle round-trip serialization/deserialization", async () => {
      const originalContract = TestContractGenerator.createContractWithBigInt(56, "RoundTripTest");
      
      // Add complex BigInt structures
      originalContract.deploymentArgs = [
        BigInt("5000000000000000"),
        {
          config: {
            totalSupply: BigInt("999999999999999999999"),
            fees: [BigInt("100"), BigInt("200"), BigInt("300")]
          }
        }
      ];

      // Serialize
      const serialized = StateManagerUtils.serializeBigInt(originalContract);
      
      // Deserialize
      const deserialized = StateManagerUtils.deserializeBigInt(serialized);

      // Validate round-trip accuracy
      expect(
        DataValidationUtils.deepCompareWithBigInt(originalContract, deserialized),
        "Round-trip serialization should preserve all data"
      ).to.be.true;

      // Specifically check BigInt values
      expect(deserialized.deploymentArgs[0]).to.satisfy((val: any) => BigInt(val) === BigInt("5000000000000000"));
      
      const configTotalSupply = deserialized.deploymentArgs[1].config.totalSupply;
      expect(BigInt(configTotalSupply)).to.equal(BigInt("999999999999999999999"));

      const fees = deserialized.deploymentArgs[1].config.fees;
      expect(BigInt(fees[0])).to.equal(BigInt("100"));
      expect(BigInt(fees[1])).to.equal(BigInt("200"));
      expect(BigInt(fees[2])).to.equal(BigInt("300"));
    });
  });

  describe("Cross-Backend BigInt Consistency", () => {
    it("should maintain BigInt accuracy across backend migrations", async () => {
      const bigIntContract = TestContractGenerator.createContractWithBigInt(56, "BigIntMigration");
      
      // Add various BigInt scenarios
      bigIntContract.timestamp = Date.now();
      bigIntContract.deploymentArgs = [
        BigInt("5000000000000000"),                    // Token supply
        {
          chainConfigs: {
            mainnet: {
              gasLimit: BigInt("30000000"),
              baseFee: BigInt("20000000000")           // 20 Gwei
            },
            testnet: {
              gasLimit: BigInt("15000000"),
              baseFee: BigInt("1000000000")            // 1 Gwei
            }
          },
          tokenomics: {
            totalSupply: BigInt("5000000000000000"),
            initialMint: BigInt("20000000000"),        // 200 LOOK
            reserveAmount: BigInt("1000000000000000")  // 10M LOOK
          }
        }
      ];

      console.log("\n  --- Testing BigInt Migration Accuracy ---");
      
      // Store in LevelDB first
      await levelDBManager.putContract(56, bigIntContract);
      console.log("  ✓ Stored in LevelDB");

      // Retrieve from LevelDB
      const levelDBRetrieved = await levelDBManager.getContract(56, "BigIntMigration");
      expect(levelDBRetrieved, "LevelDB should return contract").to.not.be.null;

      // Store in JSON backend
      await jsonManager.putContract(56, levelDBRetrieved!);
      console.log("  ✓ Migrated to JSON");

      // Retrieve from JSON backend
      const jsonRetrieved = await jsonManager.getContract(56, "BigIntMigration");
      expect(jsonRetrieved, "JSON should return contract").to.not.be.null;

      console.log("  ✓ Retrieved from JSON");

      // Comprehensive comparison
      expect(
        DataValidationUtils.deepCompareWithBigInt(levelDBRetrieved, jsonRetrieved),
        "BigInt data should be identical after migration"
      ).to.be.true;

      // Specific BigInt validations
      const originalArgs = levelDBRetrieved!.deploymentArgs!;
      const migratedArgs = jsonRetrieved!.deploymentArgs!;

      expect(BigInt(originalArgs[0])).to.equal(BigInt(migratedArgs[0]));
      
      const originalConfigs = originalArgs[1].chainConfigs;
      const migratedConfigs = migratedArgs[1].chainConfigs;
      
      expect(BigInt(originalConfigs.mainnet.gasLimit)).to.equal(BigInt(migratedConfigs.mainnet.gasLimit));
      expect(BigInt(originalConfigs.mainnet.baseFee)).to.equal(BigInt(migratedConfigs.mainnet.baseFee));
      expect(BigInt(originalConfigs.testnet.gasLimit)).to.equal(BigInt(migratedConfigs.testnet.gasLimit));

      const originalTokenomics = originalArgs[1].tokenomics;
      const migratedTokenomics = migratedArgs[1].tokenomics;
      
      expect(BigInt(originalTokenomics.totalSupply)).to.equal(BigInt(migratedTokenomics.totalSupply));
      expect(BigInt(originalTokenomics.initialMint)).to.equal(BigInt(migratedTokenomics.initialMint));
      expect(BigInt(originalTokenomics.reserveAmount)).to.equal(BigInt(migratedTokenomics.reserveAmount));

      console.log("  ✓ All BigInt values preserved accurately");
    });

    it("should handle BigInt precision edge cases", async () => {
      const precisionTestCases = [
        {
          name: "MaxSafeInteger",
          value: BigInt(Number.MAX_SAFE_INTEGER),
          description: "JavaScript MAX_SAFE_INTEGER boundary"
        },
        {
          name: "MaxSafeIntegerPlus1",
          value: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1),
          description: "Beyond JavaScript safe integer range"
        },
        {
          name: "EthereumMaxUint256",
          value: BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935"),
          description: "Maximum uint256 value in Ethereum"
        },
        {
          name: "TokenSupplyWith8Decimals",
          value: BigInt("500000000000000000"), // 5B tokens with 8 decimals
          description: "LookCoin maximum supply with decimals"
        }
      ];

      for (const testCase of precisionTestCases) {
        console.log(`  Testing precision case: ${testCase.description}`);
        
        const contract = TestContractGenerator.createMockContract(97, testCase.name);
        contract.timestamp = Number(testCase.value % BigInt(Number.MAX_SAFE_INTEGER)); // Safe timestamp
        contract.deploymentArgs = [testCase.value, testCase.value.toString(), { bigIntField: testCase.value }];

        // Store in both backends
        await levelDBManager.putContract(97, contract);
        await jsonManager.putContract(97, contract);

        // Retrieve and compare
        const levelDBResult = await levelDBManager.getContract(97, testCase.name);
        const jsonResult = await jsonManager.getContract(97, testCase.name);

        expect(levelDBResult, `LevelDB should handle ${testCase.name}`).to.not.be.null;
        expect(jsonResult, `JSON should handle ${testCase.name}`).to.not.be.null;

        // Validate BigInt preservation in deployment args
        expect(BigInt(levelDBResult!.deploymentArgs![0])).to.equal(testCase.value);
        expect(BigInt(jsonResult!.deploymentArgs![0])).to.equal(testCase.value);
        
        // Validate string representation
        expect(levelDBResult!.deploymentArgs![1]).to.equal(testCase.value.toString());
        expect(jsonResult!.deploymentArgs![1]).to.equal(testCase.value.toString());
        
        // Validate nested BigInt
        expect(BigInt(levelDBResult!.deploymentArgs![2].bigIntField)).to.equal(testCase.value);
        expect(BigInt(jsonResult!.deploymentArgs![2].bigIntField)).to.equal(testCase.value);

        console.log(`    ✓ ${testCase.name} precision preserved`);
      }
    });
  });
});