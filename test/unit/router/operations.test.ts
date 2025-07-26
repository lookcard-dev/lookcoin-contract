import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployLookCoinFixture,
  configureLayerZeroModule,
  configureCelerModule,
  configureHyperlaneModule,
  setupMockLayerZero,
  setupMockCeler,
  setupMockHyperlane,
  testBooleanCombinations,
  expectSpecificRevert,
  assertBalanceChanges,
  assertSupplyChanges,
  assertEventEmission,
  coverageTracker,
  DeploymentFixture,
} from "../../utils/comprehensiveTestHelpers";
import { TEST_CHAINS } from "../../utils/testConfig";

describe("CrossChainRouterOperations - Comprehensive Operation Tests", function () {
  let fixture: DeploymentFixture;
  const DESTINATION_CHAIN_ID = TEST_CHAINS.OPTIMISM;
  
  // Protocol IDs
  const PROTOCOL_LAYERZERO = 0;
  const PROTOCOL_CELER = 1;
  const PROTOCOL_HYPERLANE = 2;

  beforeEach(async function () {
    fixture = await loadFixture(deployLookCoinFixture);
    
    // Configure all protocols
    await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(
      PROTOCOL_LAYERZERO,
      await fixture.layerZeroModule.getAddress(),
      true
    );
    await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(
      PROTOCOL_CELER,
      await fixture.celerIMModule.getAddress(),
      true
    );
    await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(
      PROTOCOL_HYPERLANE,
      await fixture.hyperlaneModule.getAddress(),
      true
    );
    
    // Configure chain support for all protocols
    await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(
      PROTOCOL_LAYERZERO,
      DESTINATION_CHAIN_ID,
      true
    );
    await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(
      PROTOCOL_CELER,
      DESTINATION_CHAIN_ID,
      true
    );
    await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(
      PROTOCOL_HYPERLANE,
      DESTINATION_CHAIN_ID,
      true
    );
    
    // Configure bridge modules
    await configureLayerZeroModule(
      fixture.layerZeroModule,
      fixture.admin,
      await fixture.lookCoin.getAddress(),
      fixture.endpoint.address,
      30000
    );
    
    await configureCelerModule(
      fixture.celerIMModule,
      fixture.admin,
      DESTINATION_CHAIN_ID,
      "0x" + "1".repeat(40),
      fixture.feeCollector.address
    );
    
    await configureHyperlaneModule(
      fixture.hyperlaneModule,
      fixture.admin,
      10, // Optimism domain
      DESTINATION_CHAIN_ID,
      "0x" + "1".repeat(64),
      200000,
      ethers.Wallet.createRandom().address
    );
    
    // Setup mocks
    await setupMockLayerZero(fixture.mockLayerZero, true, ethers.parseEther("0.01"));
    await setupMockCeler(fixture.mockCeler, true, ethers.parseEther("0.005"));
    await setupMockHyperlane(fixture.mockHyperlane, 10, ethers.parseEther("0.008"));
  });

  describe("Protocol-Specific Bridge Token Tests", function () {
    beforeEach(async function () {
      // Mint tokens for testing
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, ethers.parseEther("1000"));
    });

    it("should bridge tokens via LayerZero protocol", async function () {
      const amount = ethers.parseEther("100");
      const fee = ethers.parseEther("0.01");
      
      // Approve router
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
      
      const tx = await fixture.crossChainRouter.connect(fixture.user).bridgeToken(
        PROTOCOL_LAYERZERO,
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        { value: fee }
      );
      
      // Verify token burn
      await assertBalanceChanges(
        fixture.lookCoin,
        fixture.user.address,
        -amount,
        async () => { /* already executed */ }
      );
      
      // Verify event emission
      await assertEventEmission(
        tx,
        fixture.crossChainRouter,
        "BridgeInitiated",
        [
          await tx.wait().then(r => r.events?.find(e => e.event === "BridgeInitiated")?.args?.transferId),
          fixture.user.address,
          fixture.user2.address,
          DESTINATION_CHAIN_ID,
          amount,
          PROTOCOL_LAYERZERO
        ]
      );
      
      coverageTracker.trackFunction("CrossChainRouter", "bridgeToken");
      coverageTracker.trackBranch("CrossChainRouter", "bridgeToken-layerzero");
    });

    it("should bridge tokens via Celer protocol", async function () {
      const amount = ethers.parseEther("100");
      const bridgeFee = await fixture.celerIMModule.calculateFee(amount);
      const messageFee = ethers.parseEther("0.005");
      
      // Approve router for amount + bridge fee
      await fixture.lookCoin.connect(fixture.user).approve(
        await fixture.crossChainRouter.getAddress(),
        amount + bridgeFee
      );
      
      const tx = await fixture.crossChainRouter.connect(fixture.user).bridgeToken(
        PROTOCOL_CELER,
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        { value: messageFee }
      );
      
      // Verify token burn and fee collection
      expect(await fixture.lookCoin.totalBurned()).to.equal(amount);
      expect(await fixture.lookCoin.balanceOf(fixture.feeCollector.address)).to.equal(bridgeFee);
      
      coverageTracker.trackBranch("CrossChainRouter", "bridgeToken-celer");
    });

    it("should bridge tokens via Hyperlane protocol", async function () {
      const amount = ethers.parseEther("100");
      const fee = ethers.parseEther("0.008");
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
      
      const tx = await fixture.crossChainRouter.connect(fixture.user).bridgeToken(
        PROTOCOL_HYPERLANE,
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        { value: fee }
      );
      
      // Verify token burn
      expect(await fixture.lookCoin.totalBurned()).to.equal(amount);
      
      coverageTracker.trackBranch("CrossChainRouter", "bridgeToken-hyperlane");
    });

    it("should revert bridgeToken with zero recipient", async function () {
      await expectSpecificRevert(
        async () => fixture.crossChainRouter.connect(fixture.user).bridgeToken(
          PROTOCOL_LAYERZERO,
          DESTINATION_CHAIN_ID,
          ethers.ZeroAddress,
          ethers.parseEther("100"),
          { value: ethers.parseEther("0.01") }
        ),
        fixture.crossChainRouter,
        "InvalidRecipient"
      );
      
      coverageTracker.trackBranch("CrossChainRouter", "bridgeToken-zero-recipient");
    });

    it("should revert bridgeToken with zero amount", async function () {
      await expectSpecificRevert(
        async () => fixture.crossChainRouter.connect(fixture.user).bridgeToken(
          PROTOCOL_LAYERZERO,
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          0,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.crossChainRouter,
        "InvalidAmount"
      );
      
      coverageTracker.trackBranch("CrossChainRouter", "bridgeToken-zero-amount");
    });

    it("should revert bridgeToken with disabled protocol", async function () {
      // Disable LayerZero
      await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(
        PROTOCOL_LAYERZERO,
        await fixture.layerZeroModule.getAddress(),
        false
      );
      
      await expectSpecificRevert(
        async () => fixture.crossChainRouter.connect(fixture.user).bridgeToken(
          PROTOCOL_LAYERZERO,
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          ethers.parseEther("100"),
          { value: ethers.parseEther("0.01") }
        ),
        fixture.crossChainRouter,
        "ProtocolNotEnabled"
      );
      
      coverageTracker.trackBranch("CrossChainRouter", "bridgeToken-disabled-protocol");
    });

    it("should revert bridgeToken with unsupported chain", async function () {
      // Remove chain support
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(
        PROTOCOL_LAYERZERO,
        DESTINATION_CHAIN_ID,
        false
      );
      
      await expectSpecificRevert(
        async () => fixture.crossChainRouter.connect(fixture.user).bridgeToken(
          PROTOCOL_LAYERZERO,
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          ethers.parseEther("100"),
          { value: ethers.parseEther("0.01") }
        ),
        fixture.crossChainRouter,
        "ChainNotSupported"
      );
      
      coverageTracker.trackBranch("CrossChainRouter", "bridgeToken-unsupported-chain");
    });

    it("should test bridgeToken boolean combinations", async function () {
      // Test combinations of: valid protocol, enabled protocol, supported chain, valid amount
      for (let i = 0; i < 16; i++) {
        const hasValidProtocol = (i & 1) !== 0;
        const isProtocolEnabled = (i & 2) !== 0;
        const isChainSupported = (i & 4) !== 0;
        const hasValidAmount = (i & 8) !== 0;
        
        // Reset fixture
        fixture = await loadFixture(deployLookCoinFixture);
        
        // Configure protocol
        if (hasValidProtocol) {
          await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(
            PROTOCOL_LAYERZERO,
            await fixture.layerZeroModule.getAddress(),
            isProtocolEnabled
          );
          
          if (isChainSupported) {
            await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(
              PROTOCOL_LAYERZERO,
              DESTINATION_CHAIN_ID,
              true
            );
          }
        }
        
        const protocol = hasValidProtocol ? PROTOCOL_LAYERZERO : 99; // Invalid protocol
        const amount = hasValidAmount ? ethers.parseEther("50") : 0;
        
        if (hasValidAmount && hasValidProtocol && isProtocolEnabled && isChainSupported) {
          await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
          await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
        }
        
        if (hasValidProtocol && isProtocolEnabled && isChainSupported && hasValidAmount) {
          // Should succeed - but will fail on module call since it's not configured
          await expect(
            fixture.crossChainRouter.connect(fixture.user).bridgeToken(
              protocol,
              DESTINATION_CHAIN_ID,
              fixture.user2.address,
              amount,
              { value: ethers.parseEther("0.01") }
            )
          ).to.be.reverted; // Module not configured
        } else {
          let expectedError = "ProtocolNotConfigured";
          if (hasValidProtocol && !isProtocolEnabled) expectedError = "ProtocolNotEnabled";
          if (hasValidProtocol && isProtocolEnabled && !isChainSupported) expectedError = "ChainNotSupported";
          if (hasValidProtocol && isProtocolEnabled && isChainSupported && !hasValidAmount) expectedError = "InvalidAmount";
          
          await expectSpecificRevert(
            async () => fixture.crossChainRouter.connect(fixture.user).bridgeToken(
              protocol,
              DESTINATION_CHAIN_ID,
              fixture.user2.address,
              amount,
              { value: ethers.parseEther("0.01") }
            ),
            fixture.crossChainRouter,
            expectedError
          );
        }
        
        coverageTracker.trackBooleanCombination(
          "CrossChainRouter",
          `bridgeToken-protocol:${hasValidProtocol}-enabled:${isProtocolEnabled}-chain:${isChainSupported}-amount:${hasValidAmount}`
        );
      }
    });
  });

  describe("Automatic Route Selection Tests", function () {
    beforeEach(async function () {
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, ethers.parseEther("1000"));
    });

    it("should bridge tokens with automatic route selection (cheapest)", async function () {
      const amount = ethers.parseEther("100");
      
      // Get optimal route
      const optimalRoute = await fixture.crossChainRouter.getOptimalRoute(
        DESTINATION_CHAIN_ID,
        amount,
        0 // Cheapest
      );
      
      // Should select Celer (lowest fee)
      expect(optimalRoute.protocol).to.equal(PROTOCOL_CELER);
      
      // Approve for amount + celer fee
      const celerFee = await fixture.celerIMModule.calculateFee(amount);
      await fixture.lookCoin.connect(fixture.user).approve(
        await fixture.crossChainRouter.getAddress(),
        amount + celerFee
      );
      
      const tx = await fixture.crossChainRouter.connect(fixture.user).bridgeTokenAuto(
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        0, // Cheapest preference
        { value: ethers.parseEther("0.01") }
      );
      
      // Verify Celer was used
      const receipt = await tx.wait();
      const event = receipt.logs?.find(log => {
        try {
          const parsed = fixture.crossChainRouter.interface.parseLog(log);
          return parsed?.name === "BridgeInitiated";
        } catch {
          return false;
        }
      });
      expect(event?.args?.protocol).to.equal(PROTOCOL_CELER);
      
      coverageTracker.trackFunction("CrossChainRouter", "bridgeTokenAuto");
      coverageTracker.trackBranch("CrossChainRouter", "bridgeTokenAuto-cheapest");
    });

    it("should bridge tokens with automatic route selection (fastest)", async function () {
      const amount = ethers.parseEther("100");
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
      
      const tx = await fixture.crossChainRouter.connect(fixture.user).bridgeTokenAuto(
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        1, // Fastest preference
        { value: ethers.parseEther("0.01") }
      );
      
      // Verify LayerZero was used (fastest)
      const receipt = await tx.wait();
      const event = receipt.logs?.find(log => {
        try {
          const parsed = fixture.crossChainRouter.interface.parseLog(log);
          return parsed?.name === "BridgeInitiated";
        } catch {
          return false;
        }
      });
      expect(event?.args?.protocol).to.equal(PROTOCOL_LAYERZERO);
      
      coverageTracker.trackBranch("CrossChainRouter", "bridgeTokenAuto-fastest");
    });

    it("should bridge tokens with automatic route selection (most secure)", async function () {
      const amount = ethers.parseEther("100");
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
      
      const tx = await fixture.crossChainRouter.connect(fixture.user).bridgeTokenAuto(
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        2, // Most secure preference
        { value: ethers.parseEther("0.01") }
      );
      
      // Verify LayerZero was used (highest security level)
      const receipt = await tx.wait();
      const event = receipt.logs?.find(log => {
        try {
          const parsed = fixture.crossChainRouter.interface.parseLog(log);
          return parsed?.name === "BridgeInitiated";
        } catch {
          return false;
        }
      });
      expect(event?.args?.protocol).to.equal(PROTOCOL_LAYERZERO);
      
      coverageTracker.trackBranch("CrossChainRouter", "bridgeTokenAuto-secure");
    });

    it("should revert with no available routes", async function () {
      // Disable all protocols
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_LAYERZERO, DESTINATION_CHAIN_ID, false);
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_CELER, DESTINATION_CHAIN_ID, false);
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(PROTOCOL_HYPERLANE, DESTINATION_CHAIN_ID, false);
      
      await expectSpecificRevert(
        async () => fixture.crossChainRouter.connect(fixture.user).bridgeTokenAuto(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          ethers.parseEther("100"),
          0,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.crossChainRouter,
        "NoAvailableRoute"
      );
      
      coverageTracker.trackBranch("CrossChainRouter", "bridgeTokenAuto-no-routes");
    });

    it("should handle insufficient ETH for selected route", async function () {
      const amount = ethers.parseEther("100");
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
      
      // Send insufficient ETH
      await expectSpecificRevert(
        async () => fixture.crossChainRouter.connect(fixture.user).bridgeTokenAuto(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          amount,
          0,
          { value: ethers.parseEther("0.001") } // Too low for any protocol
        ),
        fixture.crossChainRouter,
        "InsufficientFee"
      );
      
      coverageTracker.trackBranch("CrossChainRouter", "bridgeTokenAuto-insufficient-fee");
    });

    it("should refund excess ETH", async function () {
      const amount = ethers.parseEther("100");
      const excessETH = ethers.parseEther("0.5");
      
      // Approve for Celer (includes bridge fee)
      const celerFee = await fixture.celerIMModule.calculateFee(amount);
      await fixture.lookCoin.connect(fixture.user).approve(
        await fixture.crossChainRouter.getAddress(),
        amount + celerFee
      );
      
      const balanceBefore = await ethers.provider.getBalance(fixture.user.address);
      
      const tx = await fixture.crossChainRouter.connect(fixture.user).bridgeTokenAuto(
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        0, // Cheapest - will use Celer
        { value: ethers.parseEther("0.005") + excessETH }
      );
      
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
      const balanceAfter = await ethers.provider.getBalance(fixture.user.address);
      
      // Should receive excess back
      const actualCost = balanceBefore - balanceAfter - gasUsed;
      expect(actualCost).to.be.closeTo(ethers.parseEther("0.005"), ethers.parseEther("0.001"));
      
      coverageTracker.trackBranch("CrossChainRouter", "bridgeTokenAuto-excess-refund");
    });
  });

  describe("Transfer Status and Query Tests", function () {
    it("should track transfer status correctly", async function () {
      const amount = ethers.parseEther("100");
      
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
      
      const tx = await fixture.crossChainRouter.connect(fixture.user).bridgeToken(
        PROTOCOL_LAYERZERO,
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        { value: ethers.parseEther("0.01") }
      );
      
      const receipt = await tx.wait();
      const event = receipt.logs?.find(log => {
        try {
          const parsed = fixture.crossChainRouter.interface.parseLog(log);
          return parsed?.name === "BridgeInitiated";
        } catch {
          return false;
        }
      });
      const transferId = event?.args?.transferId;
      
      // Check transfer details
      const transfer = await fixture.crossChainRouter.getTransfer(transferId);
      expect(transfer.sender).to.equal(fixture.user.address);
      expect(transfer.recipient).to.equal(fixture.user2.address);
      expect(transfer.amount).to.equal(amount);
      expect(transfer.destinationChainId).to.equal(DESTINATION_CHAIN_ID);
      expect(transfer.protocol).to.equal(PROTOCOL_LAYERZERO);
      expect(transfer.status).to.equal(0); // Pending
      
      // Get status through protocol
      const status = await fixture.crossChainRouter.getTransferStatus(transferId);
      expect(status).to.equal(0); // Pending
      
      coverageTracker.trackFunction("CrossChainRouter", "getTransferStatus");
      coverageTracker.trackBranch("CrossChainRouter", "transfer-tracking");
    });

    it("should handle protocol-specific status queries", async function () {
      // Test with non-existent transfer
      const fakeTransferId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      
      const status = await fixture.crossChainRouter.getTransferStatus(fakeTransferId);
      expect(status).to.equal(0); // Default pending
      
      coverageTracker.trackBranch("CrossChainRouter", "status-query-nonexistent");
    });
  });

  describe("Fee Estimation Tests", function () {
    it("should estimate fees for all protocols", async function () {
      const amount = ethers.parseEther("100");
      
      const options = await fixture.crossChainRouter.getBridgeOptions(DESTINATION_CHAIN_ID);
      
      for (const option of options) {
        expect(option.estimatedFee).to.be.gt(0);
        
        // Verify against direct protocol calls
        if (option.protocol === PROTOCOL_LAYERZERO) {
          expect(option.estimatedFee).to.equal(ethers.parseEther("0.01"));
        } else if (option.protocol === PROTOCOL_CELER) {
          const celerBridgeFee = await fixture.celerIMModule.calculateFee(amount);
          const celerMessageFee = ethers.parseEther("0.005");
          expect(option.estimatedFee).to.equal(celerBridgeFee + celerMessageFee);
        } else if (option.protocol === PROTOCOL_HYPERLANE) {
          expect(option.estimatedFee).to.equal(ethers.parseEther("0.008"));
        }
      }
      
      coverageTracker.trackBranch("CrossChainRouter", "fee-estimation-all-protocols");
    });

    it("should handle fee estimation for disabled protocols", async function () {
      // Disable Celer
      await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(
        PROTOCOL_CELER,
        await fixture.celerIMModule.getAddress(),
        false
      );
      
      const options = await fixture.crossChainRouter.getBridgeOptions(DESTINATION_CHAIN_ID);
      
      const celerOption = options.find(o => o.protocol === PROTOCOL_CELER);
      expect(celerOption?.available).to.be.false;
      expect(celerOption?.estimatedFee).to.equal(0);
      
      coverageTracker.trackBranch("CrossChainRouter", "fee-estimation-disabled");
    });
  });

  describe("Pause Functionality Tests", function () {
    beforeEach(async function () {
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, ethers.parseEther("1000"));
    });

    it("should prevent bridging when paused", async function () {
      // Pause router
      await fixture.crossChainRouter.connect(fixture.admin).pause();
      
      await expectSpecificRevert(
        async () => fixture.crossChainRouter.connect(fixture.user).bridgeToken(
          PROTOCOL_LAYERZERO,
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          ethers.parseEther("100"),
          { value: ethers.parseEther("0.01") }
        ),
        fixture.crossChainRouter,
        "Pausable: paused"
      );
      
      coverageTracker.trackBranch("CrossChainRouter", "bridge-paused");
    });

    it("should allow bridging after unpause", async function () {
      // Pause and unpause
      await fixture.crossChainRouter.connect(fixture.admin).pause();
      await fixture.crossChainRouter.connect(fixture.admin).unpause();
      
      const amount = ethers.parseEther("100");
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
      
      await expect(
        fixture.crossChainRouter.connect(fixture.user).bridgeToken(
          PROTOCOL_LAYERZERO,
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          amount,
          { value: ethers.parseEther("0.01") }
        )
      ).to.not.be.reverted;
      
      coverageTracker.trackBranch("CrossChainRouter", "bridge-after-unpause");
    });

    it("should test pause state combinations", async function () {
      await testBooleanCombinations(
        "Pause state impact on bridging",
        async () => !await fixture.crossChainRouter.paused(),
        async (value) => {
          if (!value) {
            await fixture.crossChainRouter.connect(fixture.admin).pause();
          } else {
            await fixture.crossChainRouter.connect(fixture.admin).unpause();
          }
        },
        async (combination) => {
          const amount = ethers.parseEther("50");
          await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
          
          if (combination.to) {
            await expect(
              fixture.crossChainRouter.connect(fixture.user).bridgeToken(
                PROTOCOL_LAYERZERO,
                DESTINATION_CHAIN_ID,
                fixture.user2.address,
                amount,
                { value: ethers.parseEther("0.01") }
              )
            ).to.not.be.reverted;
          } else {
            await expectSpecificRevert(
              async () => fixture.crossChainRouter.connect(fixture.user).bridgeToken(
                PROTOCOL_LAYERZERO,
                DESTINATION_CHAIN_ID,
                fixture.user2.address,
                amount,
                { value: ethers.parseEther("0.01") }
              ),
              fixture.crossChainRouter,
              "Pausable: paused"
            );
          }
          
          coverageTracker.trackBooleanCombination("CrossChainRouter", `pause-bridge-${combination.description}`);
        }
      );
    });
  });

  describe("Multi-Protocol Failover Tests", function () {
    beforeEach(async function () {
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, ethers.parseEther("1000"));
    });

    it("should handle protocol-specific failures gracefully", async function () {
      // Configure LayerZero to fail
      await setupMockLayerZero(fixture.mockLayerZero, false, ethers.parseEther("0.01"));
      
      const amount = ethers.parseEther("100");
      
      // LayerZero should fail
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
      
      await expect(
        fixture.crossChainRouter.connect(fixture.user).bridgeToken(
          PROTOCOL_LAYERZERO,
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          amount,
          { value: ethers.parseEther("0.01") }
        )
      ).to.be.reverted;
      
      // But auto-route should fallback to working protocol
      const celerFee = await fixture.celerIMModule.calculateFee(amount);
      await fixture.lookCoin.connect(fixture.user).approve(
        await fixture.crossChainRouter.getAddress(),
        amount + celerFee
      );
      
      const tx = await fixture.crossChainRouter.connect(fixture.user).bridgeTokenAuto(
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        0, // Cheapest
        { value: ethers.parseEther("0.01") }
      );
      
      // Should use Celer instead
      const receipt = await tx.wait();
      const event = receipt.logs?.find(log => {
        try {
          const parsed = fixture.crossChainRouter.interface.parseLog(log);
          return parsed?.name === "BridgeInitiated";
        } catch {
          return false;
        }
      });
      expect(event?.args?.protocol).to.equal(PROTOCOL_CELER);
      
      coverageTracker.trackBranch("CrossChainRouter", "protocol-failover");
    });
  });

  describe("Event Emission Tests", function () {
    it("should emit correct events for bridge operations", async function () {
      const amount = ethers.parseEther("75");
      
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
      
      const tx = await fixture.crossChainRouter.connect(fixture.user).bridgeToken(
        PROTOCOL_LAYERZERO,
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        { value: ethers.parseEther("0.01") }
      );
      
      const receipt = await tx.wait();
      
      // Check BridgeInitiated event
      const bridgeEvent = receipt.logs?.find(log => {
        try {
          const parsed = fixture.crossChainRouter.interface.parseLog(log);
          return parsed?.name === "BridgeInitiated";
        } catch {
          return false;
        }
      });
      expect(bridgeEvent).to.not.be.undefined;
      expect(bridgeEvent ? fixture.crossChainRouter.interface.parseLog(bridgeEvent)?.args?.sender : undefined).to.equal(fixture.user.address);
      expect(bridgeEvent ? fixture.crossChainRouter.interface.parseLog(bridgeEvent)?.args?.recipient : undefined).to.equal(fixture.user2.address);
      expect(bridgeEvent ? fixture.crossChainRouter.interface.parseLog(bridgeEvent)?.args?.destinationChainId : undefined).to.equal(DESTINATION_CHAIN_ID);
      expect(bridgeEvent ? fixture.crossChainRouter.interface.parseLog(bridgeEvent)?.args?.amount : undefined).to.equal(amount);
      expect(bridgeEvent ? fixture.crossChainRouter.interface.parseLog(bridgeEvent)?.args?.protocol : undefined).to.equal(PROTOCOL_LAYERZERO);
      
      // Check for protocol-specific events
      const layerZeroAddress = await fixture.layerZeroModule.getAddress();
      expect(receipt.logs?.some(e => e.address === layerZeroAddress)).to.be.true;
      
      coverageTracker.trackBranch("CrossChainRouter", "event-emission");
    });
  });

  describe("Edge Cases and Error Scenarios", function () {
    it("should handle maximum amounts", async function () {
      const maxAmount = ethers.MaxUint256;
      
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, maxAmount);
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), maxAmount);
      
      // Should handle without overflow
      const [fee] = await fixture.layerZeroModule.estimateFee(
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        maxAmount,
        []
      );
      
      await expect(
        fixture.crossChainRouter.connect(fixture.user).bridgeToken(
          PROTOCOL_LAYERZERO,
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          maxAmount,
          { value: fee }
        )
      ).to.not.be.reverted;
      
      coverageTracker.trackBranch("CrossChainRouter", "max-amount-handling");
    });

    it("should handle invalid protocol gracefully", async function () {
      const invalidProtocol = 99;
      
      await expectSpecificRevert(
        async () => fixture.crossChainRouter.connect(fixture.user).bridgeToken(
          invalidProtocol,
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          ethers.parseEther("100"),
          { value: ethers.parseEther("0.01") }
        ),
        fixture.crossChainRouter,
        "ProtocolNotConfigured"
      );
      
      coverageTracker.trackBranch("CrossChainRouter", "invalid-protocol");
    });

    it("should handle rapid consecutive transfers", async function () {
      const amounts = [
        ethers.parseEther("10"),
        ethers.parseEther("20"),
        ethers.parseEther("30"),
      ];
      
      const totalAmount = amounts.reduce((sum, amt) => sum + amt, BigInt(0));
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, totalAmount);
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), totalAmount);
      
      for (const amount of amounts) {
        await expect(
          fixture.crossChainRouter.connect(fixture.user).bridgeToken(
            PROTOCOL_LAYERZERO,
            DESTINATION_CHAIN_ID,
            fixture.user2.address,
            amount,
            { value: ethers.parseEther("0.01") }
          )
        ).to.not.be.reverted;
      }
      
      // Verify total burned
      expect(await fixture.lookCoin.totalBurned()).to.equal(totalAmount);
      
      coverageTracker.trackBranch("CrossChainRouter", "rapid-transfers");
    });

    it("should handle all protocols disabled scenario", async function () {
      // Disable all protocols
      await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(PROTOCOL_LAYERZERO, await fixture.layerZeroModule.getAddress(), false);
      await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(PROTOCOL_CELER, await fixture.celerIMModule.getAddress(), false);
      await fixture.crossChainRouter.connect(fixture.admin).configureProtocol(PROTOCOL_HYPERLANE, await fixture.hyperlaneModule.getAddress(), false);
      
      await expectSpecificRevert(
        async () => fixture.crossChainRouter.getOptimalRoute(
          DESTINATION_CHAIN_ID,
          ethers.parseEther("100"),
          0
        ),
        fixture.crossChainRouter,
        "NoAvailableRoute"
      );
      
      coverageTracker.trackBranch("CrossChainRouter", "all-protocols-disabled");
    });
  });
});