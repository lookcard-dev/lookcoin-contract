import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

export interface LoadTestMetrics {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  averageGasUsed: bigint;
  totalGasUsed: bigint;
  minLatency: number;
  maxLatency: number;
  averageLatency: number;
  throughput: number;
  errorRate: number;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface TransactionResult {
  success: boolean;
  gasUsed: bigint;
  latency: number;
  error?: string;
  txHash?: string;
  blockNumber?: number;
}

/**
 * Load Test Helper for comprehensive performance testing
 */
export class LoadTestHelper {
  private metrics: LoadTestMetrics;
  private results: TransactionResult[] = [];
  private startTime: number = 0;
  
  constructor() {
    this.metrics = this.initializeMetrics();
  }
  
  /**
   * Initialize metrics object
   */
  private initializeMetrics(): LoadTestMetrics {
    return {
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      averageGasUsed: 0n,
      totalGasUsed: 0n,
      minLatency: Infinity,
      maxLatency: 0,
      averageLatency: 0,
      throughput: 0,
      errorRate: 0,
      startTime: 0,
      endTime: 0,
      duration: 0
    };
  }
  
  /**
   * Start load test
   */
  startTest(): void {
    this.startTime = Date.now();
    this.metrics.startTime = this.startTime;
    this.results = [];
    this.metrics = this.initializeMetrics();
    this.metrics.startTime = this.startTime;
  }
  
  /**
   * Record transaction result
   */
  recordTransaction(result: TransactionResult): void {
    this.results.push(result);
    this.metrics.totalTransactions++;
    
    if (result.success) {
      this.metrics.successfulTransactions++;
      this.metrics.totalGasUsed += result.gasUsed;
      
      if (result.latency < this.metrics.minLatency) {
        this.metrics.minLatency = result.latency;
      }
      if (result.latency > this.metrics.maxLatency) {
        this.metrics.maxLatency = result.latency;
      }
    } else {
      this.metrics.failedTransactions++;
    }
  }
  
  /**
   * Execute batch transactions with monitoring
   */
  async executeBatch<T>(
    transactions: (() => Promise<T>)[],
    concurrency: number = 10
  ): Promise<TransactionResult[]> {
    const results: TransactionResult[] = [];
    
    for (let i = 0; i < transactions.length; i += concurrency) {
      const batch = transactions.slice(i, i + concurrency);
      const batchPromises = batch.map(async (tx) => {
        const startTime = Date.now();
        try {
          const result = await tx();
          const latency = Date.now() - startTime;
          
          // Extract gas usage if available
          let gasUsed = 0n;
          let txHash: string | undefined;
          let blockNumber: number | undefined;
          
          if (result && typeof result === 'object' && 'wait' in result) {
            const receipt = await (result as any).wait();
            gasUsed = receipt.gasUsed || 0n;
            txHash = receipt.hash;
            blockNumber = receipt.blockNumber;
          }
          
          const txResult: TransactionResult = {
            success: true,
            gasUsed,
            latency,
            txHash,
            blockNumber
          };
          
          this.recordTransaction(txResult);
          return txResult;
        } catch (error: any) {
          const latency = Date.now() - startTime;
          const txResult: TransactionResult = {
            success: false,
            gasUsed: 0n,
            latency,
            error: error.message || 'Unknown error'
          };
          
          this.recordTransaction(txResult);
          return txResult;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    return results;
  }
  
  /**
   * Finalize test and calculate final metrics
   */
  finalizeTest(): LoadTestMetrics {
    this.metrics.endTime = Date.now();
    this.metrics.duration = this.metrics.endTime - this.metrics.startTime;
    
    if (this.metrics.successfulTransactions > 0) {
      this.metrics.averageGasUsed = this.metrics.totalGasUsed / BigInt(this.metrics.successfulTransactions);
      
      const successfulResults = this.results.filter(r => r.success);
      const totalLatency = successfulResults.reduce((sum, r) => sum + r.latency, 0);
      this.metrics.averageLatency = totalLatency / successfulResults.length;
    }
    
    if (this.metrics.duration > 0) {
      this.metrics.throughput = (this.metrics.totalTransactions * 1000) / this.metrics.duration;
    }
    
    if (this.metrics.totalTransactions > 0) {
      this.metrics.errorRate = this.metrics.failedTransactions / this.metrics.totalTransactions;
    }
    
    // Fix Infinity value for minLatency if no successful transactions
    if (this.metrics.minLatency === Infinity) {
      this.metrics.minLatency = 0;
    }
    
    return this.metrics;
  }
  
  /**
   * Generate comprehensive load test report
   */
  generateLoadTestReport(): string {
    const metrics = this.finalizeTest();
    
    const report = {
      summary: {
        totalTransactions: metrics.totalTransactions,
        successRate: `${((metrics.successfulTransactions / metrics.totalTransactions) * 100).toFixed(2)}%`,
        errorRate: `${(metrics.errorRate * 100).toFixed(2)}%`,
        throughput: `${metrics.throughput.toFixed(2)} tx/s`,
        duration: `${(metrics.duration / 1000).toFixed(2)} seconds`
      },
      performance: {
        averageLatency: `${metrics.averageLatency.toFixed(2)} ms`,
        minLatency: `${metrics.minLatency} ms`,
        maxLatency: `${metrics.maxLatency} ms`,
        averageGasUsed: metrics.averageGasUsed.toString(),
        totalGasUsed: metrics.totalGasUsed.toString()
      },
      details: {
        successful: metrics.successfulTransactions,
        failed: metrics.failedTransactions,
        startTime: new Date(metrics.startTime).toISOString(),
        endTime: new Date(metrics.endTime).toISOString()
      },
      errors: this.getErrorSummary()
    };
    
    return JSON.stringify(report, null, 2);
  }
  
  /**
   * Get error summary
   */
  private getErrorSummary(): Record<string, number> {
    const errorCounts: Record<string, number> = {};
    
    this.results
      .filter(r => !r.success && r.error)
      .forEach(r => {
        const errorType = this.categorizeError(r.error!);
        errorCounts[errorType] = (errorCounts[errorType] || 0) + 1;
      });
    
    return errorCounts;
  }
  
  /**
   * Categorize error types
   */
  private categorizeError(error: string): string {
    if (error.includes('nonce')) return 'Nonce Error';
    if (error.includes('gas')) return 'Gas Error';
    if (error.includes('revert')) return 'Revert Error';
    if (error.includes('timeout')) return 'Timeout Error';
    if (error.includes('rate limit')) return 'Rate Limit Error';
    return 'Other Error';
  }
  
  /**
   * Save report to file
   */
  async saveReport(filename?: string): Promise<string> {
    const report = this.generateLoadTestReport();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFilename = filename || `load-test-report-${timestamp}.json`;
    const reportPath = path.join(process.cwd(), 'test-reports', reportFilename);
    
    // Ensure directory exists
    const dir = path.dirname(reportPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(reportPath, report);
    console.log(`Load test report saved to: ${reportPath}`);
    
    return reportPath;
  }
  
  /**
   * Get current metrics without finalizing
   */
  getCurrentMetrics(): LoadTestMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Reset helper for new test
   */
  reset(): void {
    this.metrics = this.initializeMetrics();
    this.results = [];
    this.startTime = 0;
  }
}

// Export singleton instance
export const loadTestHelper = new LoadTestHelper();

// Convenience function for simple load tests
export async function runLoadTest<T>(
  name: string,
  transactions: (() => Promise<T>)[],
  concurrency: number = 10
): Promise<LoadTestMetrics> {
  console.log(`Starting load test: ${name}`);
  
  const helper = new LoadTestHelper();
  helper.startTest();
  
  await helper.executeBatch(transactions, concurrency);
  
  const metrics = helper.finalizeTest();
  console.log(`Load test completed: ${name}`);
  console.log(`  Success rate: ${((metrics.successfulTransactions / metrics.totalTransactions) * 100).toFixed(2)}%`);
  console.log(`  Throughput: ${metrics.throughput.toFixed(2)} tx/s`);
  console.log(`  Average latency: ${metrics.averageLatency.toFixed(2)} ms`);
  
  return metrics;
}