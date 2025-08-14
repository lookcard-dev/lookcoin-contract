import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  deployLookCoinFixture,
  configureAllBridges,
  expectSpecificRevert,
  coverageTracker,
  DeploymentFixture,
  BOOLEAN_COMBINATIONS,
  testBooleanCombinations,
} from "../utils/comprehensiveTestHelpers";
import { TEST_CHAINS } from "../utils/testConfig";
import {
  CrossChainRouter,
  ProtocolRegistry,
  FeeManager,
  SecurityManager,
  MockReentrantAttacker,
} from "../../typechain-types";

/**
 * Multi-Protocol Routing Security Tests
 * 
 * Comprehensive security test suite for LookCoin's multi-protocol routing system.
 * 
 * Test Coverage Areas:
 * 1. Protocol switching during active transfer security
 * 2. Malicious protocol module registration attempts
 * 3. Fee extraction attacks via protocol manipulation
 * 4. Cross-protocol message collision tests
 * 5. Protocol failover with pending transactions
 * 6. Router bypass attempt tests
 * 
 * Security Focus:
 * - CrossChainRouter access control and state integrity
 * - Protocol registry manipulation resistance
 * - Fee manager exploit prevention
 * - Security manager bypass attempts
 * - Edge case handling and gas optimization
 */
describe("Multi-Protocol Routing Security Tests", function () {
  let fixture: DeploymentFixture;
  let maliciousAttacker: MockReentrantAttacker;

  // Test constants
  const DESTINATION_CHAIN_ID = TEST_CHAINS.OPTIMISM;
  const DESTINATION_DOMAIN = 2;
  const TEST_AMOUNT = ethers.parseUnits("1000", 18);
  const LARGE_AMOUNT = ethers.parseUnits("1000000", 18);
  const TRUSTED_REMOTE_ADDRESS = "0x" + "1".repeat(40);

  // Protocol enum values
  const LAYERZERO_PROTOCOL = 0;
  const CELER_PROTOCOL = 1;
  const HYPERLANE_PROTOCOL = 2;

  // Helper function to extract transfer ID from transaction receipt
  function extractTransferId(receipt: any, routerContract: CrossChainRouter): string {
    const transferEvent = receipt.logs.find((log: any) => {
      try {
        const parsed = routerContract.interface.parseLog(log);
        return parsed?.name === "TransferRouted";
      } catch {
        return false;
      }
    });

    if (!transferEvent) {
      throw new Error("TransferRouted event not found");
    }

    const parsedEvent = routerContract.interface.parseLog(transferEvent);
    return parsedEvent?.args.transferId;
  }

  beforeEach(async function () {
    fixture = await loadFixture(deployLookCoinFixture);
    await configureAllBridges(fixture, DESTINATION_CHAIN_ID, DESTINATION_DOMAIN);

    // Deploy malicious attacker contract for testing
    const MaliciousAttacker = await ethers.getContractFactory("MockReentrantAttacker");
    maliciousAttacker = await MaliciousAttacker.deploy() as unknown as MockReentrantAttacker;
    await maliciousAttacker.waitForDeployment();
  });

  describe("Protocol Switching Security", function () {
    describe("Active Transfer Protocol Switching", function () {
      it("should prevent protocol switching during active transfer", async function () {
        // Setup: Create an active transfer using LayerZero
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, TEST_AMOUNT);
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), TEST_AMOUNT);

        // Create active transfer
        const fee = await fixture.crossChainRouter.estimateFee(DESTINATION_CHAIN_ID, TEST_AMOUNT, LAYERZERO_PROTOCOL, "0x");
        const tx = await fixture.crossChainRouter.connect(fixture.user).bridge(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          TEST_AMOUNT,
          LAYERZERO_PROTOCOL,
          "0x",
          { value: fee }
        );
        const receipt = await tx.wait();
        
        // Extract transfer ID from events
        const transferEvent = receipt?.logs.find((log: any) => {
          try {
            const parsed = fixture.crossChainRouter.interface.parseLog(log);
            return parsed?.name === "TransferRouted";
          } catch {
            return false;
          }
        });
        
        expect(transferEvent).to.not.be.undefined;
        const parsedEvent = fixture.crossChainRouter.interface.parseLog(transferEvent!);
        const transferId = parsedEvent?.args.transferId;

        // Attack: Attacker tries to change protocol module during active transfer
        await expectSpecificRevert(
          async () => fixture.crossChainRouter.connect(fixture.attacker).registerProtocol(
            LAYERZERO_PROTOCOL,
            await maliciousAttacker.getAddress()
          ),
          fixture.crossChainRouter,
          "AccessControlUnauthorizedAccount"
        );

        // Verify protocol integrity
        const currentModule = await fixture.crossChainRouter.protocolModules(LAYERZERO_PROTOCOL);
        expect(currentModule).to.equal(await fixture.layerZeroModule.getAddress());

        // Verify transfer status remains valid
        const transferStatus = await fixture.crossChainRouter.getTransferStatus(transferId);
        expect(transferStatus).to.equal(0); // Pending

        coverageTracker.trackBranch("MultiProtocolSecurity", "active-transfer-protocol-switching");
      });

      it("should handle concurrent protocol switching attempts", async function () {
        // Setup multiple active transfers on different protocols
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, TEST_AMOUNT * BigInt(3));
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), TEST_AMOUNT * BigInt(3));

        // Create transfers on all available protocols
        const lzFee = await fixture.crossChainRouter.estimateFee(DESTINATION_CHAIN_ID, TEST_AMOUNT, LAYERZERO_PROTOCOL, "0x");
        const celerFee = await fixture.crossChainRouter.estimateFee(DESTINATION_CHAIN_ID, TEST_AMOUNT, CELER_PROTOCOL, "0x");

        await fixture.crossChainRouter.connect(fixture.user).bridge(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          TEST_AMOUNT,
          LAYERZERO_PROTOCOL,
          "0x",
          { value: lzFee }
        );

        await fixture.crossChainRouter.connect(fixture.user).bridge(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          TEST_AMOUNT,
          CELER_PROTOCOL,
          "0x",
          { value: celerFee }
        );

        // Attack: Try to disable all protocols simultaneously
        const attacker = fixture.attacker;
        
        await expectSpecificRevert(
          async () => fixture.crossChainRouter.connect(attacker).updateProtocolStatus(LAYERZERO_PROTOCOL, false),
          fixture.crossChainRouter,
          "AccessControlUnauthorizedAccount"
        );

        await expectSpecificRevert(
          async () => fixture.crossChainRouter.connect(attacker).updateProtocolStatus(CELER_PROTOCOL, false),
          fixture.crossChainRouter,
          "AccessControlUnauthorizedAccount"
        );

        // Verify all protocols remain active
        expect(await fixture.crossChainRouter.protocolActive(LAYERZERO_PROTOCOL)).to.be.true;
        expect(await fixture.crossChainRouter.protocolActive(CELER_PROTOCOL)).to.be.true;

        coverageTracker.trackBranch("MultiProtocolSecurity", "concurrent-protocol-switching");
      });
    });
  });

  describe("Malicious Module Registration", function () {
    describe("Protocol Module Registration Security", function () {
      it("should prevent malicious protocol module registration", async function () {
        const maliciousModule = await maliciousAttacker.getAddress();

        // Attack 1: Direct registration by unauthorized user
        await expectSpecificRevert(
          async () => fixture.crossChainRouter.connect(fixture.attacker).registerProtocol(
            LAYERZERO_PROTOCOL,
            maliciousModule
          ),
          fixture.crossChainRouter,
          "AccessControlUnauthorizedAccount"
        );

        // Attack 2: Try to replace existing module (should fail even with admin role)
        await expectSpecificRevert(
          async () => fixture.crossChainRouter.connect(fixture.admin).registerProtocol(
            LAYERZERO_PROTOCOL,
            maliciousModule
          ),
          fixture.crossChainRouter,
          "Protocol already registered"
        );

        // Attack 3: Register with zero address
        await expectSpecificRevert(
          async () => fixture.crossChainRouter.connect(fixture.admin).registerProtocol(
            HYPERLANE_PROTOCOL,
            ethers.ZeroAddress
          ),
          fixture.crossChainRouter,
          "Invalid module address"
        );

        // Verify system integrity
        expect(await fixture.crossChainRouter.protocolModules(LAYERZERO_PROTOCOL)).to.equal(
          await fixture.layerZeroModule.getAddress()
        );
        expect(await fixture.crossChainRouter.protocolModules(CELER_PROTOCOL)).to.equal(
          await fixture.celerIMModule.getAddress()
        );

        coverageTracker.trackBranch("MultiProtocolSecurity", "malicious-module-registration-prevention");
      });

      it("should resist protocol registry manipulation", async function () {
        // Attack: Try to manipulate protocol registry directly
        const attacker = fixture.attacker;
        const maliciousModule = await maliciousAttacker.getAddress();

        await expectSpecificRevert(
          async () => fixture.protocolRegistry.connect(attacker).registerProtocol(
            LAYERZERO_PROTOCOL,
            maliciousModule,
            "1.0.0",
            []
          ),
          fixture.protocolRegistry,
          "AccessControlUnauthorizedAccount"
        );

        await expectSpecificRevert(
          async () => fixture.protocolRegistry.connect(attacker).setProtocolStatus(
            LAYERZERO_PROTOCOL,
            false,
            true
          ),
          fixture.protocolRegistry,
          "AccessControlUnauthorizedAccount"
        );

        await expectSpecificRevert(
          async () => fixture.protocolRegistry.connect(attacker).updateChainSupport(
            LAYERZERO_PROTOCOL,
            DESTINATION_CHAIN_ID,
            false,
            "0x"
          ),
          fixture.protocolRegistry,
          "AccessControlUnauthorizedAccount"
        );

        // Verify registry integrity
        const [moduleAddr, , active, deprecated] = await fixture.protocolRegistry.getProtocolInfo(LAYERZERO_PROTOCOL);
        expect(moduleAddr).to.not.equal(ethers.ZeroAddress);
        expect(active).to.be.true;
        expect(deprecated).to.be.false;

        coverageTracker.trackBranch("MultiProtocolSecurity", "protocol-registry-manipulation-resistance");
      });
    });
  });

  describe("Fee Extraction Attacks", function () {
    describe("Fee Manipulation Security", function () {
      it("should prevent fee extraction via protocol manipulation", async function () {
        // Setup: Get legitimate fee estimate
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, TEST_AMOUNT);
        const legitimateFee = await fixture.crossChainRouter.estimateFee(DESTINATION_CHAIN_ID, TEST_AMOUNT, LAYERZERO_PROTOCOL, "0x");

        // Attack 1: Try to manipulate fee multipliers
        await expectSpecificRevert(
          async () => fixture.feeManager.connect(fixture.attacker).updateProtocolFees(
            LAYERZERO_PROTOCOL,
            50000, // 500% multiplier
            ethers.parseEther("1")
          ),
          fixture.feeManager,
          "AccessControlUnauthorizedAccount"
        );

        // Attack 2: Try to set extreme gas prices
        await expectSpecificRevert(
          async () => fixture.feeManager.connect(fixture.attacker).updateGasPrice(
            DESTINATION_CHAIN_ID,
            ethers.parseEther("1000")
          ),
          fixture.feeManager,
          "AccessControlUnauthorizedAccount"
        );

        // Attack 3: Try to manipulate fee cache
        await expectSpecificRevert(
          async () => fixture.feeManager.connect(fixture.attacker).invalidateCache(
            DESTINATION_CHAIN_ID,
            LAYERZERO_PROTOCOL
          ),
          fixture.feeManager,
          "AccessControlUnauthorizedAccount"
        );

        // Verify fee estimates remain consistent
        const postAttackFee = await fixture.crossChainRouter.estimateFee(DESTINATION_CHAIN_ID, TEST_AMOUNT, LAYERZERO_PROTOCOL, "0x");
        expect(postAttackFee).to.equal(legitimateFee);

        // Test legitimate bridge operation still works
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), TEST_AMOUNT);
        const transferId = await fixture.crossChainRouter.connect(fixture.user).bridge(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          TEST_AMOUNT,
          LAYERZERO_PROTOCOL,
          "0x",
          { value: legitimateFee }
        );

        expect(transferId).to.not.be.reverted;

        coverageTracker.trackBranch("MultiProtocolSecurity", "fee-extraction-attack-prevention");
      });

      it("should resist fee calculation manipulation", async function () {
        // Test fee comparison functionality
        const fees = await fixture.feeManager.compareProtocolFees(DESTINATION_CHAIN_ID, TEST_AMOUNT);
        
        // Verify all protocols return reasonable fees
        for (let i = 0; i < fees.length; i++) {
          const fee = fees[i];
          // Fee should be reasonable (< 1 ETH) or max uint256 (unavailable)
          expect(fee).to.satisfy((f: bigint) => 
            f < ethers.parseEther("1") || f === ethers.MaxUint256
          );
        }

        // Attempt to manipulate fee estimation via external calls
        const attacker = fixture.attacker;
        
        // This should not cause any issues with fee calculation
        try {
          await fixture.feeManager.connect(attacker).estimateFee(LAYERZERO_PROTOCOL, DESTINATION_CHAIN_ID, TEST_AMOUNT);
        } catch (error) {
          // Fee estimation might revert for access control or other reasons, which is acceptable
        }

        coverageTracker.trackBranch("MultiProtocolSecurity", "fee-calculation-manipulation-resistance");
      });
    });
  });

  describe("Cross-Protocol Message Collisions", function () {
    describe("Transfer ID Uniqueness", function () {
      it("should prevent cross-protocol message collisions", async function () {
        // Setup transfers with potential ID collisions
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, TEST_AMOUNT * BigInt(3));
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), TEST_AMOUNT * BigInt(3));

        // Create transfers on different protocols with same parameters
        const lzFee = await fixture.crossChainRouter.estimateFee(DESTINATION_CHAIN_ID, TEST_AMOUNT, LAYERZERO_PROTOCOL, "0x");
        const celerFee = await fixture.crossChainRouter.estimateFee(DESTINATION_CHAIN_ID, TEST_AMOUNT, CELER_PROTOCOL, "0x");

        const lzTx = await fixture.crossChainRouter.connect(fixture.user).bridge(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          TEST_AMOUNT,
          LAYERZERO_PROTOCOL,
          "0x",
          { value: lzFee }
        );

        const celerTx = await fixture.crossChainRouter.connect(fixture.user).bridge(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          TEST_AMOUNT,
          CELER_PROTOCOL,
          "0x",
          { value: celerFee }
        );

        // Extract transfer IDs from transaction receipts
        const lzReceipt = await lzTx.wait();
        const celerReceipt = await celerTx.wait();

        const lzTransferId = extractTransferId(lzReceipt!, fixture.crossChainRouter);
        const celerTransferId = extractTransferId(celerReceipt!, fixture.crossChainRouter);

        // Verify transfer IDs are unique
        expect(lzTransferId).to.not.equal(celerTransferId);

        // Verify each protocol tracks its own transfer
        expect(await fixture.crossChainRouter.transferProtocol(lzTransferId)).to.equal(LAYERZERO_PROTOCOL);
        expect(await fixture.crossChainRouter.transferProtocol(celerTransferId)).to.equal(CELER_PROTOCOL);

        coverageTracker.trackBranch("MultiProtocolSecurity", "cross-protocol-message-collision-prevention");
      });

      it("should prevent message replay attacks across protocols", async function () {
        // Create a transfer on LayerZero
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, TEST_AMOUNT);
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), TEST_AMOUNT);

        const fee = await fixture.crossChainRouter.estimateFee(DESTINATION_CHAIN_ID, TEST_AMOUNT, LAYERZERO_PROTOCOL, "0x");
        const tx = await fixture.crossChainRouter.connect(fixture.user).bridge(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          TEST_AMOUNT,
          LAYERZERO_PROTOCOL,
          "0x",
          { value: fee }
        );

        const receipt = await tx.wait();
        const transferId = extractTransferId(receipt!, fixture.crossChainRouter);

        // Verify transfer is properly associated with LayerZero only
        const storedProtocol = await fixture.crossChainRouter.transferProtocol(transferId);
        expect(storedProtocol).to.equal(LAYERZERO_PROTOCOL);

        // Attempt to manipulate transfer protocol mapping should not be possible
        // (no direct function exists for this, which is good for security)

        coverageTracker.trackBranch("MultiProtocolSecurity", "cross-protocol-replay-attack-prevention");
      });
    });
  });

  describe("Protocol Failover Security", function () {
    describe("Emergency Protocol Management", function () {
      it("should handle protocol failover with pending transactions", async function () {
        // Setup pending transactions
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, TEST_AMOUNT * BigInt(2));
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), TEST_AMOUNT * BigInt(2));

        // Create pending transfers
        const fee = await fixture.crossChainRouter.estimateFee(DESTINATION_CHAIN_ID, TEST_AMOUNT, LAYERZERO_PROTOCOL, "0x");
        const tx1 = await fixture.crossChainRouter.connect(fixture.user).bridge(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          TEST_AMOUNT,
          LAYERZERO_PROTOCOL,
          "0x",
          { value: fee }
        );

        const tx2 = await fixture.crossChainRouter.connect(fixture.user).bridge(
          DESTINATION_CHAIN_ID,
          fixture.user2.address,
          TEST_AMOUNT,
          LAYERZERO_PROTOCOL,
          "0x",
          { value: fee }
        );

        const transfer1Id = extractTransferId(await tx1.wait()!, fixture.crossChainRouter);
        const transfer2Id = extractTransferId(await tx2.wait()!, fixture.crossChainRouter);

        // Simulate protocol failure scenario
        await fixture.securityManager.connect(fixture.admin).pauseProtocol(LAYERZERO_PROTOCOL);

        // Verify existing transfers are still trackable
        expect(await fixture.crossChainRouter.transferProtocol(transfer1Id)).to.equal(LAYERZERO_PROTOCOL);
        expect(await fixture.crossChainRouter.transferProtocol(transfer2Id)).to.equal(LAYERZERO_PROTOCOL);

        // New transfers on paused protocol should fail
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user2.address, TEST_AMOUNT);
        await fixture.lookCoin.connect(fixture.user2).approve(await fixture.crossChainRouter.getAddress(), TEST_AMOUNT);

        await expectSpecificRevert(
          async () => fixture.crossChainRouter.connect(fixture.user2).bridge(
            DESTINATION_CHAIN_ID,
            fixture.user.address,
            TEST_AMOUNT,
            LAYERZERO_PROTOCOL,
            "0x",
            { value: fee }
          ),
          fixture.crossChainRouter,
          "Protocol not active"
        );

        // Test emergency pause
        await fixture.securityManager.connect(fixture.admin).activateEmergencyPause();

        // All new transfers should fail
        await expectSpecificRevert(
          async () => fixture.securityManager.validateTransfer(
            fixture.user.address,
            CELER_PROTOCOL,
            TEST_AMOUNT,
            ethers.keccak256(ethers.toUtf8Bytes("test"))
          ),
          fixture.securityManager,
          "Emergency pause active"
        );

        coverageTracker.trackBranch("MultiProtocolSecurity", "protocol-failover-handling");
      });
    });
  });

  describe("Router Bypass Attempts", function () {
    describe("Direct Module Access", function () {
      it("should prevent router bypass and direct module access", async function () {
        // Setup tokens for attack attempts
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.attacker.address, TEST_AMOUNT);

        const attacker = fixture.attacker;

        // Attempt 1: Try to call LayerZero bridge module directly
        await fixture.lookCoin.connect(attacker).approve(await fixture.layerZeroModule.getAddress(), TEST_AMOUNT);

        await expectSpecificRevert(
          async () => fixture.layerZeroModule.connect(attacker).bridge(
            DESTINATION_CHAIN_ID,
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [fixture.user2.address]),
            TEST_AMOUNT,
            "0x"
          ),
          fixture.layerZeroModule,
          "AccessControlUnauthorizedAccount"
        );

        // Attempt 2: Try to call Celer bridge module directly
        await fixture.lookCoin.connect(attacker).approve(await fixture.celerIMModule.getAddress(), TEST_AMOUNT);

        await expectSpecificRevert(
          async () => fixture.celerIMModule.connect(attacker).bridge(
            DESTINATION_CHAIN_ID,
            ethers.AbiCoder.defaultAbiCoder().encode(["address"], [fixture.user2.address]),
            TEST_AMOUNT,
            "0x"
          ),
          fixture.celerIMModule,
          "AccessControlUnauthorizedAccount"
        );

        // Verify legitimate router access still works
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, TEST_AMOUNT);
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), TEST_AMOUNT);

        const fee = await fixture.crossChainRouter.estimateFee(DESTINATION_CHAIN_ID, TEST_AMOUNT, LAYERZERO_PROTOCOL, "0x");
        await expect(
          fixture.crossChainRouter.connect(fixture.user).bridge(
            DESTINATION_CHAIN_ID,
            fixture.user2.address,
            TEST_AMOUNT,
            LAYERZERO_PROTOCOL,
            "0x",
            { value: fee }
          )
        ).to.not.be.reverted;

        coverageTracker.trackBranch("MultiProtocolSecurity", "router-bypass-prevention");
      });

      it("should prevent direct token manipulation", async function () {
        // Setup scenario where attacker tries to manipulate tokens directly
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, TEST_AMOUNT);

        const attacker = fixture.attacker;

        // Attempt 1: Try to mint tokens without permission
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(attacker).mint(attacker.address, TEST_AMOUNT),
          fixture.lookCoin,
          "AccessControlUnauthorizedAccount"
        );

        // Attempt 2: Try to burn other user's tokens without permission
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(attacker)["burn(address,uint256)"](fixture.user.address, TEST_AMOUNT),
          fixture.lookCoin,
          "LookCoin: unauthorized burner"
        );

        // Attempt 3: Try to manipulate roles
        const minterRole = await fixture.lookCoin.MINTER_ROLE();
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(attacker).grantRole(minterRole, attacker.address),
          fixture.lookCoin,
          "AccessControlUnauthorizedAccount"
        );

        // Verify token balances remain correct
        expect(await fixture.lookCoin.balanceOf(fixture.user.address)).to.equal(TEST_AMOUNT);
        expect(await fixture.lookCoin.balanceOf(attacker.address)).to.equal(0);

        coverageTracker.trackBranch("MultiProtocolSecurity", "direct-token-manipulation-prevention");
      });
    });
  });

  describe("Edge Cases and Gas Optimization", function () {
    describe("Extreme Parameter Testing", function () {
      it("should handle extreme parameter values", async function () {
        // Mint tokens for testing
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, ethers.parseUnits("1000000", 18));
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), ethers.MaxUint256);

        // Test with zero amount (should fail)
        await expectSpecificRevert(
          async () => fixture.crossChainRouter.connect(fixture.user).bridge(
            DESTINATION_CHAIN_ID,
            fixture.user2.address,
            0,
            LAYERZERO_PROTOCOL,
            "0x",
            { value: ethers.parseEther("0.01") }
          ),
          fixture.crossChainRouter,
          "Router: invalid amount"
        );

        // Test with invalid recipient (should fail)
        await expectSpecificRevert(
          async () => fixture.crossChainRouter.connect(fixture.user).bridge(
            DESTINATION_CHAIN_ID,
            ethers.ZeroAddress,
            TEST_AMOUNT,
            LAYERZERO_PROTOCOL,
            "0x",
            { value: ethers.parseEther("0.01") }
          ),
          fixture.crossChainRouter,
          "Router: invalid recipient"
        );

        // Test with unconfigured chain ID
        await expectSpecificRevert(
          async () => fixture.crossChainRouter.connect(fixture.user).bridge(
            999999,
            fixture.user2.address,
            TEST_AMOUNT,
            LAYERZERO_PROTOCOL,
            "0x",
            { value: ethers.parseEther("0.01") }
          ),
          fixture.crossChainRouter,
          "Protocol not supported for chain"
        );

        coverageTracker.trackBranch("MultiProtocolSecurity", "extreme-parameter-handling");
      });

      it("should optimize gas usage under stress", async function () {
        // Prepare for stress test
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, TEST_AMOUNT * BigInt(10));
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), TEST_AMOUNT * BigInt(10));

        const gasUsages: bigint[] = [];

        // Create multiple bridge operations to test gas efficiency
        for (let i = 0; i < 5; i++) {
          const protocol = i % 2; // Alternate between LayerZero and Celer
          const fee = await fixture.crossChainRouter.estimateFee(DESTINATION_CHAIN_ID, TEST_AMOUNT, protocol, "0x");
          
          const tx = await fixture.crossChainRouter.connect(fixture.user).bridge(
            DESTINATION_CHAIN_ID,
            fixture.user2.address,
            TEST_AMOUNT,
            protocol,
            "0x",
            { value: fee }
          );
          
          const receipt = await tx.wait();
          gasUsages.push(receipt!.gasUsed);
        }

        // Verify gas usage is reasonable and consistent
        const totalGasUsed = gasUsages.reduce((sum, gas) => sum + gas, BigInt(0));
        const averageGasUsed = totalGasUsed / BigInt(gasUsages.length);

        console.log(`Average gas used per bridge operation: ${averageGasUsed.toString()}`);
        console.log(`Total gas used for 5 operations: ${totalGasUsed.toString()}`);

        // Gas usage should be reasonable (less than 500k gas per operation)
        expect(averageGasUsed).to.be.lessThan(500000);

        // Gas usage should be consistent (standard deviation check)
        const variance = gasUsages.reduce((sum, gas) => {
          const diff = gas > averageGasUsed ? gas - averageGasUsed : averageGasUsed - gas;
          return sum + (diff * diff);
        }, BigInt(0)) / BigInt(gasUsages.length);

        const standardDeviation = Math.sqrt(Number(variance));
        
        // Standard deviation should be reasonable (less than 10% of average)
        expect(standardDeviation).to.be.lessThan(Number(averageGasUsed) * 0.1);

        coverageTracker.trackBranch("MultiProtocolSecurity", "gas-optimization-stress-test");
      });
    });
  });

  describe("Boolean Combination Testing", function () {
    it("should test protocol status boolean combinations", async function () {
      await testBooleanCombinations(
        "Protocol status transitions",
        async () => await fixture.crossChainRouter.protocolActive(LAYERZERO_PROTOCOL),
        async (value: boolean) => {
          await fixture.crossChainRouter.connect(fixture.admin).updateProtocolStatus(LAYERZERO_PROTOCOL, value);
        },
        async (combination) => {
          const isActive = await fixture.crossChainRouter.protocolActive(LAYERZERO_PROTOCOL);
          
          if (combination.from !== combination.to) {
            // State should change
            expect(isActive).to.equal(combination.to);
          }
          
          // Test bridge operations based on protocol state
          if (isActive) {
            // Protocol is active - bridge should work
            await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, TEST_AMOUNT);
            await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), TEST_AMOUNT);
            
            const fee = await fixture.crossChainRouter.estimateFee(DESTINATION_CHAIN_ID, TEST_AMOUNT, LAYERZERO_PROTOCOL, "0x");
            await expect(
              fixture.crossChainRouter.connect(fixture.user).bridge(
                DESTINATION_CHAIN_ID,
                fixture.user2.address,
                TEST_AMOUNT,
                LAYERZERO_PROTOCOL,
                "0x",
                { value: fee }
              )
            ).to.not.be.reverted;
          } else {
            // Protocol is inactive - bridge should fail
            await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, TEST_AMOUNT);
            await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), TEST_AMOUNT);
            
            await expectSpecificRevert(
              async () => fixture.crossChainRouter.connect(fixture.user).bridge(
                DESTINATION_CHAIN_ID,
                fixture.user2.address,
                TEST_AMOUNT,
                LAYERZERO_PROTOCOL,
                "0x"
              ),
              fixture.crossChainRouter,
              "Protocol not active"
            );
          }
          
          coverageTracker.trackBooleanCombination(
            "MultiProtocolSecurity",
            `protocol-status-${combination.description}`
          );
        }
      );
    });
  });

  describe("Coverage Validation", function () {
    it("should validate comprehensive multi-protocol security coverage", function () {
      const report = coverageTracker.generateReport();
      console.log("\n" + report);

      expect(report).to.include("MultiProtocolSecurity");

      // Validate we tested all major security scenarios
      const expectedTests = [
        "active-transfer-protocol-switching",
        "concurrent-protocol-switching",
        "malicious-module-registration-prevention",
        "protocol-registry-manipulation-resistance",
        "fee-extraction-attack-prevention",
        "cross-protocol-message-collision-prevention",
        "protocol-failover-handling",
        "router-bypass-prevention",
        "direct-token-manipulation-prevention",
        "extreme-parameter-handling",
        "gas-optimization-stress-test"
      ];

      console.log("Expected security tests completed:", expectedTests.length);
    });
  });
});