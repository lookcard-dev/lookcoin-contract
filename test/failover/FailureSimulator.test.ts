import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { FailureSimulator } from "../../typechain-types";

describe("FailureSimulator Basic Tests", function () {
  let failureSimulator: FailureSimulator;
  let owner: SignerWithAddress;
  let operator: SignerWithAddress;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    owner = signers[0];
    operator = signers[1];

    // Deploy FailureSimulator
    const FailureSimulator = await ethers.getContractFactory("FailureSimulator");
    failureSimulator = await ethers.deployContract("FailureSimulator");
    await failureSimulator.waitForDeployment();
    await failureSimulator.initialize(owner.address);

    // Setup roles
    const FAILURE_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FAILURE_ADMIN_ROLE"));
    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    
    await failureSimulator.grantRole(FAILURE_ADMIN_ROLE, operator.address);
    await failureSimulator.grantRole(OPERATOR_ROLE, operator.address);
  });

  describe("Basic Functionality", function () {
    it("Should initialize with correct admin roles", async function () {
      const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
      expect(await failureSimulator.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should register and simulate oracle node failures", async function () {
      const oracleAddress = ethers.Wallet.createRandom().address;
      
      // Register oracle node
      await failureSimulator.connect(operator).registerOracleNode(oracleAddress);
      expect(await failureSimulator.isOracleHealthy(oracleAddress)).to.be.true;

      // Simulate failure
      await failureSimulator.connect(operator).simulateOracleFailure(oracleAddress, true, false, 0);
      expect(await failureSimulator.isOracleHealthy(oracleAddress)).to.be.false;

      // Recover
      await failureSimulator.connect(operator).recoverOracleNode(oracleAddress);
      expect(await failureSimulator.isOracleHealthy(oracleAddress)).to.be.true;
    });

    it("Should register and simulate RPC endpoint failures", async function () {
      const rpcId = ethers.keccak256(ethers.toUtf8Bytes("test_rpc"));
      
      // Register RPC endpoint
      await failureSimulator.connect(operator).registerRPCEndpoint(rpcId, "https://test.rpc");
      expect(await failureSimulator.isRPCHealthy(rpcId)).to.be.true;

      // Simulate failure
      await failureSimulator.connect(operator).simulateRPCFailure(rpcId, "Test failure");
      expect(await failureSimulator.isRPCHealthy(rpcId)).to.be.false;

      // Recover
      await failureSimulator.connect(operator).recoverRPCEndpoint(rpcId);
      expect(await failureSimulator.isRPCHealthy(rpcId)).to.be.true;
    });

    it("Should track recovery procedures with metrics", async function () {
      const procedureId = ethers.keccak256(ethers.toUtf8Bytes("test_procedure"));
      const rto = 300; // 5 minutes
      const rpo = 60;  // 1 minute

      // Start procedure
      await failureSimulator.connect(operator).startRecoveryProcedure(
        procedureId,
        "test_failure",
        rto,
        rpo
      );

      // Check metrics
      let metrics = await failureSimulator.getRecoveryMetrics(procedureId);
      expect(metrics.isRecovering).to.be.true;
      expect(metrics.rto).to.equal(rto);
      expect(metrics.rpo).to.equal(rpo);
      expect(metrics.failureType).to.equal("test_failure");

      // Complete procedure
      await failureSimulator.connect(operator).completeRecoveryProcedure(procedureId);

      // Check completion
      metrics = await failureSimulator.getRecoveryMetrics(procedureId);
      expect(metrics.isRecovering).to.be.false;
      expect(metrics.endTime).to.be.gt(metrics.startTime);
    });

    it("Should simulate and recover bridge protocol failures", async function () {
      const protocol = 0; // LayerZero

      // Set protocol as initially healthy (0% error rate, good latency)
      await failureSimulator.connect(operator).simulateProtocolFailure(protocol, 0, 100);
      await failureSimulator.connect(operator).recoverBridgeProtocol(protocol);
      expect(await failureSimulator.isProtocolHealthy(protocol)).to.be.true;

      // Simulate failure (100% error rate)
      await failureSimulator.connect(operator).simulateProtocolFailure(protocol, 100, 0);
      expect(await failureSimulator.isProtocolHealthy(protocol)).to.be.false;

      // Recover
      await failureSimulator.connect(operator).recoverBridgeProtocol(protocol);
      expect(await failureSimulator.isProtocolHealthy(protocol)).to.be.true;
    });

    it("Should handle network conditions simulation", async function () {
      const chainId = 31337;
      const latency = 1000;
      const packetLoss = 10;
      const jitter = 200;
      const bandwidth = 1000000;

      // Set network conditions
      await failureSimulator.connect(operator).setNetworkConditions(
        chainId,
        latency,
        packetLoss, 
        jitter,
        bandwidth
      );

      // Get conditions
      const conditions = await failureSimulator.getNetworkConditions(chainId);
      expect(conditions.latency).to.equal(latency);
      expect(conditions.packetLoss).to.equal(packetLoss);
      expect(conditions.jitter).to.equal(jitter);
      expect(conditions.bandwidth).to.equal(bandwidth);
      expect(conditions.isPartitioned).to.be.false;

      // Simulate partition
      await failureSimulator.connect(operator).simulateNetworkPartition([chainId], 300);
      expect(await failureSimulator.isNetworkPartitioned(chainId)).to.be.true;

      // Resolve partition
      await failureSimulator.connect(operator).resolveNetworkPartition([chainId]);
      expect(await failureSimulator.isNetworkPartitioned(chainId)).to.be.false;
    });
  });

  describe("Access Control", function () {
    it("Should restrict failure simulation to admin role", async function () {
      const unauthorizedUser = (await ethers.getSigners())[2];
      const oracleAddress = ethers.Wallet.createRandom().address;

      await expect(
        failureSimulator.connect(unauthorizedUser).simulateOracleFailure(oracleAddress, true, false, 0)
      ).to.be.revertedWithCustomError(failureSimulator, "AccessControlUnauthorizedAccount");
    });

    it("Should restrict recovery operations to operator role", async function () {
      const unauthorizedUser = (await ethers.getSigners())[2];
      const procedureId = ethers.keccak256(ethers.toUtf8Bytes("test"));

      await expect(
        failureSimulator.connect(unauthorizedUser).startRecoveryProcedure(procedureId, "test", 300, 60)
      ).to.be.revertedWithCustomError(failureSimulator, "AccessControlUnauthorizedAccount");
    });
  });
});