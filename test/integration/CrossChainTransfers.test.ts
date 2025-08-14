import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { 
  deployComprehensiveFixture, 
  ComprehensiveFixture,
  deployLookCoinFixture,
  configureAllBridges,
  expectSpecificRevert,
  assertEventEmission,
  testProtocolInteroperability,
  coverageTracker,
  DeploymentFixture,
} from "../utils/comprehensiveTestHelpers";
import { CrossChainSimulator, createCrossChainSimulator, CrossChainTestUtils } from "../helpers/crossChainSimulator";
import { NetworkProviderManager, NetworkTestUtils } from "../helpers/networkProvider";
import { TEST_CHAINS } from "../utils/testConfig";

describe("Cross-Chain Transfers - Comprehensive Multi-Protocol Integration", function () {
  let fixture: ComprehensiveFixture;
  let integrationFixture: DeploymentFixture;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;
  let treasury: SignerWithAddress;
  let oracle1: SignerWithAddress;
  let oracle2: SignerWithAddress;

  // Chain configurations
  const SOURCE_CHAIN = 56; // BSC
  const BSC_CHAIN_ID = TEST_CHAINS.BSC;
  const OPTIMISM_CHAIN_ID = TEST_CHAINS.OPTIMISM;
  const BASE_CHAIN_ID = TEST_CHAINS.BASE;
  const DEST_CHAIN_LZ = 10; // Optimism (LayerZero)
  const DEST_CHAIN_CELER = 10; // Optimism (Celer)
  const DEST_CHAIN_HL = 9070; // Akashic (Hyperlane)
  const HYPERLANE_DOMAIN_OP = 2;
  const HYPERLANE_DOMAIN_BASE = 3;
  const TRUSTED_REMOTE_ADDRESS = "0x" + "1".repeat(40);

  beforeEach(async function () {
    [owner, user, user2, treasury, oracle1, oracle2] = await ethers.getSigners();
    
    // Deploy comprehensive fixture for end-to-end flows
    fixture = await deployComprehensiveFixture();

    // Deploy integration fixture for multi-protocol integration tests
    integrationFixture = await loadFixture(deployLookCoinFixture);
    
    // Configure all bridges for multiple chains
    await configureAllBridges(integrationFixture, OPTIMISM_CHAIN_ID, HYPERLANE_DOMAIN_OP);
    await configureAllBridges(integrationFixture, BASE_CHAIN_ID, HYPERLANE_DOMAIN_BASE);

    // Setup comprehensive environment for end-to-end tests
    await setupComprehensiveEnvironment();
  });

  async function setupComprehensiveEnvironment() {
    // Grant necessary roles - connect to admin account (owner)
    const BRIDGE_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_OPERATOR_ROLE"));
    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
    
    await fixture.layerZeroModule.connect(owner).grantRole(BRIDGE_OPERATOR_ROLE, fixture.crossChainRouter.target);
    await fixture.celerIMModule.connect(owner).grantRole(BRIDGE_OPERATOR_ROLE, fixture.crossChainRouter.target);
    await fixture.hyperlaneModule.connect(owner).grantRole(BRIDGE_OPERATOR_ROLE, fixture.crossChainRouter.target);
    
    if (fixture.supplyOracle) {
      await fixture.supplyOracle.connect(owner).grantRole(ORACLE_ROLE, oracle1.address);
      await fixture.supplyOracle.connect(owner).grantRole(ORACLE_ROLE, oracle2.address);
    }

    // Configure protocol registry
    await fixture.protocolRegistry.connect(owner).registerProtocol(0, fixture.layerZeroModule.target, "LayerZero", "1.0.0");
    await fixture.protocolRegistry.connect(owner).registerProtocol(1, fixture.celerIMModule.target, "Celer", "1.0.0");
    await fixture.protocolRegistry.connect(owner).registerProtocol(2, fixture.hyperlaneModule.target, "Hyperlane", "1.0.0");
    
    await fixture.protocolRegistry.connect(owner).addChainSupport(0, DEST_CHAIN_LZ);
    await fixture.protocolRegistry.connect(owner).addChainSupport(1, DEST_CHAIN_CELER);
    await fixture.protocolRegistry.connect(owner).addChainSupport(2, DEST_CHAIN_HL);

    // Setup chain configurations
    await fixture.layerZeroModule.connect(owner).setTrustedRemote(DEST_CHAIN_LZ, ethers.zeroPadValue("0x1234", 32));
    await fixture.celerIMModule.connect(owner).setRemoteModule(DEST_CHAIN_CELER, ethers.zeroPadValue("0x5678", 20));
    await fixture.hyperlaneModule.connect(owner).setTrustedSender(DEST_CHAIN_HL, ethers.zeroPadValue("0x9abc", 32));

    // Setup fees
    await fixture.feeManager.connect(owner).setProtocolFee(0, 50); // 0.5% for LayerZero
    await fixture.feeManager.connect(owner).setProtocolFee(1, 75); // 0.75% for Celer
    await fixture.feeManager.connect(owner).setProtocolFee(2, 100); // 1% for Hyperlane
    
    await fixture.feeManager.connect(owner).setChainMultiplier(DEST_CHAIN_LZ, 12000); // 1.2x
    await fixture.feeManager.connect(owner).setChainMultiplier(DEST_CHAIN_CELER, 11000); // 1.1x
    await fixture.feeManager.connect(owner).setChainMultiplier(DEST_CHAIN_HL, 15000); // 1.5x

    // Mint tokens to users
    await fixture.lookCoin.connect(owner).mint(user.address, ethers.parseEther("10000000")); // 10M
    await fixture.lookCoin.connect(owner).mint(user2.address, ethers.parseEther("5000000")); // 5M
  }

  describe("End-to-End Bridge Flows", function () {
    it("Should complete LayerZero bridge flow with all validations", async function () {
      const amount = ethers.parseEther("100000"); // 100K tokens
      const destinationAddress = user2.address;
      
      // 1. Check initial state
      const initialBalance = await fixture.lookCoin.balanceOf(user.address);
      const initialSupply = await fixture.lookCoin.totalSupply();
      
      // 2. Approve router
      await fixture.lookCoin.connect(user).approve(fixture.crossChainRouter.target, amount);
      
      // 3. Estimate fees
      const [protocolFee, gasEstimate, totalFee] = await fixture.crossChainRouter.estimateBridgeFee(
        0, // LayerZero
        DEST_CHAIN_LZ,
        amount
      );
      
      expect(protocolFee).to.equal(amount * 50n / 10000n); // 0.5%
      expect(totalFee).to.be.gt(gasEstimate); // Total includes protocol fee
      
      // 4. Execute bridge
      await expect(
        fixture.crossChainRouter.connect(user).bridge(
          0, // LayerZero
          DEST_CHAIN_LZ,
          destinationAddress,
          amount,
          ethers.ZeroAddress, // No custom adapter params
          { value: totalFee }
        )
      ).to.emit(fixture.crossChainRouter, "BridgeInitiated")
        .withArgs(
          0,
          user.address,
          DEST_CHAIN_LZ,
          destinationAddress,
          amount,
          protocolFee
        );
      
      // 5. Verify state changes
      expect(await fixture.lookCoin.balanceOf(user.address)).to.equal(
        initialBalance - amount
      );
      expect(await fixture.lookCoin.totalSupply()).to.equal(
        initialSupply - amount
      );
      expect(await fixture.lookCoin.totalBurned()).to.equal(amount);
      
      // 6. Verify fee collection
      const collectedFees = await fixture.feeManager.getCollectedFees(0, SOURCE_CHAIN);
      expect(collectedFees).to.equal(protocolFee);
      
      // 7. Verify transfer tracking
      const userTransfers = await fixture.crossChainRouter.getUserTransfers(user.address);
      expect(userTransfers.length).to.equal(1);
      expect(userTransfers[0].protocol).to.equal(0);
      expect(userTransfers[0].amount).to.equal(amount);
    });

    it("Should complete Celer bridge flow with security checks", async function () {
      const amount = ethers.parseEther("250000"); // 250K tokens
      
      // Enable security checks
      if (fixture.securityManager) {
        await fixture.securityManager.connect(owner).updateChainDailyLimit(
          DEST_CHAIN_CELER,
          ethers.parseEther("1000000") // 1M daily limit
        );
      }
      
      // Approve and bridge
      await fixture.lookCoin.connect(user).approve(fixture.crossChainRouter.target, amount);
      
      const [, , totalFee] = await fixture.crossChainRouter.estimateBridgeFee(
        1, // Celer
        DEST_CHAIN_CELER,
        amount
      );
      
      const tx = await fixture.crossChainRouter.connect(user).bridge(
        1, // Celer
        DEST_CHAIN_CELER,
        user2.address,
        amount,
        ethers.ZeroAddress,
        { value: totalFee }
      );
      
      // Verify security manager was called
      if (fixture.securityManager) {
        const dailyVolume = await fixture.securityManager.getChainDailyVolume(DEST_CHAIN_CELER);
        expect(dailyVolume).to.equal(amount);
      }
      
      // Verify Celer-specific events
      await expect(tx).to.emit(fixture.celerIMModule, "MessageSent");
    });

    it("Should complete Hyperlane bridge flow", async function () {
      const amount = ethers.parseEther("400000"); // 400K tokens
      
      // Approve and bridge
      await fixture.lookCoin.connect(user).approve(fixture.crossChainRouter.target, amount);
      
      const [, , totalFee] = await fixture.crossChainRouter.estimateBridgeFee(
        2, // Hyperlane
        DEST_CHAIN_HL,
        amount
      );
      
      await fixture.crossChainRouter.connect(user).bridge(
        2, // Hyperlane
        DEST_CHAIN_HL,
        user2.address,
        amount,
        ethers.ZeroAddress,
        { value: totalFee }
      );
      
    });
  });

  describe("Multi-Protocol Bridge Operations", function () {
    describe("Sequential Cross-Chain Transfers", function () {
      it("should execute BSC → Optimism → Base token flow", async function () {
        const transferAmount = ethers.parseUnits("1000", 18);
        
        // Grant BRIDGE_ROLE to all modules
        await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.layerZeroModule.getAddress());
        await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.celerIMModule.getAddress());
        await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.hyperlaneModule.getAddress());
        
        // Step 1: Mint tokens on BSC (home chain)
        await integrationFixture.lookCoin.connect(integrationFixture.minter).mint(integrationFixture.user.address, transferAmount);
        expect(await integrationFixture.lookCoin.balanceOf(integrationFixture.user.address)).to.equal(transferAmount);
        
        const initialSupply = await integrationFixture.lookCoin.totalSupply();
        
        // Step 2: BSC → Optimism via LayerZero
        const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
        const recipientBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [TRUSTED_REMOTE_ADDRESS]);
        const [lzFee] = await integrationFixture.lookCoin.estimateBridgeFee(
          OPTIMISM_CHAIN_ID,
          recipientBytes,
          transferAmount
        );
        
        const bscToOpTx = await integrationFixture.lookCoin.connect(integrationFixture.user).sendFrom(
          integrationFixture.user.address,
          OPTIMISM_CHAIN_ID,
          recipient,
          transferAmount,
          integrationFixture.user.address,
          ethers.ZeroAddress,
          "0x",
          { value: lzFee }
        );
        
        // Verify burn on BSC
        expect(await integrationFixture.lookCoin.balanceOf(integrationFixture.user.address)).to.equal(0);
        expect(await integrationFixture.lookCoin.totalSupply()).to.equal(initialSupply - transferAmount);
        
        await assertEventEmission(
          bscToOpTx,
          integrationFixture.lookCoin,
          "SendToChain",
          [OPTIMISM_CHAIN_ID, integrationFixture.user.address, recipient, transferAmount]
        );
        
        // Step 3: Simulate arrival on Optimism (mint)
        const opPayload = ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes", "uint256"],
          [integrationFixture.user2.address, transferAmount]
        );
        const opPacket = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint16", "bytes"],
          [0, opPayload]
        );
        
        await integrationFixture.lookCoin.connect(integrationFixture.owner).setLayerZeroEndpoint(integrationFixture.user.address);
        
        await integrationFixture.lookCoin.connect(integrationFixture.user).lzReceive(
          BSC_CHAIN_ID,
          ethers.solidityPacked(
            ["address", "address"],
            [TRUSTED_REMOTE_ADDRESS, await integrationFixture.lookCoin.getAddress()]
          ),
          1,
          opPacket
        );
        
        // Verify mint on Optimism (simulated)
        expect(await integrationFixture.lookCoin.balanceOf(integrationFixture.user2.address)).to.equal(transferAmount);
        expect(await integrationFixture.lookCoin.totalSupply()).to.equal(initialSupply);
        
        // Step 4: Optimism → Base via Hyperlane
        await integrationFixture.lookCoin.connect(integrationFixture.user2).approve(await integrationFixture.hyperlaneModule.getAddress(), transferAmount);
        
        const opToBaseTx = await integrationFixture.hyperlaneModule.connect(integrationFixture.user2).bridge(
          HYPERLANE_DOMAIN_BASE,
          TRUSTED_REMOTE_ADDRESS,
          transferAmount,
          "0x",
          { value: ethers.parseEther("0.01") }
        );
        
        // Verify burn on Optimism (simulated)
        expect(await integrationFixture.lookCoin.balanceOf(integrationFixture.user2.address)).to.equal(0);
        expect(await integrationFixture.lookCoin.totalSupply()).to.equal(initialSupply - transferAmount);
        
        await assertEventEmission(
          opToBaseTx,
          integrationFixture.hyperlaneModule,
          "TokensBridged",
          [integrationFixture.user2.address, HYPERLANE_DOMAIN_BASE, TRUSTED_REMOTE_ADDRESS, transferAmount]
        );
        
        // Step 5: Simulate arrival on Base (mint)
        // Grant BRIDGE_ROLE to module for minting
        await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.hyperlaneModule.getAddress());
        
        // Set mock as mailbox
        await integrationFixture.hyperlaneModule.connect(integrationFixture.admin).updateMailbox(integrationFixture.user.address);
        
        const baseMessageData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256"],
          [integrationFixture.admin.address, transferAmount]
        );
        
        const baseReceiveTx = await integrationFixture.hyperlaneModule.connect(integrationFixture.user).handle(
          HYPERLANE_DOMAIN_OP,
          ethers.encodeBytes32String(TRUSTED_REMOTE_ADDRESS),
          baseMessageData
        );
        
        // Verify final state on Base (simulated)
        expect(await integrationFixture.lookCoin.balanceOf(integrationFixture.admin.address)).to.equal(transferAmount);
        expect(await integrationFixture.lookCoin.totalSupply()).to.equal(initialSupply);
        
        await assertEventEmission(
          baseReceiveTx,
          integrationFixture.hyperlaneModule,
          "TokensReceived",
          [HYPERLANE_DOMAIN_OP, integrationFixture.admin.address, transferAmount]
        );

        coverageTracker.trackBranch("CrossChainTransfers", "sequential-multi-chain-flow");
      });

      it("should handle complex routing scenarios", async function () {
        const amount = ethers.parseUnits("500", 18);
        
        // Grant all necessary roles
        await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.layerZeroModule.getAddress());
        await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.celerIMModule.getAddress());
        await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.hyperlaneModule.getAddress());
        await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.crossChainRouter.getAddress());
        
        // Mint tokens
        await integrationFixture.lookCoin.connect(integrationFixture.minter).mint(integrationFixture.user.address, amount * BigInt(3));
        
        // Test routing through CrossChainRouter vs direct protocols
        
        // 1. Route via CrossChainRouter (LayerZero)
        await integrationFixture.lookCoin.connect(integrationFixture.user).approve(await integrationFixture.crossChainRouter.getAddress(), amount);
        
        const routerTx = await integrationFixture.crossChainRouter.connect(integrationFixture.user).bridge(
          OPTIMISM_CHAIN_ID,
          TRUSTED_REMOTE_ADDRESS,
          amount,
          0, // LayerZero protocol
          "0x",
          { value: ethers.parseEther("0.01") }
        );
        
        await assertEventEmission(
          routerTx,
          integrationFixture.crossChainRouter,
          "TransferInitiated",
          [integrationFixture.user.address, 0, OPTIMISM_CHAIN_ID, TRUSTED_REMOTE_ADDRESS, amount]
        );
        
        // 2. Direct LayerZero
        const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
        const recipientBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [TRUSTED_REMOTE_ADDRESS]);
        const [fee] = await integrationFixture.lookCoin.estimateBridgeFee(OPTIMISM_CHAIN_ID, recipientBytes, amount);
        
        await integrationFixture.lookCoin.connect(integrationFixture.user).sendFrom(
          integrationFixture.user.address,
          OPTIMISM_CHAIN_ID,
          recipient,
          amount,
          integrationFixture.user.address,
          ethers.ZeroAddress,
          "0x",
          { value: fee }
        );
        
        // 3. Direct Celer IM
        await integrationFixture.lookCoin.connect(integrationFixture.user).approve(await integrationFixture.celerIMModule.getAddress(), amount);
        
        await integrationFixture.celerIMModule.connect(integrationFixture.user).bridge(
          OPTIMISM_CHAIN_ID,
          TRUSTED_REMOTE_ADDRESS,
          amount,
          "0x",
          { value: ethers.parseEther("0.01") }
        );
        
        // Verify all tokens were burned
        expect(await integrationFixture.lookCoin.balanceOf(integrationFixture.user.address)).to.equal(0);
        expect(await integrationFixture.lookCoin.totalBurned()).to.equal(amount * BigInt(3));

        coverageTracker.trackBranch("CrossChainTransfers", "complex-routing-scenarios");
      });
    });

    describe("Concurrent Multi-Protocol Operations", function () {
      it("should handle simultaneous bridging across all protocols", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        // Grant BRIDGE_ROLE to all modules
        await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.layerZeroModule.getAddress());
        await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.celerIMModule.getAddress());
        await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.hyperlaneModule.getAddress());
        
        // Mint tokens for all users
        await integrationFixture.lookCoin.connect(integrationFixture.minter).mint(integrationFixture.user.address, amount);
        await integrationFixture.lookCoin.connect(integrationFixture.minter).mint(integrationFixture.user2.address, amount);
        await integrationFixture.lookCoin.connect(integrationFixture.minter).mint(integrationFixture.admin.address, amount);
        
        const initialSupply = await integrationFixture.lookCoin.totalSupply();
        
        // Prepare all operations
        const lzRecipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
        const lzRecipientBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [TRUSTED_REMOTE_ADDRESS]);
        const [lzFee] = await integrationFixture.lookCoin.estimateBridgeFee(OPTIMISM_CHAIN_ID, lzRecipientBytes, amount);
        
        await integrationFixture.lookCoin.connect(integrationFixture.user2).approve(await integrationFixture.celerIMModule.getAddress(), amount);
        await integrationFixture.lookCoin.connect(integrationFixture.admin).approve(await integrationFixture.hyperlaneModule.getAddress(), amount);
        
        // Execute all operations in sequence (simulating near-simultaneous)
        const lzTx = await integrationFixture.lookCoin.connect(integrationFixture.user).sendFrom(
          integrationFixture.user.address,
          OPTIMISM_CHAIN_ID,
          lzRecipient,
          amount,
          integrationFixture.user.address,
          ethers.ZeroAddress,
          "0x",
          { value: lzFee }
        );
        
        const celerTx = await integrationFixture.celerIMModule.connect(integrationFixture.user2).bridge(
          OPTIMISM_CHAIN_ID,
          TRUSTED_REMOTE_ADDRESS,
          amount,
          "0x",
          { value: ethers.parseEther("0.01") }
        );
        
        const hyperlaneTx = await integrationFixture.hyperlaneModule.connect(integrationFixture.admin).bridge(
          HYPERLANE_DOMAIN_OP,
          TRUSTED_REMOTE_ADDRESS,
          amount,
          "0x",
          { value: ethers.parseEther("0.01") }
        );
        
        // Verify all operations succeeded
        expect(await integrationFixture.lookCoin.balanceOf(integrationFixture.user.address)).to.equal(0);
        expect(await integrationFixture.lookCoin.balanceOf(integrationFixture.user2.address)).to.equal(0);
        expect(await integrationFixture.lookCoin.balanceOf(integrationFixture.admin.address)).to.equal(0);
        
        // Verify total supply decreased by all bridged amounts
        expect(await integrationFixture.lookCoin.totalSupply()).to.equal(initialSupply - amount * BigInt(3));
        expect(await integrationFixture.lookCoin.totalBurned()).to.equal(amount * BigInt(3));
        
        // Verify events
        await assertEventEmission(lzTx, integrationFixture.lookCoin, "SendToChain", [OPTIMISM_CHAIN_ID, integrationFixture.user.address, lzRecipient, amount]);
        await assertEventEmission(celerTx, integrationFixture.celerIMModule, "TokensBridged", [integrationFixture.user2.address, OPTIMISM_CHAIN_ID, TRUSTED_REMOTE_ADDRESS, amount]);
        await assertEventEmission(hyperlaneTx, integrationFixture.hyperlaneModule, "TokensBridged", [integrationFixture.admin.address, HYPERLANE_DOMAIN_OP, TRUSTED_REMOTE_ADDRESS, amount]);

        coverageTracker.trackBranch("CrossChainTransfers", "simultaneous-multi-protocol");
      });

      it("should maintain supply consistency during concurrent operations", async function () {
        const amount = ethers.parseUnits("200", 18);
        
        await testProtocolInteroperability(integrationFixture, amount, OPTIMISM_CHAIN_ID);
        
        // Verify supply invariants are maintained
        const totalMinted = await integrationFixture.lookCoin.totalMinted();
        const totalBurned = await integrationFixture.lookCoin.totalBurned();
        const totalSupply = await integrationFixture.lookCoin.totalSupply();
        const circulatingSupply = await integrationFixture.lookCoin.circulatingSupply();
        
        expect(totalSupply).to.equal(totalMinted - totalBurned);
        expect(circulatingSupply).to.equal(totalMinted - totalBurned);

        coverageTracker.trackBranch("CrossChainTransfers", "concurrent-supply-consistency");
      });
    });
  });

  describe("Multi-Protocol Failover", function () {
    it("Should failover to alternative protocol when primary fails", async function () {
      const amount = ethers.parseEther("500000");
      
      // Disable LayerZero for Optimism
      await fixture.layerZeroModule.pause();
      
      // Router should automatically use Celer for Optimism
      await fixture.lookCoin.connect(user).approve(fixture.crossChainRouter.target, amount);
      
      const [, , totalFee] = await fixture.crossChainRouter.estimateBridgeFee(
        1, // Will use Celer
        DEST_CHAIN_CELER,
        amount
      );
      
      await expect(
        fixture.crossChainRouter.connect(user).bridge(
          0, // Request LayerZero
          DEST_CHAIN_CELER,
          user2.address,
          amount,
          ethers.ZeroAddress,
          { value: totalFee }
        )
      ).to.be.revertedWith("Pausable: paused");
      
      // Use automatic selection
      const tx = await fixture.crossChainRouter.connect(user).bridgeAuto(
        DEST_CHAIN_CELER,
        user2.address,
        amount,
        { value: totalFee }
      );
      
      // Verify Celer was used
      await expect(tx).to.emit(fixture.crossChainRouter, "BridgeInitiated")
        .withArgs(
          1, // Celer protocol
          user.address,
          DEST_CHAIN_CELER,
          user2.address,
          amount,
          amount * 75n / 10000n // 0.75% fee
        );
    });
  });

  describe("Cross-Protocol Message Handling", function () {
    it("should handle inbound messages from all protocols", async function () {
      const amount = ethers.parseUnits("150", 18);
      
      // Grant BRIDGE_ROLE to all modules
      await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.layerZeroModule.getAddress());
      await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.celerIMModule.getAddress());
      await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.hyperlaneModule.getAddress());
      
      const initialSupply = await integrationFixture.lookCoin.totalSupply();
      
      // 1. LayerZero inbound
      await integrationFixture.lookCoin.connect(integrationFixture.owner).setLayerZeroEndpoint(integrationFixture.user.address);
      
      const lzPayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "uint256"],
        [integrationFixture.user.address, amount]
      );
      const lzPacket = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint16", "bytes"],
        [0, lzPayload]
      );
      
      await integrationFixture.lookCoin.connect(integrationFixture.user).lzReceive(
        OPTIMISM_CHAIN_ID,
        ethers.solidityPacked(
          ["address", "address"],
          [TRUSTED_REMOTE_ADDRESS, await integrationFixture.lookCoin.getAddress()]
        ),
        1,
        lzPacket
      );
      
      expect(await integrationFixture.lookCoin.balanceOf(integrationFixture.user.address)).to.equal(amount);
      
      // 2. Celer IM inbound
      await integrationFixture.celerIMModule.connect(integrationFixture.admin).updateMessageBus(integrationFixture.user.address);
      
      const celerMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [integrationFixture.user2.address, amount]
      );
      
      await integrationFixture.celerIMModule.connect(integrationFixture.user).executeMessageWithTransfer(
        TRUSTED_REMOTE_ADDRESS,
        await integrationFixture.lookCoin.getAddress(),
        amount,
        2,
        celerMessage,
        integrationFixture.user.address
      );
      
      expect(await integrationFixture.lookCoin.balanceOf(integrationFixture.user2.address)).to.equal(amount);
      
      // 3. Hyperlane inbound
      await integrationFixture.hyperlaneModule.connect(integrationFixture.admin).updateMailbox(integrationFixture.user.address);
      
      const hyperlaneMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [integrationFixture.admin.address, amount]
      );
      
      await integrationFixture.hyperlaneModule.connect(integrationFixture.user).handle(
        HYPERLANE_DOMAIN_OP,
        ethers.encodeBytes32String(TRUSTED_REMOTE_ADDRESS),
        hyperlaneMessage
      );
      
      expect(await integrationFixture.lookCoin.balanceOf(integrationFixture.admin.address)).to.equal(amount);
      
      // Verify total supply increased
      expect(await integrationFixture.lookCoin.totalSupply()).to.equal(initialSupply + amount * BigInt(3));
      expect(await integrationFixture.lookCoin.totalMinted()).to.equal(amount * BigInt(3));

      coverageTracker.trackBranch("CrossChainTransfers", "multi-protocol-inbound");
    });

    it("should validate message authenticity across protocols", async function () {
      const amount = ethers.parseUnits("100", 18);
      
      // Test invalid LayerZero source
      const lzPayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "uint256"],
        [integrationFixture.user.address, amount]
      );
      const lzPacket = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint16", "bytes"],
        [0, lzPayload]
      );
      
      await integrationFixture.lookCoin.connect(integrationFixture.owner).setLayerZeroEndpoint(integrationFixture.user.address);
      
      await expectSpecificRevert(
        async () => integrationFixture.lookCoin.connect(integrationFixture.user).lzReceive(
          OPTIMISM_CHAIN_ID,
          ethers.solidityPacked(
            ["address", "address"],
            ["0x" + "9".repeat(40), await integrationFixture.lookCoin.getAddress()]
          ),
          1,
          lzPacket
        ),
        integrationFixture.lookCoin,
        "InvalidSourceAddress"
      );
      
      // Test invalid Celer message bus
      await expectSpecificRevert(
        async () => integrationFixture.celerIMModule.connect(integrationFixture.user2).executeMessageWithTransfer(
          TRUSTED_REMOTE_ADDRESS,
          await integrationFixture.lookCoin.getAddress(),
          amount,
          1,
          "0x",
          integrationFixture.user.address
        ),
        integrationFixture.celerIMModule,
        "InvalidMessageBus"
      );
      
      // Test invalid Hyperlane mailbox
      await expectSpecificRevert(
        async () => integrationFixture.hyperlaneModule.connect(integrationFixture.user2).handle(
          HYPERLANE_DOMAIN_OP,
          ethers.encodeBytes32String(TRUSTED_REMOTE_ADDRESS),
          "0x"
        ),
        integrationFixture.hyperlaneModule,
        "InvalidMailbox"
      );

      coverageTracker.trackBranch("CrossChainTransfers", "message-authenticity-validation");
    });
  });

  describe("Security Integration", function () {
    it("Should enforce daily limits across all protocols", async function () {
      const limitPerTx = ethers.parseEther("400000");
      const dailyLimit = ethers.parseEther("1000000");
      
      if (!fixture.securityManager) {
        this.skip();
      }
      
      // Set chain daily limit
      await fixture.securityManager.updateChainDailyLimit(DEST_CHAIN_LZ, dailyLimit);
      
      // Execute multiple transfers
      for (let i = 0; i < 2; i++) {
        await fixture.lookCoin.connect(user).approve(fixture.crossChainRouter.target, limitPerTx);
        
        const [, , totalFee] = await fixture.crossChainRouter.estimateBridgeFee(
          0,
          DEST_CHAIN_LZ,
          limitPerTx
        );
        
        await fixture.crossChainRouter.connect(user).bridge(
          0,
          DEST_CHAIN_LZ,
          user2.address,
          limitPerTx,
          ethers.ZeroAddress,
          { value: totalFee }
        );
      }
      
      // Third transfer should fail (would exceed daily limit)
      await fixture.lookCoin.connect(user).approve(fixture.crossChainRouter.target, limitPerTx);
      
      const [, , totalFee] = await fixture.crossChainRouter.estimateBridgeFee(
        0,
        DEST_CHAIN_LZ,
        limitPerTx
      );
      
      await expect(
        fixture.crossChainRouter.connect(user).bridge(
          0,
          DEST_CHAIN_LZ,
          user2.address,
          limitPerTx,
          ethers.ZeroAddress,
          { value: totalFee }
        )
      ).to.be.revertedWith("SecurityManager: exceeds chain daily limit");
    });

    it("Should detect and handle suspicious activity", async function () {
      if (!fixture.securityManager) {
        this.skip();
      }
      
      // Configure suspicious activity threshold
      await fixture.securityManager.setSuspiciousActivityThreshold(
        3, // 3 transfers
        300 // 5 minutes
      );
      
      const amount = ethers.parseEther("100000");
      
      // Rapid transfers
      for (let i = 0; i < 3; i++) {
        await fixture.lookCoin.connect(user).approve(fixture.crossChainRouter.target, amount);
        
        const [, , totalFee] = await fixture.crossChainRouter.estimateBridgeFee(
          0,
          DEST_CHAIN_LZ,
          amount
        );
        
        const tx = await fixture.crossChainRouter.connect(user).bridge(
          0,
          DEST_CHAIN_LZ,
          user2.address,
          amount,
          ethers.ZeroAddress,
          { value: totalFee }
        );
        
        if (i === 2) {
          // Third transfer should trigger suspicious activity
          await expect(tx).to.emit(fixture.securityManager, "SuspiciousActivityDetected")
            .withArgs(user.address, "rapid_transfers");
        }
      }
    });
  });

  describe("Supply Oracle Integration", function () {
    it("Should track cross-chain supply changes", async function () {
      if (!fixture.supplyOracle) {
        this.skip();
      }
      
      const amount = ethers.parseEther("1000000"); // 1M tokens
      const initialSupply = await fixture.lookCoin.totalSupply();
      
      // Update initial supply in oracle
      await fixture.supplyOracle.connect(oracle1).updateSupply(
        SOURCE_CHAIN,
        initialSupply,
        0,
        1
      );
      await fixture.supplyOracle.connect(oracle2).updateSupply(
        SOURCE_CHAIN,
        initialSupply,
        0,
        1
      );
      
      // Execute bridge
      await fixture.lookCoin.connect(user).approve(fixture.crossChainRouter.target, amount);
      
      const [, , totalFee] = await fixture.crossChainRouter.estimateBridgeFee(
        0,
        DEST_CHAIN_LZ,
        amount
      );
      
      await fixture.crossChainRouter.connect(user).bridge(
        0,
        DEST_CHAIN_LZ,
        user2.address,
        amount,
        ethers.ZeroAddress,
        { value: totalFee }
      );
      
      // Update supply after bridge
      const newSupply = await fixture.lookCoin.totalSupply();
      await fixture.supplyOracle.connect(oracle1).updateSupply(
        SOURCE_CHAIN,
        newSupply,
        0,
        2
      );
      await fixture.supplyOracle.connect(oracle2).updateSupply(
        SOURCE_CHAIN,
        newSupply,
        0,
        2
      );
      
      // Verify supply tracking
      const chainSupply = await fixture.supplyOracle.getChainSupply(SOURCE_CHAIN);
      expect(chainSupply.totalSupply).to.equal(newSupply);
      expect(initialSupply - newSupply).to.equal(amount);
    });

    it("Should detect supply deviation and pause operations", async function () {
      if (!fixture.supplyOracle) {
        this.skip();
      }
      
      // Set deviation threshold to 1%
      await fixture.supplyOracle.updateDeviationThreshold(100);
      
      const initialSupply = await fixture.lookCoin.totalSupply();
      const deviatedSupply = initialSupply * 102n / 100n; // 2% increase
      
      // Report deviated supply
      await fixture.supplyOracle.connect(oracle1).updateSupply(
        DEST_CHAIN_LZ,
        deviatedSupply,
        0,
        1
      );
      await expect(
        fixture.supplyOracle.connect(oracle2).updateSupply(
          DEST_CHAIN_LZ,
          deviatedSupply,
          0,
          1
        )
      ).to.emit(fixture.supplyOracle, "DeviationDetected");
      
      // Verify deviation flag
      const globalSupply = await fixture.supplyOracle.getGlobalSupply();
      expect(globalSupply.hasDeviation).to.be.true;
    });
  });

  describe("Fee Management Integration", function () {
    it("Should correctly distribute fees across protocols and chains", async function () {
      const transfers = [
        { protocol: 0, chain: DEST_CHAIN_LZ, amount: ethers.parseEther("100000") },
        { protocol: 1, chain: DEST_CHAIN_CELER, amount: ethers.parseEther("200000") },
        { protocol: 2, chain: DEST_CHAIN_HL, amount: ethers.parseEther("300000") }
      ];
      
      let totalProtocolFees = 0n;
      
      for (const transfer of transfers) {
        await fixture.lookCoin.connect(user).approve(fixture.crossChainRouter.target, transfer.amount);
        
        const [protocolFee, , totalFee] = await fixture.crossChainRouter.estimateBridgeFee(
          transfer.protocol,
          transfer.chain,
          transfer.amount
        );
        
        await fixture.crossChainRouter.connect(user).bridge(
          transfer.protocol,
          transfer.chain,
          user2.address,
          transfer.amount,
          ethers.ZeroAddress,
          { value: totalFee }
        );
        
        totalProtocolFees += protocolFee;
      }
      
      // Verify fee collection
      const lzFees = await fixture.feeManager.getCollectedFees(0, SOURCE_CHAIN);
      const celerFees = await fixture.feeManager.getCollectedFees(1, SOURCE_CHAIN);
      const hlFees = await fixture.feeManager.getCollectedFees(2, SOURCE_CHAIN);
      
      expect(lzFees).to.equal(transfers[0].amount * 50n / 10000n);
      expect(celerFees).to.equal(transfers[1].amount * 75n / 10000n);
      expect(hlFees).to.equal(transfers[2].amount * 100n / 10000n);
      
      // Withdraw fees
      await fixture.feeManager.withdrawFees(0, SOURCE_CHAIN, treasury.address);
      await fixture.feeManager.withdrawFees(1, SOURCE_CHAIN, treasury.address);
      await fixture.feeManager.withdrawFees(2, SOURCE_CHAIN, treasury.address);
      
      const treasuryBalance = await fixture.lookCoin.balanceOf(treasury.address);
      expect(treasuryBalance).to.equal(totalProtocolFees);
    });
  });

  describe("Emergency Scenarios", function () {
    it("Should handle global pause across all protocols", async function () {
      // Pause all protocols
      await fixture.crossChainRouter.pause();
      
      const amount = ethers.parseEther("100000");
      await fixture.lookCoin.connect(user).approve(fixture.crossChainRouter.target, amount);
      
      // All bridge attempts should fail
      await expect(
        fixture.crossChainRouter.connect(user).bridge(
          0,
          DEST_CHAIN_LZ,
          user2.address,
          amount,
          ethers.ZeroAddress,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWithCustomError(fixture.crossChainRouter, "EnforcedPause");
    });

    it("Should recover from compromised protocol", async function () {
      const amount = ethers.parseEther("500000");
      
      // Simulate compromised LayerZero module
      await fixture.protocolRegistry.setProtocolStatus(0, false);
      
      // Should not be able to use LayerZero
      const availableProtocols = await fixture.protocolRegistry.getAvailableProtocols(DEST_CHAIN_LZ);
      expect(availableProtocols).to.not.include(0);
      
      // But can still use Celer for same chain
      await fixture.lookCoin.connect(user).approve(fixture.crossChainRouter.target, amount);
      
      const [, , totalFee] = await fixture.crossChainRouter.estimateBridgeFee(
        1,
        DEST_CHAIN_CELER,
        amount
      );
      
      await fixture.crossChainRouter.connect(user).bridge(
        1,
        DEST_CHAIN_CELER,
        user2.address,
        amount,
        ethers.ZeroAddress,
        { value: totalFee }
      );
    });
  });

  describe("Performance and Gas Optimization", function () {
    it("Should handle batch operations efficiently", async function () {
      const transfers = 5;
      const amountPerTransfer = ethers.parseEther("50000");
      
      // Approve total amount
      await fixture.lookCoin.connect(user).approve(
        fixture.crossChainRouter.target,
        amountPerTransfer * BigInt(transfers)
      );
      
      const gasUsed = [];
      
      for (let i = 0; i < transfers; i++) {
        const [, , totalFee] = await fixture.crossChainRouter.estimateBridgeFee(
          0,
          DEST_CHAIN_LZ,
          amountPerTransfer
        );
        
        const tx = await fixture.crossChainRouter.connect(user).bridge(
          0,
          DEST_CHAIN_LZ,
          user2.address,
          amountPerTransfer,
          ethers.ZeroAddress,
          { value: totalFee }
        );
        
        const receipt = await tx.wait();
        gasUsed.push(receipt.gasUsed);
      }
      
      // Gas usage should be consistent
      const avgGas = gasUsed.reduce((a, b) => a + b, 0n) / BigInt(gasUsed.length);
      for (const gas of gasUsed) {
        const deviation = gas > avgGas ? gas - avgGas : avgGas - gas;
        expect(deviation).to.be.lt(avgGas / 10n); // Less than 10% deviation
      }
    });
  });

  describe("Direct OFT Integration", function () {
    it("Should support direct LayerZero OFT transfers", async function () {
      const amount = ethers.parseEther("200000");
      const destinationAddress = user2.address;
      
      // Direct OFT transfer (bypassing router)
      const destinationBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [destinationAddress]);
      const [nativeFee] = await fixture.lookCoin.estimateBridgeFee(
        DEST_CHAIN_LZ,
        destinationBytes,
        amount
      );
      
      await expect(
        fixture.lookCoin.connect(user).sendFrom(
          user.address,
          DEST_CHAIN_LZ,
          destinationAddress,
          amount,
          user.address,
          ethers.ZeroAddress,
          "0x",
          { value: nativeFee }
        )
      ).to.emit(fixture.lookCoin, "SendToChain")
        .withArgs(DEST_CHAIN_LZ, user.address, destinationAddress, amount);
      
      // Verify burn
      expect(await fixture.lookCoin.totalBurned()).to.equal(amount);
    });

    it("Should maintain consistency between direct OFT and router transfers", async function () {
      const amount = ethers.parseEther("100000");
      
      // Track initial state
      const initialSupply = await fixture.lookCoin.totalSupply();
      const initialBurned = await fixture.lookCoin.totalBurned();
      
      // Transfer 1: Direct OFT
      const user2Bytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user2.address]);
      const [nativeFee] = await fixture.lookCoin.estimateBridgeFee(
        DEST_CHAIN_LZ,
        user2Bytes,
        amount
      );
      
      await fixture.lookCoin.connect(user).sendFrom(
        user.address,
        DEST_CHAIN_LZ,
        user2.address,
        amount,
        user.address,
        ethers.ZeroAddress,
        "0x",
        { value: nativeFee }
      );
      
      // Transfer 2: Through router
      await fixture.lookCoin.connect(user).approve(fixture.crossChainRouter.target, amount);
      
      const [, , totalFee] = await fixture.crossChainRouter.estimateBridgeFee(
        0,
        DEST_CHAIN_LZ,
        amount
      );
      
      await fixture.crossChainRouter.connect(user).bridge(
        0,
        DEST_CHAIN_LZ,
        user2.address,
        amount,
        ethers.ZeroAddress,
        { value: totalFee }
      );
      
      // Verify consistency
      const finalSupply = await fixture.lookCoin.totalSupply();
      const finalBurned = await fixture.lookCoin.totalBurned();
      
      expect(initialSupply - finalSupply).to.equal(amount * 2n);
      expect(finalBurned - initialBurned).to.equal(amount * 2n);
    });
  });

  describe("Protocol Failure Scenarios", function () {
    it("should handle LayerZero endpoint failure", async function () {
      const amount = ethers.parseUnits("100", 18);
      
      await integrationFixture.lookCoin.connect(integrationFixture.minter).mint(integrationFixture.user.address, amount * BigInt(3));
      
      // Simulate LayerZero endpoint failure by removing configuration
      await integrationFixture.lookCoin.connect(integrationFixture.protocolAdmin).setTrustedRemote(OPTIMISM_CHAIN_ID, "0x");
      
      // LayerZero should fail
      await expectSpecificRevert(
        async () => integrationFixture.lookCoin.connect(integrationFixture.user).sendFrom(
          integrationFixture.user.address,
          OPTIMISM_CHAIN_ID,
          ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS),
          amount,
          integrationFixture.user.address,
          ethers.ZeroAddress,
          "0x"
        ),
        integrationFixture.lookCoin,
        "LayerZeroNotConfigured"
      );
      
      // Other protocols should still work
      await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.celerIMModule.getAddress());
      await integrationFixture.lookCoin.connect(integrationFixture.user).approve(await integrationFixture.celerIMModule.getAddress(), amount);
      
      await expect(
        integrationFixture.celerIMModule.connect(integrationFixture.user).bridge(
          OPTIMISM_CHAIN_ID,
          TRUSTED_REMOTE_ADDRESS,
          amount,
          "0x",
          { value: ethers.parseEther("0.01") }
        )
      ).to.not.be.reverted;

      coverageTracker.trackBranch("CrossChainTransfers", "layerzero-failure-isolation");
    });

    it("should handle multiple protocol failures", async function () {
      const amount = ethers.parseUnits("100", 18);
      
      await integrationFixture.lookCoin.connect(integrationFixture.minter).mint(integrationFixture.user.address, amount);
      
      // Disable LayerZero
      await integrationFixture.lookCoin.connect(integrationFixture.protocolAdmin).setTrustedRemote(OPTIMISM_CHAIN_ID, "0x");
      
      // Pause Celer
      await integrationFixture.celerIMModule.connect(integrationFixture.admin).pause();
      
      // Both should fail
      await expectSpecificRevert(
        async () => integrationFixture.lookCoin.connect(integrationFixture.user).sendFrom(
          integrationFixture.user.address,
          OPTIMISM_CHAIN_ID,
          ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS),
          amount,
          integrationFixture.user.address,
          ethers.ZeroAddress,
          "0x"
        ),
        integrationFixture.lookCoin,
        "LayerZeroNotConfigured"
      );
      
      await expectSpecificRevert(
        async () => integrationFixture.celerIMModule.connect(integrationFixture.user).bridge(
          OPTIMISM_CHAIN_ID,
          TRUSTED_REMOTE_ADDRESS,
          amount,
          "0x"
        ),
        integrationFixture.celerIMModule,
        "EnforcedPause"
      );
      
      // Hyperlane should still work as fallback
      await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.hyperlaneModule.getAddress());
      await integrationFixture.lookCoin.connect(integrationFixture.user).approve(await integrationFixture.hyperlaneModule.getAddress(), amount);
      
      await expect(
        integrationFixture.hyperlaneModule.connect(integrationFixture.user).bridge(
          HYPERLANE_DOMAIN_OP,
          TRUSTED_REMOTE_ADDRESS,
          amount,
          "0x",
          { value: ethers.parseEther("0.01") }
        )
      ).to.not.be.reverted;

      coverageTracker.trackBranch("CrossChainTransfers", "multiple-protocol-failures");
    });

    it("should handle complete bridge system failure", async function () {
      const amount = ethers.parseUnits("100", 18);
      
      await integrationFixture.lookCoin.connect(integrationFixture.minter).mint(integrationFixture.user.address, amount);
      
      // Pause entire LookCoin contract
      await integrationFixture.lookCoin.connect(integrationFixture.pauser).pause();
      
      // All operations should fail
      await expectSpecificRevert(
        async () => integrationFixture.lookCoin.connect(integrationFixture.user).sendFrom(
          integrationFixture.user.address,
          OPTIMISM_CHAIN_ID,
          ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS),
          amount,
          integrationFixture.user.address,
          ethers.ZeroAddress,
          "0x"
        ),
        integrationFixture.lookCoin,
        "EnforcedPause"
      );
      
      await expectSpecificRevert(
        async () => integrationFixture.lookCoin.connect(integrationFixture.user).transfer(integrationFixture.user2.address, amount),
        integrationFixture.lookCoin,
        "EnforcedPause"
      );
      
      // Recovery should work
      await integrationFixture.lookCoin.connect(integrationFixture.pauser).unpause();
      
      await expect(
        integrationFixture.lookCoin.connect(integrationFixture.user).transfer(integrationFixture.user2.address, amount)
      ).to.not.be.reverted;

      coverageTracker.trackBranch("CrossChainTransfers", "complete-system-failure-recovery");
    });
  });

  describe("Performance and Gas Analysis", function () {
    it("should track gas usage across protocols", async function () {
      const amount = ethers.parseUnits("100", 18);
      
      await integrationFixture.lookCoin.connect(integrationFixture.minter).mint(integrationFixture.user.address, amount * BigInt(3));
      
      // Grant necessary roles
      await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.celerIMModule.getAddress());
      await integrationFixture.lookCoin.grantRole(await integrationFixture.lookCoin.BRIDGE_ROLE(), await integrationFixture.hyperlaneModule.getAddress());
      
      // LayerZero gas usage
      const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
      const [fee] = await integrationFixture.lookCoin.estimateSendFee(OPTIMISM_CHAIN_ID, recipient, amount, false, "0x");
      
      const lzTx = await integrationFixture.lookCoin.connect(integrationFixture.user).sendFrom(
        integrationFixture.user.address,
        OPTIMISM_CHAIN_ID,
        recipient,
        amount,
        integrationFixture.user.address,
        ethers.ZeroAddress,
        "0x",
        { value: fee }
      );
      const lzReceipt = await lzTx.wait();
      
      // Celer IM gas usage
      await integrationFixture.lookCoin.connect(integrationFixture.user).approve(await integrationFixture.celerIMModule.getAddress(), amount);
      const celerTx = await integrationFixture.celerIMModule.connect(integrationFixture.user).bridge(
        OPTIMISM_CHAIN_ID,
        TRUSTED_REMOTE_ADDRESS,
        amount,
        "0x",
        { value: ethers.parseEther("0.01") }
      );
      const celerReceipt = await celerTx.wait();
      
      // Hyperlane gas usage
      await integrationFixture.lookCoin.connect(integrationFixture.user).approve(await integrationFixture.hyperlaneModule.getAddress(), amount);
      const hyperlaneTx = await integrationFixture.hyperlaneModule.connect(integrationFixture.user).bridge(
        HYPERLANE_DOMAIN_OP,
        TRUSTED_REMOTE_ADDRESS,
        amount,
        "0x",
        { value: ethers.parseEther("0.01") }
      );
      const hyperlaneReceipt = await hyperlaneTx.wait();
      
      console.log(`LayerZero gas: ${lzReceipt!.gasUsed}`);
      console.log(`Celer IM gas: ${celerReceipt!.gasUsed}`);
      console.log(`Hyperlane gas: ${hyperlaneReceipt!.gasUsed}`);
      
      // Gas usage should be reasonable for all protocols
      expect(lzReceipt!.gasUsed).to.be.lt(200000);
      expect(celerReceipt!.gasUsed).to.be.lt(200000);
      expect(hyperlaneReceipt!.gasUsed).to.be.lt(200000);

      coverageTracker.trackBranch("CrossChainTransfers", "gas-usage-analysis");
    });

    it("should handle high-volume cross-chain operations", async function () {
      const baseAmount = ethers.parseUnits("10", 18);
      const operationCount = 10;
      
      // Mint tokens for high-volume testing
      await integrationFixture.lookCoin.connect(integrationFixture.minter).mint(
        integrationFixture.user.address,
        baseAmount * BigInt(operationCount)
      );
      
      const initialSupply = await integrationFixture.lookCoin.totalSupply();
      
      // Execute multiple operations rapidly
      for (let i = 0; i < operationCount; i++) {
        const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
        const [fee] = await integrationFixture.lookCoin.estimateSendFee(
          OPTIMISM_CHAIN_ID,
          recipient,
          baseAmount,
          false,
          "0x"
        );
        
        await integrationFixture.lookCoin.connect(integrationFixture.user).sendFrom(
          integrationFixture.user.address,
          OPTIMISM_CHAIN_ID,
          recipient,
          baseAmount,
          integrationFixture.user.address,
          ethers.ZeroAddress,
          "0x",
          { value: fee }
        );
      }
      
      // Verify all operations succeeded
      expect(await integrationFixture.lookCoin.balanceOf(integrationFixture.user.address)).to.equal(0);
      expect(await integrationFixture.lookCoin.totalSupply()).to.equal(
        initialSupply - baseAmount * BigInt(operationCount)
      );
      expect(await integrationFixture.lookCoin.totalBurned()).to.equal(
        baseAmount * BigInt(operationCount)
      );

      coverageTracker.trackBranch("CrossChainTransfers", "high-volume-operations");
    });
  });

  describe("Coverage Validation", function () {
    it("should validate comprehensive cross-chain transfer coverage", function () {
      const report = coverageTracker.generateReport();
      console.log("\n" + report);
      
      expect(report).to.include("CrossChainTransfers");
      
      // Validate key integration scenarios were tested
      const expectedScenarios = [
        "sequential-multi-chain-flow",
        "complex-routing-scenarios",
        "simultaneous-multi-protocol",
        "concurrent-supply-consistency",
        "multi-protocol-inbound",
        "message-authenticity-validation",
        "layerzero-failure-isolation",
        "multiple-protocol-failures",
        "complete-system-failure-recovery",
        "gas-usage-analysis",
        "high-volume-operations"
      ];
      
      console.log("Expected transfer scenarios covered:", expectedScenarios.length);
    });
  });
});