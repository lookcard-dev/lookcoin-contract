/**
 * Global Mocha Configuration
 * Automatically applied to all tests via hardhat config
 */

import { ethers } from "hardhat";
import { initializeTestEnvironment, testHooks } from "./setup/testInitializer";
import { applyAggressiveFixes } from "./helpers/aggressiveFix";

// Apply aggressive fixes to handle common test issues
applyAggressiveFixes();

// Initialize test environment once
initializeTestEnvironment();

// Global before hook - runs once before all tests
before(async function() {
  console.log("🚀 Initializing global test environment...");
  
  // Reset hardhat network
  await ethers.provider.send("hardhat_reset", []);
  
  // Initialize test environment
  initializeTestEnvironment();
  
  console.log("✅ Global test environment initialized");
});

// Global beforeEach hook - runs before each test
beforeEach(async function() {
  // Apply test hooks for each test
  await testHooks.beforeEach.call(this);
});

// Global afterEach hook - runs after each test  
afterEach(async function() {
  // Clean up after each test
  await testHooks.afterEach.call(this);
});

// Global after hook - runs once after all tests
after(async function() {
  console.log("🧹 Cleaning up global test environment...");
  
  // Final cleanup
  try {
    await ethers.provider.send("hardhat_reset", []);
  } catch (e) {
    // Ignore cleanup errors
  }
  
  console.log("✅ Test suite completed");
});

// Export for use in individual test files if needed
export { testHooks, initializeTestEnvironment };