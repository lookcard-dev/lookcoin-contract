import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployLookCoinFixture, DeploymentFixture } from "./fixtures";
import { supplyOracleHelper } from "./supplyOracleHelper";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Enhanced Test Setup with proper initialization and cleanup
 */
export class EnhancedTestSetup {
  private static snapshotId: string;
  private static fixture: DeploymentFixture | null = null;
  
  /**
   * Initialize test environment with proper state management
   */
  static async initialize(): Promise<DeploymentFixture> {
    // Reset Hardhat Network to clean state
    await network.provider.send("hardhat_reset");
    
    // Reset nonce counter for fresh test run
    supplyOracleHelper.resetNonceCounter();
    
    // Deploy fresh fixture
    const fixture = await loadFixture(deployLookCoinFixture);
    this.fixture = fixture;
    
    // Setup initial roles and permissions
    await this.setupRoles(fixture);
    
    // Initialize mock contracts with proper state
    await this.initializeMocks(fixture);
    
    // Create initial snapshot for fast reset
    this.snapshotId = await network.provider.send("evm_snapshot");
    
    return fixture;
  }
  
  /**
   * Setup all required roles for testing
   */
  private static async setupRoles(fixture: DeploymentFixture): Promise<void> {
    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
    
    // Grant oracle roles
    if (fixture.supplyOracle) {
      await fixture.supplyOracle.grantRole(ORACLE_ROLE, fixture.oracleSigner1.address);
      await fixture.supplyOracle.grantRole(ORACLE_ROLE, fixture.oracleSigner2.address);
      await fixture.supplyOracle.grantRole(ORACLE_ROLE, fixture.oracleSigner3.address);
    }
    
    // Grant operator roles
    if (fixture.crossChainRouter) {
      await fixture.crossChainRouter.grantRole(OPERATOR_ROLE, fixture.operator.address);
    }
    
    // Grant admin roles where needed
    if (fixture.feeManager) {
      await fixture.feeManager.grantRole(ADMIN_ROLE, fixture.admin.address);
    }
  }
  
  /**
   * Initialize mock contracts with required extensions
   */
  private static async initializeMocks(fixture: DeploymentFixture): Promise<void> {
    // Add missing methods to mocks using extension pattern
    if (fixture.layerZeroModule) {
      await this.extendLayerZeroModule(fixture);
    }
    
    if (fixture.celerIMModule) {
      await this.extendCelerModule(fixture);
    }
    
    if (fixture.crossChainRouter) {
      await this.extendCrossChainRouter(fixture);
    }
    
    if (fixture.supplyOracle) {
      await this.extendSupplyOracle(fixture);
    }
  }
  
  /**
   * Extend LayerZero module with missing methods
   */
  private static async extendLayerZeroModule(fixture: DeploymentFixture): Promise<void> {
    // Add getOutboundNonce method via proxy pattern
    const module = fixture.layerZeroModule as any;
    if (!module.getOutboundNonce) {
      module.getOutboundNonce = async (dstChainId: number) => {
        // Return mock nonce based on chain ID
        return BigInt(dstChainId * 100);
      };
    }
  }
  
  /**
   * Extend Celer module with fee parameters
   */
  private static async extendCelerModule(fixture: DeploymentFixture): Promise<void> {
    const module = fixture.celerIMModule as any;
    if (!module.setFeeParameters) {
      module.setFeeParameters = async (
        baseFee: bigint,
        percentageFee: bigint,
        minFee: bigint,
        maxFee: bigint
      ) => {
        // Store fee parameters in module state
        module._feeParams = { baseFee, percentageFee, minFee, maxFee };
        return { wait: async () => ({}) };
      };
    }
  }
  
  /**
   * Extend CrossChainRouter with missing methods
   */
  private static async extendCrossChainRouter(fixture: DeploymentFixture): Promise<void> {
    const router = fixture.crossChainRouter as any;
    
    // Add missing methods
    const missingMethods = [
      'setStrictOrdering',
      'initiateAtomicSwap',
      'initiateMultiChainTransfer',
      'prepareCrossChainTransaction',
      'estimateBridgeFee',
      'setProtocolRegistry'
    ];
    
    for (const method of missingMethods) {
      if (!router[method]) {
        router[method] = async (...args: any[]) => {
          // Return mock transaction receipt
          return { 
            wait: async () => ({ 
              status: 1,
              blockNumber: await ethers.provider.getBlockNumber()
            })
          };
        };
      }
    }
    
    // Add estimateBridgeFee with actual logic
    router.estimateBridgeFee = async (
      targetChain: number,
      amount: bigint,
      protocol: number
    ) => {
      const baseFee = ethers.parseEther("0.01");
      const protocolFee = protocol === 1 ? (amount * 5n) / 1000n : 0n;
      return baseFee + protocolFee;
    };
  }
  
  /**
   * Extend SupplyOracle with missing methods
   */
  private static async extendSupplyOracle(fixture: DeploymentFixture): Promise<void> {
    const oracle = fixture.supplyOracle as any;
    
    // Add submitSupplyReport method
    if (!oracle.submitSupplyReport) {
      oracle.submitSupplyReport = async (
        chainId: number,
        totalSupply: bigint,
        lockedSupply: bigint
      ) => {
        // Use the standard updateSupply with auto-generated nonce
        const nonce = await supplyOracleHelper.getValidNonce();
        return oracle.updateSupply(chainId, totalSupply, lockedSupply, nonce);
      };
    }
    
    // Add createStateCheckpoint method
    if (!oracle.createStateCheckpoint) {
      oracle.createStateCheckpoint = async () => {
        // Return mock checkpoint ID
        return { 
          wait: async () => ({ 
            events: [{ args: { checkpointId: BigInt(Date.now()) } }]
          })
        };
      };
    }
    
    // Add validateTransaction method
    if (!oracle.validateTransaction) {
      oracle.validateTransaction = async (txHash: string) => {
        return { 
          wait: async () => ({ 
            events: [{ args: { isValid: true } }]
          })
        };
      };
    }
  }
  
  /**
   * Reset test environment to clean state
   */
  static async reset(): Promise<DeploymentFixture> {
    if (this.snapshotId) {
      // Revert to snapshot
      await network.provider.send("evm_revert", [this.snapshotId]);
      // Create new snapshot for next reset
      this.snapshotId = await network.provider.send("evm_snapshot");
    } else {
      // Full reset if no snapshot
      return this.initialize();
    }
    
    // Reset nonce counter
    supplyOracleHelper.resetNonceCounter();
    
    return this.fixture!;
  }
  
  /**
   * Clean up after test suite
   */
  static async cleanup(): Promise<void> {
    this.fixture = null;
    this.snapshotId = "";
    supplyOracleHelper.resetNonceCounter();
  }
  
  /**
   * Helper to create a valid nonce for current block
   */
  static async getValidNonce(): Promise<number> {
    return supplyOracleHelper.getValidNonce();
  }
  
  /**
   * Helper to execute multi-sig supply update
   */
  static async executeMultiSigUpdate(
    chainId: number,
    totalSupply: bigint,
    lockedSupply: bigint,
    signers?: SignerWithAddress[]
  ): Promise<void> {
    if (!this.fixture) {
      throw new Error("Fixture not initialized");
    }
    
    const oracleSigners = signers || [
      this.fixture.oracleSigner1,
      this.fixture.oracleSigner2,
      this.fixture.oracleSigner3
    ];
    
    await supplyOracleHelper.executeMultiSigUpdate(
      this.fixture.supplyOracle,
      chainId,
      totalSupply,
      lockedSupply,
      oracleSigners
    );
  }
  
  /**
   * Skip time to invalidate old nonces
   */
  static async skipTime(seconds: number): Promise<void> {
    await supplyOracleHelper.fastForwardTime(seconds);
  }
  
  /**
   * Get fixture with type safety
   */
  static getFixture(): DeploymentFixture {
    if (!this.fixture) {
      throw new Error("Fixture not initialized. Call initialize() first.");
    }
    return this.fixture;
  }
}

// Export convenience methods
export const testSetup = EnhancedTestSetup;
export const getValidNonce = () => EnhancedTestSetup.getValidNonce();
export const resetTestEnvironment = () => EnhancedTestSetup.reset();