import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { 
  LookCoin, 
  CrossChainRouter, 
  LayerZeroModule, 
  CelerIMModule, 
  HyperlaneModule,
  FeeManager,
  ProtocolRegistry,
  SecurityManager,
  SupplyOracle
} from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployComprehensiveFixture, ComprehensiveFixture } from "../utils/comprehensiveTestHelpers";

describe("Cross-Chain Integration Flows", function () {
  let fixture: ComprehensiveFixture;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;
  let treasury: SignerWithAddress;
  let oracle1: SignerWithAddress;
  let oracle2: SignerWithAddress;

  // Chain configurations
  const SOURCE_CHAIN = 56; // BSC
  const DEST_CHAIN_LZ = 10; // Optimism (LayerZero)
  const DEST_CHAIN_CELER = 10; // Optimism (Celer)
  const DEST_CHAIN_HL = 9070; // Akashic (Hyperlane)

  beforeEach(async function () {
    [owner, user, user2, treasury, oracle1, oracle2] = await ethers.getSigners();
    
    fixture = await deployComprehensiveFixture({
      owner,
      layerZeroEndpoint: owner,
      celerMessageBus: owner,
      hyperlaneMailbox: owner,
      treasury,
      securityManager: true,
      supplyOracle: true
    });

    // Setup comprehensive environment
    await setupComprehensiveEnvironment();
  });

  async function setupComprehensiveEnvironment() {
    // Grant necessary roles
    const BRIDGE_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_OPERATOR_ROLE"));
    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
    
    await fixture.layerZeroModule.grantRole(BRIDGE_OPERATOR_ROLE, fixture.crossChainRouter.target);
    await fixture.celerIMModule.grantRole(BRIDGE_OPERATOR_ROLE, fixture.crossChainRouter.target);
    await fixture.hyperlaneModule.grantRole(BRIDGE_OPERATOR_ROLE, fixture.crossChainRouter.target);
    
    if (fixture.supplyOracle) {
      await fixture.supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      await fixture.supplyOracle.grantRole(ORACLE_ROLE, oracle2.address);
    }

    // Configure protocol registry
    await fixture.protocolRegistry.registerProtocol(0, fixture.layerZeroModule.target, "LayerZero", "1.0.0");
    await fixture.protocolRegistry.registerProtocol(1, fixture.celerIMModule.target, "Celer", "1.0.0");
    await fixture.protocolRegistry.registerProtocol(2, fixture.hyperlaneModule.target, "Hyperlane", "1.0.0");
    
    await fixture.protocolRegistry.addChainSupport(0, DEST_CHAIN_LZ);
    await fixture.protocolRegistry.addChainSupport(1, DEST_CHAIN_CELER);
    await fixture.protocolRegistry.addChainSupport(2, DEST_CHAIN_HL);

    // Setup chain configurations
    await fixture.layerZeroModule.setTrustedRemote(DEST_CHAIN_LZ, ethers.zeroPadValue("0x1234", 32));
    await fixture.celerIMModule.setRemoteModule(DEST_CHAIN_CELER, ethers.zeroPadValue("0x5678", 20));
    await fixture.hyperlaneModule.setTrustedSender(DEST_CHAIN_HL, ethers.zeroPadValue("0x9abc", 32));

    // Setup fees
    await fixture.feeManager.setProtocolFee(0, 50); // 0.5% for LayerZero
    await fixture.feeManager.setProtocolFee(1, 75); // 0.75% for Celer
    await fixture.feeManager.setProtocolFee(2, 100); // 1% for Hyperlane
    
    await fixture.feeManager.setChainMultiplier(DEST_CHAIN_LZ, 12000); // 1.2x
    await fixture.feeManager.setChainMultiplier(DEST_CHAIN_CELER, 11000); // 1.1x
    await fixture.feeManager.setChainMultiplier(DEST_CHAIN_HL, 15000); // 1.5x

    // Mint tokens to users
    await fixture.lookCoin.mint(user.address, ethers.parseEther("10000000")); // 10M
    await fixture.lookCoin.mint(user2.address, ethers.parseEther("5000000")); // 5M
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
      const [nativeFee] = await fixture.lookCoin.estimateSendFee(
        DEST_CHAIN_LZ,
        destinationAddress,
        amount,
        false,
        "0x"
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
      const [nativeFee] = await fixture.lookCoin.estimateSendFee(
        DEST_CHAIN_LZ,
        user2.address,
        amount,
        false,
        "0x"
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
});
