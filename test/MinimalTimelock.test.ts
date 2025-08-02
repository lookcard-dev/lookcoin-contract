import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MinimalTimelock, LookCoin } from "../typechain-types";

describe("MinimalTimelock", function () {
  let timelock: MinimalTimelock;
  let lookCoin: LookCoin;
  let admin: SignerWithAddress;
  let proposer: SignerWithAddress;
  let executor: SignerWithAddress;
  let user: SignerWithAddress;

  const MIN_DELAY = 2 * 24 * 60 * 60; // 2 days in seconds

  beforeEach(async function () {
    [admin, proposer, executor, user] = await ethers.getSigners();

    // Deploy MinimalTimelock
    const MinimalTimelock = await ethers.getContractFactory("MinimalTimelock");
    timelock = await upgrades.deployProxy(MinimalTimelock, [admin.address]) as unknown as MinimalTimelock;
    await timelock.waitForDeployment();

    // Deploy LookCoin (for testing integration)
    const LookCoin = await ethers.getContractFactory("LookCoin");
    lookCoin = await upgrades.deployProxy(LookCoin, [admin.address, ethers.ZeroAddress]) as unknown as LookCoin;
    await lookCoin.waitForDeployment();

    // Grant roles
    const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
    
    await timelock.connect(admin).grantRole(PROPOSER_ROLE, proposer.address);
    await timelock.connect(admin).grantRole(EXECUTOR_ROLE, executor.address);
  });

  describe("Schedule and Execute", function () {
    it("Should schedule and execute a call after delay", async function () {
      // Prepare call data to grant MINTER_ROLE to user
      const MINTER_ROLE = await lookCoin.MINTER_ROLE();
      const callData = lookCoin.interface.encodeFunctionData("grantRole", [MINTER_ROLE, user.address]);
      
      // Schedule the call
      const tx = await timelock.connect(proposer).schedule(
        await lookCoin.getAddress(),
        0, // no ETH value
        callData,
        MIN_DELAY
      );
      
      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => {
        try {
          return timelock.interface.parseLog(log)?.name === "CallScheduled";
        } catch {
          return false;
        }
      });
      
      expect(event).to.not.be.undefined;
      
      // Get operation ID
      const operationId = await timelock.hashOperation(
        await lookCoin.getAddress(),
        0,
        callData
      );
      
      // Check operation is pending
      expect(await timelock.isOperationPending(operationId)).to.be.true;
      expect(await timelock.isOperationReady(operationId)).to.be.false;
      
      // Try to execute before delay - should fail
      await expect(
        timelock.connect(executor).execute(
          await lookCoin.getAddress(),
          0,
          callData
        )
      ).to.be.revertedWith("MinimalTimelock: operation not ready");
      
      // Fast forward time
      await time.increase(MIN_DELAY);
      
      // Now operation should be ready
      expect(await timelock.isOperationReady(operationId)).to.be.true;
      
      // Grant timelock the DEFAULT_ADMIN_ROLE on LookCoin first
      const DEFAULT_ADMIN_ROLE = await lookCoin.DEFAULT_ADMIN_ROLE();
      await lookCoin.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, await timelock.getAddress());
      
      // Execute the call
      await expect(
        timelock.connect(executor).execute(
          await lookCoin.getAddress(),
          0,
          callData
        )
      ).to.emit(timelock, "CallExecuted").withArgs(operationId);
      
      // Verify the role was granted
      expect(await lookCoin.hasRole(MINTER_ROLE, user.address)).to.be.true;
    });

    it("Should prevent duplicate scheduling", async function () {
      const callData = "0x12345678";
      
      // Schedule once
      await timelock.connect(proposer).schedule(
        user.address,
        0,
        callData,
        MIN_DELAY
      );
      
      // Try to schedule again - should fail
      await expect(
        timelock.connect(proposer).schedule(
          user.address,
          0,
          callData,
          MIN_DELAY
        )
      ).to.be.revertedWith("MinimalTimelock: operation already scheduled");
    });

    it("Should enforce minimum delay", async function () {
      const callData = "0x12345678";
      const insufficientDelay = MIN_DELAY - 1;
      
      await expect(
        timelock.connect(proposer).schedule(
          user.address,
          0,
          callData,
          insufficientDelay
        )
      ).to.be.revertedWith("MinimalTimelock: insufficient delay");
    });
  });

  describe("Cancel", function () {
    it("Should allow cancellation by authorized role", async function () {
      const callData = "0x12345678";
      
      // Schedule
      await timelock.connect(proposer).schedule(
        user.address,
        0,
        callData,
        MIN_DELAY
      );
      
      const operationId = await timelock.hashOperation(
        user.address,
        0,
        callData
      );
      
      // Grant canceller role to admin
      const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
      await timelock.connect(admin).grantRole(CANCELLER_ROLE, admin.address);
      
      // Cancel
      await expect(
        timelock.connect(admin).cancel(operationId)
      ).to.emit(timelock, "CallCancelled").withArgs(operationId);
      
      // Verify operation is cancelled
      expect(await timelock.isOperation(operationId)).to.be.false;
    });
  });

  describe("Access Control", function () {
    it("Should restrict scheduling to PROPOSER_ROLE", async function () {
      await expect(
        timelock.connect(user).schedule(
          user.address,
          0,
          "0x",
          MIN_DELAY
        )
      ).to.be.reverted;
    });

    it("Should restrict execution to EXECUTOR_ROLE", async function () {
      await expect(
        timelock.connect(user).execute(
          user.address,
          0,
          "0x"
        )
      ).to.be.reverted;
    });
  });

  describe("Integration with LookCoin", function () {
    it("Should handle critical operations through timelock", async function () {
      // Grant timelock necessary roles
      const UPGRADER_ROLE = await lookCoin.UPGRADER_ROLE();
      const PROTOCOL_ADMIN_ROLE = await lookCoin.PROTOCOL_ADMIN_ROLE();
      
      await lookCoin.connect(admin).grantRole(UPGRADER_ROLE, await timelock.getAddress());
      await lookCoin.connect(admin).grantRole(PROTOCOL_ADMIN_ROLE, await timelock.getAddress());
      
      // Schedule setting a new trusted remote (critical operation)
      const dstChainId = 123;
      const trustedRemote = ethers.randomBytes(20);
      
      const callData = lookCoin.interface.encodeFunctionData("setTrustedRemote", [
        dstChainId,
        trustedRemote
      ]);
      
      // Schedule
      await timelock.connect(proposer).schedule(
        await lookCoin.getAddress(),
        0,
        callData,
        MIN_DELAY
      );
      
      // Wait for delay
      await time.increase(MIN_DELAY);
      
      // Execute
      const operationId = await timelock.hashOperation(
        await lookCoin.getAddress(),
        0,
        callData
      );
      
      await expect(
        timelock.connect(executor).execute(
          await lookCoin.getAddress(),
          0,
          callData
        )
      ).to.emit(lookCoin, "PeerConnected");
    });
  });
});