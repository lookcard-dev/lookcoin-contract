import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  HyperlaneModule,
  LookCoin,
  MockHyperlaneMailbox,
  MockHyperlaneGasPaymaster,
  MockInterchainSecurityModule,
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
 * Hyperlane Protocol Edge Case Test Suite
 * 
 * Tests protocol-specific vulnerabilities and edge cases unique to Hyperlane:
 * - ISM (Interchain Security Module) configuration attacks
 * - Validator set manipulation attempts
 * - Gas payment verification bypass
 * - Domain routing attacks
 * - Message aggregation issues
 * 
 * Security Focus: Validator collusion, ISM bypass, and cross-domain message injection
 */
describe("Hyperlane Edge Cases - Protocol Security Validation", function () {
  let fixture: Awaited<ReturnType<typeof deployBridgeFixture>>;
  let hyperlaneModule: HyperlaneModule;
  let lookCoin: LookCoin;
  let mockMailbox: MockHyperlaneMailbox;
  let mockGasPaymaster: MockHyperlaneGasPaymaster;
  let mockISM: MockInterchainSecurityModule;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let attacker: SignerWithAddress;
  let validator1: SignerWithAddress;
  let validator2: SignerWithAddress;
  let validator3: SignerWithAddress;

  // Test constants for edge case scenarios
  const AKASHIC_DOMAIN = 9070;
  const BSC_DOMAIN = 56;
  const MALICIOUS_DOMAIN = 0xFFFFFFFF;
  const INVALID_DOMAIN = 0;
  const MAX_VALIDATORS = 20;
  const MIN_THRESHOLD = 3;

  beforeEach(async function () {
    fixture = await loadFixture(deployBridgeFixture);
    hyperlaneModule = fixture.hyperlaneModule;
    lookCoin = fixture.lookCoin;
    mockMailbox = fixture.mockHyperlane;
    mockGasPaymaster = fixture.mockHyperlaneGasPaymaster;
    admin = fixture.admin;
    user1 = fixture.user1;
    attacker = fixture.user2; // Repurpose user2 as attacker
    
    // Set up additional validators for testing
    const signers = await ethers.getSigners();
    validator1 = signers[5];
    validator2 = signers[6];
    validator3 = signers[7];

    // Deploy mock ISM for testing
    const MockISMFactory = await ethers.getContractFactory("MockInterchainSecurityModule");
    mockISM = await MockISMFactory.deploy();

    // Configure Hyperlane module with mocks
    await mockMailbox.setInterchainSecurityModule(await mockISM.getAddress());
    
    // Mint tokens for testing
    await lookCoin.connect(fixture.minter).mint(user1.address, AMOUNTS.MILLION_TOKENS);
    await lookCoin.connect(fixture.minter).mint(attacker.address, AMOUNTS.THOUSAND_TOKENS);

    // Configure domain mappings
    await hyperlaneModule.connect(admin).setDomainMapping(AKASHIC_DOMAIN, CHAIN_IDS.AKASHIC);
    await hyperlaneModule.connect(admin).setDomainMapping(BSC_DOMAIN, CHAIN_IDS.BSC_MAINNET);
    
    // Set trusted senders
    const trustedSender = ethers.solidityPackedKeccak256(
      ["address"],
      [await hyperlaneModule.getAddress()]
    );
    await hyperlaneModule.connect(admin).setTrustedSender(AKASHIC_DOMAIN, trustedSender);
    await hyperlaneModule.connect(admin).setTrustedSender(BSC_DOMAIN, trustedSender);

    // Configure ISM with validators
    await mockISM.setValidators([validator1.address, validator2.address, validator3.address]);
    await mockISM.setThreshold(MIN_THRESHOLD);
  });

  describe("ISM Configuration Security Tests", function () {
    it("should prevent ISM module injection attacks", async function () {
      // Attacker deploys malicious ISM
      const MaliciousISMFactory = await ethers.getContractFactory("MockInterchainSecurityModule");
      const maliciousISM = await MaliciousISMFactory.deploy();
      
      // Configure malicious ISM to always return true
      await maliciousISM.setAlwaysVerify(true);
      
      // Attempt to set malicious ISM
      await expect(
        hyperlaneModule.connect(attacker).setInterchainSecurityModule(await maliciousISM.getAddress())
      ).to.be.revertedWithCustomError(hyperlaneModule, "AccessControlUnauthorizedAccount");
    });

    it("should validate ISM integrity before accepting", async function () {
      // Create ISM with invalid configuration
      const invalidISM = await (await ethers.getContractFactory("MockInterchainSecurityModule")).deploy();
      await invalidISM.setInvalidConfiguration(true);
      
      // Should reject invalid ISM configuration
      await expect(
        hyperlaneModule.connect(admin).setInterchainSecurityModule(await invalidISM.getAddress())
      ).to.be.revertedWithCustomError(hyperlaneModule, "InvalidISMConfiguration");
    });

    it("should prevent ISM validation bypass", async function () {
      // Configure ISM to fail verification
      await mockISM.setVerificationFailure(true);
      
      const messagePayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [attacker.address, AMOUNTS.MILLION_TOKENS]
      );
      
      // Message should be rejected by ISM
      await expect(
        hyperlaneModule.handle(
          AKASHIC_DOMAIN,
          ethers.solidityPackedKeccak256(["address"], [await hyperlaneModule.getAddress()]),
          messagePayload
        )
      ).to.be.revertedWithCustomError(hyperlaneModule, "ISMVerificationFailed");
    });

    it("should handle ISM upgrade attacks", async function () {
      // Start bridge operation
      await lookCoin.connect(user1).approve(await hyperlaneModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      const tx = await hyperlaneModule.connect(user1).bridge(
        CHAIN_IDS.AKASHIC,
        user1.address,
        AMOUNTS.HUNDRED_TOKENS,
        "0x",
        { value: ethers.parseEther("0.1") }
      );
      
      // Attacker tries to upgrade ISM during transfer
      const newISM = await (await ethers.getContractFactory("MockInterchainSecurityModule")).deploy();
      await newISM.setMaliciousBehavior(true);
      
      await expect(
        hyperlaneModule.connect(admin).setInterchainSecurityModule(await newISM.getAddress())
      ).to.be.revertedWithCustomError(hyperlaneModule, "ActiveTransfersExist");
      
      // Verify original transfer completed with original ISM
      const receipt = await tx.wait();
      expect(receipt).to.not.be.null;
    });
  });

  describe("Validator Set Manipulation Tests", function () {
    it("should prevent invalid validator signature injection", async function () {
      // Configure ISM with malicious validator signatures
      const maliciousSignatures = [
        ethers.randomBytes(65), // Invalid signature length
        "0x" + "00".repeat(65),   // All zeros
        "0x" + "ff".repeat(65)    // All ones
      ];
      
      await mockISM.setMaliciousSignatures(maliciousSignatures);
      
      const messagePayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.HUNDRED_TOKENS]
      );
      
      // Should reject message with invalid signatures
      await expect(
        hyperlaneModule.handle(
          AKASHIC_DOMAIN,
          ethers.solidityPackedKeccak256(["address"], [await hyperlaneModule.getAddress()]),
          messagePayload
        )
      ).to.be.revertedWithCustomError(hyperlaneModule, "InvalidValidatorSignatures");
    });

    it("should prevent validator set corruption", async function () {
      // Attempt to corrupt validator set
      const corruptValidators = [
        ethers.ZeroAddress,
        attacker.address,
        user1.address
      ];
      
      await expect(
        mockISM.setValidators(corruptValidators)
      ).to.be.revertedWithCustomError(mockISM, "InvalidValidatorSet");
    });

    it("should prevent threshold manipulation attacks", async function () {
      // Try to set threshold higher than validator count
      const validatorCount = await mockISM.validatorCount();
      
      await expect(
        mockISM.setThreshold(Number(validatorCount) + 1)
      ).to.be.revertedWithCustomError(mockISM, "InvalidThreshold");
      
      // Try to set zero threshold
      await expect(
        mockISM.setThreshold(0)
      ).to.be.revertedWithCustomError(mockISM, "InvalidThreshold");
    });

    it("should detect validator collusion scenarios", async function () {
      // Set up scenario where subset of validators collude
      await mockISM.setCollusionMode(true);
      await mockISM.setColludingValidators([validator1.address, validator2.address]);
      
      const messagePayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [attacker.address, AMOUNTS.MILLION_TOKENS]
      );
      
      // Should detect and reject collusive behavior
      await expect(
        hyperlaneModule.handle(
          AKASHIC_DOMAIN,
          ethers.solidityPackedKeccak256(["address"], [await hyperlaneModule.getAddress()]),
          messagePayload
        )
      ).to.be.revertedWithCustomError(hyperlaneModule, "ValidatorCollusionDetected");
    });

    it("should handle validator rotation attacks", async function () {
      const messagePayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.HUNDRED_TOKENS]
      );
      
      // Start message processing
      const handlePromise = hyperlaneModule.handle(
        AKASHIC_DOMAIN,
        ethers.solidityPackedKeccak256(["address"], [await hyperlaneModule.getAddress()]),
        messagePayload
      );
      
      // Attacker tries to rotate validators mid-processing
      await mockISM.rotateValidators([attacker.address]);
      
      // Original message should complete with original validator set
      const tx = await handlePromise;
      const receipt = await tx.wait();
      expect(receipt).to.not.be.null;
    });
  });

  describe("Gas Payment Verification Tests", function () {
    it("should prevent gas payment bypass attempts", async function () {
      // Configure gas paymaster to require payment
      await mockGasPaymaster.setRequirePayment(true);
      await mockGasPaymaster.setMinimumGasPayment(ethers.parseEther("0.1"));
      
      await lookCoin.connect(user1).approve(await hyperlaneModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Should reject bridge without sufficient gas payment
      await expect(
        hyperlaneModule.connect(user1).bridge(
          CHAIN_IDS.AKASHIC,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x",
          { value: ethers.parseEther("0.01") } // Insufficient gas payment
        )
      ).to.be.revertedWithCustomError(hyperlaneModule, "InsufficientGasPayment");
    });

    it("should prevent payment token substitution", async function () {
      // Mock attempts to use alternative payment tokens
      await mockGasPaymaster.setAcceptAlternativeTokens(false);
      
      await lookCoin.connect(user1).approve(await hyperlaneModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Try to pay with LOOK tokens instead of native ETH
      await lookCoin.connect(user1).approve(await mockGasPaymaster.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      await expect(
        hyperlaneModule.connect(user1).bridge(
          CHAIN_IDS.AKASHIC,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          "0x"
          // No native ETH value provided
        )
      ).to.be.revertedWithCustomError(hyperlaneModule, "InvalidPaymentToken");
    });

    it("should prevent gas estimation manipulation", async function () {
      // Mock gas paymaster returns manipulated estimates
      await mockGasPaymaster.setMaliciousGasEstimate(true);
      await mockGasPaymaster.setEstimateMultiplier(1000); // 1000x overestimate
      
      await lookCoin.connect(user1).approve(await hyperlaneModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Should use fallback gas estimation
      const requiredGas = await hyperlaneModule.estimateGasForDestination(CHAIN_IDS.AKASHIC);
      expect(requiredGas).to.be.lt(ethers.parseEther("1")); // Reasonable estimate
      
      const tx = await hyperlaneModule.connect(user1).bridge(
        CHAIN_IDS.AKASHIC,
        user1.address,
        AMOUNTS.HUNDRED_TOKENS,
        "0x",
        { value: requiredGas }
      );
      
      const receipt = await tx.wait();
      expect(receipt).to.not.be.null;
    });

    it("should prevent refund mechanism exploitation", async function () {
      // Set up overpayment scenario
      await lookCoin.connect(user1).approve(await hyperlaneModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      const overpayment = ethers.parseEther("1"); // Much more than needed
      const initialBalance = await ethers.provider.getBalance(user1.address);
      
      const tx = await hyperlaneModule.connect(user1).bridge(
        CHAIN_IDS.AKASHIC,
        user1.address,
        AMOUNTS.HUNDRED_TOKENS,
        "0x",
        { value: overpayment }
      );
      
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const finalBalance = await ethers.provider.getBalance(user1.address);
      
      // Verify appropriate refund (accounting for gas costs)
      const balanceChange = initialBalance - finalBalance;
      expect(balanceChange).to.be.lt(overpayment);
      expect(balanceChange).to.be.gt(gasUsed);
    });
  });

  describe("Domain Routing Attack Tests", function () {
    it("should prevent invalid domain mapping exploitation", async function () {
      // Attacker tries to map legitimate domain to malicious chain
      await expect(
        hyperlaneModule.connect(attacker).setDomainMapping(BSC_DOMAIN, 999999)
      ).to.be.revertedWithCustomError(hyperlaneModule, "AccessControlUnauthorizedAccount");
    });

    it("should prevent cross-domain message injection", async function () {
      const maliciousPayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [attacker.address, AMOUNTS.MILLION_TOKENS]
      );
      
      // Attacker tries to inject message from non-existent domain
      await expect(
        hyperlaneModule.handle(
          MALICIOUS_DOMAIN,
          ethers.solidityPackedKeccak256(["address"], [attacker.address]),
          maliciousPayload
        )
      ).to.be.revertedWithCustomError(hyperlaneModule, "InvalidSourceDomain");
    });

    it("should prevent domain spoofing attacks", async function () {
      const spoofedPayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [attacker.address, AMOUNTS.MILLION_TOKENS]
      );
      
      // Attacker tries to spoof message from trusted domain with untrusted sender
      await expect(
        hyperlaneModule.handle(
          AKASHIC_DOMAIN,
          ethers.solidityPackedKeccak256(["address"], [attacker.address]), // Untrusted sender
          spoofedPayload
        )
      ).to.be.revertedWithCustomError(hyperlaneModule, "UntrustedSender");
    });

    it("should prevent message routing hijacking", async function () {
      // Attacker tries to redirect messages to their address
      const hijackPayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.HUNDRED_TOKENS] // Legitimate recipient
      );
      
      // Mock mailbox attempts to change recipient
      await mockMailbox.setMaliciousRecipient(attacker.address);
      
      const initialAttackerBalance = await lookCoin.balanceOf(attacker.address);
      
      await hyperlaneModule.handle(
        AKASHIC_DOMAIN,
        ethers.solidityPackedKeccak256(["address"], [await hyperlaneModule.getAddress()]),
        hijackPayload
      );
      
      // Verify tokens went to legitimate recipient, not attacker
      const finalAttackerBalance = await lookCoin.balanceOf(attacker.address);
      expect(finalAttackerBalance).to.equal(initialAttackerBalance);
      
      const userBalance = await lookCoin.balanceOf(user1.address);
      expect(userBalance).to.be.gt(AMOUNTS.MILLION_TOKENS); // Original + received
    });
  });

  describe("Message Aggregation Attack Tests", function () {
    it("should prevent batch message corruption", async function () {
      const messages = [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256"],
          [user1.address, AMOUNTS.HUNDRED_TOKENS]
        ),
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256"],
          [attacker.address, AMOUNTS.MILLION_TOKENS] // Malicious message in batch
        )
      ];
      
      // Mock mailbox corrupts batch
      await mockMailbox.setBatchCorruption(true);
      
      await expect(
        hyperlaneModule.handleBatch(
          AKASHIC_DOMAIN,
          ethers.solidityPackedKeccak256(["address"], [await hyperlaneModule.getAddress()]),
          messages
        )
      ).to.be.revertedWithCustomError(hyperlaneModule, "BatchIntegrityFailure");
    });

    it("should prevent aggregation order manipulation", async function () {
      const message1 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [user1.address, AMOUNTS.HUNDRED_TOKENS, 1] // Sequence 1
      );
      
      const message2 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [user1.address, AMOUNTS.FIFTY_TOKENS, 2] // Sequence 2
      );
      
      // Mock mailbox reverses message order
      await mockMailbox.setOrderManipulation(true);
      
      await expect(
        hyperlaneModule.handleBatch(
          AKASHIC_DOMAIN,
          ethers.solidityPackedKeccak256(["address"], [await hyperlaneModule.getAddress()]),
          [message2, message1] // Wrong order
        )
      ).to.be.revertedWithCustomError(hyperlaneModule, "InvalidMessageSequence");
    });

    it("should prevent message deduplication bypass", async function () {
      const duplicateMessage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [attacker.address, AMOUNTS.MILLION_TOKENS]
      );
      
      // First message should succeed
      await hyperlaneModule.handle(
        AKASHIC_DOMAIN,
        ethers.solidityPackedKeccak256(["address"], [await hyperlaneModule.getAddress()]),
        duplicateMessage
      );
      
      // Duplicate should be rejected
      await expect(
        hyperlaneModule.handle(
          AKASHIC_DOMAIN,
          ethers.solidityPackedKeccak256(["address"], [await hyperlaneModule.getAddress()]),
          duplicateMessage
        )
      ).to.be.revertedWithCustomError(hyperlaneModule, "DuplicateMessageProcessing");
    });

    it("should prevent batch size limit exploitation", async function () {
      // Create oversized batch
      const maxBatchSize = 100;
      await hyperlaneModule.connect(admin).setMaxBatchSize(maxBatchSize);
      
      const largeBatch = [];
      for (let i = 0; i <= maxBatchSize; i++) {
        largeBatch.push(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256"],
            [attacker.address, ethers.parseEther("1")]
          )
        );
      }
      
      await expect(
        hyperlaneModule.handleBatch(
          AKASHIC_DOMAIN,
          ethers.solidityPackedKeccak256(["address"], [await hyperlaneModule.getAddress()]),
          largeBatch
        )
      ).to.be.revertedWithCustomError(hyperlaneModule, "BatchSizeExceeded");
    });
  });

  describe("Cross-Protocol Interaction Edge Cases", function () {
    it("should handle mailbox upgrade compatibility", async function () {
      // Deploy new mailbox with different interface
      const NewMailboxFactory = await ethers.getContractFactory("MockHyperlaneMailbox");
      const newMailbox = await NewMailboxFactory.deploy();
      
      // Set incompatible interface
      await newMailbox.setIncompatibleInterface(true);
      
      await expect(
        hyperlaneModule.connect(admin).updateMailbox(await newMailbox.getAddress())
      ).to.be.revertedWithCustomError(hyperlaneModule, "IncompatibleMailboxInterface");
    });

    it("should prevent concurrent message processing races", async function () {
      const message1 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.HUNDRED_TOKENS]
      );
      
      const message2 = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user1.address, AMOUNTS.FIFTY_TOKENS]
      );
      
      // Process messages concurrently
      const promise1 = hyperlaneModule.handle(
        AKASHIC_DOMAIN,
        ethers.solidityPackedKeccak256(["address"], [await hyperlaneModule.getAddress()]),
        message1
      );
      
      const promise2 = hyperlaneModule.handle(
        BSC_DOMAIN,
        ethers.solidityPackedKeccak256(["address"], [await hyperlaneModule.getAddress()]),
        message2
      );
      
      // Both should complete without race conditions
      const [tx1, tx2] = await Promise.all([promise1, promise2]);
      
      const receipt1 = await tx1.wait();
      const receipt2 = await tx2.wait();
      
      expect(receipt1).to.not.be.null;
      expect(receipt2).to.not.be.null;
    });

    it("should handle gas payment edge cases with complex routing", async function () {
      // Set up complex routing scenario
      const complexPayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address[]", "uint256[]", "uint32[]"],
        [
          [user1.address, attacker.address],
          [AMOUNTS.HUNDRED_TOKENS, AMOUNTS.FIFTY_TOKENS],
          [AKASHIC_DOMAIN, BSC_DOMAIN] // Multi-hop routing
        ]
      );
      
      await lookCoin.connect(user1).approve(await hyperlaneModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      // Should calculate gas for complex routing correctly
      const estimatedGas = await hyperlaneModule.estimateGasForComplexRouting(complexPayload);
      expect(estimatedGas).to.be.gt(ethers.parseEther("0.01"));
      expect(estimatedGas).to.be.lt(ethers.parseEther("1"));
      
      const tx = await hyperlaneModule.connect(user1).bridge(
        CHAIN_IDS.AKASHIC,
        user1.address,
        AMOUNTS.HUNDRED_TOKENS,
        complexPayload,
        { value: estimatedGas }
      );
      
      const receipt = await tx.wait();
      expect(receipt!.gasUsed).to.be.lt(500000); // Reasonable gas usage
    });
  });

  describe("Performance and Gas Analysis Edge Cases", function () {
    it("should handle maximum message payload size", async function () {
      const maxPayloadSize = 32 * 1024; // 32KB
      const maxPayload = "0x" + "aa".repeat(maxPayloadSize);
      
      await lookCoin.connect(user1).approve(await hyperlaneModule.getAddress(), AMOUNTS.HUNDRED_TOKENS);
      
      await expect(
        hyperlaneModule.connect(user1).bridge(
          CHAIN_IDS.AKASHIC,
          user1.address,
          AMOUNTS.HUNDRED_TOKENS,
          maxPayload,
          { value: ethers.parseEther("0.5") } // High gas for large payload
        )
      ).to.be.revertedWithCustomError(hyperlaneModule, "PayloadTooLarge");
    });

    it("should optimize gas for frequent small transfers", async function () {
      await lookCoin.connect(user1).approve(await hyperlaneModule.getAddress(), AMOUNTS.THOUSAND_TOKENS);
      
      // Measure gas for multiple small transfers
      const smallAmount = ethers.parseEther("1");
      const gasUsages: bigint[] = [];
      
      for (let i = 0; i < 5; i++) {
        const tx = await hyperlaneModule.connect(user1).bridge(
          CHAIN_IDS.AKASHIC,
          user1.address,
          smallAmount,
          "0x",
          { value: ethers.parseEther("0.05") }
        );
        
        const receipt = await tx.wait();
        gasUsages.push(receipt!.gasUsed);
      }
      
      // Gas usage should be consistent and optimized
      const avgGas = gasUsages.reduce((sum, gas) => sum + gas, 0n) / BigInt(gasUsages.length);
      expect(avgGas).to.be.lt(200000n); // Optimized gas usage
      
      // Variance should be low (consistent optimization)
      const maxVariance = gasUsages.reduce((max, gas) => gas > max ? gas : max, 0n) -
                         gasUsages.reduce((min, gas) => gas < min ? gas : min, gasUsages[0]);
      expect(maxVariance).to.be.lt(10000n); // Low variance
    });
  });
});