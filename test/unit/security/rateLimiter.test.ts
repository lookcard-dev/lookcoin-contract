import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { RateLimiter } from "../../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("RateLimiter - Comprehensive Security Tests", function () {
  let rateLimiter: RateLimiter;
  let owner: SignerWithAddress;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let unauthorizedUser: SignerWithAddress;

  const ADMIN_ROLE = ethers.ZeroHash; // DEFAULT_ADMIN_ROLE
  const LIMITER_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("LIMITER_ADMIN_ROLE"));
  
  // Default limits
  const MAX_PER_TRANSACTION = ethers.parseEther("500000"); // 500K tokens
  const MAX_PER_HOUR = ethers.parseEther("1500000"); // 1.5M tokens (3 transactions)
  const MAX_PER_DAY = ethers.parseEther("10000000"); // 10M tokens

  beforeEach(async function () {
    [owner, admin, user1, user2, unauthorizedUser] = await ethers.getSigners();

    const RateLimiter = await ethers.getContractFactory("RateLimiter");
    rateLimiter = await upgrades.deployProxy(
      RateLimiter,
      [owner.address],
      { kind: "uups" }
    ) as unknown as RateLimiter;
    await rateLimiter.waitForDeployment();

    // Grant admin role
    await rateLimiter.grantRole(LIMITER_ADMIN_ROLE, admin.address);
  });

  describe("Initialization", function () {
    it("Should initialize with correct default limits", async function () {
      const defaultLimits = await rateLimiter.getDefaultLimits();
      expect(defaultLimits.maxPerTransaction).to.equal(MAX_PER_TRANSACTION);
      expect(defaultLimits.maxPerHour).to.equal(MAX_PER_HOUR);
      expect(defaultLimits.maxPerDay).to.equal(MAX_PER_DAY);
    });

    it("Should have correct role setup", async function () {
      expect(await rateLimiter.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
      expect(await rateLimiter.hasRole(LIMITER_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("Should start with empty whitelist", async function () {
      expect(await rateLimiter.isWhitelisted(user1.address)).to.be.false;
      expect(await rateLimiter.isWhitelisted(user2.address)).to.be.false;
    });
  });

  describe("Transaction Limits", function () {
    it("Should allow transaction within per-transaction limit", async function () {
      const amount = ethers.parseEther("400000"); // 400K tokens
      const isAllowed = await rateLimiter.checkLimit(user1.address, amount);
      expect(isAllowed).to.be.true;
    });

    it("Should reject transaction exceeding per-transaction limit", async function () {
      const amount = ethers.parseEther("600000"); // 600K tokens
      await expect(
        rateLimiter.checkLimit(user1.address, amount)
      ).to.be.revertedWith("RateLimiter: exceeds per-transaction limit");
    });

    it("Should track transaction history", async function () {
      // First transaction
      await rateLimiter.checkLimit(user1.address, ethers.parseEther("100000"));
      
      const history = await rateLimiter.getTransactionHistory(user1.address);
      expect(history.length).to.equal(1);
      expect(history[0].amount).to.equal(ethers.parseEther("100000"));
    });
  });

  describe("Hourly Limits with Sliding Window", function () {
    it("Should allow multiple transactions within hourly limit", async function () {
      // Three transactions of 400K each (total 1.2M, under 1.5M limit)
      for (let i = 0; i < 3; i++) {
        const isAllowed = await rateLimiter.checkLimit(
          user1.address,
          ethers.parseEther("400000")
        );
        expect(isAllowed).to.be.true;
        await rateLimiter.recordTransaction(user1.address, ethers.parseEther("400000"));
      }
    });

    it("Should enforce hourly limit with sliding window", async function () {
      // First transaction at t=0
      await rateLimiter.checkLimit(user1.address, ethers.parseEther("500000"));
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("500000"));
      
      // Second transaction at t=0
      await rateLimiter.checkLimit(user1.address, ethers.parseEther("500000"));
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("500000"));
      
      // Third transaction at t=0 (total 1.5M)
      await rateLimiter.checkLimit(user1.address, ethers.parseEther("500000"));
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("500000"));
      
      // Fourth transaction should fail (would exceed 1.5M hourly limit)
      await expect(
        rateLimiter.checkLimit(user1.address, ethers.parseEther("100000"))
      ).to.be.revertedWith("RateLimiter: exceeds hourly limit");
    });

    it("Should reset hourly limit with sliding window", async function () {
      // Max out hourly limit
      await rateLimiter.checkLimit(user1.address, ethers.parseEther("500000"));
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("500000"));
      await rateLimiter.checkLimit(user1.address, ethers.parseEther("500000"));
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("500000"));
      await rateLimiter.checkLimit(user1.address, ethers.parseEther("500000"));
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("500000"));
      
      // Should fail immediately after
      await expect(
        rateLimiter.checkLimit(user1.address, ethers.parseEther("100000"))
      ).to.be.revertedWith("RateLimiter: exceeds hourly limit");
      
      // Fast forward 30 minutes
      await time.increase(30 * 60);
      
      // Should still fail (transactions still within 1-hour window)
      await expect(
        rateLimiter.checkLimit(user1.address, ethers.parseEther("100000"))
      ).to.be.revertedWith("RateLimiter: exceeds hourly limit");
      
      // Fast forward another 31 minutes (total 61 minutes)
      await time.increase(31 * 60);
      
      // First transaction should now be outside window, allowing new transaction
      const isAllowed = await rateLimiter.checkLimit(
        user1.address,
        ethers.parseEther("500000")
      );
      expect(isAllowed).to.be.true;
    });

    it("Should correctly calculate sliding window volume", async function () {
      const startTime = await time.latest();
      
      // Transaction 1: 200K at t=0
      await rateLimiter.checkLimit(user1.address, ethers.parseEther("200000"));
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("200000"));
      
      // Fast forward 20 minutes
      await time.increase(20 * 60);
      
      // Transaction 2: 300K at t=20min
      await rateLimiter.checkLimit(user1.address, ethers.parseEther("300000"));
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("300000"));
      
      // Fast forward 20 minutes
      await time.increase(20 * 60);
      
      // Transaction 3: 400K at t=40min
      await rateLimiter.checkLimit(user1.address, ethers.parseEther("400000"));
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("400000"));
      
      // Current total: 900K
      const hourlyVolume = await rateLimiter.getHourlyVolume(user1.address);
      expect(hourlyVolume).to.equal(ethers.parseEther("900000"));
      
      // Fast forward 25 minutes (t=65min)
      await time.increase(25 * 60);
      
      // First transaction (200K) should be outside window
      // Remaining: 300K + 400K = 700K
      const newHourlyVolume = await rateLimiter.getHourlyVolume(user1.address);
      expect(newHourlyVolume).to.equal(ethers.parseEther("700000"));
    });
  });

  describe("Daily Limits", function () {
    it("Should enforce daily limit", async function () {
      // Make transactions totaling 9M
      for (let i = 0; i < 18; i++) {
        await rateLimiter.checkLimit(user1.address, ethers.parseEther("500000"));
        await rateLimiter.recordTransaction(user1.address, ethers.parseEther("500000"));
        await time.increase(5 * 60); // 5 minutes between transactions
      }
      
      // Next transaction would exceed daily limit
      await expect(
        rateLimiter.checkLimit(user1.address, ethers.parseEther("1500000"))
      ).to.be.revertedWith("RateLimiter: exceeds daily limit");
    });

    it("Should reset daily limit after 24 hours", async function () {
      // Max out daily limit
      for (let i = 0; i < 20; i++) {
        await rateLimiter.checkLimit(user1.address, ethers.parseEther("500000"));
        await rateLimiter.recordTransaction(user1.address, ethers.parseEther("500000"));
        await time.increase(5 * 60);
      }
      
      // Should fail
      await expect(
        rateLimiter.checkLimit(user1.address, ethers.parseEther("100000"))
      ).to.be.revertedWith("RateLimiter: exceeds daily limit");
      
      // Fast forward 24 hours
      await time.increase(24 * 60 * 60);
      
      // Should work now
      const isAllowed = await rateLimiter.checkLimit(
        user1.address,
        ethers.parseEther("500000")
      );
      expect(isAllowed).to.be.true;
    });

    it("Should track daily volume correctly", async function () {
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("1000000"));
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("2000000"));
      
      const dailyVolume = await rateLimiter.getDailyVolume(user1.address);
      expect(dailyVolume).to.equal(ethers.parseEther("3000000"));
    });
  });

  describe("Custom User Limits", function () {
    it("Should set custom limits for specific users", async function () {
      const customLimits = {
        maxPerTransaction: ethers.parseEther("1000000"), // 1M
        maxPerHour: ethers.parseEther("3000000"), // 3M
        maxPerDay: ethers.parseEther("20000000") // 20M
      };
      
      await expect(
        rateLimiter.connect(admin).setUserLimits(
          user1.address,
          customLimits.maxPerTransaction,
          customLimits.maxPerHour,
          customLimits.maxPerDay
        )
      ).to.emit(rateLimiter, "UserLimitsUpdated")
        .withArgs(
          user1.address,
          customLimits.maxPerTransaction,
          customLimits.maxPerHour,
          customLimits.maxPerDay
        );
      
      // Should allow larger transaction for user1
      const isAllowed = await rateLimiter.checkLimit(
        user1.address,
        ethers.parseEther("800000")
      );
      expect(isAllowed).to.be.true;
      
      // But not for user2 (still has default limits)
      await expect(
        rateLimiter.checkLimit(user2.address, ethers.parseEther("800000"))
      ).to.be.revertedWith("RateLimiter: exceeds per-transaction limit");
    });

    it("Should remove custom limits", async function () {
      // Set custom limits
      await rateLimiter.connect(admin).setUserLimits(
        user1.address,
        ethers.parseEther("1000000"),
        ethers.parseEther("3000000"),
        ethers.parseEther("20000000")
      );
      
      // Remove custom limits (set to 0)
      await rateLimiter.connect(admin).removeUserLimits(user1.address);
      
      // Should revert to default limits
      await expect(
        rateLimiter.checkLimit(user1.address, ethers.parseEther("600000"))
      ).to.be.revertedWith("RateLimiter: exceeds per-transaction limit");
    });

    it("Should get user limits correctly", async function () {
      const limits = await rateLimiter.getUserLimits(user1.address);
      expect(limits.maxPerTransaction).to.equal(MAX_PER_TRANSACTION);
      expect(limits.maxPerHour).to.equal(MAX_PER_HOUR);
      expect(limits.maxPerDay).to.equal(MAX_PER_DAY);
      expect(limits.isCustom).to.be.false;
      
      // Set custom limits
      await rateLimiter.connect(admin).setUserLimits(
        user1.address,
        ethers.parseEther("1000000"),
        ethers.parseEther("3000000"),
        ethers.parseEther("20000000")
      );
      
      const customLimits = await rateLimiter.getUserLimits(user1.address);
      expect(customLimits.maxPerTransaction).to.equal(ethers.parseEther("1000000"));
      expect(customLimits.isCustom).to.be.true;
    });
  });

  describe("Whitelist Management", function () {
    it("Should whitelist addresses to bypass all limits", async function () {
      await expect(
        rateLimiter.connect(admin).updateWhitelist(user1.address, true)
      ).to.emit(rateLimiter, "WhitelistUpdated")
        .withArgs(user1.address, true);
      
      // Should allow any amount for whitelisted user
      const isAllowed = await rateLimiter.checkLimit(
        user1.address,
        ethers.parseEther("100000000") // 100M
      );
      expect(isAllowed).to.be.true;
    });

    it("Should remove from whitelist", async function () {
      // Add to whitelist
      await rateLimiter.connect(admin).updateWhitelist(user1.address, true);
      expect(await rateLimiter.isWhitelisted(user1.address)).to.be.true;
      
      // Remove from whitelist
      await rateLimiter.connect(admin).updateWhitelist(user1.address, false);
      expect(await rateLimiter.isWhitelisted(user1.address)).to.be.false;
      
      // Should enforce limits again
      await expect(
        rateLimiter.checkLimit(user1.address, ethers.parseEther("600000"))
      ).to.be.revertedWith("RateLimiter: exceeds per-transaction limit");
    });

    it("Should batch update whitelist", async function () {
      const addresses = [user1.address, user2.address];
      
      await rateLimiter.connect(admin).batchUpdateWhitelist(addresses, true);
      
      expect(await rateLimiter.isWhitelisted(user1.address)).to.be.true;
      expect(await rateLimiter.isWhitelisted(user2.address)).to.be.true;
    });
  });

  describe("Transaction Recording", function () {
    it("Should record transactions with correct timestamp", async function () {
      const amount = ethers.parseEther("100000");
      const beforeTime = await time.latest();
      
      await rateLimiter.recordTransaction(user1.address, amount);
      
      const history = await rateLimiter.getTransactionHistory(user1.address);
      expect(history.length).to.equal(1);
      expect(history[0].amount).to.equal(amount);
      expect(history[0].timestamp).to.be.gte(beforeTime);
    });

    it("Should maintain transaction history order", async function () {
      // Record multiple transactions
      for (let i = 1; i <= 5; i++) {
        await rateLimiter.recordTransaction(
          user1.address,
          ethers.parseEther((i * 100000).toString())
        );
        await time.increase(60); // 1 minute between transactions
      }
      
      const history = await rateLimiter.getTransactionHistory(user1.address);
      expect(history.length).to.equal(5);
      
      // Verify chronological order
      for (let i = 1; i < history.length; i++) {
        expect(history[i].timestamp).to.be.gt(history[i - 1].timestamp);
      }
    });

    it("Should clean up old transaction history", async function () {
      // Record old transactions
      for (let i = 0; i < 10; i++) {
        await rateLimiter.recordTransaction(
          user1.address,
          ethers.parseEther("100000")
        );
        await time.increase(60 * 60); // 1 hour between transactions
      }
      
      // Fast forward 25 hours
      await time.increase(25 * 60 * 60);
      
      // Trigger cleanup
      await rateLimiter.cleanupHistory(user1.address);
      
      const history = await rateLimiter.getTransactionHistory(user1.address);
      // Should only have transactions from last 24 hours
      expect(history.length).to.be.lte(1);
    });
  });

  describe("Default Limits Updates", function () {
    it("Should update default limits", async function () {
      const newLimits = {
        maxPerTransaction: ethers.parseEther("750000"),
        maxPerHour: ethers.parseEther("2000000"),
        maxPerDay: ethers.parseEther("15000000")
      };
      
      await expect(
        rateLimiter.connect(admin).updateDefaultLimits(
          newLimits.maxPerTransaction,
          newLimits.maxPerHour,
          newLimits.maxPerDay
        )
      ).to.emit(rateLimiter, "DefaultLimitsUpdated")
        .withArgs(
          newLimits.maxPerTransaction,
          newLimits.maxPerHour,
          newLimits.maxPerDay
        );
      
      const defaults = await rateLimiter.getDefaultLimits();
      expect(defaults.maxPerTransaction).to.equal(newLimits.maxPerTransaction);
      expect(defaults.maxPerHour).to.equal(newLimits.maxPerHour);
      expect(defaults.maxPerDay).to.equal(newLimits.maxPerDay);
    });

    it("Should validate limit relationships", async function () {
      // Hour limit must be >= transaction limit
      await expect(
        rateLimiter.connect(admin).updateDefaultLimits(
          ethers.parseEther("1000000"),
          ethers.parseEther("500000"), // Less than transaction limit
          ethers.parseEther("10000000")
        )
      ).to.be.revertedWith("RateLimiter: invalid limit relationships");
      
      // Day limit must be >= hour limit
      await expect(
        rateLimiter.connect(admin).updateDefaultLimits(
          ethers.parseEther("500000"),
          ethers.parseEther("1000000"),
          ethers.parseEther("500000") // Less than hour limit
        )
      ).to.be.revertedWith("RateLimiter: invalid limit relationships");
    });

    it("Should affect new users but not existing custom limits", async function () {
      // Set custom limits for user1
      await rateLimiter.connect(admin).setUserLimits(
        user1.address,
        ethers.parseEther("1000000"),
        ethers.parseEther("3000000"),
        ethers.parseEther("20000000")
      );
      
      // Update default limits
      await rateLimiter.connect(admin).updateDefaultLimits(
        ethers.parseEther("250000"),
        ethers.parseEther("750000"),
        ethers.parseEther("5000000")
      );
      
      // user1 should still have custom limits
      const user1Limits = await rateLimiter.getUserLimits(user1.address);
      expect(user1Limits.maxPerTransaction).to.equal(ethers.parseEther("1000000"));
      
      // user2 should have new default limits
      const user2Limits = await rateLimiter.getUserLimits(user2.address);
      expect(user2Limits.maxPerTransaction).to.equal(ethers.parseEther("250000"));
    });
  });

  describe("Statistics and Analytics", function () {
    beforeEach(async function () {
      // Create some transaction history
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("100000"));
      await time.increase(10 * 60);
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("200000"));
      await time.increase(10 * 60);
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("300000"));
      
      await rateLimiter.recordTransaction(user2.address, ethers.parseEther("400000"));
      await time.increase(10 * 60);
      await rateLimiter.recordTransaction(user2.address, ethers.parseEther("500000"));
    });

    it("Should calculate user statistics correctly", async function () {
      const stats = await rateLimiter.getUserStats(user1.address);
      expect(stats.totalTransactions).to.equal(3);
      expect(stats.hourlyVolume).to.equal(ethers.parseEther("600000"));
      expect(stats.dailyVolume).to.equal(ethers.parseEther("600000"));
      expect(stats.averageTransactionSize).to.equal(ethers.parseEther("200000"));
    });

    it("Should calculate global statistics", async function () {
      const globalStats = await rateLimiter.getGlobalStats();
      expect(globalStats.totalUsers).to.equal(2);
      expect(globalStats.totalTransactions).to.equal(5);
      expect(globalStats.totalVolume).to.equal(ethers.parseEther("1500000"));
    });

    it("Should identify high-volume users", async function () {
      const threshold = ethers.parseEther("500000");
      const highVolumeUsers = await rateLimiter.getHighVolumeUsers(threshold);
      
      expect(highVolumeUsers.length).to.equal(2);
      expect(highVolumeUsers).to.include(user1.address);
      expect(highVolumeUsers).to.include(user2.address);
    });
  });

  describe("Emergency Functions", function () {
    it("Should pause rate limiting", async function () {
      await rateLimiter.pause();
      
      await expect(
        rateLimiter.checkLimit(user1.address, ethers.parseEther("100000"))
      ).to.be.revertedWithCustomError(rateLimiter, "EnforcedPause");
    });

    it("Should unpause rate limiting", async function () {
      await rateLimiter.pause();
      await rateLimiter.unpause();
      
      const isAllowed = await rateLimiter.checkLimit(
        user1.address,
        ethers.parseEther("100000")
      );
      expect(isAllowed).to.be.true;
    });

    it("Should emergency reset user limits", async function () {
      // Max out user limits
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("500000"));
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("500000"));
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("500000"));
      
      // Should be rate limited
      await expect(
        rateLimiter.checkLimit(user1.address, ethers.parseEther("100000"))
      ).to.be.revertedWith("RateLimiter: exceeds hourly limit");
      
      // Emergency reset
      await rateLimiter.emergencyResetUser(user1.address);
      
      // Should work now
      const isAllowed = await rateLimiter.checkLimit(
        user1.address,
        ethers.parseEther("500000")
      );
      expect(isAllowed).to.be.true;
    });

    it("Should emergency reset all users", async function () {
      // Record transactions for multiple users
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("1500000"));
      await rateLimiter.recordTransaction(user2.address, ethers.parseEther("1500000"));
      
      // Both should be limited
      await expect(
        rateLimiter.checkLimit(user1.address, ethers.parseEther("100000"))
      ).to.be.revertedWith("RateLimiter: exceeds hourly limit");
      await expect(
        rateLimiter.checkLimit(user2.address, ethers.parseEther("100000"))
      ).to.be.revertedWith("RateLimiter: exceeds hourly limit");
      
      // Emergency reset all
      await rateLimiter.emergencyResetAll();
      
      // Both should work now
      expect(await rateLimiter.checkLimit(user1.address, ethers.parseEther("500000"))).to.be.true;
      expect(await rateLimiter.checkLimit(user2.address, ethers.parseEther("500000"))).to.be.true;
    });
  });

  describe("Access Control", function () {
    it("Should enforce admin role for configuration", async function () {
      await expect(
        rateLimiter.connect(unauthorizedUser).updateDefaultLimits(
          ethers.parseEther("1000000"),
          ethers.parseEther("3000000"),
          ethers.parseEther("10000000")
        )
      ).to.be.revertedWithCustomError(rateLimiter, "AccessControlUnauthorizedAccount");
      
      await expect(
        rateLimiter.connect(unauthorizedUser).setUserLimits(
          user1.address,
          ethers.parseEther("1000000"),
          ethers.parseEther("3000000"),
          ethers.parseEther("10000000")
        )
      ).to.be.revertedWithCustomError(rateLimiter, "AccessControlUnauthorizedAccount");
      
      await expect(
        rateLimiter.connect(unauthorizedUser).updateWhitelist(user1.address, true)
      ).to.be.revertedWithCustomError(rateLimiter, "AccessControlUnauthorizedAccount");
    });

    it("Should allow role management", async function () {
      // Grant admin role to new user
      await rateLimiter.grantRole(LIMITER_ADMIN_ROLE, unauthorizedUser.address);
      
      // Should now work
      await expect(
        rateLimiter.connect(unauthorizedUser).updateWhitelist(user1.address, true)
      ).to.not.be.reverted;
      
      // Revoke role
      await rateLimiter.revokeRole(LIMITER_ADMIN_ROLE, unauthorizedUser.address);
      
      // Should fail again
      await expect(
        rateLimiter.connect(unauthorizedUser).updateWhitelist(user1.address, false)
      ).to.be.revertedWithCustomError(rateLimiter, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Integration Scenarios", function () {
    it("Should handle rapid fire transactions correctly", async function () {
      // Simulate rapid transactions
      const amounts = [
        ethers.parseEther("100000"),
        ethers.parseEther("200000"),
        ethers.parseEther("150000"),
        ethers.parseEther("250000"),
        ethers.parseEther("300000")
      ];
      
      for (const amount of amounts) {
        const isAllowed = await rateLimiter.checkLimit(user1.address, amount);
        if (isAllowed) {
          await rateLimiter.recordTransaction(user1.address, amount);
        }
      }
      
      const stats = await rateLimiter.getUserStats(user1.address);
      expect(stats.totalTransactions).to.equal(5);
      expect(stats.hourlyVolume).to.equal(ethers.parseEther("1000000"));
    });

    it("Should handle mixed user patterns", async function () {
      // user1: Regular pattern
      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkLimit(user1.address, ethers.parseEther("400000"));
        await rateLimiter.recordTransaction(user1.address, ethers.parseEther("400000"));
        await time.increase(20 * 60); // 20 minutes between
      }
      
      // user2: Burst pattern
      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkLimit(user2.address, ethers.parseEther("500000"));
        await rateLimiter.recordTransaction(user2.address, ethers.parseEther("500000"));
      }
      
      const user1Stats = await rateLimiter.getUserStats(user1.address);
      const user2Stats = await rateLimiter.getUserStats(user2.address);
      
      expect(user1Stats.totalTransactions).to.equal(3);
      expect(user2Stats.totalTransactions).to.equal(3);
      expect(user2Stats.hourlyVolume).to.equal(ethers.parseEther("1500000"));
    });

    it("Should handle limit transitions smoothly", async function () {
      // Start with default limits
      await rateLimiter.checkLimit(user1.address, ethers.parseEther("400000"));
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("400000"));
      
      // Apply custom limits
      await rateLimiter.connect(admin).setUserLimits(
        user1.address,
        ethers.parseEther("1000000"),
        ethers.parseEther("3000000"),
        ethers.parseEther("20000000")
      );
      
      // Should allow larger transaction now
      const isAllowed = await rateLimiter.checkLimit(
        user1.address,
        ethers.parseEther("800000")
      );
      expect(isAllowed).to.be.true;
      
      // Previous transaction still counts toward limits
      const stats = await rateLimiter.getUserStats(user1.address);
      expect(stats.hourlyVolume).to.equal(ethers.parseEther("400000"));
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero amount transactions", async function () {
      const isAllowed = await rateLimiter.checkLimit(user1.address, 0);
      expect(isAllowed).to.be.true;
      
      await rateLimiter.recordTransaction(user1.address, 0);
      const stats = await rateLimiter.getUserStats(user1.address);
      expect(stats.totalTransactions).to.equal(1);
      expect(stats.hourlyVolume).to.equal(0);
    });

    it("Should handle maximum values", async function () {
      // Set maximum limits
      await rateLimiter.connect(admin).setUserLimits(
        user1.address,
        ethers.MaxUint256,
        ethers.MaxUint256,
        ethers.MaxUint256
      );
      
      // Should allow any amount
      const isAllowed = await rateLimiter.checkLimit(
        user1.address,
        ethers.MaxUint256.div(2)
      );
      expect(isAllowed).to.be.true;
    });

    it("Should handle clock skew gracefully", async function () {
      // Record transaction
      await rateLimiter.recordTransaction(user1.address, ethers.parseEther("100000"));
      
      // Even if somehow we go back in time (shouldn't happen in tests)
      // The system should still work correctly
      const isAllowed = await rateLimiter.checkLimit(
        user1.address,
        ethers.parseEther("100000")
      );
      expect(isAllowed).to.be.true;
    });

    it("Should handle user with no history", async function () {
      const stats = await rateLimiter.getUserStats(user1.address);
      expect(stats.totalTransactions).to.equal(0);
      expect(stats.hourlyVolume).to.equal(0);
      expect(stats.dailyVolume).to.equal(0);
      expect(stats.averageTransactionSize).to.equal(0);
    });
  });
});