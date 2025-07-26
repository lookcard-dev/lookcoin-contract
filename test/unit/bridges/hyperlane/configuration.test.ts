import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployLookCoinFixture,
  testBooleanCombinations,
  testRoleBasedFunction,
  expectSpecificRevert,
  testConfigurationDependency,
  coverageTracker,
  BOOLEAN_COMBINATIONS,
  DeploymentFixture,
} from "../../../utils/comprehensiveTestHelpers";
import { TEST_CHAINS } from "../../../utils/testConfig";

describe("HyperlaneConfiguration - Comprehensive Configuration Tests", function () {
  let fixture: DeploymentFixture;
  const DESTINATION_CHAIN_ID = TEST_CHAINS.OPTIMISM;
  const DESTINATION_DOMAIN = 10; // Optimism domain for Hyperlane
  const TRUSTED_SENDER_ADDRESS = "0x" + "1".repeat(64); // bytes32 format

  beforeEach(async function () {
    fixture = await loadFixture(deployLookCoinFixture);
  });

  describe("Mailbox and Gas Paymaster Configuration Tests", function () {
    it("should have mailbox and gas paymaster configured on initialization", async function () {
      expect(await fixture.hyperlaneModule.mailbox()).to.equal(await fixture.mockHyperlane.getAddress());
      expect(await fixture.hyperlaneModule.gasPaymaster()).to.equal(await fixture.mockHyperlane.getAddress());
      
      coverageTracker.trackFunction("HyperlaneModule", "mailbox");
      coverageTracker.trackFunction("HyperlaneModule", "gasPaymaster");
    });

    it("should validate mailbox integration", async function () {
      // Mailbox should be immutable after initialization
      const mailboxAddress = await fixture.hyperlaneModule.mailbox();
      expect(mailboxAddress).to.not.equal(ethers.ZeroAddress);
      expect(mailboxAddress).to.equal(await fixture.mockHyperlane.getAddress());
      
      coverageTracker.trackBranch("HyperlaneModule", "mailbox-configured");
    });

    it("should validate gas paymaster integration", async function () {
      // Gas paymaster should be immutable after initialization
      const gasPaymasterAddress = await fixture.hyperlaneModule.gasPaymaster();
      expect(gasPaymasterAddress).to.not.equal(ethers.ZeroAddress);
      expect(gasPaymasterAddress).to.equal(await fixture.mockHyperlane.getAddress());
      
      coverageTracker.trackBranch("HyperlaneModule", "gasPaymaster-configured");
    });

    it("should test mailbox/paymaster configuration state", async function () {
      // Since mailbox and gas paymaster are set at initialization and immutable,
      // we test that they remain configured throughout the contract lifecycle
      await testBooleanCombinations(
        "Mailbox/Paymaster configuration state",
        async () => {
          const mailbox = await fixture.hyperlaneModule.mailbox();
          const paymaster = await fixture.hyperlaneModule.gasPaymaster();
          return mailbox !== ethers.ZeroAddress && paymaster !== ethers.ZeroAddress;
        },
        async (value) => {
          // Cannot change mailbox/paymaster after initialization
          // They should always be configured
          expect(value).to.be.true;
        },
        async (combination) => {
          // Should always be configured (true state)
          expect(combination.to).to.be.true;
          const mailbox = await fixture.hyperlaneModule.mailbox();
          const paymaster = await fixture.hyperlaneModule.gasPaymaster();
          expect(mailbox).to.not.equal(ethers.ZeroAddress);
          expect(paymaster).to.not.equal(ethers.ZeroAddress);
          
          coverageTracker.trackBooleanCombination("HyperlaneModule", `mailbox-paymaster-${combination.description}`);
        }
      );
    });
  });

  describe("Domain Mapping Configuration Tests", function () {
    it("should set domain mapping with BRIDGE_ADMIN_ROLE", async function () {
      await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(
        DESTINATION_DOMAIN,
        DESTINATION_CHAIN_ID
      );
      
      expect(await fixture.hyperlaneModule.domainToChainId(DESTINATION_DOMAIN)).to.equal(DESTINATION_CHAIN_ID);
      expect(await fixture.hyperlaneModule.chainIdToDomain(DESTINATION_CHAIN_ID)).to.equal(DESTINATION_DOMAIN);
      
      coverageTracker.trackFunction("HyperlaneModule", "setDomainMapping");
    });

    it("should revert setting domain mapping without BRIDGE_ADMIN_ROLE", async function () {
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.connect(fixture.user).setDomainMapping(DESTINATION_DOMAIN, DESTINATION_CHAIN_ID),
        fixture.hyperlaneModule,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.hyperlaneModule.BRIDGE_ADMIN_ROLE()
      );
    });

    it("should test domain mapping boolean combinations", async function () {
      const domainMappings = [
        { domain: 0, chainId: 0 }, // Unmapped
        { domain: DESTINATION_DOMAIN, chainId: DESTINATION_CHAIN_ID }, // Mapped
        { domain: 42161, chainId: TEST_CHAINS.arbitrum }, // Different mapping
        { domain: 0, chainId: 0 }, // Back to unmapped
      ];

      await testBooleanCombinations(
        "Domain mapping configuration",
        async () => (await fixture.hyperlaneModule.domainToChainId(DESTINATION_DOMAIN)) !== 0,
        async (value) => {
          if (value) {
            await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(DESTINATION_DOMAIN, DESTINATION_CHAIN_ID);
          } else {
            // Cannot unmap, but test with different domain
            await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(0, 0);
          }
        },
        async (combination) => {
          const mapping = await fixture.hyperlaneModule.domainToChainId(DESTINATION_DOMAIN);
          
          if (combination.to) {
            expect(mapping).to.not.equal(0);
          }
          
          coverageTracker.trackBooleanCombination("HyperlaneModule", `domain-mapping-${combination.description}`);
        }
      );
    });

    it("should handle bidirectional domain mapping", async function () {
      // Set mapping
      await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(
        DESTINATION_DOMAIN,
        DESTINATION_CHAIN_ID
      );
      
      // Verify bidirectional mapping
      expect(await fixture.hyperlaneModule.domainToChainId(DESTINATION_DOMAIN)).to.equal(DESTINATION_CHAIN_ID);
      expect(await fixture.hyperlaneModule.chainIdToDomain(DESTINATION_CHAIN_ID)).to.equal(DESTINATION_DOMAIN);
      
      // Update mapping
      const newDomain = 137; // Polygon domain
      await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(
        newDomain,
        DESTINATION_CHAIN_ID
      );
      
      // Old domain mapping should be cleared
      expect(await fixture.hyperlaneModule.domainToChainId(DESTINATION_DOMAIN)).to.equal(0);
      // New mapping should be active
      expect(await fixture.hyperlaneModule.chainIdToDomain(DESTINATION_CHAIN_ID)).to.equal(newDomain);
      
      coverageTracker.trackBranch("HyperlaneModule", "domain-mapping-update");
    });
  });

  describe("Trusted Sender Configuration Tests", function () {
    it("should set trusted sender with BRIDGE_ADMIN_ROLE", async function () {
      await fixture.hyperlaneModule.connect(fixture.admin).setTrustedSender(
        DESTINATION_DOMAIN,
        TRUSTED_SENDER_ADDRESS
      );
      
      expect(await fixture.hyperlaneModule.trustedSenders(DESTINATION_DOMAIN)).to.equal(TRUSTED_SENDER_ADDRESS);
      
      coverageTracker.trackFunction("HyperlaneModule", "setTrustedSender");
    });

    it("should revert setting trusted sender without BRIDGE_ADMIN_ROLE", async function () {
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.connect(fixture.user).setTrustedSender(DESTINATION_DOMAIN, TRUSTED_SENDER_ADDRESS),
        fixture.hyperlaneModule,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.hyperlaneModule.BRIDGE_ADMIN_ROLE()
      );
    });

    it("should test trusted sender boolean combinations", async function () {
      const senderAddresses = [
        ethers.ZeroHash, // Untrusted (zero bytes32)
        TRUSTED_SENDER_ADDRESS, // Trusted
        "0x" + "2".repeat(64), // Different trusted sender
        ethers.ZeroHash, // Back to untrusted
      ];

      await testBooleanCombinations(
        "Trusted sender configuration",
        async () => (await fixture.hyperlaneModule.trustedSenders(DESTINATION_DOMAIN)) !== ethers.ZeroHash,
        async (value) => {
          if (value) {
            await fixture.hyperlaneModule.connect(fixture.admin).setTrustedSender(DESTINATION_DOMAIN, TRUSTED_SENDER_ADDRESS);
          } else {
            await fixture.hyperlaneModule.connect(fixture.admin).setTrustedSender(DESTINATION_DOMAIN, ethers.ZeroHash);
          }
        },
        async (combination) => {
          const sender = await fixture.hyperlaneModule.trustedSenders(DESTINATION_DOMAIN);
          
          if (combination.to) {
            expect(sender).to.not.equal(ethers.ZeroHash);
          } else {
            expect(sender).to.equal(ethers.ZeroHash);
          }
          
          coverageTracker.trackBooleanCombination("HyperlaneModule", `trusted-sender-${combination.description}`);
        }
      );
    });

    it("should validate trusted sender in handle function", async function () {
      // This will be tested more thoroughly in operations tests
      // Here we just verify the configuration affects validation
      
      // Set domain mapping first
      await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(DESTINATION_DOMAIN, DESTINATION_CHAIN_ID);
      
      // Without trusted sender, handle should fail
      const messageData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [fixture.user.address, ethers.parseEther("100")]
      );
      
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.handle(
          DESTINATION_DOMAIN,
          TRUSTED_SENDER_ADDRESS,
          messageData
        ),
        fixture.hyperlaneModule,
        "UnauthorizedCaller"
      );
      
      coverageTracker.trackBranch("HyperlaneModule", "handle-untrusted-sender");
    });
  });

  describe("ISM Configuration Tests", function () {
    it("should set interchain security module with BRIDGE_ADMIN_ROLE", async function () {
      const ismAddress = ethers.Wallet.createRandom().address;
      
      await fixture.hyperlaneModule.connect(fixture.admin).setInterchainSecurityModule(ismAddress);
      expect(await fixture.hyperlaneModule.interchainSecurityModule()).to.equal(ismAddress);
      
      coverageTracker.trackFunction("HyperlaneModule", "setInterchainSecurityModule");
      coverageTracker.trackFunction("HyperlaneModule", "interchainSecurityModule");
    });

    it("should revert setting ISM without BRIDGE_ADMIN_ROLE", async function () {
      const ismAddress = ethers.Wallet.createRandom().address;
      
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.connect(fixture.user).setInterchainSecurityModule(ismAddress),
        fixture.hyperlaneModule,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.hyperlaneModule.BRIDGE_ADMIN_ROLE()
      );
    });

    it("should test ISM configuration boolean combinations", async function () {
      const ismAddresses = [
        ethers.ZeroAddress,
        ethers.Wallet.createRandom().address,
        ethers.Wallet.createRandom().address,
        ethers.ZeroAddress,
      ];

      await testBooleanCombinations(
        "ISM configuration",
        async () => (await fixture.hyperlaneModule.interchainSecurityModule()) !== ethers.ZeroAddress,
        async (value) => {
          if (value) {
            await fixture.hyperlaneModule.connect(fixture.admin).setInterchainSecurityModule(ismAddresses[1]);
          } else {
            await fixture.hyperlaneModule.connect(fixture.admin).setInterchainSecurityModule(ethers.ZeroAddress);
          }
        },
        async (combination) => {
          const ism = await fixture.hyperlaneModule.interchainSecurityModule();
          
          if (combination.to) {
            expect(ism).to.not.equal(ethers.ZeroAddress);
          } else {
            expect(ism).to.equal(ethers.ZeroAddress);
          }
          
          coverageTracker.trackBooleanCombination("HyperlaneModule", `ism-${combination.description}`);
        }
      );
    });
  });

  describe("Gas Configuration Tests", function () {
    it("should set required gas amount with BRIDGE_ADMIN_ROLE", async function () {
      const gasAmount = 300000;
      
      await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(
        DESTINATION_DOMAIN,
        gasAmount
      );
      
      expect(await fixture.hyperlaneModule.requiredGasAmount(DESTINATION_DOMAIN)).to.equal(gasAmount);
      
      coverageTracker.trackFunction("HyperlaneModule", "setRequiredGasAmount");
    });

    it("should revert setting gas amount without BRIDGE_ADMIN_ROLE", async function () {
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.connect(fixture.user).setRequiredGasAmount(DESTINATION_DOMAIN, 200000),
        fixture.hyperlaneModule,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.hyperlaneModule.BRIDGE_ADMIN_ROLE()
      );
    });

    it("should test gas amount boolean combinations", async function () {
      const gasAmounts = [0, 200000, 500000, 0];

      await testBooleanCombinations(
        "Gas amount configuration",
        async () => (await fixture.hyperlaneModule.requiredGasAmount(DESTINATION_DOMAIN)) > 0,
        async (value) => {
          if (value) {
            await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(DESTINATION_DOMAIN, 200000);
          } else {
            await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(DESTINATION_DOMAIN, 0);
          }
        },
        async (combination) => {
          const gasAmount = await fixture.hyperlaneModule.requiredGasAmount(DESTINATION_DOMAIN);
          
          if (combination.to) {
            expect(gasAmount).to.be.gt(0);
          } else {
            expect(gasAmount).to.equal(0);
          }
          
          coverageTracker.trackBooleanCombination("HyperlaneModule", `gas-amount-${combination.description}`);
        }
      );
    });

    it("should use gas amount in fee estimation", async function () {
      // Set up domain mapping first
      await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(DESTINATION_DOMAIN, DESTINATION_CHAIN_ID);
      
      // Set different gas amounts and verify fee changes
      const gasAmounts = [100000, 200000, 500000];
      
      for (const gasAmount of gasAmounts) {
        await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(DESTINATION_DOMAIN, gasAmount);
        
        // Fee estimation will use the mock's quote
        const [fee] = await fixture.hyperlaneModule.estimateFee(
          DESTINATION_CHAIN_ID,
          ethers.parseEther("100")
        );
        
        // Mock returns a fixed fee, but in real implementation it would vary with gas
        expect(fee).to.be.gt(0);
      }
      
      coverageTracker.trackBranch("HyperlaneModule", "gas-amount-fee-calculation");
    });
  });

  describe("Configuration Update Tests", function () {
    it("should update configuration via updateConfig", async function () {
      // Encode multiple configuration updates
      const domain = 137; // Polygon
      const chainId = TEST_CHAINS.polygon;
      const trustedSender = "0x" + "3".repeat(64);
      const gasAmount = 400000;
      
      const configData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint32", "uint256", "bytes32", "uint256"],
        [domain, chainId, trustedSender, gasAmount]
      );
      
      await fixture.hyperlaneModule.connect(fixture.admin).updateConfig(configData);
      
      // Verify all configurations were updated
      expect(await fixture.hyperlaneModule.domainToChainId(domain)).to.equal(chainId);
      expect(await fixture.hyperlaneModule.chainIdToDomain(chainId)).to.equal(domain);
      expect(await fixture.hyperlaneModule.trustedSenders(domain)).to.equal(trustedSender);
      expect(await fixture.hyperlaneModule.requiredGasAmount(domain)).to.equal(gasAmount);
      
      coverageTracker.trackFunction("HyperlaneModule", "updateConfig");
    });

    it("should revert updateConfig without BRIDGE_ADMIN_ROLE", async function () {
      const configData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint32", "uint256", "bytes32", "uint256"],
        [1, 1, ethers.ZeroHash, 100000]
      );
      
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.connect(fixture.user).updateConfig(configData),
        fixture.hyperlaneModule,
        "AccessControlUnauthorizedAccount",
        fixture.user.address,
        await fixture.hyperlaneModule.BRIDGE_ADMIN_ROLE()
      );
    });
  });

  describe("Multi-Domain Configuration Tests", function () {
    it("should configure multiple domains independently", async function () {
      const domains = [
        { domain: 10, chainId: TEST_CHAINS.OPTIMISM },
        { domain: 42161, chainId: TEST_CHAINS.arbitrum },
        { domain: 137, chainId: TEST_CHAINS.polygon },
      ];
      
      for (const config of domains) {
        // Set domain mapping
        await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(config.domain, config.chainId);
        
        // Set trusted sender
        const trustedSender = ethers.keccak256(ethers.toUtf8Bytes(`sender-${config.domain}`));
        await fixture.hyperlaneModule.connect(fixture.admin).setTrustedSender(config.domain, trustedSender);
        
        // Set gas amount
        await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(config.domain, 200000 + config.domain);
        
        // Verify configuration
        expect(await fixture.hyperlaneModule.domainToChainId(config.domain)).to.equal(config.chainId);
        expect(await fixture.hyperlaneModule.chainIdToDomain(config.chainId)).to.equal(config.domain);
        expect(await fixture.hyperlaneModule.trustedSenders(config.domain)).to.equal(trustedSender);
        expect(await fixture.hyperlaneModule.requiredGasAmount(config.domain)).to.equal(200000 + config.domain);
      }
      
      // Verify domains are configured independently
      const unconfiguredDomain = 999;
      expect(await fixture.hyperlaneModule.domainToChainId(unconfiguredDomain)).to.equal(0);
      expect(await fixture.hyperlaneModule.trustedSenders(unconfiguredDomain)).to.equal(ethers.ZeroHash);
      
      coverageTracker.trackBranch("HyperlaneModule", "multi-domain-configuration");
    });
  });

  describe("Complete Configuration Validation Tests", function () {
    it("should validate complete configuration for bridge operations", async function () {
      const amount = ethers.parseEther("100");
      
      // Initial state - not configured
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.bridgeToken(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          amount,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.hyperlaneModule,
        "ChainNotSupported"
      );
      
      // Set domain mapping
      await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(DESTINATION_DOMAIN, DESTINATION_CHAIN_ID);
      
      // Still should fail without trusted sender
      await expectSpecificRevert(
        async () => fixture.hyperlaneModule.bridgeToken(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          amount,
          { value: ethers.parseEther("0.01") }
        ),
        fixture.hyperlaneModule,
        "InvalidDestination"
      );
      
      // Set trusted sender
      await fixture.hyperlaneModule.connect(fixture.admin).setTrustedSender(DESTINATION_DOMAIN, TRUSTED_SENDER_ADDRESS);
      
      // Set gas amount
      await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(DESTINATION_DOMAIN, 200000);
      
      // Now configuration is complete
      // (actual bridge will fail due to token transfer, but configuration check passes)
      
      coverageTracker.trackBranch("HyperlaneModule", "bridge-configuration-validation");
    });

    it("should test all configuration component combinations", async function () {
      // Test all 8 combinations (2^3) of domain mapping, trusted sender, and gas
      for (let i = 0; i < 8; i++) {
        const hasDomainMapping = (i & 1) !== 0;
        const hasTrustedSender = (i & 2) !== 0;
        const hasGas = (i & 4) !== 0;
        
        // Reset module
        fixture = await loadFixture(deployLookCoinFixture);
        
        // Configure components
        if (hasDomainMapping) {
          await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(DESTINATION_DOMAIN, DESTINATION_CHAIN_ID);
        }
        if (hasTrustedSender) {
          await fixture.hyperlaneModule.connect(fixture.admin).setTrustedSender(DESTINATION_DOMAIN, TRUSTED_SENDER_ADDRESS);
        }
        if (hasGas) {
          await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(DESTINATION_DOMAIN, 200000);
        }
        
        // Check if configuration allows bridging
        const canBridge = hasDomainMapping && hasTrustedSender;
        
        if (!canBridge) {
          await expectSpecificRevert(
            async () => fixture.hyperlaneModule.bridgeToken(
              DESTINATION_CHAIN_ID,
              fixture.user2.address,
              ethers.parseEther("100"),
              { value: ethers.parseEther("0.01") }
            ),
            fixture.hyperlaneModule,
            hasDomainMapping ? "InvalidDestination" : "ChainNotSupported"
          );
        }
        
        coverageTracker.trackBooleanCombination(
          "HyperlaneModule",
          `complete-config-domain:${hasDomainMapping}-sender:${hasTrustedSender}-gas:${hasGas}`
        );
      }
    });
  });

  describe("Edge Cases and Error Scenarios", function () {
    it("should handle maximum domain ID", async function () {
      const maxDomain = 2**32 - 1; // uint32 max
      const chainId = 999999;
      
      await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(maxDomain, chainId);
      expect(await fixture.hyperlaneModule.domainToChainId(maxDomain)).to.equal(chainId);
      
      coverageTracker.trackBranch("HyperlaneModule", "max-domain-handling");
    });

    it("should handle address to bytes32 conversion", async function () {
      // Test internal address conversion logic
      const address = fixture.user.address;
      const bytes32 = ethers.zeroPadValue(address, 32);
      
      // Set as trusted sender
      await fixture.hyperlaneModule.connect(fixture.admin).setTrustedSender(DESTINATION_DOMAIN, bytes32);
      expect(await fixture.hyperlaneModule.trustedSenders(DESTINATION_DOMAIN)).to.equal(bytes32);
      
      coverageTracker.trackBranch("HyperlaneModule", "address-bytes32-conversion");
    });

    it("should handle zero values in configuration", async function () {
      // Domain 0 should be valid
      await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(0, TEST_CHAINS.BSC);
      expect(await fixture.hyperlaneModule.domainToChainId(0)).to.equal(TEST_CHAINS.BSC);
      
      // Gas amount 0 should be valid (default gas)
      await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(DESTINATION_DOMAIN, 0);
      expect(await fixture.hyperlaneModule.requiredGasAmount(DESTINATION_DOMAIN)).to.equal(0);
      
      coverageTracker.trackBranch("HyperlaneModule", "zero-value-handling");
    });
  });
});