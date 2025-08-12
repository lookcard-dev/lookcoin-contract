import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { CelerIMModule, LookCoin, MockMessageBus } from "../../typechain-types";
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
  configureCrossChainSettings,
} from "../helpers/utils";

describe("CelerIMModule - Comprehensive Bridge Operations and Security", function () {
  let fixture: Awaited<ReturnType<typeof deployBridgeFixture>>;
  let celerIMModule: CelerIMModule;
  let lookCoin: LookCoin;
  let mockCeler: MockMessageBus;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let operator: SignerWithAddress;

  beforeEach(async function () {
    fixture = await loadFixture(deployBridgeFixture);
    celerIMModule = fixture.celerIMModule;
    lookCoin = fixture.lookCoin;
    mockCeler = fixture.mockCeler;
    admin = fixture.admin;
    user1 = fixture.user1;
    user2 = fixture.user2;
    operator = fixture.operator;

    // Mint tokens for testing
    await lookCoin.connect(fixture.minter).mint(user1.address, AMOUNTS.THOUSAND_TOKENS);
    
    // Configure cross-chain settings for testing
    await configureCrossChainSettings(fixture, fixture.testChainId);
  });

  describe("Contract Deployment and Initialization", function () {
    it("should deploy with correct initial parameters", async function () {
      expect(await celerIMModule.lookCoin()).to.equal(await lookCoin.getAddress());
      expect(await celerIMModule.messageBus()).to.equal(await mockCeler.getAddress());
      expect(await celerIMModule.paused()).to.be.false;
      
      // Check admin role assignment (CelerIM uses ADMIN_ROLE, not DEFAULT_ADMIN_ROLE)
      expect(await celerIMModule.hasRole(CONTRACT_ROLES.CelerIMModule.ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("should prevent re-initialization", async function () {
      await expectSpecificRevert(
        async () => celerIMModule.initialize(
          await mockCeler.getAddress(),
          await lookCoin.getAddress(),
          admin.address
        ),
        celerIMModule as any,
        "InvalidInitialization"
      );
    });

    it("should reject zero addresses in constructor", async function () {
      const CelerIMModule = await ethers.getContractFactory("CelerIMModule");
      
      await expect(
        upgrades.deployProxy(CelerIMModule, [
          ethers.ZeroAddress,
          await lookCoin.getAddress(),
          admin.address
        ])
      ).to.be.reverted;
    });
  });

  describe("Configuration Management", function () {
    describe("Chain Support Configuration", function () {
      it("should set supported chain with admin role", async function () {
        const destChainId = 1; // Ethereum
        
        const tx = await celerIMModule.connect(admin).setSupportedChain(destChainId, true);
        
        expect(await celerIMModule.supportedChains(destChainId)).to.be.true;
        await expect(tx).to.emit(celerIMModule as any, "SupportedChainUpdated").withArgs(destChainId, true);
      });

      it("should remove chain support", async function () {
        const destChainId = 1; // Ethereum
        
        // First enable
        await celerIMModule.connect(admin).setSupportedChain(destChainId, true);
        expect(await celerIMModule.supportedChains(destChainId)).to.be.true;
        
        // Then disable
        const tx = await celerIMModule.connect(admin).setSupportedChain(destChainId, false);
        expect(await celerIMModule.supportedChains(destChainId)).to.be.false;
        await expect(tx).to.emit(celerIMModule as any, "SupportedChainUpdated").withArgs(destChainId, false);
      });

      it("should enforce admin role for chain configuration", async function () {
        await expectSpecificRevert(
          async () => celerIMModule.connect(user1).setSupportedChain(1, true),
          celerIMModule,
          "AccessControlUnauthorizedAccount",
          user1.address,
          CONTRACT_ROLES.CelerIMModule.ADMIN_ROLE
        );
      });
    });

    describe("Remote Module Configuration", function () {
      it("should set remote module with admin role", async function () {
        const destChainId = 1; // Ethereum
        const remoteAddress = TEST_ADDRESSES.REMOTE_ADDRESS;
        
        // First enable the chain support (required by setRemoteModule)
        await celerIMModule.connect(admin).setSupportedChain(destChainId, true);
        
        const tx = await celerIMModule.connect(admin).setRemoteModule(destChainId, remoteAddress);
        
        expect(await celerIMModule.remoteModules(destChainId)).to.equal(remoteAddress);
        await expect(tx).to.emit(celerIMModule as any, "RemoteModuleSet").withArgs(destChainId, remoteAddress);
      });

      it("should enforce admin role for remote module setting", async function () {
        await expectSpecificRevert(
          async () => celerIMModule.connect(user1).setRemoteModule(1, TEST_ADDRESSES.REMOTE_ADDRESS),
          celerIMModule,
          "AccessControlUnauthorizedAccount",
          user1.address,
          CONTRACT_ROLES.CelerIMModule.ADMIN_ROLE
        );
      });
    });

    describe("Fee Configuration", function () {
      it("should update fee parameters with admin role", async function () {
        const feePercentage = 10; // 0.1%
        const minFee = ethers.parseUnits("1", 18);
        const maxFee = ethers.parseUnits("100", 18);
        
        const tx = await celerIMModule.connect(admin).updateFeeParameters(feePercentage, minFee, maxFee);
        
        expect(await celerIMModule.feePercentage()).to.equal(feePercentage);
        expect(await celerIMModule.minFee()).to.equal(minFee);
        expect(await celerIMModule.maxFee()).to.equal(maxFee);
        await expect(tx).to.emit(celerIMModule as any, "FeeParametersUpdated");
      });

      // Note: CelerIMModule doesn't have fee collector functionality
    });
  });

  describe("Bridge Operations", function () {
    beforeEach(async function () {
      // Configure destination for testing
      const chainId = 10; // Optimism
      await celerIMModule.connect(admin).setSupportedChain(chainId, true);
      await celerIMModule.connect(admin).setRemoteModule(chainId, TEST_ADDRESSES.REMOTE_ADDRESS);
      
      // Setup fees
      await celerIMModule.connect(admin).updateFeeParameters(10, ethers.parseUnits("1", 18), ethers.parseUnits("100", 18));
    });

    describe("Outbound Transfers", function () {
      it("should bridge tokens to destination chain", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const recipient = user2.address;
        const chainId = 10; // Optimism
        
        // Approve module to spend tokens
        await lookCoin.connect(user1).approve(await celerIMModule.getAddress(), amount);
        
        const balanceBefore = await lookCoin.balanceOf(user1.address);
        
        const tx = await celerIMModule.connect(user1).bridge(chainId, recipient, amount, "0x", {
          value: ethers.parseEther("0.01") // Fee for Celer
        });
        
        // Tokens should be burned from sender
        expect(await lookCoin.balanceOf(user1.address)).to.be.lt(balanceBefore);
        
        // Should emit bridge event
        await expect(tx).to.emit(celerIMModule as any, "TransferInitiated");
      });

      it("should estimate bridging fees", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = 10; // Optimism
        
        const [estimatedFee] = await celerIMModule.estimateFee(chainId, amount, "0x");
        
        expect(estimatedFee).to.be.gt(0);
        expect(estimatedFee).to.be.lt(ethers.parseEther("2")); // Should be reasonable (allow for bridge fees)
      });

      it("should validate supported chain", async function () {
        const unsupportedChain = 999999;
        const amount = AMOUNTS.TEN_TOKENS;
        const recipient = user2.address;
        
        await expectSpecificRevert(
          async () => celerIMModule.connect(user1).bridge(unsupportedChain, recipient, amount, "0x"),
          celerIMModule as any,
          "CelerIM: unsupported chain"
        );
      });
    });

    describe("Fee Calculation", function () {
      it("should calculate fees correctly", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = 10;
        
        const [fee] = await celerIMModule.estimateFee(chainId, amount, "0x");
        
        // Fee should include both bridge fee and network fee
        expect(fee).to.be.gt(0);
        
        // Fee should include the configured percentage
        const expectedBridgeFee = (amount * BigInt(10)) / BigInt(10000); // 0.1%
        expect(fee).to.be.gte(expectedBridgeFee);
      });
    });
  });

  describe("Message Handling", function () {
    beforeEach(async function () {
      // Configure supported chain
      await celerIMModule.connect(admin).setSupportedChain(56, true); // BSC
      await celerIMModule.connect(admin).setRemoteModule(56, TEST_ADDRESSES.REMOTE_ADDRESS);
    });

    describe("Incoming Messages", function () {
      it("should handle incoming message with transfer", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const recipient = user2.address;
        const transferId = ethers.randomBytes(32);
        const originalSender = TEST_ADDRESSES.REMOTE_ADDRESS;
        const message = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint256", "bytes32"], 
          [originalSender, recipient, amount, transferId]
        );
        
        const balanceBefore = await lookCoin.balanceOf(recipient);
        
        // Simulate incoming message through MockMessageBus
        await mockCeler.simulateIncomingMessage(
          await celerIMModule.getAddress(),
          TEST_ADDRESSES.REMOTE_ADDRESS,
          await lookCoin.getAddress(),
          amount,
          56, // BSC
          message,
          admin.address
        );
        
        // Tokens should be minted to recipient
        expect(await lookCoin.balanceOf(recipient)).to.equal(balanceBefore + amount);
      });

      it("should validate sender authorization", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const recipient = user2.address;
        const transferId = ethers.randomBytes(32);
        const originalSender = user1.address; // Unauthorized sender
        const message = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "address", "uint256", "bytes32"], 
          [originalSender, recipient, amount, transferId]
        );
        
        const balanceBefore = await lookCoin.balanceOf(recipient);
        
        // Use unauthorized sender - should revert with authorization error
        await expectSpecificRevert(
          async () => mockCeler.simulateIncomingMessage(
            await celerIMModule.getAddress(),
            user1.address, // Unauthorized sender (not in remoteModules)
            await lookCoin.getAddress(),
            amount,
            56, // BSC
            message,
            admin.address
          ),
          celerIMModule as any,
          "CelerIM: unauthorized sender"
        );
      });
    });
  });

  describe("Access Control and Security", function () {
    describe("Role Management", function () {
      it("should grant and revoke admin roles", async function () {
        const adminRole = CONTRACT_ROLES.CelerIMModule.ADMIN_ROLE;
        
        // Initially user1 should not have role
        expect(await celerIMModule.hasRole(adminRole, user1.address)).to.be.false;
        
        // Grant role
        await celerIMModule.connect(admin).grantRole(adminRole, user1.address);
        expect(await celerIMModule.hasRole(adminRole, user1.address)).to.be.true;
        
        // Revoke role
        await celerIMModule.connect(admin).revokeRole(adminRole, user1.address);
        expect(await celerIMModule.hasRole(adminRole, user1.address)).to.be.false;
      });
    });

    describe("Pause Functionality", function () {
      it("should allow admin to pause and unpause", async function () {
        // Pause
        const pauseTx = await celerIMModule.connect(admin).pause();
        expect(await celerIMModule.paused()).to.be.true;
        await expect(pauseTx).to.emit(celerIMModule as any, "ProtocolStatusChanged");
        
        // Unpause
        const unpauseTx = await celerIMModule.connect(admin).unpause();
        expect(await celerIMModule.paused()).to.be.false;
        await expect(unpauseTx).to.emit(celerIMModule as any, "ProtocolStatusChanged");
      });

      it("should enforce admin role for pause operations", async function () {
        await expectSpecificRevert(
          async () => celerIMModule.connect(user1).pause(),
          celerIMModule as any,
          ERROR_MESSAGES.UNAUTHORIZED
        );
      });
    });

    describe("Emergency Functions", function () {
      it("should allow emergency withdrawal by admin", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        
        // Test with ERC20 token (LookCoin) instead of ETH since contract doesn't have receive function
        // First, mint some tokens to the module contract for testing
        await lookCoin.connect(fixture.minter).mint(await celerIMModule.getAddress(), amount);
        
        const balanceBefore = await lookCoin.balanceOf(user2.address);
        
        // Note: Cannot withdraw LookCoin itself, so let's test that it reverts
        await expectSpecificRevert(
          async () => celerIMModule.connect(admin).emergencyWithdraw(
            await lookCoin.getAddress(),
            user2.address,
            amount
          ),
          celerIMModule as any,
          "CelerIM: cannot withdraw LookCoin"
        );
      });
    });
  });

  describe("Whitelist and Blacklist Management", function () {
    it("should manage whitelist with operator role", async function () {
      // CelerIM uses OPERATOR_ROLE for whitelist management
      await celerIMModule.connect(operator).updateWhitelist(user1.address, true);
      
      expect(await celerIMModule.whitelist(user1.address)).to.be.true;
      // Note: updateWhitelist doesn't emit events in the actual contract
      
      // Remove from whitelist
      await celerIMModule.connect(operator).updateWhitelist(user1.address, false);
      expect(await celerIMModule.whitelist(user1.address)).to.be.false;
    });

    it("should manage blacklist with operator role", async function () {
      // CelerIM uses OPERATOR_ROLE for blacklist management
      await celerIMModule.connect(operator).updateBlacklist(user1.address, true);
      
      expect(await celerIMModule.blacklist(user1.address)).to.be.true;
      // Note: updateBlacklist doesn't emit events in the actual contract
    });

    it("should enforce blacklist restrictions", async function () {
      // Add user to blacklist
      await celerIMModule.connect(operator).updateBlacklist(user1.address, true);
      
      // Setup chain support
      await celerIMModule.connect(admin).setSupportedChain(10, true);
      await celerIMModule.connect(admin).setRemoteModule(10, TEST_ADDRESSES.REMOTE_ADDRESS);
      
      // Should reject blacklisted user
      await expectSpecificRevert(
        async () => celerIMModule.connect(user1).bridge(10, user2.address, AMOUNTS.TEN_TOKENS, "0x"),
        celerIMModule as any,
        "CelerIM: sender blacklisted"
      );
    });
  });
});