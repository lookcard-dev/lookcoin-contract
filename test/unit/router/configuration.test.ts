import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployLookCoinFixture,
  testBooleanCombinations,
  testRoleBasedFunction,
  expectSpecificRevert,
  coverageTracker,
  BOOLEAN_COMBINATIONS,
  DeploymentFixture,
} from "../../utils/comprehensiveTestHelpers";
import { TEST_CHAINS } from "../../utils/testConfig";

describe("CrossChainRouterConfiguration - Comprehensive Configuration Tests", function () {
  let fixture: DeploymentFixture;
  const DESTINATION_CHAIN_ID = TEST_CHAINS.OPTIMISM;
  
  // Protocol IDs
  const PROTOCOL_LAYERZERO = 0;
  const PROTOCOL_CELER = 1;
  const PROTOCOL_HYPERLANE = 2;

  beforeEach(async function () {
    fixture = await loadFixture(deployLookCoinFixture);
  });

  describe("Protocol Module Configuration Tests", function () {
    it("should configure protocol with ADMIN_ROLE", async function () {
      const newModule = ethers.Wallet.createRandom().address;
      
      await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(
        PROTOCOL_LAYERZERO,
        newModule,
        true
      );
      
      expect(await fixture.crossChainRouter.protocolModules(PROTOCOL_LAYERZERO)).to.equal(newModule);
      expect(await fixture.crossChainRouter.protocolEnabled(PROTOCOL_LAYERZERO)).to.be.true;
      
      coverageTracker.trackFunction("CrossChainRouter", "configureProtocol");
    });

    it("should revert configuring protocol without ADMIN_ROLE", async function () {
      await expectSpecificRevert(
        async () => fixture.crossChainRouter.connect(fixture.user).configureProtocol(
          PROTOCOL_LAYERZERO,
          await fixture.layerZeroModule.getAddress(),
          true
        ),
        fixture.crossChainRouter,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.crossChainRouter.ADMIN_ROLE()
      );
    });

    it("should test protocol enable/disable combinations", async function () {
      await testBooleanCombinations(
        "Protocol enabled state",
        async () => fixture.crossChainRouter.protocolEnabled(PROTOCOL_LAYERZERO),
        async (value) => {
          await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(
            PROTOCOL_LAYERZERO,
            await fixture.crossChainRouter.protocolModules(PROTOCOL_LAYERZERO),
            value
          );
        },
        async (combination) => {
          const isEnabled = await fixture.crossChainRouter.protocolEnabled(PROTOCOL_LAYERZERO);
          expect(isEnabled).to.equal(combination.to);
          
          coverageTracker.trackBooleanCombination("CrossChainRouter", `protocol-enabled-${combination.description}`);
        }
      );
    });

    it("should test protocol configuration state transitions", async function () {
      const modules = [
        ethers.ZeroAddress,
        await fixture.layerZeroModule.getAddress(),
        ethers.Wallet.createRandom().address,
        ethers.ZeroAddress,
      ];

      for (let i = 0; i < modules.length - 1; i++) {
        const fromModule = modules[i];
        const toModule = modules[i + 1];
        
        if (toModule !== ethers.ZeroAddress) {
          await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(
            PROTOCOL_LAYERZERO,
            toModule,
            true
          );
          
          expect(await fixture.crossChainRouter.protocolModules(PROTOCOL_LAYERZERO)).to.equal(toModule);
          
          coverageTracker.trackBooleanCombination(
            "CrossChainRouter",
            `protocol-module-${fromModule === ethers.ZeroAddress ? "unconfigured" : "configured"}-to-${toModule === ethers.ZeroAddress ? "unconfigured" : "configured"}`
          );
        }
      }
    });

    it("should configure all three protocols independently", async function () {
      const protocols = [
        { id: PROTOCOL_LAYERZERO, module: await fixture.layerZeroModule.getAddress() },
        { id: PROTOCOL_CELER, module: await fixture.celerIMModule.getAddress() },
        { id: PROTOCOL_HYPERLANE, module: await fixture.hyperlaneModule.getAddress() },
      ];

      for (const protocol of protocols) {
        await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(
          protocol.id,
          protocol.module,
          true
        );
        
        expect(await fixture.crossChainRouter.protocolModules(protocol.id)).to.equal(protocol.module);
        expect(await fixture.crossChainRouter.protocolEnabled(protocol.id)).to.be.true;
      }
      
      coverageTracker.trackBranch("CrossChainRouter", "multi-protocol-configuration");
    });
  });

  describe("Chain Support Configuration Tests", function () {
    it("should configure chain support with ADMIN_ROLE", async function () {
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(
        PROTOCOL_LAYERZERO,
        DESTINATION_CHAIN_ID,
        true
      );
      
      expect(await fixture.crossChainRouter.protocolSupportsChain(PROTOCOL_LAYERZERO, DESTINATION_CHAIN_ID)).to.be.true;
      
      // Check chain is in supported chains list
      const supportedChains = await fixture.crossChainRouter.getSupportedChains(PROTOCOL_LAYERZERO);
      expect(supportedChains).to.include(DESTINATION_CHAIN_ID);
      
      coverageTracker.trackFunction("CrossChainRouter", "configureChainSupport");
      coverageTracker.trackFunction("CrossChainRouter", "getSupportedChains");
    });

    it("should revert configuring chain support without ADMIN_ROLE", async function () {
      await expectSpecificRevert(
        async () => fixture.crossChainRouter.connect(fixture.user).configureChainSupport(
          PROTOCOL_LAYERZERO,
          DESTINATION_CHAIN_ID,
          true
        ),
        fixture.crossChainRouter,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.crossChainRouter.ADMIN_ROLE()
      );
    });

    it("should test chain support boolean combinations", async function () {
      await testBooleanCombinations(
        "Chain support state",
        async () => fixture.crossChainRouter.protocolSupportsChain(PROTOCOL_LAYERZERO, DESTINATION_CHAIN_ID),
        async (value) => {
          await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(
            PROTOCOL_LAYERZERO,
            DESTINATION_CHAIN_ID,
            value
          );
        },
        async (combination) => {
          const isSupported = await fixture.crossChainRouter.protocolSupportsChain(PROTOCOL_LAYERZERO, DESTINATION_CHAIN_ID);
          expect(isSupported).to.equal(combination.to);
          
          // Verify chain list management
          const supportedChains = await fixture.crossChainRouter.getSupportedChains(PROTOCOL_LAYERZERO);
          if (combination.to) {
            expect(supportedChains).to.include(DESTINATION_CHAIN_ID);
          } else {
            expect(supportedChains).to.not.include(DESTINATION_CHAIN_ID);
          }
          
          coverageTracker.trackBooleanCombination("CrossChainRouter", `chain-support-${combination.description}`);
        }
      );
    });

    it("should manage protocol list per chain correctly", async function () {
      // Add multiple protocols for same chain
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_LAYERZERO, DESTINATION_CHAIN_ID, true);
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_CELER, DESTINATION_CHAIN_ID, true);
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_HYPERLANE, DESTINATION_CHAIN_ID, true);
      
      const protocolsForChain = await fixture.crossChainRouter.getProtocolsForChain(DESTINATION_CHAIN_ID);
      expect(protocolsForChain.length).to.equal(3);
      expect(protocolsForChain).to.include(PROTOCOL_LAYERZERO);
      expect(protocolsForChain).to.include(PROTOCOL_CELER);
      expect(protocolsForChain).to.include(PROTOCOL_HYPERLANE);
      
      // Remove one protocol
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_CELER, DESTINATION_CHAIN_ID, false);
      
      const updatedProtocols = await fixture.crossChainRouter.getProtocolsForChain(DESTINATION_CHAIN_ID);
      expect(updatedProtocols.length).to.equal(2);
      expect(updatedProtocols).to.not.include(PROTOCOL_CELER);
      
      coverageTracker.trackFunction("CrossChainRouter", "getProtocolsForChain");
      coverageTracker.trackBranch("CrossChainRouter", "protocol-list-management");
    });

    it("should test all protocol-chain support combinations", async function () {
      const protocols = [PROTOCOL_LAYERZERO, PROTOCOL_CELER, PROTOCOL_HYPERLANE];
      const chains = [TEST_CHAINS.OPTIMISM, TEST_CHAINS.arbitrum];
      
      // Test all 2^6 combinations (3 protocols × 2 chains)
      for (let i = 0; i < 64; i++) {
        // Reset router
        fixture = await loadFixture(deployLookCoinFixture);
        
        let bit = 0;
        for (const protocol of protocols) {
          for (const chain of chains) {
            const isSupported = (i & (1 << bit)) !== 0;
            if (isSupported) {
              await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(protocol, chain, true);
            }
            bit++;
          }
        }
        
        // Verify configuration
        bit = 0;
        for (const protocol of protocols) {
          for (const chain of chains) {
            const expectedSupport = (i & (1 << bit)) !== 0;
            const actualSupport = await fixture.crossChainRouter.protocolSupportsChain(protocol, chain);
            expect(actualSupport).to.equal(expectedSupport);
            bit++;
          }
        }
        
        coverageTracker.trackBooleanCombination("CrossChainRouter", `matrix-config-${i.toString(2).padStart(6, '0')}`);
      }
    });
  });

  describe("Protocol Security Level Configuration Tests", function () {
    it("should have default security levels configured", async function () {
      // Default security levels from contract
      expect(await fixture.crossChainRouter.protocolSecurityLevel(PROTOCOL_LAYERZERO)).to.equal(9);
      expect(await fixture.crossChainRouter.protocolSecurityLevel(PROTOCOL_CELER)).to.equal(7);
      expect(await fixture.crossChainRouter.protocolSecurityLevel(PROTOCOL_HYPERLANE)).to.equal(8);
      
      coverageTracker.trackFunction("CrossChainRouter", "protocolSecurityLevel");
    });

    it("should use security levels in route optimization", async function () {
      // Configure all protocols for the destination chain
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_LAYERZERO, DESTINATION_CHAIN_ID, true);
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_CELER, DESTINATION_CHAIN_ID, true);
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_HYPERLANE, DESTINATION_CHAIN_ID, true);
      
      // Mock fee responses
      await fixture.mockLayerZero.setEstimateFee(ethers.parseEther("0.01"));
      await fixture.mockCeler.setCalcFee(ethers.parseEther("0.005"));
      await fixture.mockHyperlane.setQuoteGasPayment(ethers.parseEther("0.008"));
      
      // Get optimal route with MostSecure preference
      const amount = ethers.parseEther("100");
      const optimalRoute = await fixture.crossChainRouter.getOptimalRoute(
        DESTINATION_CHAIN_ID,
        amount,
        2 // RoutePreference.MostSecure
      );
      
      // Should select LayerZero (highest security level of 9)
      expect(optimalRoute.protocol).to.equal(PROTOCOL_LAYERZERO);
      expect(optimalRoute.estimatedFee).to.equal(ethers.parseEther("0.01"));
      
      coverageTracker.trackFunction("CrossChainRouter", "getOptimalRoute");
      coverageTracker.trackBranch("CrossChainRouter", "route-optimization-security");
    });
  });

  describe("Bridge Options and Route Selection Tests", function () {
    beforeEach(async function () {
      // Configure all protocols for testing
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_LAYERZERO, DESTINATION_CHAIN_ID, true);
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_CELER, DESTINATION_CHAIN_ID, true);
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_HYPERLANE, DESTINATION_CHAIN_ID, true);
      
      // Set mock fees
      await fixture.mockLayerZero.setEstimateFee(ethers.parseEther("0.01"));
      await fixture.mockCeler.setCalcFee(ethers.parseEther("0.005"));
      await fixture.mockHyperlane.setQuoteGasPayment(ethers.parseEther("0.008"));
    });

    it("should get bridge options for configured chains", async function () {
      const options = await fixture.crossChainRouter.getBridgeOptions(DESTINATION_CHAIN_ID);
      
      expect(options.length).to.equal(3);
      
      // Verify each option
      for (const option of options) {
        expect(option.available).to.be.true;
        expect(option.estimatedFee).to.be.gt(0);
        expect(option.estimatedTime).to.be.gt(0);
        expect([PROTOCOL_LAYERZERO, PROTOCOL_CELER, PROTOCOL_HYPERLANE]).to.include(option.protocol);
      }
      
      coverageTracker.trackFunction("CrossChainRouter", "getBridgeOptions");
    });

    it("should filter unavailable protocols", async function () {
      // Disable Celer protocol
      await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(
        PROTOCOL_CELER,
        await fixture.crossChainRouter.protocolModules(PROTOCOL_CELER),
        false
      );
      
      const options = await fixture.crossChainRouter.getBridgeOptions(DESTINATION_CHAIN_ID);
      
      // Should only have 2 available options
      const availableOptions = options.filter(o => o.available);
      expect(availableOptions.length).to.equal(2);
      expect(availableOptions.map(o => o.protocol)).to.not.include(PROTOCOL_CELER);
      
      coverageTracker.trackBranch("CrossChainRouter", "getBridgeOptions-filter-disabled");
    });

    it("should test route preferences", async function () {
      const amount = ethers.parseEther("100");
      
      // Test Cheapest preference
      const cheapestRoute = await fixture.crossChainRouter.getOptimalRoute(
        DESTINATION_CHAIN_ID,
        amount,
        0 // RoutePreference.Cheapest
      );
      expect(cheapestRoute.protocol).to.equal(PROTOCOL_CELER); // Lowest fee
      
      // Test Fastest preference
      const fastestRoute = await fixture.crossChainRouter.getOptimalRoute(
        DESTINATION_CHAIN_ID,
        amount,
        1 // RoutePreference.Fastest
      );
      expect(fastestRoute.protocol).to.equal(PROTOCOL_LAYERZERO); // 10 seconds
      
      // Test MostSecure preference
      const secureRoute = await fixture.crossChainRouter.getOptimalRoute(
        DESTINATION_CHAIN_ID,
        amount,
        2 // RoutePreference.MostSecure
      );
      expect(secureRoute.protocol).to.equal(PROTOCOL_LAYERZERO); // Security level 9
      
      coverageTracker.trackBranch("CrossChainRouter", "route-preference-cheapest");
      coverageTracker.trackBranch("CrossChainRouter", "route-preference-fastest");
      coverageTracker.trackBranch("CrossChainRouter", "route-preference-secure");
    });

    it("should revert with no available routes", async function () {
      // Disable all protocols for a chain
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_LAYERZERO, DESTINATION_CHAIN_ID, false);
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_CELER, DESTINATION_CHAIN_ID, false);
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_HYPERLANE, DESTINATION_CHAIN_ID, false);
      
      await expectSpecificRevert(
        async () => fixture.crossChainRouter.getOptimalRoute(DESTINATION_CHAIN_ID, ethers.parseEther("100"), 0),
        fixture.crossChainRouter,
        "NoAvailableRoute"
      );
      
      coverageTracker.trackBranch("CrossChainRouter", "no-available-routes");
    });

    it("should test all route availability combinations", async function () {
      const protocols = [PROTOCOL_LAYERZERO, PROTOCOL_CELER, PROTOCOL_HYPERLANE];
      
      // Test all 8 combinations (2^3) of protocol availability
      for (let i = 0; i < 8; i++) {
        // Reset configuration
        fixture = await loadFixture(deployLookCoinFixture);
        
        let availableCount = 0;
        for (let j = 0; j < protocols.length; j++) {
          const isAvailable = (i & (1 << j)) !== 0;
          if (isAvailable) {
            await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(protocols[j], DESTINATION_CHAIN_ID, true);
            availableCount++;
          }
        }
        
        if (availableCount > 0) {
          const options = await fixture.crossChainRouter.getBridgeOptions(DESTINATION_CHAIN_ID);
          const availableOptions = options.filter(o => o.available);
          expect(availableOptions.length).to.equal(availableCount);
        } else {
          await expectSpecificRevert(
            async () => fixture.crossChainRouter.getOptimalRoute(DESTINATION_CHAIN_ID, ethers.parseEther("100"), 0),
            fixture.crossChainRouter,
            "NoAvailableRoute"
          );
        }
        
        coverageTracker.trackBooleanCombination("CrossChainRouter", `route-availability-${i.toString(2).padStart(3, '0')}`);
      }
    });
  });

  describe("Transfer Management Configuration Tests", function () {
    it("should track transfer IDs and status", async function () {
      // Transfer management is tested in operations, but we verify the structure
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("test-transfer"));
      
      // Initially transfer doesn't exist
      const transfer = await fixture.crossChainRouter.getTransfer(transferId);
      expect(transfer.sender).to.equal(ethers.ZeroAddress);
      expect(transfer.status).to.equal(0); // Pending
      
      coverageTracker.trackFunction("CrossChainRouter", "getTransfer");
    });
  });

  describe("Emergency and Administrative Configuration Tests", function () {
    it("should pause/unpause with ADMIN_ROLE", async function () {
      await testBooleanCombinations(
        "Router pause state",
        async () => fixture.crossChainRouter.paused(),
        async (value) => {
          if (value) {
            await fixture.crossChainRouter.connect(fixture.admin).pause();
          } else {
            await fixture.crossChainRouter.connect(fixture.admin).unpause();
          }
        },
        async (combination) => {
          const isPaused = await fixture.crossChainRouter.paused();
          expect(isPaused).to.equal(combination.to);
          
          coverageTracker.trackBooleanCombination("CrossChainRouter", `pause-state-${combination.description}`);
        }
      );
      
      coverageTracker.trackFunction("CrossChainRouter", "pause");
      coverageTracker.trackFunction("CrossChainRouter", "unpause");
    });

    it("should execute emergency withdraw with ADMIN_ROLE", async function () {
      // Send some ETH to router
      await fixture.user.sendTransaction({
        to: await fixture.crossChainRouter.getAddress(),
        value: ethers.parseEther("1")
      });
      
      const balanceBefore = await ethers.provider.getBalance(fixture.admin.address);
      
      await fixture.crossChainRouter.connect(fixture.admin).emergencyWithdraw(
        ethers.ZeroAddress,
        fixture.admin.address,
        ethers.parseEther("1")
      );
      
      const balanceAfter = await ethers.provider.getBalance(fixture.admin.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
      
      coverageTracker.trackFunction("CrossChainRouter", "emergencyWithdraw");
      coverageTracker.trackBranch("CrossChainRouter", "emergencyWithdraw-native");
    });

    it("should emergency withdraw ERC20 tokens", async function () {
      // Mint tokens to router
      await fixture.lookCoin.connect(fixture.minter).mint(await fixture.crossChainRouter.getAddress(), ethers.parseEther("100"));
      
      await fixture.crossChainRouter.connect(fixture.admin).emergencyWithdraw(
        await fixture.lookCoin.getAddress(),
        fixture.admin.address,
        ethers.parseEther("100")
      );
      
      expect(await fixture.lookCoin.balanceOf(fixture.admin.address)).to.equal(ethers.parseEther("100"));
      
      coverageTracker.trackBranch("CrossChainRouter", "emergencyWithdraw-erc20");
    });
  });

  describe("LookCoin Integration Configuration Tests", function () {
    it("should have LookCoin address configured on initialization", async function () {
      expect(await fixture.crossChainRouter.lookCoin()).to.equal(await fixture.lookCoin.getAddress());
      
      coverageTracker.trackFunction("CrossChainRouter", "lookCoin");
    });

    it("should verify token transfer authorization", async function () {
      // Router needs user approval to transfer tokens
      const amount = ethers.parseEther("100");
      
      // Mint tokens to user
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
      
      // Without approval, bridge should fail
      await expectSpecificRevert(
        async () => fixture.crossChainRouter.connect(fixture.user).bridgeToken(
          PROTOCOL_LAYERZERO,
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          amount,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.lookCoin,
        "ERC20InsufficientAllowance"
      );
      
      coverageTracker.trackBranch("CrossChainRouter", "token-approval-check");
    });
  });

  describe("Complete Configuration Matrix Tests", function () {
    it("should test complete protocol-chain-enabled matrix", async function () {
      const protocols = [
        { id: PROTOCOL_LAYERZERO, name: "LayerZero" },
        { id: PROTOCOL_CELER, name: "Celer" },
        { id: PROTOCOL_HYPERLANE, name: "Hyperlane" },
      ];
      
      const chains = [
        TEST_CHAINS.OPTIMISM,
        TEST_CHAINS.arbitrum,
        TEST_CHAINS.polygon,
      ];
      
      // Configure all combinations
      for (const protocol of protocols) {
        for (const chain of chains) {
          // Enable protocol
          await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(
            protocol.id,
            await fixture.crossChainRouter.protocolModules(protocol.id),
            true
          );
          
          // Support chain
          await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(
            protocol.id,
            chain,
            true
          );
        }
      }
      
      // Verify all configurations
      for (const protocol of protocols) {
        expect(await fixture.crossChainRouter.protocolEnabled(protocol.id)).to.be.true;
        
        for (const chain of chains) {
          expect(await fixture.crossChainRouter.protocolSupportsChain(protocol.id, chain)).to.be.true;
        }
        
        const supportedChains = await fixture.crossChainRouter.getSupportedChains(protocol.id);
        expect(supportedChains.length).to.equal(chains.length);
      }
      
      // Verify chain protocol lists
      for (const chain of chains) {
        const protocolsForChain = await fixture.crossChainRouter.getProtocolsForChain(chain);
        expect(protocolsForChain.length).to.equal(protocols.length);
      }
      
      coverageTracker.trackBranch("CrossChainRouter", "complete-configuration-matrix");
    });
  });

  describe("Edge Cases and Error Scenarios", function () {
    it("should handle invalid protocol IDs", async function () {
      const invalidProtocol = 99;
      
      // Should return default values for invalid protocol
      expect(await fixture.crossChainRouter.protocolModules(invalidProtocol)).to.equal(ethers.ZeroAddress);
      expect(await fixture.crossChainRouter.protocolEnabled(invalidProtocol)).to.be.false;
      expect(await fixture.crossChainRouter.protocolSecurityLevel(invalidProtocol)).to.equal(0);
      
      coverageTracker.trackBranch("CrossChainRouter", "invalid-protocol-handling");
    });

    it("should handle maximum chain ID", async function () {
      const maxChainId = 2**256 - 1; // uint256 max
      
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(
        PROTOCOL_LAYERZERO,
        maxChainId,
        true
      );
      
      expect(await fixture.crossChainRouter.protocolSupportsChain(PROTOCOL_LAYERZERO, maxChainId)).to.be.true;
      
      coverageTracker.trackBranch("CrossChainRouter", "max-chain-id-support");
    });

    it("should handle empty protocol lists", async function () {
      const unconfiguredChain = 999999;
      
      const protocols = await fixture.crossChainRouter.getProtocolsForChain(unconfiguredChain);
      expect(protocols.length).to.equal(0);
      
      const chains = await fixture.crossChainRouter.getSupportedChains(PROTOCOL_LAYERZERO);
      expect(chains).to.not.include(unconfiguredChain);
      
      coverageTracker.trackBranch("CrossChainRouter", "empty-list-handling");
    });
  });
});