import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SupplyOracle } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("SupplyOracle", function () {
  let supplyOracle: SupplyOracle;
  let owner: SignerWithAddress;
  let oracle1: SignerWithAddress;
  let oracle2: SignerWithAddress;

  const TOTAL_SUPPLY = ethers.parseEther("1000000000"); // 1 billion
  
  // Testnet chain IDs
  const TESTNET_CHAINS = [97, 84532, 11155420, 23295, 9071];
  
  // Mainnet chain IDs  
  const MAINNET_CHAINS = [56, 8453, 10, 23295, 9070];

  beforeEach(async function () {
    [owner, oracle1, oracle2] = await ethers.getSigners();

    const SupplyOracle = await ethers.getContractFactory("SupplyOracle");
    supplyOracle = await upgrades.deployProxy(
      SupplyOracle,
      [owner.address, TOTAL_SUPPLY, TESTNET_CHAINS],
      { kind: "uups" }
    ) as unknown as SupplyOracle;
    await supplyOracle.waitForDeployment();
  });

  describe("Initialization", function () {
    it("Should initialize with correct chain IDs", async function () {
      const supportedChains = await supplyOracle.getSupportedChains();
      expect(supportedChains.length).to.equal(TESTNET_CHAINS.length);
      
      for (let i = 0; i < TESTNET_CHAINS.length; i++) {
        expect(supportedChains[i]).to.equal(TESTNET_CHAINS[i]);
      }
    });

    it("Should set correct total expected supply", async function () {
      const globalSupply = await supplyOracle.getGlobalSupply();
      expect(globalSupply.expectedSupply).to.equal(TOTAL_SUPPLY);
    });

    it("Should reject empty chain array", async function () {
      const SupplyOracle = await ethers.getContractFactory("SupplyOracle");
      await expect(
        upgrades.deployProxy(
          SupplyOracle,
          [owner.address, TOTAL_SUPPLY, []],
          { kind: "uups" }
        )
      ).to.be.revertedWith("SupplyOracle: no chains provided");
    });

    it("Should reject duplicate chain IDs", async function () {
      const SupplyOracle = await ethers.getContractFactory("SupplyOracle");
      const duplicateChains = [97, 84532, 97]; // BSC testnet appears twice
      
      await expect(
        upgrades.deployProxy(
          SupplyOracle,
          [owner.address, TOTAL_SUPPLY, duplicateChains],
          { kind: "uups" }
        )
      ).to.be.revertedWith("SupplyOracle: duplicate chain ID");
    });

    it("Should work with mainnet chain IDs", async function () {
      const SupplyOracle = await ethers.getContractFactory("SupplyOracle");
      const mainnetOracle = await upgrades.deployProxy(
        SupplyOracle,
        [owner.address, TOTAL_SUPPLY, MAINNET_CHAINS],
        { kind: "uups" }
      ) as unknown as SupplyOracle;
      await mainnetOracle.waitForDeployment();
      
      const supportedChains = await mainnetOracle.getSupportedChains();
      expect(supportedChains.length).to.equal(MAINNET_CHAINS.length);
      
      for (let i = 0; i < MAINNET_CHAINS.length; i++) {
        expect(supportedChains[i]).to.equal(MAINNET_CHAINS[i]);
      }
    });
  });

  describe("Supply Updates", function () {
    it("Should update supply for supported chains with multi-sig", async function () {
      // Set required signatures to 2 for testing
      await supplyOracle.updateRequiredSignatures(2);
      
      // Grant oracle role to multiple signers
      await supplyOracle.grantRole(await supplyOracle.ORACLE_ROLE(), oracle1.address);
      await supplyOracle.grantRole(await supplyOracle.ORACLE_ROLE(), oracle2.address);
      
      // Update supply for BSC testnet (chain ID 97)
      const chainId = 97;
      const totalSupply = ethers.parseEther("500000000");
      const lockedSupply = ethers.parseEther("100000000");
      const nonce = 1;
      
      // First signature - should not emit event yet
      await supplyOracle.connect(oracle1).updateSupply(
        chainId,
        totalSupply,
        lockedSupply,
        nonce
      );
      
      // Second signature - should emit event
      await expect(
        supplyOracle.connect(oracle2).updateSupply(
          chainId,
          totalSupply,
          lockedSupply,
          nonce
        )
      ).to.emit(supplyOracle, "SupplyUpdated")
        .withArgs(chainId, totalSupply, lockedSupply, totalSupply - lockedSupply);
    });
  });
});