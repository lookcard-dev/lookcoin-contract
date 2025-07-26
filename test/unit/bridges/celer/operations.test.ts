import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployLookCoinFixture,
  configureCelerModule,
  setupMockCeler,
  testBooleanCombinations,
  expectSpecificRevert,
  assertBalanceChanges,
  assertSupplyChanges,
  assertEventEmission,
  coverageTracker,
  DeploymentFixture,
} from "../../../utils/comprehensiveTestHelpers";
import { TEST_CHAINS } from "../../../utils/testConfig";

describe("CelerOperations - Comprehensive Operation Tests", function () {
  let fixture: DeploymentFixture;
  const DESTINATION_CHAIN_ID = TEST_CHAINS.OPTIMISM;
  const REMOTE_MODULE_ADDRESS = "0x" + "1".repeat(40);

  beforeEach(async function () {
    fixture = await loadFixture(deployLookCoinFixture);
    
    // Configure Celer module
    await configureCelerModule(
      fixture.celerIMModule,
      fixture.admin,
      DESTINATION_CHAIN_ID,
      REMOTE_MODULE_ADDRESS,
      fixture.feeCollector.address
    );
    
    // Configure mock
    await setupMockCeler(fixture.mockCeler, true, ethers.parseEther("0.005"));
    
    // Grant OPERATOR_ROLE for whitelist/blacklist management
    await fixture.celerIMModule.connect(fixture.admin).grantRole(
      await fixture.celerIMModule.OPERATOR_ROLE(),
      fixture.operator.address
    );
  });

  describe("Outbound Transfer Tests (bridge/bridgeToken)", function () {
    beforeEach(async function () {
      // Mint tokens for testing
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, ethers.parseEther("1000"));
    });

    it("should execute bridge with valid parameters", async function () {
      const amount = ethers.parseEther("100");
      const messageFee = await fixture.mockCeler.calcFee("0x");
      
      // Calculate bridge fee
      const bridgeFee = await fixture.celerIMModule.calculateFee(amount);
      const totalAmount = amount + bridgeFee;
      
      // Approve module
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.celerIMModule.getAddress(), totalAmount);
      
      const tx = await fixture.celerIMModule.connect(fixture.user).bridge(
        fixture.user2.address,
        amount,
        DESTINATION_CHAIN_ID,
        0, // maxSlippage
        { value: messageFee }
      );
      
      // Verify token burn
      await assertBalanceChanges(
        fixture.lookCoin,
        fixture.user.address,
        -totalAmount,
        async () => { /* already executed */ }
      );
      
      // Verify fee collection
      expect(await fixture.lookCoin.balanceOf(fixture.feeCollector.address)).to.equal(bridgeFee);
      
      // Verify event emission
      await expect(tx).to.emit(fixture.celerIMModule, "TransferInitiated");
      
      coverageTracker.trackFunction("CelerIMModule", "bridge");
      coverageTracker.trackBranch("CelerIMModule", "bridge-success");
    });

    it("should revert bridge with blacklisted sender", async function () {
      await fixture.celerIMModule.connect(fixture.operator).updateBlacklist(fixture.user.address, true);
      
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).bridge(
          fixture.user2.address,
          ethers.parseEther("100"),
          DESTINATION_CHAIN_ID,
          0,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.celerIMModule,
        "BlacklistedAddress"
      );
      
      coverageTracker.trackBranch("CelerIMModule", "bridge-blacklisted");
    });

    it("should revert bridge from non-whitelisted sender when paused", async function () {
      // Pause module
      await fixture.celerIMModule.connect(fixture.admin).pause();
      
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).bridge(
          fixture.user2.address,
          ethers.parseEther("100"),
          DESTINATION_CHAIN_ID,
          0,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.celerIMModule,
        "NotWhitelistedDuringPause"
      );
      
      coverageTracker.trackBranch("CelerIMModule", "bridge-paused-not-whitelisted");
    });

    it("should allow bridge from whitelisted sender when paused", async function () {
      // Whitelist user and pause
      await fixture.celerIMModule.connect(fixture.operator).updateWhitelist(fixture.user.address, true);
      await fixture.celerIMModule.connect(fixture.admin).pause();
      
      const amount = ethers.parseEther("100");
      const bridgeFee = await fixture.celerIMModule.calculateFee(amount);
      const messageFee = await fixture.mockCeler.calcFee("0x");
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.celerIMModule.getAddress(), amount + bridgeFee);
      
      await expect(
        fixture.celerIMModule.connect(fixture.user).bridge(
          fixture.user2.address,
          amount,
          DESTINATION_CHAIN_ID,
          0,
          { value: messageFee }
        )
      ).to.not.be.reverted;
      
      coverageTracker.trackBranch("CelerIMModule", "bridge-paused-whitelisted");
    });

    it("should revert bridge with zero recipient", async function () {
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).bridge(
          ethers.ZeroAddress,
          ethers.parseEther("100"),
          DESTINATION_CHAIN_ID,
          0,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.celerIMModule,
        "InvalidRecipient"
      );
      
      coverageTracker.trackBranch("CelerIMModule", "bridge-zero-recipient");
    });

    it("should revert bridge with zero amount", async function () {
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).bridge(
          fixture.user2.address,
          0,
          DESTINATION_CHAIN_ID,
          0,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.celerIMModule,
        "InvalidAmount"
      );
      
      coverageTracker.trackBranch("CelerIMModule", "bridge-zero-amount");
    });

    it("should revert bridge with unsupported chain", async function () {
      const unsupportedChain = 999;
      
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).bridge(
          fixture.user2.address,
          ethers.parseEther("100"),
          unsupportedChain,
          0,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.celerIMModule,
        "ChainNotSupported"
      );
      
      coverageTracker.trackBranch("CelerIMModule", "bridge-unsupported-chain");
    });

    it("should revert bridge with unconfigured remote module", async function () {
      // Configure new chain without remote module
      const newChain = TEST_CHAINS.arbitrum;
      await fixture.celerIMModule.connect(fixture.admin).setSupportedChain(newChain, true);
      
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).bridge(
          fixture.user2.address,
          ethers.parseEther("100"),
          newChain,
          0,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.celerIMModule,
        "InvalidRemoteModule"
      );
      
      coverageTracker.trackBranch("CelerIMModule", "bridge-no-remote-module");
    });

    it("should revert bridge with insufficient message fee", async function () {
      const amount = ethers.parseEther("100");
      const bridgeFee = await fixture.celerIMModule.calculateFee(amount);
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.celerIMModule.getAddress(), amount + bridgeFee);
      
      // Send less than required message fee
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).bridge(
          fixture.user2.address,
          amount,
          DESTINATION_CHAIN_ID,
          0,
          { value: ethers.parseEther("0.001") } // Less than mock's 0.005
        ),
        fixture.celerIMModule,
        "InsufficientMessageFee"
      );
      
      coverageTracker.trackBranch("CelerIMModule", "bridge-insufficient-fee");
    });

    it("should handle excess ETH refund", async function () {
      const amount = ethers.parseEther("100");
      const bridgeFee = await fixture.celerIMModule.calculateFee(amount);
      const messageFee = await fixture.mockCeler.calcFee("0x");
      const excessETH = ethers.parseEther("0.1");
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.celerIMModule.getAddress(), amount + bridgeFee);
      
      const balanceBefore = await ethers.provider.getBalance(fixture.user.address);
      
      const tx = await fixture.celerIMModule.connect(fixture.user).bridge(
        fixture.user2.address,
        amount,
        DESTINATION_CHAIN_ID,
        0,
        { value: messageFee + excessETH }
      );
      
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
      const balanceAfter = await ethers.provider.getBalance(fixture.user.address);
      
      // User should receive excess ETH back
      expect(balanceBefore - balanceAfter - gasUsed).to.be.closeTo(messageFee, ethers.parseEther("0.001"));
      
      coverageTracker.trackBranch("CelerIMModule", "bridge-excess-refund");
    });

    it("should test bridge boolean combinations", async function () {
      await testBooleanCombinations(
        "Bridge operation conditions",
        async () => !await fixture.celerIMModule.blacklist(fixture.user.address),
        async (value) => {
          if (!value) {
            await fixture.celerIMModule.connect(fixture.operator).updateBlacklist(fixture.user.address, true);
          } else {
            await fixture.celerIMModule.connect(fixture.operator).updateBlacklist(fixture.user.address, false);
          }
        },
        async (combination) => {
          const amount = ethers.parseEther("50");
          const bridgeFee = await fixture.celerIMModule.calculateFee(amount);
          const messageFee = await fixture.mockCeler.calcFee("0x");
          
          await fixture.lookCoin.connect(fixture.user).approve(await fixture.celerIMModule.getAddress(), amount + bridgeFee);
          
          if (combination.to) {
            await expect(
              fixture.celerIMModule.connect(fixture.user).bridge(
                fixture.user2.address,
                amount,
                DESTINATION_CHAIN_ID,
                0,
                { value: messageFee }
              )
            ).to.not.be.reverted;
          } else {
            await expectSpecificRevert(
              async () => fixture.celerIMModule.connect(fixture.user).bridge(
                fixture.user2.address,
                amount,
                DESTINATION_CHAIN_ID,
                0,
                { value: messageFee }
              ),
              fixture.celerIMModule,
              "BlacklistedAddress"
            );
          }
          
          coverageTracker.trackBooleanCombination("CelerIMModule", `bridge-blacklist-${combination.description}`);
        }
      );
    });
  });

  describe("ILookBridgeModule Interface Tests", function () {
    beforeEach(async function () {
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, ethers.parseEther("1000"));
    });

    it("should execute bridgeToken wrapper function", async function () {
      const amount = ethers.parseEther("100");
      const bridgeFee = await fixture.celerIMModule.calculateFee(amount);
      const messageFee = await fixture.mockCeler.calcFee("0x");
      
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.celerIMModule.getAddress(), amount + bridgeFee);
      
      const tx = await fixture.celerIMModule.connect(fixture.user).bridgeToken(
        DESTINATION_CHAIN_ID,
        fixture.user2.address,
        amount,
        { value: messageFee }
      );
      
      // Verify transfer info stored
      const transferId = await tx.wait().then(receipt => {
        const event = receipt.logs?.find(log => {
        try {
          const parsed = fixture.crossChainRouter.interface.parseLog(log);
          return parsed?.name === "TransferInitiated";
        } catch {
          return false;
        }
      });
        return event?.args?.transferId;
      });
      
      const transferInfo = await fixture.celerIMModule.transfers(transferId);
      expect(transferInfo.sender).to.equal(fixture.user.address);
      expect(transferInfo.recipient).to.equal(fixture.user2.address);
      expect(transferInfo.amount).to.equal(amount);
      expect(transferInfo.destinationChainId).to.equal(DESTINATION_CHAIN_ID);
      expect(transferInfo.status).to.equal(0); // Pending
      
      coverageTracker.trackFunction("CelerIMModule", "bridgeToken");
    });

    it("should estimate fee correctly", async function () {
      const amount = ethers.parseEther("100");
      
      const [fee, estimatedTime] = await fixture.celerIMModule.estimateFee(
        DESTINATION_CHAIN_ID,
        amount
      );
      
      const expectedFee = await fixture.celerIMModule.calculateFee(amount);
      const messageFee = await fixture.mockCeler.calcFee("0x");
      
      expect(fee).to.equal(expectedFee + messageFee);
      expect(estimatedTime).to.equal(300); // Celer estimated time
      
      coverageTracker.trackFunction("CelerIMModule", "estimateFee");
    });

    it("should get transfer status", async function () {
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("test-transfer"));
      
      // Non-existent transfer returns Pending (0)
      const status = await fixture.celerIMModule.getStatus(transferId);
      expect(status).to.equal(0);
      
      coverageTracker.trackFunction("CelerIMModule", "getStatus");
    });
  });

  describe("Inbound Transfer Tests (executeMessageWithTransfer)", function () {
    const transferId = ethers.encodeBytes32String("transfer1");
    const amount = ethers.parseEther("100");

    beforeEach(async function () {
      // Set mock as message bus
      await fixture.celerIMModule.connect(fixture.admin).updateMessageBus(fixture.user.address);
    });

    it("should execute inbound transfer with valid parameters", async function () {
      const message = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32"],
        [fixture.user2.address, transferId]
      );
      
      const tx = await fixture.celerIMModule.connect(fixture.user).executeMessageWithTransfer(
        REMOTE_MODULE_ADDRESS,
        await fixture.lookCoin.getAddress(),
        amount,
        0, // srcChainId
        message,
        fixture.user.address // executor
      );
      
      // Verify mint
      expect(await fixture.lookCoin.balanceOf(fixture.user2.address)).to.equal(amount);
      expect(await fixture.lookCoin.totalMinted()).to.equal(amount);
      
      // Verify transfer completed
      const transferInfo = await fixture.celerIMModule.transfers(transferId);
      expect(transferInfo.status).to.equal(1); // Completed
      
      await assertEventEmission(
        tx,
        fixture.celerIMModule,
        "TransferCompleted",
        [transferId, fixture.user2.address, amount]
      );
      
      coverageTracker.trackFunction("CelerIMModule", "executeMessageWithTransfer");
      coverageTracker.trackBranch("CelerIMModule", "executeMessageWithTransfer-success");
    });

    it("should revert with unauthorized caller", async function () {
      const message = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32"],
        [fixture.user2.address, transferId]
      );
      
      // User2 is not the message bus
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user2).executeMessageWithTransfer(
          REMOTE_MODULE_ADDRESS,
          await fixture.lookCoin.getAddress(),
          amount,
          0,
          message,
          fixture.user2.address
        ),
        fixture.celerIMModule,
        "UnauthorizedCaller"
      );
      
      coverageTracker.trackBranch("CelerIMModule", "executeMessageWithTransfer-unauthorized");
    });

    it("should revert with unauthorized sender", async function () {
      const unauthorizedSender = ethers.Wallet.createRandom().address;
      const message = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32"],
        [fixture.user2.address, transferId]
      );
      
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).executeMessageWithTransfer(
          unauthorizedSender,
          await fixture.lookCoin.getAddress(),
          amount,
          0,
          message,
          fixture.user.address
        ),
        fixture.celerIMModule,
        "UnauthorizedSender"
      );
      
      coverageTracker.trackBranch("CelerIMModule", "executeMessageWithTransfer-unauthorized-sender");
    });

    it("should revert with blacklisted recipient", async function () {
      await fixture.celerIMModule.connect(fixture.operator).updateBlacklist(fixture.user2.address, true);
      
      const message = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32"],
        [fixture.user2.address, transferId]
      );
      
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).executeMessageWithTransfer(
          REMOTE_MODULE_ADDRESS,
          await fixture.lookCoin.getAddress(),
          amount,
          0,
          message,
          fixture.user.address
        ),
        fixture.celerIMModule,
        "BlacklistedAddress"
      );
      
      coverageTracker.trackBranch("CelerIMModule", "executeMessageWithTransfer-blacklisted");
    });

    it("should revert with duplicate transfer ID", async function () {
      const message = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32"],
        [fixture.user2.address, transferId]
      );
      
      // First execution succeeds
      await fixture.celerIMModule.connect(fixture.user).executeMessageWithTransfer(
        REMOTE_MODULE_ADDRESS,
        await fixture.lookCoin.getAddress(),
        amount,
        0,
        message,
        fixture.user.address
      );
      
      // Second execution with same ID fails
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).executeMessageWithTransfer(
          REMOTE_MODULE_ADDRESS,
          await fixture.lookCoin.getAddress(),
          amount,
          0,
          message,
          fixture.user.address
        ),
        fixture.celerIMModule,
        "TransferAlreadyProcessed"
      );
      
      coverageTracker.trackBranch("CelerIMModule", "executeMessageWithTransfer-duplicate");
    });

    it("should test inbound transfer boolean combinations", async function () {
      // Test combinations of: authorized caller, authorized sender, blacklisted recipient, duplicate ID
      for (let i = 0; i < 16; i++) {
        const isAuthorizedCaller = (i & 1) !== 0;
        const isAuthorizedSender = (i & 2) !== 0;
        const isRecipientBlacklisted = (i & 4) !== 0;
        const isDuplicateId = (i & 8) !== 0;
        
        // Reset fixture
        fixture = await loadFixture(deployLookCoinFixture);
        await configureCelerModule(
          fixture.celerIMModule,
          fixture.admin,
          DESTINATION_CHAIN_ID,
          REMOTE_MODULE_ADDRESS,
          fixture.feeCollector.address
        );
        await fixture.celerIMModule.connect(fixture.admin).grantRole(
          await fixture.celerIMModule.OPERATOR_ROLE(),
          fixture.operator.address
        );
        
        // Set message bus
        await fixture.celerIMModule.connect(fixture.admin).updateMessageBus(
          isAuthorizedCaller ? fixture.user.address : fixture.user2.address
        );
        
        // Blacklist recipient if needed
        if (isRecipientBlacklisted) {
          await fixture.celerIMModule.connect(fixture.operator).updateBlacklist(fixture.user2.address, true);
        }
        
        const uniqueId = isDuplicateId ? transferId : ethers.encodeBytes32String(`transfer${i}`);
        
        // Process duplicate ID first if needed
        if (isDuplicateId) {
          const message = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "bytes32"],
            [fixture.user2.address, uniqueId]
          );
          
          await fixture.celerIMModule.connect(isAuthorizedCaller ? fixture.user : fixture.user2).executeMessageWithTransfer(
            REMOTE_MODULE_ADDRESS,
            await fixture.lookCoin.getAddress(),
            amount,
            0,
            message,
            fixture.user.address
          );
        }
        
        // Prepare test message
        const message = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "bytes32"],
          [fixture.user2.address, uniqueId]
        );
        
        const sender = isAuthorizedSender ? REMOTE_MODULE_ADDRESS : ethers.Wallet.createRandom().address;
        
        // Test execution
        if (isAuthorizedCaller && isAuthorizedSender && !isRecipientBlacklisted && !isDuplicateId) {
          await expect(
            fixture.celerIMModule.connect(fixture.user).executeMessageWithTransfer(
              sender,
              await fixture.lookCoin.getAddress(),
              amount,
              0,
              message,
              fixture.user.address
            )
          ).to.not.be.reverted;
        } else {
          let expectedError = "UnauthorizedCaller";
          if (isAuthorizedCaller && !isAuthorizedSender) expectedError = "UnauthorizedSender";
          if (isAuthorizedCaller && isAuthorizedSender && isRecipientBlacklisted) expectedError = "BlacklistedAddress";
          if (isAuthorizedCaller && isAuthorizedSender && !isRecipientBlacklisted && isDuplicateId) expectedError = "TransferAlreadyProcessed";
          
          await expectSpecificRevert(
            async () => fixture.celerIMModule.connect(fixture.user).executeMessageWithTransfer(
              sender,
              await fixture.lookCoin.getAddress(),
              amount,
              0,
              message,
              fixture.user.address
            ),
            fixture.celerIMModule,
            expectedError
          );
        }
        
        coverageTracker.trackBooleanCombination(
          "CelerIMModule",
          `inbound-caller:${isAuthorizedCaller}-sender:${isAuthorizedSender}-blacklist:${isRecipientBlacklisted}-dup:${isDuplicateId}`
        );
      }
    });
  });

  describe("Transfer Refund Tests (executeMessageWithTransferRefund)", function () {
    const transferId = ethers.encodeBytes32String("refund1");
    const amount = ethers.parseEther("100");

    beforeEach(async function () {
      await fixture.celerIMModule.connect(fixture.admin).updateMessageBus(fixture.user.address);
    });

    it("should execute refund handler", async function () {
      const message = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32"],
        [fixture.user2.address, transferId]
      );
      
      const tx = await fixture.celerIMModule.connect(fixture.user).executeMessageWithTransferRefund(
        await fixture.lookCoin.getAddress(),
        amount,
        message,
        fixture.user.address
      );
      
      // Should emit TransferFailed event
      await assertEventEmission(
        tx,
        fixture.celerIMModule,
        "TransferFailed",
        [transferId, "Refund not possible - tokens burned"]
      );
      
      // No tokens should be minted (cannot refund burned tokens)
      expect(await fixture.lookCoin.totalMinted()).to.equal(0);
      
      coverageTracker.trackFunction("CelerIMModule", "executeMessageWithTransferRefund");
    });

    it("should revert refund with unauthorized caller", async function () {
      const message = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32"],
        [fixture.user2.address, transferId]
      );
      
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user2).executeMessageWithTransferRefund(
          await fixture.lookCoin.getAddress(),
          amount,
          message,
          fixture.user2.address
        ),
        fixture.celerIMModule,
        "UnauthorizedCaller"
      );
      
      coverageTracker.trackBranch("CelerIMModule", "executeMessageWithTransferRefund-unauthorized");
    });
  });

  describe("Fee Calculation Tests", function () {
    beforeEach(async function () {
      // Set fee parameters: 1%, min 0.1, max 5
      await fixture.celerIMModule.connect(fixture.admin).updateFeeParameters(
        100, // 1%
        ethers.parseEther("0.1"),
        ethers.parseEther("5")
      );
    });

    it("should calculate fees for various amounts", async function () {
      const testCases = [
        { amount: ethers.parseEther("0"), expected: ethers.parseEther("0.1") }, // Min fee
        { amount: ethers.parseEther("5"), expected: ethers.parseEther("0.1") }, // Min fee
        { amount: ethers.parseEther("10"), expected: ethers.parseEther("0.1") }, // At min boundary
        { amount: ethers.parseEther("50"), expected: ethers.parseEther("0.5") }, // Percentage
        { amount: ethers.parseEther("100"), expected: ethers.parseEther("1") }, // Percentage
        { amount: ethers.parseEther("500"), expected: ethers.parseEther("5") }, // At max boundary
        { amount: ethers.parseEther("1000"), expected: ethers.parseEther("5") }, // Max fee
      ];
      
      for (const testCase of testCases) {
        const fee = await fixture.celerIMModule.calculateFee(testCase.amount);
        expect(fee).to.equal(testCase.expected);
      }
      
      coverageTracker.trackBranch("CelerIMModule", "calculateFee-all-ranges");
    });

    it("should estimate message fee", async function () {
      const messageSize = 100; // bytes
      const fee = await fixture.celerIMModule.estimateMessageFee(DESTINATION_CHAIN_ID, messageSize);
      
      // Should return mock's fee
      expect(fee).to.equal(ethers.parseEther("0.005"));
      
      coverageTracker.trackFunction("CelerIMModule", "estimateMessageFee");
    });
  });

  describe("Access Control and Security Tests", function () {
    it("should enforce whitelist during pause", async function () {
      const amount = ethers.parseEther("100");
      const bridgeFee = await fixture.celerIMModule.calculateFee(amount);
      const messageFee = await fixture.mockCeler.calcFee("0x");
      
      // Pause module
      await fixture.celerIMModule.connect(fixture.admin).pause();
      
      // Non-whitelisted user cannot bridge
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.celerIMModule.getAddress(), amount + bridgeFee);
      
      await expectSpecificRevert(
        async () => fixture.celerIMModule.connect(fixture.user).bridge(
          fixture.user2.address,
          amount,
          DESTINATION_CHAIN_ID,
          0,
          { value: messageFee }
        ),
        fixture.celerIMModule,
        "NotWhitelistedDuringPause"
      );
      
      // Whitelist user
      await fixture.celerIMModule.connect(fixture.operator).updateWhitelist(fixture.user.address, true);
      
      // Now can bridge
      await expect(
        fixture.celerIMModule.connect(fixture.user).bridge(
          fixture.user2.address,
          amount,
          DESTINATION_CHAIN_ID,
          0,
          { value: messageFee }
        )
      ).to.not.be.reverted;
      
      coverageTracker.trackBranch("CelerIMModule", "whitelist-enforcement");
    });

    it("should test all access control combinations", async function () {
      // Test whitelist/blacklist/pause combinations
      const states = [
        { whitelisted: false, blacklisted: false, paused: false, shouldSucceed: true },
        { whitelisted: true, blacklisted: false, paused: false, shouldSucceed: true },
        { whitelisted: false, blacklisted: true, paused: false, shouldSucceed: false },
        { whitelisted: true, blacklisted: true, paused: false, shouldSucceed: false }, // Blacklist takes precedence
        { whitelisted: false, blacklisted: false, paused: true, shouldSucceed: false },
        { whitelisted: true, blacklisted: false, paused: true, shouldSucceed: true },
        { whitelisted: false, blacklisted: true, paused: true, shouldSucceed: false },
        { whitelisted: true, blacklisted: true, paused: true, shouldSucceed: false },
      ];
      
      for (const state of states) {
        // Reset fixture
        fixture = await loadFixture(deployLookCoinFixture);
        await configureCelerModule(
          fixture.celerIMModule,
          fixture.admin,
          DESTINATION_CHAIN_ID,
          REMOTE_MODULE_ADDRESS,
          fixture.feeCollector.address
        );
        await fixture.celerIMModule.connect(fixture.admin).grantRole(
          await fixture.celerIMModule.OPERATOR_ROLE(),
          fixture.operator.address
        );
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, ethers.parseEther("1000"));
        
        // Set states
        if (state.whitelisted) {
          await fixture.celerIMModule.connect(fixture.operator).updateWhitelist(fixture.user.address, true);
        }
        if (state.blacklisted) {
          await fixture.celerIMModule.connect(fixture.operator).updateBlacklist(fixture.user.address, true);
        }
        if (state.paused) {
          await fixture.celerIMModule.connect(fixture.admin).pause();
        }
        
        const amount = ethers.parseEther("50");
        const bridgeFee = await fixture.celerIMModule.calculateFee(amount);
        const messageFee = await fixture.mockCeler.calcFee("0x");
        
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.celerIMModule.getAddress(), amount + bridgeFee);
        
        if (state.shouldSucceed) {
          await expect(
            fixture.celerIMModule.connect(fixture.user).bridge(
              fixture.user2.address,
              amount,
              DESTINATION_CHAIN_ID,
              0,
              { value: messageFee }
            )
          ).to.not.be.reverted;
        } else {
          await expect(
            fixture.celerIMModule.connect(fixture.user).bridge(
              fixture.user2.address,
              amount,
              DESTINATION_CHAIN_ID,
              0,
              { value: messageFee }
            )
          ).to.be.reverted;
        }
        
        coverageTracker.trackBooleanCombination(
          "CelerIMModule",
          `access-white:${state.whitelisted}-black:${state.blacklisted}-pause:${state.paused}`
        );
      }
    });
  });

  describe("Configuration Update Tests", function () {
    it("should update configuration via updateConfig", async function () {
      const feePercentage = 200; // 2%
      const minFee = ethers.parseEther("0.2");
      const maxFee = ethers.parseEther("10");
      
      const configData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint256"],
        [feePercentage, minFee, maxFee]
      );
      
      await fixture.celerIMModule.connect(fixture.admin).updateConfig(configData);
      
      // Verify fees updated
      const testAmount = ethers.parseEther("100");
      const fee = await fixture.celerIMModule.calculateFee(testAmount);
      expect(fee).to.equal(ethers.parseEther("2")); // 2% of 100
      
      coverageTracker.trackBranch("CelerIMModule", "updateConfig-apply");
    });
  });

  describe("Mock Celer Integration Tests", function () {
    it("should test end-to-end flow with mock", async function () {
      const amount = ethers.parseEther("100");
      const transferId = ethers.encodeBytes32String("e2e-test");
      
      // Setup source chain
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount + ethers.parseEther("10"));
      
      // Calculate fees
      const bridgeFee = await fixture.celerIMModule.calculateFee(amount);
      const messageFee = await fixture.mockCeler.calcFee("0x");
      
      // Execute outbound
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.celerIMModule.getAddress(), amount + bridgeFee);
      
      const tx = await fixture.celerIMModule.connect(fixture.user).bridge(
        fixture.user2.address,
        amount,
        DESTINATION_CHAIN_ID,
        0,
        { value: messageFee }
      );
      
      // Verify burn and fee collection
      expect(await fixture.lookCoin.totalBurned()).to.equal(amount);
      expect(await fixture.lookCoin.balanceOf(fixture.feeCollector.address)).to.equal(bridgeFee);
      
      // Simulate inbound on destination
      await fixture.celerIMModule.connect(fixture.admin).updateMessageBus(fixture.user.address);
      
      const message = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32"],
        [fixture.user2.address, transferId]
      );
      
      await fixture.celerIMModule.connect(fixture.user).executeMessageWithTransfer(
        REMOTE_MODULE_ADDRESS,
        await fixture.lookCoin.getAddress(),
        amount,
        0,
        message,
        fixture.user.address
      );
      
      // Verify mint
      expect(await fixture.lookCoin.balanceOf(fixture.user2.address)).to.equal(amount);
      expect(await fixture.lookCoin.totalMinted()).to.equal(amount);
      
      coverageTracker.trackBranch("CelerIMModule", "end-to-end-flow");
    });

    it("should handle mock failure scenarios", async function () {
      // Configure mock to fail
      await setupMockCeler(fixture.mockCeler, false);
      
      const amount = ethers.parseEther("100");
      const bridgeFee = await fixture.celerIMModule.calculateFee(amount);
      const messageFee = await fixture.mockCeler.calcFee("0x");
      
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount + bridgeFee);
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.celerIMModule.getAddress(), amount + bridgeFee);
      
      // Mock will cause send to fail
      await expect(
        fixture.celerIMModule.connect(fixture.user).bridge(
          fixture.user2.address,
          amount,
          DESTINATION_CHAIN_ID,
          0,
          { value: messageFee }
        )
      ).to.be.revertedWith("SendMessageWithTransferFailed");
      
      coverageTracker.trackBranch("CelerIMModule", "mock-failure-handling");
    });
  });
});