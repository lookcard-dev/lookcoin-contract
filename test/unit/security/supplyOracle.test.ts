import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SupplyOracle } from "../../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("SupplyOracle - Comprehensive Security Tests", function () {
  let supplyOracle: SupplyOracle;
  let owner: SignerWithAddress;
  let oracle1: SignerWithAddress;
  let oracle2: SignerWithAddress;
  let oracle3: SignerWithAddress;
  let unauthorizedUser: SignerWithAddress;

  const TOTAL_SUPPLY = ethers.parseEther("1000000000"); // 1 billion
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  const ADMIN_ROLE = ethers.ZeroHash; // DEFAULT_ADMIN_ROLE
  
  // Testnet chain IDs
  const TESTNET_CHAINS = [97, 84532, 11155420, 23295, 9071];
  
  // Mainnet chain IDs  
  const MAINNET_CHAINS = [56, 8453, 10, 23295, 9070];

  beforeEach(async function () {
    [owner, oracle1, oracle2, oracle3, unauthorizedUser] = await ethers.getSigners();

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

    it("Should set correct default thresholds", async function () {
      expect(await supplyOracle.deviationThreshold()).to.equal(100); // 1% in basis points
      expect(await supplyOracle.requiredSignatures()).to.equal(1);
    });
  });

  describe("Multi-Signature Supply Updates", function () {
    beforeEach(async function () {
      // Set required signatures to 2
      await supplyOracle.updateRequiredSignatures(2);
      
      // Grant oracle role to multiple signers
      await supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      await supplyOracle.grantRole(ORACLE_ROLE, oracle2.address);
      await supplyOracle.grantRole(ORACLE_ROLE, oracle3.address);
    });

    it("Should update supply with multi-sig consensus", async function () {
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
      
      // Check pending update
      const pendingUpdate = await supplyOracle.pendingUpdates(chainId, nonce);
      expect(pendingUpdate.totalSupply).to.equal(totalSupply);
      expect(pendingUpdate.lockedSupply).to.equal(lockedSupply);
      expect(pendingUpdate.signatureCount).to.equal(1);
      
      // Second signature - should emit event and finalize
      await expect(
        supplyOracle.connect(oracle2).updateSupply(
          chainId,
          totalSupply,
          lockedSupply,
          nonce
        )
      ).to.emit(supplyOracle, "SupplyUpdated")
        .withArgs(chainId, totalSupply, lockedSupply, totalSupply - lockedSupply);
      
      // Verify chain supply was updated
      const chainSupply = await supplyOracle.getChainSupply(chainId);
      expect(chainSupply.totalSupply).to.equal(totalSupply);
      expect(chainSupply.lockedSupply).to.equal(lockedSupply);
    });

    it("Should prevent duplicate signatures", async function () {
      const chainId = 97;
      const totalSupply = ethers.parseEther("500000000");
      const lockedSupply = ethers.parseEther("100000000");
      const nonce = 1;
      
      // First signature
      await supplyOracle.connect(oracle1).updateSupply(
        chainId,
        totalSupply,
        lockedSupply,
        nonce
      );
      
      // Duplicate signature should revert
      await expect(
        supplyOracle.connect(oracle1).updateSupply(
          chainId,
          totalSupply,
          lockedSupply,
          nonce
        )
      ).to.be.revertedWith("SupplyOracle: already signed");
    });

    it("Should handle different update values from oracles", async function () {
      const chainId = 97;
      const nonce = 1;
      
      // Oracle 1 submits one set of values
      await supplyOracle.connect(oracle1).updateSupply(
        chainId,
        ethers.parseEther("500000000"),
        ethers.parseEther("100000000"),
        nonce
      );
      
      // Oracle 2 submits different values - should create new pending update
      await supplyOracle.connect(oracle2).updateSupply(
        chainId,
        ethers.parseEther("600000000"),
        ethers.parseEther("150000000"),
        nonce
      );
      
      // Check that neither update is finalized
      const chainSupply = await supplyOracle.getChainSupply(chainId);
      expect(chainSupply.totalSupply).to.equal(0); // Still zero
    });

    it("Should require exact threshold for finalization", async function () {
      // Update to require 3 signatures
      await supplyOracle.updateRequiredSignatures(3);
      
      const chainId = 97;
      const totalSupply = ethers.parseEther("500000000");
      const lockedSupply = ethers.parseEther("100000000");
      const nonce = 1;
      
      // First two signatures
      await supplyOracle.connect(oracle1).updateSupply(chainId, totalSupply, lockedSupply, nonce);
      await supplyOracle.connect(oracle2).updateSupply(chainId, totalSupply, lockedSupply, nonce);
      
      // Still pending
      const pendingUpdate = await supplyOracle.pendingUpdates(chainId, nonce);
      expect(pendingUpdate.signatureCount).to.equal(2);
      
      // Third signature finalizes
      await expect(
        supplyOracle.connect(oracle3).updateSupply(chainId, totalSupply, lockedSupply, nonce)
      ).to.emit(supplyOracle, "SupplyUpdated");
    });
  });

  describe("Deviation Detection", function () {
    beforeEach(async function () {
      await supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      
      // Set initial supply for all chains
      for (const chainId of TESTNET_CHAINS) {
        await supplyOracle.connect(oracle1).updateSupply(
          chainId,
          ethers.parseEther("200000000"), // 200M per chain
          0,
          1
        );
      }
    });

    it("Should detect supply deviation", async function () {
      // Update one chain with significant deviation
      const chainId = 97;
      const deviatedSupply = ethers.parseEther("250000000"); // 250M (25% increase)
      
      await expect(
        supplyOracle.connect(oracle1).updateSupply(chainId, deviatedSupply, 0, 2)
      ).to.emit(supplyOracle, "DeviationDetected")
        .withArgs(chainId, deviatedSupply, ethers.parseEther("200000000"));
      
      // Check deviation flag
      const globalSupply = await supplyOracle.getGlobalSupply();
      expect(globalSupply.hasDeviation).to.be.true;
    });

    it("Should calculate correct deviation percentage", async function () {
      const chainId = 97;
      const originalSupply = ethers.parseEther("200000000");
      const newSupply = ethers.parseEther("202000000"); // 1% increase
      
      // This should trigger deviation (threshold is 1%)
      await expect(
        supplyOracle.connect(oracle1).updateSupply(chainId, newSupply, 0, 2)
      ).to.emit(supplyOracle, "DeviationDetected");
    });

    it("Should not flag deviation within threshold", async function () {
      const chainId = 97;
      const originalSupply = ethers.parseEther("200000000");
      const newSupply = ethers.parseEther("201999999"); // Just under 1% increase
      
      // Should not trigger deviation
      await expect(
        supplyOracle.connect(oracle1).updateSupply(chainId, newSupply, 0, 2)
      ).to.not.emit(supplyOracle, "DeviationDetected");
    });

    it("Should update deviation threshold", async function () {
      // Increase threshold to 5%
      await supplyOracle.updateDeviationThreshold(500);
      
      const chainId = 97;
      const originalSupply = ethers.parseEther("200000000");
      const newSupply = ethers.parseEther("208000000"); // 4% increase
      
      // Should not trigger deviation with new threshold
      await expect(
        supplyOracle.connect(oracle1).updateSupply(chainId, newSupply, 0, 2)
      ).to.not.emit(supplyOracle, "DeviationDetected");
    });
  });

  describe("Supply Reconciliation", function () {
    beforeEach(async function () {
      await supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      
      // Set different supplies for chains
      await supplyOracle.connect(oracle1).updateSupply(97, ethers.parseEther("300000000"), 0, 1);
      await supplyOracle.connect(oracle1).updateSupply(84532, ethers.parseEther("200000000"), 0, 1);
      await supplyOracle.connect(oracle1).updateSupply(11155420, ethers.parseEther("150000000"), 0, 1);
      await supplyOracle.connect(oracle1).updateSupply(23295, ethers.parseEther("250000000"), 0, 1);
      await supplyOracle.connect(oracle1).updateSupply(9071, ethers.parseEther("100000000"), 0, 1);
    });

    it("Should calculate total actual supply correctly", async function () {
      const globalSupply = await supplyOracle.getGlobalSupply();
      expect(globalSupply.totalActualSupply).to.equal(ethers.parseEther("1000000000"));
      expect(globalSupply.hasDeviation).to.be.false; // Matches expected
    });

    it("Should provide per-chain supply data", async function () {
      const chainSupply = await supplyOracle.getChainSupply(97);
      expect(chainSupply.totalSupply).to.equal(ethers.parseEther("300000000"));
      expect(chainSupply.circulatingSupply).to.equal(ethers.parseEther("300000000"));
      expect(chainSupply.lastUpdate).to.be.gt(0);
    });

    it("Should reconcile supply manually", async function () {
      // Create a deviation first
      await supplyOracle.connect(oracle1).updateSupply(
        97,
        ethers.parseEther("350000000"), // Increase BSC supply
        0,
        2
      );
      
      const globalSupplyBefore = await supplyOracle.getGlobalSupply();
      expect(globalSupplyBefore.hasDeviation).to.be.true;
      
      // Admin reconciles
      await expect(
        supplyOracle.reconcileSupply()
      ).to.emit(supplyOracle, "SupplyReconciled")
        .withArgs(ethers.parseEther("1050000000"), ethers.parseEther("1000000000"));
      
      const globalSupplyAfter = await supplyOracle.getGlobalSupply();
      expect(globalSupplyAfter.hasDeviation).to.be.false;
    });
  });

  describe("Chain Management", function () {
    it("Should add new supported chain", async function () {
      const newChainId = 42161; // Arbitrum
      
      await expect(
        supplyOracle.addSupportedChain(newChainId)
      ).to.emit(supplyOracle, "ChainAdded")
        .withArgs(newChainId);
      
      const supportedChains = await supplyOracle.getSupportedChains();
      expect(supportedChains).to.include(newChainId);
    });

    it("Should prevent duplicate chain addition", async function () {
      await expect(
        supplyOracle.addSupportedChain(97) // Already exists
      ).to.be.revertedWith("SupplyOracle: chain already supported");
    });

    it("Should remove supported chain", async function () {
      const chainToRemove = 9071;
      
      await expect(
        supplyOracle.removeSupportedChain(chainToRemove)
      ).to.emit(supplyOracle, "ChainRemoved")
        .withArgs(chainToRemove);
      
      const supportedChains = await supplyOracle.getSupportedChains();
      expect(supportedChains).to.not.include(chainToRemove);
    });

    it("Should handle supply updates for removed chains", async function () {
      await supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      
      // Remove a chain
      await supplyOracle.removeSupportedChain(9071);
      
      // Try to update removed chain
      await expect(
        supplyOracle.connect(oracle1).updateSupply(9071, ethers.parseEther("100000000"), 0, 1)
      ).to.be.revertedWith("SupplyOracle: chain not supported");
    });
  });

  describe("Access Control", function () {
    it("Should enforce ORACLE_ROLE for supply updates", async function () {
      await expect(
        supplyOracle.connect(unauthorizedUser).updateSupply(97, ethers.parseEther("100000000"), 0, 1)
      ).to.be.revertedWithCustomError(supplyOracle, "AccessControlUnauthorizedAccount");
    });

    it("Should enforce ADMIN_ROLE for configuration", async function () {
      await expect(
        supplyOracle.connect(unauthorizedUser).updateDeviationThreshold(200)
      ).to.be.revertedWithCustomError(supplyOracle, "AccessControlUnauthorizedAccount");
      
      await expect(
        supplyOracle.connect(unauthorizedUser).updateRequiredSignatures(3)
      ).to.be.revertedWithCustomError(supplyOracle, "AccessControlUnauthorizedAccount");
    });

    it("Should allow role management", async function () {
      // Grant oracle role
      await supplyOracle.grantRole(ORACLE_ROLE, unauthorizedUser.address);
      
      // Now should work
      await expect(
        supplyOracle.connect(unauthorizedUser).updateSupply(97, ethers.parseEther("100000000"), 0, 1)
      ).to.not.be.reverted;
      
      // Revoke role
      await supplyOracle.revokeRole(ORACLE_ROLE, unauthorizedUser.address);
      
      // Should fail again
      await expect(
        supplyOracle.connect(unauthorizedUser).updateSupply(97, ethers.parseEther("100000000"), 0, 2)
      ).to.be.revertedWithCustomError(supplyOracle, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Emergency Functions", function () {
    it("Should pause oracle operations", async function () {
      await supplyOracle.pause();
      
      await supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      
      await expect(
        supplyOracle.connect(oracle1).updateSupply(97, ethers.parseEther("100000000"), 0, 1)
      ).to.be.revertedWithCustomError(supplyOracle, "EnforcedPause");
    });

    it("Should unpause oracle operations", async function () {
      await supplyOracle.pause();
      await supplyOracle.unpause();
      
      await supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      
      await expect(
        supplyOracle.connect(oracle1).updateSupply(97, ethers.parseEther("100000000"), 0, 1)
      ).to.not.be.reverted;
    });

    it("Should force reconciliation in emergency", async function () {
      await supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      
      // Create large deviation
      await supplyOracle.connect(oracle1).updateSupply(
        97,
        ethers.parseEther("500000000"), // 5x expected for one chain
        0,
        1
      );
      
      const globalSupply = await supplyOracle.getGlobalSupply();
      expect(globalSupply.hasDeviation).to.be.true;
      
      // Force reconciliation
      await supplyOracle.reconcileSupply();
      
      const reconciledSupply = await supplyOracle.getGlobalSupply();
      expect(reconciledSupply.hasDeviation).to.be.false;
    });
  });

  describe("Historical Data", function () {
    beforeEach(async function () {
      await supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
    });

    it("Should track update timestamps", async function () {
      const chainId = 97;
      
      const beforeUpdate = await time.latest();
      
      await supplyOracle.connect(oracle1).updateSupply(
        chainId,
        ethers.parseEther("100000000"),
        0,
        1
      );
      
      const chainSupply = await supplyOracle.getChainSupply(chainId);
      expect(chainSupply.lastUpdate).to.be.gte(beforeUpdate);
    });

    it("Should track nonce progression", async function () {
      const chainId = 97;
      
      // Update with nonce 1
      await supplyOracle.connect(oracle1).updateSupply(
        chainId,
        ethers.parseEther("100000000"),
        0,
        1
      );
      
      // Update with nonce 2
      await supplyOracle.connect(oracle1).updateSupply(
        chainId,
        ethers.parseEther("110000000"),
        0,
        2
      );
      
      // Cannot reuse old nonce
      await expect(
        supplyOracle.connect(oracle1).updateSupply(
          chainId,
          ethers.parseEther("120000000"),
          0,
          1
        )
      ).to.be.revertedWith("SupplyOracle: nonce already used");
    });
  });

  describe("Integration Scenarios", function () {
    it("Should handle multi-chain bridge scenario", async function () {
      await supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      await supplyOracle.grantRole(ORACLE_ROLE, oracle2.address);
      await supplyOracle.updateRequiredSignatures(2);
      
      // Initial state: 200M on each chain
      for (const [index, chainId] of TESTNET_CHAINS.entries()) {
        await supplyOracle.connect(oracle1).updateSupply(chainId, ethers.parseEther("200000000"), 0, 1);
        await supplyOracle.connect(oracle2).updateSupply(chainId, ethers.parseEther("200000000"), 0, 1);
      }
      
      // Simulate bridge: 50M from BSC to Base
      const bscChain = 97;
      const baseChain = 84532;
      const bridgeAmount = ethers.parseEther("50000000");
      
      // Update BSC (decrease)
      await supplyOracle.connect(oracle1).updateSupply(
        bscChain,
        ethers.parseEther("150000000"),
        0,
        2
      );
      await supplyOracle.connect(oracle2).updateSupply(
        bscChain,
        ethers.parseEther("150000000"),
        0,
        2
      );
      
      // Update Base (increase)
      await supplyOracle.connect(oracle1).updateSupply(
        baseChain,
        ethers.parseEther("250000000"),
        0,
        2
      );
      await supplyOracle.connect(oracle2).updateSupply(
        baseChain,
        ethers.parseEther("250000000"),
        0,
        2
      );
      
      // Total supply should remain constant
      const globalSupply = await supplyOracle.getGlobalSupply();
      expect(globalSupply.totalActualSupply).to.equal(TOTAL_SUPPLY);
      expect(globalSupply.hasDeviation).to.be.false;
    });

    it("Should detect cross-chain discrepancies", async function () {
      await supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      
      // Set initial supplies
      for (const chainId of TESTNET_CHAINS) {
        await supplyOracle.connect(oracle1).updateSupply(
          chainId,
          ethers.parseEther("200000000"),
          0,
          1
        );
      }
      
      // Simulate discrepancy: tokens created on one chain without burning on another
      await supplyOracle.connect(oracle1).updateSupply(
        97,
        ethers.parseEther("250000000"), // 50M extra
        0,
        2
      );
      
      // Should detect deviation
      const globalSupply = await supplyOracle.getGlobalSupply();
      expect(globalSupply.totalActualSupply).to.equal(ethers.parseEther("1050000000"));
      expect(globalSupply.hasDeviation).to.be.true;
    });
  });

  describe("Edge Cases", function () {
    it("Should handle maximum supply values", async function () {
      await supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      
      const maxSupply = ethers.MaxUint256;
      
      await expect(
        supplyOracle.connect(oracle1).updateSupply(97, maxSupply, 0, 1)
      ).to.not.be.reverted;
      
      const chainSupply = await supplyOracle.getChainSupply(97);
      expect(chainSupply.totalSupply).to.equal(maxSupply);
    });

    it("Should handle all chains having zero supply", async function () {
      await supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      
      // Set all chains to zero
      for (const chainId of TESTNET_CHAINS) {
        await supplyOracle.connect(oracle1).updateSupply(chainId, 0, 0, 1);
      }
      
      const globalSupply = await supplyOracle.getGlobalSupply();
      expect(globalSupply.totalActualSupply).to.equal(0);
      expect(globalSupply.hasDeviation).to.be.true; // Expected 1B, got 0
    });

    it("Should handle locked supply greater than total", async function () {
      await supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      
      const totalSupply = ethers.parseEther("100000000");
      const lockedSupply = ethers.parseEther("150000000"); // More than total
      
      // Should revert
      await expect(
        supplyOracle.connect(oracle1).updateSupply(97, totalSupply, lockedSupply, 1)
      ).to.be.revertedWith("SupplyOracle: locked exceeds total");
    });
  });
});