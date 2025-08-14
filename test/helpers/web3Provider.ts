import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Enhanced Web3 provider management for robust testing
 */

export interface ChainNetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  gasPrice: bigint;
  blockTime: number;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  explorer?: string;
}

export interface TransactionMetrics {
  gasUsed: bigint;
  gasPrice: bigint;
  transactionCost: bigint;
  blockNumber: number;
  timestamp: number;
  success: boolean;
}

/**
 * Web3 Provider Manager with enhanced error handling and retry mechanisms
 */
export class Web3ProviderManager {
  private provider: any;
  private chainConfigs: Map<number, ChainNetworkConfig> = new Map();
  private transactionMetrics: Map<string, TransactionMetrics> = new Map();
  private retryPolicy = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
  };

  constructor(provider: any = ethers.provider) {
    this.provider = provider;
    this.initializeDefaultChains();
  }

  /**
   * Initialize default chain configurations
   */
  private initializeDefaultChains(): void {
    const defaultChains: ChainNetworkConfig[] = [
      {
        chainId: 31337,
        name: "Hardhat",
        rpcUrl: "http://127.0.0.1:8545",
        gasPrice: ethers.parseUnits("1", "gwei"),
        blockTime: 1,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
      {
        chainId: 56,
        name: "BSC",
        rpcUrl: "https://bsc-dataseed1.binance.org:443",
        gasPrice: ethers.parseUnits("5", "gwei"),
        blockTime: 3,
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        explorer: "https://bscscan.com",
      },
      {
        chainId: 10,
        name: "Optimism",
        rpcUrl: "https://mainnet.optimism.io",
        gasPrice: ethers.parseUnits("0.001", "gwei"),
        blockTime: 2,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        explorer: "https://optimistic.etherscan.io",
      },
      {
        chainId: 8453,
        name: "Base",
        rpcUrl: "https://mainnet.base.org",
        gasPrice: ethers.parseUnits("0.001", "gwei"),
        blockTime: 2,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        explorer: "https://basescan.org",
      },
    ];

    defaultChains.forEach(chain => {
      this.chainConfigs.set(chain.chainId, chain);
    });
  }

  /**
   * Execute transaction with retry logic and comprehensive error handling
   */
  async executeTransactionWithRetry(
    signer: SignerWithAddress,
    txRequest: any,
    retries: number = 0
  ): Promise<any> {
    try {
      // Enhanced transaction preparation
      const preparedTx = await this.prepareTransaction(txRequest);
      
      // Execute transaction
      const tx = await signer.sendTransaction(preparedTx);
      const receipt = await tx.wait();

      // Track metrics
      await this.trackTransactionMetrics(tx.hash, receipt);

      return receipt;
    } catch (error: any) {
      return await this.handleTransactionError(error, signer, txRequest, retries);
    }
  }

  /**
   * Prepare transaction with optimized parameters
   */
  private async prepareTransaction(txRequest: any): Promise<any> {
    const prepared = { ...txRequest };
    
    // Get current network config
    const network = await this.provider.getNetwork();
    const chainConfig = this.chainConfigs.get(Number(network.chainId));

    // Set gas price if not provided
    if (!prepared.gasPrice && !prepared.maxFeePerGas) {
      try {
        const currentGasPrice = await this.provider.getGasPrice();
        const configGasPrice = chainConfig?.gasPrice || currentGasPrice;
        
        // Use the higher of current or config gas price for reliability
        prepared.gasPrice = currentGasPrice > configGasPrice ? currentGasPrice : configGasPrice;
      } catch {
        // Fallback to config gas price
        prepared.gasPrice = chainConfig?.gasPrice || ethers.parseUnits("1", "gwei");
      }
    }

    // Estimate gas if not provided
    if (!prepared.gasLimit) {
      try {
        const estimatedGas = await this.provider.estimateGas(prepared);
        prepared.gasLimit = (estimatedGas * 120n) / 100n; // 20% buffer
      } catch {
        // Fallback to a reasonable default
        prepared.gasLimit = 500000;
      }
    }

    return prepared;
  }

  /**
   * Handle transaction errors with intelligent retry logic
   */
  private async handleTransactionError(
    error: any,
    signer: SignerWithAddress,
    txRequest: any,
    retries: number
  ): Promise<any> {
    const errorMessage = error.message || error.toString();
    
    // Categorize errors
    const isRetryableError = this.isRetryableError(errorMessage);
    const isGasError = this.isGasRelatedError(errorMessage);
    const isNonceError = this.isNonceError(errorMessage);

    console.warn(`Transaction error (retry ${retries}):`, errorMessage);

    // Handle specific error types
    if (isNonceError && retries < this.retryPolicy.maxRetries) {
      // Reset nonce and retry
      const nonce = await this.provider.getTransactionCount(signer.address);
      txRequest.nonce = nonce;
      return this.retryTransaction(signer, txRequest, retries + 1);
    }

    if (isGasError && retries < this.retryPolicy.maxRetries) {
      // Increase gas price and retry
      txRequest.gasPrice = (txRequest.gasPrice || ethers.parseUnits("1", "gwei")) * 150n / 100n;
      txRequest.gasLimit = (txRequest.gasLimit || 500000) * 130 / 100; // Increase by 30%
      return this.retryTransaction(signer, txRequest, retries + 1);
    }

    if (isRetryableError && retries < this.retryPolicy.maxRetries) {
      return this.retryTransaction(signer, txRequest, retries + 1);
    }

    // Non-retryable error or max retries reached
    throw new Error(`Transaction failed after ${retries} retries: ${errorMessage}`);
  }

  /**
   * Retry transaction with exponential backoff
   */
  private async retryTransaction(
    signer: SignerWithAddress,
    txRequest: any,
    retries: number
  ): Promise<any> {
    const delay = Math.min(
      this.retryPolicy.baseDelay * Math.pow(2, retries),
      this.retryPolicy.maxDelay
    );
    
    console.debug(`Retrying transaction in ${delay}ms (attempt ${retries + 1})`);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    return this.executeTransactionWithRetry(signer, txRequest, retries);
  }

  /**
   * Track comprehensive transaction metrics
   */
  private async trackTransactionMetrics(txHash: string, receipt: any): Promise<void> {
    const block = await this.provider.getBlock(receipt.blockNumber);
    
    const metrics: TransactionMetrics = {
      gasUsed: receipt.gasUsed,
      gasPrice: receipt.gasPrice || 0n,
      transactionCost: receipt.gasUsed * (receipt.gasPrice || 0n),
      blockNumber: receipt.blockNumber,
      timestamp: block?.timestamp || 0,
      success: receipt.status === 1,
    };

    this.transactionMetrics.set(txHash, metrics);
    
    console.debug(`Transaction metrics tracked: ${txHash}`, {
      gasUsed: metrics.gasUsed.toString(),
      cost: ethers.formatEther(metrics.transactionCost) + " ETH",
      success: metrics.success,
    });
  }

  /**
   * Validate network connection and configuration
   */
  async validateNetworkConnection(): Promise<boolean> {
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      const gasPrice = await this.provider.getGasPrice();

      console.debug("Network validation successful:", {
        chainId: network.chainId.toString(),
        blockNumber,
        gasPrice: ethers.formatUnits(gasPrice, "gwei") + " gwei",
      });

      return true;
    } catch (error) {
      console.error("Network validation failed:", error);
      return false;
    }
  }

  /**
   * Simulate network conditions for testing
   */
  async simulateNetworkConditions(condition: "normal" | "congested" | "failing"): Promise<void> {
    switch (condition) {
      case "congested":
        // Simulate high gas prices
        await this.provider.send("hardhat_setNextBlockBaseFeePerGas", [
          ethers.toQuantity(ethers.parseUnits("100", "gwei"))
        ]);
        break;
      case "failing":
        // Simulate intermittent failures (handled by retry logic)
        console.debug("Simulating network failures - some transactions may need retries");
        break;
      default:
        // Reset to normal conditions
        await this.provider.send("hardhat_setNextBlockBaseFeePerGas", [
          ethers.toQuantity(ethers.parseUnits("1", "gwei"))
        ]);
    }
  }

  /**
   * Get comprehensive network statistics
   */
  getNetworkStatistics(): {
    totalTransactions: number;
    successfulTransactions: number;
    totalGasUsed: bigint;
    totalCost: bigint;
    averageGasPrice: bigint;
  } {
    const metrics = Array.from(this.transactionMetrics.values());
    
    const totalTransactions = metrics.length;
    const successfulTransactions = metrics.filter(m => m.success).length;
    const totalGasUsed = metrics.reduce((sum, m) => sum + m.gasUsed, 0n);
    const totalCost = metrics.reduce((sum, m) => sum + m.transactionCost, 0n);
    const averageGasPrice = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + m.gasPrice, 0n) / BigInt(metrics.length)
      : 0n;

    return {
      totalTransactions,
      successfulTransactions,
      totalGasUsed,
      totalCost,
      averageGasPrice,
    };
  }

  /**
   * Error classification methods
   */
  private isRetryableError(errorMessage: string): boolean {
    const retryablePatterns = [
      "network timeout",
      "connection refused",
      "502 bad gateway",
      "503 service unavailable",
      "temporary failure",
      "rate limit",
    ];
    
    return retryablePatterns.some(pattern => 
      errorMessage.toLowerCase().includes(pattern)
    );
  }

  private isGasRelatedError(errorMessage: string): boolean {
    const gasErrorPatterns = [
      "out of gas",
      "gas required exceeds allowance",
      "gas price too low",
      "underpriced",
      "insufficient funds for gas",
    ];
    
    return gasErrorPatterns.some(pattern => 
      errorMessage.toLowerCase().includes(pattern)
    );
  }

  private isNonceError(errorMessage: string): boolean {
    const nonceErrorPatterns = [
      "nonce too low",
      "nonce too high",
      "already known",
      "replacement transaction underpriced",
    ];
    
    return nonceErrorPatterns.some(pattern => 
      errorMessage.toLowerCase().includes(pattern)
    );
  }

  /**
   * Get transaction metrics
   */
  getTransactionMetrics(txHash: string): TransactionMetrics | undefined {
    return this.transactionMetrics.get(txHash);
  }

  /**
   * Clear all tracked metrics
   */
  clearMetrics(): void {
    this.transactionMetrics.clear();
  }

  /**
   * Get chain configuration
   */
  getChainConfig(chainId: number): ChainNetworkConfig | undefined {
    return this.chainConfigs.get(chainId);
  }

  /**
   * Add or update chain configuration
   */
  addChainConfig(config: ChainNetworkConfig): void {
    this.chainConfigs.set(config.chainId, config);
  }
}

/**
 * Chain validation utilities
 */
export namespace ChainValidationUtils {
  /**
   * Validate chain ID consistency
   */
  export async function validateChainId(
    provider: any,
    expectedChainId: number
  ): Promise<boolean> {
    try {
      const network = await provider.getNetwork();
      const actualChainId = Number(network.chainId);
      
      if (actualChainId !== expectedChainId) {
        console.warn(
          `Chain ID mismatch: expected ${expectedChainId}, got ${actualChainId}`
        );
        return false;
      }
      
      return true;
    } catch (error) {
      console.error("Chain ID validation failed:", error);
      return false;
    }
  }

  /**
   * Validate block progression
   */
  export async function validateBlockProgression(
    provider: any,
    minBlockInterval: number = 1000
  ): Promise<boolean> {
    try {
      const startBlock = await provider.getBlockNumber();
      await new Promise(resolve => setTimeout(resolve, minBlockInterval));
      const endBlock = await provider.getBlockNumber();
      
      const progressed = endBlock > startBlock;
      if (!progressed) {
        console.warn("Block progression stalled");
      }
      
      return progressed;
    } catch (error) {
      console.error("Block progression validation failed:", error);
      return false;
    }
  }

  /**
   * Validate gas price reasonableness
   */
  export async function validateGasPrice(
    provider: any,
    maxReasonableGwei: number = 1000
  ): Promise<boolean> {
    try {
      const gasPrice = await provider.getGasPrice();
      const gasPriceGwei = Number(ethers.formatUnits(gasPrice, "gwei"));
      
      if (gasPriceGwei > maxReasonableGwei) {
        console.warn(`Gas price unreasonably high: ${gasPriceGwei} gwei`);
        return false;
      }
      
      return true;
    } catch (error) {
      console.error("Gas price validation failed:", error);
      return false;
    }
  }
}

/**
 * Factory function for creating provider manager
 */
export function createWeb3ProviderManager(provider?: any): Web3ProviderManager {
  return new Web3ProviderManager(provider);
}