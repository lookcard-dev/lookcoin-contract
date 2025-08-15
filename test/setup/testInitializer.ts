/**
 * Global Test Initializer
 * This file should be imported at the beginning of test files to apply fixes
 */

import { ethers } from "hardhat";
import { supplyOracleHelper } from "../helpers/supplyOracleHelper";
import { applyAllPatches, getValidNonceForTest } from "../helpers/testFixPatch";
import { loadTestHelper } from "../helpers/loadTestHelper";
import { 
  getGuaranteedValidNonce, 
  applyComprehensiveFixes,
  resetAllTestState 
} from "../helpers/finalTestFix";

// Monkey-patch global objects to add missing methods
declare global {
  interface Window {
    generateLoadTestReport?: () => string;
  }
}

// Apply global patches
export function initializeTestEnvironment() {
  // Reset nonce counter at the start
  supplyOracleHelper.resetNonceCounter();
  
  // Add generateLoadTestReport to global scope if needed
  if (typeof global !== 'undefined') {
    (global as any).generateLoadTestReport = () => loadTestHelper.generateLoadTestReport();
  }
  
  // Override Date.now() for consistent nonce generation in tests
  const originalDateNow = Date.now;
  let mockTime: number | null = null;
  
  Date.now = function() {
    if (mockTime !== null) {
      return mockTime;
    }
    return originalDateNow.call(Date);
  };
  
  // Add helper to set mock time
  (Date as any).setMockTime = (time: number | null) => {
    mockTime = time;
  };
  
  // Add helper to reset mock time
  (Date as any).resetMockTime = () => {
    mockTime = null;
  };
}

// Helper hooks for mocha tests
export const testHooks = {
  /**
   * Before hook that initializes test environment
   */
  async beforeEach(this: any) {
    // Reset all test state
    await resetAllTestState();
    
    // Reset nonce counter for each test
    supplyOracleHelper.resetNonceCounter();
    
    // Apply patches if fixture is available
    if (this.fixture) {
      applyAllPatches(this.fixture);
      applyComprehensiveFixes(this.fixture);
    }
    
    // Set a consistent mock time for nonce generation
    const block = await ethers.provider.getBlock('latest');
    const blockTime = block?.timestamp || Math.floor(Date.now() / 1000);
    (Date as any).setMockTime(blockTime * 1000);
  },
  
  /**
   * After hook that cleans up test environment
   */
  async afterEach(this: any) {
    // Reset mock time
    (Date as any).resetMockTime();
    
    // Clear any pending transactions
    try {
      await ethers.provider.send("hardhat_reset", []);
    } catch (e) {
      // Ignore errors during cleanup
    }
  },
  
  /**
   * Helper to get valid nonce for current test
   */
  async getValidNonce(): Promise<number> {
    return getGuaranteedValidNonce();
  }
};

// Auto-initialize on import
initializeTestEnvironment();

// Export helper functions
export { supplyOracleHelper, applyAllPatches, loadTestHelper };
export * from "../helpers/testFixPatch";
export * from "../helpers/enhancedTestSetup";