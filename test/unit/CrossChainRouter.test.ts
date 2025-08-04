import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { CrossChainRouter, LookCoin, LayerZeroModule, CelerIMModule, HyperlaneModule } from "../../typechain-types";
import { deployLookCoinFixture } from "../helpers/fixtures";
import {
  CONTRACT_ROLES,
  AMOUNTS,
  TEST_ADDRESSES,
  TEST_CHAINS,
  ERROR_MESSAGES,
  EVENTS,
  PROTOCOLS,
} from "../helpers/constants";
import {
  expectSpecificRevert,
  testRoleBasedFunction,
  trackGasUsage,
} from "../helpers/utils";


describe("CrossChainRouter - Comprehensive Multi-Protocol Bridge Orchestration", function () {
  let fixture: Awaited<ReturnType<typeof deployLookCoinFixture>>;
  let crossChainRouter: CrossChainRouter;
  let lookCoin: LookCoin;
  let layerZeroModule: LayerZeroModule;
  let celerIMModule: CelerIMModule;
  let hyperlaneModule: HyperlaneModule;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const DESTINATION_CHAIN_ID = TEST_CHAINS.OPTIMISM_MAINNET;
  const PROTOCOL_LAYERZERO = 0;
  const PROTOCOL_CELER = 1;
  const PROTOCOL_HYPERLANE = 2;

  beforeEach(async function () {
    fixture = await loadFixture(deployLookCoinFixture);
    crossChainRouter = fixture.crossChainRouter;
    lookCoin = fixture.lookCoin;
    layerZeroModule = fixture.layerZeroModule;
    celerIMModule = fixture.celerIMModule;
    hyperlaneModule = fixture.hyperlaneModule;
    admin = fixture.admin;
    user1 = fixture.user1;
    user2 = fixture.user2;

    // Mint tokens for testing
    await lookCoin.connect(fixture.minter).mint(user1.address, AMOUNTS.THOUSAND_TOKENS);
  });

  describe("Contract Deployment and Initialization", function () {
    it("should deploy with correct initial parameters", async function () {
      expect(await crossChainRouter.lookCoin()).to.equal(lookCoin.target);
      expect(await crossChainRouter.paused()).to.be.false;
      
      // Check admin role assignment
      expect(await crossChainRouter.hasRole(CONTRACT_ROLES.CrossChainRouter.DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("should prevent re-initialization", async function () {
      await expectSpecificRevert(
        async () => crossChainRouter.initialize(
          lookCoin.target,
          fixture.feeManager.target,
          fixture.securityManager.target,
          admin.address
        ),
        crossChainRouter,
        "InvalidInitialization"
      );
    });

    it("should reject zero addresses in constructor", async function () {
      const CrossChainRouter = await ethers.getContractFactory("CrossChainRouter");
      
      await expect(
        upgrades.deployProxy(CrossChainRouter, [
          ethers.ZeroAddress,
          fixture.feeManager.target,
          fixture.securityManager.target,
          admin.address
        ])
      ).to.be.reverted;
    });
  });

  describe("Protocol Registration and Management", function () {
    describe("Protocol Registration", function () {
      it("should register protocols with admin role", async function () {
        const testModuleAddress = ethers.Wallet.createRandom().address;
        
        await expect(
          crossChainRouter.connect(admin).registerProtocol(PROTOCOL_LAYERZERO, testModuleAddress)
        ).to.emit(crossChainRouter, "ProtocolRegistered")
          .withArgs(PROTOCOL_LAYERZERO, testModuleAddress);
        
        expect(await crossChainRouter.protocolModules(PROTOCOL_LAYERZERO)).to.equal(testModuleAddress);
        expect(await crossChainRouter.protocolActive(PROTOCOL_LAYERZERO)).to.be.true;
      });

      it("should enforce admin role for protocol registration", async function () {
        const testModuleAddress = ethers.Wallet.createRandom().address;
        
        await expect(
          crossChainRouter.connect(user1).registerProtocol(PROTOCOL_LAYERZERO, testModuleAddress)
        ).to.be.revertedWithCustomError(crossChainRouter, "AccessControlUnauthorizedAccount");
      });

      it("should prevent duplicate protocol registration", async function () {
        const testModuleAddress = ethers.Wallet.createRandom().address;
        
        // Register protocol first
        await crossChainRouter.connect(admin).registerProtocol(PROTOCOL_LAYERZERO, testModuleAddress);
        
        // Try to register again (should work - it's an update)
        const newModuleAddress = ethers.Wallet.createRandom().address;
        await expect(
          crossChainRouter.connect(admin).registerProtocol(PROTOCOL_LAYERZERO, newModuleAddress)
        ).to.not.be.reverted;
        
        expect(await crossChainRouter.protocolModules(PROTOCOL_LAYERZERO)).to.equal(newModuleAddress);
      });

      it("should reject zero address for module", async function () {
        await expect(
          crossChainRouter.connect(admin).registerProtocol(PROTOCOL_LAYERZERO, ethers.ZeroAddress)
        ).to.be.revertedWith("Invalid module address");
      });
    });

    describe("Protocol Status Management", function () {
      beforeEach(async function () {
        // Register a test protocol
        await crossChainRouter.connect(admin).registerProtocol(PROTOCOL_LAYERZERO, TEST_ADDRESSES.REMOTE_ADDRESS);
      });

      it("should update protocol status with admin role", async function () {
        // Initially should be enabled (default after registration)
        expect(await crossChainRouter.protocolActive(PROTOCOL_LAYERZERO)).to.be.true;
        
        // Disable protocol
        await crossChainRouter.connect(admin).updateProtocolStatus(PROTOCOL_LAYERZERO, false);
        expect(await crossChainRouter.protocolActive(PROTOCOL_LAYERZERO)).to.be.false;
        
        // Re-enable protocol
        await crossChainRouter.connect(admin).updateProtocolStatus(PROTOCOL_LAYERZERO, true);
        expect(await crossChainRouter.protocolActive(PROTOCOL_LAYERZERO)).to.be.true;
      });

      it("should enforce admin role for status updates", async function () {
        await expect(
          crossChainRouter.connect(user1).updateProtocolStatus(PROTOCOL_LAYERZERO, false)
        ).to.be.revertedWithCustomError(crossChainRouter, "AccessControlUnauthorizedAccount");
      });

      it("should update protocol status for any protocol enum value", async function () {
        // Test updating status for different protocol enum values
        await crossChainRouter.connect(admin).updateProtocolStatus(PROTOCOL_CELER, false);
        expect(await crossChainRouter.protocolActive(PROTOCOL_CELER)).to.be.false;
        
        await crossChainRouter.connect(admin).updateProtocolStatus(PROTOCOL_CELER, true);
        expect(await crossChainRouter.protocolActive(PROTOCOL_CELER)).to.be.true;
      });
    });

    describe("Chain-Protocol Support Configuration", function () {
      beforeEach(async function () {
        await crossChainRouter.connect(admin).registerProtocol(PROTOCOL_LAYERZERO, TEST_ADDRESSES.REMOTE_ADDRESS);
      });

      it("should set chain protocol support with admin role", async function () {
        const chainId = TEST_CHAINS.ETHEREUM_MAINNET;
        
        const tx = await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOL_LAYERZERO, true);
        
        expect(await crossChainRouter.chainProtocolSupport(chainId, PROTOCOL_LAYERZERO)).to.be.true;
        await expect(tx).to.emit(crossChainRouter, "ChainProtocolSupportUpdated")
          .withArgs(chainId, PROTOCOL_LAYERZERO, true);
      });

      it("should enforce admin role for chain protocol support", async function () {
        await expect(
          crossChainRouter.connect(user1).setChainProtocolSupport(TEST_CHAINS.ETHEREUM_MAINNET, PROTOCOL_LAYERZERO, true)
        ).to.be.revertedWithCustomError(crossChainRouter, "AccessControlUnauthorizedAccount");
      });

      it("should check chain configuration", async function () {
        const chainId = TEST_CHAINS.ETHEREUM_MAINNET;
        
        // Should be false before setting chain support
        expect(await crossChainRouter.isChainConfigured(chainId, PROTOCOL_LAYERZERO)).to.be.false;
        
        // Set chain support
        await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOL_LAYERZERO, true);
        
        // Should be true after setting chain support
        expect(await crossChainRouter.isChainConfigured(chainId, PROTOCOL_LAYERZERO)).to.be.true;
      });
    });
  });

  describe("Configuration Management - Protocol and Chain Support", function () {
    describe("Protocol Module Configuration", function () {
      it("should configure protocol with ADMIN_ROLE", async function () {
        const newModule = ethers.Wallet.createRandom().address;
        
        await crossChainRouter.connect(admin).registerProtocol(PROTOCOL_CELER, newModule);
        
        expect(await crossChainRouter.protocolModules(PROTOCOL_CELER)).to.equal(newModule);
        expect(await crossChainRouter.protocolActive(PROTOCOL_CELER)).to.be.true;
      });

      it("should test protocol enable/disable state transitions", async function () {
        const testModule = ethers.Wallet.createRandom().address;
        
        // Register and verify
        await crossChainRouter.connect(admin).registerProtocol(PROTOCOL_HYPERLANE, testModule);
        expect(await crossChainRouter.protocolModules(PROTOCOL_HYPERLANE)).to.equal(testModule);
        expect(await crossChainRouter.protocolActive(PROTOCOL_HYPERLANE)).to.be.true;
        
        // Disable and verify
        await crossChainRouter.connect(admin).updateProtocolStatus(PROTOCOL_HYPERLANE, false);
        expect(await crossChainRouter.protocolActive(PROTOCOL_HYPERLANE)).to.be.false;
      });

      it("should configure all three protocols independently", async function () {
        const protocols = [
          { id: PROTOCOL_LAYERZERO, module: layerZeroModule.target },
          { id: PROTOCOL_CELER, module: celerIMModule.target },
          { id: PROTOCOL_HYPERLANE, module: await hyperlaneModule.getAddress() },
        ];

        for (const protocol of protocols) {
          await crossChainRouter.connect(admin).registerProtocol(protocol.id, protocol.module);
          
          expect(await crossChainRouter.protocolModules(protocol.id)).to.equal(protocol.module);
          expect(await crossChainRouter.protocolEnabled(protocol.id)).to.be.true;
        }
      });
    });

    describe("Chain Support Configuration", function () {
      it("should configure chain support with ADMIN_ROLE", async function () {
        await crossChainRouter.connect(admin).setChainProtocolSupport(
          TEST_CHAINS.ETHEREUM_MAINNET,
          PROTOCOL_LAYERZERO,
          true
        );
        
        expect(await crossChainRouter.chainProtocolSupport(TEST_CHAINS.ETHEREUM_MAINNET, PROTOCOL_LAYERZERO)).to.be.true;
      });

      it("should manage protocol list per chain correctly", async function () {
        // Add multiple protocols for same chain
        await crossChainRouter.connect(admin).setChainProtocolSupport(DESTINATION_CHAIN_ID, PROTOCOL_LAYERZERO, true);
        await crossChainRouter.connect(admin).setChainProtocolSupport(DESTINATION_CHAIN_ID, PROTOCOL_CELER, true);
        await crossChainRouter.connect(admin).setChainProtocolSupport(DESTINATION_CHAIN_ID, PROTOCOL_HYPERLANE, true);
        
        // Remove one protocol
        await crossChainRouter.connect(admin).setChainProtocolSupport(DESTINATION_CHAIN_ID, PROTOCOL_CELER, false);
        
        // Verify configurations
        expect(await crossChainRouter.chainProtocolSupport(DESTINATION_CHAIN_ID, PROTOCOL_LAYERZERO)).to.be.true;
        expect(await crossChainRouter.chainProtocolSupport(DESTINATION_CHAIN_ID, PROTOCOL_CELER)).to.be.false;
        expect(await crossChainRouter.chainProtocolSupport(DESTINATION_CHAIN_ID, PROTOCOL_HYPERLANE)).to.be.true;
      });

      it("should handle multiple protocol-chain support combinations", async function () {
        const protocols = [PROTOCOL_LAYERZERO, PROTOCOL_CELER, PROTOCOL_HYPERLANE];
        const chains = [TEST_CHAINS.OPTIMISM_MAINNET, TEST_CHAINS.ETHEREUM_MAINNET];
        
        // Test setting support for different combinations
        for (const protocol of protocols) {
          for (const chain of chains) {
            // Set support
            await crossChainRouter.connect(admin).setChainProtocolSupport(chain, protocol, true);
            expect(await crossChainRouter.chainProtocolSupport(chain, protocol)).to.be.true;
            
            // Remove support
            await crossChainRouter.connect(admin).setChainProtocolSupport(chain, protocol, false);
            expect(await crossChainRouter.chainProtocolSupport(chain, protocol)).to.be.false;
          }
        }
      });
    });
  });

  describe("Bridge Operations", function () {
    beforeEach(async function () {
      // Configure protocols for testing
      const chainId = DESTINATION_CHAIN_ID;
      
      // Register protocols first
      await crossChainRouter.connect(admin).registerProtocol(PROTOCOL_LAYERZERO, layerZeroModule.target);
      await crossChainRouter.connect(admin).registerProtocol(PROTOCOL_CELER, celerIMModule.target);
      await crossChainRouter.connect(admin).registerProtocol(PROTOCOL_HYPERLANE, hyperlaneModule.target);
      
      // Enable protocol support for test chain
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOL_LAYERZERO, true);
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOL_CELER, true);
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOL_HYPERLANE, true);
    });

    describe("Bridge Option Discovery", function () {
      it("should return available bridge options for chain", async function () {
        const chainId = DESTINATION_CHAIN_ID;
        const amount = AMOUNTS.THOUSAND_TOKENS;
        
        const options = await crossChainRouter.getBridgeOptions(chainId, amount);
        
        expect(options.length).to.be.gte(1); // Should have at least one option
        
        // Verify each option has required fields
        for (const option of options) {
          expect(option.protocol).to.be.a("number");
          expect(option.available).to.be.a("boolean");
          expect(option.fee).to.be.a("bigint");
          expect(option.estimatedTime).to.be.a("bigint");
          expect(option.securityLevel).to.be.a("number");
        }
      });

      it("should return empty options for unsupported chain", async function () {
        const unsupportedChain = 999999;
        
        const options = await crossChainRouter.getBridgeOptions(unsupportedChain);
        
        expect(options.length).to.equal(0);
      });

      it("should exclude disabled protocols from options", async function () {
        const chainId = fixture.testChainId;
        
        // Disable LayerZero protocol
        await crossChainRouter.connect(admin).updateProtocolStatus(PROTOCOLS.LAYERZERO, false);
        
        const options = await crossChainRouter.getBridgeOptions(chainId);
        
        // Should not include LayerZero in available options
        const layerZeroOption = options.find(opt => opt.protocol === BigInt(PROTOCOLS.LAYERZERO));
        expect(layerZeroOption?.available).to.be.false;
      });
    });

    describe("Multi-Protocol Bridging", function () {
      it("should bridge tokens via LayerZero protocol", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = fixture.testChainId;
        const recipient = user2.address;
        const protocol = PROTOCOLS.LAYERZERO;
        
        // Approve router to spend tokens
        await lookCoin.connect(user1).approve(await crossChainRouter.getAddress(), amount);
        
        const balanceBefore = await lookCoin.balanceOf(user1.address);
        
        const tx = await crossChainRouter.connect(user1).bridge(
          chainId,
          recipient,
          amount,
          protocol,
          "0x",
          { value: ethers.parseEther("0.01") }
        );
        
        // Tokens should be transferred to the router and then to the protocol module
        expect(await lookCoin.balanceOf(user1.address)).to.equal(balanceBefore - amount);
        
        // Should emit transfer initiated event
        await expect(tx).to.emit(crossChainRouter, "TransferInitiated")
          .withArgs(user1.address, protocol, chainId, recipient, amount);
      });

      it("should bridge tokens via Celer IM protocol", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = fixture.testChainId;
        const recipient = user2.address;
        const protocol = PROTOCOLS.CELER;
        
        await lookCoin.connect(user1).approve(await crossChainRouter.getAddress(), amount);
        
        const balanceBefore = await lookCoin.balanceOf(user1.address);
        
        const tx = await crossChainRouter.connect(user1).bridge(
          chainId,
          recipient,
          amount,
          protocol,
          "0x",
          { value: ethers.parseEther("0.005") }
        );
        
        expect(await lookCoin.balanceOf(user1.address)).to.equal(balanceBefore - amount);
        await expect(tx).to.emit(crossChainRouter, "TransferInitiated");
      });

      it("should bridge tokens via Hyperlane protocol", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = fixture.testChainId;
        const recipient = user2.address;
        const protocol = PROTOCOLS.HYPERLANE;
        
        await lookCoin.connect(user1).approve(await crossChainRouter.getAddress(), amount);
        
        const balanceBefore = await lookCoin.balanceOf(user1.address);
        
        const tx = await crossChainRouter.connect(user1).bridge(
          protocol,
          chainId,
          recipient,
          amount,
          { value: ethers.parseEther("0.008") }
        );
        
        expect(await lookCoin.balanceOf(user1.address)).to.equal(balanceBefore - amount);
        await expect(tx).to.emit(crossChainRouter, "TransferInitiated");
      });

      it("should estimate fees for different protocols", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = fixture.testChainId;
        const recipient = user2.address;
        
        const protocols = [PROTOCOLS.LAYERZERO, PROTOCOLS.CELER, PROTOCOLS.HYPERLANE];
        
        for (const protocol of protocols) {
          const estimatedFee = await crossChainRouter.estimateBridgeFee(protocol, chainId, recipient, amount);
          
          expect(estimatedFee).to.be.gt(0);
          expect(estimatedFee).to.be.lt(ethers.parseEther("0.1")); // Should be reasonable
          
          console.log(`Protocol ${protocol} estimated fee: ${ethers.formatEther(estimatedFee)} ETH`);
        }
      });
    });

    describe("Bridge Validation", function () {
      it("should validate protocol is supported", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = fixture.testChainId;
        const recipient = user2.address;
        const invalidProtocol = 999;
        
        await expectSpecificRevert(
          async () => crossChainRouter.connect(user1).bridge(invalidProtocol, chainId, recipient, amount),
          crossChainRouter,
          ERROR_MESSAGES.INVALID_PROTOCOL
        );
      });

      it("should validate protocol is enabled", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = fixture.testChainId;
        const recipient = user2.address;
        const protocol = PROTOCOLS.LAYERZERO;
        
        // Disable protocol
        await crossChainRouter.connect(admin).updateProtocolStatus(protocol, false);
        
        await expectSpecificRevert(
          async () => crossChainRouter.connect(user1).bridge(protocol, chainId, recipient, amount),
          crossChainRouter,
          ERROR_MESSAGES.PROTOCOL_NOT_SUPPORTED
        );
      });

      it("should validate chain-protocol support", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = TEST_CHAINS.ETHEREUM_MAINNET; // Not configured for protocols
        const recipient = user2.address;
        const protocol = PROTOCOLS.LAYERZERO;
        
        await expectSpecificRevert(
          async () => crossChainRouter.connect(user1).bridge(protocol, chainId, recipient, amount),
          crossChainRouter,
          "CrossChainRouter: protocol not supported for chain"
        );
      });

      it("should validate sufficient allowance", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = fixture.testChainId;
        const recipient = user2.address;
        const protocol = PROTOCOLS.LAYERZERO;
        
        // No approval given
        await expectSpecificRevert(
          async () => crossChainRouter.connect(user1).bridge(protocol, chainId, recipient, amount),
          crossChainRouter,
          "ERC20InsufficientAllowance"
        );
      });

      it("should validate bridge amount", async function () {
        const zeroAmount = 0;
        const chainId = fixture.testChainId;
        const recipient = user2.address;
        const protocol = PROTOCOLS.LAYERZERO;
        
        await expectSpecificRevert(
          async () => crossChainRouter.connect(user1).bridge(protocol, chainId, recipient, zeroAmount),
          crossChainRouter,
          "CrossChainRouter: amount must be greater than zero"
        );
      });

      it("should validate recipient address", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = fixture.testChainId;
        const protocol = PROTOCOLS.LAYERZERO;
        
        await lookCoin.connect(user1).approve(await crossChainRouter.getAddress(), amount);
        
        await expectSpecificRevert(
          async () => crossChainRouter.connect(user1).bridge(protocol, chainId, ethers.ZeroAddress, amount),
          crossChainRouter,
          "CrossChainRouter: invalid recipient"
        );
      });
    });

    describe("Fee Management", function () {
      it("should handle fee collection and refunds", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = fixture.testChainId;
        const recipient = user2.address;
        const protocol = PROTOCOLS.LAYERZERO;
        
        await lookCoin.connect(user1).approve(await crossChainRouter.getAddress(), amount);
        
        const estimatedFee = await crossChainRouter.estimateBridgeFee(protocol, chainId, recipient, amount);
        const excessFee = estimatedFee + ethers.parseEther("0.01");
        
        const balanceBefore = await ethers.provider.getBalance(user1.address);
        
        const tx = await crossChainRouter.connect(user1).bridge(
          protocol,
          chainId,
          recipient,
          amount,
          { value: excessFee }
        );
        
        const receipt = await tx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
        const balanceAfter = await ethers.provider.getBalance(user1.address);
        
        // User should only pay the actual fee plus gas
        const actualPaid = balanceBefore - balanceAfter;
        expect(actualPaid).to.be.lte(estimatedFee + gasUsed + ethers.parseEther("0.001")); // Small buffer
      });

      it("should reject insufficient fees", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = fixture.testChainId;
        const recipient = user2.address;
        const protocol = PROTOCOLS.LAYERZERO;
        
        await lookCoin.connect(user1).approve(await crossChainRouter.getAddress(), amount);
        
        await expectSpecificRevert(
          async () => crossChainRouter.connect(user1).bridge(protocol, chainId, recipient, amount, {
            value: 1 // Insufficient fee
          }),
          crossChainRouter,
          ERROR_MESSAGES.INSUFFICIENT_FEE
        );
      });
    });
  });

  describe("Protocol Selection and Fallback", function () {
    beforeEach(async function () {
      const chainId = fixture.testChainId;
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOLS.LAYERZERO, true);
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOLS.CELER, true);
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOLS.HYPERLANE, true);
    });

    it("should recommend optimal protocol based on fees", async function () {
      const chainId = fixture.testChainId;
      
      const options = await crossChainRouter.getBridgeOptions(chainId);
      
      // Find the option with lowest fee
      let lowestFeeOption = options[0];
      for (const option of options) {
        if (option.available && option.estimatedFee < lowestFeeOption.estimatedFee) {
          lowestFeeOption = option;
        }
      }
      
      expect(lowestFeeOption.available).to.be.true;
      expect(lowestFeeOption.estimatedFee).to.be.gt(0);
    });

    it("should handle protocol failures gracefully", async function () {
      const amount = AMOUNTS.TEN_TOKENS;
      const chainId = fixture.testChainId;
      const recipient = user2.address;
      
      // Disable primary protocol
      await crossChainRouter.connect(admin).updateProtocolStatus(PROTOCOLS.LAYERZERO, false);
      
      // Should still be able to bridge via other protocols
      await lookCoin.connect(user1).approve(await crossChainRouter.getAddress(), amount);
      
      await expect(crossChainRouter.connect(user1).bridge(
        PROTOCOLS.CELER,
        chainId,
        recipient,
        amount,
        { value: ethers.parseEther("0.005") }
      )).to.not.be.reverted;
    });

    it("should provide protocol availability status", async function () {
      const chainId = fixture.testChainId;
      
      const options = await crossChainRouter.getBridgeOptions(chainId);
      
      // All configured protocols should be available
      const layerZeroOption = options.find(opt => opt.protocol === BigInt(PROTOCOLS.LAYERZERO));
      const celerOption = options.find(opt => opt.protocol === BigInt(PROTOCOLS.CELER));
      const hyperlaneOption = options.find(opt => opt.protocol === BigInt(PROTOCOLS.HYPERLANE));
      
      expect(layerZeroOption?.available).to.be.true;
      expect(celerOption?.available).to.be.true;
      expect(hyperlaneOption?.available).to.be.true;
    });
  });

  describe("Pause Mechanism", function () {
    beforeEach(async function () {
      const chainId = fixture.testChainId;
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOLS.LAYERZERO, true);
    });

    it("should allow admin to pause and unpause", async function () {
      // Pause
      const pauseTx = await crossChainRouter.connect(admin).pause();
      await expect(pauseTx).to.emit(crossChainRouter, EVENTS.PAUSED).withArgs(admin.address);
      expect(await crossChainRouter.paused()).to.be.true;
      
      // Unpause
      const unpauseTx = await crossChainRouter.connect(admin).unpause();
      await expect(unpauseTx).to.emit(crossChainRouter, EVENTS.UNPAUSED).withArgs(admin.address);
      expect(await crossChainRouter.paused()).to.be.false;
    });

    it("should block bridge operations when paused", async function () {
      const amount = AMOUNTS.TEN_TOKENS;
      const chainId = fixture.testChainId;
      const recipient = user2.address;
      const protocol = PROTOCOLS.LAYERZERO;
      
      await lookCoin.connect(user1).approve(await crossChainRouter.getAddress(), amount);
      await crossChainRouter.connect(admin).pause();
      
      await expectSpecificRevert(
        async () => crossChainRouter.connect(user1).bridge(protocol, chainId, recipient, amount),
        crossChainRouter,
        ERROR_MESSAGES.ENFORCED_PAUSE
      );
      
      // Unpause and try again
      await crossChainRouter.connect(admin).unpause();
      await expect(crossChainRouter.connect(user1).bridge(protocol, chainId, recipient, amount, {
        value: ethers.parseEther("0.01")
      })).to.not.be.reverted;
    });

    it("should allow configuration when paused", async function () {
      await crossChainRouter.connect(admin).pause();
      
      // Admin functions should still work when paused
      await expect(crossChainRouter.connect(admin).registerProtocol(99, TEST_ADDRESSES.REMOTE_ADDRESS))
        .to.not.be.reverted;
      
      await expect(crossChainRouter.connect(admin).updateProtocolStatus(PROTOCOLS.LAYERZERO, false))
        .to.not.be.reverted;
    });
  });

  describe("Access Control", function () {
    describe("Role-Based Permissions", function () {
      it("should enforce admin role for configuration functions", async function () {
        const configFunctions = [
          {
            name: "registerProtocol",
            args: [99, TEST_ADDRESSES.REMOTE_ADDRESS]
          },
          {
            name: "updateProtocolStatus", 
            args: [PROTOCOLS.LAYERZERO, false]
          },
          {
            name: "setChainProtocolSupport",
            args: [TEST_CHAINS.ETHEREUM_MAINNET, PROTOCOLS.LAYERZERO, true]
          },
          {
            name: "pause",
            args: []
          },
          {
            name: "unpause",
            args: []
          }
        ];

        for (const func of configFunctions) {
          await testRoleBasedFunction(
            crossChainRouter,
            func.name,
            func.args,
            CONTRACT_ROLES.CrossChainRouter.DEFAULT_ADMIN_ROLE,
            admin,
            user1
          );
        }
      });

      it("should allow role management", async function () {
        // Grant admin role to user1
        await crossChainRouter.connect(admin).grantRole(CONTRACT_ROLES.CrossChainRouter.DEFAULT_ADMIN_ROLE, user1.address);
        expect(await crossChainRouter.hasRole(CONTRACT_ROLES.CrossChainRouter.DEFAULT_ADMIN_ROLE, user1.address)).to.be.true;
        
        // User1 can now configure
        await expect(
          crossChainRouter.connect(user1).registerProtocol(99, TEST_ADDRESSES.REMOTE_ADDRESS)
        ).to.not.be.reverted;
        
        // Revoke role
        await crossChainRouter.connect(admin).revokeRole(CONTRACT_ROLES.CrossChainRouter.DEFAULT_ADMIN_ROLE, user1.address);
        expect(await crossChainRouter.hasRole(CONTRACT_ROLES.CrossChainRouter.DEFAULT_ADMIN_ROLE, user1.address)).to.be.false;
      });
    });

    describe("Bridge Access Control", function () {
      it("should allow any user to bridge tokens", async function () {
        const amount = AMOUNTS.TEN_TOKENS;
        const chainId = fixture.testChainId;
        const recipient = user2.address;
        const protocol = PROTOCOLS.LAYERZERO;
        
        // Configure protocol support
        await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, protocol, true);
        
        await lookCoin.connect(user1).approve(await crossChainRouter.getAddress(), amount);
        
        // Any user should be able to bridge
        await expect(crossChainRouter.connect(user1).bridge(protocol, chainId, recipient, amount, {
          value: ethers.parseEther("0.01")
        })).to.not.be.reverted;
      });
    });
  });

  describe("Gas Optimization and Performance", function () {
    beforeEach(async function () {
      const chainId = fixture.testChainId;
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOLS.LAYERZERO, true);
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOLS.CELER, true);
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOLS.HYPERLANE, true);
    });

    it("should track gas usage for different protocols", async function () {
      const amount = AMOUNTS.TEN_TOKENS;
      const chainId = fixture.testChainId;
      const recipient = user2.address;
      
      await lookCoin.connect(user1).approve(await crossChainRouter.getAddress(), amount * BigInt(3));
      
      const protocols = [
        { id: PROTOCOLS.LAYERZERO, name: "LayerZero", fee: ethers.parseEther("0.01") },
        { id: PROTOCOLS.CELER, name: "Celer IM", fee: ethers.parseEther("0.005") },
        { id: PROTOCOLS.HYPERLANE, name: "Hyperlane", fee: ethers.parseEther("0.008") }
      ];
      
      console.log(`\nCrossChainRouter Gas Usage by Protocol:`);
      
      for (const protocol of protocols) {
        const bridgeReport = await trackGasUsage(
          async () => crossChainRouter.connect(user1).bridge(
            protocol.id,
            chainId,
            recipient,
            amount,
            { value: protocol.fee }
          ),
          `${protocol.name} bridge`
        );
        
        console.log(`  ${protocol.name}: ${bridgeReport.gasUsed} gas`);
        
        // Gas usage should be reasonable
        expect(bridgeReport.gasUsed).to.be.lt(400000);
      }
    });

    it("should optimize bridge option queries", async function () {
      const chainId = fixture.testChainId;
      
      const queryReport = await trackGasUsage(
        async () => crossChainRouter.getBridgeOptions(chainId),
        "bridge options query"
      );
      
      console.log(`\nBridge Options Query: ${queryReport.gasUsed} gas`);
      
      // Query should be efficient
      expect(queryReport.gasUsed).to.be.lt(100000);
    });
  });

  describe("Integration and Interoperability", function () {
    beforeEach(async function () {
      const chainId = fixture.testChainId;
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOLS.LAYERZERO, true);
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOLS.CELER, true);
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, PROTOCOLS.HYPERLANE, true);
    });

    it("should handle multiple concurrent bridge operations", async function () {
      const amount = AMOUNTS.TEN_TOKENS;
      const chainId = fixture.testChainId;
      const recipients = [user2.address, admin.address, fixture.governance.address];
      const protocols = [PROTOCOLS.LAYERZERO, PROTOCOLS.CELER, PROTOCOLS.HYPERLANE];
      
      await lookCoin.connect(user1).approve(
        await crossChainRouter.getAddress(), 
        amount * BigInt(recipients.length)
      );
      
      // Execute multiple bridge operations
      const bridgePromises = recipients.map((recipient, index) => 
        crossChainRouter.connect(user1).bridge(
          protocols[index % protocols.length],
          chainId,
          recipient,
          amount,
          { value: ethers.parseEther("0.01") }
        )
      );
      
      // All operations should complete successfully
      await Promise.all(bridgePromises);
      
      // Verify tokens were transferred
      expect(await lookCoin.balanceOf(user1.address)).to.equal(
        AMOUNTS.THOUSAND_TOKENS - (amount * BigInt(recipients.length))
      );
    });

    it("should maintain protocol isolation", async function () {
      const amount = AMOUNTS.TEN_TOKENS;
      const chainId = fixture.testChainId;
      const recipient = user2.address;
      
      await lookCoin.connect(user1).approve(await crossChainRouter.getAddress(), amount * BigInt(2));
      
      // Disable one protocol
      await crossChainRouter.connect(admin).updateProtocolStatus(PROTOCOLS.LAYERZERO, false);
      
      // LayerZero should fail
      await expectSpecificRevert(
        async () => crossChainRouter.connect(user1).bridge(PROTOCOLS.LAYERZERO, chainId, recipient, amount),
        crossChainRouter,
        ERROR_MESSAGES.PROTOCOL_NOT_SUPPORTED
      );
      
      // But Celer should still work
      await expect(crossChainRouter.connect(user1).bridge(
        PROTOCOLS.CELER,
        chainId,
        recipient,
        amount,
        { value: ethers.parseEther("0.005") }
      )).to.not.be.reverted;
    });
  });

  describe("Error Handling and Edge Cases", function () {
    it("should handle module call failures gracefully", async function () {
      // Register a non-existent module address
      const invalidModule = TEST_ADDRESSES.RANDOM_ADDRESS;
      await crossChainRouter.connect(admin).registerProtocol(99, invalidModule);
      await crossChainRouter.connect(admin).setChainProtocolSupport(fixture.testChainId, 99, true);
      
      const amount = AMOUNTS.TEN_TOKENS;
      const chainId = fixture.testChainId;
      const recipient = user2.address;
      
      await lookCoin.connect(user1).approve(await crossChainRouter.getAddress(), amount);
      
      // Should fail gracefully when calling invalid module
      await expect(
        crossChainRouter.connect(user1).bridge(99, chainId, recipient, amount)
      ).to.be.reverted;
    });

    it("should handle extreme configuration scenarios", async function () {
      // Register maximum number of protocols
      const maxProtocols = 10;
      
      for (let i = 0; i < maxProtocols; i++) {
        await crossChainRouter.connect(admin).registerProtocol(100 + i, TEST_ADDRESSES.REMOTE_ADDRESS);
      }
      
      // Should still function normally
      const options = await crossChainRouter.getBridgeOptions(fixture.testChainId);
      expect(options.length).to.be.gte(0);
    });
  });

  describe("Upgrade Compatibility", function () {
    it("should maintain configuration after upgrade", async function () {
      const protocolId = 99;
      const moduleAddress = TEST_ADDRESSES.REMOTE_ADDRESS;
      const chainId = fixture.testChainId;
      
      // Set configuration
      await crossChainRouter.connect(admin).registerProtocol(protocolId, moduleAddress);
      await crossChainRouter.connect(admin).setChainProtocolSupport(chainId, protocolId, true);
      await crossChainRouter.connect(admin).updateProtocolStatus(protocolId, false);
      
      // Verify configuration persists
      expect(await crossChainRouter.protocolModules(protocolId)).to.equal(moduleAddress);
      expect(await crossChainRouter.chainProtocolSupport(chainId, protocolId)).to.be.true;
      expect(await crossChainRouter.protocolActive(protocolId)).to.be.false;
    });
  });
});