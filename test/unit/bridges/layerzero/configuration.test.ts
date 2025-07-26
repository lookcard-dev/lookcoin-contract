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

describe("LayerZeroConfiguration - Comprehensive Configuration Tests", function () {
  let fixture: DeploymentFixture;
  const DESTINATION_CHAIN_ID = TEST_CHAINS.OPTIMISM;
  const TRUSTED_REMOTE_ADDRESS = "0x" + "1".repeat(40);

  beforeEach(async function () {
    fixture = await loadFixture(deployLookCoinFixture);
  });

  describe("Endpoint Configuration Tests", function () {
    it("should set LayerZero endpoint with DEFAULT_ADMIN_ROLE", async function () {
      const newEndpoint = ethers.Wallet.createRandom().address;
      
      await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(newEndpoint);
      expect(await fixture.lookCoin.lzEndpoint()).to.equal(newEndpoint);
      
      coverageTracker.trackFunction("LookCoin", "setLayerZeroEndpoint");
    });

    it("should revert setting endpoint without DEFAULT_ADMIN_ROLE", async function () {
      const newEndpoint = ethers.Wallet.createRandom().address;
      
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.user).setLayerZeroEndpoint(newEndpoint),
        fixture.lookCoin,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.lookCoin.DEFAULT_ADMIN_ROLE()
      );
    });

    it("should revert setting zero address as endpoint", async function () {
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(ethers.ZeroAddress),
        fixture.lookCoin,
        "InvalidEndpoint"
      );
      coverageTracker.trackBranch("LookCoin", "setLayerZeroEndpoint-zero-address-check");
    });

    it("should test endpoint configuration state transitions", async function () {
      const endpoints = [
        await fixture.mockLayerZero.getAddress(),
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
      ];

      await testBooleanCombinations(
        "LayerZero endpoint configuration",
        async () => (await fixture.lookCoin.lzEndpoint()) !== ethers.ZeroAddress,
        async (value) => {
          if (value) {
            await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(endpoints[0]);
          } else {
            // Cannot set to zero address, so we track initial unset state only
          }
        },
        async (combination) => {
          if (combination.from && combination.to) {
            // Transition between different endpoints
            const currentEndpoint = await fixture.lookCoin.lzEndpoint();
            const newEndpoint = endpoints.find(e => e !== currentEndpoint) || endpoints[1];
            await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(newEndpoint);
            expect(await fixture.lookCoin.lzEndpoint()).to.equal(newEndpoint);
          }
          coverageTracker.trackBooleanCombination("LookCoin", `endpoint-${combination.description}`);
        }
      );
    });
  });

  describe("Trusted Remote Configuration Tests", function () {
    it("should set trusted remote with PROTOCOL_ADMIN_ROLE", async function () {
      const trustedRemote = ethers.solidityPacked(
        ["address", "address"],
        [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
      );
      
      await fixture.lookCoin.connect(fixture.protocolAdmin).setTrustedRemote(
        DESTINATION_CHAIN_ID,
        trustedRemote
      );
      
      const storedRemote = await fixture.lookCoin.getTrustedRemote(DESTINATION_CHAIN_ID);
      expect(storedRemote).to.equal(trustedRemote);
      
      coverageTracker.trackFunction("LookCoin", "setTrustedRemote");
      coverageTracker.trackFunction("LookCoin", "getTrustedRemote");
    });

    it("should revert setting trusted remote without PROTOCOL_ADMIN_ROLE", async function () {
      const trustedRemote = ethers.solidityPacked(
        ["address", "address"],
        [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
      );
      
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.user).setTrustedRemote(DESTINATION_CHAIN_ID, trustedRemote),
        fixture.lookCoin,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.lookCoin.PROTOCOL_ADMIN_ROLE()
      );
    });

    it("should handle invalid address length in trusted remote", async function () {
      const invalidRemote = "0x1234"; // Too short
      
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.protocolAdmin).setTrustedRemote(DESTINATION_CHAIN_ID, invalidRemote),
        fixture.lookCoin,
        "InvalidTrustedRemote"
      );
      coverageTracker.trackBranch("LookCoin", "setTrustedRemote-invalid-length");
    });

    it("should test trusted remote boolean combinations", async function () {
      const chainIds = [TEST_CHAINS.OPTIMISM, TEST_CHAINS.arbitrum];
      
      for (const chainId of chainIds) {
        await testBooleanCombinations(
          `Trusted remote for chain ${chainId}`,
          async () => {
            const remote = await fixture.lookCoin.getTrustedRemote(chainId);
            return remote !== "0x";
          },
          async (value) => {
            if (value) {
              const trustedRemote = ethers.solidityPacked(
                ["address", "address"],
                [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
              );
              await fixture.lookCoin.connect(fixture.protocolAdmin).setTrustedRemote(chainId, trustedRemote);
            } else {
              await fixture.lookCoin.connect(fixture.protocolAdmin).setTrustedRemote(chainId, "0x");
            }
          },
          async (combination) => {
            if (combination.to) {
              const remote = await fixture.lookCoin.getTrustedRemote(chainId);
              expect(remote).to.not.equal("0x");
            } else {
              const remote = await fixture.lookCoin.getTrustedRemote(chainId);
              expect(remote).to.equal("0x");
            }
            coverageTracker.trackBooleanCombination("LookCoin", `trusted-remote-${chainId}-${combination.description}`);
          }
        );
      }
    });

    it("should use connectPeer with DEFAULT_ADMIN_ROLE", async function () {
      await fixture.lookCoin.connect(fixture.owner).connectPeer(
        DESTINATION_CHAIN_ID,
        TRUSTED_REMOTE_ADDRESS
      );
      
      // Verify trusted remote was set correctly
      const expectedRemote = ethers.solidityPacked(
        ["address", "address"],
        [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
      );
      const storedRemote = await fixture.lookCoin.getTrustedRemote(DESTINATION_CHAIN_ID);
      expect(storedRemote).to.equal(expectedRemote);
      
      coverageTracker.trackFunction("LookCoin", "connectPeer");
    });

    it("should revert connectPeer without DEFAULT_ADMIN_ROLE", async function () {
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.user).connectPeer(DESTINATION_CHAIN_ID, TRUSTED_REMOTE_ADDRESS),
        fixture.lookCoin,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.lookCoin.DEFAULT_ADMIN_ROLE()
      );
    });
  });

  describe("Gas Configuration Tests", function () {
    it("should set gas for destination with PROTOCOL_ADMIN_ROLE", async function () {
      const gasAmount = 250000;
      
      await fixture.lookCoin.connect(fixture.protocolAdmin).setGasForDestinationLzReceive(
        DESTINATION_CHAIN_ID,
        gasAmount
      );
      
      expect(await fixture.lookCoin.dstGasLookup(DESTINATION_CHAIN_ID)).to.equal(gasAmount);
      
      coverageTracker.trackFunction("LookCoin", "setGasForDestinationLzReceive");
    });

    it("should revert setting gas without PROTOCOL_ADMIN_ROLE", async function () {
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.user).setGasForDestinationLzReceive(DESTINATION_CHAIN_ID, 200000),
        fixture.lookCoin,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.lookCoin.PROTOCOL_ADMIN_ROLE()
      );
    });

    it("should revert setting zero gas", async function () {
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.protocolAdmin).setGasForDestinationLzReceive(DESTINATION_CHAIN_ID, 0),
        fixture.lookCoin,
        "InvalidGasAmount"
      );
      coverageTracker.trackBranch("LookCoin", "setGasForDestinationLzReceive-zero-check");
    });

    it("should revert setting gas above 1M", async function () {
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.protocolAdmin).setGasForDestinationLzReceive(DESTINATION_CHAIN_ID, 1000001),
        fixture.lookCoin,
        "InvalidGasAmount"
      );
      coverageTracker.trackBranch("LookCoin", "setGasForDestinationLzReceive-max-check");
    });

    it("should test gas configuration boolean combinations", async function () {
      const gasAmounts = [0, 200000, 500000, 0]; // 0 means unset
      
      await testBooleanCombinations(
        "Gas configuration",
        async () => (await fixture.lookCoin.dstGasLookup(DESTINATION_CHAIN_ID)) > 0,
        async (value) => {
          if (value) {
            await fixture.lookCoin.connect(fixture.protocolAdmin).setGasForDestinationLzReceive(DESTINATION_CHAIN_ID, 200000);
          } else {
            // Gas cannot be unset once set, but we can test initial state
          }
        },
        async (combination) => {
          const currentGas = await fixture.lookCoin.dstGasLookup(DESTINATION_CHAIN_ID);
          
          if (combination.from && combination.to && currentGas > 0) {
            // Change gas amount
            const newGas = currentGas === 200000 ? 300000 : 200000;
            await fixture.lookCoin.connect(fixture.protocolAdmin).setGasForDestinationLzReceive(DESTINATION_CHAIN_ID, newGas);
            expect(await fixture.lookCoin.dstGasLookup(DESTINATION_CHAIN_ID)).to.equal(newGas);
          }
          
          coverageTracker.trackBooleanCombination("LookCoin", `gas-config-${combination.description}`);
        }
      );
    });

    it("should set enforced options per destination", async function () {
      const enforcedOptions = "0x00030100110100000000000000000000000000030d40"; // Example options
      
      await fixture.lookCoin.connect(fixture.protocolAdmin).setEnforcedOptions(
        DESTINATION_CHAIN_ID,
        enforcedOptions
      );
      
      expect(await fixture.lookCoin.enforcedOptions(DESTINATION_CHAIN_ID)).to.equal(enforcedOptions);
      
      coverageTracker.trackFunction("LookCoin", "setEnforcedOptions");
    });
  });

  describe("DVN Configuration Tests", function () {
    it("should configure DVN with valid parameters", async function () {
      const dvns = [
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
      ];
      const threshold = 2;
      
      const tx = await fixture.lookCoin.connect(fixture.protocolAdmin).configureDVN(
        DESTINATION_CHAIN_ID,
        dvns,
        threshold
      );
      
      await expect(tx)
        .to.emit(fixture.lookCoin, "DVNConfigured")
        .withArgs(DESTINATION_CHAIN_ID, dvns.length, threshold);
      
      coverageTracker.trackFunction("LookCoin", "configureDVN");
    });

    it("should revert DVN configuration without PROTOCOL_ADMIN_ROLE", async function () {
      const dvns = [ethers.Wallet.createRandom().address];
      
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.user).configureDVN(DESTINATION_CHAIN_ID, dvns, 1),
        fixture.lookCoin,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.lookCoin.PROTOCOL_ADMIN_ROLE()
      );
    });

    it("should revert with empty DVN array", async function () {
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.protocolAdmin).configureDVN(DESTINATION_CHAIN_ID, [], 0),
        fixture.lookCoin,
        "InvalidDVNConfiguration"
      );
      coverageTracker.trackBranch("LookCoin", "configureDVN-empty-array");
    });

    it("should revert with zero threshold", async function () {
      const dvns = [ethers.Wallet.createRandom().address];
      
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.protocolAdmin).configureDVN(DESTINATION_CHAIN_ID, dvns, 0),
        fixture.lookCoin,
        "InvalidDVNConfiguration"
      );
      coverageTracker.trackBranch("LookCoin", "configureDVN-zero-threshold");
    });

    it("should revert with threshold > 100", async function () {
      const dvns = [ethers.Wallet.createRandom().address];
      
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.protocolAdmin).configureDVN(DESTINATION_CHAIN_ID, dvns, 101),
        fixture.lookCoin,
        "InvalidDVNConfiguration"
      );
      coverageTracker.trackBranch("LookCoin", "configureDVN-high-threshold");
    });

    it("should test DVN configuration boolean combinations", async function () {
      const dvnConfigs = [
        { dvns: [], threshold: 0 }, // Unconfigured
        { dvns: [ethers.Wallet.createRandom().address], threshold: 1 }, // Single DVN
        { dvns: [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address], threshold: 2 }, // Multiple DVNs
      ];

      for (let i = 0; i < dvnConfigs.length - 1; i++) {
        const fromConfig = dvnConfigs[i];
        const toConfig = dvnConfigs[i + 1];
        
        if (toConfig.dvns.length > 0) {
          await fixture.lookCoin.connect(fixture.protocolAdmin).configureDVN(
            DESTINATION_CHAIN_ID,
            toConfig.dvns,
            toConfig.threshold
          );
          
          coverageTracker.trackBooleanCombination(
            "LookCoin",
            `dvn-${fromConfig.dvns.length > 0 ? "configured" : "unconfigured"}-to-${toConfig.dvns.length > 0 ? "configured" : "unconfigured"}`
          );
        }
      }
    });
  });

  describe("Chain Configuration Validation Tests", function () {
    it("should validate complete chain configuration", async function () {
      // Initially not configured
      expect(await fixture.lookCoin.isChainConfigured(DESTINATION_CHAIN_ID)).to.be.false;
      
      // Set endpoint
      await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(await fixture.mockLayerZero.getAddress());
      expect(await fixture.lookCoin.isChainConfigured(DESTINATION_CHAIN_ID)).to.be.false;
      
      // Set trusted remote
      const trustedRemote = ethers.solidityPacked(
        ["address", "address"],
        [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
      );
      await fixture.lookCoin.connect(fixture.protocolAdmin).setTrustedRemote(DESTINATION_CHAIN_ID, trustedRemote);
      expect(await fixture.lookCoin.isChainConfigured(DESTINATION_CHAIN_ID)).to.be.false;
      
      // Set gas
      await fixture.lookCoin.connect(fixture.protocolAdmin).setGasForDestinationLzReceive(DESTINATION_CHAIN_ID, 200000);
      expect(await fixture.lookCoin.isChainConfigured(DESTINATION_CHAIN_ID)).to.be.true;
      
      coverageTracker.trackFunction("LookCoin", "isChainConfigured");
    });

    it("should test all configuration component combinations", async function () {
      const components = {
        endpoint: async (set: boolean) => {
          if (set) {
            await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(await fixture.mockLayerZero.getAddress());
          }
        },
        trustedRemote: async (set: boolean) => {
          if (set) {
            const trustedRemote = ethers.solidityPacked(
              ["address", "address"],
              [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
            );
            await fixture.lookCoin.connect(fixture.protocolAdmin).setTrustedRemote(DESTINATION_CHAIN_ID, trustedRemote);
          }
        },
        gas: async (set: boolean) => {
          if (set) {
            await fixture.lookCoin.connect(fixture.protocolAdmin).setGasForDestinationLzReceive(DESTINATION_CHAIN_ID, 200000);
          }
        },
      };

      // Test all 8 combinations (2^3)
      for (let i = 0; i < 8; i++) {
        const hasEndpoint = (i & 1) !== 0;
        const hasTrustedRemote = (i & 2) !== 0;
        const hasGas = (i & 4) !== 0;
        
        // Reset contract
        fixture = await loadFixture(deployLookCoinFixture);
        
        // Configure components
        if (hasEndpoint) await components.endpoint(true);
        if (hasTrustedRemote) await components.trustedRemote(true);
        if (hasGas) await components.gas(true);
        
        // Check configuration
        const isConfigured = await fixture.lookCoin.isChainConfigured(DESTINATION_CHAIN_ID);
        const shouldBeConfigured = hasEndpoint && hasTrustedRemote && hasGas;
        
        expect(isConfigured).to.equal(shouldBeConfigured);
        
        coverageTracker.trackBooleanCombination(
          "LookCoin",
          `chain-config-endpoint:${hasEndpoint}-remote:${hasTrustedRemote}-gas:${hasGas}`
        );
      }
    });

    it("should validate configuration in cross-chain operations", async function () {
      const amount = ethers.parseEther("100");
      const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
      
      // Mint tokens for testing
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
      
      // Should fail without configuration
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.user).sendFrom(
          fixture.user.address,
          DESTINATION_CHAIN_ID,
          recipient,
          amount,
          fixture.user.address,
          ethers.ZeroAddress,
          "0x"
        ),
        fixture.lookCoin,
        "LayerZeroNotConfigured"
      );
      
      // Configure completely
      await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(await fixture.mockLayerZero.getAddress());
      const trustedRemote = ethers.solidityPacked(
        ["address", "address"],
        [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
      );
      await fixture.lookCoin.connect(fixture.protocolAdmin).setTrustedRemote(DESTINATION_CHAIN_ID, trustedRemote);
      await fixture.lookCoin.connect(fixture.protocolAdmin).setGasForDestinationLzReceive(DESTINATION_CHAIN_ID, 200000);
      
      // Now should work (will fail on mock but not due to configuration)
      const [fee] = await fixture.lookCoin.estimateSendFee(
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        false,
        "0x"
      );
      
      // The actual send will fail because mock doesn't implement full functionality
      // but configuration check should pass
      await fixture.lookCoin.connect(fixture.user).sendFrom(
        fixture.user.address,
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        fixture.user.address,
        ethers.ZeroAddress,
        "0x",
        { value: fee }
      );
      
      coverageTracker.trackBranch("LookCoin", "sendFrom-configuration-check");
    });
  });

  describe("Multi-Chain Configuration Tests", function () {
    it("should configure multiple chains independently", async function () {
      const chains = [
        TEST_CHAINS.OPTIMISM,
        TEST_CHAINS.arbitrum,
        TEST_CHAINS.polygon,
      ];
      
      // Configure endpoint once
      await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(await fixture.mockLayerZero.getAddress());
      
      for (const chainId of chains) {
        // Configure each chain
        const trustedRemote = ethers.solidityPacked(
          ["address", "address"],
          [`0x${chainId.toString(16).padStart(40, '0')}`, await fixture.lookCoin.getAddress()]
        );
        
        await fixture.lookCoin.connect(fixture.protocolAdmin).setTrustedRemote(chainId, trustedRemote);
        await fixture.lookCoin.connect(fixture.protocolAdmin).setGasForDestinationLzReceive(chainId, 200000 + chainId);
        
        // Verify configuration
        expect(await fixture.lookCoin.getTrustedRemote(chainId)).to.equal(trustedRemote);
        expect(await fixture.lookCoin.dstGasLookup(chainId)).to.equal(200000 + chainId);
        expect(await fixture.lookCoin.isChainConfigured(chainId)).to.be.true;
      }
      
      // Verify chains are configured independently
      const unconfiguredChain = 999;
      expect(await fixture.lookCoin.isChainConfigured(unconfiguredChain)).to.be.false;
      
      coverageTracker.trackBranch("LookCoin", "multi-chain-configuration");
    });
  });

  describe("Configuration Update and Override Tests", function () {
    beforeEach(async function () {
      // Set up initial configuration
      await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(await fixture.mockLayerZero.getAddress());
      const trustedRemote = ethers.solidityPacked(
        ["address", "address"],
        [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
      );
      await fixture.lookCoin.connect(fixture.protocolAdmin).setTrustedRemote(DESTINATION_CHAIN_ID, trustedRemote);
      await fixture.lookCoin.connect(fixture.protocolAdmin).setGasForDestinationLzReceive(DESTINATION_CHAIN_ID, 200000);
    });

    it("should allow updating endpoint", async function () {
      const newEndpoint = ethers.Wallet.createRandom().address;
      await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(newEndpoint);
      expect(await fixture.lookCoin.lzEndpoint()).to.equal(newEndpoint);
    });

    it("should allow updating trusted remote", async function () {
      const newRemoteAddress = "0x" + "2".repeat(40);
      const newTrustedRemote = ethers.solidityPacked(
        ["address", "address"],
        [newRemoteAddress, await fixture.lookCoin.getAddress()]
      );
      
      await fixture.lookCoin.connect(fixture.protocolAdmin).setTrustedRemote(DESTINATION_CHAIN_ID, newTrustedRemote);
      expect(await fixture.lookCoin.getTrustedRemote(DESTINATION_CHAIN_ID)).to.equal(newTrustedRemote);
    });

    it("should allow updating gas configuration", async function () {
      const newGas = 300000;
      await fixture.lookCoin.connect(fixture.protocolAdmin).setGasForDestinationLzReceive(DESTINATION_CHAIN_ID, newGas);
      expect(await fixture.lookCoin.dstGasLookup(DESTINATION_CHAIN_ID)).to.equal(newGas);
    });
  });

  describe("Edge Cases and Error Scenarios", function () {
    it("should handle maximum chain ID", async function () {
      const maxChainId = 65535; // uint16 max
      const trustedRemote = ethers.solidityPacked(
        ["address", "address"],
        [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
      );
      
      await fixture.lookCoin.connect(fixture.protocolAdmin).setTrustedRemote(maxChainId, trustedRemote);
      expect(await fixture.lookCoin.getTrustedRemote(maxChainId)).to.equal(trustedRemote);
      
      coverageTracker.trackBranch("LookCoin", "max-chain-id-handling");
    });

    it("should handle empty trusted remote query", async function () {
      const unconfiguredChain = 999;
      expect(await fixture.lookCoin.getTrustedRemote(unconfiguredChain)).to.equal("0x");
      
      coverageTracker.trackBranch("LookCoin", "empty-trusted-remote");
    });

    it("should handle gas lookup for unconfigured chain", async function () {
      const unconfiguredChain = 999;
      expect(await fixture.lookCoin.dstGasLookup(unconfiguredChain)).to.equal(0);
      
      coverageTracker.trackBranch("LookCoin", "unconfigured-gas-lookup");
    });
  });
});