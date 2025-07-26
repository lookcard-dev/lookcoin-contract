import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployLookCoinFixture,
  testBooleanCombinations,
  testRoleBasedFunction,
  expectSpecificRevert,
  testConfigurationDependency,
  coverageTracker,
  BOOLEAN_COMBINATIONS,
  DeploymentFixture,
} from "../../../utils/comprehensiveTestHelpers";
import { TEST_CHAINS } from "../../../utils/testConfig";

describe("CelerConfiguration - Comprehensive Configuration Tests", function () {
  let fixture: DeploymentFixture;
  const DESTINATION_CHAIN_ID = TEST_CHAINS.OPTIMISM;
  const REMOTE_MODULE_ADDRESS = "0x" + "1".repeat(40);

  beforeEach(async function () {
    fixture = await loadFixture(deployLookCoinFixture);
  });

  describe("MessageBus Configuration Tests", function () {
    it("should update MessageBus with ADMIN_ROLE", async function () {
      const newMessageBus = ethers.Wallet.createRandom().address;
      
      await fixture.celerIMModule.connect(fixture.admin).updateMessageBus(newMessageBus);
      expect(await fixture.celerIMModule.messageBus()).to.equal(newMessageBus);
      
      coverageTracker.trackFunction("CelerIMModule", "updateMessageBus");
    });

    it("should revert updating MessageBus without ADMIN_ROLE", async function () {
      const newMessageBus = ethers.Wallet.createRandom().address;
      
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).updateMessageBus(newMessageBus),
        fixture.celerIMModule,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.celerIMModule.ADMIN_ROLE()
      );
    });

    it("should revert setting zero address as MessageBus", async function () {
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.admin).updateMessageBus(ethers.ZeroAddress),
        fixture.celerIMModule,
        "InvalidMessageBus"
      );
      coverageTracker.trackBranch("CelerIMModule", "updateMessageBus-zero-address-check");
    });

    it("should test MessageBus configuration state transitions", async function () {
      const messageBuses = [
        await fixture.mockCeler.getAddress(),
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
      ];

      await testBooleanCombinations(
        "MessageBus configuration",
        async () => (await fixture.celerIMModule.messageBus()) !== ethers.ZeroAddress,
        async (value) => {
          if (value) {
            await fixture.celerIMModule.connect(fixture.admin).updateMessageBus(messageBuses[0]);
          }
        },
        async (combination) => {
          if (combination.from && combination.to) {
            const currentBus = await fixture.celerIMModule.messageBus();
            const newBus = messageBuses.find(b => b !== currentBus) || messageBuses[1];
            await fixture.celerIMModule.connect(fixture.admin).updateMessageBus(newBus);
            expect(await fixture.celerIMModule.messageBus()).to.equal(newBus);
          }
          coverageTracker.trackBooleanCombination("CelerIMModule", `messageBus-${combination.description}`);
        }
      );
    });
  });

  describe("Remote Module Configuration Tests", function () {
    it("should set remote module with ADMIN_ROLE", async function () {
      await fixture.celerIMModule.connect(fixture.admin).setRemoteModule(
        DESTINATION_CHAIN_ID,
        REMOTE_MODULE_ADDRESS
      );
      
      expect(await fixture.celerIMModule.remoteModules(DESTINATION_CHAIN_ID)).to.equal(REMOTE_MODULE_ADDRESS);
      
      coverageTracker.trackFunction("CelerIMModule", "setRemoteModule");
    });

    it("should revert setting remote module without ADMIN_ROLE", async function () {
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).setRemoteModule(DESTINATION_CHAIN_ID, REMOTE_MODULE_ADDRESS),
        fixture.celerIMModule,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.celerIMModule.ADMIN_ROLE()
      );
    });

    it("should revert setting remote module for unsupported chain", async function () {
      // Chain not yet marked as supported
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.admin).setRemoteModule(DESTINATION_CHAIN_ID, REMOTE_MODULE_ADDRESS),
        fixture.celerIMModule,
        "ChainNotSupported"
      );
      coverageTracker.trackBranch("CelerIMModule", "setRemoteModule-unsupported-chain");
    });

    it("should test remote module boolean combinations", async function () {
      // First enable the chain
      await fixture.celerIMModule.connect(fixture.admin).setSupportedChain(DESTINATION_CHAIN_ID, true);
      
      const remoteAddresses = [
        ethers.ZeroAddress,
        REMOTE_MODULE_ADDRESS,
        "0x" + "2".repeat(40),
        ethers.ZeroAddress,
      ];
      
      await testBooleanCombinations(
        "Remote module configuration",
        async () => (await fixture.celerIMModule.remoteModules(DESTINATION_CHAIN_ID)) !== ethers.ZeroAddress,
        async (value) => {
          if (value) {
            await fixture.celerIMModule.connect(fixture.admin).setRemoteModule(DESTINATION_CHAIN_ID, REMOTE_MODULE_ADDRESS);
          } else {
            await fixture.celerIMModule.connect(fixture.admin).setRemoteModule(DESTINATION_CHAIN_ID, ethers.ZeroAddress);
          }
        },
        async (combination) => {
          const currentModule = await fixture.celerIMModule.remoteModules(DESTINATION_CHAIN_ID);
          
          if (combination.to) {
            expect(currentModule).to.not.equal(ethers.ZeroAddress);
          } else {
            expect(currentModule).to.equal(ethers.ZeroAddress);
          }
          
          coverageTracker.trackBooleanCombination("CelerIMModule", `remote-module-${combination.description}`);
        }
      );
    });
  });

  describe("Supported Chain Configuration Tests", function () {
    it("should set supported chain with ADMIN_ROLE", async function () {
      await fixture.celerIMModule.connect(fixture.admin).setSupportedChain(DESTINATION_CHAIN_ID, true);
      expect(await fixture.celerIMModule.supportedChains(DESTINATION_CHAIN_ID)).to.be.true;
      
      await fixture.celerIMModule.connect(fixture.admin).setSupportedChain(DESTINATION_CHAIN_ID, false);
      expect(await fixture.celerIMModule.supportedChains(DESTINATION_CHAIN_ID)).to.be.false;
      
      coverageTracker.trackFunction("CelerIMModule", "setSupportedChain");
    });

    it("should revert setting supported chain without ADMIN_ROLE", async function () {
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).setSupportedChain(DESTINATION_CHAIN_ID, true),
        fixture.celerIMModule,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.celerIMModule.ADMIN_ROLE()
      );
    });

    it("should test supported chain boolean combinations", async function () {
      await testBooleanCombinations(
        "Supported chain status",
        async () => fixture.celerIMModule.supportedChains(DESTINATION_CHAIN_ID),
        async (value) => {
          await fixture.celerIMModule.connect(fixture.admin).setSupportedChain(DESTINATION_CHAIN_ID, value);
        },
        async (combination) => {
          const isSupported = await fixture.celerIMModule.supportedChains(DESTINATION_CHAIN_ID);
          expect(isSupported).to.equal(combination.to);
          
          // Test that operations respect the supported status
          if (!combination.to) {
            await expectSpecificRevert(
              async () => fixture.celerIMModule.connect(fixture.admin).setRemoteModule(DESTINATION_CHAIN_ID, REMOTE_MODULE_ADDRESS),
              fixture.celerIMModule,
              "ChainNotSupported"
            );
          }
          
          coverageTracker.trackBooleanCombination("CelerIMModule", `supported-chain-${combination.description}`);
        }
      );
    });
  });

  describe("Fee Configuration Tests", function () {
    it("should update fee parameters with valid values", async function () {
      const feePercentage = 50; // 0.5%
      const minFee = ethers.parseEther("0.01");
      const maxFee = ethers.parseEther("10");
      
      await fixture.celerIMModule.connect(fixture.admin).updateFeeParameters(
        feePercentage,
        minFee,
        maxFee
      );
      
      expect(await fixture.celerIMModule.feePercentage()).to.equal(feePercentage);
      expect(await fixture.celerIMModule.minFee()).to.equal(minFee);
      expect(await fixture.celerIMModule.maxFee()).to.equal(maxFee);
      
      coverageTracker.trackFunction("CelerIMModule", "updateFeeParameters");
    });

    it("should revert updating fee parameters without ADMIN_ROLE", async function () {
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).updateFeeParameters(50, 1000, 10000),
        fixture.celerIMModule,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.celerIMModule.ADMIN_ROLE()
      );
    });

    it("should revert with fee percentage > 10%", async function () {
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.admin).updateFeeParameters(1001, 1000, 10000),
        fixture.celerIMModule,
        "InvalidFeePercentage"
      );
      coverageTracker.trackBranch("CelerIMModule", "updateFeeParameters-high-percentage");
    });

    it("should revert with minFee > maxFee", async function () {
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.admin).updateFeeParameters(50, 10000, 1000),
        fixture.celerIMModule,
        "InvalidFeeRange"
      );
      coverageTracker.trackBranch("CelerIMModule", "updateFeeParameters-invalid-range");
    });

    it("should calculate fees correctly with different amounts", async function () {
      // Set fee parameters: 1%, min 0.1, max 5
      const feePercentage = 100; // 1%
      const minFee = ethers.parseEther("0.1");
      const maxFee = ethers.parseEther("5");
      
      await fixture.celerIMModule.connect(fixture.admin).updateFeeParameters(
        feePercentage,
        minFee,
        maxFee
      );
      
      // Test cases
      const testCases = [
        { amount: ethers.parseEther("1"), expectedFee: minFee }, // Below minimum
        { amount: ethers.parseEther("10"), expectedFee: minFee }, // At minimum
        { amount: ethers.parseEther("100"), expectedFee: ethers.parseEther("1") }, // Normal percentage
        { amount: ethers.parseEther("1000"), expectedFee: maxFee }, // Above maximum
      ];
      
      for (const testCase of testCases) {
        const fee = await fixture.celerIMModule.calculateFee(testCase.amount);
        expect(fee).to.equal(testCase.expectedFee);
      }
      
      coverageTracker.trackFunction("CelerIMModule", "calculateFee");
      coverageTracker.trackBranch("CelerIMModule", "calculateFee-min-fee");
      coverageTracker.trackBranch("CelerIMModule", "calculateFee-percentage");
      coverageTracker.trackBranch("CelerIMModule", "calculateFee-max-fee");
    });

    it("should test fee parameter boolean combinations", async function () {
      const feeConfigs = [
        { percentage: 0, min: 0, max: 0 }, // No fees
        { percentage: 50, min: ethers.parseEther("0.01"), max: ethers.parseEther("1") }, // Low fees
        { percentage: 100, min: ethers.parseEther("0.1"), max: ethers.parseEther("10") }, // Normal fees
        { percentage: 0, min: 0, max: 0 }, // Back to no fees
      ];
      
      for (let i = 0; i < feeConfigs.length - 1; i++) {
        const fromConfig = feeConfigs[i];
        const toConfig = feeConfigs[i + 1];
        
        await fixture.celerIMModule.connect(fixture.admin).updateFeeParameters(
          toConfig.percentage,
          toConfig.min,
          toConfig.max
        );
        
        const hasFees = toConfig.percentage > 0 || toConfig.min > 0;
        const hadFees = fromConfig.percentage > 0 || fromConfig.min > 0;
        
        coverageTracker.trackBooleanCombination(
          "CelerIMModule",
          `fee-config-${hadFees ? "enabled" : "disabled"}-to-${hasFees ? "enabled" : "disabled"}`
        );
      }
    });
  });

  describe("Access Control Configuration Tests", function () {
    it("should update whitelist with OPERATOR_ROLE", async function () {
      await fixture.celerIMModule.connect(fixture.admin).grantRole(
        await fixture.celerIMModule.OPERATOR_ROLE(),
        fixture.operator.address
      );
      
      await fixture.celerIMModule.connect(fixture.operator).updateWhitelist(fixture.user.address, true);
      expect(await fixture.celerIMModule.whitelist(fixture.user.address)).to.be.true;
      
      await fixture.celerIMModule.connect(fixture.operator).updateWhitelist(fixture.user.address, false);
      expect(await fixture.celerIMModule.whitelist(fixture.user.address)).to.be.false;
      
      coverageTracker.trackFunction("CelerIMModule", "updateWhitelist");
    });

    it("should update blacklist with OPERATOR_ROLE", async function () {
      await fixture.celerIMModule.connect(fixture.admin).grantRole(
        await fixture.celerIMModule.OPERATOR_ROLE(),
        fixture.operator.address
      );
      
      await fixture.celerIMModule.connect(fixture.operator).updateBlacklist(fixture.user.address, true);
      expect(await fixture.celerIMModule.blacklist(fixture.user.address)).to.be.true;
      
      await fixture.celerIMModule.connect(fixture.operator).updateBlacklist(fixture.user.address, false);
      expect(await fixture.celerIMModule.blacklist(fixture.user.address)).to.be.false;
      
      coverageTracker.trackFunction("CelerIMModule", "updateBlacklist");
    });

    it("should test whitelist/blacklist boolean combinations", async function () {
      await fixture.celerIMModule.connect(fixture.admin).grantRole(
        await fixture.celerIMModule.OPERATOR_ROLE(),
        fixture.operator.address
      );
      
      // Test all 4 combinations of whitelist/blacklist
      const combinations = [
        { whitelist: false, blacklist: false },
        { whitelist: true, blacklist: false },
        { whitelist: false, blacklist: true },
        { whitelist: true, blacklist: true }, // Both true is invalid but should be tested
      ];
      
      for (const combo of combinations) {
        await fixture.celerIMModule.connect(fixture.operator).updateWhitelist(fixture.user.address, combo.whitelist);
        await fixture.celerIMModule.connect(fixture.operator).updateBlacklist(fixture.user.address, combo.blacklist);
        
        expect(await fixture.celerIMModule.whitelist(fixture.user.address)).to.equal(combo.whitelist);
        expect(await fixture.celerIMModule.blacklist(fixture.user.address)).to.equal(combo.blacklist);
        
        coverageTracker.trackBooleanCombination(
          "CelerIMModule",
          `access-control-whitelist:${combo.whitelist}-blacklist:${combo.blacklist}`
        );
      }
    });

    it("should test pause/unpause functionality", async function () {
      await testBooleanCombinations(
        "Pause state",
        async () => fixture.celerIMModule.paused(),
        async (value) => {
          if (value) {
            await fixture.celerIMModule.connect(fixture.admin).pause();
          } else {
            await fixture.celerIMModule.connect(fixture.admin).unpause();
          }
        },
        async (combination) => {
          const isPaused = await fixture.celerIMModule.paused();
          expect(isPaused).to.equal(combination.to);
          
          coverageTracker.trackBooleanCombination("CelerIMModule", `pause-state-${combination.description}`);
        }
      );
      
      coverageTracker.trackFunction("CelerIMModule", "pause");
      coverageTracker.trackFunction("CelerIMModule", "unpause");
    });
  });

  describe("Fee Collector Configuration Tests", function () {
    it("should update fee collector with ADMIN_ROLE", async function () {
      const newFeeCollector = ethers.Wallet.createRandom().address;
      
      await fixture.celerIMModule.connect(fixture.admin).updateFeeCollector(newFeeCollector);
      expect(await fixture.celerIMModule.feeCollector()).to.equal(newFeeCollector);
      
      coverageTracker.trackFunction("CelerIMModule", "updateFeeCollector");
    });

    it("should revert updating fee collector without ADMIN_ROLE", async function () {
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).updateFeeCollector(fixture.user.address),
        fixture.celerIMModule,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.celerIMModule.ADMIN_ROLE()
      );
    });

    it("should revert setting zero address as fee collector", async function () {
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.admin).updateFeeCollector(ethers.ZeroAddress),
        fixture.celerIMModule,
        "InvalidFeeCollector"
      );
      coverageTracker.trackBranch("CelerIMModule", "updateFeeCollector-zero-address");
    });
  });

  describe("Configuration Update Tests", function () {
    it("should update configuration via updateConfig", async function () {
      // Encode fee parameters
      const feePercentage = 75; // 0.75%
      const minFee = ethers.parseEther("0.05");
      const maxFee = ethers.parseEther("20");
      
      const configData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256"],
        [feePercentage, minFee, maxFee]
      );
      
      await fixture.celerIMModule.connect(fixture.admin).updateConfig(configData);
      
      expect(await fixture.celerIMModule.feePercentage()).to.equal(feePercentage);
      expect(await fixture.celerIMModule.minFee()).to.equal(minFee);
      expect(await fixture.celerIMModule.maxFee()).to.equal(maxFee);
      
      coverageTracker.trackFunction("CelerIMModule", "updateConfig");
    });

    it("should revert updateConfig without ADMIN_ROLE", async function () {
      const configData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256"],
        [50, 1000, 10000]
      );
      
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).updateConfig(configData),
        fixture.celerIMModule,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.celerIMModule.ADMIN_ROLE()
      );
    });

    it("should handle invalid config data gracefully", async function () {
      // Invalid encoded data (wrong types or length)
      const invalidConfigData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256"],
        [50]
      );
      
      // This should revert during decoding
      await expect(
        fixture.celerIMModule.connect(fixture.admin).updateConfig(invalidConfigData)
      ).to.be.reverted;
      
      coverageTracker.trackBranch("CelerIMModule", "updateConfig-invalid-data");
    });
  });

  describe("Multi-Chain Configuration Tests", function () {
    it("should configure multiple chains independently", async function () {
      const chains = [TEST_CHAINS.OPTIMISM, TEST_CHAINS.arbitrum, TEST_CHAINS.polygon];
      
      for (const chainId of chains) {
        // Enable chain
        await fixture.celerIMModule.connect(fixture.admin).setSupportedChain(chainId, true);
        
        // Set remote module
        const remoteAddress = `0x${chainId.toString(16).padStart(40, '0')}`;
        await fixture.celerIMModule.connect(fixture.admin).setRemoteModule(chainId, remoteAddress);
        
        // Verify configuration
        expect(await fixture.celerIMModule.supportedChains(chainId)).to.be.true;
        expect(await fixture.celerIMModule.remoteModules(chainId)).to.equal(remoteAddress);
      }
      
      // Verify chains are configured independently
      const unconfiguredChain = 999;
      expect(await fixture.celerIMModule.supportedChains(unconfiguredChain)).to.be.false;
      expect(await fixture.celerIMModule.remoteModules(unconfiguredChain)).to.equal(ethers.ZeroAddress);
      
      coverageTracker.trackBranch("CelerIMModule", "multi-chain-configuration");
    });
  });

  describe("Complete Configuration Validation Tests", function () {
    it("should validate complete module configuration for operations", async function () {
      // Initial state - not configured
      await expectSpecificRevert(
        async () => fixture.celerIMModule.bridge(
          fixture.user.address,
          ethers.parseEther("100"),
          DESTINATION_CHAIN_ID,
          0,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.celerIMModule,
        "ChainNotSupported"
      );
      
      // Enable chain
      await fixture.celerIMModule.connect(fixture.admin).setSupportedChain(DESTINATION_CHAIN_ID, true);
      
      // Still should fail without remote module
      await expectSpecificRevert(
        async () => fixture.celerIMModule.bridge(
          fixture.user.address,
          ethers.parseEther("100"),
          DESTINATION_CHAIN_ID,
          0,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.celerIMModule,
        "InvalidRemoteModule"
      );
      
      // Set remote module
      await fixture.celerIMModule.connect(fixture.admin).setRemoteModule(DESTINATION_CHAIN_ID, REMOTE_MODULE_ADDRESS);
      
      // Set fee collector
      await fixture.celerIMModule.connect(fixture.admin).updateFeeCollector(fixture.feeCollector.address);
      
      // Now configuration is complete
      // (actual bridge will fail due to token transfer, but configuration check passes)
      
      coverageTracker.trackBranch("CelerIMModule", "bridge-configuration-validation");
    });
  });

  describe("Edge Cases and Error Scenarios", function () {
    it("should handle maximum chain ID", async function () {
      const maxChainId = 2**32 - 1; // uint256 max practical for chain ID
      
      await fixture.celerIMModule.connect(fixture.admin).setSupportedChain(maxChainId, true);
      expect(await fixture.celerIMModule.supportedChains(maxChainId)).to.be.true;
      
      await fixture.celerIMModule.connect(fixture.admin).setRemoteModule(maxChainId, REMOTE_MODULE_ADDRESS);
      expect(await fixture.celerIMModule.remoteModules(maxChainId)).to.equal(REMOTE_MODULE_ADDRESS);
      
      coverageTracker.trackBranch("CelerIMModule", "max-chain-id-handling");
    });

    it("should handle fee calculation edge cases", async function () {
      // Set up fees
      await fixture.celerIMModule.connect(fixture.admin).updateFeeParameters(
        100, // 1%
        ethers.parseEther("0.1"),
        ethers.parseEther("10")
      );
      
      // Zero amount
      expect(await fixture.celerIMModule.calculateFee(0)).to.equal(ethers.parseEther("0.1")); // Min fee
      
      // Very small amount
      expect(await fixture.celerIMModule.calculateFee(1)).to.equal(ethers.parseEther("0.1")); // Min fee
      
      // Maximum uint256 (should not overflow)
      const maxAmount = ethers.MaxUint256;
      expect(await fixture.celerIMModule.calculateFee(maxAmount)).to.equal(ethers.parseEther("10")); // Max fee
      
      coverageTracker.trackBranch("CelerIMModule", "fee-calculation-edge-cases");
    });
  });
});