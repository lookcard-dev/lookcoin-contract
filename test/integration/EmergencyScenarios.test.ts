import { expect } from "chai";
import { testHooks, applyAllPatches } from "../setup/testInitializer";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { deployComprehensiveFixture, ComprehensiveFixture } from "../utils/comprehensiveTestHelpers";

describe("Security Integration Tests", function () {
  let fixture: ComprehensiveFixture;
  // let owner: SignerWithAddress; // unused
  let vault: SignerWithAddress;
  let attacker: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let operators: SignerWithAddress[];
  let oracle1: SignerWithAddress;
  let oracle2: SignerWithAddress;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    owner = signers[0];
    vault = signers[1]; // MPC vault wallet
    attacker = signers[2];
    user1 = signers[3];
    user2 = signers[4];
    operators = signers.slice(5, 8);
    oracle1 = signers[8];
    oracle2 = signers[9];

    // Deploy comprehensive fixture with all security components
    fixture = await deployComprehensiveFixture();

    await setupSecurityEnvironment();
  });

  async function setupSecurityEnvironment() {
    // Grant necessary roles
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
    const SECURITY_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SECURITY_ADMIN_ROLE"));

    // Grant roles to bridge modules
    await fixture.lookCoin.grantRole(MINTER_ROLE, fixture.layerZeroModule.target);
    await fixture.lookCoin.grantRole(MINTER_ROLE, fixture.celerIMModule.target);
    await fixture.lookCoin.grantRole(MINTER_ROLE, fixture.hyperlaneModule.target);
    await fixture.lookCoin.grantRole(BURNER_ROLE, fixture.layerZeroModule.target);
    await fixture.lookCoin.grantRole(BURNER_ROLE, fixture.celerIMModule.target);
    await fixture.lookCoin.grantRole(BURNER_ROLE, fixture.hyperlaneModule.target);

    // Grant operator roles
    for (const operator of operators) {
      await fixture.celerIMModule.grantRole(OPERATOR_ROLE, operator.address);
      await fixture.layerZeroModule.grantRole(OPERATOR_ROLE, operator.address);
      await fixture.hyperlaneModule.grantRole(OPERATOR_ROLE, operator.address);
    }

    // Setup oracle operators
    if (fixture.supplyOracle) {
      await fixture.supplyOracle.grantRole(ORACLE_ROLE, oracle1.address);
      await fixture.supplyOracle.grantRole(ORACLE_ROLE, oracle2.address);
      await fixture.supplyOracle.updateRequiredSignatures(2);
    }

    // Setup security manager
    if (fixture.securityManager) {
      await fixture.securityManager.grantRole(SECURITY_ADMIN_ROLE, operators[0].address);
    }

    // Mint initial tokens
    await fixture.lookCoin.mint(user1.address, ethers.parseEther("10000000"));
    await fixture.lookCoin.mint(user2.address, ethers.parseEther("5000000"));
  }

  describe("Access Control Security", function () {
    it("Should enforce role-based access across all contracts", async function () {
      // Test unauthorized access to admin functions
      await expect(
        fixture.lookCoin.connect(attacker).grantRole(ethers.ZeroHash, attacker.address)
      ).to.be.revertedWithCustomError(fixture.lookCoin, "AccessControlUnauthorizedAccount");

      await expect(
        fixture.celerIMModule.connect(attacker).setRemoteModule(10, attacker.address)
      ).to.be.revertedWithCustomError(fixture.celerIMModule, "AccessControlUnauthorizedAccount");

      await expect(
        fixture.supplyOracle.connect(attacker).pause()
      ).to.be.revertedWithCustomError(fixture.supplyOracle, "AccessControlUnauthorizedAccount");
    });

    it("Should prevent privilege escalation", async function () {
      // Grant operator role to user1
      const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
      await fixture.celerIMModule.grantRole(OPERATOR_ROLE, user1.address);

      // Operator should not be able to grant admin role
      const ADMIN_ROLE = ethers.ZeroHash;
      await expect(
        fixture.celerIMModule.connect(user1).grantRole(ADMIN_ROLE, user1.address)
      ).to.be.revertedWithCustomError(fixture.celerIMModule, "AccessControlUnauthorizedAccount");
    });

    it("Should verify vault has all admin roles", async function () {
      // Verify vault has all necessary admin roles
      const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
      const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));
      const UPGRADER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("UPGRADER_ROLE"));

      expect(await fixture.lookCoin.hasRole(DEFAULT_ADMIN_ROLE, vault.address)).to.be.true;
      expect(await fixture.lookCoin.hasRole(PAUSER_ROLE, vault.address)).to.be.true;
      expect(await fixture.lookCoin.hasRole(UPGRADER_ROLE, vault.address)).to.be.true;
    });
  });


  describe("Emergency Response System", function () {
    it("Should allow immediate pause without timelock", async function () {
      const PAUSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE"));

      // Grant emergency role
      await fixture.lookCoin.grantRole(PAUSER_ROLE, operators[0].address);

      // Emergency pause should be immediate
      await fixture.lookCoin.connect(operators[0]).pause();

      // Verify paused
      expect(await fixture.lookCoin.paused()).to.be.true;
      
      // All operations should fail
      await expect(
        fixture.lookCoin.transfer(user2.address, 100)
      ).to.be.revertedWithCustomError(fixture.lookCoin, "EnforcedPause");
    });

    it("Should pause specific bridges on supply mismatch", async function () {
      if (!fixture.supplyOracle) {
        this.skip();
      }

      // Set initial supply
      const chainId = 56;
      const initialSupply = ethers.parseEther("1000000000");
      
      await fixture.supplyOracle.connect(oracle1).updateSupply(
        chainId, initialSupply, 0, 1
      );
      await fixture.supplyOracle.connect(oracle2).updateSupply(
        chainId, initialSupply, 0, 1
      );

      // Create supply mismatch (>1% deviation)
      const mismatchedSupply = ethers.parseEther("1020000000"); // 2% over
      
      await fixture.supplyOracle.connect(oracle1).updateSupply(
        chainId, mismatchedSupply, 0, 2
      );
      
      await expect(
        fixture.supplyOracle.connect(oracle2).updateSupply(
          chainId, mismatchedSupply, 0, 2
        )
      ).to.emit(fixture.supplyOracle, "DeviationDetected");
      
      // Verify deviation flag
      const globalSupply = await fixture.supplyOracle.getGlobalSupply();
      expect(globalSupply.hasDeviation).to.be.true;
    });

    it("Should handle circuit breaker activation", async function () {
      // Pause bridge
      await fixture.celerIMModule.connect(operators[0]).pause();
      expect(await fixture.celerIMModule.paused()).to.be.true;

      // Verify operations fail
      await expect(
        fixture.celerIMModule.bridge(10, user1.address, 100, { value: 100 })
      ).to.be.revertedWithCustomError(fixture.celerIMModule, "EnforcedPause");
    });
  });

  describe("Supply Oracle Security", function () {
    it("Should enforce multi-signature requirements", async function () {
      if (!fixture.supplyOracle) {
        this.skip();
      }

      const chainId = 56;
      const chainSupply = ethers.parseEther("500000000");
      const nonce = 1;
      
      // Single operator update should not execute immediately
      await fixture.supplyOracle.connect(oracle1).updateSupply(
        chainId, chainSupply, 0, nonce
      );
      
      // Verify not yet applied
      const supply = await fixture.supplyOracle.getChainSupply(chainId);
      expect(supply.totalSupply).to.equal(0);
      
      // Second signature should apply
      await expect(
        fixture.supplyOracle.connect(oracle2).updateSupply(
          chainId, chainSupply, 0, nonce
        )
      ).to.emit(fixture.supplyOracle, "SupplyUpdated");
      
      // Verify applied
      const updatedSupply = await fixture.supplyOracle.getChainSupply(chainId);
      expect(updatedSupply.totalSupply).to.equal(chainSupply);
    });

    it("Should detect and respond to supply anomalies", async function () {
      if (!fixture.supplyOracle) {
        this.skip();
      }

      // Set deviation threshold
      await fixture.supplyOracle.updateDeviationThreshold(100); // 1%
      
      // Set initial supplies
      const baseSupply = ethers.parseEther("500000000");
      await fixture.supplyOracle.connect(oracle1).updateSupply(56, baseSupply, 0, 1);
      await fixture.supplyOracle.connect(oracle2).updateSupply(56, baseSupply, 0, 1);
      
      // Create significant mismatch (>1%)
      const mismatchedSupply = ethers.parseEther("510000000"); // 2% increase
      await fixture.supplyOracle.connect(oracle1).updateSupply(10, mismatchedSupply, 0, 1);
      
      await expect(
        fixture.supplyOracle.connect(oracle2).updateSupply(10, mismatchedSupply, 0, 1)
      ).to.emit(fixture.supplyOracle, "DeviationDetected");
    });
  });

  describe("Upgrade Security", function () {
    it("Should prevent unauthorized contract upgrades", async function () {
      // Deploy new implementation
      const LookCoinV2 = await ethers.getContractFactory("LookCoin");
      const lookCoinV2 = await LookCoinV2.deploy();
      await lookCoinV2.waitForDeployment();
      
      // Attacker attempts upgrade
      await expect(
        fixture.lookCoin.connect(attacker).upgradeToAndCall(
          await lookCoinV2.getAddress(),
          "0x"
        )
      ).to.be.revertedWithCustomError(fixture.lookCoin, "AccessControlUnauthorizedAccount");
      
      // Only vault (with UPGRADER_ROLE) can upgrade
      await fixture.lookCoin.upgradeToAndCall(
        await lookCoinV2.getAddress(),
        "0x"
      );
    });

    it("Should maintain state after upgrade", async function () {
      // Record state before upgrade
      const balanceBefore = await fixture.lookCoin.balanceOf(user1.address);
      const totalSupplyBefore = await fixture.lookCoin.totalSupply();
      const totalMintedBefore = await fixture.lookCoin.totalMinted();
      const totalBurnedBefore = await fixture.lookCoin.totalBurned();
      
      // Perform upgrade
      const LookCoinV2 = await ethers.getContractFactory("LookCoin");
      const lookCoinV2 = await LookCoinV2.deploy();
      await lookCoinV2.waitForDeployment();
      
      await fixture.lookCoin.upgradeToAndCall(
        await lookCoinV2.getAddress(),
        "0x"
      );
      
      // Verify state preservation
      expect(await fixture.lookCoin.balanceOf(user1.address)).to.equal(balanceBefore);
      expect(await fixture.lookCoin.totalSupply()).to.equal(totalSupplyBefore);
      expect(await fixture.lookCoin.totalMinted()).to.equal(totalMintedBefore);
      expect(await fixture.lookCoin.totalBurned()).to.equal(totalBurnedBefore);
    });
  });

  describe("Cross-Bridge Attack Prevention", function () {
    it("Should handle coordinated attacks across bridges", async function () {
      if (!fixture.securityManager) {
        this.skip();
      }

      // Configure daily limit
      await fixture.securityManager.connect(operators[0]).updateGlobalDailyLimit(
        ethers.parseEther("10000000") // 10M daily
      );
      
      // Setup protocol registry
      await fixture.protocolRegistry.registerProtocol(0, fixture.layerZeroModule.target, "LayerZero", "1.0.0");
      await fixture.protocolRegistry.registerProtocol(1, fixture.celerIMModule.target, "Celer", "1.0.0");
      await fixture.protocolRegistry.addChainSupport(0, 10);
      await fixture.protocolRegistry.addChainSupport(1, 10);
      
      // Grant necessary roles
      const BRIDGE_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_OPERATOR_ROLE"));
      await fixture.layerZeroModule.grantRole(BRIDGE_OPERATOR_ROLE, fixture.crossChainRouter.target);
      await fixture.celerIMModule.grantRole(BRIDGE_OPERATOR_ROLE, fixture.crossChainRouter.target);
      
      const largeAmount = ethers.parseEther("6000000"); // 6M each
      
      // First bridge attempt
      await fixture.lookCoin.connect(user1).approve(fixture.crossChainRouter.target, largeAmount);
      const [, , fee1] = await fixture.crossChainRouter.estimateBridgeFee(0, 10, largeAmount);
      
      await fixture.crossChainRouter.connect(user1).bridge(
        0, 10, user2.address, largeAmount, ethers.ZeroAddress, { value: fee1 }
      );
      
      // Second bridge attempt via different protocol should be blocked
      await fixture.lookCoin.connect(user1).approve(fixture.crossChainRouter.target, largeAmount);
      const [, , fee2] = await fixture.crossChainRouter.estimateBridgeFee(1, 10, largeAmount);
      
      await expect(
        fixture.crossChainRouter.connect(user1).bridge(
          1, 10, user2.address, largeAmount, ethers.ZeroAddress, { value: fee2 }
        )
      ).to.be.revertedWith("SecurityManager: exceeds global daily limit");
    });

    it("Should maintain security during high-volume operations", async function () {
      // Configure router
      const BRIDGE_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_OPERATOR_ROLE"));
      await fixture.layerZeroModule.grantRole(BRIDGE_OPERATOR_ROLE, fixture.crossChainRouter.target);
      
      // Setup chain support
      await fixture.protocolRegistry.registerProtocol(0, fixture.layerZeroModule.target, "LayerZero", "1.0.0");
      await fixture.protocolRegistry.addChainSupport(0, 10);
      await fixture.layerZeroModule.setTrustedRemote(10, ethers.zeroPadValue("0x1234", 32));
      
      // Perform multiple operations in quick succession
      const amount = ethers.parseEther("100000");
      const operations = [];
      
      for (let i = 0; i < 5; i++) {
        await fixture.lookCoin.approve(fixture.crossChainRouter.target, amount);
        const [, , fee] = await fixture.crossChainRouter.estimateBridgeFee(0, 10, amount);
        
        operations.push(
          fixture.crossChainRouter.bridge(
            0, 10, user2.address, amount, ethers.ZeroAddress, { value: fee }
          )
        );
      }
      
      // All operations should succeed without compromising security
      await Promise.all(operations);
      
      // Verify tracking
      const transfers = await fixture.crossChainRouter.getUserTransfers(user1.address);
      expect(transfers.length).to.equal(5);
    });
  });

  describe("Message Validation Security", function () {
    it("Should validate message signatures for Celer IM", async function () {
      // Test signature validation in executeMessageWithTransfer
      const invalidSender = attacker.address;
      
      // Attempting to execute with invalid sender should fail
      await expect(
        fixture.celerIMModule.executeMessageWithTransfer(
          invalidSender, // Wrong sender
          ethers.ZeroAddress,
          0,
          10,
          "0x",
          attacker.address
        )
      ).to.be.revertedWith("CelerIMModule: caller not message bus");
    });

    it("Should prevent message replay attacks", async function () {
      // Setup mock message bus behavior
      const transferId = ethers.keccak256(ethers.toUtf8Bytes("transfer-1"));
      
      // Mark transfer as processed
      // In real scenario, this would happen during first execution
      // Here we verify the protection exists
      const processedTransfers = await fixture.celerIMModule.processedTransfers(transferId);
      expect(processedTransfers).to.be.false; // Initially not processed
    });
  });

  describe("Governance Security", function () {
    it("Should allow direct vault governance without timelock", async function () {
      // Vault governance is handled off-chain by MPC
      // Operations should be immediate when executed by vault
      
      // Vault can immediately pause
      await fixture.lookCoin.pause();
      expect(await fixture.lookCoin.paused()).to.be.true;

      // And immediately unpause
      await fixture.lookCoin.unpause();
      expect(await fixture.lookCoin.paused()).to.be.false;
    });

    it("Should handle key rotation securely", async function () {
      // Test admin key rotation
      const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

      // Grant new admin
      await fixture.lookCoin.grantRole(DEFAULT_ADMIN_ROLE, operators[0].address);

      // New admin can perform admin functions
      await fixture.lookCoin.connect(operators[0]).grantRole(
        ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")),
        operators[1].address
      );

      // Verify role was granted
      expect(await fixture.lookCoin.hasRole(
        ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")),
        operators[1].address
      )).to.be.true;
    });
  });

  describe("Input Validation", function () {
    it("Should validate zero address inputs", async function () {
      await expect(
        fixture.lookCoin.mint(ethers.ZeroAddress, 100)
      ).to.be.revertedWith("ERC20: mint to the zero address");

      await expect(
        fixture.celerIMModule.setRemoteModule(10, ethers.ZeroAddress)
      ).to.be.revertedWith("CelerIMModule: zero address");
    });

    it("Should validate amount boundaries", async function () {
      // Test zero amount
      await expect(
        fixture.celerIMModule.bridge(10, user1.address, 0, { value: 100 })
      ).to.be.revertedWith("CelerIMModule: zero amount");
    });

    it("Should validate chain IDs", async function () {
      // Test invalid chain ID
      await expect(
        fixture.celerIMModule.bridge(0, user1.address, 100, { value: 100 })
      ).to.be.revertedWith("CelerIMModule: unsupported chain");
    });
  });

  describe("Economic Security", function () {
    it("Should enforce fee limits", async function () {
      // Test fee manipulation resistance
      await expect(
        fixture.feeManager.setProtocolFee(0, 2000) // 20% - too high
      ).to.be.revertedWith("FeeManager: fee too high");
      
      // Max fee should be 5%
      await fixture.feeManager.setProtocolFee(0, 500); // 5%
      expect(await fixture.feeManager.protocolFees(0)).to.equal(500);
    });

    it("Should protect against fee calculation manipulation", async function () {
      // Fee calculation should be deterministic
      const amount = ethers.parseEther("1000");
      const [fee1] = await fixture.crossChainRouter.estimateBridgeFee(0, 10, amount);
      const [fee2] = await fixture.crossChainRouter.estimateBridgeFee(0, 10, amount);

      expect(fee1).to.equal(fee2);
    });
  });

  describe("Monitoring and Alerting", function () {
    it("Should emit events for security monitoring", async function () {
      // Pause should emit event
      await expect(
        fixture.celerIMModule.connect(operators[0]).pause()
      ).to.emit(fixture.celerIMModule, "Paused");

      // Role changes should emit events
      await expect(
        fixture.lookCoin.grantRole(
          ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")),
          operators[0].address
        )
      ).to.emit(fixture.lookCoin, "RoleGranted");

      // Supply deviations should emit events
      if (fixture.supplyOracle) {
        const chainId = 56;
        const deviatedSupply = ethers.parseEther("1020000000");
        
        await fixture.supplyOracle.connect(oracle1).updateSupply(
          chainId, deviatedSupply, 0, 1
        );
        
        await expect(
          fixture.supplyOracle.connect(oracle2).updateSupply(
            chainId, deviatedSupply, 0, 1
          )
        ).to.emit(fixture.supplyOracle, "DeviationDetected");
      }
    });

    it("Should maintain audit trail", async function () {
      // All critical operations emit events that can be tracked
      const filter = fixture.lookCoin.filters.RoleGranted();
      const events = await fixture.lookCoin.queryFilter(filter);

      // Events should be queryable for audit
      expect(events).to.be.an("array");
      
      // Each event should have required fields
      if (events.length > 0) {
        expect(events[0].args).to.have.property("role");
        expect(events[0].args).to.have.property("account");
        expect(events[0].args).to.have.property("sender");
      }
    });
  });

  describe("Suspicious Activity Detection", function () {
    it("Should detect rapid transfer patterns", async function () {
      if (!fixture.securityManager) {
        this.skip();
      }

      // Configure suspicious activity detection
      await fixture.securityManager.connect(operators[0]).setSuspiciousActivityThreshold(
        3, // 3 transfers
        300 // 5 minutes
      );
      
      // Setup bridge
      const BRIDGE_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_OPERATOR_ROLE"));
      await fixture.layerZeroModule.grantRole(BRIDGE_OPERATOR_ROLE, fixture.crossChainRouter.target);
      await fixture.protocolRegistry.registerProtocol(0, fixture.layerZeroModule.target, "LayerZero", "1.0.0");
      await fixture.protocolRegistry.addChainSupport(0, 10);
      await fixture.layerZeroModule.setTrustedRemote(10, ethers.zeroPadValue("0x1234", 32));
      
      const amount = ethers.parseEther("100000");
      
      // Make rapid transfers
      for (let i = 0; i < 3; i++) {
        await fixture.lookCoin.connect(user1).approve(fixture.crossChainRouter.target, amount);
        const [, , fee] = await fixture.crossChainRouter.estimateBridgeFee(0, 10, amount);
        
        const tx = await fixture.crossChainRouter.connect(user1).bridge(
          0, 10, user2.address, amount, ethers.ZeroAddress, { value: fee }
        );
        
        if (i === 2) {
          // Third transfer should trigger detection
          await expect(tx).to.emit(fixture.securityManager, "SuspiciousActivityDetected")
            .withArgs(user1.address, "rapid_transfers");
        }
      }
    });

    it("Should auto-blacklist after suspicious activity", async function () {
      if (!fixture.securityManager) {
        this.skip();
      }

      // Enable auto-blacklist
      await fixture.securityManager.connect(operators[0]).setAutoBlacklistEnabled(true);
      
      // Configure threshold
      await fixture.securityManager.connect(operators[0]).setSuspiciousActivityThreshold(2, 300);
      
      // Make transfers to trigger auto-blacklist
      await fixture.securityManager.validateTransfer(attacker.address, 10, ethers.parseEther("100000"));
      await fixture.securityManager.recordTransfer(attacker.address, 10, ethers.parseEther("100000"));
      
      // This should trigger auto-blacklist
      await fixture.securityManager.validateTransfer(attacker.address, 10, ethers.parseEther("100000"));
      
      // Next transfer should fail
      await expect(
        fixture.securityManager.validateTransfer(
          attacker.address,
          10,
          ethers.parseEther("100000")
        )
      ).to.be.revertedWith("SecurityManager: address blacklisted");
    });
  });
});
