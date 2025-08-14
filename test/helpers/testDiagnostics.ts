/**
 * Test Diagnostic Tool for LookCoin Infrastructure
 * 
 * Comprehensive diagnostic and debugging utilities for analyzing test failures,
 * performance bottlenecks, and infrastructure issues in the LookCoin test suite.
 * 
 * Features:
 * - Test failure analysis and categorization
 * - Performance bottleneck identification
 * - Transaction failure diagnosis
 * - State inconsistency detection
 * - Gas optimization recommendations
 * - Infrastructure health monitoring
 */

import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { DeploymentFixture } from "./fixtures";
import { GasTracker, GasAnalyzer, GasReportGenerator } from "./gasAnalysis";

// Diagnostic interfaces
export interface TestFailureDiagnostic {
  testName: string;
  category: FailureCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  errorMessage: string;
  stackTrace?: string;
  context: DiagnosticContext;
  recommendations: DiagnosticRecommendation[];
  relatedFailures: string[];
  timestamp: number;
}

export interface DiagnosticContext {
  contractState?: ContractStateSnapshot;
  transactionDetails?: TransactionDiagnostic;
  gasUsage?: GasUsageDiagnostic;
  networkConditions?: NetworkConditions;
  fixtureState?: FixtureStateDiagnostic;
}

export interface ContractStateSnapshot {
  contractAddress: string;
  contractName: string;
  balance: bigint;
  totalSupply?: bigint;
  paused?: boolean;
  roles?: { [role: string]: string[] };
  customState?: { [key: string]: any };
}

export interface TransactionDiagnostic {
  hash?: string;
  from: string;
  to: string;
  value: bigint;
  gasUsed?: bigint;
  gasPrice?: bigint;
  status?: number;
  revertReason?: string;
  blockNumber?: number;
  timestamp?: number;
}

export interface GasUsageDiagnostic {
  operation: string;
  expected: number;
  actual: number;
  deviation: number;
  threshold: number;
  optimization?: string;
}

export interface NetworkConditions {
  chainId: number;
  blockNumber: number;
  gasPrice: bigint;
  timestamp: number;
  lastBlockHash: string;
}

export interface FixtureStateDiagnostic {
  deploymentsComplete: boolean;
  roleAssignmentsComplete: boolean;
  crossChainConfigured: boolean;
  mockContractsOperational: boolean;
  oracleSignersConfigured: boolean;
  issues: string[];
}

export interface DiagnosticRecommendation {
  category: string;
  priority: 'low' | 'medium' | 'high';
  description: string;
  action: string;
  codeExample?: string;
}

export enum FailureCategory {
  TRANSACTION_FAILURE = 'transaction_failure',
  BALANCE_ASSERTION = 'balance_assertion',
  GAS_USAGE = 'gas_usage',
  STATE_INCONSISTENCY = 'state_inconsistency',
  MOCK_CONTRACT = 'mock_contract',
  INFRASTRUCTURE = 'infrastructure',
  TIMEOUT = 'timeout',
  PERMISSION = 'permission',
  CONFIGURATION = 'configuration',
  NETWORK = 'network'
}

/**
 * Main Test Diagnostic Tool
 */
export class TestDiagnosticTool {
  private gasTracker: GasTracker;
  private gasAnalyzer: GasAnalyzer;
  private diagnostics: TestFailureDiagnostic[] = [];
  private performanceBaselines: Map<string, number> = new Map();

  constructor() {
    this.gasTracker = new GasTracker();
    this.gasAnalyzer = new GasAnalyzer(this.gasTracker);
    this.loadPerformanceBaselines();
  }

  /**
   * Analyze test failure and provide comprehensive diagnostic information
   */
  async analyzeTestFailure(
    testName: string,
    error: Error,
    fixture?: DeploymentFixture,
    context?: Partial<DiagnosticContext>
  ): Promise<TestFailureDiagnostic> {
    console.log(`🔍 Analyzing test failure: ${testName}`);

    const category = this.categorizeFailure(error);
    const severity = this.assessFailureSeverity(category, error);

    // Gather comprehensive context
    const diagnosticContext: DiagnosticContext = {
      ...context,
      ...(await this.gatherDiagnosticContext(fixture, error))
    };

    // Generate recommendations
    const recommendations = await this.generateRecommendations(category, error, diagnosticContext);

    // Find related failures
    const relatedFailures = this.findRelatedFailures(testName, error.message);

    const diagnostic: TestFailureDiagnostic = {
      testName,
      category,
      severity,
      errorMessage: error.message,
      stackTrace: error.stack,
      context: diagnosticContext,
      recommendations,
      relatedFailures,
      timestamp: Date.now()
    };

    this.diagnostics.push(diagnostic);

    // Log diagnostic summary
    this.logDiagnosticSummary(diagnostic);

    return diagnostic;
  }

  /**
   * Categorize the type of failure based on error message and stack trace
   */
  private categorizeFailure(error: Error): FailureCategory {
    const message = error.message.toLowerCase();
    const stack = error.stack?.toLowerCase() || '';

    // Transaction-related failures
    if (message.includes('transaction') && (message.includes('reverted') || message.includes('failed'))) {
      return FailureCategory.TRANSACTION_FAILURE;
    }

    // Balance assertion failures
    if (message.includes('balance') || message.includes('expected') && message.includes('actual')) {
      return FailureCategory.BALANCE_ASSERTION;
    }

    // Gas usage failures
    if (message.includes('gas') && (message.includes('limit') || message.includes('usage') || message.includes('estimate'))) {
      return FailureCategory.GAS_USAGE;
    }

    // Permission failures
    if (message.includes('unauthorized') || message.includes('access control') || message.includes('permission')) {
      return FailureCategory.PERMISSION;
    }

    // Timeout failures
    if (message.includes('timeout') || message.includes('timed out')) {
      return FailureCategory.TIMEOUT;
    }

    // Mock contract failures
    if (message.includes('mock') || stack.includes('mock')) {
      return FailureCategory.MOCK_CONTRACT;
    }

    // Configuration failures
    if (message.includes('not configured') || message.includes('configuration') || message.includes('setup')) {
      return FailureCategory.CONFIGURATION;
    }

    // State inconsistency
    if (message.includes('state') || message.includes('inconsistent') || message.includes('nonce')) {
      return FailureCategory.STATE_INCONSISTENCY;
    }

    // Network failures
    if (message.includes('network') || message.includes('connection') || message.includes('provider')) {
      return FailureCategory.NETWORK;
    }

    return FailureCategory.INFRASTRUCTURE;
  }

  /**
   * Assess the severity of the failure
   */
  private assessFailureSeverity(category: FailureCategory, error: Error): 'low' | 'medium' | 'high' | 'critical' {
    const message = error.message.toLowerCase();

    // Critical failures that could indicate systemic issues
    if (category === FailureCategory.INFRASTRUCTURE || 
        category === FailureCategory.NETWORK ||
        message.includes('critical') ||
        message.includes('corrupted')) {
      return 'critical';
    }

    // High severity failures that block test execution
    if (category === FailureCategory.TRANSACTION_FAILURE ||
        category === FailureCategory.STATE_INCONSISTENCY ||
        category === FailureCategory.MOCK_CONTRACT ||
        message.includes('deployment')) {
      return 'high';
    }

    // Medium severity failures that affect test reliability
    if (category === FailureCategory.BALANCE_ASSERTION ||
        category === FailureCategory.GAS_USAGE ||
        category === FailureCategory.CONFIGURATION) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Gather comprehensive diagnostic context
   */
  private async gatherDiagnosticContext(
    fixture?: DeploymentFixture,
    error?: Error
  ): Promise<DiagnosticContext> {
    const context: DiagnosticContext = {};

    try {
      // Gather network conditions
      context.networkConditions = await this.getNetworkConditions();

      // Gather fixture state if available
      if (fixture) {
        context.fixtureState = await this.analyzeFixtureState(fixture);
        
        // Gather contract state snapshots
        if (fixture.lookCoin) {
          context.contractState = await this.captureContractState(fixture.lookCoin, 'LookCoin');
        }
      }

      // Analyze transaction details if error contains transaction info
      if (error && error.message.includes('0x')) {
        context.transactionDetails = await this.extractTransactionDetails(error);
      }

    } catch (contextError) {
      console.warn('Failed to gather full diagnostic context:', contextError);
    }

    return context;
  }

  /**
   * Generate specific recommendations based on failure analysis
   */
  private async generateRecommendations(
    category: FailureCategory,
    error: Error,
    context: DiagnosticContext
  ): Promise<DiagnosticRecommendation[]> {
    const recommendations: DiagnosticRecommendation[] = [];

    switch (category) {
      case FailureCategory.TRANSACTION_FAILURE:
        recommendations.push({
          category: 'Transaction Handling',
          priority: 'high',
          description: 'Transaction failed - check revert reason and gas limits',
          action: 'Use enhanced transaction handling with proper error parsing',
          codeExample: `
// Enhanced transaction handling
try {
  const tx = await contract.someFunction();
  const receipt = await tx.wait();
  if (receipt.status === 0) {
    // Handle revert
    const revertReason = await getRevertReason(tx.hash);
    console.log('Revert reason:', revertReason);
  }
} catch (error) {
  console.log('Transaction error:', error.reason || error.message);
}`
        });
        break;

      case FailureCategory.BALANCE_ASSERTION:
        recommendations.push({
          category: 'Balance Validation',
          priority: 'medium',
          description: 'Balance assertion failed - consider using tolerance-based assertions',
          action: 'Use assertBalanceChanges with tolerance option',
          codeExample: `
// Use enhanced balance assertion
await assertBalanceChanges(
  token, 
  account, 
  expectedChange, 
  operation,
  { tolerance: ethers.parseEther("0.0001") }
);`
        });
        break;

      case FailureCategory.GAS_USAGE:
        recommendations.push({
          category: 'Gas Optimization',
          priority: 'medium',
          description: 'Gas usage exceeded expectations - optimize or adjust limits',
          action: 'Use trackGasUsage for detailed analysis',
          codeExample: `
// Track gas usage for optimization
const gasReport = await trackGasUsage(
  () => contract.someFunction(),
  'functionName'
);
console.log('Gas used:', gasReport.gasUsed);`
        });
        break;

      case FailureCategory.STATE_INCONSISTENCY:
        recommendations.push({
          category: 'State Management',
          priority: 'high',
          description: 'State inconsistency detected - reset test state between tests',
          action: 'Use resetTestState in beforeEach hook',
          codeExample: `
beforeEach(async function() {
  await resetTestState(fixture);
});`
        });
        break;

      case FailureCategory.MOCK_CONTRACT:
        recommendations.push({
          category: 'Mock Validation',
          priority: 'high',
          description: 'Mock contract failure - validate mock deployment',
          action: 'Add mock contract validation after deployment',
          codeExample: `
// Validate mock contracts
const mockAddress = await mockContract.getAddress();
if (!mockAddress || mockAddress === ethers.ZeroAddress) {
  throw new Error('Mock contract deployment failed');
}`
        });
        break;

      case FailureCategory.TIMEOUT:
        recommendations.push({
          category: 'Performance',
          priority: 'medium',
          description: 'Test timeout - optimize performance or increase timeout',
          action: 'Use executeWithTimeout for long operations',
          codeExample: `
// Execute with timeout
await executeWithTimeout(
  () => longRunningOperation(),
  30000, // 30 second timeout
  'Long operation'
);`
        });
        break;
    }

    // Add gas optimization recommendations if gas data is available
    if (context.gasUsage && context.gasUsage.deviation > 20) {
      recommendations.push({
        category: 'Gas Optimization',
        priority: 'medium',
        description: `Gas usage ${context.gasUsage.deviation}% above expected`,
        action: context.gasUsage.optimization || 'Review gas usage patterns',
      });
    }

    return recommendations;
  }

  /**
   * Find related failures with similar patterns
   */
  private findRelatedFailures(testName: string, errorMessage: string): string[] {
    const related: string[] = [];
    const keywords = this.extractErrorKeywords(errorMessage);

    for (const diagnostic of this.diagnostics) {
      if (diagnostic.testName === testName) continue;

      const diagnosticKeywords = this.extractErrorKeywords(diagnostic.errorMessage);
      const commonKeywords = keywords.filter(k => diagnosticKeywords.includes(k));

      if (commonKeywords.length >= 2) {
        related.push(diagnostic.testName);
      }
    }

    return related.slice(0, 5); // Limit to 5 related failures
  }

  /**
   * Extract keywords from error message for similarity analysis
   */
  private extractErrorKeywords(message: string): string[] {
    const words = message.toLowerCase()
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);

    // Common keywords that indicate similar issues
    const relevantKeywords = words.filter(word => 
      ['transaction', 'balance', 'gas', 'revert', 'failed', 'timeout', 'mock', 'contract', 'unauthorized'].includes(word)
    );

    return [...new Set(relevantKeywords)];
  }

  /**
   * Get current network conditions
   */
  private async getNetworkConditions(): Promise<NetworkConditions> {
    const provider = ethers.provider;
    const block = await provider.getBlock('latest');
    const feeData = await provider.getFeeData();

    return {
      chainId: (await provider.getNetwork()).chainId,
      blockNumber: block!.number,
      gasPrice: feeData.gasPrice || 0n,
      timestamp: block!.timestamp,
      lastBlockHash: block!.hash
    };
  }

  /**
   * Analyze fixture state for diagnostic purposes
   */
  private async analyzeFixtureState(fixture: DeploymentFixture): Promise<FixtureStateDiagnostic> {
    const issues: string[] = [];
    let deploymentsComplete = true;
    let roleAssignmentsComplete = true;
    let crossChainConfigured = true;
    let mockContractsOperational = true;
    let oracleSignersConfigured = true;

    try {
      // Check deployments
      if (!fixture.lookCoin) {
        issues.push('LookCoin not deployed');
        deploymentsComplete = false;
      }

      if (!fixture.crossChainRouter) {
        issues.push('CrossChainRouter not deployed');
        deploymentsComplete = false;
      }

      // Check mock contracts
      try {
        if (fixture.mockLayerZero) {
          const lzAddress = await fixture.mockLayerZero.getAddress();
          if (!lzAddress || lzAddress === ethers.ZeroAddress) {
            issues.push('MockLayerZero has invalid address');
            mockContractsOperational = false;
          }
        } else {
          issues.push('MockLayerZero not available');
          mockContractsOperational = false;
        }
      } catch (error) {
        issues.push('MockLayerZero not operational');
        mockContractsOperational = false;
      }

      // Check role assignments
      if (fixture.lookCoin && fixture.governance) {
        try {
          const adminRole = await fixture.lookCoin.DEFAULT_ADMIN_ROLE();
          const hasRole = await fixture.lookCoin.hasRole(adminRole, fixture.governance.address);
          if (!hasRole) {
            issues.push('Governance missing admin role');
            roleAssignmentsComplete = false;
          }
        } catch (error) {
          issues.push('Failed to check governance role');
          roleAssignmentsComplete = false;
        }
      }

      // Check oracle signers
      if (fixture.supplyOracle && fixture.oracleSigner1) {
        try {
          const oracleRole = await fixture.supplyOracle.ORACLE_ROLE();
          const hasRole = await fixture.supplyOracle.hasRole(oracleRole, fixture.oracleSigner1.address);
          if (!hasRole) {
            issues.push('Oracle signer 1 missing ORACLE_ROLE');
            oracleSignersConfigured = false;
          }
        } catch (error) {
          issues.push('Failed to check oracle signer roles');
          oracleSignersConfigured = false;
        }
      }

    } catch (error) {
      issues.push(`Fixture analysis error: ${error}`);
    }

    return {
      deploymentsComplete,
      roleAssignmentsComplete,
      crossChainConfigured,
      mockContractsOperational,
      oracleSignersConfigured,
      issues
    };
  }

  /**
   * Capture detailed contract state snapshot
   */
  private async captureContractState(contract: any, contractName: string): Promise<ContractStateSnapshot> {
    try {
      const address = await contract.getAddress();
      const provider = ethers.provider;
      const balance = await provider.getBalance(address);

      const snapshot: ContractStateSnapshot = {
        contractAddress: address,
        contractName,
        balance
      };

      // Try to get token-specific information
      if (contractName === 'LookCoin') {
        try {
          snapshot.totalSupply = await contract.totalSupply();
          snapshot.paused = await contract.paused();

          // Get role information
          const roles: { [role: string]: string[] } = {};
          const adminRole = await contract.DEFAULT_ADMIN_ROLE();
          const minterRole = await contract.MINTER_ROLE();
          const burnerRole = await contract.BURNER_ROLE();

          // This is a simplified approach - in practice, you'd need to query role members
          snapshot.roles = roles;

        } catch (tokenError) {
          console.warn('Failed to capture token-specific state:', tokenError);
        }
      }

      return snapshot;

    } catch (error) {
      throw new Error(`Failed to capture contract state for ${contractName}: ${error}`);
    }
  }

  /**
   * Extract transaction details from error message
   */
  private async extractTransactionDetails(error: Error): Promise<TransactionDiagnostic | undefined> {
    const hashPattern = /0x[a-fA-F0-9]{64}/g;
    const hashes = error.message.match(hashPattern);

    if (hashes && hashes.length > 0) {
      const hash = hashes[0];
      
      try {
        const provider = ethers.provider;
        const receipt = await provider.getTransactionReceipt(hash);
        const tx = await provider.getTransaction(hash);

        if (receipt && tx) {
          return {
            hash,
            from: tx.from,
            to: tx.to || '',
            value: tx.value,
            gasUsed: receipt.gasUsed,
            gasPrice: tx.gasPrice,
            status: receipt.status,
            blockNumber: receipt.blockNumber,
            timestamp: Date.now()
          };
        }
      } catch (txError) {
        console.warn('Failed to extract transaction details:', txError);
      }
    }

    return undefined;
  }

  /**
   * Load performance baselines from previous runs
   */
  private loadPerformanceBaselines(): void {
    // In a real implementation, this would load from a file or database
    // For now, we'll set some reasonable defaults
    this.performanceBaselines.set('mint', 100000); // 100k gas
    this.performanceBaselines.set('burn', 80000);  // 80k gas  
    this.performanceBaselines.set('transfer', 65000); // 65k gas
    this.performanceBaselines.set('bridge', 200000); // 200k gas
  }

  /**
   * Log diagnostic summary to console
   */
  private logDiagnosticSummary(diagnostic: TestFailureDiagnostic): void {
    console.log('\n' + '='.repeat(80));
    console.log(`🔍 TEST FAILURE DIAGNOSTIC REPORT`);
    console.log('='.repeat(80));
    console.log(`Test: ${diagnostic.testName}`);
    console.log(`Category: ${diagnostic.category.toUpperCase()}`);
    console.log(`Severity: ${diagnostic.severity.toUpperCase()}`);
    console.log(`Error: ${diagnostic.errorMessage}`);
    
    if (diagnostic.context.fixtureState?.issues.length) {
      console.log('\n📋 Fixture Issues:');
      diagnostic.context.fixtureState.issues.forEach(issue => {
        console.log(`  • ${issue}`);
      });
    }

    if (diagnostic.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      diagnostic.recommendations.forEach((rec, i) => {
        console.log(`  ${i + 1}. [${rec.priority.toUpperCase()}] ${rec.description}`);
        console.log(`     Action: ${rec.action}`);
      });
    }

    if (diagnostic.relatedFailures.length > 0) {
      console.log('\n🔗 Related Failures:');
      diagnostic.relatedFailures.forEach(test => {
        console.log(`  • ${test}`);
      });
    }

    console.log('='.repeat(80) + '\n');
  }

  /**
   * Generate comprehensive diagnostic report
   */
  generateComprehensiveReport(): DiagnosticReport {
    const report: DiagnosticReport = {
      timestamp: Date.now(),
      totalFailures: this.diagnostics.length,
      categorySummary: this.generateCategorySummary(),
      severitySummary: this.generateSeveritySummary(),
      topRecommendations: this.generateTopRecommendations(),
      performanceInsights: this.generatePerformanceInsights(),
      diagnostics: [...this.diagnostics]
    };

    return report;
  }

  private generateCategorySummary(): { [category: string]: number } {
    const summary: { [category: string]: number } = {};
    for (const diagnostic of this.diagnostics) {
      summary[diagnostic.category] = (summary[diagnostic.category] || 0) + 1;
    }
    return summary;
  }

  private generateSeveritySummary(): { [severity: string]: number } {
    const summary: { [severity: string]: number } = {};
    for (const diagnostic of this.diagnostics) {
      summary[diagnostic.severity] = (summary[diagnostic.severity] || 0) + 1;
    }
    return summary;
  }

  private generateTopRecommendations(): DiagnosticRecommendation[] {
    const allRecommendations = this.diagnostics.flatMap(d => d.recommendations);
    const recommendationMap = new Map<string, { rec: DiagnosticRecommendation, count: number }>();

    for (const rec of allRecommendations) {
      const key = `${rec.category}-${rec.description}`;
      const existing = recommendationMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        recommendationMap.set(key, { rec, count: 1 });
      }
    }

    return Array.from(recommendationMap.values())
      .sort((a, b) => {
        // Sort by priority first, then by count
        const priorityWeight = { high: 3, medium: 2, low: 1 };
        const aPriority = priorityWeight[a.rec.priority];
        const bPriority = priorityWeight[b.rec.priority];
        
        if (aPriority !== bPriority) return bPriority - aPriority;
        return b.count - a.count;
      })
      .slice(0, 10)
      .map(item => item.rec);
  }

  private generatePerformanceInsights(): PerformanceInsight[] {
    const insights: PerformanceInsight[] = [];
    
    const gasAnalysisReport = this.gasAnalyzer.generateOptimizationReport();
    
    if (gasAnalysisReport.totalPotentialSavings > 50000) {
      insights.push({
        category: 'Gas Optimization',
        description: `High gas usage detected with ${gasAnalysisReport.totalPotentialSavings} gas potential savings`,
        impact: 'high',
        recommendation: 'Review gas optimization recommendations in gas analysis report'
      });
    }

    return insights;
  }

  /**
   * Clear all diagnostics
   */
  clearDiagnostics(): void {
    this.diagnostics = [];
    this.gasTracker.clear();
  }
}

// Additional interfaces for the comprehensive report
export interface DiagnosticReport {
  timestamp: number;
  totalFailures: number;
  categorySummary: { [category: string]: number };
  severitySummary: { [severity: string]: number };
  topRecommendations: DiagnosticRecommendation[];
  performanceInsights: PerformanceInsight[];
  diagnostics: TestFailureDiagnostic[];
}

export interface PerformanceInsight {
  category: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  recommendation: string;
}

// Export singleton instance for easy use
export const testDiagnostics = new TestDiagnosticTool();