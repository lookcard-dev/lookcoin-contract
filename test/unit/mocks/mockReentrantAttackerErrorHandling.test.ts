import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployLookCoinFixture } from "../../utils/comprehensiveTestHelpers";

describe("MockReentrantAttacker - Error Handling", function () {
  async function deployFixture() {
    // Use the existing LookCoin deployment fixture
    const baseFixture = await deployLookCoinFixture();
    
    // Deploy the attacker
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
      user: baseFixture.user
    };
  }
  
  describe("Custom Error Handling", function () {
    it("should properly decode ReentrancyGuardReentrantCall custom error", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // Attempt attack which will trigger the custom error
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      
      // Verify custom error was detected
      const gotCustomError = await attacker.gotCustomError();
      expect(gotCustomError).to.be.true;
      
      // Verify error was properly decoded
      const lastError = await attacker.lastError();
      expect(lastError).to.equal("ReentrancyGuardReentrantCall");
      
      // Verify error data was captured
      const lastErrorData = await attacker.lastErrorData();
      expect(lastErrorData).to.not.equal("0x");
      
      // The error data should contain the selector for ReentrancyGuardReentrantCall
      // which is 0x3ee5aeb5 (first 4 bytes of keccak256("ReentrancyGuardReentrantCall()"))
      expect(lastErrorData.slice(0, 10)).to.equal("0x3ee5aeb5");
    });
    
    it("should handle both string and custom errors correctly", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // First attack - triggers custom error
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      
      const firstGotCustomError = await attacker.gotCustomError();
      const firstLastError = await attacker.lastError();
      
      expect(firstGotCustomError).to.be.true;
      expect(firstLastError).to.equal("ReentrancyGuardReentrantCall");
      
      // Reset for next test
      await attacker.reset();
      
      // Verify reset worked
      const resetGotCustomError = await attacker.gotCustomError();
      const resetLastError = await attacker.lastError();
      const resetLastErrorData = await attacker.lastErrorData();
      
      expect(resetGotCustomError).to.be.false;
      expect(resetLastError).to.equal("");
      expect(resetLastErrorData).to.equal("0x");
    });
    
    it("should correctly identify custom error via failedWithError", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      
      // Should match without parentheses (decoded error name)
      expect(await attacker.failedWithError("ReentrancyGuardReentrantCall")).to.be.true;
      
      // Should not match with parentheses (that's the string format)
      expect(await attacker.failedWithError("ReentrancyGuardReentrantCall()")).to.be.false;
      
      // Should not match other errors
      expect(await attacker.failedWithError("SomeOtherError")).to.be.false;
    });
    
    it("should capture error data for all attack vectors", async function () {
      const { lookCoin, attacker, minter, user } = await loadFixture(deployFixture);
      
      // Test mint attack
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      const mintError = await attacker.lastError();
      const mintGotCustomError = await attacker.gotCustomError();
      
      expect(mintError).to.equal("ReentrancyGuardReentrantCall");
      expect(mintGotCustomError).to.be.true;
      
      // Reset and test burn attack
      await attacker.reset();
      await lookCoin.connect(minter).mint(user.address, ethers.parseEther("1000"));
      
      await attacker.attackBurn(user.address, ethers.parseEther("100"));
      const burnError = await attacker.lastError();
      const burnGotCustomError = await attacker.gotCustomError();
      
      expect(burnError).to.equal("ReentrancyGuardReentrantCall");
      expect(burnGotCustomError).to.be.true;
    });
    
    it("should demonstrate compatibility with OpenZeppelin v5 custom errors", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      console.log("\n=== OpenZeppelin v5 Custom Error Handling Demo ===");
      
      // Perform attack
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      
      // Get all error information
      const lastError = await attacker.lastError();
      const lastErrorData = await attacker.lastErrorData();
      const gotCustomError = await attacker.gotCustomError();
      const attackBlocked = await attacker.wasAttackBlocked();
      
      console.log(`Attack Blocked: ${attackBlocked ? '✅ YES' : '❌ NO'}`);
      console.log(`Error Type: ${gotCustomError ? 'Custom Error' : 'String Error'}`);
      console.log(`Error Name: ${lastError}`);
      console.log(`Error Data: ${lastErrorData}`);
      console.log(`Error Selector: ${lastErrorData.slice(0, 10)}`);
      
      // Verify OpenZeppelin v5 error format
      expect(gotCustomError).to.be.true;
      expect(lastError).to.equal("ReentrancyGuardReentrantCall");
      expect(lastErrorData.slice(0, 10)).to.equal("0x3ee5aeb5"); // ReentrancyGuardReentrantCall selector
      
      console.log("\n✅ Successfully handles OpenZeppelin v5 custom errors!");
    });
  });
  
  describe("Error State Management", function () {
    it("should maintain error state across multiple attacks", async function () {
      const { lookCoin, attacker, minter, user } = await loadFixture(deployFixture);
      
      // Perform multiple attacks without reset
      await attacker.attackMint(user.address, ethers.parseEther("50"));
      
      const firstError = await attacker.lastError();
      const firstGotCustomError = await attacker.gotCustomError();
      
      // Mint tokens for burn test
      await lookCoin.connect(minter).mint(user.address, ethers.parseEther("1000"));
      
      // Second attack (burn) - should overwrite error state
      await attacker.attackBurn(user.address, ethers.parseEther("25"));
      
      const secondError = await attacker.lastError();
      const secondGotCustomError = await attacker.gotCustomError();
      
      // Both should have the same error
      expect(firstError).to.equal("ReentrancyGuardReentrantCall");
      expect(secondError).to.equal("ReentrancyGuardReentrantCall");
      expect(firstGotCustomError).to.be.true;
      expect(secondGotCustomError).to.be.true;
    });
    
    it("should properly clear error state on reset", async function () {
      const { attacker, user } = await loadFixture(deployFixture);
      
      // Perform attack
      await attacker.attackMint(user.address, ethers.parseEther("100"));
      
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