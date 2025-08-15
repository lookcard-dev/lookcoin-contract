import { ethers } from "hardhat";
import { SupplyOracle } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * SupplyOracle Test Helper
 * Provides utilities for managing nonces and multi-signature updates in tests
 */
export class SupplyOracleTestHelper {
  private static nonceCounter = 0;
  private static lastBlockTimestamp = 0;

  /**
   * Reset nonce counter for a fresh test run
   */
  static resetNonceCounter(): void {
    // Use a base timestamp that's always valid
    const currentTime = Math.floor(Date.now() / 1000);
    this.nonceCounter = currentTime;
    this.lastBlockTimestamp = currentTime;
  }

  /**
   * Get next valid nonce for supply oracle updates
   * Ensures nonce is within valid time window
   */
  static async getValidNonce(): Promise<number> {
    // Get current block timestamp
    const block = await ethers.provider.getBlock('latest');
    const blockTimestamp = block?.timestamp || Math.floor(Date.now() / 1000);
    
    // Ensure nonce is fresh and incrementing
    const minNonce = blockTimestamp - 3500; // Within validity period (1 hour - buffer)
    const nextNonce = Math.max(this.nonceCounter + 1, minNonce);
    
    this.nonceCounter = nextNonce;
    this.lastBlockTimestamp = blockTimestamp;
    
    return nextNonce;
  }

  /**
   * Execute multi-signature supply update
   */
  static async executeMultiSigUpdate(
    supplyOracle: SupplyOracle,
    chainId: number,
    totalSupply: bigint,
    lockedSupply: bigint,
    signers: SignerWithAddress[]
  ): Promise<void> {
    const nonce = await this.getValidNonce();
    
    // Each signer submits the update
    for (const signer of signers) {
      await supplyOracle.connect(signer).updateSupply(
        chainId,
        totalSupply,
        lockedSupply,
        nonce
      );
    }
  }

  /**
   * Clear used nonces by deploying a fresh contract
   * Used when tests need completely clean state
   */
  static async deployFreshOracle(
    requiredSignatures: number = 2
  ): Promise<SupplyOracle> {
    const SupplyOracleFactory = await ethers.getContractFactory("SupplyOracle");
    const supplyOracle = await SupplyOracleFactory.deploy();
    await supplyOracle.waitForDeployment();
    
    // Initialize with required signatures
    await supplyOracle.initialize(requiredSignatures);
    
    // Reset nonce counter for fresh oracle
    this.resetNonceCounter();
    
    return supplyOracle;
  }

  /**
   * Fast-forward blockchain time to make old nonces invalid
   * Useful for testing nonce expiry scenarios
   */
  static async fastForwardTime(seconds: number): Promise<void> {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  /**
   * Batch update helper with automatic nonce management
   */
  static async batchUpdateSupply(
    supplyOracle: SupplyOracle,
    updates: Array<{
      chainId: number;
      totalSupply: bigint;
      lockedSupply: bigint;
    }>,
    signers: SignerWithAddress[]
  ): Promise<void> {
    const nonce = await this.getValidNonce();
    
    // Format updates for batch call
    const batchUpdates = updates.map(u => ({
      chainId: u.chainId,
      totalSupply: u.totalSupply,
      lockedSupply: u.lockedSupply
    }));
    
    // Each signer submits the batch update
    for (const signer of signers) {
      await supplyOracle.connect(signer).batchUpdateSupply(
        batchUpdates,
        nonce
      );
    }
  }

  /**
   * Generate deterministic nonce for specific test scenarios
   */
  static getDeterministicNonce(testId: string): number {
    const currentTime = Math.floor(Date.now() / 1000);
    const hash = ethers.keccak256(ethers.toUtf8Bytes(testId));
    const offset = parseInt(hash.slice(-8), 16) % 1000;
    return currentTime - 1800 + offset; // Middle of validity window
  }
}

// Export singleton instance for convenience
export const supplyOracleHelper = SupplyOracleTestHelper;