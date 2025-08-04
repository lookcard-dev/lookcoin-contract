import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { HyperlaneModule, LookCoin, MockHyperlaneMailbox } from "../../typechain-types";
import { deployBridgeFixture } from "../helpers/fixtures";
import {
  CONTRACT_ROLES,
  AMOUNTS,
  TEST_ADDRESSES,
  ERROR_MESSAGES,
} from "../helpers/constants";
import {
  expectSpecificRevert,
  testRoleBasedFunction,
} from "../helpers/utils";

describe("HyperlaneModule - Comprehensive Bridge Operations and Security", function () {
  let fixture: Awaited<ReturnType<typeof deployBridgeFixture>>;
  let hyperlaneModule: HyperlaneModule;
  let lookCoin: LookCoin;
  let mockHyperlane: MockHyperlaneMailbox;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    fixture = await loadFixture(deployBridgeFixture);
    hyperlaneModule = fixture.hyperlaneModule;
    lookCoin = fixture.lookCoin;
    mockHyperlane = fixture.mockHyperlane;
    admin = fixture.admin;
    user1 = fixture.user1;
    user2 = fixture.user2;

    // Mint tokens for testing
    await lookCoin.connect(fixture.minter).mint(user1.address, AMOUNTS.THOUSAND_TOKENS);
  });

  describe("Contract Deployment and Initialization", function () {
    it("should deploy with correct initial parameters", async function () {
      expect(await hyperlaneModule.lookCoin()).to.equal(await lookCoin.getAddress());
      expect(await hyperlaneModule.mailbox()).to.equal(await mockHyperlane.getAddress());
      expect(await hyperlaneModule.paused()).to.be.false;
      
      // Check admin role assignment
      expect(await hyperlaneModule.hasRole(CONTRACT_ROLES.HyperlaneModule.DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("should prevent re-initialization", async function () {
      await expectSpecificRevert(
        async () => hyperlaneModule.initialize(
          await lookCoin.getAddress(),
          await mockHyperlane.getAddress(),
          await mockHyperlane.getAddress(),
          admin.address
        ),
        hyperlaneModule,
        "InvalidInitialization"
      );
    });

    it("should reject zero addresses in constructor", async function () {
      const HyperlaneModule = await ethers.getContractFactory("HyperlaneModule");
      
      await expect(
        upgrades.deployProxy(HyperlaneModule, [
          ethers.ZeroAddress,
          await mockHyperlane.getAddress(),
          await mockHyperlane.getAddress(),
          admin.address
        ])
      ).to.be.reverted;
    });
  });

  describe("Configuration Management", function () {
    describe("Domain Mapping Configuration", function () {
      it("should set domain mapping with admin role", async function () {
        const domain = 1; // Ethereum domain
        const chainId = 1; // Ethereum chain ID
        
        const tx = await hyperlaneModule.connect(admin).setDomainMapping(domain, chainId);
        
        expect(await hyperlaneModule.domainToChainId(domain)).to.equal(chainId);
        expect(await hyperlaneModule.chainIdToDomain(chainId)).to.equal(domain);
        await expect(tx).to.emit(hyperlaneModule, "DomainMappingUpdated").withArgs(domain, chainId);
      });

      it("should enforce admin role for domain mapping", async function () {
        await testRoleBasedFunction(
          hyperlaneModule as any,
          "setDomainMapping",
          [1, 1],
          "ADMIN_ROLE",
          admin,
          user1
        );
      });
    });

    describe("Trusted Sender Configuration", function () {
      it("should set trusted sender with admin role", async function () {
        const domain = 1; // Ethereum
        const trustedSender = ethers.encodeBytes32String(TEST_ADDRESSES.REMOTE_ADDRESS);
        
        const tx = await hyperlaneModule.connect(admin).setTrustedSender(domain, trustedSender);
        
        expect(await hyperlaneModule.trustedSenders(domain)).to.equal(trustedSender);
        await expect(tx).to.emit(hyperlaneModule, "TrustedSenderUpdated").withArgs(domain, trustedSender);
      });

      it("should enforce admin role for trusted sender setting", async function () {
        const trustedSender = ethers.encodeBytes32String(TEST_ADDRESSES.REMOTE_ADDRESS);
        
        await testRoleBasedFunction(
          hyperlaneModule as any,
          "setTrustedSender",
          [1, trustedSender],
          "ADMIN_ROLE",
          admin,
          user1
        );
      });
    });

    describe("Gas Configuration", function () {
      it("should set required gas amount with admin role", async function () {
        const domain = 1;
        const gasAmount = 250000;
        
        const tx = await hyperlaneModule.connect(admin).setRequiredGasAmount(domain, gasAmount);
        
        expect(await hyperlaneModule.requiredGasAmounts(domain)).to.equal(gasAmount);
        await expect(tx).to.emit(hyperlaneModule, "RequiredGasAmountUpdated").withArgs(domain, gasAmount);
      });

      it("should enforce admin role for gas setting", async function () {
        await testRoleBasedFunction(
          hyperlaneModule as any,
          "setRequiredGasAmount",
          [1, 250000],
          "ADMIN_ROLE",
          admin,
          user1
        );
      });
    });
  });

  describe("Bridge Operations", function () {
    beforeEach(async function () {
      // Configure destination for testing
      const domain = 2; // Base domain
      const chainId = 8453; // Base chain ID
      await hyperlaneModule.connect(admin).setDomainMapping(domain, chainId);
      await hyperlaneModule.connect(admin).setTrustedSender(domain, ethers.encodeBytes32String(TEST_ADDRESSES.REMOTE_ADDRESS));
      await hyperlaneModule.connect(admin).setRequiredGasAmount(domain, 250000);
    });

    describe("Outbound Transfers", function () {
      it("should bridge tokens to destination chain", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const recipient = user2.address;
        const chainId = 8453; // Base
        
        // Approve module to spend tokens
        await lookCoin.connect(user1).approve(await hyperlaneModule.getAddress(), amount);
        
        const balanceBefore = await lookCoin.balanceOf(user1.address);
        
        const tx = await hyperlaneModule.connect(user1).bridge(chainId, recipient, amount, "0x", {
          value: ethers.parseEther("0.01") // Gas for Hyperlane
        });
        
        // Tokens should be burned from sender
        expect(await lookCoin.balanceOf(user1.address)).to.equal(balanceBefore - amount);
        
        // Should emit bridge event
        await expect(tx).to.emit(hyperlaneModule, "TransferInitiated");
      });

      it("should estimate bridging fees", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = 8453; // Base
        
        const [estimatedFee] = await hyperlaneModule.estimateFee(chainId, amount, "0x");
        
        expect(estimatedFee).to.be.gt(0);
        expect(estimatedFee).to.be.lt(ethers.parseEther("1")); // Should be reasonable
      });

      it("should validate domain configuration", async function () {
        const unconfiguredChain = 999999;
        const amount = AMOUNTS.TEN_TOKENS;
        const recipient = user2.address;
        
        await expectSpecificRevert(
          async () => hyperlaneModule.connect(user1).bridge(unconfiguredChain, recipient, amount, "0x"),
          hyperlaneModule,
          "Hyperlane: domain not configured"
        );
      });
    });

    describe("Fee Estimation", function () {
      it("should provide accurate fee estimates", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = 8453; // Base
        
        const [fee, estimatedTime] = await hyperlaneModule.estimateFee(chainId, amount, "0x");
        
        expect(fee).to.be.gt(0);
        expect(estimatedTime).to.equal(120); // 2 minutes estimated time
      });
    });
  });

  describe("Message Handling", function () {
    beforeEach(async function () {
      // Configure domain
      await hyperlaneModule.connect(admin).setDomainMapping(1, 1); // Ethereum
      await hyperlaneModule.connect(admin).setTrustedSender(1, ethers.encodeBytes32String(TEST_ADDRESSES.REMOTE_ADDRESS));
    });

    describe("Incoming Messages", function () {
      it("should handle incoming Hyperlane messages", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const recipient = user2.address;
        const originDomain = 1;
        const trustedSender = ethers.encodeBytes32String(TEST_ADDRESSES.REMOTE_ADDRESS);
        const message = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [recipient, amount]);
        
        const balanceBefore = await lookCoin.balanceOf(recipient);
        
        // Simulate incoming message
        await hyperlaneModule.handle(originDomain, trustedSender, message);
        
        // Tokens should be minted to recipient
        expect(await lookCoin.balanceOf(recipient)).to.equal(balanceBefore + amount);
      });

      it("should validate sender authorization", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const recipient = user2.address;
        const originDomain = 1;
        const untrustedSender = ethers.encodeBytes32String(user1.address);
        const message = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [recipient, amount]);
        
        await expectSpecificRevert(
          async () => hyperlaneModule.handle(originDomain, untrustedSender, message),
          hyperlaneModule,
          "Hyperlane: untrusted sender"
        );
      });

      it("should validate domain configuration for incoming messages", async function () {
        const unconfiguredDomain = 999;
        const trustedSender = ethers.encodeBytes32String(TEST_ADDRESSES.REMOTE_ADDRESS);
        const message = "0x";
        
        await expectSpecificRevert(
          async () => hyperlaneModule.handle(unconfiguredDomain, trustedSender, message),
          hyperlaneModule,
          "Hyperlane: domain not configured"
        );
      });
    });
  });

  describe("Access Control and Security", function () {
    describe("Role Management", function () {
      it("should grant and revoke admin roles", async function () {
        const adminRole = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
        
        // Initially user1 should not have role
        expect(await hyperlaneModule.hasRole(adminRole, user1.address)).to.be.false;
        
        // Grant role
        await hyperlaneModule.connect(admin).grantRole(adminRole, user1.address);
        expect(await hyperlaneModule.hasRole(adminRole, user1.address)).to.be.true;
        
        // Revoke role
        await hyperlaneModule.connect(admin).revokeRole(adminRole, user1.address);
        expect(await hyperlaneModule.hasRole(adminRole, user1.address)).to.be.false;
      });
    });

    describe("Pause Functionality", function () {
      it("should allow admin to pause and unpause", async function () {
        // Pause
        const pauseTx = await hyperlaneModule.connect(admin).pause();
        expect(await hyperlaneModule.paused()).to.be.true;
        await expect(pauseTx).to.emit(hyperlaneModule, "ProtocolStatusChanged");
        
        // Unpause
        const unpauseTx = await hyperlaneModule.connect(admin).unpause();
        expect(await hyperlaneModule.paused()).to.be.false;
        await expect(unpauseTx).to.emit(hyperlaneModule, "ProtocolStatusChanged");
      });

      it("should enforce admin role for pause operations", async function () {
        await expectSpecificRevert(
          async () => hyperlaneModule.connect(user1).pause(),
          hyperlaneModule,
          ERROR_MESSAGES.UNAUTHORIZED
        );
      });
    });

    describe("Emergency Functions", function () {
      it("should allow emergency withdrawal by admin", async function () {
        const amount = ethers.parseEther("1");
        
        // Send some ETH to the contract first
        await admin.sendTransaction({
          to: await hyperlaneModule.getAddress(),
          value: amount
        });
        
        const balanceBefore = await ethers.provider.getBalance(user2.address);
        
        await hyperlaneModule.connect(admin).emergencyWithdraw(
          ethers.ZeroAddress, // ETH
          user2.address,
          amount
        );
        
        const balanceAfter = await ethers.provider.getBalance(user2.address);
        expect(balanceAfter - balanceBefore).to.equal(amount);
      });

      it("should enforce admin role for emergency withdrawal", async function () {
        await expectSpecificRevert(
          async () => hyperlaneModule.connect(user1).emergencyWithdraw(
            ethers.ZeroAddress,
            user1.address,
            ethers.parseEther("1")
          ),
          hyperlaneModule,
          ERROR_MESSAGES.UNAUTHORIZED
        );
      });
    });
  });

  describe("Configuration Validation", function () {
    it("should validate destination chain is configured", async function () {
      const unconfiguredChain = 999999;
      const amount = AMOUNTS.TEN_TOKENS;
      const recipient = user2.address;
      
      await expectSpecificRevert(
        async () => hyperlaneModule.connect(user1).bridge(unconfiguredChain, recipient, amount, "0x"),
        hyperlaneModule,
        "Hyperlane: domain not configured"
      );
    });

    it("should validate trusted sender exists", async function () {
      const domain = 99;
      const chainId = 99;
      
      // Map domain but don't set trusted sender
      await hyperlaneModule.connect(admin).setDomainMapping(domain, chainId);
      
      const amount = AMOUNTS.TEN_TOKENS;
      const recipient = user2.address;
      
      await expectSpecificRevert(
        async () => hyperlaneModule.connect(user1).bridge(chainId, recipient, amount, "0x"),
        hyperlaneModule,
        "Hyperlane: trusted sender not set"
      );
    });
  });

  describe("Gas Optimization", function () {
    it("should track gas usage for bridge operations", async function () {
      const amount = AMOUNTS.TEN_TOKENS;
      const recipient = user2.address;
      
      // Setup
      const domain = 2;
      const chainId = 8453;
      await hyperlaneModule.connect(admin).setDomainMapping(domain, chainId);
      await hyperlaneModule.connect(admin).setTrustedSender(domain, ethers.encodeBytes32String(TEST_ADDRESSES.REMOTE_ADDRESS));
      await hyperlaneModule.connect(admin).setRequiredGasAmount(domain, 250000);
      await lookCoin.connect(user1).approve(await hyperlaneModule.getAddress(), amount);
      
      // Execute and track gas
      const tx = await hyperlaneModule.connect(user1).bridge(chainId, recipient, amount, "0x", {
        value: ethers.parseEther("0.01")
      });
      
      const receipt = await tx.wait();
      expect(receipt?.gasUsed).to.be.lt(500000); // Should be reasonably efficient
    });
  });
});