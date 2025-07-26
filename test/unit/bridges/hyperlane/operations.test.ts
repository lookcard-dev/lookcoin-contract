import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployLookCoinFixture,
  configureHyperlaneModule,
  setupMockHyperlane,
  testBooleanCombinations,
  expectSpecificRevert,
  assertBalanceChanges,
  assertSupplyChanges,
  assertEventEmission,
  coverageTracker,
  DeploymentFixture,
} from "../../../utils/comprehensiveTestHelpers";
import { TEST_CHAINS } from "../../../utils/testConfig";

describe("HyperlaneOperations - Comprehensive Operation Tests", function () {
  let fixture: DeploymentFixture;
  const DESTINATION_CHAIN_ID = TEST_CHAINS.OPTIMISM;
  const DESTINATION_DOMAIN = 10; // Optimism domain for Hyperlane
  const TRUSTED_SENDER_ADDRESS = "0x" + "1".repeat(64); // bytes32 format
  const ISM_ADDRESS = ethers.Wallet.createRandom().address;

  beforeEach(async function () {
    fixture = await loadFixture(deployLookCoinFixture);
    
    // Configure Hyperlane module
    await configureHyperlaneModule(
      fixture.hyperlaneModule,
      fixture.admin,
      DESTINATION_DOMAIN,
      DESTINATION_CHAIN_ID,
      TRUSTED_SENDER_ADDRESS,
      200000, // gasAmount
      ISM_ADDRESS
    );
    
    // Configure mock
    await setupMockHyperlane(
      fixture.mockHyperlane,
      DESTINATION_DOMAIN,
      ethers.parseEther("0.01")
    );
  });

  describe("Outbound Transfer Tests (bridgeToken)", function () {
    beforeEach(async function () {
      // Mint tokens for testing
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, ethers.parseEther("1000"));
    });

    it("should execute bridgeToken with valid parameters", async function () {
      const amount = ethers.parseEther("100");
      const [fee, estimatedTime] = await fixture.hyperlaneModule.estimateFee(
        DESTINATION_CHAIN_ID,
        amount
      );
      
      // Approve module
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), amount);
      
      const tx = await fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        { value: fee }
      );
      
      // Verify token burn
      await assertBalanceChanges(
        fixture.lookCoin,
        fixture.user.address,
        -amount,
        async () => { /* already executed */ }
      );
      
      // Verify total burned
      expect(await fixture.lookCoin.totalBurned()).to.equal(amount);
      
      // Verify event emission
      await assertEventEmission(
        tx,
        fixture.hyperlaneModule,
        "TokensBridged",
        [fixture.user.address, fixture.user2.address, DESTINATION_CHAIN_ID, amount]
      );
      
      coverageTracker.trackFunction("HyperlaneModule", "bridgeToken");
      coverageTracker.trackBranch("HyperlaneModule", "bridgeToken-success");
    });

    it("should revert bridgeToken with zero recipient", async function () {
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
          DESTINATION_CHAIN_ID,
          ethers.ZeroAddress,
          ethers.parseEther("100"),
          { value: ethers.parseEther("0.01") }
        ),
        fixture.hyperlaneModule,
        "InvalidRecipient"
      );
      
      coverageTracker.trackBranch("HyperlaneModule", "bridgeToken-zero-recipient");
    });

    it("should revert bridgeToken with zero amount", async function () {
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          0,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.hyperlaneModule,
        "InvalidAmount"
      );
      
      coverageTracker.trackBranch("HyperlaneModule", "bridgeToken-zero-amount");
    });

    it("should revert bridgeToken with unsupported chain", async function () {
      const unsupportedChain = 999;
      
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
          unsupportedChain,
          fixture.user2.address,
          ethers.parseEther("100"),
          { value: ethers.parseEther("0.01") }
        ),
        fixture.hyperlaneModule,
        "ChainNotSupported"
      );
      
      coverageTracker.trackBranch("HyperlaneModule", "bridgeToken-unsupported-chain");
    });

    it("should revert bridgeToken without trusted sender configuration", async function () {
      // Configure new chain without trusted sender
      const newChain = TEST_CHAINS.arbitrum;
      const newDomain = 42161;
      
      await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(newDomain, newChain);
      // Not setting trusted sender
      
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
          newChain,
          fixture.user2.address,
          ethers.parseEther("100"),
          { value: ethers.parseEther("0.01") }
        ),
        fixture.hyperlaneModule,
        "InvalidDestination"
      );
      
      coverageTracker.trackBranch("HyperlaneModule", "bridgeToken-no-trusted-sender");
    });

    it("should revert bridgeToken with insufficient fee", async function () {
      const amount = ethers.parseEther("100");
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), amount);
      
      // Send less than required fee
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          amount,
          { value: ethers.parseEther("0.001") } // Less than mock's 0.01
        ),
        fixture.hyperlaneModule,
        "InsufficientFee"
      );
      
      coverageTracker.trackBranch("HyperlaneModule", "bridgeToken-insufficient-fee");
    });

    it("should handle excess ETH refund", async function () {
      const amount = ethers.parseEther("100");
      const [fee] = await fixture.hyperlaneModule.estimateFee(DESTINATION_CHAIN_ID, amount);
      const excessETH = ethers.parseEther("0.1");
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), amount);
      
      const balanceBefore = await ethers.provider.getBalance(fixture.user.address);
      
      const tx = await fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        { value: fee + excessETH }
      );
      
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
      const balanceAfter = await ethers.provider.getBalance(fixture.user.address);
      
      // User should receive excess ETH back
      expect(balanceBefore - balanceAfter - gasUsed).to.be.closeTo(fee, ethers.parseEther("0.001"));
      
      coverageTracker.trackBranch("HyperlaneModule", "bridgeToken-excess-refund");
    });

    it("should test bridgeToken boolean combinations", async function () {
      // Test combinations of: valid chain, valid recipient, valid amount, sufficient fee
      for (let i = 0; i < 16; i++) {
        const hasValidChain = (i & 1) !== 0;
        const hasValidRecipient = (i & 2) !== 0;
        const hasValidAmount = (i & 4) !== 0;
        const hasSufficientFee = (i & 8) !== 0;
        
        const chainId = hasValidChain ? DESTINATION_CHAIN_ID : 999;
        const recipient = hasValidRecipient ? fixture.user2.address : ethers.ZeroAddress;
        const amount = hasValidAmount ? ethers.parseEther("50") : 0;
        const feeAmount = hasSufficientFee ? ethers.parseEther("0.01") : ethers.parseEther("0.001");
        
        if (hasValidAmount && hasValidChain) {
          await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), amount);
        }
        
        if (hasValidChain && hasValidRecipient && hasValidAmount && hasSufficientFee) {
          await expect(
            fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
              chainId,
              recipient,
              amount,
              { value: feeAmount }
            )
          ).to.not.be.reverted;
        } else {
          let expectedError = "ChainNotSupported";
          if (hasValidChain && !hasValidRecipient) expectedError = "InvalidRecipient";
          if (hasValidChain && hasValidRecipient && !hasValidAmount) expectedError = "InvalidAmount";
          if (hasValidChain && hasValidRecipient && hasValidAmount && !hasSufficientFee) expectedError = "InsufficientFee";
          
          await expectSpecificRevert(
            async () => fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
              chainId,
              recipient,
              amount,
              { value: feeAmount }
            ),
            fixture.hyperlaneModule,
            expectedError
          );
        }
        
        coverageTracker.trackBooleanCombination(
          "HyperlaneModule",
          `bridgeToken-chain:${hasValidChain}-recipient:${hasValidRecipient}-amount:${hasValidAmount}-fee:${hasSufficientFee}`
        );
      }
    });
  });

  describe("Inbound Transfer Tests (handle)", function () {
    const messageId = ethers.encodeBytes32String("msg1");
    const amount = ethers.parseEther("100");

    beforeEach(async function () {
      // Set mock as mailbox
      await fixture.hyperlaneModule.connect(fixture.admin).updateConfig(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [fixture.user.address] // Set user as mailbox for testing
        )
      );
    });

    it("should execute handle with valid parameters", async function () {
      const messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [fixture.user2.address, amount]
      );
      
      const tx = await fixture.hyperlaneModule.connect(fixture.user).handle(
        DESTINATION_DOMAIN,
        TRUSTED_SENDER_ADDRESS,
        messageData
      );
      
      // Verify mint
      expect(await fixture.lookCoin.balanceOf(fixture.user2.address)).to.equal(amount);
      expect(await fixture.lookCoin.totalMinted()).to.equal(amount);
      
      // Verify event emission
      await assertEventEmission(
        tx,
        fixture.hyperlaneModule,
        "TokensReceived",
        [DESTINATION_DOMAIN, fixture.user2.address, amount]
      );
      
      coverageTracker.trackFunction("HyperlaneModule", "handle");
      coverageTracker.trackBranch("HyperlaneModule", "handle-success");
    });

    it("should revert handle with unauthorized caller", async function () {
      const messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [fixture.user2.address, amount]
      );
      
      // user2 is not the mailbox
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.connect(fixture.user2).handle(
          DESTINATION_DOMAIN,
          TRUSTED_SENDER_ADDRESS,
          messageData
        ),
        fixture.hyperlaneModule,
        "UnauthorizedCaller"
      );
      
      coverageTracker.trackBranch("HyperlaneModule", "handle-unauthorized");
    });

    it("should revert handle with untrusted sender", async function () {
      const untrustedSender = "0x" + "2".repeat(64);
      const messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [fixture.user2.address, amount]
      );
      
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.connect(fixture.user).handle(
          DESTINATION_DOMAIN,
          untrustedSender,
          messageData
        ),
        fixture.hyperlaneModule,
        "UnauthorizedSender"
      );
      
      coverageTracker.trackBranch("HyperlaneModule", "handle-untrusted-sender");
    });

    it("should revert handle with unmapped domain", async function () {
      const unmappedDomain = 999;
      const messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [fixture.user2.address, amount]
      );
      
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.connect(fixture.user).handle(
          unmappedDomain,
          TRUSTED_SENDER_ADDRESS,
          messageData
        ),
        fixture.hyperlaneModule,
        "InvalidSourceChain"
      );
      
      coverageTracker.trackBranch("HyperlaneModule", "handle-unmapped-domain");
    });

    it("should revert handle with invalid message data", async function () {
      // Invalid encoded data
      const invalidData = "0x1234";
      
      await expect(
        fixture.hyperlaneModule.connect(fixture.user).handle(
          DESTINATION_DOMAIN,
          TRUSTED_SENDER_ADDRESS,
          invalidData
        )
      ).to.be.reverted;
      
      coverageTracker.trackBranch("HyperlaneModule", "handle-invalid-data");
    });

    it("should test handle boolean combinations", async function () {
      // Test combinations of: authorized caller, trusted sender, mapped domain, valid data
      for (let i = 0; i < 16; i++) {
        const isAuthorizedCaller = (i & 1) !== 0;
        const isTrustedSender = (i & 2) !== 0;
        const isMappedDomain = (i & 4) !== 0;
        const hasValidData = (i & 8) !== 0;
        
        // Reset fixture for clean state
        fixture = await loadFixture(deployLookCoinFixture);
        await configureHyperlaneModule(
          fixture.hyperlaneModule,
          fixture.admin,
          DESTINATION_DOMAIN,
          DESTINATION_CHAIN_ID,
          TRUSTED_SENDER_ADDRESS,
          200000,
          ISM_ADDRESS
        );
        
        // Set mailbox
        await fixture.hyperlaneModule.connect(fixture.admin).updateConfig(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address"],
            [isAuthorizedCaller ? fixture.user.address : fixture.user2.address]
          )
        );
        
        const domain = isMappedDomain ? DESTINATION_DOMAIN : 999;
        const sender = isTrustedSender ? TRUSTED_SENDER_ADDRESS : "0x" + "2".repeat(64);
        const messageData = hasValidData
          ? ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [fixture.user2.address, amount])
          : "0x1234";
        
        if (isAuthorizedCaller && isTrustedSender && isMappedDomain && hasValidData) {
          await expect(
            fixture.hyperlaneModule.connect(fixture.user).handle(
              domain,
              sender,
              messageData
            )
          ).to.not.be.reverted;
        } else {
          let shouldRevert = true;
          let expectedError = "UnauthorizedCaller";
          
          if (isAuthorizedCaller) {
            if (!isMappedDomain) {
              expectedError = "InvalidSourceChain";
            } else if (!isTrustedSender) {
              expectedError = "UnauthorizedSender";
            } else if (!hasValidData) {
              shouldRevert = true; // Will revert during decoding
              expectedError = "";
            }
          }
          
          if (shouldRevert && expectedError) {
            await expectSpecificRevert(
              async () => fixture.hyperlaneModule.connect(fixture.user).handle(
                domain,
                sender,
                messageData
              ),
              fixture.hyperlaneModule,
              expectedError
            );
          } else if (shouldRevert) {
            await expect(
              fixture.hyperlaneModule.connect(fixture.user).handle(
                domain,
                sender,
                messageData
              )
            ).to.be.reverted;
          }
        }
        
        coverageTracker.trackBooleanCombination(
          "HyperlaneModule",
          `handle-caller:${isAuthorizedCaller}-sender:${isTrustedSender}-domain:${isMappedDomain}-data:${hasValidData}`
        );
      }
    });
  });

  describe("Fee Estimation Tests", function () {
    it("should estimate fee correctly", async function () {
      const amount = ethers.parseEther("100");
      
      const [fee, estimatedTime] = await fixture.hyperlaneModule.estimateFee(
        DESTINATION_CHAIN_ID,
        amount
      );
      
      // Fee should be the mock's quote
      expect(fee).to.equal(ethers.parseEther("0.01"));
      
      // Estimated time should be Hyperlane's default
      expect(estimatedTime).to.equal(600); // 10 minutes
      
      coverageTracker.trackFunction("HyperlaneModule", "estimateFee");
    });

    it("should estimate fee for different gas amounts", async function () {
      // Set different gas amounts
      const gasAmounts = [100000, 300000, 500000];
      
      for (const gasAmount of gasAmounts) {
        await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(
          DESTINATION_DOMAIN,
          gasAmount
        );
        
        const [fee] = await fixture.hyperlaneModule.estimateFee(
          DESTINATION_CHAIN_ID,
          ethers.parseEther("100")
        );
        
        // Mock returns fixed fee, but in real implementation it would vary
        expect(fee).to.be.gt(0);
      }
      
      coverageTracker.trackBranch("HyperlaneModule", "estimateFee-gas-variation");
    });

    it("should revert fee estimation for unsupported chain", async function () {
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.estimateFee(999, ethers.parseEther("100")),
        fixture.hyperlaneModule,
        "ChainNotSupported"
      );
      
      coverageTracker.trackBranch("HyperlaneModule", "estimateFee-unsupported-chain");
    });
  });

  describe("Domain Validation Tests", function () {
    it("should validate domain mapping correctly", async function () {
      // Test valid domain
      const chainId = await fixture.hyperlaneModule.domainToChainId(DESTINATION_DOMAIN);
      expect(chainId).to.equal(DESTINATION_CHAIN_ID);
      
      // Test reverse mapping
      const domain = await fixture.hyperlaneModule.chainIdToDomain(DESTINATION_CHAIN_ID);
      expect(domain).to.equal(DESTINATION_DOMAIN);
      
      // Test invalid domain
      expect(await fixture.hyperlaneModule.domainToChainId(999)).to.equal(0);
      
      coverageTracker.trackBranch("HyperlaneModule", "domain-validation");
    });

    it("should handle domain updates correctly", async function () {
      const newDomain = 137; // Polygon
      const newChainId = TEST_CHAINS.polygon;
      
      // Update domain mapping
      await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(newDomain, newChainId);
      
      // Verify new mapping
      expect(await fixture.hyperlaneModule.domainToChainId(newDomain)).to.equal(newChainId);
      expect(await fixture.hyperlaneModule.chainIdToDomain(newChainId)).to.equal(newDomain);
      
      // Old mapping should be cleared
      expect(await fixture.hyperlaneModule.chainIdToDomain(DESTINATION_CHAIN_ID)).to.equal(0);
      
      coverageTracker.trackBranch("HyperlaneModule", "domain-update");
    });
  });

  describe("Trusted Sender Validation Tests", function () {
    it("should validate trusted senders correctly", async function () {
      const messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [fixture.user2.address, ethers.parseEther("50")]
      );
      
      // Test with different sender addresses
      const senders = [
        { address: TRUSTED_SENDER_ADDRESS, shouldSucceed: true },
        { address: "0x" + "2".repeat(64), shouldSucceed: false },
        { address: ethers.ZeroHash, shouldSucceed: false },
      ];
      
      for (const sender of senders) {
        if (sender.shouldSucceed) {
          await expect(
            fixture.hyperlaneModule.connect(fixture.user).handle(
              DESTINATION_DOMAIN,
              sender.address,
              messageData
            )
          ).to.not.be.reverted;
        } else {
          await expectSpecificRevert(
            async () => fixture.hyperlaneModule.connect(fixture.user).handle(
              DESTINATION_DOMAIN,
              sender.address,
              messageData
            ),
            fixture.hyperlaneModule,
            "UnauthorizedSender"
          );
        }
      }
      
      coverageTracker.trackBranch("HyperlaneModule", "trusted-sender-validation");
    });
  });

  describe("Message Handling Tests", function () {
    it("should encode and decode messages correctly", async function () {
      const recipient = fixture.user2.address;
      const amount = ethers.parseEther("123.456");
      
      // Encode message
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [recipient, amount]
      );
      
      // Decode and verify
      const [decodedRecipient, decodedAmount] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["address", "uint256"],
        encoded
      );
      
      expect(decodedRecipient).to.equal(recipient);
      expect(decodedAmount).to.equal(amount);
      
      coverageTracker.trackBranch("HyperlaneModule", "message-encoding");
    });

    it("should handle maximum amounts", async function () {
      const maxAmount = ethers.MaxUint256;
      
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, maxAmount);
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), maxAmount);
      
      // Should handle max amount without overflow
      const [fee] = await fixture.hyperlaneModule.estimateFee(DESTINATION_CHAIN_ID, maxAmount);
      
      await expect(
        fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          maxAmount,
          { value: fee }
        )
      ).to.not.be.reverted;
      
      coverageTracker.trackBranch("HyperlaneModule", "max-amount-handling");
    });
  });

  describe("Event Emission Tests", function () {
    it("should emit correct events for outbound transfers", async function () {
      const amount = ethers.parseEther("75");
      const [fee] = await fixture.hyperlaneModule.estimateFee(DESTINATION_CHAIN_ID, amount);
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), amount);
      
      const tx = await fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        { value: fee }
      );
      
      // Check TokensBridged event
      await assertEventEmission(
        tx,
        fixture.hyperlaneModule,
        "TokensBridged",
        [fixture.user.address, fixture.user2.address, DESTINATION_CHAIN_ID, amount]
      );
      
      // Check for Hyperlane dispatch event (from mock)
      await expect(tx).to.emit(fixture.mockHyperlane, "Dispatch");
      
      coverageTracker.trackBranch("HyperlaneModule", "event-emission-outbound");
    });

    it("should emit correct events for inbound transfers", async function () {
      const amount = ethers.parseEther("25");
      const messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [fixture.user2.address, amount]
      );
      
      const tx = await fixture.hyperlaneModule.connect(fixture.user).handle(
        DESTINATION_DOMAIN,
        TRUSTED_SENDER_ADDRESS,
        messageData
      );
      
      // Check TokensReceived event
      await assertEventEmission(
        tx,
        fixture.hyperlaneModule,
        "TokensReceived",
        [DESTINATION_DOMAIN, fixture.user2.address, amount]
      );
      
      coverageTracker.trackBranch("HyperlaneModule", "event-emission-inbound");
    });
  });

  describe("Mock Hyperlane Integration Tests", function () {
    it("should test end-to-end flow with mock", async function () {
      const amount = ethers.parseEther("200");
      
      // Setup source chain
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
      
      // Calculate fee
      const [fee] = await fixture.hyperlaneModule.estimateFee(DESTINATION_CHAIN_ID, amount);
      
      // Execute outbound
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), amount);
      
      const outboundTx = await fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        { value: fee }
      );
      
      // Verify burn
      expect(await fixture.lookCoin.totalBurned()).to.equal(amount);
      expect(await fixture.lookCoin.balanceOf(fixture.user.address)).to.equal(0);
      
      // Get message ID from event
      const receipt = await outboundTx.wait();
      const dispatchEvent = receipt.logs?.find(log => {
        try {
          const parsed = fixture.crossChainRouter.interface.parseLog(log);
          return parsed?.name === "Dispatch";
        } catch {
          return false;
        }
      });
      const messageId = dispatchEvent ? fixture.crossChainRouter.interface.parseLog(dispatchEvent)?.args?.messageId : undefined;
      
      // Simulate inbound on destination
      const messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [fixture.user2.address, amount]
      );
      
      const inboundTx = await fixture.hyperlaneModule.connect(fixture.user).handle(
        DESTINATION_DOMAIN,
        TRUSTED_SENDER_ADDRESS,
        messageData
      );
      
      // Verify mint
      expect(await fixture.lookCoin.balanceOf(fixture.user2.address)).to.equal(amount);
      expect(await fixture.lookCoin.totalMinted()).to.equal(amount);
      
      // Verify supply consistency
      const totalSupply = await fixture.lookCoin.totalSupply();
      const totalBurned = await fixture.lookCoin.totalBurned();
      const totalMinted = await fixture.lookCoin.totalMinted();
      
      // Net supply should remain constant (burned == minted)
      expect(totalBurned).to.equal(totalMinted);
      
      coverageTracker.trackBranch("HyperlaneModule", "end-to-end-flow");
    });

    it("should handle mock configuration changes", async function () {
      // Change mock fee
      const newFee = ethers.parseEther("0.02");
      await setupMockHyperlane(fixture.mockHyperlane, DESTINATION_DOMAIN, newFee);
      
      // Verify new fee is used
      const [fee] = await fixture.hyperlaneModule.estimateFee(
        DESTINATION_CHAIN_ID,
        ethers.parseEther("100")
      );
      
      expect(fee).to.equal(newFee);
      
      coverageTracker.trackBranch("HyperlaneModule", "mock-configuration-change");
    });

    it("should test gas configuration with mock", async function () {
      const gasConfigs = [
        { gas: 100000, expectedSuccess: true },
        { gas: 300000, expectedSuccess: true },
        { gas: 500000, expectedSuccess: true },
        { gas: 0, expectedSuccess: true }, // Should use default
      ];
      
      for (const config of gasConfigs) {
        await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(
          DESTINATION_DOMAIN,
          config.gas
        );
        
        const amount = ethers.parseEther("10");
        const [fee] = await fixture.hyperlaneModule.estimateFee(DESTINATION_CHAIN_ID, amount);
        
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), amount);
        
        if (config.expectedSuccess) {
          await expect(
            fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
              DESTINATION_CHAIN_ID,
              fixture.user2.address,
              amount,
              { value: fee }
            )
          ).to.not.be.reverted;
        }
      }
      
      coverageTracker.trackBranch("HyperlaneModule", "gas-configuration-test");
    });
  });

  describe("ISM (Interchain Security Module) Tests", function () {
    it("should work with ISM configuration", async function () {
      // Verify ISM is set
      expect(await fixture.hyperlaneModule.interchainSecurityModule()).to.equal(ISM_ADDRESS);
      
      // Execute transfer with ISM configured
      const amount = ethers.parseEther("50");
      const [fee] = await fixture.hyperlaneModule.estimateFee(DESTINATION_CHAIN_ID, amount);
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), amount);
      
      await expect(
        fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          amount,
          { value: fee }
        )
      ).to.not.be.reverted;
      
      coverageTracker.trackBranch("HyperlaneModule", "ism-integration");
    });

    it("should work without ISM configuration", async function () {
      // Remove ISM
      await fixture.hyperlaneModule.connect(fixture.admin).setInterchainSecurityModule(
        ethers.ZeroAddress
      );
      
      // Should still work
      const amount = ethers.parseEther("30");
      const [fee] = await fixture.hyperlaneModule.estimateFee(DESTINATION_CHAIN_ID, amount);
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), amount);
      
      await expect(
        fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          amount,
          { value: fee }
        )
      ).to.not.be.reverted;
      
      coverageTracker.trackBranch("HyperlaneModule", "no-ism-integration");
    });
  });

  describe("Address Conversion Tests", function () {
    it("should handle address to bytes32 conversion correctly", async function () {
      const address = fixture.user.address;
      const bytes32 = ethers.zeroPadValue(address, 32);
      
      // Set as trusted sender
      await fixture.hyperlaneModule.connect(fixture.admin).setTrustedSender(
        DESTINATION_DOMAIN,
        bytes32
      );
      
      // Verify it's stored correctly
      expect(await fixture.hyperlaneModule.trustedSenders(DESTINATION_DOMAIN)).to.equal(bytes32);
      
      // Test in handle function
      const messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [fixture.user2.address, ethers.parseEther("10")]
      );
      
      await expect(
        fixture.hyperlaneModule.connect(fixture.user).handle(
          DESTINATION_DOMAIN,
          bytes32,
          messageData
        )
      ).to.not.be.reverted;
      
      coverageTracker.trackBranch("HyperlaneModule", "address-conversion");
    });
  });

  describe("Edge Cases and Error Scenarios", function () {
    it("should handle zero gas configuration", async function () {
      // Set gas to 0 (should use default)
      await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(
        DESTINATION_DOMAIN,
        0
      );
      
      const amount = ethers.parseEther("20");
      const [fee] = await fixture.hyperlaneModule.estimateFee(DESTINATION_CHAIN_ID, amount);
      
      // Should still return valid fee
      expect(fee).to.be.gt(0);
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), amount);
      
      await expect(
        fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          amount,
          { value: fee }
        )
      ).to.not.be.reverted;
      
      coverageTracker.trackBranch("HyperlaneModule", "zero-gas-handling");
    });

    it("should handle domain 0", async function () {
      // Configure domain 0
      const domain0 = 0;
      const chainId0 = TEST_CHAINS.BSC;
      const trustedSender0 = "0x" + "3".repeat(64);
      
      await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(domain0, chainId0);
      await fixture.hyperlaneModule.connect(fixture.admin).setTrustedSender(domain0, trustedSender0);
      await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(domain0, 150000);
      
      // Should work with domain 0
      const amount = ethers.parseEther("15");
      const [fee] = await fixture.hyperlaneModule.estimateFee(chainId0, amount);
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), amount);
      
      await expect(
        fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
          chainId0,
          fixture.user2.address,
          amount,
          { value: fee }
        )
      ).to.not.be.reverted;
      
      coverageTracker.trackBranch("HyperlaneModule", "domain-0-handling");
    });

    it("should handle rapid consecutive transfers", async function () {
      const amounts = [
        ethers.parseEther("10"),
        ethers.parseEther("20"),
        ethers.parseEther("30"),
      ];
      
      const totalAmount = amounts.reduce((sum, amt) => sum + amt, BigInt(0));
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, totalAmount);
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), totalAmount);
      
      for (const amount of amounts) {
        const [fee] = await fixture.hyperlaneModule.estimateFee(DESTINATION_CHAIN_ID, amount);
        
        await expect(
          fixture.hyperlaneModule.connect(fixture.user).bridgeToken(
            DESTINATION_CHAIN_ID,
            fixture.user2.address,
            amount,
            { value: fee }
          )
        ).to.not.be.reverted;
      }
      
      // Verify total burned
      expect(await fixture.lookCoin.totalBurned()).to.equal(totalAmount);
      
      coverageTracker.trackBranch("HyperlaneModule", "rapid-transfers");
    });
  });
});