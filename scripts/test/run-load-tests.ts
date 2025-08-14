#!/usr/bin/env tsx

/**
 * @title Load Test Runner
 * @dev Comprehensive load testing orchestrator for the LookCoin system
 * 
 * This script provides:
 * - Automated load test execution
 * - Real-time performance monitoring  
 * - Resource usage tracking
 * - System health checks
 * - Detailed reporting and analytics
 * - Alert notifications for critical issues
 */

import { spawn, ChildProcess } from 'child_process';
import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface LoadTestConfig {
  maxConcurrentRequests: number;
  maxChains: number;
  testDuration: number; // milliseconds
  memoryThreshold: number; // MB
  cpuThreshold: number; // percentage
  errorRateThreshold: number; // percentage
  timeoutThreshold: number; // milliseconds
  reportingInterval: number; // milliseconds
}

interface SystemMetrics {
  timestamp: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: number;
  activeConnections: number;
  queueSizes: Map<string, number>;
  errorRate: number;
  throughput: number;
  averageLatency: number;
}

interface LoadTestResult {
  testName: string;
  startTime: number;
  endTime: number;
  duration: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  throughput: number;
  averageLatency: number;
  peakMemoryUsage: number;
  peakCpuUsage: number;
  systemMetrics: SystemMetrics[];
  success: boolean;
  issues: string[];
}

class LoadTestRunner {
  private config: LoadTestConfig;
  private isRunning: boolean = false;
  private testResults: LoadTestResult[] = [];
  private systemMetrics: SystemMetrics[] = [];
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private startTime: number = 0;

  constructor(config: Partial<LoadTestConfig> = {}) {
    this.config = {
      maxConcurrentRequests: 1000,
      maxChains: 15,
      testDuration: 1800000, // 30 minutes
      memoryThreshold: 4096, // 4GB
      cpuThreshold: 80, // 80%
      errorRateThreshold: 5, // 5%
      timeoutThreshold: 30000, // 30 seconds
      reportingInterval: 5000, // 5 seconds
      ...config
    };
  }

  /**
   * Run comprehensive load test suite
   */
  async runLoadTests(): Promise<void> {
    console.log('🚀 Starting Comprehensive Load Test Suite');
    console.log('=' .repeat(80));
    
    this.displayConfiguration();
    
    try {
      this.isRunning = true;
      this.startTime = performance.now();
      
      // Start system monitoring
      this.startSystemMonitoring();
      
      // Run test scenarios in sequence
      await this.runTestScenario('Concurrent Bridge Requests', 'test:load:concurrent');
      await this.runTestScenario('Multi-Chain Operations', 'test:load:multichain');
      await this.runTestScenario('Oracle Update Load', 'test:load:oracle');
      await this.runTestScenario('Memory Pool Congestion', 'test:load:memory');
      await this.runTestScenario('Rate Limiting', 'test:load:ratelimit');
      await this.runTestScenario('Protocol Queue Management', 'test:load:queue');
      
      // Run comprehensive stress test
      await this.runTestScenario('Comprehensive Stress Test', 'test:load:stress');
      
      // Generate final report
      await this.generateFinalReport();
      
    } catch (error) {
      console.error('❌ Load test suite failed:', error);
      throw error;
    } finally {
      this.cleanup();
    }
  }

  /**
   * Run individual test scenario
   */
  private async runTestScenario(testName: string, npmScript: string): Promise<void> {
    console.log(`\n📋 Running: ${testName}`);
    console.log('-'.repeat(60));
    
    const result: LoadTestResult = {
      testName,
      startTime: performance.now(),
      endTime: 0,
      duration: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      errorRate: 0,
      throughput: 0,
      averageLatency: 0,
      peakMemoryUsage: 0,
      peakCpuUsage: 0,
      systemMetrics: [],
      success: false,
      issues: []
    };

    try {
      // Execute the test
      const testProcess = await this.executeTestScript(npmScript);
      this.activeProcesses.set(testName, testProcess);
      
      // Monitor test execution
      await this.monitorTestExecution(testName, result);
      
      result.endTime = performance.now();
      result.duration = result.endTime - result.startTime;
      result.success = true;
      
      console.log(`✅ ${testName} completed successfully`);
      console.log(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);
      console.log(`   Throughput: ${result.throughput.toFixed(2)} req/sec`);
      console.log(`   Error Rate: ${result.errorRate.toFixed(2)}%`);
      
    } catch (error) {
      result.endTime = performance.now();
      result.duration = result.endTime - result.startTime;
      result.success = false;
      result.issues.push(`Test execution failed: ${error}`);
      
      console.error(`❌ ${testName} failed:`, error);
    } finally {
      this.activeProcesses.delete(testName);
      this.testResults.push(result);
    }
  }

  /**
   * Execute test script and return process handle
   */
  private executeTestScript(npmScript: string): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const process = spawn('npm', ['run', npmScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      process.on('spawn', () => {
        resolve(process);
      });

      process.on('error', (error) => {
        reject(error);
      });

      // Capture output for analysis
      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        stdout += data.toString();
        this.parseTestOutput(data.toString());
      });

      process.stderr?.on('data', (data) => {
        stderr += data.toString();
        console.error('Test stderr:', data.toString());
      });

      process.on('exit', (code, signal) => {
        if (code !== 0) {
          console.error(`Test process exited with code ${code}, signal ${signal}`);
          console.error('stdout:', stdout);
          console.error('stderr:', stderr);
        }
      });
    });
  }

  /**
   * Monitor test execution and collect metrics
   */
  private async monitorTestExecution(testName: string, result: LoadTestResult): Promise<void> {
    return new Promise((resolve, reject) => {
      const testProcess = this.activeProcesses.get(testName);
      if (!testProcess) {
        reject(new Error('Test process not found'));
        return;
      }

      const timeout = setTimeout(() => {
        result.issues.push('Test execution timeout');
        testProcess.kill('SIGTERM');
        reject(new Error('Test execution timeout'));
      }, this.config.timeoutThreshold);

      testProcess.on('exit', (code) => {
        clearTimeout(timeout);
        
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Test failed with exit code ${code}`));
        }
      });

      testProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Parse test output for metrics
   */
  private parseTestOutput(output: string): void {
    // Parse different types of output for metrics
    
    // Success rate patterns
    const successRateMatch = output.match(/Success Rate: (\d+\.?\d*)%/);
    if (successRateMatch) {
      const successRate = parseFloat(successRateMatch[1]);
      // Store success rate
    }

    // Throughput patterns
    const throughputMatch = output.match(/Throughput: (\d+\.?\d*) requests\/second/);
    if (throughputMatch) {
      const throughput = parseFloat(throughputMatch[1]);
      // Store throughput
    }

    // Gas usage patterns
    const gasMatch = output.match(/Average Gas: (\d+\.?\d*) gwei/);
    if (gasMatch) {
      const gasUsage = parseFloat(gasMatch[1]);
      // Store gas usage
    }

    // Error patterns
    const errorMatch = output.match(/❌.*failed:/);
    if (errorMatch) {
      console.warn('⚠️ Test error detected in output');
    }
  }

  /**
   * Start system monitoring
   */
  private startSystemMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      const metrics: SystemMetrics = {
        timestamp: Date.now(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: this.getCpuUsage(),
        activeConnections: this.activeProcesses.size,
        queueSizes: new Map(),
        errorRate: 0,
        throughput: 0,
        averageLatency: 0
      };

      this.systemMetrics.push(metrics);

      // Check thresholds
      this.checkSystemThresholds(metrics);

      // Log metrics periodically
      if (this.systemMetrics.length % 6 === 0) { // Every 30 seconds if interval is 5s
        this.logSystemMetrics(metrics);
      }

    }, this.config.reportingInterval);
  }

  /**
   * Get CPU usage percentage
   */
  private getCpuUsage(): number {
    // Simplified CPU usage calculation
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += (cpu.times as any)[type];
      }
      totalIdle += cpu.times.idle;
    }

    return 100 - ~~(100 * totalIdle / totalTick);
  }

  /**
   * Check system thresholds and alert if exceeded
   */
  private checkSystemThresholds(metrics: SystemMetrics): void {
    const memoryUsageMB = metrics.memoryUsage.heapUsed / 1024 / 1024;
    
    if (memoryUsageMB > this.config.memoryThreshold) {
      console.warn(`⚠️ Memory usage threshold exceeded: ${memoryUsageMB.toFixed(2)}MB`);
    }

    if (metrics.cpuUsage > this.config.cpuThreshold) {
      console.warn(`⚠️ CPU usage threshold exceeded: ${metrics.cpuUsage.toFixed(2)}%`);
    }

    if (metrics.errorRate > this.config.errorRateThreshold) {
      console.warn(`⚠️ Error rate threshold exceeded: ${metrics.errorRate.toFixed(2)}%`);
    }
  }

  /**
   * Log system metrics
   */
  private logSystemMetrics(metrics: SystemMetrics): void {
    const memoryMB = metrics.memoryUsage.heapUsed / 1024 / 1024;
    
    console.log(`\n📊 System Metrics (${new Date(metrics.timestamp).toISOString()})`);
    console.log(`   Memory Usage: ${memoryMB.toFixed(2)}MB`);
    console.log(`   CPU Usage: ${metrics.cpuUsage.toFixed(2)}%`);
    console.log(`   Active Processes: ${metrics.activeConnections}`);
    console.log(`   Error Rate: ${metrics.errorRate.toFixed(2)}%`);
    console.log(`   Throughput: ${metrics.throughput.toFixed(2)} req/sec`);
  }

  /**
   * Generate final comprehensive report
   */
  private async generateFinalReport(): Promise<void> {
    console.log('\n📊 COMPREHENSIVE LOAD TEST REPORT');
    console.log('='.repeat(80));

    const totalDuration = performance.now() - this.startTime;
    const successfulTests = this.testResults.filter(r => r.success).length;
    const totalTests = this.testResults.length;

    console.log('\n📈 EXECUTIVE SUMMARY');
    console.log('-'.repeat(40));
    console.log(`Test Suite Duration: ${(totalDuration / 1000 / 60).toFixed(2)} minutes`);
    console.log(`Tests Executed: ${totalTests}`);
    console.log(`Successful Tests: ${successfulTests}/${totalTests} (${((successfulTests/totalTests)*100).toFixed(1)}%)`);
    console.log(`System Uptime: ${(totalDuration / 1000).toFixed(2)} seconds`);

    // Test Results Summary
    console.log('\n🔍 TEST RESULTS SUMMARY');
    console.log('-'.repeat(40));
    
    for (const result of this.testResults) {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${result.testName}:`);
      console.log(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);
      console.log(`   Requests: ${result.totalRequests.toLocaleString()}`);
      console.log(`   Success Rate: ${((result.successfulRequests / result.totalRequests) * 100).toFixed(2)}%`);
      console.log(`   Throughput: ${result.throughput.toFixed(2)} req/sec`);
      
      if (result.issues.length > 0) {
        console.log(`   Issues: ${result.issues.length}`);
        result.issues.forEach(issue => console.log(`     - ${issue}`));
      }
      console.log();
    }

    // System Performance Analysis
    console.log('\n💻 SYSTEM PERFORMANCE ANALYSIS');
    console.log('-'.repeat(40));
    
    if (this.systemMetrics.length > 0) {
      const avgMemory = this.systemMetrics.reduce((sum, m) => sum + (m.memoryUsage.heapUsed / 1024 / 1024), 0) / this.systemMetrics.length;
      const maxMemory = Math.max(...this.systemMetrics.map(m => m.memoryUsage.heapUsed / 1024 / 1024));
      const avgCpu = this.systemMetrics.reduce((sum, m) => sum + m.cpuUsage, 0) / this.systemMetrics.length;
      const maxCpu = Math.max(...this.systemMetrics.map(m => m.cpuUsage));

      console.log(`Average Memory Usage: ${avgMemory.toFixed(2)}MB`);
      console.log(`Peak Memory Usage: ${maxMemory.toFixed(2)}MB`);
      console.log(`Average CPU Usage: ${avgCpu.toFixed(2)}%`);
      console.log(`Peak CPU Usage: ${maxCpu.toFixed(2)}%`);
    }

    // Performance Recommendations
    console.log('\n💡 PERFORMANCE RECOMMENDATIONS');
    console.log('-'.repeat(40));
    
    const overallErrorRate = this.calculateOverallErrorRate();
    const overallThroughput = this.calculateOverallThroughput();

    if (overallErrorRate > this.config.errorRateThreshold) {
      console.log(`⚠️ High error rate (${overallErrorRate.toFixed(2)}%) - investigate system limits and error handling`);
    }

    if (overallThroughput < 10) {
      console.log(`⚠️ Low throughput (${overallThroughput.toFixed(2)} req/sec) - consider performance optimizations`);
    }

    const failedTests = this.testResults.filter(r => !r.success);
    if (failedTests.length > 0) {
      console.log(`⚠️ ${failedTests.length} test(s) failed - review test logs and system configuration`);
    }

    if (this.systemMetrics.some(m => (m.memoryUsage.heapUsed / 1024 / 1024) > this.config.memoryThreshold)) {
      console.log(`⚠️ Memory usage exceeded threshold - consider increasing memory limits or optimizing memory usage`);
    }

    // Best Practices Suggestions
    console.log('\n🎯 OPTIMIZATION SUGGESTIONS');
    console.log('-'.repeat(40));
    
    const bestTest = this.testResults.reduce((best, current) => 
      current.throughput > best.throughput ? current : best
    );
    console.log(`🏆 Best Performing Test: ${bestTest.testName} (${bestTest.throughput.toFixed(2)} req/sec)`);

    const worstTest = this.testResults.reduce((worst, current) => 
      current.errorRate > worst.errorRate ? current : worst
    );
    if (worstTest.errorRate > 0) {
      console.log(`🔍 Needs Attention: ${worstTest.testName} (${worstTest.errorRate.toFixed(2)}% error rate)`);
    }

    // Save detailed report to file
    await this.saveDetailedReport(totalDuration);

    console.log(`\n📄 Detailed report saved to: ${this.getReportFilePath()}`);
    console.log('='.repeat(80));
    console.log('Load testing completed successfully!');
  }

  /**
   * Save detailed report to file
   */
  private async saveDetailedReport(totalDuration: number): Promise<void> {
    const reportData = {
      timestamp: new Date().toISOString(),
      config: this.config,
      totalDuration,
      testResults: this.testResults,
      systemMetrics: this.systemMetrics,
      summary: {
        totalTests: this.testResults.length,
        successfulTests: this.testResults.filter(r => r.success).length,
        overallErrorRate: this.calculateOverallErrorRate(),
        overallThroughput: this.calculateOverallThroughput()
      }
    };

    const reportPath = this.getReportFilePath();
    await fs.promises.writeFile(reportPath, JSON.stringify(reportData, null, 2));
  }

  /**
   * Get report file path
   */
  private getReportFilePath(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(process.cwd(), 'reports', `load-test-report-${timestamp}.json`);
  }

  /**
   * Calculate overall error rate across all tests
   */
  private calculateOverallErrorRate(): number {
    const totalRequests = this.testResults.reduce((sum, r) => sum + r.totalRequests, 0);
    const totalFailed = this.testResults.reduce((sum, r) => sum + r.failedRequests, 0);
    return totalRequests > 0 ? (totalFailed / totalRequests) * 100 : 0;
  }

  /**
   * Calculate overall throughput across all tests
   */
  private calculateOverallThroughput(): number {
    const validResults = this.testResults.filter(r => r.throughput > 0);
    return validResults.length > 0 
      ? validResults.reduce((sum, r) => sum + r.throughput, 0) / validResults.length 
      : 0;
  }

  /**
   * Display test configuration
   */
  private displayConfiguration(): void {
    console.log('⚙️ LOAD TEST CONFIGURATION');
    console.log('-'.repeat(40));
    console.log(`Max Concurrent Requests: ${this.config.maxConcurrentRequests.toLocaleString()}`);
    console.log(`Max Chains: ${this.config.maxChains}`);
    console.log(`Test Duration: ${(this.config.testDuration / 1000 / 60).toFixed(1)} minutes`);
    console.log(`Memory Threshold: ${this.config.memoryThreshold}MB`);
    console.log(`CPU Threshold: ${this.config.cpuThreshold}%`);
    console.log(`Error Rate Threshold: ${this.config.errorRateThreshold}%`);
    console.log(`Timeout Threshold: ${(this.config.timeoutThreshold / 1000).toFixed(1)}s`);
    console.log();
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.isRunning = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Terminate any remaining processes
    for (const [testName, process] of this.activeProcesses) {
      console.log(`Terminating process for ${testName}`);
      process.kill('SIGTERM');
    }

    this.activeProcesses.clear();
  }
}

/**
 * CLI Interface
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config: Partial<LoadTestConfig> = {};

  // Parse command line arguments
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    switch (flag) {
      case '--concurrent':
        config.maxConcurrentRequests = parseInt(value);
        break;
      case '--chains':
        config.maxChains = parseInt(value);
        break;
      case '--duration':
        config.testDuration = parseInt(value) * 1000; // Convert to milliseconds
        break;
      case '--memory-threshold':
        config.memoryThreshold = parseInt(value);
        break;
      case '--cpu-threshold':
        config.cpuThreshold = parseInt(value);
        break;
      case '--error-threshold':
        config.errorRateThreshold = parseFloat(value);
        break;
      case '--timeout':
        config.timeoutThreshold = parseInt(value) * 1000; // Convert to milliseconds
        break;
      case '--help':
        displayHelp();
        process.exit(0);
        break;
    }
  }

  // Ensure reports directory exists
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const runner = new LoadTestRunner(config);

  try {
    await runner.runLoadTests();
    console.log('\n✅ All load tests completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Load test suite failed:', error);
    process.exit(1);
  }
}

function displayHelp(): void {
  console.log(`
Load Test Runner - Comprehensive performance testing for LookCoin

Usage: tsx scripts/test/run-load-tests.ts [options]

Options:
  --concurrent <number>       Maximum concurrent requests (default: 1000)
  --chains <number>           Maximum chains to test (default: 15) 
  --duration <seconds>        Test duration in seconds (default: 1800)
  --memory-threshold <MB>     Memory threshold in MB (default: 4096)
  --cpu-threshold <percent>   CPU threshold percentage (default: 80)
  --error-threshold <percent> Error rate threshold percentage (default: 5)
  --timeout <seconds>         Test timeout in seconds (default: 30)
  --help                      Display this help message

Examples:
  tsx scripts/test/run-load-tests.ts --concurrent 500 --duration 600
  tsx scripts/test/run-load-tests.ts --chains 10 --memory-threshold 2048
`);
}

// Execute if called directly
if (require.main === module) {
  main().catch(console.error);
}