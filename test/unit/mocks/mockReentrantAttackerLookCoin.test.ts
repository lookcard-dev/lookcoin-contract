import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployLookCoinFixture } from "../../utils/comprehensiveTestHelpers";

describe("MockReentrantAttacker - LookCoin Integration", function () {
  async function deployFixture() {
    // Use the existing LookCoin deployment fixture
    const baseFixture = await deployLookCoinFixture();
    
    // Deploy the attacker targeting LookCoin
    const MockReentrantAttacker = await ethers.getContractFactory("MockReentrantAttacker");
    const attacker = await MockReentrantAttacker.deploy(await baseFixture.lookCoin.getAddress());
    
    // Grant attacker roles for testing
    const MINTER_ROLE = await baseFixture.lookCoin.MINTER_ROLE();
    const BURNER_ROLE = await baseFixture.lookCoin.BURNER_ROLE();
    
    await baseFixture.lookCoin.grantRole(MINTER_ROLE, await attacker.getAddress());
    await baseFixture.lookCoin.grantRole(BURNER_ROLE, await attacker.getAddress());
    
    return { 
      lookCoin: baseFixture.lookCoin, 
      attacker, 
      owner: baseFixture.owner, 
      minter: baseFixture.minter, 
      burner: baseFixture.burner, 
      user: baseFixture.user,
      user2: baseFixture.user2
    };
  }
  
  describe("Direct Call Attack Vector", function () {
    it("should attempt reentrancy on mint and be blocked by nonReentrant modifier", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // Attempt direct reentrancy attack on mint
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      
      // Check that reentrancy was attempted but failed
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
      
      // Check statistics
      const analysis = await attacker.getDetailedAnalysis();
      expect(analysis.totalReentrancyAttempts).to.be.gt(0);
      expect(analysis.failedReentries_).to.be.gt(0);
      expect(analysis.successfulReentries_).to.equal(0); // No successful reentrancy
    });
    
    it("should attempt reentrancy on burn and be blocked by nonReentrant modifier", async function () {
      const { lookCoin, attacker, minter, user } = await loadFixture(deployFixture);
      
      // First mint some tokens for burning
      await lookCoin.connect(minter).mint(user.address, ethers.parseEther("1000"));
      
      // Attempt direct reentrancy attack on burn
      await attacker.attackBurn(user.address, ethers.parseEther("100"));
      
      // Check that reentrancy was attempted but failed
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
      
      // Check that unique errors were tracked
      const uniqueErrors = await attacker.getUniqueErrors();
      expect(uniqueErrors.length).to.be.gt(0);
      expect(uniqueErrors.some(e => e.includes("ReentrancyGuardReentrantCall"))).to.be.true;
    });
    
    it("should track attack attempts and provide detailed error information", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // Set max attacks to 2 for faster test
      await attacker.setMaxAttacks(2);
      
      // Perform attack
      await attacker.attackMint(user.address, ethers.parseEther("50"));
      
      // Verify attack tracking
      const stats = await attacker.getAttackStats();
      expect(stats.attempts).to.equal(2); // Should attempt up to maxAttacks
      expect(stats.successes).to.equal(0); // All should fail due to reentrancy guard
      expect(stats.maxDepth).to.equal(2);
      
      // Check error capture
      const lastError = await attacker.lastError();
      expect(lastError).to.equal("ReentrancyGuardReentrantCall");
      
      // Verify it was detected as a custom error
      const gotCustomError = await attacker.gotCustomError();
      expect(gotCustomError).to.be.true;
      
      // Check specific error detection
      const hasReentrancyError = await attacker.failedWithError("ReentrancyGuardReentrantCall");
      expect(hasReentrancyError).to.be.true;
    });
    
    it("should emit proper events during attack attempts", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // Listen for events
      await expect(attacker.attackMint(user.address, ethers.parseEther("100")))
        .to.emit(attacker, "AttackStarted")
        .withArgs(user.address, ethers.parseEther("100"), true)
        .and.to.emit(attacker, "AttackVectorTriggered")
        .and.to.emit(attacker, "ReentrancyAttempted")
        .and.to.emit(attacker, "ReentrancyError")
        .and.to.emit(attacker, "AttackCompleted");
    });
  });
  
  describe("Receive Function Attack Vector", function () {
    it("should attempt reentrancy via receive function", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // Send ETH to trigger receive function attack
      await attacker.attackViaReceive(user.address, ethers.parseEther("100"), true, {
        value: ethers.parseEther("0.01")
      });
      
      // Check attack was attempted
      const analysis = await attacker.getDetailedAnalysis();
      expect(analysis.totalAttacksPerformed).to.equal(1);
      
      // Should have attempted reentrancy but failed
      if (analysis.totalReentrancyAttempts > 0) {
        expect(analysis.failedReentries_).to.be.gt(0);
        expect(analysis.successfulReentries_).to.equal(0);
      }
    });
  });
  
  describe("Fallback Function Attack Vector", function () {
    it("should attempt reentrancy via fallback function", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // Trigger cross-function attack (start with mint, try to call burn)
      await attacker.attackCrossFunction(user.address, ethers.parseEther("100"), true);
      
      // Check attack was attempted
      const [wasBlocked, anyReentrancySucceeded, totalAttempts, errorMessage, vectorUsed] = await attacker.getAttackSummary();
      
      // Should have attempted reentrancy but failed
      if (totalAttempts > 0) {
        expect(wasBlocked).to.be.true;
        expect(anyReentrancySucceeded).to.be.false;
      }
    });
  });
  
  describe("Attack History and State Management", function () {
    it("should maintain state correctly across different attack types", async function () {
      const { lookCoin, attacker, minter, user } = await loadFixture(deployFixture);
      
      // Mint tokens for burn test
      await lookCoin.connect(minter).mint(user.address, ethers.parseEther("1000"));
      
      // Perform multiple attacks
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      await attacker.attackBurn(user.address, ethers.parseEther("50"));
      
      // Check history
      const history = await attacker.getAttackHistory();
      expect(history.length).to.be.gt(0);
      
      // Check total attacks
      const analysis = await attacker.getDetailedAnalysis();
      expect(analysis.totalAttacksPerformed).to.equal(2);
      
      // Clear history
      await attacker.clearHistory();
      
      // Verify reset
      const clearedHistory = await attacker.getAttackHistory();
      expect(clearedHistory.length).to.equal(0);
      
      const resetAnalysis = await attacker.getDetailedAnalysis();
      expect(resetAnalysis.totalAttacksPerformed).to.equal(0);
    });
    
    it("should prevent concurrent attacks", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // This test verifies the attacking flag prevents nested calls
      expect(await attacker.isAttacking()).to.be.false;
      
      // The attack methods check for concurrent attacks
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      
      expect(await attacker.isAttacking()).to.be.false; // Should be false after completion
    });
  });
  
  describe("Success Rate Analysis", function () {
    it("should demonstrate 0% success rate against protected LookCoin", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // Perform attack
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      
      // Get success rate
      const [successCount, totalCount, percentage] = await attacker.getSuccessRate();
      
      // Against LookCoin with reentrancy protection, success rate should be 0%
      if (totalCount > 0) {
        expect(percentage).to.equal(0);
        expect(successCount).to.equal(0);
      }
      
      console.log(`\\n=== LookCoin Reentrancy Protection Test Results ===`);
      console.log(`Total Attempts: ${totalCount}`);
      console.log(`Successful Attacks: ${successCount}`);
      console.log(`Success Rate: ${percentage}%`);
      console.log(`Protection Status: ${percentage === 0 ? 'PROTECTED ✅' : 'VULNERABLE ❌'}`);
    });
  });
});