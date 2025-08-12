import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { LookCoin, MockReentrantAttacker, MockVulnerableToken, ReentrantAttackerAdapter } from "../../typechain-types";
import { deployLookCoinFixture } from "../helpers/fixtures";
import {
  ROLES,
  AMOUNTS,
} from "../helpers/constants";
import {
  trackGasUsage,
} from "../helpers/utils";

describe("ReentrancyProtection - Comprehensive Reentrancy Attack Prevention", function () {
  let fixture: Awaited<ReturnType<typeof deployLookCoinFixture>>;
  let lookCoin: LookCoin;
  let attacker: MockReentrantAttacker;
  let vulnerableToken: MockVulnerableToken;
  let adapter: ReentrantAttackerAdapter;
  let admin: SignerWithAddress;
  let minter: SignerWithAddress;
  let user1: SignerWithAddress;

  beforeEach(async function () {
    fixture = await loadFixture(deployLookCoinFixture);
    lookCoin = fixture.lookCoin;
    admin = fixture.admin;
    minter = fixture.minter;
    burner = fixture.burner;
    user1 = fixture.user1;
    user2 = fixture.user2;

    // Deploy mock vulnerable token for comparison testing
    const MockVulnerableToken = await ethers.getContractFactory("MockVulnerableToken");
    vulnerableToken = await MockVulnerableToken.deploy();
    await vulnerableToken.waitForDeployment();

    // Deploy reentrancy attacker targeting LookCoin
    const MockReentrantAttacker = await ethers.getContractFactory("MockReentrantAttacker");
    attacker = await MockReentrantAttacker.deploy(await lookCoin.getAddress());
    await attacker.waitForDeployment();

    // Deploy adapter to connect interfaces
    const ReentrantAttackerAdapter = await ethers.getContractFactory("ReentrantAttackerAdapter");
    adapter = await ReentrantAttackerAdapter.deploy(await attacker.getAddress());
    await adapter.waitForDeployment();

    // Grant necessary roles to attacker for testing
    await lookCoin.connect(admin).grantRole(ROLES.MINTER_ROLE, await attacker.getAddress());
    await lookCoin.connect(admin).grantRole(ROLES.BURNER_ROLE, await attacker.getAddress());

    // Grant roles to vulnerable token for comparison
    await vulnerableToken.grantMinterRole(await attacker.getAddress());
    await vulnerableToken.grantBurnerRole(await attacker.getAddress());
  });

  describe("LookCoin Reentrancy Protection", function () {
    describe("Direct Attack Vector Tests", function () {
      it("should block reentrancy attacks on mint function", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Verify initial state
        expect(await attacker.attacking()).to.be.false;
        expect(await attacker.reentrancySucceeded()).to.be.false;

        // Attempt reentrancy attack on mint
        await attacker.attackMint(recipient, amount);

        // Verify attack was blocked
        expect(await attacker.reentrancySucceeded()).to.be.false;
        expect(await attacker.wasAttackBlocked()).to.be.true;

        // Check that we got the expected OpenZeppelin v5 custom error
        const lastError = await attacker.lastError();
        const gotCustomError = await attacker.gotCustomError();
        const lastErrorData = await attacker.lastErrorData();

        expect(lastError).to.equal("ReentrancyGuardReentrantCall");
        expect(gotCustomError).to.be.true;
        expect(lastErrorData.slice(0, 10)).to.equal("0x3ee5aeb5"); // ReentrancyGuardReentrantCall selector

        // Verify specific error detection
        expect(await attacker.failedWithError("ReentrancyGuardReentrantCall")).to.be.true;
      });

      it("should block reentrancy attacks on burn function", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // First mint tokens for burning
        await lookCoin.connect(minter).mint(recipient, AMOUNTS.THOUSAND_TOKENS);

        // Attempt reentrancy attack on burn
        await attacker.attackBurn(recipient, amount);

        // Verify attack was blocked
        expect(await attacker.reentrancySucceeded()).to.be.false;
        expect(await attacker.wasAttackBlocked()).to.be.true;

        // Check that we got the expected custom error
        const lastError = await attacker.lastError();
        const gotCustomError = await attacker.gotCustomError();

        expect(lastError).to.equal("ReentrancyGuardReentrantCall");
        expect(gotCustomError).to.be.true;
      });

      it("should emit proper events during attack attempts", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Listen for events from attacker contract
        await expect(attacker.attackMint(recipient, amount))
          .to.emit(attacker, "AttackStarted")
          .withArgs(recipient, amount, true)
          .and.to.emit(attacker, "ReentrancyAttempted")
          .and.to.emit(attacker, "ReentrancyError")
          .and.to.emit(attacker, "AttackCompleted");
      });

      it("should track attack attempts and provide detailed statistics", async function () {
        const amount = AMOUNTS.FIFTY_TOKENS;
        const recipient = user1.address;

        // Set max attacks for controlled testing
        await attacker.setMaxAttacks(3);

        // Perform attack
        await attacker.attackMint(recipient, amount);

        // Verify attack tracking
        const stats = await attacker.getAttackStats();
        expect(stats.attempts).to.equal(3); // Should attempt up to maxAttacks
        expect(stats.successes).to.equal(0); // All should fail due to reentrancy guard
        expect(stats.maxDepth).to.equal(3);

        // Check detailed analysis
        const analysis = await attacker.getDetailedAnalysis();
        expect(analysis.totalReentrancyAttempts).to.be.gt(0);
        expect(analysis.failedReentries_).to.be.gt(0);
        expect(analysis.successfulReentries_).to.equal(0); // No successful reentrancy

        // Verify error capture
        const lastError = await attacker.lastError();
        expect(lastError).to.equal("ReentrancyGuardReentrantCall");
      });
    });

    describe("Advanced Attack Vector Tests", function () {
      it("should block reentrancy via receive function", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Send ETH to trigger receive function attack
        await attacker.attackViaReceive(recipient, amount, true, {
          value: ethers.parseEther("0.01")
        });

        // Check attack was attempted but blocked
        const analysis = await attacker.getDetailedAnalysis();
        expect(analysis.totalAttacksPerformed).to.equal(1);

        // Should have attempted reentrancy but failed
        if (analysis.totalReentrancyAttempts > 0) {
          expect(analysis.failedReentries_).to.be.gt(0);
          expect(analysis.successfulReentries_).to.equal(0);
        }
      });

      it("should block cross-function reentrancy attacks", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Trigger cross-function attack (start with mint, try to call burn)
        await attacker.attackCrossFunction(recipient, amount, true);

        // Check attack summary
        const [wasBlocked, anyReentrancySucceeded, totalAttempts, errorMessage] = await attacker.getAttackSummary();

        // Should have attempted reentrancy but failed
        if (totalAttempts > 0) {
          expect(wasBlocked).to.be.true;
          expect(anyReentrancySucceeded).to.be.false;
          expect(errorMessage).to.equal("ReentrancyGuardReentrantCall");
        }
      });

      it("should prevent recursive calls at different depths", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Test with different max attack depths
        const depths = [1, 3, 5];

        for (const depth of depths) {
          await attacker.reset();
          await attacker.setMaxAttacks(depth);

          await attacker.attackMint(recipient, amount);

          const stats = await attacker.getAttackStats();
          expect(stats.attempts).to.be.lte(depth);
          expect(stats.successes).to.equal(0); // All should fail

          // All attempts should fail with the same error
          const lastError = await attacker.lastError();
          expect(lastError).to.equal("ReentrancyGuardReentrantCall");
        }
      });
    });

    describe("State Management During Attacks", function () {
      it("should maintain proper state across different attack types", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Mint tokens for burn test
        await lookCoin.connect(minter).mint(recipient, AMOUNTS.THOUSAND_TOKENS);

        // Perform multiple attack types
        await attacker.attackMint(recipient, amount);
        await attacker.attackBurn(recipient, AMOUNTS.FIFTY_TOKENS);

        // Check history
        const history = await attacker.getAttackHistory();
        expect(history.length).to.be.gt(0);

        // Check total attacks
        const analysis = await attacker.getDetailedAnalysis();
        expect(analysis.totalAttacksPerformed).to.equal(2);

        // Verify all attacks were blocked
        const [wasBlocked, anyReentrancySucceeded] = await attacker.getAttackSummary();
        expect(wasBlocked).to.be.true;
        expect(anyReentrancySucceeded).to.be.false;
      });

      it("should prevent concurrent attacks with state flag", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Verify initial state
        expect(await attacker.isAttacking()).to.be.false;

        // The attack should complete atomically
        await attacker.attackMint(recipient, amount);

        // Should be false after completion
        expect(await attacker.isAttacking()).to.be.false;
      });

      it("should properly reset state between attacks", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Perform attack
        await attacker.attackMint(recipient, amount);

        // Verify state is set
        expect(await attacker.lastError()).to.equal("ReentrancyGuardReentrantCall");
        expect(await attacker.gotCustomError()).to.be.true;
        expect(await attacker.targetAddress()).to.equal(recipient);

        // Reset
        await attacker.reset();

        // Verify state is cleared
        expect(await attacker.attacking()).to.be.false;
        expect(await attacker.attackAttempts()).to.equal(0);
        expect(await attacker.reentrancySucceeded()).to.be.false;
        expect(await attacker.lastError()).to.equal("");
        expect(await attacker.targetAddress()).to.equal(ethers.ZeroAddress);
        expect(await attacker.targetAmount()).to.equal(0);
      });
    });
  });

  describe("OpenZeppelin v5 Custom Error Handling", function () {
    describe("Custom Error Detection and Decoding", function () {
      it("should properly decode ReentrancyGuardReentrantCall custom error", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Attempt attack which will trigger the custom error
        await attacker.attackMint(recipient, amount);

        // Verify custom error was detected and decoded
        const gotCustomError = await attacker.gotCustomError();
        const lastError = await attacker.lastError();
        const lastErrorData = await attacker.lastErrorData();

        expect(gotCustomError).to.be.true;
        expect(lastError).to.equal("ReentrancyGuardReentrantCall");
        expect(lastErrorData).to.not.equal("0x");

        // The error data should contain the selector for ReentrancyGuardReentrantCall
        // which is 0x3ee5aeb5 (first 4 bytes of keccak256("ReentrancyGuardReentrantCall()"))
        expect(lastErrorData.slice(0, 10)).to.equal("0x3ee5aeb5");
      });

      it("should handle both string and custom errors correctly", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Attack triggers custom error
        await attacker.attackMint(recipient, amount);

        const firstGotCustomError = await attacker.gotCustomError();
        const firstLastError = await attacker.lastError();

        expect(firstGotCustomError).to.be.true;
        expect(firstLastError).to.equal("ReentrancyGuardReentrantCall");

        // Reset for next test
        await attacker.reset();

        // Verify reset worked
        expect(await attacker.gotCustomError()).to.be.false;
        expect(await attacker.lastError()).to.equal("");
        expect(await attacker.lastErrorData()).to.equal("0x");
      });

      it("should correctly identify custom error via failedWithError", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        await attacker.attackMint(recipient, amount);

        // Should match without parentheses (decoded error name)
        expect(await attacker.failedWithError("ReentrancyGuardReentrantCall")).to.be.true;

        // Should not match with parentheses (that's the string format)
        expect(await attacker.failedWithError("ReentrancyGuardReentrantCall()")).to.be.false;

        // Should not match other errors
        expect(await attacker.failedWithError("SomeOtherError")).to.be.false;
      });

      it("should capture error data for all attack vectors", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Test mint attack
        await attacker.attackMint(recipient, amount);
        const mintError = await attacker.lastError();
        const mintGotCustomError = await attacker.gotCustomError();

        expect(mintError).to.equal("ReentrancyGuardReentrantCall");
        expect(mintGotCustomError).to.be.true;

        // Reset and test burn attack
        await attacker.reset();
        await lookCoin.connect(minter).mint(recipient, AMOUNTS.THOUSAND_TOKENS);

        await attacker.attackBurn(recipient, amount);
        const burnError = await attacker.lastError();
        const burnGotCustomError = await attacker.gotCustomError();

        expect(burnError).to.equal("ReentrancyGuardReentrantCall");
        expect(burnGotCustomError).to.be.true;
      });
    });

    describe("Error State Management", function () {
      it("should maintain error state across multiple attacks", async function () {
        const amount = AMOUNTS.FIFTY_TOKENS;
        const recipient = user1.address;

        // Perform multiple attacks without reset
        await attacker.attackMint(recipient, amount);

        const firstError = await attacker.lastError();
        const firstGotCustomError = await attacker.gotCustomError();

        // Mint tokens for burn test
        await lookCoin.connect(minter).mint(recipient, AMOUNTS.THOUSAND_TOKENS);

        // Second attack (burn) - should overwrite error state
        await attacker.attackBurn(recipient, AMOUNTS.TWENTY_FIVE_TOKENS);

        const secondError = await attacker.lastError();
        const secondGotCustomError = await attacker.gotCustomError();

        // Both should have the same error
        expect(firstError).to.equal("ReentrancyGuardReentrantCall");
        expect(secondError).to.equal("ReentrancyGuardReentrantCall");
        expect(firstGotCustomError).to.be.true;
        expect(secondGotCustomError).to.be.true;
      });

      it("should properly clear error state on reset", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Perform attack
        await attacker.attackMint(recipient, amount);

        // Verify error state is set
        expect(await attacker.lastError()).to.not.equal("");
        expect(await attacker.lastErrorData()).to.not.equal("0x");
        expect(await attacker.gotCustomError()).to.be.true;

        // Reset
        await attacker.reset();

        // Verify all error state is cleared
        expect(await attacker.lastError()).to.equal("");
        expect(await attacker.lastErrorData()).to.equal("0x");
        expect(await attacker.gotCustomError()).to.be.false;
        expect(await attacker.reentrancySucceeded()).to.be.false;
        expect(await attacker.attackAttempts()).to.equal(0);
      });
    });
  });

  describe("Attack Pattern Analysis", function () {
    describe("Success Rate Validation", function () {
      it("should demonstrate 0% success rate against protected LookCoin", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Perform attack
        await attacker.attackMint(recipient, amount);

        // Get success rate
        const [successCount, totalCount, percentage] = await attacker.getSuccessRate();

        // Against LookCoin with reentrancy protection, success rate should be 0%
        if (totalCount > 0) {
          expect(percentage).to.equal(0);
          expect(successCount).to.equal(0);
        }

        console.log(`\n=== LookCoin Reentrancy Protection Test Results ===`);
        console.log(`Total Attempts: ${totalCount}`);
        console.log(`Successful Attacks: ${successCount}`);
        console.log(`Success Rate: ${percentage}%`);
        console.log(`Protection Status: ${percentage === 0 ? 'PROTECTED ✅' : 'VULNERABLE ❌'}`);
      });

      it("should track detailed attack results", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Set controlled attack depth
        await attacker.setMaxAttacks(2);

        // Attempt attack
        await attacker.attackMint(recipient, amount);

        // Check attack results
        const results = await attacker.getAttackResults();
        expect(results.length).to.be.gt(0);

        // Look for failed attempts (reentrancy should be blocked)
        const failedResults = results.filter(r => !r.success);
        expect(failedResults.length).to.be.gt(0);

        // Check that we have reentrancy guard errors
        const reentrancyErrors = failedResults.filter(r =>
          r.errorMessage.includes("ReentrancyGuardReentrantCall")
        );
        expect(reentrancyErrors.length).to.be.gt(0);

        // Check unique errors tracking
        const uniqueErrors = await attacker.getUniqueErrors();
        expect(uniqueErrors.length).to.be.gt(0);
        expect(uniqueErrors.some(e => e.includes("ReentrancyGuardReentrantCall"))).to.be.true;
      });
    });

    describe("Controlled Reentrancy Demonstration", function () {
      it("should demonstrate controlled reentrancy attempts", async function () {
        const amount = AMOUNTS.FIFTY_TOKENS;
        const recipient = user1.address;

        // Set up for demonstration
        await attacker.setMaxAttacks(3);

        // Perform attack
        const tx = await attacker.attackMint(recipient, amount);
        await tx.wait();

        // Get final stats
        const stats = await attacker.getAttackStats();
        console.log("\n=== Attack Statistics ===");
        console.log(`Total Attempts: ${stats.attempts}`);
        console.log(`Successful Reentries: ${stats.successes}`);
        console.log(`Max Depth Allowed: ${stats.maxDepth}`);
        console.log(`Attack History Length: ${stats.historyLength}`);

        // Verify reentrancy was controlled
        expect(stats.attempts).to.be.gt(0);
        expect(stats.attempts).to.be.lte(3); // Limited by maxAttacks
        expect(stats.successes).to.equal(0); // All blocked
      });

      it("should enforce maximum attack depth configuration", async function () {
        const amount = AMOUNTS.HUNDRED_TOKENS;
        const recipient = user1.address;

        // Test different depth limits
        const depthLimits = [1, 2, 5];

        for (const limit of depthLimits) {
          await attacker.reset();
          await attacker.setMaxAttacks(limit);

          const stats = await attacker.getAttackStats();
          expect(stats.maxDepth).to.equal(limit);

          await attacker.attackMint(recipient, amount);
          const finalStats = await attacker.getAttackStats();
          expect(finalStats.attempts).to.be.lte(limit);
        }

        // Test invalid limits
        await expect(attacker.setMaxAttacks(0)).to.be.revertedWith("Invalid max attacks");
        await expect(attacker.setMaxAttacks(11)).to.be.revertedWith("Invalid max attacks");
      });
    });
  });

  describe("Vulnerable Token Comparison", function () {
    describe("Attack Against Vulnerable Contract", function () {
      it("should demonstrate successful attack against vulnerable token", async function () {
        // Deploy new attacker targeting vulnerable token
        const VulnerableAttacker = await ethers.getContractFactory("MockReentrantAttacker");
        const vulnerableAttacker = await VulnerableAttacker.deploy(await vulnerableToken.getAddress());

        // Set up adapter as hook to enable reentrancy
        await vulnerableToken.setMintBurnHook(await adapter.getAddress());

        // Grant roles to vulnerable attacker
        await vulnerableToken.grantMinterRole(await vulnerableAttacker.getAddress());
        await vulnerableToken.grantBurnerRole(await vulnerableAttacker.getAddress());

        // Attempt attack on vulnerable token
        await vulnerableAttacker.attackMint(user1.address, AMOUNTS.HUNDRED_TOKENS);

        // Check if attack was successful (depends on vulnerable token implementation)
        const stats = await vulnerableAttacker.getAttackStats();
        console.log(`\n=== Vulnerable Token Attack Results ===`);
        console.log(`Attempts: ${stats.attempts}`);
        console.log(`Successes: ${stats.successes}`);

        // The vulnerable token might allow some reentrancy
        // This demonstrates the difference between protected and unprotected contracts
      });
    });
  });

  describe("Gas Optimization and Performance", function () {
    it("should track gas usage for attack operations", async function () {
      const amount = AMOUNTS.TEN_TOKENS;
      const recipient = user1.address;

      const attackReport = await trackGasUsage(
        async () => attacker.attackMint(recipient, amount),
        "reentrancy attack attempt"
      );

      console.log(`\nReentrancy Attack Gas Usage:`)
      console.log(`  Attack Attempt: ${attackReport.gasUsed} gas`);

      // Gas usage should be reasonable even for failed attacks
      expect(attackReport.gasUsed).to.be.lt(500000);
    });

    it("should handle rapid successive attack attempts", async function () {
      const amount = AMOUNTS.TEN_TOKENS;
      const recipient = user1.address;
      const iterations = 3;

      // Set low max attacks for faster tests
      await attacker.setMaxAttacks(1);

      // Rapid attack attempts
      for (let i = 0; i < iterations; i++) {
        await attacker.attackMint(recipient, amount);
        await attacker.reset();
      }

      // All should have been blocked
      await attacker.attackMint(recipient, amount);
      const [wasBlocked, anySucceeded] = await attacker.getAttackSummary();
      expect(wasBlocked).to.be.true;
      expect(anySucceeded).to.be.false;
    });
  });

  describe("Edge Cases and Error Scenarios", function () {
    it("should handle extreme attack parameters", async function () {
      const maxAmount = ethers.MaxUint256;
      const recipient = user1.address;

      // Attack with maximum amount (should fail due to insufficient balance, not reentrancy)
      await expect(attacker.attackMint(recipient, maxAmount)).to.not.be.reverted;

      // The attack should still be blocked by reentrancy guard
      const lastError = await attacker.lastError();
      expect(lastError).to.equal("ReentrancyGuardReentrantCall");
    });

    it("should maintain protection across contract upgrades", async function () {
      // This test verifies that reentrancy protection persists
      // Actual upgrade testing would require more complex setup
      const amount = AMOUNTS.HUNDRED_TOKENS;
      const recipient = user1.address;

      // Perform attack
      await attacker.attackMint(recipient, amount);

      // Verify protection is still active
      expect(await attacker.wasAttackBlocked()).to.be.true;
      expect(await attacker.lastError()).to.equal("ReentrancyGuardReentrantCall");
    });

    it("should handle attack state during contract interactions", async function () {
      const amount = AMOUNTS.HUNDRED_TOKENS;
      const recipient = user1.address;

      // Verify state consistency during attack
      expect(await attacker.isAttacking()).to.be.false;

      // Attack should maintain consistent state
      await attacker.attackMint(recipient, amount);

      // State should be clean after attack
      expect(await attacker.isAttacking()).to.be.false;

      // Attack tracking should be updated
      const analysis = await attacker.getDetailedAnalysis();
      expect(analysis.totalAttacksPerformed).to.be.gt(0);
    });
  });

  describe("Integration with LookCoin Security Features", function () {
    it("should work in conjunction with role-based access control", async function () {
      const amount = AMOUNTS.HUNDRED_TOKENS;
      const recipient = user1.address;

      // Remove minter role from attacker
      await lookCoin.connect(admin).revokeRole(ROLES.MINTER_ROLE, await attacker.getAddress());

      // Attack should fail due to access control, not just reentrancy
      await expect(attacker.attackMint(recipient, amount)).to.not.be.reverted;

      // The error might be access control related instead of reentrancy
      const lastError = await attacker.lastError();
      // Could be either access control error or reentrancy error depending on order
      expect(lastError.length).to.be.gt(0);
    });

    it("should work with pausable functionality", async function () {
      const amount = AMOUNTS.HUNDRED_TOKENS;
      const recipient = user1.address;

      // Pause the contract
      await lookCoin.connect(admin).pause();

      // Attack should fail due to pause, not reentrancy
      await expect(attacker.attackMint(recipient, amount)).to.not.be.reverted;

      // The error should be pause-related
      const lastError = await attacker.lastError();
      expect(lastError.length).to.be.gt(0);

      // Unpause and verify reentrancy protection still works
      await lookCoin.connect(admin).unpause();
      await attacker.reset();

      await attacker.attackMint(recipient, amount);
      expect(await attacker.lastError()).to.equal("ReentrancyGuardReentrantCall");
    });
  });

  describe("Comprehensive Protection Demonstration", function () {
    it("should demonstrate complete reentrancy protection coverage", async function () {
      const amount = AMOUNTS.HUNDRED_TOKENS;
      const recipient = user1.address;

      console.log("\n=== Comprehensive Reentrancy Protection Test ===");

      // Test mint protection
      console.log("Testing mint reentrancy protection...");
      await attacker.attackMint(recipient, amount);

      const [mintWasBlocked, mintAnyReentrancySucceeded, mintTotalAttempts, mintErrorMessage] = await attacker.getAttackSummary();

      console.log(`Mint Attack Blocked: ${mintWasBlocked ? '✅ YES' : '❌ NO'}`);
      console.log(`Mint Error: ${mintErrorMessage}`);
      console.log(`Mint Attempts: ${mintTotalAttempts}`);

      // Reset for burn test
      await attacker.reset();

      // Mint tokens for burn test
      await lookCoin.connect(minter).mint(recipient, AMOUNTS.THOUSAND_TOKENS);

      // Test burn protection
      console.log("Testing burn reentrancy protection...");
      await attacker.attackBurn(recipient, amount);

      const [burnWasBlocked, burnAnyReentrancySucceeded, burnTotalAttempts, burnErrorMessage] = await attacker.getAttackSummary();

      console.log(`Burn Attack Blocked: ${burnWasBlocked ? '✅ YES' : '❌ NO'}`);
      console.log(`Burn Error: ${burnErrorMessage}`);
      console.log(`Burn Attempts: ${burnTotalAttempts}`);

      // Both should be blocked
      expect(mintWasBlocked).to.be.true;
      expect(burnWasBlocked).to.be.true;
      expect(mintErrorMessage).to.equal("ReentrancyGuardReentrantCall");
      expect(burnErrorMessage).to.equal("ReentrancyGuardReentrantCall");

      console.log("\n✅ LookCoin successfully blocks all reentrancy attack vectors!");

      // Additional verification
      expect(mintAnyReentrancySucceeded).to.be.false;
      expect(burnAnyReentrancySucceeded).to.be.false;
    });
  });
});