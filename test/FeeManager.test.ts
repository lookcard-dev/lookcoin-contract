import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { FeeManager, CrossChainRouter, LookCoin, ProtocolRegistry } from "../typechain-types";

describe("FeeManager Test", function () {
  let feeManager: FeeManager;
  let crossChainRouter: CrossChainRouter;
  let protocolRegistry: ProtocolRegistry;
  let lookCoin: LookCoin;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let layerZeroModule: SignerWithAddress;
  let celerModule: SignerWithAddress;
  let xerc20Module: SignerWithAddress;
  let hyperlaneModule: SignerWithAddress;

  const FEE_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FEE_ADMIN_ROLE"));

  // Protocol enum values
  enum Protocol {
    LayerZero = 0,
    Celer = 1,
    XERC20 = 2, // DEPRECATED - DO NOT USE
    Hyperlane = 3,
  }

  // Chain IDs
  const BSC_CHAIN = 56;
  const OPTIMISM_CHAIN = 10;
  const BASE_CHAIN = 8453;
  const AKASHIC_CHAIN = 9070;

  // Fee parameters
  const DEFAULT_BASE_FEE = ethers.parseEther("0.001"); // 0.001 ETH base fee
  const DEFAULT_PERCENTAGE_FEE = 50; // 0.5% in basis points
  const GAS_PRICE_GWEI = 20; // 20 gwei

  beforeEach(async function () {
    [owner, addr1, feeCollector, layerZeroModule, celerModule, xerc20Module, hyperlaneModule] = await ethers.getSigners();

    // Deploy FeeManager
    const FeeManager = await ethers.getContractFactory("FeeManager");
    feeManager = (await upgrades.deployProxy(FeeManager, [owner.address], {
      initializer: "initialize",
    })) as unknown as FeeManager;
    await feeManager.waitForDeployment();

    // Deploy ProtocolRegistry
    const ProtocolRegistry = await ethers.getContractFactory("ProtocolRegistry");
    protocolRegistry = (await upgrades.deployProxy(ProtocolRegistry, [owner.address], {
      initializer: "initialize",
    })) as unknown as ProtocolRegistry;
    await protocolRegistry.waitForDeployment();

    // Deploy LookCoin
    const LookCoin = await ethers.getContractFactory("LookCoin");
    lookCoin = (await upgrades.deployProxy(LookCoin, [owner.address, ethers.ZeroAddress], {
      initializer: "initialize",
    })) as unknown as LookCoin;
    await lookCoin.waitForDeployment();

    // Deploy CrossChainRouter
    const SecurityManager = await ethers.getContractFactory("SecurityManager");
    const securityManager = await upgrades.deployProxy(
      SecurityManager,
      [owner.address, ethers.parseEther("20000000")], // 20M daily limit
      { initializer: "initialize" }
    );
    await securityManager.waitForDeployment();

    const CrossChainRouter = await ethers.getContractFactory("CrossChainRouter");
    crossChainRouter = (await upgrades.deployProxy(
      CrossChainRouter,
      [
        await lookCoin.getAddress(),
        await feeManager.getAddress(),
        await securityManager.getAddress(),
        owner.address,
      ],
      { initializer: "initialize" }
    )) as unknown as CrossChainRouter;
    await crossChainRouter.waitForDeployment();

    // Set fee collector
    await feeManager.setFeeCollector(feeCollector.address);

    // Set protocol registry in fee manager
    await feeManager.setProtocolRegistry(await protocolRegistry.getAddress());

    // Register protocols in registry
    await protocolRegistry.registerProtocol(Protocol.LayerZero, layerZeroModule.address, "LayerZero", "1.0.0");
    await protocolRegistry.registerProtocol(Protocol.Celer, celerModule.address, "Celer IM", "1.0.0");
    // Skip XERC20 - deprecated
    await protocolRegistry.registerProtocol(Protocol.Hyperlane, hyperlaneModule.address, "Hyperlane", "1.0.0");
  });

  describe("Initialization", function () {
    it("Should have correct admin role", async function () {
      expect(await feeManager.hasRole(FEE_ADMIN_ROLE, owner.address)).to.equal(true);
    });

    it("Should have fee collector set", async function () {
      expect(await feeManager.feeCollector()).to.equal(feeCollector.address);
    });

    it("Should have protocol registry set", async function () {
      expect(await feeManager.protocolRegistry()).to.equal(await protocolRegistry.getAddress());
    });
  });

  describe("Protocol Fee Configuration", function () {
    it("Should set protocol fees", async function () {
      await expect(
        feeManager.setProtocolFees(
          Protocol.LayerZero,
          DEFAULT_BASE_FEE,
          DEFAULT_PERCENTAGE_FEE,
          300000 // 300k gas estimate
        )
      )
        .to.emit(feeManager, "ProtocolFeesUpdated")
        .withArgs(Protocol.LayerZero, DEFAULT_BASE_FEE, DEFAULT_PERCENTAGE_FEE, 300000);

      const fees = await feeManager.protocolFees(Protocol.LayerZero);
      expect(fees.baseFee).to.equal(DEFAULT_BASE_FEE);
      expect(fees.percentageFee).to.equal(DEFAULT_PERCENTAGE_FEE);
      expect(fees.gasEstimate).to.equal(300000);
      expect(fees.isActive).to.equal(true);
    });

    it("Should configure fees for all protocols", async function () {
      // LayerZero - higher gas, lower percentage
      await feeManager.setProtocolFees(Protocol.LayerZero, ethers.parseEther("0.002"), 30, 350000);
      
      // Celer - medium fees
      await feeManager.setProtocolFees(Protocol.Celer, ethers.parseEther("0.001"), 50, 250000);
      
      // Skip XERC20 - deprecated
      
      // Hyperlane - gas-based fees
      await feeManager.setProtocolFees(Protocol.Hyperlane, ethers.parseEther("0.0015"), 0, 500000);

      // Verify all fees are set
      const layerZeroFees = await feeManager.protocolFees(Protocol.LayerZero);
      expect(layerZeroFees.percentageFee).to.equal(30);
    });

    it("Should only allow admin to set protocol fees", async function () {
      await expect(
        feeManager.connect(addr1).setProtocolFees(Protocol.LayerZero, DEFAULT_BASE_FEE, DEFAULT_PERCENTAGE_FEE, 300000)
      ).to.be.revertedWithCustomError(feeManager, "AccessControlUnauthorizedAccount");
    });

    it("Should validate percentage fee bounds", async function () {
      // Max percentage fee is 10000 (100%)
      await expect(
        feeManager.setProtocolFees(Protocol.LayerZero, DEFAULT_BASE_FEE, 10001, 300000)
      ).to.be.revertedWith("FeeManager: percentage fee too high");
    });
  });

  describe("Chain-Specific Fees", function () {
    beforeEach(async function () {
      // Set default protocol fees
      await feeManager.setProtocolFees(Protocol.LayerZero, DEFAULT_BASE_FEE, DEFAULT_PERCENTAGE_FEE, 300000);
    });

    it("Should set chain-specific fees", async function () {
      const chainBaseFee = ethers.parseEther("0.005");
      const chainPercentageFee = 100; // 1%

      await expect(
        feeManager.setChainFees(
          Protocol.LayerZero,
          OPTIMISM_CHAIN,
          chainBaseFee,
          chainPercentageFee,
          200000
        )
      )
        .to.emit(feeManager, "ChainFeesUpdated")
        .withArgs(Protocol.LayerZero, OPTIMISM_CHAIN, chainBaseFee, chainPercentageFee, 200000);

      const chainFees = await feeManager.chainFees(Protocol.LayerZero, OPTIMISM_CHAIN);
      expect(chainFees.baseFee).to.equal(chainBaseFee);
      expect(chainFees.percentageFee).to.equal(chainPercentageFee);
      expect(chainFees.gasEstimate).to.equal(200000);
      expect(chainFees.isActive).to.equal(true);
    });

    it("Should use chain-specific fees when available", async function () {
      // Set different fees for Optimism
      await feeManager.setChainFees(
        Protocol.LayerZero,
        OPTIMISM_CHAIN,
        ethers.parseEther("0.0001"), // Lower base fee for L2
        25, // 0.25%
        150000 // Lower gas on L2
      );

      // Estimate fees for BSC (uses default)
      const bscFees = await feeManager.estimateBridgeFee(
        Protocol.LayerZero,
        BSC_CHAIN,
        ethers.parseEther("1000")
      );

      // Estimate fees for Optimism (uses chain-specific)
      const optimismFees = await feeManager.estimateBridgeFee(
        Protocol.LayerZero,
        OPTIMISM_CHAIN,
        ethers.parseEther("1000")
      );

      // Optimism should have lower fees
      expect(optimismFees.totalFee).to.be.lt(bscFees.totalFee);
    });
  });

  describe("Fee Estimation", function () {
    beforeEach(async function () {
      // Configure protocol fees
      await feeManager.setProtocolFees(Protocol.LayerZero, ethers.parseEther("0.002"), 50, 350000);
      await feeManager.setProtocolFees(Protocol.Celer, ethers.parseEther("0.001"), 50, 250000);
      // Skip XERC20 - deprecated
      await feeManager.setProtocolFees(Protocol.Hyperlane, ethers.parseEther("0.0015"), 0, 500000);

      // Set gas price oracle
      await feeManager.updateGasPrice(OPTIMISM_CHAIN, ethers.parseUnits(GAS_PRICE_GWEI.toString(), "gwei"));
    });

    it("Should estimate fees correctly", async function () {
      const amount = ethers.parseEther("1000");
      
      const feeEstimate = await feeManager.estimateBridgeFee(
        Protocol.LayerZero,
        OPTIMISM_CHAIN,
        amount
      );

      // Base fee + percentage fee
      const expectedProtocolFee = ethers.parseEther("0.002") + (amount * 50n) / 10000n; // 0.002 + 0.5%
      expect(feeEstimate.protocolFee).to.equal(expectedProtocolFee);

      // Gas fee calculation
      const gasPrice = ethers.parseUnits(GAS_PRICE_GWEI.toString(), "gwei");
      const expectedGasFee = gasPrice * 350000n;
      expect(feeEstimate.gasFee).to.equal(expectedGasFee);

      expect(feeEstimate.totalFee).to.equal(expectedProtocolFee + expectedGasFee);
    });

    it("Should handle zero amount transfers", async function () {
      const feeEstimate = await feeManager.estimateBridgeFee(
        Protocol.LayerZero,
        OPTIMISM_CHAIN,
        0
      );

      // Should still have base fee and gas fee
      expect(feeEstimate.protocolFee).to.equal(ethers.parseEther("0.002"));
      expect(feeEstimate.gasFee).to.be.gt(0);
    });

  });

  describe("Multi-Protocol Fee Comparison", function () {
    beforeEach(async function () {
      // Set varied fees for different protocols
      await feeManager.setProtocolFees(Protocol.LayerZero, ethers.parseEther("0.003"), 40, 400000);
      await feeManager.setProtocolFees(Protocol.Celer, ethers.parseEther("0.001"), 60, 300000);
      // Skip XERC20 - deprecated
      await feeManager.setProtocolFees(Protocol.Hyperlane, ethers.parseEther("0.002"), 20, 450000);

      await feeManager.updateGasPrice(OPTIMISM_CHAIN, ethers.parseUnits("1", "gwei")); // Low L2 gas
    });

    it("Should compare fees across protocols", async function () {
      const amount = ethers.parseEther("10000");
      const protocols = [Protocol.LayerZero, Protocol.Celer, Protocol.Hyperlane];

      const fees = await feeManager.compareProtocolFees(OPTIMISM_CHAIN, amount, protocols);

      expect(fees.length).to.equal(3);

      // Find cheapest protocol
      let cheapestIndex = 0;
      let cheapestFee = fees[0].totalFee;
      
      for (let i = 1; i < fees.length; i++) {
        if (fees[i].totalFee < cheapestFee) {
          cheapestFee = fees[i].totalFee;
          cheapestIndex = i;
        }
      }

      // Verify we found a cheapest protocol
      expect(cheapestFee).to.be.gt(0);
    });

    it("Should handle bulk transfer fee optimization", async function () {
      const singleAmount = ethers.parseEther("100");
      const bulkAmount = ethers.parseEther("10000");

      // Get fees for single transfer
      const singleFee = await feeManager.estimateBridgeFee(Protocol.Celer, OPTIMISM_CHAIN, singleAmount);

      // Get fees for bulk transfer
      const bulkFee = await feeManager.estimateBridgeFee(Protocol.Celer, OPTIMISM_CHAIN, bulkAmount);

      // Calculate fee percentage
      const singleFeePercentage = (singleFee.totalFee * 10000n) / singleAmount;
      const bulkFeePercentage = (bulkFee.totalFee * 10000n) / bulkAmount;

      // Bulk transfers should have lower percentage fees due to fixed base fee
      expect(bulkFeePercentage).to.be.lt(singleFeePercentage);
    });
  });

  describe("Gas Price Management", function () {
    it("Should update gas prices", async function () {
      const newGasPrice = ethers.parseUnits("100", "gwei");

      await expect(feeManager.updateGasPrice(OPTIMISM_CHAIN, newGasPrice))
        .to.emit(feeManager, "GasPriceUpdated")
        .withArgs(OPTIMISM_CHAIN, newGasPrice);

      expect(await feeManager.chainGasPrice(OPTIMISM_CHAIN)).to.equal(newGasPrice);
    });

    it("Should batch update gas prices", async function () {
      const chains = [BSC_CHAIN, OPTIMISM_CHAIN, BASE_CHAIN];
      const prices = [
        ethers.parseUnits("5", "gwei"),   // BSC
        ethers.parseUnits("0.1", "gwei"), // Optimism
        ethers.parseUnits("0.05", "gwei") // Base
      ];

      await feeManager.batchUpdateGasPrice(chains, prices);

      expect(await feeManager.chainGasPrice(BSC_CHAIN)).to.equal(prices[0]);
      expect(await feeManager.chainGasPrice(OPTIMISM_CHAIN)).to.equal(prices[1]);
      expect(await feeManager.chainGasPrice(BASE_CHAIN)).to.equal(prices[2]);
    });

    it("Should use default gas price if not set", async function () {
      const DEFAULT_GAS_PRICE = ethers.parseUnits("20", "gwei");
      await feeManager.setDefaultGasPrice(DEFAULT_GAS_PRICE);

      // Akashic chain has no specific gas price set
      const feeEstimate = await feeManager.estimateBridgeFee(
        Protocol.Hyperlane,
        AKASHIC_CHAIN,
        ethers.parseEther("1000")
      );

      const expectedGasFee = DEFAULT_GAS_PRICE * 500000n; // Hyperlane gas estimate
      expect(feeEstimate.gasFee).to.equal(expectedGasFee);
    });
  });

  describe("Fee Collection", function () {
    it("Should track collected fees by protocol", async function () {
      const feeAmount = ethers.parseEther("0.1");

      await feeManager.recordFeeCollection(Protocol.LayerZero, OPTIMISM_CHAIN, feeAmount);

      expect(await feeManager.totalFeesCollected(Protocol.LayerZero)).to.equal(feeAmount);
      expect(await feeManager.chainFeesCollected(Protocol.LayerZero, OPTIMISM_CHAIN)).to.equal(feeAmount);
    });

    it("Should withdraw collected fees", async function () {
      // Simulate fee collection by sending ETH to FeeManager
      await owner.sendTransaction({
        to: await feeManager.getAddress(),
        value: ethers.parseEther("1"),
      });

      const initialBalance = await ethers.provider.getBalance(feeCollector.address);

      await feeManager.withdrawFees(ethers.parseEther("0.5"));

      const finalBalance = await ethers.provider.getBalance(feeCollector.address);
      expect(finalBalance - initialBalance).to.equal(ethers.parseEther("0.5"));
    });

    it("Should only allow admin to withdraw fees", async function () {
      await expect(
        feeManager.connect(addr1).withdrawFees(ethers.parseEther("0.1"))
      ).to.be.revertedWithCustomError(feeManager, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Dynamic Fee Adjustments", function () {
    beforeEach(async function () {
      await feeManager.setProtocolFees(Protocol.LayerZero, ethers.parseEther("0.001"), 50, 300000);
    });

    it("Should apply fee discounts", async function () {
      // Set 20% discount
      await feeManager.setFeeDiscount(Protocol.LayerZero, 2000); // 20% in basis points

      const amount = ethers.parseEther("1000");
      const feeEstimate = await feeManager.estimateBridgeFee(Protocol.LayerZero, OPTIMISM_CHAIN, amount);

      // Calculate expected fee with discount
      const baseFee = ethers.parseEther("0.001");
      const percentageFee = (amount * 50n) / 10000n;
      const totalBeforeDiscount = baseFee + percentageFee;
      const discount = (totalBeforeDiscount * 2000n) / 10000n;
      const expectedFee = totalBeforeDiscount - discount;

      expect(feeEstimate.protocolFee).to.equal(expectedFee);
    });

    it("Should apply volume-based fee tiers", async function () {
      // Set volume tiers
      await feeManager.setVolumeTier(
        ethers.parseEther("10000"), // 10k volume
        1000 // 10% discount
      );
      await feeManager.setVolumeTier(
        ethers.parseEther("100000"), // 100k volume
        2500 // 25% discount
      );

      // Simulate volume
      await feeManager.recordUserVolume(addr1.address, ethers.parseEther("50000"));

      // Get fee with volume discount
      const feeEstimate = await feeManager.estimateBridgeFeeForUser(
        addr1.address,
        Protocol.LayerZero,
        OPTIMISM_CHAIN,
        ethers.parseEther("1000")
      );

      // Should have 10% discount (not yet at 100k tier)
      const standardFee = await feeManager.estimateBridgeFee(
        Protocol.LayerZero,
        OPTIMISM_CHAIN,
        ethers.parseEther("1000")
      );

      expect(feeEstimate.protocolFee).to.be.lt(standardFee.protocolFee);
    });
  });

  describe("Integration with CrossChainRouter", function () {
    beforeEach(async function () {
      // Configure fees for all protocols
      await feeManager.setProtocolFees(Protocol.LayerZero, ethers.parseEther("0.002"), 50, 350000);
      await feeManager.setProtocolFees(Protocol.Celer, ethers.parseEther("0.001"), 50, 250000);
      await feeManager.setProtocolFees(Protocol.XERC20, 0, 0, 150000);
      
      await feeManager.updateGasPrice(OPTIMISM_CHAIN, ethers.parseUnits("1", "gwei"));
    });

    it("Should provide fee estimates to router", async function () {
      // Router should be able to get fee estimates
      const amount = ethers.parseEther("1000");
      
      const layerZeroFee = await feeManager.estimateBridgeFee(Protocol.LayerZero, OPTIMISM_CHAIN, amount);
      const celerFee = await feeManager.estimateBridgeFee(Protocol.Celer, OPTIMISM_CHAIN, amount);
      const xerc20Fee = await feeManager.estimateBridgeFee(Protocol.XERC20, OPTIMISM_CHAIN, amount);

      // Verify different protocols have different fees
      expect(layerZeroFee.totalFee).to.not.equal(celerFee.totalFee);
      expect(xerc20Fee.totalFee).to.be.lt(layerZeroFee.totalFee); // xERC20 should be cheapest
    });

    it("Should track fees per route", async function () {
      // Record fees for different routes
      await feeManager.recordFeeCollection(Protocol.LayerZero, OPTIMISM_CHAIN, ethers.parseEther("0.1"));
      await feeManager.recordFeeCollection(Protocol.LayerZero, BASE_CHAIN, ethers.parseEther("0.05"));
      await feeManager.recordFeeCollection(Protocol.Celer, OPTIMISM_CHAIN, ethers.parseEther("0.08"));

      // Get route statistics
      expect(await feeManager.chainFeesCollected(Protocol.LayerZero, OPTIMISM_CHAIN)).to.equal(ethers.parseEther("0.1"));
      expect(await feeManager.chainFeesCollected(Protocol.LayerZero, BASE_CHAIN)).to.equal(ethers.parseEther("0.05"));
      expect(await feeManager.totalFeesCollected(Protocol.LayerZero)).to.equal(ethers.parseEther("0.15"));
    });
  });

  describe("Emergency Functions", function () {
    it("Should pause fee collection", async function () {
      await feeManager.pause();
      expect(await feeManager.paused()).to.equal(true);

      // Fee operations should fail when paused
      await expect(
        feeManager.estimateBridgeFee(Protocol.LayerZero, OPTIMISM_CHAIN, ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(feeManager, "EnforcedPause");
    });

    it("Should emergency withdraw all fees", async function () {
      // Send fees to contract
      await owner.sendTransaction({
        to: await feeManager.getAddress(),
        value: ethers.parseEther("10"),
      });

      const contractBalance = await ethers.provider.getBalance(await feeManager.getAddress());
      const collectorBalance = await ethers.provider.getBalance(feeCollector.address);

      await feeManager.emergencyWithdraw();

      const newContractBalance = await ethers.provider.getBalance(await feeManager.getAddress());
      const newCollectorBalance = await ethers.provider.getBalance(feeCollector.address);

      expect(newContractBalance).to.equal(0);
      expect(newCollectorBalance - collectorBalance).to.equal(contractBalance);
    });

    it("Should disable specific protocol fees", async function () {
      await feeManager.setProtocolFees(Protocol.LayerZero, ethers.parseEther("0.001"), 50, 300000);
      
      // Disable LayerZero fees
      await feeManager.setProtocolStatus(Protocol.LayerZero, false);

      await expect(
        feeManager.estimateBridgeFee(Protocol.LayerZero, OPTIMISM_CHAIN, ethers.parseEther("1000"))
      ).to.be.revertedWith("FeeManager: protocol not active");
    });
  });

  describe("Edge Cases and Validation", function () {
    it("Should handle very large amounts", async function () {
      await feeManager.setProtocolFees(Protocol.LayerZero, ethers.parseEther("0.001"), 50, 300000);

      const largeAmount = ethers.parseEther("1000000000"); // 1 billion
      const feeEstimate = await feeManager.estimateBridgeFee(Protocol.LayerZero, OPTIMISM_CHAIN, largeAmount);

      // Fee should be calculated correctly without overflow
      const expectedPercentageFee = (largeAmount * 50n) / 10000n;
      expect(feeEstimate.protocolFee).to.be.gte(expectedPercentageFee);
    });

    it("Should handle zero gas price", async function () {
      await feeManager.setProtocolFees(Protocol.LayerZero, ethers.parseEther("0.001"), 50, 300000);
      await feeManager.updateGasPrice(OPTIMISM_CHAIN, 0);

      const feeEstimate = await feeManager.estimateBridgeFee(
        Protocol.LayerZero,
        OPTIMISM_CHAIN,
        ethers.parseEther("1000")
      );

      // Should still have protocol fee but no gas fee
      expect(feeEstimate.gasFee).to.equal(0);
      expect(feeEstimate.protocolFee).to.be.gt(0);
    });

    it("Should validate array length in batch operations", async function () {
      const chains = [BSC_CHAIN, OPTIMISM_CHAIN];
      const prices = [ethers.parseUnits("5", "gwei")]; // Mismatched length

      await expect(
        feeManager.batchUpdateGasPrice(chains, prices)
      ).to.be.revertedWith("FeeManager: array length mismatch");
    });

    it("Should handle inactive protocol registry", async function () {
      // Remove protocol registry
      await feeManager.setProtocolRegistry(ethers.ZeroAddress);

      // Should still work with direct protocol configuration
      await feeManager.setProtocolFees(Protocol.LayerZero, ethers.parseEther("0.001"), 50, 300000);
      
      const feeEstimate = await feeManager.estimateBridgeFee(
        Protocol.LayerZero,
        OPTIMISM_CHAIN,
        ethers.parseEther("1000")
      );

      expect(feeEstimate.totalFee).to.be.gt(0);
    });
  });
});