import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployLookCoinFixture,
  configureLookCoinForTesting,
  configureLayerZeroModule,
  setupMockLayerZero,
  testBooleanCombinations,
  expectSpecificRevert,
  assertBalanceChanges,
  assertSupplyChanges,
  assertEventEmission,
  coverageTracker,
  DeploymentFixture,
} from "../../../utils/comprehensiveTestHelpers";
import { TEST_CHAINS } from "../../../utils/testConfig";

describe("LayerZeroOperations - Comprehensive Operation Tests", function () {
  let fixture: DeploymentFixture;
  const DESTINATION_CHAIN_ID = TEST_CHAINS.OPTIMISM;
  const TRUSTED_REMOTE_ADDRESS = "0x" + "1".repeat(40);

  beforeEach(async function () {
    fixture = await loadFixture(deployLookCoinFixture);
    
    // Configure LayerZero for testing
    const trustedRemote = ethers.solidityPacked(
      ["address", "address"],
      [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
    );
    await configureLookCoinForTesting(
      fixture.lookCoin,
      fixture.protocolAdmin,
      DESTINATION_CHAIN_ID,
      trustedRemote
    );
    
    // Configure mock
    await setupMockLayerZero(fixture.mockLayerZero, true, ethers.parseEther("0.01"));
  });

  describe("Outbound Transfer Tests (sendFrom)", function () {
    beforeEach(async function () {
      // Mint tokens for testing
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, ethers.parseEther("1000"));
    });

    it("should execute sendFrom with valid parameters", async function () {
      const amount = ethers.parseEther("100");
      const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
      
      // Get fee estimate
      const [nativeFee] = await fixture.lookCoin.estimateSendFee(
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        false,
        "0x"
      );
      
      // Execute transfer
      const tx = await fixture.lookCoin.connect(fixture.user).sendFrom(
        fixture.user.address,
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        fixture.user.address,
        ethers.ZeroAddress,
        "0x",
        { value: nativeFee }
      );
      
      // Verify token burn
      await assertBalanceChanges(
        fixture.lookCoin,
        fixture.user.address,
        -amount,
        async () => { /* already executed */ }
      );
      
      // Verify supply tracking
      expect(await fixture.lookCoin.totalBurned()).to.equal(amount);
      
      // Verify event emission
      await assertEventEmission(
        tx,
        fixture.lookCoin,
        "SendToChain",
        [DESTINATION_CHAIN_ID, fixture.user.address, recipient, amount]
      );
      
      coverageTracker.trackFunction("LookCoin", "sendFrom");
      coverageTracker.trackBranch("LookCoin", "sendFrom-success");
    });

    it("should execute sendFrom with self-transfer", async function () {
      const amount = ethers.parseEther("50");
      const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
      
      // Approve first
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.lookCoin.getAddress(), amount);
      
      const [nativeFee] = await fixture.lookCoin.estimateSendFee(
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        false,
        "0x"
      );
      
      // Execute self-transfer (msg.sender == _from)
      const tx = await fixture.lookCoin.connect(fixture.user).sendFrom(
        fixture.user.address,
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        fixture.user.address,
        ethers.ZeroAddress,
        "0x",
        { value: nativeFee }
      );
      
      await expect(tx).to.emit(fixture.lookCoin, "SendToChain");
      
      coverageTracker.trackBranch("LookCoin", "sendFrom-self-transfer");
    });

    it("should revert sendFrom with insufficient allowance", async function () {
      const amount = ethers.parseEther("100");
      const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
      
      // Approve less than transfer amount
      await fixture.lookCoin.connect(fixture.user).approve(fixture.user2.address, ethers.parseEther("50"));
      
      const [nativeFee] = await fixture.lookCoin.estimateSendFee(
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        false,
        "0x"
      );
      
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.user2).sendFrom(
          fixture.user.address,
          DESTINATION_CHAIN_ID,
          recipient,
          amount,
          fixture.user2.address,
          ethers.ZeroAddress,
          "0x",
          { value: nativeFee }
        ),
        fixture.lookCoin,
        "ERC20InsufficientAllowance"
      );
      
      coverageTracker.trackBranch("LookCoin", "sendFrom-insufficient-allowance");
    });

    it("should revert sendFrom with zero amount", async function () {
      const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
      
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.user).sendFrom(
          fixture.user.address,
          DESTINATION_CHAIN_ID,
          recipient,
          0,
          fixture.user.address,
          ethers.ZeroAddress,
          []
        ),
        fixture.lookCoin,
        "LookCoin: amount must be greater than zero"
      );
      
      coverageTracker.trackBranch("LookCoin", "sendFrom-zero-amount");
    });

    it("should revert sendFrom with empty recipient", async function () {
      const amount = ethers.parseEther("100");
      
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.user).sendFrom(
          fixture.user.address,
          DESTINATION_CHAIN_ID,
          "0x",
          amount,
          fixture.user.address,
          ethers.ZeroAddress,
          "0x"
        ),
        fixture.lookCoin,
        "InvalidRecipient"
      );
      
      coverageTracker.trackBranch("LookCoin", "sendFrom-empty-recipient");
    });

    it("should revert sendFrom with unconfigured LayerZero", async function () {
      // Deploy fresh contract without configuration
      const freshFixture = await loadFixture(deployLookCoinFixture);
      await freshFixture.lookCoin.connect(freshFixture.minter).mint(freshFixture.user.address, ethers.parseEther("100"));
      
      const amount = ethers.parseEther("50");
      const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
      
      await expectSpecificRevert(
        async () => freshFixture.lookCoin.connect(freshFixture.user).sendFrom(
          freshFixture.user.address,
          DESTINATION_CHAIN_ID,
          recipient,
          amount,
          freshFixture.user.address,
          ethers.ZeroAddress,
          "0x"
        ),
        freshFixture.lookCoin,
        "LayerZeroNotConfigured"
      );
      
      coverageTracker.trackBranch("LookCoin", "sendFrom-unconfigured-lz");
    });

    it("should test sendFrom boolean combinations for configuration", async function () {
      const amount = ethers.parseEther("100");
      const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
      
      await testBooleanCombinations(
        "LayerZero configuration state for sendFrom",
        async () => fixture.lookCoin.isChainConfigured(DESTINATION_CHAIN_ID),
        async (value) => {
          if (!value) {
            // Deploy fresh unconfigured contract
            fixture = await loadFixture(deployLookCoinFixture);
            await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, ethers.parseEther("1000"));
          } else {
            // Configure
            const trustedRemote = ethers.solidityPacked(
              ["address", "address"],
              [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
            );
            await configureLookCoinForTesting(
              fixture.lookCoin,
              fixture.protocolAdmin,
              DESTINATION_CHAIN_ID,
              trustedRemote
            );
          }
        },
        async (combination) => {
          if (combination.to) {
            const [fee] = await fixture.lookCoin.estimateSendFee(
              DESTINATION_CHAIN_ID,
              recipient,
              amount,
              false,
              "0x"
            );
            
            await expect(
              fixture.lookCoin.connect(fixture.user).sendFrom(
                fixture.user.address,
                DESTINATION_CHAIN_ID,
                recipient,
                amount,
                fixture.user.address,
                ethers.ZeroAddress,
                "0x",
                { value: fee }
              )
            ).to.not.be.reverted;
          } else {
            await expectSpecificRevert(
              async () => fixture.lookCoin.connect(fixture.user).sendFrom(
                fixture.user.address,
                DESTINATION_CHAIN_ID,
                recipient,
                amount,
                fixture.user.address,
                ethers.ZeroAddress,
                "0x"
              ),
              fixture.lookCoin,
              "LayerZeroNotConfigured"
            );
          }
          
          coverageTracker.trackBooleanCombination("LookCoin", `sendFrom-config-${combination.description}`);
        }
      );
    });

    it("should handle custom adapter parameters", async function () {
      const amount = ethers.parseEther("100");
      const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
      
      // Custom adapter params for extra gas on destination
      const adapterParams = ethers.solidityPacked(
        ["uint16", "uint256"],
        [1, 500000] // Version 1, 500k gas
      );
      
      const [nativeFee] = await fixture.lookCoin.estimateSendFee(
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        false,
        adapterParams
      );
      
      await expect(
        fixture.lookCoin.connect(fixture.user).sendFrom(
          fixture.user.address,
          DESTINATION_CHAIN_ID,
          recipient,
          amount,
          fixture.user.address,
          ethers.ZeroAddress,
          adapterParams,
          { value: nativeFee }
        )
      ).to.not.be.reverted;
      
      coverageTracker.trackBranch("LookCoin", "sendFrom-custom-adapter-params");
    });
  });

  describe("Bridge Token Tests", function () {
    beforeEach(async function () {
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, ethers.parseEther("1000"));
    });

    it("should bridge tokens directly via LayerZero", async function () {
      const amount = ethers.parseEther("100");
      const recipient = TRUSTED_REMOTE_ADDRESS;
      
      const [nativeFee] = await fixture.lookCoin.estimateSendFee(
        DESTINATION_CHAIN_ID,
        ethers.toUtf8Bytes(recipient),
        amount,
        false,
        "0x"
      );
      
      const tx = await fixture.lookCoin.connect(fixture.user).bridgeToken(
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        { value: nativeFee }
      );
      
      await assertEventEmission(
        tx,
        fixture.lookCoin,
        "CrossChainTransferInitiated",
        [fixture.user.address, DESTINATION_CHAIN_ID, recipient, amount, 0] // Protocol 0 = LayerZero
      );
      
      coverageTracker.trackFunction("LookCoin", "bridgeToken");
      coverageTracker.trackBranch("LookCoin", "bridgeToken-direct-lz");
    });

    it("should bridge tokens via CrossChainRouter", async function () {
      // Configure router
      await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(0, DESTINATION_CHAIN_ID, true);
      
      // Grant BRIDGE_ROLE to router
      await fixture.lookCoin.grantRole(await fixture.lookCoin.BRIDGE_ROLE(), await fixture.crossChainRouter.getAddress());
      
      const amount = ethers.parseEther("100");
      const recipient = TRUSTED_REMOTE_ADDRESS;
      
      // Approve router
      await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
      
      // Bridge via router
      const tx = await fixture.crossChainRouter.connect(fixture.user).bridgeToken(
        0, // LayerZero protocol
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        { value: ethers.parseEther("0.01") }
      );
      
      await expect(tx).to.emit(fixture.crossChainRouter, "TransferInitiated");
      
      coverageTracker.trackBranch("LookCoin", "bridgeToken-via-router");
    });

    it("should test bridge token with router configured/unconfigured", async function () {
      await testBooleanCombinations(
        "Router configuration for bridgeToken",
        async () => {
          const routerHasRole = await fixture.lookCoin.hasRole(
            await fixture.lookCoin.BRIDGE_ROLE(),
            await fixture.crossChainRouter.getAddress()
          );
          const chainSupported = await fixture.crossChainRouter.protocolSupportsChain(0, DESTINATION_CHAIN_ID);
          return routerHasRole && chainSupported;
        },
        async (value) => {
          if (value) {
            await fixture.lookCoin.grantRole(await fixture.lookCoin.BRIDGE_ROLE(), await fixture.crossChainRouter.getAddress());
            await fixture.crossChainRouter.connect(fixture.admin).configureChainSupport(0, DESTINATION_CHAIN_ID, true);
          } else {
            await fixture.lookCoin.revokeRole(await fixture.lookCoin.BRIDGE_ROLE(), await fixture.crossChainRouter.getAddress());
          }
        },
        async (combination) => {
          const amount = ethers.parseEther("50");
          const recipient = TRUSTED_REMOTE_ADDRESS;
          
          if (combination.to) {
            // Should use router
            await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
            const tx = await fixture.crossChainRouter.connect(fixture.user).bridgeToken(
              0,
              DESTINATION_CHAIN_ID,
              recipient,
              amount,
              { value: ethers.parseEther("0.01") }
            );
            await expect(tx).to.emit(fixture.crossChainRouter, "TransferInitiated");
          } else {
            // Should use direct LayerZero
            const [fee] = await fixture.lookCoin.estimateSendFee(
              DESTINATION_CHAIN_ID,
              ethers.toUtf8Bytes(recipient),
              amount,
              false,
              "0x"
            );
            
            const tx = await fixture.lookCoin.connect(fixture.user).bridgeToken(
              DESTINATION_CHAIN_ID,
              recipient,
              amount,
              { value: fee }
            );
            
            await assertEventEmission(
              tx,
              fixture.lookCoin,
              "CrossChainTransferInitiated",
              [fixture.user.address, DESTINATION_CHAIN_ID, recipient, amount, 0]
            );
          }
          
          coverageTracker.trackBooleanCombination("LookCoin", `bridgeToken-router-${combination.description}`);
        }
      );
    });
  });

  describe("Inbound Transfer Tests (lzReceive)", function () {
    it("should receive tokens from LayerZero endpoint", async function () {
      const amount = ethers.parseEther("100");
      const recipient = fixture.user.address;
      
      // Encode packet
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "uint256"],
        [recipient, amount]
      );
      const packet = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint16", "bytes"],
        [0, payload] // PT_SEND = 0
      );
      
      // Set mock as endpoint
      await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(fixture.user.address);
      
      // Execute receive
      const tx = await fixture.lookCoin.connect(fixture.user).lzReceive(
        DESTINATION_CHAIN_ID,
        ethers.solidityPacked(
          ["address", "address"],
          [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
        ),
        1, // nonce
        packet
      );
      
      // Verify mint
      await assertBalanceChanges(
        fixture.lookCoin,
        recipient,
        amount,
        async () => { /* already executed */ }
      );
      
      // Verify supply tracking
      expect(await fixture.lookCoin.totalMinted()).to.equal(amount);
      
      // Verify event
      await assertEventEmission(
        tx,
        fixture.lookCoin,
        "ReceiveFromChain",
        [DESTINATION_CHAIN_ID, ethers.utils.getAddress(recipient), amount, 1]
      );
      
      coverageTracker.trackFunction("LookCoin", "lzReceive");
      coverageTracker.trackBranch("LookCoin", "lzReceive-success");
    });

    it("should revert lzReceive from unauthorized caller", async function () {
      const packet = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint16", "bytes"],
        [0, "0x"]
      );
      
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.user).lzReceive(
          DESTINATION_CHAIN_ID,
          "0x",
          1,
          packet
        ),
        fixture.lookCoin,
        "InvalidEndpointCaller"
      );
      
      coverageTracker.trackBranch("LookCoin", "lzReceive-unauthorized-caller");
    });

    it("should revert lzReceive from untrusted source", async function () {
      const packet = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint16", "bytes"],
        [0, "0x"]
      );
      
      // Set user as endpoint
      await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(fixture.user.address);
      
      // Wrong source address
      const untrustedSource = ethers.solidityPacked(
        ["address", "address"],
        ["0x" + "9".repeat(40), await fixture.lookCoin.getAddress()]
      );
      
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.user).lzReceive(
          DESTINATION_CHAIN_ID,
          untrustedSource,
          1,
          packet
        ),
        fixture.lookCoin,
        "InvalidSourceAddress"
      );
      
      coverageTracker.trackBranch("LookCoin", "lzReceive-untrusted-source");
    });

    it("should revert lzReceive with duplicate nonce", async function () {
      const amount = ethers.parseEther("100");
      const recipient = fixture.user.address;
      const nonce = 42;
      
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "uint256"],
        [recipient, amount]
      );
      const packet = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint16", "bytes"],
        [0, payload]
      );
      
      // Set mock as endpoint
      await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(fixture.user.address);
      
      const trustedSource = ethers.solidityPacked(
        ["address", "address"],
        [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
      );
      
      // First receive succeeds
      await fixture.lookCoin.connect(fixture.user).lzReceive(
        DESTINATION_CHAIN_ID,
        trustedSource,
        nonce,
        packet
      );
      
      // Second receive with same nonce fails
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.user).lzReceive(
          DESTINATION_CHAIN_ID,
          trustedSource,
          nonce,
          packet
        ),
        fixture.lookCoin,
        "NonceAlreadyProcessed"
      );
      
      coverageTracker.trackBranch("LookCoin", "lzReceive-duplicate-nonce");
    });

    it("should revert lzReceive with invalid packet type", async function () {
      const packet = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint16", "bytes"],
        [999, "0x"] // Invalid packet type
      );
      
      await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(fixture.user.address);
      
      const trustedSource = ethers.solidityPacked(
        ["address", "address"],
        [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
      );
      
      await expectSpecificRevert(
        async () => fixture.lookCoin.connect(fixture.user).lzReceive(
          DESTINATION_CHAIN_ID,
          trustedSource,
          1,
          packet
        ),
        fixture.lookCoin,
        "InvalidPacketType"
      );
      
      coverageTracker.trackBranch("LookCoin", "lzReceive-invalid-packet-type");
    });

    it("should test lzReceive boolean combinations", async function () {
      const amount = ethers.parseEther("100");
      const recipient = fixture.user.address;
      
      // Test combinations of: authorized caller, trusted source, processed nonce
      for (let i = 0; i < 8; i++) {
        const isAuthorizedCaller = (i & 1) !== 0;
        const isTrustedSource = (i & 2) !== 0;
        const isNewNonce = (i & 4) !== 0;
        
        // Reset fixture for each test
        fixture = await loadFixture(deployLookCoinFixture);
        const trustedRemote = ethers.solidityPacked(
          ["address", "address"],
          [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
        );
        await configureLookCoinForTesting(
          fixture.lookCoin,
          fixture.protocolAdmin,
          DESTINATION_CHAIN_ID,
          trustedRemote
        );
        
        // Set endpoint
        await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(
          isAuthorizedCaller ? fixture.user.address : fixture.user2.address
        );
        
        const source = isTrustedSource ? trustedRemote : ethers.solidityPacked(
          ["address", "address"],
          ["0x" + "9".repeat(40), await fixture.lookCoin.getAddress()]
        );
        
        const nonce = isNewNonce ? i + 100 : 1;
        
        // Process nonce 1 if testing duplicate
        if (!isNewNonce) {
          const payload = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes", "uint256"],
            [recipient, amount]
          );
          const packet = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint16", "bytes"],
            [0, payload]
          );
          
          await fixture.lookCoin.connect(isAuthorizedCaller ? fixture.user : fixture.user2).lzReceive(
            DESTINATION_CHAIN_ID,
            trustedRemote,
            1,
            packet
          );
        }
        
        // Prepare packet
        const payload = ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes", "uint256"],
          [recipient, amount]
        );
        const packet = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint16", "bytes"],
          [0, payload]
        );
        
        // Test receive
        if (isAuthorizedCaller && isTrustedSource && isNewNonce) {
          await expect(
            fixture.lookCoin.connect(fixture.user).lzReceive(
              DESTINATION_CHAIN_ID,
              source,
              nonce,
              packet
            )
          ).to.not.be.reverted;
        } else {
          let expectedError = "InvalidEndpointCaller";
          if (isAuthorizedCaller && !isTrustedSource) expectedError = "InvalidSourceAddress";
          if (isAuthorizedCaller && isTrustedSource && !isNewNonce) expectedError = "NonceAlreadyProcessed";
          
          await expectSpecificRevert(
            async () => fixture.lookCoin.connect(fixture.user).lzReceive(
              DESTINATION_CHAIN_ID,
              source,
              nonce,
              packet
            ),
            fixture.lookCoin,
            expectedError
          );
        }
        
        coverageTracker.trackBooleanCombination(
          "LookCoin",
          `lzReceive-auth:${isAuthorizedCaller}-trust:${isTrustedSource}-nonce:${isNewNonce}`
        );
      }
    });
  });

  describe("Fee Estimation Tests", function () {
    it("should estimate bridge fee with various configurations", async function () {
      const amount = ethers.parseEther("100");
      const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
      
      // Test with default adapter params
      const [defaultFee] = await fixture.lookCoin.estimateSendFee(
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        false,
        "0x"
      );
      expect(defaultFee).to.be.gt(0);
      
      // Test with custom adapter params
      const customAdapterParams = ethers.solidityPacked(
        ["uint16", "uint256"],
        [1, 1000000] // 1M gas
      );
      const [customFee] = await fixture.lookCoin.estimateSendFee(
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        false,
        customAdapterParams
      );
      expect(customFee).to.be.gte(defaultFee);
      
      coverageTracker.trackFunction("LookCoin", "estimateSendFee");
    });

    it("should estimate bridge fee via estimateBridgeFee", async function () {
      const amount = ethers.parseEther("100");
      
      const [fee, time] = await fixture.lookCoin.estimateBridgeFee(
        DESTINATION_CHAIN_ID,
        amount
      );
      
      expect(fee).to.equal(ethers.parseEther("0.01")); // Mock returns fixed fee
      expect(time).to.equal(10); // LayerZero estimated time
      
      coverageTracker.trackFunction("LookCoin", "estimateBridgeFee");
    });

    it("should revert fee estimation with unconfigured LayerZero", async function () {
      const freshFixture = await loadFixture(deployLookCoinFixture);
      
      await expectSpecificRevert(
        async () => freshFixture.lookCoin.estimateBridgeFee(
          DESTINATION_CHAIN_ID,
          ethers.parseEther("100")
        ),
        freshFixture.lookCoin,
        "LayerZeroNotConfigured"
      );
      
      coverageTracker.trackBranch("LookCoin", "estimateBridgeFee-unconfigured");
    });

    it("should handle fee estimation with enforced options", async function () {
      // Set enforced options
      const enforcedOptions = ethers.solidityPacked(
        ["uint16", "uint256"],
        [1, 500000]
      );
      await fixture.lookCoin.connect(fixture.protocolAdmin).setEnforcedOptions(
        DESTINATION_CHAIN_ID,
        enforcedOptions
      );
      
      const amount = ethers.parseEther("100");
      const [fee] = await fixture.lookCoin.estimateBridgeFee(
        DESTINATION_CHAIN_ID,
        amount
      );
      
      expect(fee).to.be.gt(0);
      
      coverageTracker.trackBranch("LookCoin", "fee-estimation-enforced-options");
    });
  });

  describe("Configuration Integration Tests", function () {
    it("should validate complete configuration for operations", async function () {
      // Test with partial configuration
      const freshFixture = await loadFixture(deployLookCoinFixture);
      
      // Only set endpoint
      await freshFixture.lookCoin.connect(freshFixture.owner).setLayerZeroEndpoint(freshFixture.mockLayerZero.address);
      
      // Should still fail
      expect(await freshFixture.lookCoin.isChainConfigured(DESTINATION_CHAIN_ID)).to.be.false;
      
      // Add trusted remote
      const trustedRemote = ethers.solidityPacked(
        ["address", "address"],
        [TRUSTED_REMOTE_ADDRESS, freshFixture.lookCoin.address]
      );
      await freshFixture.lookCoin.connect(freshFixture.protocolAdmin).setTrustedRemote(
        DESTINATION_CHAIN_ID,
        trustedRemote
      );
      
      // Still incomplete without gas
      expect(await freshFixture.lookCoin.isChainConfigured(DESTINATION_CHAIN_ID)).to.be.false;
      
      // Add gas configuration
      await freshFixture.lookCoin.connect(freshFixture.protocolAdmin).setGasForDestinationLzReceive(
        DESTINATION_CHAIN_ID,
        200000
      );
      
      // Now complete
      expect(await freshFixture.lookCoin.isChainConfigured(DESTINATION_CHAIN_ID)).to.be.true;
      
      coverageTracker.trackBranch("LookCoin", "configuration-validation-complete");
    });
  });

  describe("Event Emission Tests", function () {
    it("should emit correct events for outbound transfers", async function () {
      const amount = ethers.parseEther("100");
      const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
      
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
      
      const [fee] = await fixture.lookCoin.estimateSendFee(
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        false,
        "0x"
      );
      
      const tx = await fixture.lookCoin.connect(fixture.user).sendFrom(
        fixture.user.address,
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        fixture.user.address,
        ethers.ZeroAddress,
        "0x",
        { value: fee }
      );
      
      // Check SendToChain event
      await assertEventEmission(
        tx,
        fixture.lookCoin,
        "SendToChain",
        [DESTINATION_CHAIN_ID, fixture.user.address, recipient, amount]
      );
      
      // For bridgeToken
      const tx2 = await fixture.lookCoin.connect(fixture.user).bridgeToken(
        DESTINATION_CHAIN_ID,
        TRUSTED_REMOTE_ADDRESS,
        amount,
        { value: fee }
      );
      
      await assertEventEmission(
        tx2,
        fixture.lookCoin,
        "CrossChainTransferInitiated",
        [fixture.user.address, DESTINATION_CHAIN_ID, TRUSTED_REMOTE_ADDRESS, amount, 0]
      );
      
      coverageTracker.trackBranch("LookCoin", "event-emission-outbound");
    });

    it("should emit correct events for inbound transfers", async function () {
      const amount = ethers.parseEther("100");
      const recipient = fixture.user.address;
      
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "uint256"],
        [recipient, amount]
      );
      const packet = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint16", "bytes"],
        [0, payload]
      );
      
      await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(fixture.user.address);
      
      const tx = await fixture.lookCoin.connect(fixture.user).lzReceive(
        DESTINATION_CHAIN_ID,
        ethers.solidityPacked(
          ["address", "address"],
          [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
        ),
        1,
        packet
      );
      
      await assertEventEmission(
        tx,
        fixture.lookCoin,
        "ReceiveFromChain",
        [DESTINATION_CHAIN_ID, ethers.utils.getAddress(recipient), amount, 1]
      );
      
      await assertEventEmission(
        tx,
        fixture.lookCoin,
        "CrossChainTransferReceived",
        [DESTINATION_CHAIN_ID, ethers.utils.getAddress(recipient), amount, 0]
      );
      
      coverageTracker.trackBranch("LookCoin", "event-emission-inbound");
    });
  });

  describe("Mock LayerZero Integration Tests", function () {
    it("should test end-to-end flow with mock", async function () {
      const amount = ethers.parseEther("100");
      const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
      
      // Setup source chain
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
      const balanceBefore = await fixture.lookCoin.balanceOf(fixture.user.address);
      
      // Execute outbound
      const [fee] = await fixture.lookCoin.estimateSendFee(
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        false,
        "0x"
      );
      
      await fixture.lookCoin.connect(fixture.user).sendFrom(
        fixture.user.address,
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        fixture.user.address,
        ethers.ZeroAddress,
        "0x",
        { value: fee }
      );
      
      // Verify burn
      const balanceAfter = await fixture.lookCoin.balanceOf(fixture.user.address);
      expect(balanceBefore - balanceAfter).to.equal(amount);
      expect(await fixture.lookCoin.totalBurned()).to.equal(amount);
      
      // Simulate inbound on destination
      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "uint256"],
        [fixture.user2.address, amount]
      );
      const packet = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint16", "bytes"],
        [0, payload]
      );
      
      await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(fixture.user.address);
      
      await fixture.lookCoin.connect(fixture.user).lzReceive(
        DESTINATION_CHAIN_ID,
        ethers.solidityPacked(
          ["address", "address"],
          [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
        ),
        1,
        packet
      );
      
      // Verify mint
      expect(await fixture.lookCoin.balanceOf(fixture.user2.address)).to.equal(amount);
      expect(await fixture.lookCoin.totalMinted()).to.equal(amount);
      
      coverageTracker.trackBranch("LookCoin", "end-to-end-flow");
    });

    it("should handle mock failure scenarios", async function () {
      // Configure mock to fail
      await setupMockLayerZero(fixture.mockLayerZero, false);
      
      const amount = ethers.parseEther("100");
      const recipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
      
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
      
      const [fee] = await fixture.lookCoin.estimateSendFee(
        DESTINATION_CHAIN_ID,
        recipient,
        amount,
        false,
        "0x"
      );
      
      // Mock will cause send to fail
      await expect(
        fixture.lookCoin.connect(fixture.user).sendFrom(
          fixture.user.address,
          DESTINATION_CHAIN_ID,
          recipient,
          amount,
          fixture.user.address,
          ethers.ZeroAddress,
          "0x",
          { value: fee }
        )
      ).to.be.reverted;
      
      coverageTracker.trackBranch("LookCoin", "mock-failure-handling");
    });
  });
});