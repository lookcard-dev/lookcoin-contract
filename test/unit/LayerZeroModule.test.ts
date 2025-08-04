import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { LayerZeroModule, LookCoin, MockLayerZeroEndpoint } from "../../typechain-types";
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

describe("LayerZeroModule - Comprehensive Bridge Operations and Security", function () {
  let fixture: Awaited<ReturnType<typeof deployBridgeFixture>>;
  let layerZeroModule: LayerZeroModule;
  let lookCoin: LookCoin;
  let mockLayerZero: MockLayerZeroEndpoint;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    fixture = await loadFixture(deployBridgeFixture);
    layerZeroModule = fixture.layerZeroModule;
    lookCoin = fixture.lookCoin;
    mockLayerZero = fixture.mockLayerZero;
    admin = fixture.admin;
    user1 = fixture.user1;
    user2 = fixture.user2;

    // Mint tokens for testing
    await lookCoin.connect(fixture.minter).mint(user1.address, AMOUNTS.THOUSAND_TOKENS);
  });

  describe("Contract Deployment and Initialization", function () {
    it("should deploy with correct initial parameters", async function () {
      expect(await layerZeroModule.lookCoin()).to.equal(await lookCoin.getAddress());
      expect(await layerZeroModule.lzEndpoint()).to.equal(await mockLayerZero.getAddress());
      expect(await layerZeroModule.paused()).to.be.false;
      
      // Check admin role assignment
      expect(await layerZeroModule.hasRole(CONTRACT_ROLES.LayerZeroModule.DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("should prevent re-initialization", async function () {
      await expectSpecificRevert(
        async () => layerZeroModule.initialize(
          await lookCoin.getAddress(),
          await mockLayerZero.getAddress(),
          admin.address
        ),
        layerZeroModule,
        "InvalidInitialization"
      );
    });

    it("should reject zero addresses in constructor", async function () {
      const LayerZeroModule = await ethers.getContractFactory("LayerZeroModule");
      
      await expect(
        upgrades.deployProxy(LayerZeroModule, [
          ethers.ZeroAddress,
          await mockLayerZero.getAddress(),
          admin.address
        ])
      ).to.be.reverted;
    });
  });

  describe("Configuration Management", function () {
    describe("Trusted Remote Configuration", function () {
      it("should set trusted remote with admin role", async function () {
        const eid = 30101; // Ethereum EID
        const remoteAddress = ethers.getAddress(TEST_ADDRESSES.REMOTE_ADDRESS);
        
        const tx = await layerZeroModule.connect(admin).setTrustedRemote(eid, remoteAddress);
        
        expect(await layerZeroModule.trustedRemotes(eid)).to.equal(ethers.zeroPadValue(remoteAddress, 32));
        await expect(tx).to.emit(layerZeroModule, "TrustedRemoteUpdated").withArgs(eid, ethers.zeroPadValue(remoteAddress, 32));
      });

      it("should enforce admin role for trusted remote setting", async function () {
        await testRoleBasedFunction(
          layerZeroModule,
          "setTrustedRemote",
          [30101, TEST_ADDRESSES.REMOTE_ADDRESS],
          "BRIDGE_ADMIN_ROLE",
          admin,
          user1
        );
      });

      it("should handle trusted remote configuration", async function () {
        const eid = 30101;
        const remoteAddress = TEST_ADDRESSES.REMOTE_ADDRESS;
        
        // Set trusted remote
        await layerZeroModule.connect(admin).setTrustedRemote(eid, ethers.getAddress(remoteAddress));
        expect(await layerZeroModule.trustedRemotes(eid)).to.equal(ethers.zeroPadValue(ethers.getAddress(remoteAddress), 32));
        
        // Verify configuration exists
        expect(await layerZeroModule.trustedRemotes(eid)).to.not.equal(ethers.ZeroHash);
      });
    });

    describe("LayerZero Options Configuration", function () {
      it("should set default options with admin role", async function () {
        const eid = 30101; // Ethereum EID
        const options = ethers.solidityPacked(["uint16", "uint256"], [3, 250000]);
        
        const tx = await layerZeroModule.connect(admin).setDefaultOptions(eid, options);
        
        expect(await layerZeroModule.defaultOptions(eid)).to.equal(options);
        await expect(tx).to.emit(layerZeroModule, "DefaultOptionsUpdated").withArgs(eid, options);
      });

      it("should enforce admin role for options setting", async function () {
        await testRoleBasedFunction(
          layerZeroModule,
          "setDefaultOptions",
          [30101, "0x"],
          "BRIDGE_ADMIN_ROLE",
          admin,
          user1
        );
      });

      it("should update config via updateConfig", async function () {
        const gasLimit = 300000;
        const eid = 30101;
        const options = ethers.solidityPacked(["uint16", "uint256"], [3, gasLimit]);
        const config = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint32", "bytes"], [gasLimit, eid, options]);
        
        await layerZeroModule.connect(admin).updateConfig(config);
        expect(await layerZeroModule.defaultGasLimit()).to.equal(gasLimit);
      });
    });

    describe("Chain Mapping Configuration", function () {
      it("should update chain mappings", async function () {
        const eid = 30101;
        const chainId = 1; // Ethereum

        const tx = await layerZeroModule.connect(admin).updateChainMapping(eid, chainId);
        
        expect(await layerZeroModule.eidToChainId(eid)).to.equal(chainId);
        expect(await layerZeroModule.chainIdToEid(chainId)).to.equal(eid);
        await expect(tx).to.emit(layerZeroModule, "ChainMappingUpdated").withArgs(eid, chainId);
      });

      it("should enforce admin role for chain mapping", async function () {
        await testRoleBasedFunction(
          layerZeroModule,
          "updateChainMapping",
          [30101, 1],
          "BRIDGE_ADMIN_ROLE",
          admin,
          user1
        );
      });
    });
  });

  describe("Bridge Operations", function () {
    beforeEach(async function () {
      // Configure destination for testing
      const eid = 30102; // BSC EID
      const chainId = 56; // BSC Chain ID
      await layerZeroModule.connect(admin).updateChainMapping(eid, chainId);
      await layerZeroModule.connect(admin).setTrustedRemote(eid, TEST_ADDRESSES.REMOTE_ADDRESS);
      
      // Mint tokens for testing
      await lookCoin.connect(fixture.minter).mint(user1.address, AMOUNTS.THOUSAND_TOKENS);
    });

    describe("Outbound Transfers", function () {
      it("should bridge tokens to destination chain", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const recipient = user2.address;
        
        // Approve layerZeroModule to spend tokens
        await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), amount);
        
        const balanceBefore = await lookCoin.balanceOf(user1.address);
        
        const tx = await layerZeroModule.connect(user1).bridge(56, recipient, amount, "0x", {
          value: ethers.parseEther("0.01") // Fee for LayerZero
        });
        
        // Tokens should be burned from sender
        expect(await lookCoin.balanceOf(user1.address)).to.equal(balanceBefore - amount);
        
        // Should emit bridge event
        await expect(tx).to.emit(layerZeroModule, "TransferInitiated");
      });

      it("should estimate bridging fees", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = 56;
        
        const [estimatedFee] = await layerZeroModule.estimateFee(chainId, amount, "0x");
        
        expect(estimatedFee).to.be.gt(0);
        expect(estimatedFee).to.be.lt(ethers.parseEther("1")); // Should be reasonable
      });

      it("should validate bridge configuration", async function () {
        const unconfiguredChain = 999999;
        const amount = AMOUNTS.TEN_TOKENS;
        const recipient = user2.address;
        
        await expectSpecificRevert(
          async () => layerZeroModule.connect(user1).bridge(unconfiguredChain, recipient, amount, "0x"),
          layerZeroModule,
          "LayerZero: unsupported chain"
        );
      });
    });

    describe("Fee Estimation", function () {
      it("should provide accurate fee estimates", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = 56;
        
        const [fee, estimatedTime] = await layerZeroModule.estimateFee(chainId, amount, "0x");
        
        expect(fee).to.be.gt(0);
        expect(estimatedTime).to.equal(180); // 3 minutes
      });
    });
  });

  describe("Access Control and Security", function () {
    describe("Role Management", function () {
      it("should grant and revoke bridge admin roles", async function () {
        const bridgeAdminRole = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ADMIN_ROLE"));
        
        // Initially user1 should not have role
        expect(await layerZeroModule.hasRole(bridgeAdminRole, user1.address)).to.be.false;
        
        // Grant role
        await layerZeroModule.connect(admin).grantRole(bridgeAdminRole, user1.address);
        expect(await layerZeroModule.hasRole(bridgeAdminRole, user1.address)).to.be.true;
        
        // Revoke role
        await layerZeroModule.connect(admin).revokeRole(bridgeAdminRole, user1.address);
        expect(await layerZeroModule.hasRole(bridgeAdminRole, user1.address)).to.be.false;
      });
    });

    describe("Pause Functionality", function () {
      it("should allow admin to pause and unpause", async function () {
        // Pause
        const pauseTx = await layerZeroModule.connect(admin).pause();
        expect(await layerZeroModule.paused()).to.be.true;
        await expect(pauseTx).to.emit(layerZeroModule, "ProtocolStatusChanged");
        
        // Unpause
        const unpauseTx = await layerZeroModule.connect(admin).unpause();
        expect(await layerZeroModule.paused()).to.be.false;
        await expect(unpauseTx).to.emit(layerZeroModule, "ProtocolStatusChanged");
      });

      it("should enforce admin role for pause operations", async function () {
        await expectSpecificRevert(
          async () => layerZeroModule.connect(user1).pause(),
          layerZeroModule,
          ERROR_MESSAGES.UNAUTHORIZED
        );
      });
    });

    describe("Emergency Functions", function () {
      it("should allow emergency withdrawal by admin", async function () {
        const amount = ethers.parseEther("1");
        
        // Send some ETH to the contract first
        await admin.sendTransaction({
          to: await layerZeroModule.getAddress(),
          value: amount
        });
        
        const balanceBefore = await ethers.provider.getBalance(user2.address);
        
        await layerZeroModule.connect(admin).emergencyWithdraw(
          ethers.ZeroAddress, // ETH
          user2.address,
          amount
        );
        
        const balanceAfter = await ethers.provider.getBalance(user2.address);
        expect(balanceAfter - balanceBefore).to.equal(amount);
      });

      it("should enforce admin role for emergency withdrawal", async function () {
        await expectSpecificRevert(
          async () => layerZeroModule.connect(user1).emergencyWithdraw(
            ethers.ZeroAddress,
            user1.address,
            ethers.parseEther("1")
          ),
          layerZeroModule,
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
        async () => layerZeroModule.connect(user1).bridge(unconfiguredChain, recipient, amount, "0x"),
        layerZeroModule,
        "LayerZero: unsupported chain"
      );
    });

    it("should validate chain mapping exists", async function () {
      const unmappedChain = 99999;
      const amount = AMOUNTS.TEN_TOKENS;
      const recipient = user2.address;
      
      await expectSpecificRevert(
        async () => layerZeroModule.connect(user1).bridge(unmappedChain, recipient, amount, "0x"),
        layerZeroModule,
        "LayerZero: unsupported chain"
      );
    });
  });

  describe("Gas Optimization", function () {
    it("should track gas usage for bridge operations", async function () {
      const amount = AMOUNTS.TEN_TOKENS;
      const recipient = user2.address;
      
      // Setup
      const eid = 30102;
      const chainId = 56;
      await layerZeroModule.connect(admin).updateChainMapping(eid, chainId);
      await layerZeroModule.connect(admin).setTrustedRemote(eid, TEST_ADDRESSES.REMOTE_ADDRESS);
      await lookCoin.connect(user1).approve(await layerZeroModule.getAddress(), amount);
      
      // Execute and track gas
      const tx = await layerZeroModule.connect(user1).bridge(chainId, recipient, amount, "0x", {
        value: ethers.parseEther("0.01")
      });
      
      const receipt = await tx.wait();
      expect(receipt?.gasUsed).to.be.lt(500000); // Should be reasonably efficient
    });
  });
});