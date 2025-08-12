import { ethers } from "hardhat";
import { expect } from "chai";
import { ContractTransactionResponse } from "ethers";
import { LookCoin } from "../../typechain-types";

// Gas tracking utilities
export interface GasReport {
  functionName: string;
  gasUsed: bigint;
  gasPrice: bigint;
  gasCost: bigint;
  timestamp: number;
}

export class GasTracker {
  private reports: GasReport[] = [];
  private benchmarks: Map<string, bigint> = new Map();

  async trackTransaction(
    tx: ContractTransactionResponse,
    functionName: string
  ): Promise<GasReport> {
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error("Transaction receipt not available");
    }

    const report: GasReport = {
      functionName,
      gasUsed: receipt.gasUsed,
      gasPrice: tx.gasPrice || BigInt(0),
      gasCost: receipt.gasUsed * (tx.gasPrice || BigInt(0)),
      timestamp: Date.now()
    };

    this.reports.push(report);
    return report;
  }

  setBenchmark(functionName: string, maxGas: bigint): void {
    this.benchmarks.set(functionName, maxGas);
  }

  validateGasUsage(functionName: string, gasUsed: bigint): boolean {
    const benchmark = this.benchmarks.get(functionName);
    if (!benchmark) {
      console.warn(`No benchmark set for ${functionName}`);
      return true;
    }
    return gasUsed <= benchmark;
  }

  getReport(functionName?: string): GasReport[] {
    if (functionName) {
      return this.reports.filter(r => r.functionName === functionName);
    }
    return [...this.reports];
  }

  getAverageGas(functionName: string): bigint {
    const relevant = this.reports.filter(r => r.functionName === functionName);
    if (relevant.length === 0) return BigInt(0);
    
    const total = relevant.reduce((sum, r) => sum + r.gasUsed, BigInt(0));
    return total / BigInt(relevant.length);
  }

  generateGasReport(): string {
    const grouped = this.reports.reduce((acc, report) => {
      if (!acc[report.functionName]) {
        acc[report.functionName] = [];
      }
      acc[report.functionName].push(report);
      return acc;
    }, {} as Record<string, GasReport[]>);

    let report = "Gas Usage Report:\n\n";
    
    for (const [functionName, reports] of Object.entries(grouped)) {
      const avgGas = this.getAverageGas(functionName);
      const minGas = reports.reduce((min, r) => r.gasUsed < min ? r.gasUsed : min, reports[0].gasUsed);
      const maxGas = reports.reduce((max, r) => r.gasUsed > max ? r.gasUsed : max, reports[0].gasUsed);
      const benchmark = this.benchmarks.get(functionName);
      
      report += `Function: ${functionName}\n`;
      report += `  Calls: ${reports.length}\n`;
      report += `  Average Gas: ${avgGas.toLocaleString()}\n`;
      report += `  Min Gas: ${minGas.toLocaleString()}\n`;
      report += `  Max Gas: ${maxGas.toLocaleString()}\n`;
      
      if (benchmark) {
        const efficiency = Number(avgGas * BigInt(100) / benchmark);
        report += `  Benchmark: ${benchmark.toLocaleString()}\n`;
        report += `  Efficiency: ${efficiency}% of benchmark\n`;
        report += `  Status: ${avgGas <= benchmark ? "✅ PASS" : "❌ FAIL"}\n`;
      }
      
      report += "\n";
    }
    
    return report;
  }

  clear(): void {
    this.reports = [];
  }
}

// Event validation utilities
export interface EventFilter {
  contract: any;
  eventName: string;
  expectedArgs?: any[];
  fromBlock?: number;
  toBlock?: number;
}

export class EventValidator {
  private expectedEvents: EventFilter[] = [];
  private capturedEvents: any[] = [];

  expectEvent(filter: EventFilter): void {
    this.expectedEvents.push(filter);
  }

  async validateEvents(tx: ContractTransactionResponse): Promise<boolean> {
    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error("Transaction receipt not available");
    }

    for (const expectedEvent of this.expectedEvents) {
      const events = await expectedEvent.contract.queryFilter(
        expectedEvent.contract.filters[expectedEvent.eventName](),
        receipt.blockNumber,
        receipt.blockNumber
      );

      const matchingEvents = events.filter((event: any) => {
        if (!expectedEvent.expectedArgs) return true;
        
        // Compare event arguments
        for (let i = 0; i < expectedEvent.expectedArgs.length; i++) {
          if (event.args && event.args[i] !== expectedEvent.expectedArgs[i]) {
            return false;
          }
        }
        return true;
      });

      if (matchingEvents.length === 0) {
        console.error(`Expected event ${expectedEvent.eventName} not found`);
        return false;
      }

      this.capturedEvents.push(...matchingEvents);
    }

    return true;
  }

  getCapturedEvents(): any[] {
    return [...this.capturedEvents];
  }

  clear(): void {
    this.expectedEvents = [];
    this.capturedEvents = [];
  }
}

// Performance measurement utilities
export interface PerformanceMetric {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  iterations?: number;
  data?: any;
}

export class PerformanceTracker {
  private metrics: Map<string, PerformanceMetric> = new Map();

  startMeasurement(name: string, data?: any): void {
    this.metrics.set(name, {
      name,
      startTime: Date.now(),
      data
    });
  }

  endMeasurement(name: string): PerformanceMetric | null {
    const metric = this.metrics.get(name);
    if (!metric) {
      console.warn(`No measurement started for ${name}`);
      return null;
    }

    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;
    
    this.metrics.set(name, metric);
    return metric;
  }

  measureFunction<T>(name: string, fn: () => Promise<T>, iterations = 1): Promise<T> {
    return this.measureAsyncFunction(name, fn, iterations);
  }

  async measureAsyncFunction<T>(
    name: string,
    fn: () => Promise<T>,
    iterations = 1
  ): Promise<T> {
    this.startMeasurement(name, { iterations });
    
    let result: T;
    for (let i = 0; i < iterations; i++) {
      result = await fn();
    }
    
    const metric = this.endMeasurement(name);
    if (metric && iterations > 1) {
      metric.data.averageTime = metric.duration! / iterations;
    }
    
    return result!;
  }

  getMetric(name: string): PerformanceMetric | undefined {
    return this.metrics.get(name);
  }

  getAllMetrics(): PerformanceMetric[] {
    return Array.from(this.metrics.values());
  }

  generatePerformanceReport(): string {
    let report = "Performance Report:\n\n";
    
    for (const metric of this.metrics.values()) {
      report += `Metric: ${metric.name}\n`;
      
      if (metric.duration !== undefined) {
        report += `  Duration: ${metric.duration}ms\n`;
        
        if (metric.data?.iterations > 1) {
          report += `  Iterations: ${metric.data.iterations}\n`;
          report += `  Average: ${metric.data.averageTime.toFixed(2)}ms\n`;
        }
      }
      
      if (metric.data) {
        report += `  Data: ${JSON.stringify(metric.data, null, 2)}\n`;
      }
      
      report += "\n";
    }
    
    return report;
  }

  clear(): void {
    this.metrics.clear();
  }
}

// Advanced assertion utilities
export async function assertEventSequence(
  tx: ContractTransactionResponse,
  expectedEvents: Array<{ contract: any; eventName: string; args?: any[] }>
): Promise<void> {
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error("Transaction receipt not available");
  }

  let eventIndex = 0;
  
  for (const log of receipt.logs) {
    if (eventIndex >= expectedEvents.length) break;
    
    const expected = expectedEvents[eventIndex];
    
    try {
      const parsedLog = expected.contract.interface.parseLog({
        topics: log.topics,
        data: log.data
      });
      
      if (parsedLog && parsedLog.name === expected.eventName) {
        if (expected.args) {
          for (let i = 0; i < expected.args.length; i++) {
            expect(parsedLog.args[i]).to.equal(expected.args[i]);
          }
        }
        eventIndex++;
      }
    } catch (error) {
      // Log couldn't be parsed by this contract, continue
      continue;
    }
  }
  
  expect(eventIndex).to.equal(expectedEvents.length, "Not all expected events were found in sequence");
}

export async function assertBalanceChange(
  token: LookCoin,
  account: string,
  expectedChange: bigint,
  operation: () => Promise<any>
): Promise<void> {
  const balanceBefore = await token.balanceOf(account);
  await operation();
  const balanceAfter = await token.balanceOf(account);
  
  const actualChange = balanceAfter - balanceBefore;
  expect(actualChange).to.equal(expectedChange, 
    `Expected balance change of ${expectedChange.toString()}, but got ${actualChange.toString()}`);
}

export async function assertMultipleBalanceChanges(
  token: LookCoin,
  changes: Array<{ account: string; expectedChange: bigint }>,
  operation: () => Promise<any>
): Promise<void> {
  const balancesBefore = await Promise.all(
    changes.map(change => token.balanceOf(change.account))
  );
  
  await operation();
  
  const balancesAfter = await Promise.all(
    changes.map(change => token.balanceOf(change.account))
  );
  
  for (let i = 0; i < changes.length; i++) {
    const actualChange = balancesAfter[i] - balancesBefore[i];
    expect(actualChange).to.equal(changes[i].expectedChange,
      `Account ${changes[i].account}: Expected change ${changes[i].expectedChange.toString()}, got ${actualChange.toString()}`);
  }
}

// Cross-chain simulation utilities
export interface CrossChainState {
  chainId: number;
  totalSupply: bigint;
  accountBalances: Map<string, bigint>;
  lastUpdateBlock: number;
}

export class CrossChainSimulator {
  private chainStates: Map<number, CrossChainState> = new Map();

  initializeChain(chainId: number, initialSupply = BigInt(0)): void {
    this.chainStates.set(chainId, {
      chainId,
      totalSupply: initialSupply,
      accountBalances: new Map(),
      lastUpdateBlock: 0
    });
  }

  simulateBridge(
    fromChain: number,
    toChain: number,
    amount: bigint,
    fromAccount: string,
    toAccount: string
  ): void {
    const fromState = this.chainStates.get(fromChain);
    const toState = this.chainStates.get(toChain);
    
    if (!fromState || !toState) {
      throw new Error("Chain not initialized");
    }

    // Burn on source chain
    const fromBalance = fromState.accountBalances.get(fromAccount) || BigInt(0);
    if (fromBalance < amount) {
      throw new Error("Insufficient balance for bridge");
    }
    
    fromState.accountBalances.set(fromAccount, fromBalance - amount);
    fromState.totalSupply -= amount;

    // Mint on destination chain
    const toBalance = toState.accountBalances.get(toAccount) || BigInt(0);
    toState.accountBalances.set(toAccount, toBalance + amount);
    toState.totalSupply += amount;
  }

  getChainState(chainId: number): CrossChainState | undefined {
    return this.chainStates.get(chainId);
  }

  getTotalSupplyAcrossChains(): bigint {
    let total = BigInt(0);
    for (const state of this.chainStates.values()) {
      total += state.totalSupply;
    }
    return total;
  }

  validateSupplyConsistency(expectedTotal: bigint): boolean {
    const actualTotal = this.getTotalSupplyAcrossChains();
    return actualTotal === expectedTotal;
  }

  generateCrossChainReport(): string {
    let report = "Cross-Chain State Report:\n\n";
    
    for (const [chainId, state] of this.chainStates) {
      report += `Chain ${chainId}:\n`;
      report += `  Total Supply: ${state.totalSupply.toLocaleString()}\n`;
      report += `  Accounts: ${state.accountBalances.size}\n`;
      
      for (const [account, balance] of state.accountBalances) {
        if (balance > 0) {
          report += `    ${account}: ${balance.toLocaleString()}\n`;
        }
      }
      
      report += "\n";
    }
    
    report += `Total Supply Across All Chains: ${this.getTotalSupplyAcrossChains().toLocaleString()}\n`;
    
    return report;
  }

  clear(): void {
    this.chainStates.clear();
  }
}

// Security test utilities
export interface SecurityTestCase {
  name: string;
  setup: () => Promise<void>;
  attack: () => Promise<any>;
  expectedResult: "success" | "revert" | "custom";
  customValidator?: (result: any) => boolean;
  errorMessage?: string;
}

export class SecurityTester {
  async runSecurityTest(testCase: SecurityTestCase): Promise<boolean> {
    await testCase.setup();
    
    try {
      const result = await testCase.attack();
      
      switch (testCase.expectedResult) {
        case "success":
          return true;
        case "revert":
          console.error(`Security test ${testCase.name} should have reverted but succeeded`);
          return false;
        case "custom":
          if (!testCase.customValidator) {
            throw new Error("Custom validator required for custom expected result");
          }
          return testCase.customValidator(result);
        default:
          return false;
      }
    } catch (error) {
      if (testCase.expectedResult === "revert") {
        if (testCase.errorMessage) {
          const errorString = error instanceof Error ? error.message : String(error);
          return errorString.includes(testCase.errorMessage);
        }
        return true;
      }
      
      console.error(`Security test ${testCase.name} failed unexpectedly:`, error);
      return false;
    }
  }

  async runSecurityTestSuite(testCases: SecurityTestCase[]): Promise<{ passed: number; failed: number; results: Array<{ name: string; passed: boolean }> }> {
    const results = [];
    let passed = 0;
    let failed = 0;
    
    for (const testCase of testCases) {
      const result = await this.runSecurityTest(testCase);
      results.push({ name: testCase.name, passed: result });
      
      if (result) {
        passed++;
      } else {
        failed++;
      }
    }
    
    return { passed, failed, results };
  }
}

// Test scenario generator
export function generateFuzzTestValues(
  type: "uint256" | "address" | "bytes" | "bool",
  count: number
): any[] {
  const values = [];
  
  switch (type) {
    case "uint256":
      values.push(BigInt(0)); // Zero
      values.push(BigInt(1)); // Minimum positive
      values.push(ethers.MaxUint256); // Maximum
      
      for (let i = 0; i < count - 3; i++) {
        values.push(BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)));
      }
      break;
      
    case "address":
      values.push(ethers.ZeroAddress); // Zero address
      values.push("0x" + "1".repeat(40)); // Address with all 1s
      values.push("0x" + "f".repeat(40)); // Address with all fs
      
      for (let i = 0; i < count - 3; i++) {
        values.push(ethers.Wallet.createRandom().address);
      }
      break;
      
    case "bytes":
      values.push("0x"); // Empty bytes
      values.push("0x00"); // Single zero byte
      values.push("0x" + "ff".repeat(32)); // 32 bytes of 0xff
      
      for (let i = 0; i < count - 3; i++) {
        const length = Math.floor(Math.random() * 100) + 1;
        values.push(ethers.randomBytes(length));
      }
      break;
      
    case "bool":
      values.push(true, false);
      break;
  }
  
  return values.slice(0, count);
}

// Comprehensive test suite coordinator
export class TestSuiteCoordinator {
  private gasTracker = new GasTracker();
  private eventValidator = new EventValidator();
  private performanceTracker = new PerformanceTracker();
  private crossChainSimulator = new CrossChainSimulator();
  private securityTester = new SecurityTester();

  getGasTracker(): GasTracker { return this.gasTracker; }
  getEventValidator(): EventValidator { return this.eventValidator; }
  getPerformanceTracker(): PerformanceTracker { return this.performanceTracker; }
  getCrossChainSimulator(): CrossChainSimulator { return this.crossChainSimulator; }
  getSecurityTester(): SecurityTester { return this.securityTester; }

  generateComprehensiveReport(): string {
    let report = "=".repeat(50) + "\n";
    report += "COMPREHENSIVE TEST SUITE REPORT\n";
    report += "=".repeat(50) + "\n\n";
    
    report += this.gasTracker.generateGasReport() + "\n";
    report += this.performanceTracker.generatePerformanceReport() + "\n";
    report += this.crossChainSimulator.generateCrossChainReport() + "\n";
    
    return report;
  }

  clearAll(): void {
    this.gasTracker.clear();
    this.eventValidator.clear();
    this.performanceTracker.clear();
    this.crossChainSimulator.clear();
  }
}

// Export singleton instance
export const testSuiteCoordinator = new TestSuiteCoordinator();

// Classes are already exported above, no need to re-export