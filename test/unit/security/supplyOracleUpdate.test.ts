import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { SupplyOracle } from "../../../typechain-types";
import { TOTAL_SUPPLY } from "../../../hardhat.config";

describe("SupplyOracle - Expected Supply Update", function () {
  let supplyOracle: SupplyOracle;
  let admin: SignerWithAddress;
  let nonAdmin: SignerWithAddress;
  
  const INITIAL_SUPPLY = ethers.parseEther("1000000000"); // 1 billion (for testing)
  const NEW_SUPPLY = BigInt(TOTAL_SUPPLY); // Total supply from config
  const supportedChains = [56, 8453, 10]; // BSC, Base, Optimism

  beforeEach(async function () {
    [admin, nonAdmin] = await ethers.getSigners();

    const SupplyOracle = await ethers.getContractFactory("SupplyOracle");
    supplyOracle = await upgrades.deployProxy(
      SupplyOracle,
      [admin.address, INITIAL_SUPPLY, supportedChains],
      { initializer: "initialize" }
    ) as unknown as SupplyOracle;
    await supplyOracle.waitForDeployment();
  });

  describe("updateExpectedSupply", function () {
    it("Should allow admin to update expected supply", async function () {
      // Check initial supply
      expect(await supplyOracle.totalExpectedSupply()).to.equal(INITIAL_SUPPLY);

      // Update supply
      await expect(supplyOracle.connect(admin).updateExpectedSupply(NEW_SUPPLY))
        .to.emit(supplyOracle, "ExpectedSupplyUpdated")
        .withArgs(INITIAL_SUPPLY, NEW_SUPPLY);

      // Verify update
      expect(await supplyOracle.totalExpectedSupply()).to.equal(NEW_SUPPLY);
    });

    it("Should reject update from non-admin", async function () {
      await expect(
        supplyOracle.connect(nonAdmin).updateExpectedSupply(NEW_SUPPLY)
      ).to.be.revertedWithCustomError(supplyOracle, "AccessControlUnauthorizedAccount");
    });

    it("Should reject zero supply", async function () {
      await expect(
        supplyOracle.connect(admin).updateExpectedSupply(0)
      ).to.be.revertedWith("SupplyOracle: invalid supply");
    });

    it("Should work correctly with setup script scenario", async function () {
      // Simulate setup script checking and updating supply
      const currentSupply = await supplyOracle.totalExpectedSupply();
      const CONFIGURED_SUPPLY = BigInt(TOTAL_SUPPLY);
      
      if (currentSupply !== CONFIGURED_SUPPLY) {
        // Update to configured supply
        await supplyOracle.connect(admin).updateExpectedSupply(CONFIGURED_SUPPLY);
      }
      
      // Verify it matches config
      expect(await supplyOracle.totalExpectedSupply()).to.equal(CONFIGURED_SUPPLY);
    });
  });
});