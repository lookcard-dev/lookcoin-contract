import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { SupplyOracle } from "../../../typechain-types";
import { TOTAL_SUPPLY } from "../../../hardhat.config";

describe("SupplyOracle - Bridge Registration", function () {
  let supplyOracle: SupplyOracle;
  let admin: SignerWithAddress;
  let bridge1: SignerWithAddress;
  let bridge2: SignerWithAddress;
  
  const supportedChains = [56, 8453, 10]; // BSC, Base, Optimism
  const chainId = 56; // BSC

  beforeEach(async function () {
    [admin, bridge1, bridge2] = await ethers.getSigners();

    const SupplyOracle = await ethers.getContractFactory("SupplyOracle");
    supplyOracle = await upgrades.deployProxy(
      SupplyOracle,
      [admin.address, TOTAL_SUPPLY, supportedChains],
      { initializer: "initialize" }
    ) as unknown as SupplyOracle;
    await supplyOracle.waitForDeployment();
  });

  describe("registerBridge", function () {
    it("Should register a new bridge", async function () {
      // Register bridge
      await expect(supplyOracle.connect(admin).registerBridge(chainId, bridge1.address))
        .to.not.be.reverted;

      // Check if registered
      expect(await supplyOracle.isBridgeRegistered(chainId, bridge1.address)).to.be.true;
    });

    it("Should reject duplicate bridge registration", async function () {
      // Register bridge first time
      await supplyOracle.connect(admin).registerBridge(chainId, bridge1.address);

      // Try to register same bridge again
      await expect(
        supplyOracle.connect(admin).registerBridge(chainId, bridge1.address)
      ).to.be.revertedWith("SupplyOracle: bridge already registered");
    });

    it("Should allow different bridges for same chain", async function () {
      // Register first bridge
      await supplyOracle.connect(admin).registerBridge(chainId, bridge1.address);
      
      // Register second bridge for same chain
      await expect(supplyOracle.connect(admin).registerBridge(chainId, bridge2.address))
        .to.not.be.reverted;

      // Both should be registered
      expect(await supplyOracle.isBridgeRegistered(chainId, bridge1.address)).to.be.true;
      expect(await supplyOracle.isBridgeRegistered(chainId, bridge2.address)).to.be.true;
    });

    it("Should allow same bridge for different chains", async function () {
      const chainId2 = 8453; // Base
      
      // Register bridge for first chain
      await supplyOracle.connect(admin).registerBridge(chainId, bridge1.address);
      
      // Register same bridge for different chain
      await expect(supplyOracle.connect(admin).registerBridge(chainId2, bridge1.address))
        .to.not.be.reverted;

      // Should be registered for both chains
      expect(await supplyOracle.isBridgeRegistered(chainId, bridge1.address)).to.be.true;
      expect(await supplyOracle.isBridgeRegistered(chainId2, bridge1.address)).to.be.true;
    });
  });

  describe("isBridgeRegistered", function () {
    it("Should return false for unregistered bridge", async function () {
      expect(await supplyOracle.isBridgeRegistered(chainId, bridge1.address)).to.be.false;
    });

    it("Should return true for registered bridge", async function () {
      await supplyOracle.connect(admin).registerBridge(chainId, bridge1.address);
      expect(await supplyOracle.isBridgeRegistered(chainId, bridge1.address)).to.be.true;
    });

    it("Should return false for wrong chain", async function () {
      const chainId2 = 8453; // Base
      
      // Register for chainId
      await supplyOracle.connect(admin).registerBridge(chainId, bridge1.address);
      
      // Check for chainId2
      expect(await supplyOracle.isBridgeRegistered(chainId2, bridge1.address)).to.be.false;
    });
  });

  describe("Setup script scenario", function () {
    it("Should handle idempotent registration like setup script", async function () {
      // Simulate setup script's registerBridgeIfNeeded
      async function registerBridgeIfNeeded(chainId: number, bridgeAddress: string) {
        const isRegistered = await supplyOracle.isBridgeRegistered(chainId, bridgeAddress);
        
        if (!isRegistered) {
          await supplyOracle.connect(admin).registerBridge(chainId, bridgeAddress);
          return "registered";
        }
        return "already registered";
      }

      // First run
      let result = await registerBridgeIfNeeded(chainId, bridge1.address);
      expect(result).to.equal("registered");

      // Second run (should be idempotent)
      result = await registerBridgeIfNeeded(chainId, bridge1.address);
      expect(result).to.equal("already registered");

      // Verify only registered once
      const bridges = await supplyOracle.bridgeContracts(chainId, 0);
      expect(bridges).to.equal(bridge1.address);
      
      // Should revert if trying to access second element (only one registered)
      await expect(supplyOracle.bridgeContracts(chainId, 1)).to.be.reverted;
    });
  });
});