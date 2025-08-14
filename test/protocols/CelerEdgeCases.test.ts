import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  CelerIMModule,
  LookCoin,
  MockMessageBus,
  MockCBridge,
  MockSGN,
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
 * Celer IM Protocol Edge Case Test Suite
 * 
 * Tests protocol-specific vulnerabilities and edge cases unique to Celer IM:
 * - Message bus congestion handling
 * - Slippage tolerance exploitation
 * - Bridge fee calculation edge cases
 * - Executor validation bypass attempts
 * - Chain ID collision handling
 * 
 * Security Focus: Bridge fee manipulation, executor bypass, and message replay attacks
 */
describe("Celer IM Edge Cases - Protocol Security Validation", function () {
  let fixture: Awaited<ReturnType<typeof deployBridgeFixture>>;
  let celerIMModule: CelerIMModule;
  let lookCoin: LookCoin;
  let mockMessageBus: MockMessageBus;
  let mockCBridge: MockCBridge;
  let mockSGN: MockSGN;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let attacker: SignerWithAddress;
  let executor: SignerWithAddress;

  // Test constants for edge case scenarios
  const MALICIOUS_CHAIN_ID = 0xFFFFFFFFFFFFFFFFn;
  const CONGESTED_CHAIN_ID = CHAIN_IDS.BSC_MAINNET;
  const HIGH_FEE_PERCENTAGE = 10000; // 100%
  const ZERO_FEE_PERCENTAGE = 0;
  const MAX_SLIPPAGE = ethers.parseEther("1000000"); // 1M tokens slippage

  beforeEach(async function () {
    fixture = await loadFixture(deployBridgeFixture);
    celerIMModule = fixture.celerIMModule;
    lookCoin = fixture.lookCoin;
    mockMessageBus = fixture.mockCeler;
    admin = fixture.admin;
    user1 = fixture.user1;
    attacker = fixture.user2; // Repurpose user2 as attacker
    executor = fixture.bridgeOperator; // Use bridge operator as executor

    // Deploy additional mock contracts for edge case testing
    const MockCBridgeFactory = await ethers.getContractFactory("MockCBridge");
    mockCBridge = await MockCBridgeFactory.deploy();

    const MockSGNFactory = await ethers.getContractFactory("MockSGN");
    mockSGN = await MockSGNFactory.deploy();

    // Connect mocks to the message bus
    await mockMessageBus.setCBridge(await mockCBridge.getAddress());
    await mockMessageBus.setSGN(await mockSGN.getAddress());

    // Mint tokens for testing
    await lookCoin.connect(fixture.minter).mint(user1.address, AMOUNTS.MILLION_TOKENS);
    await lookCoin.connect(fixture.minter).mint(attacker.address, AMOUNTS.THOUSAND_TOKENS);

    // Configure supported chains and remotes
    await celerIMModule.connect(admin).setSupportedChain(CHAIN_IDS.BSC_MAINNET, true);
    await celerIMModule.connect(admin).setSupportedChain(CHAIN_IDS.OPTIMISM_SEPOLIA, true);
    await celerIMModule.connect(admin).setRemoteModule(CHAIN_IDS.BSC_MAINNET, await celerIMModule.getAddress());
    await celerIMModule.connect(admin).setRemoteModule(CHAIN_IDS.OPTIMISM_SEPOLIA, await celerIMModule.getAddress());

    // Set reasonable fee parameters
    await celerIMModule.connect(admin).setFeeParameters(
      50, // 0.5%
      ethers.parseEther("10"), // Min fee
      ethers.parseEther("1000"), // Max fee
      admin.address // Fee collector
    );
  });

  describe("Message Bus Congestion Handling Tests", function () {
    it("should handle high congestion fee calculation", async function () {
      // Simulate high network congestion
      await mockMessageBus.setCongestionLevel(100); // 100% congestion
      await mockMessageBus.setBaseFee(ethers.parseEther("10")); // Very high base fee
      
      await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Should calculate appropriate fee for congested network
      const bridgeFee = await celerIMModule.calculateBridgeFee(
        CONGESTED_CHAIN_ID,
        AMOUNTS.HUNDRED_TOKENS
      );
      
      // Bridge with high congestion fee
      await expect(
        celerIMModule.connect(user1).bridge(
          CONGESTED_CHAIN_ID,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x",
          { value: bridgeFee }
        )
      ).to.emit(celerIMModule, "BridgeInitiated")
      .withArgs(
        user1.address,
        user1.address,
        AMOUNTS.HUNDRED_TOKENS,
        CONGESTED_CHAIN_ID
      );
    });

    it("should prevent message timeout exploitation", async function () {
      // Set very short timeout for testing
      await mockMessageBus.setMessageTimeout(1); // 1 second
      
      await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      const tx = await celerIMModule.connect(user1).bridge(
        CHAIN_IDS.BSC_MAINNET,
        user1.address,
        AMOUNTS.HUNDRED_TOKENS,
        "0x",
        { value: ethers.parseEther("0.1") }
      );
      
      // Wait for timeout
      await time.increase(2);
      
      // Attacker tries to exploit timeout by claiming failed transfer
      const receipt = await tx.wait();
      const transferId = receipt!.logs[0].topics[1];
      
      await expect(
        celerIMModule.connect(attacker).claimTimeoutRefund(transferId)
      ).to.be.revertedWithCustomError(celerIMModule, "UnauthorizedRefundClaim");
    });

    it("should handle executor selection manipulation", async function () {
      // Malicious executor tries to self-assign
      await mockMessageBus.setMaliciousExecutor(attacker.address);
      
      await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      const tx = await celerIMModule.connect(user1).bridge(
        CHAIN_IDS.BSC_MAINNET,
        user1.address,
        AMOUNTS.HUNDRED_TOKENS,
        "0x",
        { value: ethers.parseEther("0.1") }
      );
      
      // Verify legitimate executor is selected, not malicious one
      const receipt = await tx.wait();
      const bridgeEvent = receipt!.logs.find(log => 
        log.topics[0] === ethers.id("BridgeInitiated(address,address,uint256,uint256)")
      );
      
      expect(bridgeEvent).to.not.be.undefined;
      // Executor should be legitimate, not attacker
      expect(await mockMessageBus.selectedExecutor()).to.not.equal(attacker.address);
    });

    it("should prevent queue overflow attacks", async function () {
      // Fill message queue to capacity
      const queueCapacity = 1000;
      await mockMessageBus.setQueueCapacity(queueCapacity);
      
      await lookCoin.connect(fixture.minter).mint(attacker.address, AMOUNTS.MILLION_TOKENS);
      await lookCoin.connect(attacker).approve(await celerIMModule.getAddress(), AMOUNTS.MILLION_TOKENS);
      
      // Attacker tries to overflow queue with many small transactions
      const smallAmount = ethers.parseEther("1");
      
      // Fill queue to near capacity
      for (let i = 0; i < queueCapacity - 1; i++) {
        await celerIMModule.connect(attacker).bridge(
          CHAIN_IDS.BSC_MAINNET,
          attacker.address,
          smallAmount,
          "0x",
          { value: ethers.parseEther("0.001") }
        );
      }
      
      // Next transaction should be rate limited
      await expect(
        celerIMModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x",
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWithCustomError(celerIMModule, "MessageQueueFull");
    });
  });

  describe("Slippage Tolerance Exploitation Tests", function () {
    it("should prevent maximum slippage exploitation", async function () {
      // Set up scenario where attacker manipulates price feeds
      await mockCBridge.setMaliciousPriceFeed(true);
      await mockCBridge.setSlippageMultiplier(ethers.parseEther("1000")); // 1000x slippage
      
      await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Should reject transfers with excessive slippage
      await expect(
        celerIMModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x",
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWithCustomError(celerIMModule, "ExcessiveSlippage");
    });

    it("should handle price feed manipulation attacks", async function () {
      // Mock price feed returns manipulated prices
      await mockCBridge.setPriceFeedManipulation(true);
      await mockCBridge.setManipulatedRate(ethers.parseEther("0.001")); // 1000:1 rate
      
      await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Should use fallback pricing mechanism
      const bridgeFee = await celerIMModule.calculateBridgeFee(
        CHAIN_IDS.BSC_MAINNET,
        AMOUNTS.HUNDRED_TOKENS
      );
      
      // Fee should be calculated with fallback, not manipulated rate
      expect(bridgeFee).to.be.gt(ethers.parseEther("0.01"));
      expect(bridgeFee).to.be.lt(ethers.parseEther("1"));
    });

    it("should prevent bridge rate manipulation", async function () {
      // Attacker tries to manipulate bridge exchange rate
      await mockCBridge.setMaliciousExchangeRate(true);
      
      await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      const initialBalance = await lookCoin.balanceOf(user1.address);
      
      const tx = await celerIMModule.connect(user1).bridge(
        CHAIN_IDS.BSC_MAINNET,
        user1.address,
        AMOUNTS.HUNDRED_TOKENS,
        "0x",
        { value: ethers.parseEther("0.1") }
      );
      
      // Verify correct amount was burned (not manipulated amount)
      const finalBalance = await lookCoin.balanceOf(user1.address);
      const burnedAmount = initialBalance - finalBalance;
      
      expect(burnedAmount).to.equal(AMOUNTS.HUNDRED_TOKENS);
    });

    it("should detect arbitrage attack vectors", async function () {
      // Set up price discrepancy between chains
      await mockCBridge.setChainPriceDiscrepancy(
        CHAIN_IDS.BSC_MAINNET,
        ethers.parseEther("1.5") // 50% higher price
      );
      
      await lookCoin.connect(attacker).approve(await celerIMModule.getAddress(), AMOUNTS.THOUSAND_TOKENS);
      
      // Large transfer to exploit arbitrage opportunity
      await expect(
        celerIMModule.connect(attacker).bridge(
          CHAIN_IDS.BSC_MAINNET,
          attacker.address,
          AMOUNTS.THOUSAND_TOKENS,
          "0x",
          { value: ethers.parseEther("1") }
        )
      ).to.be.revertedWithCustomError(celerIMModule, "ArbitrageDetected");
    });
  });

  describe("Bridge Fee Calculation Edge Cases", function () {
    it("should prevent fee calculation precision errors", async function () {
      // Test with very small amounts that might cause precision loss
      const microAmount = 999999999999999999n; // Just under 1 ether
      
      await lookCoin.connect(fixture.minter).mint(user1.address, microAmount);
      await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), microAmount);
      
      const bridgeFee = await celerIMModule.calculateBridgeFee(
        CHAIN_IDS.BSC_MAINNET,
        microAmount
      );
      
      // Fee should still be meaningful (above minimum)
      const minFee = await celerIMModule.minFee();
      expect(bridgeFee).to.be.gte(minFee);
      
      // Should handle precision without truncation
      await expect(
        celerIMModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          microAmount,
          "0x",
          { value: bridgeFee }
        )
      ).to.not.be.reverted;
    });

    it("should prevent minimum fee bypass attacks", async function () {
      // Set very low percentage fee
      await celerIMModule.connect(admin).setFeeParameters(
        1, // 0.01%
        ethers.parseEther("100"), // High min fee
        ethers.parseEther("1000"), // Max fee
        admin.address
      );
      
      // Try to bridge small amount to bypass min fee
      const smallAmount = ethers.parseEther("10");
      await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), smallAmount);
      
      const bridgeFee = await celerIMModule.calculateBridgeFee(
        CHAIN_IDS.BSC_MAINNET,
        smallAmount
      );
      
      const minFee = await celerIMModule.minFee();
      expect(bridgeFee).to.equal(minFee); // Should enforce minimum
      
      // Should require full minimum fee payment
      await expect(
        celerIMModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          smallAmount,
          "0x",
          { value: bridgeFee - 1n } // Try to pay 1 wei less
        )
      ).to.be.revertedWithCustomError(celerIMModule, "InsufficientBridgeFee");
    });

    it("should prevent maximum fee bypass attacks", async function () {
      // Set low max fee to test bypass
      await celerIMModule.connect(admin).setFeeParameters(
        1000, // 10%
        ethers.parseEther("1"), // Min fee
        ethers.parseEther("50"), // Low max fee
        admin.address
      );
      
      const largeAmount = ethers.parseEther("1000");
      await lookCoin.connect(fixture.minter).mint(user1.address, largeAmount);
      await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), largeAmount);
      
      const bridgeFee = await celerIMModule.calculateBridgeFee(
        CHAIN_IDS.BSC_MAINNET,
        largeAmount
      );
      
      const maxFee = await celerIMModule.maxFee();
      expect(bridgeFee).to.equal(maxFee); // Should cap at maximum
      
      // Transfer should succeed with capped fee
      await expect(
        celerIMModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          largeAmount,
          "0x",
          { value: bridgeFee }
        )
      ).to.emit(celerIMModule, "BridgeInitiated");
    });

    it("should prevent fee collector hijacking", async function () {
      const originalFeeCollector = admin.address;
      
      await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      const bridgeFee = await celerIMModule.calculateBridgeFee(
        CHAIN_IDS.BSC_MAINNET,
        AMOUNTS.HUNDRED_TOKENS
      );
      
      // Attacker tries to change fee collector mid-transaction
      const maliciousTx = celerIMModule.connect(attacker).setFeeParameters(
        50,
        ethers.parseEther("10"),
        ethers.parseEther("1000"),
        attacker.address // Malicious fee collector
      );
      
      // Should fail due to access control
      await expect(maliciousTx).to.be.revertedWithCustomError(
        celerIMModule,
        "AccessControlUnauthorizedAccount"
      );
      
      // Legitimate bridge should still use original fee collector
      const initialCollectorBalance = await ethers.provider.getBalance(originalFeeCollector);
      
      await celerIMModule.connect(user1).bridge(
        CHAIN_IDS.BSC_MAINNET,
        user1.address,
        AMOUNTS.HUNDRED_TOKENS,
        "0x",
        { value: bridgeFee }
      );
      
      const finalCollectorBalance = await ethers.provider.getBalance(originalFeeCollector);
      expect(finalCollectorBalance).to.be.gt(initialCollectorBalance);
    });
  });

  describe("Executor Validation Bypass Tests", function () {
    it("should prevent unauthorized executor attempts", async function () {
      const messagePayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.HUNDRED_TOKENS]
      );
      
      // Attacker tries to execute message without proper authorization
      await expect(
        celerIMModule.connect(attacker).executeMessageWithTransfer(
          await celerIMModule.getAddress(), // sender
          await lookCoin.getAddress(), // token
          AMOUNTS.HUNDRED_TOKENS, // amount
          CHAIN_IDS.BSC_MAINNET, // srcChainId
          messagePayload, // message
          attacker.address // executor (unauthorized)
        )
      ).to.be.revertedWithCustomError(celerIMModule, "UnauthorizedExecutor");
    });

    it("should prevent executor role hijacking", async function () {
      // Attacker tries to grant themselves executor role
      await expect(
        celerIMModule.connect(attacker).grantRole(
          await celerIMModule.OPERATOR_ROLE(),
          attacker.address
        )
      ).to.be.revertedWithCustomError(
        celerIMModule,
        "AccessControlUnauthorizedAccount"
      );
      
      // Verify attacker doesn't have executor role
      expect(
        await celerIMModule.hasRole(
          await celerIMModule.OPERATOR_ROLE(),
          attacker.address
        )
      ).to.be.false;
    });

    it("should prevent signature validation bypass", async function () {
      // Mock SGN with invalid signature validation
      await mockSGN.setInvalidSignatureMode(true);
      
      const messagePayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [attacker.address, AMOUNTS.MILLION_TOKENS]
      );
      
      // Should reject execution with invalid signature
      await expect(
        celerIMModule.executeMessageWithTransfer(
          await celerIMModule.getAddress(),
          await lookCoin.getAddress(),
          AMOUNTS.MILLION_TOKENS,
          CHAIN_IDS.BSC_MAINNET,
          messagePayload,
          executor.address
        )
      ).to.be.revertedWithCustomError(celerIMModule, "InvalidExecutorSignature");
    });

    it("should prevent message execution replay", async function () {
      const messagePayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.HUNDRED_TOKENS]
      );
      
      const transferId = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint64"],
          [user1.address, AMOUNTS.HUNDRED_TOKENS, CHAIN_IDS.BSC_MAINNET]
        )
      );
      
      // Execute message once
      await celerIMModule.executeMessageWithTransfer(
        await celerIMModule.getAddress(),
        await lookCoin.getAddress(),
        AMOUNTS.HUNDRED_TOKENS,
        CHAIN_IDS.BSC_MAINNET,
        messagePayload,
        executor.address
      );
      
      // Try to replay same message
      await expect(
        celerIMModule.executeMessageWithTransfer(
          await celerIMModule.getAddress(),
          await lookCoin.getAddress(),
          AMOUNTS.HUNDRED_TOKENS,
          CHAIN_IDS.BSC_MAINNET,
          messagePayload,
          executor.address
        )
      ).to.be.revertedWithCustomError(celerIMModule, "TransferAlreadyProcessed");
    });
  });

  describe("Chain ID Collision Handling Tests", function () {
    it("should handle invalid chain ID attacks", async function () {
      await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Try to bridge to invalid chain ID
      await expect(
        celerIMModule.connect(user1).bridge(
          INVALID_CHAIN_ID,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x"
        )
      ).to.be.revertedWithCustomError(celerIMModule, "UnsupportedChain");
    });

    it("should prevent cross-chain message routing attacks", async function () {
      // Set up conflicting remote modules
      await celerIMModule.connect(admin).setRemoteModule(CHAIN_IDS.BSC_MAINNET, attacker.address);
      
      const messagePayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [attacker.address, AMOUNTS.MILLION_TOKENS]
      );
      
      // Message from malicious remote should be rejected
      await expect(
        celerIMModule.executeMessageWithTransfer(
          attacker.address, // Malicious sender
          await lookCoin.getAddress(),
          AMOUNTS.MILLION_TOKENS,
          CHAIN_IDS.BSC_MAINNET,
          messagePayload,
          executor.address
        )
      ).to.be.revertedWithCustomError(celerIMModule, "UntrustedRemoteSender");
    });

    it("should prevent chain ID spoofing attempts", async function () {
      const messagePayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [attacker.address, AMOUNTS.MILLION_TOKENS]
      );
      
      // Attacker tries to spoof message from high-value chain
      await expect(
        celerIMModule.executeMessageWithTransfer(
          await celerIMModule.getAddress(),
          await lookCoin.getAddress(),
          AMOUNTS.MILLION_TOKENS,
          Number(MALICIOUS_CHAIN_ID), // Spoofed chain ID
          messagePayload,
          executor.address
        )
      ).to.be.revertedWithCustomError(celerIMModule, "InvalidSourceChain");
    });

    it("should handle multi-chain state inconsistency", async function () {
      // Simulate state where same transfer appears on multiple chains
      const messagePayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.HUNDRED_TOKENS]
      );
      
      // Execute on first chain
      await celerIMModule.executeMessageWithTransfer(
        await celerIMModule.getAddress(),
        await lookCoin.getAddress(),
        AMOUNTS.HUNDRED_TOKENS,
        CHAIN_IDS.BSC_MAINNET,
        messagePayload,
        executor.address
      );
      
      // Try to execute same transfer from different chain
      await expect(
        celerIMModule.executeMessageWithTransfer(
          await celerIMModule.getAddress(),
          await lookCoin.getAddress(),
          AMOUNTS.HUNDRED_TOKENS,
          CHAIN_IDS.OPTIMISM_SEPOLIA,
          messagePayload,
          executor.address
        )
      ).to.be.revertedWithCustomError(celerIMModule, "DuplicateTransferDetected");
    });
  });

  describe("Gas Analysis and Performance Edge Cases", function () {
    it("should handle gas estimation edge cases", async function () {
      // Test with complex message payload
      const complexPayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address[]", "uint256[]", "bytes"],
        [
          [user1.address, attacker.address], // Multiple recipients
          [AMOUNTS.HUNDRED_TOKENS, AMOUNTS.FIFTY_TOKENS], // Multiple amounts
          "0x" + "00".repeat(1000) // Large data
        ]
      );
      
      await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Should handle complex payload without gas issues
      const tx = await celerIMModule.connect(user1).bridge(
        CHAIN_IDS.BSC_MAINNET,
        user1.address,
        AMOUNTS.HUNDRED_TOKENS,
        complexPayload,
        { value: ethers.parseEther("0.1") }
      );
      
      const receipt = await tx.wait();
      expect(receipt!.gasUsed).to.be.lt(500000); // Reasonable gas usage
    });

    it("should handle maximum message size", async function () {
      // Create maximum size message
      const maxPayload = "0x" + "ff".repeat(65536); // 64KB payload
      
      await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      await expect(
        celerIMModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          maxPayload,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWithCustomError(celerIMModule, "MessageTooLarge");
    });

    it("should handle concurrent transfer limits", async function () {
      const concurrentLimit = 100;
      await celerIMModule.connect(admin).setConcurrentTransferLimit(concurrentLimit);
      
      await lookCoin.connect(fixture.minter).mint(attacker.address, AMOUNTS.MILLION_TOKENS);
      await lookCoin.connect(attacker).approve(await celerIMModule.getAddress(), AMOUNTS.MILLION_TOKENS);
      
      // Fill concurrent transfer slots
      for (let i = 0; i < concurrentLimit; i++) {
        await celerIMModule.connect(attacker).bridge(
          CHAIN_IDS.BSC_MAINNET,
          attacker.address,
          ethers.parseEther("1"),
          "0x",
          { value: ethers.parseEther("0.001") }
        );
      }
      
      // Next transfer should be rate limited
      await expect(
        celerIMModule.connect(user1).bridge(
          CHAIN_IDS.BSC_MAINNET,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x",
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWithCustomError(celerIMModule, "ConcurrentTransferLimitExceeded");
    });
  });
});