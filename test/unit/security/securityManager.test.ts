import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SecurityManager, LookCoin, CrossChainRouter } from "../../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("SecurityManager - Comprehensive Security Tests", function () {
  let securityManager: SecurityManager;
  let lookCoin: LookCoin;
  let crossChainRouter: CrossChainRouter;
  let owner: SignerWithAddress;
  let securityAdmin: SignerWithAddress;
  let operator: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let unauthorizedUser: SignerWithAddress;

  const SECURITY_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SECURITY_ADMIN_ROLE"));
  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  const EMERGENCY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE"));
  
  const DAILY_LIMIT = ethers.parseEther("20000000"); // 20M tokens
  const CHAIN_BSC = 56;
  const CHAIN_OPTIMISM = 10;
  const CHAIN_BASE = 8453;

  beforeEach(async function () {
    [owner, securityAdmin, operator, user1, user2, unauthorizedUser] = await ethers.getSigners();

    // Deploy SecurityManager
    const SecurityManager = await ethers.getContractFactory("SecurityManager");
    securityManager = await upgrades.deployProxy(
      SecurityManager,
      [owner.address, DAILY_LIMIT],
      { kind: "uups" }
    ) as unknown as SecurityManager;
    await securityManager.waitForDeployment();

    // Grant roles
    await securityManager.grantRole(SECURITY_ADMIN_ROLE, securityAdmin.address);
    await securityManager.grantRole(OPERATOR_ROLE, operator.address);
    await securityManager.grantRole(EMERGENCY_ROLE, owner.address);

    // Deploy LookCoin for integration tests
    const LookCoin = await ethers.getContractFactory("LookCoin");
    lookCoin = await upgrades.deployProxy(
      LookCoin,
      [owner.address, ethers.ZeroAddress],
      { kind: "uups" }
    ) as unknown as LookCoin;
    await lookCoin.waitForDeployment();

    // Deploy CrossChainRouter
    const FeeManager = await ethers.getContractFactory("FeeManager");
    const feeManager = await upgrades.deployProxy(
      FeeManager,
      [owner.address],
      { kind: "uups" }
    );
    await feeManager.waitForDeployment();

    const CrossChainRouter = await ethers.getContractFactory("CrossChainRouter");
    crossChainRouter = await upgrades.deployProxy(
      CrossChainRouter,
      [
        await lookCoin.getAddress(),
        await feeManager.getAddress(),
        await securityManager.getAddress(),
        owner.address,
      ],
      { kind: "uups" }
    ) as unknown as CrossChainRouter;
    await crossChainRouter.waitForDeployment();

    // Set router in security manager
    await securityManager.connect(securityAdmin).setRouter(await crossChainRouter.getAddress());
  });

  describe("Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await securityManager.globalDailyLimit()).to.equal(DAILY_LIMIT);
      expect(await securityManager.hasRole(SECURITY_ADMIN_ROLE, securityAdmin.address)).to.be.true;
      expect(await securityManager.hasRole(OPERATOR_ROLE, operator.address)).to.be.true;
    });

    it("Should have router configured", async function () {
      expect(await securityManager.router()).to.equal(await crossChainRouter.getAddress());
    });
  });

  describe("Global Daily Limit", function () {
    it("Should validate transfer within daily limit", async function () {
      const amount = ethers.parseEther("1000000"); // 1M tokens
      
      const isValid = await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        amount
      );
      
      expect(isValid).to.be.true;
    });

    it("Should reject transfer exceeding daily limit", async function () {
      const amount = ethers.parseEther("25000000"); // 25M tokens (exceeds 20M limit)
      
      await expect(
        securityManager.validateTransfer(user1.address, CHAIN_BSC, amount)
      ).to.be.revertedWith("SecurityManager: exceeds global daily limit");
    });

    it("Should track cumulative transfers", async function () {
      // First transfer: 10M
      await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("10000000")
      );
      
      // Second transfer: 8M (total 18M, still within limit)
      const isValid = await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("8000000")
      );
      expect(isValid).to.be.true;
      
      // Third transfer: 5M (would exceed 20M limit)
      await expect(
        securityManager.validateTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("5000000")
        )
      ).to.be.revertedWith("SecurityManager: exceeds global daily limit");
    });

    it("Should reset daily limit after 24 hours", async function () {
      // Max out daily limit
      await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("20000000")
      );
      
      // Next transfer should fail
      await expect(
        securityManager.validateTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("1000000")
        )
      ).to.be.revertedWith("SecurityManager: exceeds global daily limit");
      
      // Fast forward 24 hours
      await time.increase(24 * 60 * 60);
      
      // Should work now
      const isValid = await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("1000000")
      );
      expect(isValid).to.be.true;
    });

    it("Should update global daily limit", async function () {
      const newLimit = ethers.parseEther("50000000"); // 50M
      
      await expect(
        securityManager.connect(securityAdmin).updateGlobalDailyLimit(newLimit)
      ).to.emit(securityManager, "GlobalDailyLimitUpdated")
        .withArgs(newLimit);
      
      // Should now allow larger transfer
      const isValid = await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("30000000")
      );
      expect(isValid).to.be.true;
    });
  });

  describe("Chain-Specific Limits", function () {
    beforeEach(async function () {
      // Set chain-specific limits
      await securityManager.connect(securityAdmin).updateChainDailyLimit(
        CHAIN_BSC,
        ethers.parseEther("10000000") // 10M for BSC
      );
      await securityManager.connect(securityAdmin).updateChainDailyLimit(
        CHAIN_OPTIMISM,
        ethers.parseEther("5000000") // 5M for Optimism
      );
    });

    it("Should enforce chain-specific limits", async function () {
      // BSC: should allow 8M (under 10M limit)
      const isValidBSC = await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("8000000")
      );
      expect(isValidBSC).to.be.true;
      
      // BSC: should reject 12M (exceeds 10M limit)
      await expect(
        securityManager.validateTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("12000000")
        )
      ).to.be.revertedWith("SecurityManager: exceeds chain daily limit");
      
      // Optimism: should allow 4M (under 5M limit)
      const isValidOP = await securityManager.validateTransfer(
        user1.address,
        CHAIN_OPTIMISM,
        ethers.parseEther("4000000")
      );
      expect(isValidOP).to.be.true;
    });

    it("Should track chain limits independently", async function () {
      // Max out BSC limit
      await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("10000000")
      );
      
      // Should still allow Optimism transfers
      const isValid = await securityManager.validateTransfer(
        user1.address,
        CHAIN_OPTIMISM,
        ethers.parseEther("4000000")
      );
      expect(isValid).to.be.true;
    });

    it("Should enforce both global and chain limits", async function () {
      // Remove BSC chain limit
      await securityManager.connect(securityAdmin).updateChainDailyLimit(CHAIN_BSC, 0);
      
      // Transfer that passes chain check but fails global
      await expect(
        securityManager.validateTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("25000000") // Exceeds global 20M
        )
      ).to.be.revertedWith("SecurityManager: exceeds global daily limit");
    });
  });

  describe("User-Specific Limits", function () {
    beforeEach(async function () {
      // Set user-specific limits
      await securityManager.connect(securityAdmin).updateUserDailyLimit(
        user1.address,
        ethers.parseEther("1000000") // 1M for user1
      );
      await securityManager.connect(securityAdmin).updateUserDailyLimit(
        user2.address,
        ethers.parseEther("500000") // 500K for user2
      );
    });

    it("Should enforce user-specific limits", async function () {
      // User1: should allow 800K (under 1M limit)
      const isValidUser1 = await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("800000")
      );
      expect(isValidUser1).to.be.true;
      
      // User1: should reject 1.5M (exceeds 1M limit)
      await expect(
        securityManager.validateTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("1500000")
        )
      ).to.be.revertedWith("SecurityManager: exceeds user daily limit");
      
      // User2: should allow 400K (under 500K limit)
      const isValidUser2 = await securityManager.validateTransfer(
        user2.address,
        CHAIN_BSC,
        ethers.parseEther("400000")
      );
      expect(isValidUser2).to.be.true;
    });

    it("Should track user limits across chains", async function () {
      // User1 transfers on BSC
      await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("600000")
      );
      
      // User1 transfers on Optimism (should count toward same user limit)
      await expect(
        securityManager.validateTransfer(
          user1.address,
          CHAIN_OPTIMISM,
          ethers.parseEther("500000") // Total would be 1.1M
        )
      ).to.be.revertedWith("SecurityManager: exceeds user daily limit");
    });

    it("Should allow removing user limit", async function () {
      // Remove user1's limit
      await securityManager.connect(securityAdmin).updateUserDailyLimit(user1.address, 0);
      
      // Should now only be constrained by global/chain limits
      const isValid = await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("5000000")
      );
      expect(isValid).to.be.true;
    });
  });

  describe("Whitelist and Blacklist", function () {
    it("Should whitelist addresses to bypass limits", async function () {
      // Whitelist user1
      await securityManager.connect(operator).updateWhitelist(user1.address, true);
      
      // Should allow transfer exceeding all limits
      const isValid = await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("100000000") // 100M
      );
      expect(isValid).to.be.true;
    });

    it("Should blacklist addresses to block all transfers", async function () {
      // Blacklist user1
      await securityManager.connect(operator).updateBlacklist(user1.address, true);
      
      // Should reject any transfer
      await expect(
        securityManager.validateTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("1") // Even 1 token
        )
      ).to.be.revertedWith("SecurityManager: address blacklisted");
    });

    it("Should handle whitelist/blacklist removal", async function () {
      // Add to blacklist
      await securityManager.connect(operator).updateBlacklist(user1.address, true);
      
      // Remove from blacklist
      await securityManager.connect(operator).updateBlacklist(user1.address, false);
      
      // Should work now
      const isValid = await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("1000000")
      );
      expect(isValid).to.be.true;
    });

    it("Should emit events for list updates", async function () {
      await expect(
        securityManager.connect(operator).updateWhitelist(user1.address, true)
      ).to.emit(securityManager, "WhitelistUpdated")
        .withArgs(user1.address, true);
      
      await expect(
        securityManager.connect(operator).updateBlacklist(user2.address, true)
      ).to.emit(securityManager, "BlacklistUpdated")
        .withArgs(user2.address, true);
    });
  });

  describe("Transfer History and Analytics", function () {
    it("Should record transfer history", async function () {
      const amount = ethers.parseEther("1000000");
      
      await securityManager.validateTransfer(user1.address, CHAIN_BSC, amount);
      await securityManager.recordTransfer(user1.address, CHAIN_BSC, amount);
      
      const userStats = await securityManager.getUserTransferStats(user1.address);
      expect(userStats.dailyVolume).to.equal(amount);
      expect(userStats.transferCount).to.equal(1);
    });

    it("Should track chain-specific volumes", async function () {
      await securityManager.validateTransfer(user1.address, CHAIN_BSC, ethers.parseEther("1000000"));
      await securityManager.recordTransfer(user1.address, CHAIN_BSC, ethers.parseEther("1000000"));
      
      await securityManager.validateTransfer(user1.address, CHAIN_OPTIMISM, ethers.parseEther("500000"));
      await securityManager.recordTransfer(user1.address, CHAIN_OPTIMISM, ethers.parseEther("500000"));
      
      const bscVolume = await securityManager.getChainDailyVolume(CHAIN_BSC);
      expect(bscVolume).to.equal(ethers.parseEther("1000000"));
      
      const opVolume = await securityManager.getChainDailyVolume(CHAIN_OPTIMISM);
      expect(opVolume).to.equal(ethers.parseEther("500000"));
    });

    it("Should provide global statistics", async function () {
      // Multiple transfers
      await securityManager.validateTransfer(user1.address, CHAIN_BSC, ethers.parseEther("1000000"));
      await securityManager.recordTransfer(user1.address, CHAIN_BSC, ethers.parseEther("1000000"));
      
      await securityManager.validateTransfer(user2.address, CHAIN_BSC, ethers.parseEther("2000000"));
      await securityManager.recordTransfer(user2.address, CHAIN_BSC, ethers.parseEther("2000000"));
      
      await securityManager.validateTransfer(user1.address, CHAIN_OPTIMISM, ethers.parseEther("500000"));
      await securityManager.recordTransfer(user1.address, CHAIN_OPTIMISM, ethers.parseEther("500000"));
      
      const globalStats = await securityManager.getGlobalDailyStats();
      expect(globalStats.totalVolume).to.equal(ethers.parseEther("3500000"));
      expect(globalStats.transferCount).to.equal(3);
    });
  });

  describe("Suspicious Activity Detection", function () {
    it("Should detect rapid consecutive transfers", async function () {
      // Set threshold for suspicious activity
      await securityManager.connect(securityAdmin).setSuspiciousActivityThreshold(
        3, // 3 transfers
        300 // 5 minutes
      );
      
      // Make rapid transfers
      for (let i = 0; i < 2; i++) {
        await securityManager.validateTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("100000")
        );
        await securityManager.recordTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("100000")
        );
      }
      
      // Third transfer should trigger suspicious activity
      await expect(
        securityManager.validateTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("100000")
        )
      ).to.emit(securityManager, "SuspiciousActivityDetected")
        .withArgs(user1.address, "rapid_transfers");
    });

    it("Should detect unusual amount patterns", async function () {
      // Normal transfers
      for (let i = 0; i < 5; i++) {
        await securityManager.validateTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("100000")
        );
        await securityManager.recordTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("100000")
        );
        await time.increase(3600); // 1 hour between transfers
      }
      
      // Sudden large transfer (10x normal)
      await expect(
        securityManager.validateTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("10000000")
        )
      ).to.emit(securityManager, "SuspiciousActivityDetected")
        .withArgs(user1.address, "unusual_amount");
    });

    it("Should auto-blacklist after suspicious activity", async function () {
      // Enable auto-blacklist
      await securityManager.connect(securityAdmin).setAutoBlacklistEnabled(true);
      
      // Trigger suspicious activity
      await securityManager.connect(securityAdmin).setSuspiciousActivityThreshold(2, 300);
      
      await securityManager.validateTransfer(user1.address, CHAIN_BSC, ethers.parseEther("100000"));
      await securityManager.recordTransfer(user1.address, CHAIN_BSC, ethers.parseEther("100000"));
      
      // This should trigger auto-blacklist
      await securityManager.validateTransfer(user1.address, CHAIN_BSC, ethers.parseEther("100000"));
      
      // Next transfer should fail
      await expect(
        securityManager.validateTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("100000")
        )
      ).to.be.revertedWith("SecurityManager: address blacklisted");
    });
  });

  describe("Emergency Functions", function () {
    it("Should pause all transfers", async function () {
      await securityManager.connect(owner).pause();
      
      await expect(
        securityManager.validateTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("100000")
        )
      ).to.be.revertedWithCustomError(securityManager, "EnforcedPause");
    });

    it("Should allow emergency role to bypass pause", async function () {
      await securityManager.connect(owner).pause();
      
      // Grant emergency role to user1
      await securityManager.grantRole(EMERGENCY_ROLE, user1.address);
      
      // Should work for emergency role
      const isValid = await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("100000")
      );
      expect(isValid).to.be.true;
    });

    it("Should emergency reset user limits", async function () {
      // Max out user limit
      await securityManager.connect(securityAdmin).updateUserDailyLimit(
        user1.address,
        ethers.parseEther("1000000")
      );
      await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("1000000")
      );
      
      // Reset limits
      await securityManager.connect(owner).emergencyResetUserLimits(user1.address);
      
      // Should work again
      const isValid = await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("500000")
      );
      expect(isValid).to.be.true;
    });

    it("Should emergency reset all limits", async function () {
      // Max out global limit
      await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.parseEther("20000000")
      );
      
      // Reset all
      await securityManager.connect(owner).emergencyResetAllLimits();
      
      // Should work again
      const isValid = await securityManager.validateTransfer(
        user2.address,
        CHAIN_BSC,
        ethers.parseEther("10000000")
      );
      expect(isValid).to.be.true;
    });
  });

  describe("Access Control", function () {
    it("Should enforce role-based access", async function () {
      // Unauthorized user cannot update limits
      await expect(
        securityManager.connect(unauthorizedUser).updateGlobalDailyLimit(ethers.parseEther("100000000"))
      ).to.be.revertedWithCustomError(securityManager, "AccessControlUnauthorizedAccount");
      
      // Unauthorized user cannot update lists
      await expect(
        securityManager.connect(unauthorizedUser).updateWhitelist(user1.address, true)
      ).to.be.revertedWithCustomError(securityManager, "AccessControlUnauthorizedAccount");
    });

    it("Should allow role delegation", async function () {
      // Grant operator role to new address
      await securityManager.grantRole(OPERATOR_ROLE, unauthorizedUser.address);
      
      // Now should work
      await expect(
        securityManager.connect(unauthorizedUser).updateWhitelist(user1.address, true)
      ).to.not.be.reverted;
    });
  });

  describe("Integration with Router", function () {
    it("Should only accept validation requests from router", async function () {
      // Direct call should fail
      await expect(
        securityManager.connect(user1).validateAndRecordTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("1000000")
        )
      ).to.be.revertedWith("SecurityManager: caller not router");
    });

    it("Should validate and record in single transaction", async function () {
      // Mock router call
      await securityManager.connect(securityAdmin).setRouter(owner.address);
      
      await expect(
        securityManager.connect(owner).validateAndRecordTransfer(
          user1.address,
          CHAIN_BSC,
          ethers.parseEther("1000000")
        )
      ).to.not.be.reverted;
      
      // Check it was recorded
      const userStats = await securityManager.getUserTransferStats(user1.address);
      expect(userStats.dailyVolume).to.equal(ethers.parseEther("1000000"));
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero amount transfers", async function () {
      const isValid = await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        0
      );
      expect(isValid).to.be.true;
    });

    it("Should handle maximum uint256 limits", async function () {
      await securityManager.connect(securityAdmin).updateGlobalDailyLimit(ethers.MaxUint256);
      
      const isValid = await securityManager.validateTransfer(
        user1.address,
        CHAIN_BSC,
        ethers.MaxUint256.div(2)
      );
      expect(isValid).to.be.true;
    });

    it("Should handle rapid role changes", async function () {
      // Grant and revoke rapidly
      await securityManager.grantRole(OPERATOR_ROLE, user1.address);
      await securityManager.revokeRole(OPERATOR_ROLE, user1.address);
      await securityManager.grantRole(OPERATOR_ROLE, user1.address);
      
      // Should have the role
      expect(await securityManager.hasRole(OPERATOR_ROLE, user1.address)).to.be.true;
    });
  });
});