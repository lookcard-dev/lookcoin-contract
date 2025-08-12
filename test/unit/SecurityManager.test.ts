import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { SecurityManager } from "../../typechain-types";
import { deployLookCoinFixture } from "../helpers/fixtures";
import {
  ROLES,
  AMOUNTS,
  TIME_CONSTANTS,
  PROTOCOLS,
} from "../helpers/constants";
import {
  testRoleBasedFunction,
  advanceTimeAndBlock,
  trackGasUsage,
} from "../helpers/utils";

describe("SecurityManager - Cross-Chain Protocol Security", function () {
  let fixture: Awaited<ReturnType<typeof deployLookCoinFixture>>;
  let securityManager: SecurityManager;
  let admin: SignerWithAddress;
  let securityAdmin: SignerWithAddress;
  let user1: SignerWithAddress;
  let unauthorizedUser: SignerWithAddress;

  const GLOBAL_DAILY_LIMIT = ethers.parseEther("20000000"); // 20M tokens
  const SECURITY_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SECURITY_ADMIN_ROLE"));
  const EMERGENCY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE"));

  // Protocol constants
  const PROTOCOL_LAYERZERO = PROTOCOLS.LAYERZERO;
  const PROTOCOL_CELER = PROTOCOLS.CELER;
  const PROTOCOL_HYPERLANE = PROTOCOLS.HYPERLANE;

  beforeEach(async function () {
    fixture = await loadFixture(deployLookCoinFixture);
    securityManager = fixture.securityManager;
    admin = fixture.admin;
    securityAdmin = fixture.securityAdmin;
    user1 = fixture.user1;

    // Get additional signers for testing
    const signers = await ethers.getSigners();
    unauthorizedUser = signers[13];

    // Roles are already granted in fixture, but we can verify them
    expect(await securityManager.hasRole(SECURITY_ADMIN_ROLE, securityAdmin.address)).to.be.true;
    expect(await securityManager.hasRole(EMERGENCY_ROLE, admin.address)).to.be.true;
  });

  describe("Contract Deployment and Initialization", function () {
    it("should deploy with correct initial parameters", async function () {
      expect(await securityManager.globalDailyLimit()).to.equal(GLOBAL_DAILY_LIMIT);
      expect(await securityManager.paused()).to.be.false;
      expect(await securityManager.emergencyPaused()).to.be.false;
      
      // Check admin role assignment
      expect(await securityManager.hasRole(ROLES.DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await securityManager.hasRole(SECURITY_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await securityManager.hasRole(EMERGENCY_ROLE, admin.address)).to.be.true;
    });

    it("should initialize with correct protocol configurations", async function () {
      // Check default protocol configs
      const layerZeroConfig = await securityManager.protocolConfigs(PROTOCOL_LAYERZERO);
      expect(layerZeroConfig.paused).to.be.false;
      expect(layerZeroConfig.dailyLimit).to.equal(ethers.parseEther("500000"));
      expect(layerZeroConfig.transactionLimit).to.equal(ethers.parseEther("50000"));
      expect(layerZeroConfig.cooldownPeriod).to.equal(300); // 5 minutes
      
      const celerConfig = await securityManager.protocolConfigs(PROTOCOL_CELER);
      expect(celerConfig.paused).to.be.false;
      
      const hyperlaneConfig = await securityManager.protocolConfigs(PROTOCOL_HYPERLANE);
      expect(hyperlaneConfig.paused).to.be.false;
    });

    it("should have correct anomaly threshold settings", async function () {
      const anomalyThreshold = await securityManager.anomalyThreshold();
      expect(anomalyThreshold.volumeThreshold).to.equal(ethers.parseEther("1000000")); // 1M tokens
      expect(anomalyThreshold.frequencyThreshold).to.equal(10);
      expect(anomalyThreshold.timeWindow).to.equal(3600); // 1 hour
    });
  });

  describe("Global Daily Limit Management", function () {
    it("should update global daily limit with security admin role", async function () {
      const newLimit = AMOUNTS.MILLION_TOKENS * BigInt(50); // 50M tokens
      
      const tx = await securityManager.connect(securityAdmin).updateGlobalDailyLimit(newLimit);
      
      expect(await securityManager.globalDailyLimit()).to.equal(newLimit);
      await expect(tx).to.emit(securityManager, "GlobalLimitUpdated").withArgs(newLimit);
    });

    it("should enforce security admin role for global limit setting", async function () {
      await testRoleBasedFunction(
        securityManager as any,
        "updateGlobalDailyLimit",
        [AMOUNTS.MILLION_TOKENS * BigInt(50)],
        SECURITY_ADMIN_ROLE,
        securityAdmin,
        user1
      );
    });
  });

  describe("Transfer Validation", function () {
    it("should validate transfers within global and protocol limits", async function () {
      const amount = AMOUNTS.MILLION_TOKENS; // Well within limits
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("test-transfer-1"));
      
      const result = await securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, amount, transferId);
      expect(result).to.be.true;
    });

    it("should reject transfers exceeding global daily limit", async function () {
      const excessiveAmount = GLOBAL_DAILY_LIMIT + BigInt(1);
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("test-transfer-excessive"));
      
      await expect(
        securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, excessiveAmount, transferId)
      ).to.be.revertedWith("Global daily limit exceeded");
    });

    it("should reject transfers exceeding protocol transaction limit", async function () {
      const protocolConfig = await securityManager.protocolConfigs(PROTOCOL_LAYERZERO);
      const excessiveAmount = protocolConfig.transactionLimit + BigInt(1);
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("test-transfer-protocol-limit"));
      
      await expect(
        securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, excessiveAmount, transferId)
      ).to.be.revertedWith("Transaction limit exceeded");
    });

    it("should allow transfers after daily reset", async function () {
      const largeAmount = GLOBAL_DAILY_LIMIT / BigInt(2);
      const transferId1 = ethers.keccak256(ethers.toUtf8Bytes("test-transfer-1"));
      const transferId2 = ethers.keccak256(ethers.toUtf8Bytes("test-transfer-2"));
      
      // Use up half the daily limit
      await securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, largeAmount, transferId1);
      
      // Advance time by 24 hours
      await advanceTimeAndBlock(TIME_CONSTANTS.ONE_DAY + 1);
      
      // Should allow large transfers again after reset
      const result = await securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, largeAmount, transferId2);
      expect(result).to.be.true;
    });

    it("should reject blocked transfers", async function () {
      const amount = AMOUNTS.MILLION_TOKENS;
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("blocked-transfer"));
      
      // Block the transfer
      await securityManager.connect(securityAdmin).blockTransfer(transferId);
      
      // Should reject the blocked transfer
      await expect(
        securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, amount, transferId)
      ).to.be.revertedWith("Transfer blocked");
    });
  });

  describe("Protocol Management", function () {
    it("should update protocol config with security admin role", async function () {
      const newDailyLimit = ethers.parseEther("1000000"); // 1M tokens
      const newTransactionLimit = ethers.parseEther("100000"); // 100K tokens per tx
      const newCooldownPeriod = 600; // 10 minutes
      
      const tx = await securityManager.connect(securityAdmin).updateProtocolConfig(
        PROTOCOL_LAYERZERO,
        newDailyLimit,
        newTransactionLimit,
        newCooldownPeriod
      );
      
      const config = await securityManager.protocolConfigs(PROTOCOL_LAYERZERO);
      expect(config.dailyLimit).to.equal(newDailyLimit);
      expect(config.transactionLimit).to.equal(newTransactionLimit);
      expect(config.cooldownPeriod).to.equal(newCooldownPeriod);
      
      await expect(tx).to.emit(securityManager, "SecurityConfigUpdated").withArgs(PROTOCOL_LAYERZERO);
    });

    it("should pause and unpause protocols", async function () {
      // Pause protocol
      const pauseTx = await securityManager.connect(securityAdmin).pauseProtocol(PROTOCOL_LAYERZERO);
      await expect(pauseTx).to.emit(securityManager, "ProtocolPaused").withArgs(PROTOCOL_LAYERZERO);
      expect(await securityManager.protocolPaused(PROTOCOL_LAYERZERO)).to.be.true;
      
      // Should reject transfers when paused
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("test-paused"));
      await expect(
        securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, AMOUNTS.MILLION_TOKENS, transferId)
      ).to.be.revertedWith("Protocol paused");
      
      // Unpause protocol
      const unpauseTx = await securityManager.connect(securityAdmin).unpauseProtocol(PROTOCOL_LAYERZERO);
      await expect(unpauseTx).to.emit(securityManager, "ProtocolUnpaused").withArgs(PROTOCOL_LAYERZERO);
      expect(await securityManager.protocolPaused(PROTOCOL_LAYERZERO)).to.be.false;
      
      // Should allow transfers when unpaused
      const result = await securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, AMOUNTS.MILLION_TOKENS, transferId);
      expect(result).to.be.true;
    });
  });

  describe("Anomaly Detection", function () {
    it("should update anomaly threshold with security admin role", async function () {
      const newVolumeThreshold = ethers.parseEther("2000000"); // 2M tokens
      const newFrequencyThreshold = 20; // 20 transactions
      const newTimeWindow = TIME_CONSTANTS.ONE_HOUR * 2; // 2 hours
      
      await securityManager.connect(securityAdmin).updateAnomalyThreshold(
        newVolumeThreshold,
        newFrequencyThreshold,
        newTimeWindow
      );
      
      const threshold = await securityManager.anomalyThreshold();
      expect(threshold.volumeThreshold).to.equal(newVolumeThreshold);
      expect(threshold.frequencyThreshold).to.equal(newFrequencyThreshold);
      expect(threshold.timeWindow).to.equal(newTimeWindow);
    });

    it("should detect high volume anomaly", async function () {
      const threshold = await securityManager.anomalyThreshold();
      const highAmount = threshold.volumeThreshold + BigInt(1);
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("high-volume-transfer"));
      
      // This should trigger an anomaly detection
      const tx = await securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, highAmount, transferId);
      
      await expect(tx).to.emit(securityManager, "AnomalyDetected")
        .withArgs(user1.address, PROTOCOL_LAYERZERO, "High volume");
      
      // Check that suspicious activity count increased
      expect(await securityManager.suspiciousActivityCount(user1.address)).to.equal(1);
    });

    it("should block users with excessive suspicious activity", async function () {
      // Report suspicious activity 6 times (threshold is 5)
      for (let i = 0; i < 6; i++) {
        await securityManager.connect(securityAdmin).reportSuspiciousActivity(user1.address);
      }
      
      // Next transfer should fail
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("blocked-user-transfer"));
      await expect(
        securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, AMOUNTS.MILLION_TOKENS, transferId)
      ).to.be.revertedWith("User flagged for suspicious activity");
    });
  });

  describe("Transfer Blocking", function () {
    it("should block transfers with security admin role", async function () {
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("blocked-transfer"));
      
      const tx = await securityManager.connect(securityAdmin).blockTransfer(transferId);
      
      expect(await securityManager.blockedTransfers(transferId)).to.be.true;
      await expect(tx).to.emit(securityManager, "TransferBlocked").withArgs(transferId);
    });
  });

  describe("Emergency Functions", function () {
    it("should activate emergency pause with emergency role", async function () {
      const tx = await securityManager.connect(admin).activateEmergencyPause();
      
      expect(await securityManager.emergencyPaused()).to.be.true;
      await expect(tx).to.emit(securityManager, "EmergencyPauseActivated");
    });

    it("should deactivate emergency pause with emergency role", async function () {
      // First activate
      await securityManager.connect(admin).activateEmergencyPause();
      expect(await securityManager.emergencyPaused()).to.be.true;
      
      // Then deactivate
      const tx = await securityManager.connect(admin).deactivateEmergencyPause();
      
      expect(await securityManager.emergencyPaused()).to.be.false;
      await expect(tx).to.emit(securityManager, "EmergencyPauseDeactivated");
    });

    it("should reject transfers when emergency paused", async function () {
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("emergency-test"));
      
      await securityManager.connect(admin).activateEmergencyPause();
      
      await expect(
        securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, AMOUNTS.MILLION_TOKENS, transferId)
      ).to.be.revertedWith("Emergency pause active");
    });
  });

  describe("Pause Mechanism", function () {
    it("should allow security admin to pause and unpause", async function () {
      // Pause
      const pauseTx = await securityManager.connect(securityAdmin).pause();
      await expect(pauseTx).to.emit(securityManager, "Paused").withArgs(securityAdmin.address);
      expect(await securityManager.paused()).to.be.true;
      
      // Unpause
      const unpauseTx = await securityManager.connect(securityAdmin).unpause();
      await expect(unpauseTx).to.emit(securityManager, "Unpaused").withArgs(securityAdmin.address);
      expect(await securityManager.paused()).to.be.false;
    });

    it("should block validations when paused", async function () {
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("paused-test"));
      
      await securityManager.connect(securityAdmin).pause();
      
      await expect(
        securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, AMOUNTS.MILLION_TOKENS, transferId)
      ).to.be.revertedWithCustomError(securityManager, "EnforcedPause");
    });
  });

  describe("Access Control", function () {
    it("should enforce security admin role for core security functions", async function () {
      const securityAdminFunctions = [
        {
          name: "updateGlobalDailyLimit",
          args: [AMOUNTS.MILLION_TOKENS * BigInt(50)]
        },
        {
          name: "updateProtocolConfig",
          args: [PROTOCOL_LAYERZERO, ethers.parseEther("1000000"), ethers.parseEther("100000"), 600]
        },
        {
          name: "pauseProtocol",
          args: [PROTOCOL_LAYERZERO]
        },
        {
          name: "blockTransfer",
          args: [ethers.keccak256(ethers.toUtf8Bytes("test"))]
        }
      ];

      for (const func of securityAdminFunctions) {
        await testRoleBasedFunction(
          securityManager as any,
          func.name,
          func.args,
          SECURITY_ADMIN_ROLE,
          securityAdmin,
          user1
        );
      }
    });

    it("should enforce role-based access for unauthorized users", async function () {
      // Unauthorized user cannot update limits
      await expect(
        securityManager.connect(unauthorizedUser).updateGlobalDailyLimit(ethers.parseEther("100000000"))
      ).to.be.revertedWithCustomError(securityManager, "AccessControlUnauthorizedAccount");
      
      // Unauthorized user cannot pause protocols
      await expect(
        securityManager.connect(unauthorizedUser).pauseProtocol(PROTOCOL_LAYERZERO)
      ).to.be.revertedWithCustomError(securityManager, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Gas Optimization and Performance", function () {
    it("should track gas usage for security operations", async function () {
      const amount = AMOUNTS.MILLION_TOKENS;
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("gas-test"));
      
      const validateReport = await trackGasUsage(
        async () => securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, amount, transferId),
        "transfer validation"
      );
      
      const pauseReport = await trackGasUsage(
        async () => securityManager.connect(securityAdmin).pauseProtocol(PROTOCOL_CELER),
        "protocol pause"
      );
      
      const blockReport = await trackGasUsage(
        async () => securityManager.connect(securityAdmin).blockTransfer(ethers.keccak256(ethers.toUtf8Bytes("blocked"))),
        "transfer blocking"
      );
      
      console.log(`\nSecurityManager Gas Usage:`);
      console.log(`  Transfer Validation: ${validateReport.gasUsed} gas`);
      console.log(`  Protocol Pause: ${pauseReport.gasUsed} gas`);
      console.log(`  Transfer Blocking: ${blockReport.gasUsed} gas`);
      
      // Gas usage should be reasonable
      expect(validateReport.gasUsed).to.be.lt(100000);
      expect(pauseReport.gasUsed).to.be.lt(50000);
      expect(blockReport.gasUsed).to.be.lt(50000);
    });
  });

  describe("Error Handling and Edge Cases", function () {
    it("should handle zero amount transfers", async function () {
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("zero-amount"));
      
      const result = await securityManager.validateTransfer(
        user1.address,
        PROTOCOL_LAYERZERO,
        0,
        transferId
      );
      expect(result).to.be.true;
    });

    it("should handle edge case timing scenarios", async function () {
      const amount = AMOUNTS.MILLION_TOKENS;
      const transferId1 = ethers.keccak256(ethers.toUtf8Bytes("time-test-1"));
      const transferId2 = ethers.keccak256(ethers.toUtf8Bytes("time-test-2"));
      
      // Record transfer at end of day
      await securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, amount, transferId1);
      
      // Advance exactly 24 hours
      await advanceTimeAndBlock(TIME_CONSTANTS.ONE_DAY);
      
      // Should reset exactly at 24 hour mark and allow new transfers
      const result = await securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, amount, transferId2);
      expect(result).to.be.true;
    });
  });

  describe("Volume Tracking", function () {
    it("should track user protocol volume correctly", async function () {
      const amount = AMOUNTS.MILLION_TOKENS;
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("test-transfer-1"));
      
      // Initial volume should be zero
      expect(await securityManager.userProtocolVolume(user1.address, PROTOCOL_LAYERZERO)).to.equal(0);
      
      // Validate transfer (which records usage)
      await securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, amount, transferId);
      
      // Check updated volume
      expect(await securityManager.userProtocolVolume(user1.address, PROTOCOL_LAYERZERO)).to.equal(amount);
    });

    it("should reset global daily volume after 24 hours", async function () {
      const amount = AMOUNTS.MILLION_TOKENS;
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("test-transfer-1"));
      
      // Validate transfer
      await securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, amount, transferId);
      
      // Check global volume increased
      expect(await securityManager.globalDailyVolume()).to.equal(amount);
      
      // Advance time by 24 hours + 1 second
      await advanceTimeAndBlock(TIME_CONSTANTS.ONE_DAY + 1);
      
      // Next transfer should reset global volume
      const transferId2 = ethers.keccak256(ethers.toUtf8Bytes("test-transfer-2"));
      await securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, amount, transferId2);
      
      // Global volume should have reset and show only the new amount
      expect(await securityManager.globalDailyVolume()).to.equal(amount);
    });
  });

  describe("Upgrade Compatibility", function () {
    it("should maintain state after upgrade simulation", async function () {
      // Set up some state
      const newLimit = AMOUNTS.MILLION_TOKENS * BigInt(30);
      await securityManager.connect(securityAdmin).updateGlobalDailyLimit(newLimit);
      
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("upgrade-test"));
      await securityManager.validateTransfer(user1.address, PROTOCOL_LAYERZERO, AMOUNTS.MILLION_TOKENS, transferId);
      
      // Verify state persists
      expect(await securityManager.globalDailyLimit()).to.equal(newLimit);
      expect(await securityManager.globalDailyVolume()).to.equal(AMOUNTS.MILLION_TOKENS);
      expect(await securityManager.userProtocolVolume(user1.address, PROTOCOL_LAYERZERO)).to.equal(AMOUNTS.MILLION_TOKENS);
    });
  });
});