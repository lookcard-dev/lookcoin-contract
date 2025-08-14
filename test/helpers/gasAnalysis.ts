import { ethers, ContractTransactionReceipt } from "ethers";
import { expect } from "chai";

/**
 * Gas Analysis Helper Utilities
 * 
 * Provides comprehensive gas tracking, analysis, and optimization
 * recommendations for LookCoin cross-chain operations.
 */

// Gas tracking interfaces
export interface GasMeasurement {
  operation: string;
  gasUsed: number;
  gasPrice: bigint;
  totalCost: bigint;
  timestamp: number;
  blockNumber: number;
  transactionHash: string;
  protocol?: string;
  amount?: bigint;
  payload?: string;
  success?: boolean; // Track if the operation succeeded
  error?: string; // Track any errors that occurred
}

export interface GasComparison {
  baseline: GasMeasurement;
  current: GasMeasurement;
  difference: number;
  percentChange: number;
  isRegression: boolean;
  isOptimization: boolean;
}

export interface OptimizationRecommendation {
  category: string;
  severity: "low" | "medium" | "high";
  title: string;
  description: string;
  potentialSavings: number;
  implementation: string;
}

export interface ProtocolAnalysis {
  protocol: string;
  averageGas: number;
  minGas: number;
  maxGas: number;
  measurements: GasMeasurement[];
  recommendations: OptimizationRecommendation[];
}

/**
 * Gas Tracker for comprehensive measurement collection
 */
export class GasTracker {
  private measurements: Map<string, GasMeasurement[]> = new Map();
  private baselines: Map<string, GasMeasurement> = new Map();
  
  /**
   * Record a gas measurement from transaction receipt with enhanced type handling
   */
  async recordMeasurement(
    operation: string,
    receiptOrTx: any, // More flexible type to handle different transaction objects
    metadata?: {
      protocol?: string;
      amount?: bigint;
      payload?: string;
    }
  ): Promise<GasMeasurement> {
    let receipt = receiptOrTx;
    let gasUsed = 0;
    let gasPrice = 0n;
    let blockNumber = 0;
    let transactionHash = '0x';
    let success = true;
    let error: string | undefined;
    
    try {
      // Enhanced transaction type detection and handling
      if (!receiptOrTx) {
        throw new Error('No transaction data provided');
      }
      
      // Handle ContractTransactionResponse (has wait method)
      if (receiptOrTx && typeof receiptOrTx.wait === 'function') {
        try {
          receipt = await receiptOrTx.wait();
          if (!receipt) {
            throw new Error('Failed to get transaction receipt');
          }
        } catch (waitError) {
          success = false;
          error = `Transaction wait failed: ${waitError}`;
          console.warn(`Failed to wait for transaction in ${operation}:`, waitError);
        }
      }
      
      // Extract gas and transaction info with robust error handling
      if (receipt) {
        gasUsed = Number(receipt.gasUsed || 0);
        gasPrice = receipt.gasPrice || receiptOrTx?.gasPrice || 0n;
        blockNumber = receipt.blockNumber || 0;
        transactionHash = receipt.hash || receipt.transactionHash || '0x';
        
        // Check if transaction was successful
        if (receipt.status !== undefined && receipt.status === 0) {
          success = false;
          error = 'Transaction reverted';
        }
      } else if (receiptOrTx) {
        // Fallback to original transaction data
        gasUsed = Number(receiptOrTx.gasUsed || 0);
        gasPrice = receiptOrTx.gasPrice || 0n;
        blockNumber = receiptOrTx.blockNumber || 0;
        transactionHash = receiptOrTx.hash || receiptOrTx.transactionHash || '0x';
      }
      
      // Validate extracted data
      if (gasUsed < 0) {
        console.warn(`Invalid gas used value: ${gasUsed} for operation ${operation}`);
        gasUsed = 0;
      }
      
      if (gasPrice < 0) {
        console.warn(`Invalid gas price value: ${gasPrice} for operation ${operation}`);
        gasPrice = 0n;
      }
      
    } catch (extractionError) {
      success = false;
      error = `Data extraction failed: ${extractionError}`;
      console.error(`Error extracting gas data for ${operation}:`, extractionError);
    }
    
    // Create measurement with extracted data
    const measurement: GasMeasurement = {
      operation,
      gasUsed,
      gasPrice,
      totalCost: BigInt(gasUsed) * gasPrice,
      timestamp: Date.now(),
      blockNumber,
      transactionHash,
      success,
      error,
      ...metadata,
    };
    
    const existing = this.measurements.get(operation) || [];
    existing.push(measurement);
    this.measurements.set(operation, existing);
    
    // Log measurement for debugging
    if (process.env.DEBUG_GAS) {
      console.debug(`Gas measurement recorded for ${operation}:`, {
        gasUsed: measurement.gasUsed,
        gasPrice: measurement.gasPrice.toString(),
        success: measurement.success,
        error: measurement.error
      });
    }
    
    return measurement;
  }
  
  /**
   * Record a gas measurement from a function call with enhanced error handling
   */
  async recordFromOperation(
    operation: string,
    operationFn: () => Promise<any>,
    metadata?: {
      protocol?: string;
      amount?: bigint;
      payload?: string;
    }
  ): Promise<GasMeasurement> {
    let result: any;
    let operationError: string | undefined;
    
    try {
      if (typeof operationFn !== 'function') {
        throw new Error('operationFn must be a function');
      }
      
      result = await operationFn();
    } catch (error) {
      operationError = `Operation execution failed: ${error}`;
      console.error(`Failed to execute operation ${operation}:`, error);
      
      // Create a failed measurement
      return {
        operation,
        gasUsed: 0,
        gasPrice: 0n,
        totalCost: 0n,
        timestamp: Date.now(),
        blockNumber: 0,
        transactionHash: '0x',
        success: false,
        error: operationError,
        ...metadata,
      };
    }
    
    return this.recordMeasurement(operation, result, {
      ...metadata,
      ...(operationError && { error: operationError })
    });
  }
  
  /**
   * Set baseline measurement for regression detection
   */
  setBaseline(operation: string, measurement: GasMeasurement): void {
    this.baselines.set(operation, measurement);
  }
  
  /**
   * Get all measurements for an operation
   */
  getMeasurements(operation: string): GasMeasurement[] {
    return this.measurements.get(operation) || [];
  }
  
  /**
   * Get average gas for an operation
   */
  getAverageGas(operation: string): number {
    const measurements = this.getMeasurements(operation);
    if (measurements.length === 0) return 0;
    
    const total = measurements.reduce((sum, m) => sum + m.gasUsed, 0);
    return Math.round(total / measurements.length);
  }
  
  /**
   * Compare current measurement against baseline
   */
  compareWithBaseline(operation: string): GasComparison | null {
    const baseline = this.baselines.get(operation);
    const measurements = this.getMeasurements(operation);
    
    if (!baseline || measurements.length === 0) return null;
    
    const current = measurements[measurements.length - 1];
    const difference = current.gasUsed - baseline.gasUsed;
    const percentChange = (difference / baseline.gasUsed) * 100;
    
    return {
      baseline,
      current,
      difference,
      percentChange,
      isRegression: percentChange > 10,
      isOptimization: percentChange < -10,
    };
  }
  
  /**
   * Clear all measurements
   */
  clear(): void {
    this.measurements.clear();
  }
  
  /**
   * Get all recorded operations
   */
  getOperations(): string[] {
    return Array.from(this.measurements.keys());
  }
}

/**
 * Gas Analyzer for detailed analysis and recommendations
 */
export class GasAnalyzer {
  private tracker: GasTracker;
  
  constructor(tracker: GasTracker) {
    this.tracker = tracker;
  }
  
  /**
   * Analyze protocol performance
   */
  analyzeProtocols(): Map<string, ProtocolAnalysis> {
    const protocols = new Map<string, ProtocolAnalysis>();
    
    for (const operation of this.tracker.getOperations()) {
      const measurements = this.tracker.getMeasurements(operation);
      
      for (const measurement of measurements) {
        if (!measurement.protocol) continue;
        
        if (!protocols.has(measurement.protocol)) {
          protocols.set(measurement.protocol, {
            protocol: measurement.protocol,
            averageGas: 0,
            minGas: Infinity,
            maxGas: 0,
            measurements: [],
            recommendations: [],
          });
        }
        
        const analysis = protocols.get(measurement.protocol)!;
        analysis.measurements.push(measurement);
        analysis.minGas = Math.min(analysis.minGas, measurement.gasUsed);
        analysis.maxGas = Math.max(analysis.maxGas, measurement.gasUsed);
      }
    }
    
    // Calculate averages
    for (const analysis of protocols.values()) {
      if (analysis.measurements.length > 0) {
        const total = analysis.measurements.reduce((sum, m) => sum + m.gasUsed, 0);
        analysis.averageGas = Math.round(total / analysis.measurements.length);
      }
      
      analysis.recommendations = this.generateProtocolRecommendations(analysis);
    }
    
    return protocols;
  }
  
  /**
   * Generate optimization recommendations for a protocol
   */
  private generateProtocolRecommendations(analysis: ProtocolAnalysis): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    
    // High gas usage recommendation
    if (analysis.averageGas > 200_000) {
      recommendations.push({
        category: "Gas Optimization",
        severity: "high",
        title: "High Gas Usage Detected",
        description: `${analysis.protocol} averages ${analysis.averageGas.toLocaleString()} gas per transaction`,
        potentialSavings: Math.max(0, analysis.averageGas - 150_000),
        implementation: "Consider optimizing storage patterns, reducing external calls, or batch operations",
      });
    }
    
    // Gas variance recommendation
    const variance = analysis.maxGas - analysis.minGas;
    if (variance > analysis.averageGas * 0.5) {
      recommendations.push({
        category: "Consistency",
        severity: "medium",
        title: "High Gas Variance",
        description: `Gas usage varies by ${variance.toLocaleString()} gas between operations`,
        potentialSavings: Math.round(variance * 0.3),
        implementation: "Investigate conditional logic that causes gas variations",
      });
    }
    
    // Message size optimization
    const largePayloads = analysis.measurements.filter(m => m.payload && m.payload.length > 200);
    if (largePayloads.length > 0) {
      const avgLargeGas = largePayloads.reduce((sum, m) => sum + m.gasUsed, 0) / largePayloads.length;
      const avgSmallGas = analysis.measurements
        .filter(m => m.payload && m.payload.length <= 200)
        .reduce((sum, m) => sum + m.gasUsed, 0) / Math.max(1, analysis.measurements.length - largePayloads.length);
      
      if (avgLargeGas > avgSmallGas * 1.2) {
        recommendations.push({
          category: "Message Optimization",
          severity: "medium",
          title: "Large Payload Overhead",
          description: "Large payloads increase gas costs significantly",
          potentialSavings: Math.round(avgLargeGas - avgSmallGas),
          implementation: "Minimize payload size, use packed encoding, or split large messages",
        });
      }
    }
    
    return recommendations;
  }
  
  /**
   * Analyze storage patterns from measurements
   */
  analyzeStoragePatterns(): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];
    
    // Look for storage-heavy operations
    const storageOps = this.tracker.getOperations().filter(op => 
      op.includes("storage") || op.includes("update") || op.includes("set")
    );
    
    for (const op of storageOps) {
      const avgGas = this.tracker.getAverageGas(op);
      
      if (avgGas > 50_000) {
        recommendations.push({
          category: "Storage Optimization",
          severity: "medium",
          title: "Expensive Storage Operation",
          description: `${op} consumes ${avgGas.toLocaleString()} gas on average`,
          potentialSavings: Math.max(0, avgGas - 30_000),
          implementation: "Consider struct packing, batch updates, or caching frequently accessed values",
        });
      }
    }
    
    return recommendations;
  }
  
  /**
   * Generate comprehensive optimization report
   */
  generateOptimizationReport(): {
    protocolAnalysis: Map<string, ProtocolAnalysis>;
    storageRecommendations: OptimizationRecommendation[];
    totalPotentialSavings: number;
    priorityRecommendations: OptimizationRecommendation[];
  } {
    const protocolAnalysis = this.analyzeProtocols();
    const storageRecommendations = this.analyzeStoragePatterns();
    
    const allRecommendations: OptimizationRecommendation[] = [
      ...storageRecommendations,
      ...Array.from(protocolAnalysis.values()).flatMap(p => p.recommendations),
    ];
    
    const totalPotentialSavings = allRecommendations.reduce(
      (sum, rec) => sum + rec.potentialSavings,
      0
    );
    
    const priorityRecommendations = allRecommendations
      .filter(rec => rec.severity === "high" || rec.potentialSavings > 10_000)
      .sort((a, b) => b.potentialSavings - a.potentialSavings);
    
    return {
      protocolAnalysis,
      storageRecommendations,
      totalPotentialSavings,
      priorityRecommendations,
    };
  }
}

/**
 * Gas Comparison Utilities
 */
export class GasComparator {
  /**
   * Compare gas usage between different implementations
   */
  static compareImplementations(
    baseline: GasMeasurement[],
    optimized: GasMeasurement[],
    operation: string
  ): {
    avgBaseline: number;
    avgOptimized: number;
    savings: number;
    percentImprovement: number;
    isSignificant: boolean;
  } {
    const avgBaseline = baseline.reduce((sum, m) => sum + m.gasUsed, 0) / baseline.length;
    const avgOptimized = optimized.reduce((sum, m) => sum + m.gasUsed, 0) / optimized.length;
    
    const savings = avgBaseline - avgOptimized;
    const percentImprovement = (savings / avgBaseline) * 100;
    const isSignificant = Math.abs(percentImprovement) > 5; // 5% threshold
    
    return {
      avgBaseline,
      avgOptimized,
      savings,
      percentImprovement,
      isSignificant,
    };
  }
  
  /**
   * Compare protocol efficiency for different amounts
   */
  static compareProtocolsByAmount(
    measurements: GasMeasurement[],
    protocols: string[]
  ): Map<string, Map<string, number>> {
    const results = new Map<string, Map<string, number>>();
    
    // Group by amount ranges
    const amountRanges = [
      { min: 0, max: 100, label: "1-100" },
      { min: 100, max: 1000, label: "100-1K" },
      { min: 1000, max: 10000, label: "1K-10K" },
      { min: 10000, max: Infinity, label: "10K+" },
    ];
    
    for (const range of amountRanges) {
      const rangeResults = new Map<string, number>();
      
      for (const protocol of protocols) {
        const protocolMeasurements = measurements.filter(m => 
          m.protocol === protocol &&
          m.amount &&
          Number(ethers.formatEther(m.amount)) >= range.min &&
          Number(ethers.formatEther(m.amount)) < range.max
        );
        
        if (protocolMeasurements.length > 0) {
          const avgGas = protocolMeasurements.reduce((sum, m) => sum + m.gasUsed, 0) / protocolMeasurements.length;
          rangeResults.set(protocol, avgGas);
        }
      }
      
      results.set(range.label, rangeResults);
    }
    
    return results;
  }
}

/**
 * Report Generator for comprehensive gas analysis
 */
export class GasReportGenerator {
  private analyzer: GasAnalyzer;
  
  constructor(analyzer: GasAnalyzer) {
    this.analyzer = analyzer;
  }
  
  /**
   * Generate detailed console report
   */
  generateConsoleReport(): void {
    console.log("\n");
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║               GAS OPTIMIZATION ANALYSIS REPORT              ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    
    const report = this.analyzer.generateOptimizationReport();
    
    // Protocol Analysis
    console.log("\n=== PROTOCOL PERFORMANCE ANALYSIS ===");
    console.log("─".repeat(60));
    
    const sortedProtocols = Array.from(report.protocolAnalysis.entries())
      .sort((a, b) => a[1].averageGas - b[1].averageGas);
    
    for (const [protocol, analysis] of sortedProtocols) {
      console.log(`\n${protocol.toUpperCase()}:`);
      console.log(`  Average Gas: ${analysis.averageGas.toLocaleString()}`);
      console.log(`  Range: ${analysis.minGas.toLocaleString()} - ${analysis.maxGas.toLocaleString()}`);
      console.log(`  Measurements: ${analysis.measurements.length}`);
      
      if (analysis.recommendations.length > 0) {
        console.log("  Recommendations:");
        analysis.recommendations.forEach(rec => {
          console.log(`    • ${rec.title} (${rec.severity}) - Save ${rec.potentialSavings} gas`);
        });
      }
    }
    
    // Priority Recommendations
    console.log("\n=== PRIORITY OPTIMIZATION RECOMMENDATIONS ===");
    console.log("─".repeat(60));
    
    if (report.priorityRecommendations.length === 0) {
      console.log("No high-priority optimizations identified.");
    } else {
      report.priorityRecommendations.forEach((rec, i) => {
        console.log(`\n${i + 1}. ${rec.title} (${rec.severity.toUpperCase()})`);
        console.log(`   Category: ${rec.category}`);
        console.log(`   Potential Savings: ${rec.potentialSavings.toLocaleString()} gas`);
        console.log(`   Description: ${rec.description}`);
        console.log(`   Implementation: ${rec.implementation}`);
      });
    }
    
    // Summary
    console.log("\n=== SUMMARY ===");
    console.log("─".repeat(60));
    console.log(`Total Potential Savings: ${report.totalPotentialSavings.toLocaleString()} gas`);
    console.log(`Total Recommendations: ${report.priorityRecommendations.length + report.storageRecommendations.length}`);
    
    if (report.totalPotentialSavings > 50_000) {
      console.log("🎯 Significant optimization opportunities identified!");
    } else if (report.totalPotentialSavings > 20_000) {
      console.log("⚡ Moderate optimization opportunities available.");
    } else {
      console.log("✅ System appears well-optimized.");
    }
    
    console.log("\n" + "═".repeat(65));
    console.log(`Report generated: ${new Date().toISOString()}`);
    console.log("═".repeat(65) + "\n");
  }
  
  /**
   * Generate JSON report for CI/CD integration
   */
  generateJSONReport(): object {
    const report = this.analyzer.generateOptimizationReport();
    
    return {
      timestamp: new Date().toISOString(),
      summary: {
        totalPotentialSavings: report.totalPotentialSavings,
        highPriorityRecommendations: report.priorityRecommendations.length,
        totalRecommendations: report.priorityRecommendations.length + report.storageRecommendations.length,
      },
      protocols: Array.from(report.protocolAnalysis.entries()).map(([protocol, analysis]) => ({
        name: protocol,
        averageGas: analysis.averageGas,
        minGas: analysis.minGas,
        maxGas: analysis.maxGas,
        measurementCount: analysis.measurements.length,
        recommendations: analysis.recommendations.length,
      })),
      recommendations: report.priorityRecommendations.map(rec => ({
        title: rec.title,
        category: rec.category,
        severity: rec.severity,
        potentialSavings: rec.potentialSavings,
        description: rec.description,
        implementation: rec.implementation,
      })),
    };
  }
}

/**
 * Assertion helpers for gas testing
 */
export class GasAssertions {
  /**
   * Assert gas usage is within expected range
   */
  static assertGasInRange(
    actual: number,
    min: number,
    max: number,
    operation: string
  ): void {
    expect(actual).to.be.gte(min, `${operation} gas too low: ${actual} < ${min}`);
    expect(actual).to.be.lte(max, `${operation} gas too high: ${actual} > ${max}`);
  }
  
  /**
   * Assert gas optimization (current < baseline)
   */
  static assertOptimization(
    current: number,
    baseline: number,
    operation: string,
    minImprovementPercent: number = 5
  ): void {
    const improvement = ((baseline - current) / baseline) * 100;
    expect(improvement).to.be.gte(
      minImprovementPercent,
      `${operation} not optimized enough: ${improvement.toFixed(1)}% < ${minImprovementPercent}%`
    );
  }
  
  /**
   * Assert no performance regression
   */
  static assertNoRegression(
    current: number,
    baseline: number,
    operation: string,
    maxRegressionPercent: number = 10
  ): void {
    const regression = ((current - baseline) / baseline) * 100;
    expect(regression).to.be.lte(
      maxRegressionPercent,
      `${operation} regression too high: ${regression.toFixed(1)}% > ${maxRegressionPercent}%`
    );
  }
}