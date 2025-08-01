import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployLookCoinFixture } from "../../utils/comprehensiveTestHelpers";

describe("MockReentrantAttacker - Simplified", function () {
  async function deployFixture() {
    // Use the existing LookCoin deployment fixture
    const baseFixture = await deployLookCoinFixture();
    
    // Deploy the simplified attacker
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
      minter: baseFixture.minter, 
      user: baseFixture.user
    };
  }
  
  describe("Core Attack Functionality", function () {
    it("should attempt reentrancy on mint and be blocked", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // Verify initial state
      expect(await attacker.attacking()).to.be.false;
      expect(await attacker.reentrancySucceeded()).to.be.false;
      
      // Attempt reentrancy attack on mint
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      
      // Verify attack was blocked
      expect(await attacker.reentrancySucceeded()).to.be.false;
      expect(await attacker.wasAttackBlocked()).to.be.true;
      
      // Check that we got the expected reentrancy error
      const lastError = await attacker.lastError();
      const gotCustomError = await attacker.gotCustomError();
      
      // The error should be decoded as a custom error
      expect(lastError).to.equal("ReentrancyGuardReentrantCall");
      expect(gotCustomError).to.be.true;
      
      // Verify specific error check  
      expect(await attacker.failedWithError("ReentrancyGuardReentrantCall")).to.be.true;
    });
    
    it("should attempt reentrancy on burn and be blocked", async function () {
      const { lookCoin, attacker, minter, user } = await loadFixture(deployFixture);
      
      // First mint some tokens for burning
      await lookCoin.connect(minter).mint(user.address, ethers.parseEther("1000"));
      
      // Attempt reentrancy attack on burn
      await attacker.attackBurn(user.address, ethers.parseEther("100"));
      
      // Verify attack was blocked
      expect(await attacker.reentrancySucceeded()).to.be.false;
      expect(await attacker.wasAttackBlocked()).to.be.true;
      
      // Check that we got the expected reentrancy error
      const lastError = await attacker.lastError();
      const gotCustomError = await attacker.gotCustomError();
      
      // The error should be decoded as a custom error
      expect(lastError).to.equal("ReentrancyGuardReentrantCall");
      expect(gotCustomError).to.be.true;
    });
    
    it("should emit proper events during attack", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // Listen for events
      await expect(attacker.attackMint(user.address, ethers.parseEther("100")))
        .to.emit(attacker, "AttackLaunched")
        .and.to.emit(attacker, "ReentrancyAttempted")
        .and.to.emit(attacker, "AttackCompleted")
        .withArgs(false, 2); // Attack should not succeed, 2 attempts made
    });
    
    it("should track attack state correctly", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // Check initial state
      expect(await attacker.attacking()).to.be.false;
      expect(await attacker.attackAttempts()).to.equal(0);
      
      // Perform attack
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      
      // Check final state
      expect(await attacker.attacking()).to.be.false; // Should be false after completion
      expect(await attacker.targetAddress()).to.equal(user.address);
      expect(await attacker.targetAmount()).to.equal(ethers.parseEther("100"));
      expect(await attacker.isMintAttack()).to.be.true;
    });
    
    it("should allow setting max attacks", async function () {
      const { attacker } = await loadFixture(deployFixture);
      
      // Set max depth
      await attacker.setMaxDepth(5);
      expect(await attacker.maxDepth()).to.equal(5);
      
      // Try invalid values
      await expect(attacker.setMaxDepth(0)).to.be.revertedWith("Invalid depth");
      await expect(attacker.setMaxDepth(6)).to.be.revertedWith("Invalid depth");
    });
    
    it("should prevent concurrent attacks", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // This would require a more complex setup to test truly concurrent attacks
      // For now, just verify the attacking flag works
      expect(await attacker.attacking()).to.be.false;
      
      // After attack completes, should be false
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      expect(await attacker.attacking()).to.be.false;
    });
    
    it("should allow resetting state", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // Perform attack
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      
      // Verify state is set  
      expect(await attacker.lastError()).to.equal("ReentrancyGuardReentrantCall");
      expect(await attacker.gotCustomError()).to.be.true;
      expect(await attacker.targetAddress()).to.equal(user.address);
      
      // Reset
      await attacker.reset();
      
      // Verify state is cleared
      expect(await attacker.attacking()).to.be.false;
      expect(await attacker.attackAttempts()).to.equal(0);
      expect(await attacker.reentrancySucceeded()).to.be.false;
      expect(await attacker.lastError()).to.equal("");
      expect(await attacker.targetAddress()).to.equal(ethers.ZeroAddress);
      expect(await attacker.targetAmount()).to.equal(0);
      expect(await attacker.isMintAttack()).to.be.false;
    });
  });
  
  describe("Reentrancy Protection Demonstration", function () {
    it("should demonstrate LookCoin's reentrancy protection works", async function () {
      const { lookCoin, attacker, minter, user } = await loadFixture(deployFixture);
      
      console.log("\\n=== LookCoin Reentrancy Protection Test ===");
      
      // Test mint protection
      console.log("Testing mint reentrancy protection...");
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      
      const [mintWasBlocked, mintAnyReentrancySucceeded, mintTotalAttempts, mintErrorMessage] = await attacker.getAttackSummary();
      
      console.log(`Mint Attack Blocked: ${mintWasBlocked ? '✅ YES' : '❌ NO'}`);
      console.log(`Mint Error: ${mintErrorMessage}`);
      console.log(`Mint Attempts: ${mintTotalAttempts}`);
      
      // Reset for burn test
      await attacker.reset();
      
      // Mint tokens for burn test
      await lookCoin.connect(minter).mint(user.address, ethers.parseEther("1000"));
      
      // Test burn protection
      console.log("Testing burn reentrancy protection...");
      await attacker.attackBurn(user.address, ethers.parseEther("100"));
      
      const [burnWasBlocked, burnAnyReentrancySucceeded, burnTotalAttempts, burnErrorMessage] = await attacker.getAttackSummary();
      
      console.log(`Burn Attack Blocked: ${burnWasBlocked ? '✅ YES' : '❌ NO'}`);
      console.log(`Burn Error: ${burnErrorMessage}`);
      console.log(`Burn Attempts: ${burnTotalAttempts}`);
      
      // Both should be blocked
      expect(mintWasBlocked).to.be.true;
      expect(burnWasBlocked).to.be.true;
      expect(mintErrorMessage).to.equal("ReentrancyGuardReentrantCall");
      expect(burnErrorMessage).to.equal("ReentrancyGuardReentrantCall");
      
      console.log("\\n✅ LookCoin successfully blocks reentrancy attacks!");
    });
  });
});