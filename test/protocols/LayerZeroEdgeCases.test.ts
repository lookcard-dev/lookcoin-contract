import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  LayerZeroModule,
  LookCoin,
  MockLayerZeroEndpoint,
  MockDVN,
  MockUltraLightNode,
} from "../../typechain-types";
import { deployBridgeFixture } from "../helpers/fixtures";
import {
  CONTRACT_ROLES,
  AMOUNTS,
  TEST_ADDRESSES,
  ERROR_MESSAGES,
  CHAIN_IDS,
} from "../helpers/constants";
import {
  expectSpecificRevert,
  testRoleBasedFunction,
} from "../helpers/utils";

/**
 * LayerZero Protocol Edge Case Test Suite
 * 
 * Tests protocol-specific vulnerabilities and edge cases unique to LayerZero V2:
 * - DVN configuration attacks and validation
 * - Executor fee manipulation attempts
 * - Non-blocking receiver patterns testing
 * - Packet ordering violations
 * - Endpoint upgrade compatibility issues
 * 
 * Security Focus: Think like an attacker - test every possible manipulation vector
 */
describe("LayerZero Edge Cases - Protocol Security Validation", function () {
  let fixture: Awaited<ReturnType<typeof deployBridgeFixture>>;
  let layerZeroModule: LayerZeroModule;
  let lookCoin: LookCoin;
  let mockLayerZero: MockLayerZeroEndpoint;
  let mockDVN: MockDVN;
  let mockUltraLightNode: MockUltraLightNode;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let attacker: SignerWithAddress;
  let bridgeOperator: SignerWithAddress;

  // Test constants for edge case scenarios
  const MALICIOUS_EID = 999999;
  const INVALID_CHAIN_ID = 0;
  const MAX_UINT32 = 2n ** 32n - 1n;
  const LARGE_AMOUNT = ethers.parseEther("1000000");
  const DUST_AMOUNT = 1n;

  beforeEach(async function () {
    fixture = await loadFixture(deployBridgeFixture);
    layerZeroModule = fixture.layerZeroModule;
    lookCoin = fixture.lookCoin;
    mockLayerZero = fixture.mockLayerZero;
    admin = fixture.admin;
    user1 = fixture.user1;
    attacker = fixture.user2; // Repurpose user2 as attacker for clarity
    bridgeOperator = fixture.bridgeOperator;

    // Deploy additional mock contracts for edge case testing
    const MockDVNFactory = await ethers.getContractFactory("MockDVN");
    mockDVN = await MockDVNFactory.deploy();

    const MockUltraLightNodeFactory = await ethers.getContractFactory("MockUltraLightNode");
    mockUltraLightNode = await MockUltraLightNodeFactory.deploy(1); // Pass chain ID

    // Set up mock LayerZero with UltraLightNode
    await mockLayerZero.setUltraLightNode(await mockUltraLightNode.getAddress());

    // Mint tokens for testing
    await lookCoin.connect(fixture.minter).mint(user1.address, AMOUNTS.MILLION_TOKENS);
    await lookCoin.connect(fixture.minter).mint(attacker.address, AMOUNTS.THOUSAND_TOKENS);

    // Configure chain mappings for testing
    await layerZeroModule.connect(admin).updateChainMapping(30102, CHAIN_IDS.BSC_MAINNET);
    await layerZeroModule.connect(admin).updateChainMapping(30184, CHAIN_IDS.BASE_SEPOLIA);
  });

  describe("DVN Configuration Security Tests", function () {
    beforeEach(async function () {
      // Configure trusted remote for testing
      const trustedRemote = ethers.solidityPackedKeccak256(
        ["address"],
        [await layerZeroModule.getAddress()]
      );
      await layerZeroModule.connect(admin).setTrustedRemote(30102, trustedRemote);
    });

    it("should prevent DVN address injection attacks", async function () {
      const maliciousDVNAddress = attacker.address;
      
      // Attempt to set malicious DVN through mock endpoint
      await mockLayerZero.setMaliciousDVN(maliciousDVNAddress);
      
      // Bridge attempt should fail with invalid DVN
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      await expect(
        layerZeroModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x"
        )
      ).to.be.revertedWithCustomError(layerZeroModule, "InvalidDVNConfiguration");
    });

    it("should validate DVN signatures properly", async function () {
      // Set up DVN with invalid signature capability
      await mockDVN.setInvalidSignatureMode(true);
      await mockLayerZero.setDVN(await mockDVN.getAddress());
      
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Should reject invalid DVN signatures
      await expect(
        layerZeroModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x"
        )
      ).to.be.revertedWithCustomError(layerZeroModule, "DVNSignatureValidationFailed");
    });

    it("should prevent DVN configuration tampering during transfer", async function () {
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Start bridge operation
      const bridgePromise = layerZeroModule.connect(user1).bridge(
        CHAIN_IDS.BSC_MAINNET,
        user1.address,
        AMOUNTS.HUNDRED_TOKENS,
        "0x"
      );
      
      // Attempt to change DVN configuration mid-flight
      await mockLayerZero.setDVN(attacker.address);
      
      // Original transaction should complete with original DVN
      const tx = await bridgePromise;
      const receipt = await tx.wait();
      
      // Verify transfer completed with original DVN configuration
      expect(receipt).to.not.be.null;
      const transferId = receipt!.logs[0].topics[1];
      const transfer = await layerZeroModule.transfers(transferId);
      expect(transfer.status).to.equal(0); // BridgeStatus.Initiated
    });

    it("should handle multiple DVN coordination attacks", async function () {
      // Set up multiple conflicting DVNs
      const dvn1 = await (await ethers.getContractFactory("MockDVN")).deploy();
      const dvn2 = await (await ethers.getContractFactory("MockDVN")).deploy();
      
      await dvn1.setConflictingBehavior(true);
      await dvn2.setConflictingBehavior(true);
      
      await mockLayerZero.setMultipleDVNs([await dvn1.getAddress(), await dvn2.getAddress()]);
      
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Should handle conflicting DVN responses gracefully
      await expect(
        layerZeroModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x"
        )
      ).to.be.revertedWithCustomError(layerZeroModule, "DVNCoordinationFailure");
    });
  });

  describe("Executor Fee Manipulation Tests", function () {
    beforeEach(async function () {
      const trustedRemote = ethers.solidityPackedKeccak256(
        ["address"],
        [await layerZeroModule.getAddress()]
      );
      await layerZeroModule.connect(admin).setTrustedRemote(30102, trustedRemote);
    });

    it("should prevent fee calculation overflow attacks", async function () {
      // Set extremely high gas price to cause overflow
      await mockLayerZero.setGasPrice(ethers.MaxUint256);
      
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      await expect(
        layerZeroModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x",
          { value: ethers.parseEther("1") }
        )
      ).to.be.revertedWithCustomError(layerZeroModule, "FeeCalculationOverflow");
    });

    it("should prevent fee calculation underflow attacks", async function () {
      // Set negative gas price (impossible but test edge case)
      await mockLayerZero.setMaliciousFee(true, 0);
      
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      await expect(
        layerZeroModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x"
        )
      ).to.be.revertedWithCustomError(layerZeroModule, "InvalidFeeCalculation");
    });

    it("should prevent refund address hijacking", async function () {
      const maliciousRefundAddress = attacker.address;
      
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Mock LayerZero attempts to change refund address
      await mockLayerZero.setMaliciousRefundAddress(maliciousRefundAddress);
      
      const tx = await layerZeroModule.connect(user1).bridge(
        CHAIN_IDS.BSC_MAINNET,
        user1.address,
        AMOUNTS.HUNDRED_TOKENS,
        "0x",
        { value: ethers.parseEther("0.1") }
      );
      
      // Verify refund goes to original sender, not attacker
      const receipt = await tx.wait();
      const refundEvent = receipt!.logs.find(log => 
        log.topics[0] === ethers.id("RefundProcessed(address,uint256)")
      );
      
      if (refundEvent) {
        const decodedRefund = ethers.AbiCoder.defaultAbiCoder().decode(
          ["address", "uint256"],
          refundEvent.data
        );
        expect(decodedRefund[0]).to.equal(user1.address);
        expect(decodedRefund[0]).to.not.equal(maliciousRefundAddress);
      }
    });

    it("should prevent fee payment token switching attacks", async function () {
      // Mock LZ token payment attempt
      await mockLayerZero.setPayInLzToken(true);
      
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Should only accept native ETH payments, not LZ tokens
      await expect(
        layerZeroModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x"
        )
      ).to.be.revertedWithCustomError(layerZeroModule, "InvalidPaymentToken");
    });
  });

  describe("Non-blocking Receiver Pattern Tests", function () {
    beforeEach(async function () {
      const trustedRemote = ethers.solidityPackedKeccak256(
        ["address"],
        [await layerZeroModule.getAddress()]
      );
      await layerZeroModule.connect(admin).setTrustedRemote(30102, trustedRemote);
    });

    it("should handle failed message execution gracefully", async function () {
      // Configure mock to fail message execution
      await mockLayerZero.setMessageExecutionFailure(true);
      
      const messagePayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.HUNDRED_TOKENS]
      );
      
      // Simulate message reception that will fail
      await expect(
        layerZeroModule.lzReceive(
          30102, // Source EID
          ethers.solidityPacked(["address"], [await layerZeroModule.getAddress()]),
          1, // Nonce
          messagePayload
        )
      ).to.emit(layerZeroModule, "MessageExecutionFailed")
      .withArgs(30102, 1, "Execution failed");
      
      // Verify message is queued for retry
      const storedPayload = await layerZeroModule.storedPayloads(30102, 1);
      expect(storedPayload).to.not.equal("0x");
    });

    it("should prevent message retry exploitation", async function () {
      const messagePayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.HUNDRED_TOKENS]
      );
      
      // Store a failed message
      await mockLayerZero.setMessageExecutionFailure(true);
      await layerZeroModule.lzReceive(
        30102,
        ethers.solidityPacked(["address"], [await layerZeroModule.getAddress()]),
        1,
        messagePayload
      );
      
      // Attacker tries to retry with different payload
      const maliciousPayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [attacker.address, AMOUNTS.MILLION_TOKENS]
      );
      
      await expect(
        layerZeroModule.connect(attacker).retryMessage(30102, 1, maliciousPayload)
      ).to.be.revertedWithCustomError(layerZeroModule, "InvalidRetryPayload");
    });

    it("should prevent storage collision in retry queues", async function () {
      const payload1 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.HUNDRED_TOKENS]
      );
      
      const payload2 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [attacker.address, AMOUNTS.THOUSAND_TOKENS]
      );
      
      // Store multiple failed messages with same nonce from different chains
      await mockLayerZero.setMessageExecutionFailure(true);
      
      await layerZeroModule.lzReceive(30102, ethers.solidityPacked(["address"], [await layerZeroModule.getAddress()]), 1, payload1);
      await layerZeroModule.lzReceive(30184, ethers.solidityPacked(["address"], [await layerZeroModule.getAddress()]), 1, payload2);
      
      // Verify both messages are stored separately
      const stored1 = await layerZeroModule.storedPayloads(30102, 1);
      const stored2 = await layerZeroModule.storedPayloads(30184, 1);
      
      expect(stored1).to.not.equal(stored2);
      expect(stored1).to.equal(payload1);
      expect(stored2).to.equal(payload2);
    });
  });

  describe("Packet Ordering Violation Tests", function () {
    beforeEach(async function () {
      const trustedRemote = ethers.solidityPackedKeccak256(
        ["address"],
        [await layerZeroModule.getAddress()]
      );
      await layerZeroModule.connect(admin).setTrustedRemote(30102, trustedRemote);
    });

    it("should handle out-of-order packet delivery", async function () {
      const payload1 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.HUNDRED_TOKENS]
      );
      
      const payload2 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.FIFTY_TOKENS]
      );
      
      // Receive packet 2 before packet 1 (out of order)
      await layerZeroModule.lzReceive(
        30102,
        ethers.solidityPacked(["address"], [await layerZeroModule.getAddress()]),
        2, // Nonce 2 first
        payload2
      );
      
      // Should queue packet 2 for later processing
      expect(await layerZeroModule.storedPayloads(30102, 2)).to.equal(payload2);
      
      // Now receive packet 1
      await layerZeroModule.lzReceive(
        30102,
        ethers.solidityPacked(["address"], [await layerZeroModule.getAddress()]),
        1, // Nonce 1 second
        payload1
      );
      
      // Both packets should now be processed in order
      expect(await layerZeroModule.storedPayloads(30102, 1)).to.equal("0x");
      expect(await layerZeroModule.storedPayloads(30102, 2)).to.equal("0x");
    });

    it("should prevent nonce manipulation attacks", async function () {
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [attacker.address, AMOUNTS.MILLION_TOKENS]
      );
      
      // Attacker tries to send packet with very high nonce
      await expect(
        layerZeroModule.lzReceive(
          30102,
          ethers.solidityPacked(["address"], [await layerZeroModule.getAddress()]),
          999999, // Extremely high nonce
          payload
        )
      ).to.be.revertedWithCustomError(layerZeroModule, "InvalidNonceSequence");
    });

    it("should detect duplicate nonce processing attempts", async function () {
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.HUNDRED_TOKENS]
      );
      
      // Process message with nonce 1
      await layerZeroModule.lzReceive(
        30102,
        ethers.solidityPacked(["address"], [await layerZeroModule.getAddress()]),
        1,
        payload
      );
      
      // Attempt to process same nonce again
      await expect(
        layerZeroModule.lzReceive(
          30102,
          ethers.solidityPacked(["address"], [await layerZeroModule.getAddress()]),
          1, // Same nonce
          payload
        )
      ).to.be.revertedWithCustomError(layerZeroModule, "DuplicateNonceProcessing");
    });
  });

  describe("Endpoint Upgrade Compatibility Tests", function () {
    it("should handle version mismatch attacks", async function () {
      // Deploy new mock endpoint with different version
      const NewMockLayerZeroFactory = await ethers.getContractFactory("MockLayerZeroEndpoint");
      const newMockLayerZero = await NewMockLayerZeroFactory.deploy();
      
      // Set incompatible version
      await newMockLayerZero.setIncompatibleVersion(true);
      
      // Attempt to use module with incompatible endpoint
      await expect(
        layerZeroModule.connect(admin).updateEndpoint(await newMockLayerZero.getAddress())
      ).to.be.revertedWithCustomError(layerZeroModule, "IncompatibleEndpointVersion");
    });

    it("should prevent deprecated function call exploitation", async function () {
      // Mock endpoint with deprecated functions
      await mockLayerZero.setDeprecatedFunctionMode(true);
      
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      const trustedRemote = ethers.solidityPackedKeccak256(
        ["address"],
        [await layerZeroModule.getAddress()]
      );
      await layerZeroModule.connect(admin).setTrustedRemote(30102, trustedRemote);
      
      // Should fail when endpoint uses deprecated functions
      await expect(
        layerZeroModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x"
        )
      ).to.be.revertedWithCustomError(layerZeroModule, "DeprecatedFunctionCall");
    });

    it("should handle interface compatibility validation", async function () {
      // Mock endpoint that doesn't implement required interface
      const IncompatibleEndpointFactory = await ethers.getContractFactory("MockNetworkSimulator");
      const incompatibleEndpoint = await IncompatibleEndpointFactory.deploy();
      
      // Should detect interface incompatibility
      await expect(
        layerZeroModule.connect(admin).updateEndpoint(await incompatibleEndpoint.getAddress())
      ).to.be.revertedWithCustomError(layerZeroModule, "InterfaceNotSupported");
    });

    it("should prevent upgrade state corruption", async function () {
      // Start a bridge transaction
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      const trustedRemote = ethers.solidityPackedKeccak256(
        ["address"],
        [await layerZeroModule.getAddress()]
      );
      await layerZeroModule.connect(admin).setTrustedRemote(30102, trustedRemote);
      
      const tx = await layerZeroModule.connect(user1).bridge(
        CHAIN_IDS.BSC_MAINNET,
        user1.address,
        AMOUNTS.HUNDRED_TOKENS,
        "0x"
      );
      
      const receipt = await tx.wait();
      const transferId = receipt!.logs[0].topics[1];
      
      // Attempt endpoint upgrade during active transfer
      const NewMockLayerZeroFactory = await ethers.getContractFactory("MockLayerZeroEndpoint");
      const newMockLayerZero = await NewMockLayerZeroFactory.deploy();
      
      await expect(
        layerZeroModule.connect(admin).updateEndpoint(await newMockLayerZero.getAddress())
      ).to.be.revertedWithCustomError(layerZeroModule, "ActiveTransfersExist");
      
      // Verify original transfer state is preserved
      const transfer = await layerZeroModule.transfers(transferId);
      expect(transfer.status).to.equal(0); // Still initiated
    });
  });

  describe("Gas Analysis and Performance Edge Cases", function () {
    it("should handle gas limit edge cases", async function () {
      const trustedRemote = ethers.solidityPackedKeccak256(
        ["address"],
        [await layerZeroModule.getAddress()]
      );
      await layerZeroModule.connect(admin).setTrustedRemote(30102, trustedRemote);
      
      // Set extremely low gas limit
      await layerZeroModule.connect(admin).setDefaultGasLimit(1);
      
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      await expect(
        layerZeroModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x"
        )
      ).to.be.revertedWithCustomError(layerZeroModule, "InsufficientGasLimit");
    });

    it("should handle maximum transfer amounts", async function () {
      const trustedRemote = ethers.solidityPackedKeccak256(
        ["address"],
        [await layerZeroModule.getAddress()]
      );
      await layerZeroModule.connect(admin).setTrustedRemote(30102, trustedRemote);
      
      // Mint maximum possible amount
      const maxAmount = ethers.parseEther("5000000000"); // 5B tokens
      await lookCoin.connect(fixture.minter).mint(user1.address, maxAmount);
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), maxAmount);
      
      // Should handle maximum transfer without overflow
      const tx = await layerZeroModule.connect(user1).bridge(
        CHAIN_IDS.BSC_MAINNET,
        user1.address,
        maxAmount,
        "0x",
        { value: ethers.parseEther("0.1") }
      );
      
      const receipt = await tx.wait();
      expect(receipt).to.not.be.null;
    });

    it("should handle dust amount transfers", async function () {
      const trustedRemote = ethers.solidityPackedKeccak256(
        ["address"],
        [await layerZeroModule.getAddress()]
      );
      await layerZeroModule.connect(admin).setTrustedRemote(30102, trustedRemote);
      
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), DUST_AMOUNT);
      
      // Should handle 1 wei transfers
      const tx = await layerZeroModule.connect(user1).bridge(
        CHAIN_IDS.BSC_MAINNET,
        user1.address,
        DUST_AMOUNT,
        "0x",
        { value: ethers.parseEther("0.01") }
      );
      
      const receipt = await tx.wait();
      expect(receipt).to.not.be.null;
    });
  });
});