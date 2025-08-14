/**
 * Test Debugging and Diagnostics Utilities
 * 
 * Comprehensive utilities for debugging test failures and infrastructure issues.
 * These utilities help identify root causes of systematic test failures.
 */

import { ethers } from "hardhat";
import { expect } from "chai";

export interface TestDiagnostics {
  contractStates: Record<string, any>;
  transactionResults: any[];
  errorPatterns: string[];
  gasUsage: Record<string, number>;
  blockchainState: {
    blockNumber: number;
    timestamp: number;
    gasPrice: bigint;
  };
}

/**
 * Comprehensive test state diagnostic utility
 */
export class TestDiagnosticTool {
  private diagnostics: TestDiagnostics = {
    contractStates: {},
    transactionResults: [],
    errorPatterns: [],
    gasUsage: {},
    blockchainState: {
      blockNumber: 0,
      timestamp: 0,
      gasPrice: 0n,
    },
  };

  /**
   * Capture complete contract state for diagnosis
   */
  async captureContractState(
    contractName: string,
    contract: any,
    methods: string[] = []
  ): Promise<void> {
    const state: Record<string, any> = {};
    
    // Default methods to check for common contracts
    const defaultMethods = [
      'paused', 'totalSupply', 'name', 'symbol', 'decimals',
      'totalMinted', 'totalBurned', 'owner'
    ];
    
    const methodsToCheck = methods.length > 0 ? methods : defaultMethods;
    
    for (const method of methodsToCheck) {
      try {
        if (typeof contract[method] === 'function') {
          state[method] = await contract[method]();
        }
      } catch (error) {
        state[`${method}_ERROR`] = error instanceof Error ? error.message : String(error);
      }
    }
    
    this.diagnostics.contractStates[contractName] = state;
  }

  /**
   * Capture blockchain state
   */
  async captureBlockchainState(): Promise<void> {
    const provider = ethers.provider;
    const block = await provider.getBlock('latest');
    const gasPrice = await provider.getGasPrice();
    
    this.diagnostics.blockchainState = {
      blockNumber: block?.number || 0,
      timestamp: block?.timestamp || 0,
      gasPrice,
    };
  }

  /**
   * Record transaction result for analysis
   */
  recordTransaction(
    operation: string,
    result: any,
    gasUsed?: number
  ): void {
    this.diagnostics.transactionResults.push({
      operation,
      success: !result.error,
      gasUsed: gasUsed || 0,
      timestamp: Date.now(),
      error: result.error,
    });
    
    if (gasUsed) {
      this.diagnostics.gasUsage[operation] = gasUsed;
    }
  }

  /**
   * Analyze error patterns to identify systematic issues
   */
  analyzeErrorPatterns(): string[] {
    const patterns = new Set<string>();
    
    this.diagnostics.transactionResults.forEach(result => {
      if (result.error) {
        const errorStr = String(result.error);
        
        // Common error patterns
        if (errorStr.includes('ambiguous function')) {
          patterns.add('FUNCTION_AMBIGUITY');
        }
        if (errorStr.includes('tx.wait is not a function')) {
          patterns.add('TRANSACTION_HANDLING');
        }
        if (errorStr.includes('nonce too old')) {
          patterns.add('NONCE_MANAGEMENT');
        }
        if (errorStr.includes('balance')) {
          patterns.add('BALANCE_ASSERTION');
        }
        if (errorStr.includes('gas')) {
          patterns.add('GAS_TRACKING');
        }
      }
    });
    
    this.diagnostics.errorPatterns = Array.from(patterns);
    return this.diagnostics.errorPatterns;
  }

  /**
   * Generate comprehensive diagnostic report
   */
  generateReport(): {
    summary: string;
    details: TestDiagnostics;
    recommendations: string[];
  } {
    const errorPatterns = this.analyzeErrorPatterns();
    const totalTransactions = this.diagnostics.transactionResults.length;
    const failedTransactions = this.diagnostics.transactionResults.filter(r => !r.success).length;
    const failureRate = totalTransactions > 0 ? (failedTransactions / totalTransactions * 100).toFixed(1) : '0';
    
    const summary = `
Test Diagnostic Summary:
- Total Transactions: ${totalTransactions}
- Failed Transactions: ${failedTransactions} (${failureRate}%)
- Error Patterns: ${errorPatterns.join(', ') || 'None'}
- Contracts Analyzed: ${Object.keys(this.diagnostics.contractStates).length}
- Block Number: ${this.diagnostics.blockchainState.blockNumber}
    `.trim();

    const recommendations: string[] = [];
    
    if (errorPatterns.includes('FUNCTION_AMBIGUITY')) {
      recommendations.push('Use explicit function signatures for overloaded functions');
    }
    if (errorPatterns.includes('TRANSACTION_HANDLING')) {
      recommendations.push('Implement proper transaction result handling with type checking');
    }
    if (errorPatterns.includes('NONCE_MANAGEMENT')) {
      recommendations.push('Reset contract state between tests using utility functions');
    }
    if (errorPatterns.includes('BALANCE_ASSERTION')) {
      recommendations.push('Use enhanced balance assertion utilities with better error reporting');
    }
    if (errorPatterns.includes('GAS_TRACKING')) {
      recommendations.push('Update gas tracking utilities to handle different transaction types');
    }
    
    if (parseFloat(failureRate) > 30) {
      recommendations.push('High failure rate detected - run systematic infrastructure audit');
    }

    return {
      summary,
      details: this.diagnostics,
      recommendations,
    };
  }

  /**
   * Clear all diagnostic data
   */
  clear(): void {
    this.diagnostics = {
      contractStates: {},
      transactionResults: [],
      errorPatterns: [],
      gasUsage: {},
      blockchainState: {
        blockNumber: 0,
        timestamp: 0,
        gasPrice: 0n,
      },
    };
  }
}

/**
 * Enhanced test helpers for better debugging
 */
export class EnhancedTestHelpers {
  private static diagnosticTool = new TestDiagnosticTool();

  /**
   * Execute operation with comprehensive error tracking
   */
  static async executeWithDiagnostics<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      const result = await operation();
      this.diagnosticTool.recordTransaction(operationName, { success: true });
      return result;
    } catch (error) {
      this.diagnosticTool.recordTransaction(operationName, { error, success: false });
      throw error;
    }
  }

  /**
   * Safe contract call with function ambiguity handling
   */
  static async safeContractCall(
    contract: any,
    functionName: string,
    args: any[],
    signer?: any,
    explicitSignature?: string
  ): Promise<any> {
    const contractInstance = signer ? contract.connect(signer) : contract;
    
    if (explicitSignature) {
      return this.executeWithDiagnostics(
        `${functionName}(explicit)`,
        () => contractInstance.getFunction(explicitSignature)(...args)
      );
    }

    try {
      return await this.executeWithDiagnostics(
        functionName,
        () => (contractInstance as any)[functionName](...args)
      );
    } catch (error: any) {
      if (error.message && error.message.includes('ambiguous function')) {
        throw new Error(
          `Function ambiguity for ${functionName}. ` +
          `Consider using safeContractCall with explicitSignature parameter.`
        );
      }
      throw error;
    }
  }

  /**
   * Enhanced balance assertion with diagnostics
   */
  static async assertBalanceChangeWithDiagnostics(
    token: any,
    account: string,
    expectedChange: bigint,
    operation: () => Promise<void>,
    operationName: string = 'balance_change'
  ): Promise<void> {
    await this.diagnosticTool.captureBlockchainState();
    await this.diagnosticTool.captureContractState('token', token, ['balanceOf', 'totalSupply']);
    
    const balanceBefore = await token.balanceOf(account);
    
    await this.executeWithDiagnostics(operationName, operation);
    
    const balanceAfter = await token.balanceOf(account);
    const actualChange = balanceAfter - balanceBefore;
    
    if (actualChange !== expectedChange) {
      const report = this.diagnosticTool.generateReport();
      console.error('Balance Assertion Failed - Diagnostic Report:', report.summary);
      console.error('Recommendations:', report.recommendations);
    }
    
    expect(actualChange).to.equal(
      expectedChange,
      `Balance change mismatch for ${account}: ` +
      `expected ${expectedChange.toString()}, ` +
      `got ${actualChange.toString()} ` +
      `(before: ${balanceBefore.toString()}, after: ${balanceAfter.toString()})`
    );
  }

  /**
   * Get diagnostic report
   */
  static getDiagnosticReport() {
    return this.diagnosticTool.generateReport();
  }

  /**
   * Clear diagnostics
   */
  static clearDiagnostics() {
    this.diagnosticTool.clear();
  }
}

/**
 * Test execution wrapper that automatically captures diagnostics
 */
export function withDiagnostics<T extends any[]>(
  testFn: (...args: T) => Promise<void>
) {
  return async (...args: T) => {
    EnhancedTestHelpers.clearDiagnostics();
    
    try {
      await testFn(...args);
    } catch (error) {
      const report = EnhancedTestHelpers.getDiagnosticReport();
      console.error('\n=== TEST FAILURE DIAGNOSTIC REPORT ===');
      console.error(report.summary);
      if (report.recommendations.length > 0) {
        console.error('\nRecommendations:');
        report.recommendations.forEach(rec => console.error(`  - ${rec}`));
      }
      console.error('=====================================\n');
      throw error;
    }
  };
}

/**
 * Export utilities for use in test files
 */
export {
  TestDiagnosticTool,
  EnhancedTestHelpers,
};