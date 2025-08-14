/**
 * Test Orchestrator
 * 
 * Comprehensive test coordination system for the LookCoin contract suite.
 * Manages test execution, result aggregation, performance monitoring,
 * and reporting across all test categories.
 * 
 * Features:
 * - Multi-suite test coordination
 * - Performance regression detection
 * - Coverage threshold enforcement
 * - Automated result aggregation
 * - CI/CD integration support
 * - Real-time monitoring and reporting
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { performance } from 'perf_hooks';

interface TestSuite {
  name: string;
  command: string;
  timeout: number;
  critical: boolean;
  dependencies?: string[];
  environment?: Record<string, string>;
  retryCount?: number;
}

interface TestResult {
  suite: string;
  status: 'passed' | 'failed' | 'timeout' | 'skipped';
  duration: number;
  coverage?: number;
  gasUsage?: number;
  memoryUsage?: NodeJS.MemoryUsage;
  error?: string;
  output?: string;
  metrics?: Record<string, any>;
  startTime: number;
  endTime: number;
}

interface PerformanceMetrics {
  totalDuration: number;
  avgGasUsage: number;
  maxMemoryUsage: number;
  regressionDetected: boolean;
  regressionThreshold: number;
  baselineComparison?: Record<string, number>;
}

interface TestOrchestrationConfig {
  mode: 'all' | 'unit' | 'integration' | 'security' | 'performance' | 'coverage' | 'aggregate' | 'status-check' | 'deployment-validation' | 'deployment-report';
  parallel: boolean;
  maxConcurrency: number;
  coverageThreshold: number;
  performanceThreshold: number;
  retryFailedTests: boolean;
  outputDir: string;
  inputDir?: string;
  generateReports: boolean;
  monitorPerformance: boolean;
  slackWebhook?: string;
}

interface ComprehensiveReport {
  summary: {
    totalSuites: number;
    passedSuites: number;
    failedSuites: number;
    skippedSuites: number;
    overallCoverage: number;
    overallStatus: 'success' | 'partial' | 'failed';
    executionTime: number;
  };
  suiteResults: TestResult[];
  performance: PerformanceMetrics;
  coverage: {
    total: number;
    byCategory: Record<string, number>;
    threshold: number;
    passed: boolean;
  };
  security: {
    vulnerabilitiesFound: number;
    criticalIssues: number;
    status: 'secure' | 'warnings' | 'critical';
  };
  recommendations: string[];
  timestamp: string;
  environment: {
    nodeVersion: string;
    platform: string;
    totalMemory: number;
    cpuCount: number;
  };
}

class TestOrchestrator {
  private config: TestOrchestrationConfig;
  private results: TestResult[] = [];
  private runningProcesses: Map<string, ChildProcess> = new Map();
  private performanceBaseline: Record<string, number> = {};
  private startTime: number = 0;

  private readonly testSuites: TestSuite[] = [
    {
      name: 'unit-core',
      command: 'npm run test:unit:lookcoin',
      timeout: 300000, // 5 minutes
      critical: true,
    },
    {
      name: 'unit-bridges',
      command: 'npm run test:unit:bridges',
      timeout: 300000,
      critical: true,
    },
    {
      name: 'unit-security',
      command: 'npm run test:unit:security',
      timeout: 300000,
      critical: true,
    },
    {
      name: 'unit-infrastructure',
      command: 'npm run test:unit:router',
      timeout: 300000,
      critical: true,
    },
    {
      name: 'integration-flows',
      command: 'npm run test:integration:flows',
      timeout: 600000, // 10 minutes
      critical: true,
      dependencies: ['unit-core', 'unit-bridges'],
    },
    {
      name: 'integration-deployment',
      command: 'npm run test:integration:deployment',
      timeout: 600000,
      critical: true,
      dependencies: ['unit-core'],
    },
    {
      name: 'integration-governance',
      command: 'npx hardhat test test/integration/GovernanceFlow.test.ts',
      timeout: 600000,
      critical: true,
      dependencies: ['unit-core'],
    },
    {
      name: 'integration-emergency',
      command: 'npx hardhat test test/integration/EmergencyScenarios.test.ts',
      timeout: 600000,
      critical: true,
      dependencies: ['unit-security'],
    },
    {
      name: 'security-tests',
      command: 'npm run security:test',
      timeout: 900000, // 15 minutes
      critical: true,
      environment: { SECURITY_SCAN: 'true' },
    },
    {
      name: 'security-vulnerability-scan',
      command: 'npm run security:scan',
      timeout: 600000,
      critical: false,
    },
    {
      name: 'security-economic-attacks',
      command: 'npx hardhat test test/security/EconomicAttackTests.test.ts --timeout 300000',
      timeout: 600000,
      critical: true,
      dependencies: ['unit-core'],
    },
    {
      name: 'performance-gas-benchmarks',
      command: 'npm run test:gas:benchmarks',
      timeout: 1200000, // 20 minutes
      critical: false,
      environment: { REPORT_GAS: 'true', RUN_GAS_BENCHMARKS: 'true' },
    },
    {
      name: 'performance-load-tests',
      command: 'npm run test:load',
      timeout: 1800000, // 30 minutes
      critical: false,
      dependencies: ['unit-core', 'unit-bridges'],
    },
    {
      name: 'performance-concurrency',
      command: 'npm run test:concurrency',
      timeout: 900000,
      critical: false,
    },
    {
      name: 'edge-case-tests',
      command: 'npm run test:edge-cases:report',
      timeout: 2700000, // 45 minutes
      critical: false,
      dependencies: ['unit-core'],
    },
    {
      name: 'coverage-analysis',
      command: 'npm run coverage',
      timeout: 1200000,
      critical: false,
      retryCount: 1,
    },
    {
      name: 'migration-tests',
      command: 'npm run test:migration',
      timeout: 3600000, // 60 minutes
      critical: false,
      dependencies: ['unit-core'],
    },
  ];

  constructor(config: Partial<TestOrchestrationConfig> = {}) {
    this.config = {
      mode: 'all',
      parallel: true,
      maxConcurrency: Math.max(2, Math.floor(os.cpus().length / 2)),
      coverageThreshold: 80,
      performanceThreshold: 10,
      retryFailedTests: true,
      outputDir: path.join(process.cwd(), 'reports', 'orchestration'),
      generateReports: true,
      monitorPerformance: true,
      ...config,
    };

    this.loadPerformanceBaseline();
  }

  /**
   * Execute test orchestration based on configuration
   */
  async execute(): Promise<ComprehensiveReport> {
    console.log('🎭 Starting Test Orchestration...\n');
    this.startTime = performance.now();

    await this.ensureOutputDirectory();

    try {
      switch (this.config.mode) {
        case 'all':
          return await this.runAllTests();
        case 'unit':
          return await this.runTestCategory(['unit-core', 'unit-bridges', 'unit-security', 'unit-infrastructure']);
        case 'integration':
          return await this.runTestCategory(['integration-flows', 'integration-deployment', 'integration-governance', 'integration-emergency']);
        case 'security':
          return await this.runTestCategory(['security-tests', 'security-vulnerability-scan', 'security-economic-attacks']);
        case 'performance':
          return await this.runTestCategory(['performance-gas-benchmarks', 'performance-load-tests', 'performance-concurrency']);
        case 'coverage':
          return await this.runCoverageAnalysis();
        case 'aggregate':
          return await this.aggregateResults();
        case 'status-check':
          return await this.performStatusCheck();
        case 'deployment-validation':
          return await this.validateDeploymentReadiness();
        case 'deployment-report':
          return await this.generateDeploymentReport();
        default:
          throw new Error(`Unknown mode: ${this.config.mode}`);
      }
    } catch (error) {
      console.error('❌ Test orchestration failed:', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Run all test suites with dependency management
   */
  private async runAllTests(): Promise<ComprehensiveReport> {
    console.log('🚀 Running comprehensive test suite...\n');

    const suitesToRun = this.filterSuitesByMode();
    const dependencyGraph = this.buildDependencyGraph(suitesToRun);
    
    if (this.config.parallel) {
      await this.executeParallel(dependencyGraph);
    } else {
      await this.executeSequential(suitesToRun);
    }

    return await this.generateComprehensiveReport();
  }

  /**
   * Run specific category of tests
   */
  private async runTestCategory(suiteNames: string[]): Promise<ComprehensiveReport> {
    console.log(`🎯 Running test category: ${suiteNames.join(', ')}\n`);

    const suites = this.testSuites.filter(suite => suiteNames.includes(suite.name));
    
    if (this.config.parallel) {
      await this.executeParallel(this.buildDependencyGraph(suites));
    } else {
      await this.executeSequential(suites);
    }

    return await this.generateComprehensiveReport();
  }

  /**
   * Execute tests in parallel with dependency management
   */
  private async executeParallel(dependencyGraph: Map<string, string[]>): Promise<void> {
    const completed = new Set<string>();
    const running = new Set<string>();
    const pending = new Set(dependencyGraph.keys());

    while (pending.size > 0 || running.size > 0) {
      // Find suites ready to run (dependencies satisfied)
      const readyToRun = Array.from(pending).filter(suite => {
        const deps = dependencyGraph.get(suite) || [];
        return deps.every(dep => completed.has(dep));
      });

      // Start new tests if under concurrency limit
      const slotsAvailable = this.config.maxConcurrency - running.size;
      const toStart = readyToRun.slice(0, slotsAvailable);

      for (const suiteName of toStart) {
        pending.delete(suiteName);
        running.add(suiteName);
        
        this.executeTestSuite(suiteName)
          .then(() => {
            completed.add(suiteName);
            running.delete(suiteName);
          })
          .catch(() => {
            completed.add(suiteName); // Mark as completed even if failed
            running.delete(suiteName);
          });
      }

      // Wait a bit before checking again
      if (running.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Wait for all running tests to complete
    while (running.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Execute tests sequentially
   */
  private async executeSequential(suites: TestSuite[]): Promise<void> {
    for (const suite of suites) {
      await this.executeTestSuite(suite.name);
    }
  }

  /**
   * Execute a single test suite
   */
  private async executeTestSuite(suiteName: string): Promise<TestResult> {
    const suite = this.testSuites.find(s => s.name === suiteName);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteName}`);
    }

    console.log(`🧪 Executing: ${suite.name}`);
    const startTime = performance.now();

    const result: TestResult = {
      suite: suiteName,
      status: 'failed',
      duration: 0,
      startTime,
      endTime: 0,
    };

    try {
      const { stdout, stderr, exitCode } = await this.runCommand(suite);
      const endTime = performance.now();
      
      result.endTime = endTime;
      result.duration = endTime - startTime;
      result.status = exitCode === 0 ? 'passed' : 'failed';
      result.output = stdout;
      result.error = stderr;
      result.memoryUsage = process.memoryUsage();

      // Extract metrics from output
      if (suite.name.includes('gas') || suite.name.includes('performance')) {
        result.gasUsage = this.extractGasMetrics(stdout);
        result.metrics = this.extractPerformanceMetrics(stdout);
      }

      if (suite.name.includes('coverage')) {
        result.coverage = this.extractCoverageMetrics(stdout);
      }

      console.log(`${result.status === 'passed' ? '✅' : '❌'} ${suite.name} (${Math.round(result.duration / 1000)}s)`);

    } catch (error) {
      result.endTime = performance.now();
      result.duration = result.endTime - startTime;
      result.status = 'failed';
      result.error = error instanceof Error ? error.message : String(error);

      console.log(`❌ ${suite.name} failed: ${result.error}`);
    }

    this.results.push(result);
    return result;
  }

  /**
   * Run a command with timeout and monitoring
   */
  private async runCommand(suite: TestSuite): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const [command, ...args] = suite.command.split(' ');
      
      const env = {
        ...process.env,
        NODE_OPTIONS: '--max-old-space-size=6144',
        ...suite.environment,
      };

      const childProcess = spawn(command, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      this.runningProcesses.set(suite.name, childProcess);

      let stdout = '';
      let stderr = '';

      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Timeout handling
      const timeout = setTimeout(() => {
        childProcess.kill('SIGKILL');
        reject(new Error(`Test suite ${suite.name} timed out after ${suite.timeout}ms`));
      }, suite.timeout);

      childProcess.on('close', (code) => {
        clearTimeout(timeout);
        this.runningProcesses.delete(suite.name);
        resolve({ stdout, stderr, exitCode: code || 0 });
      });

      childProcess.on('error', (error) => {
        clearTimeout(timeout);
        this.runningProcesses.delete(suite.name);
        reject(error);
      });
    });
  }

  /**
   * Build dependency graph for test suites
   */
  private buildDependencyGraph(suites: TestSuite[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    
    for (const suite of suites) {
      graph.set(suite.name, suite.dependencies || []);
    }

    return graph;
  }

  /**
   * Filter suites based on current mode
   */
  private filterSuitesByMode(): TestSuite[] {
    switch (this.config.mode) {
      case 'unit':
        return this.testSuites.filter(suite => suite.name.startsWith('unit-'));
      case 'integration':
        return this.testSuites.filter(suite => suite.name.startsWith('integration-'));
      case 'security':
        return this.testSuites.filter(suite => suite.name.startsWith('security-'));
      case 'performance':
        return this.testSuites.filter(suite => suite.name.startsWith('performance-'));
      default:
        return this.testSuites;
    }
  }

  /**
   * Generate comprehensive test report
   */
  private async generateComprehensiveReport(): Promise<ComprehensiveReport> {
    const executionTime = performance.now() - this.startTime;
    const passedSuites = this.results.filter(r => r.status === 'passed').length;
    const failedSuites = this.results.filter(r => r.status === 'failed').length;
    const skippedSuites = this.results.filter(r => r.status === 'skipped').length;

    // Calculate overall coverage
    const coverageResults = this.results.filter(r => r.coverage !== undefined);
    const overallCoverage = coverageResults.length > 0 
      ? coverageResults.reduce((sum, r) => sum + (r.coverage || 0), 0) / coverageResults.length 
      : 0;

    // Performance metrics
    const performanceMetrics = await this.calculatePerformanceMetrics();

    // Security analysis
    const securityResults = this.results.filter(r => r.suite.includes('security'));
    const securityStatus = this.analyzeSecurityResults(securityResults);

    const report: ComprehensiveReport = {
      summary: {
        totalSuites: this.results.length,
        passedSuites,
        failedSuites,
        skippedSuites,
        overallCoverage,
        overallStatus: failedSuites === 0 ? 'success' : passedSuites > failedSuites ? 'partial' : 'failed',
        executionTime: Math.round(executionTime / 1000),
      },
      suiteResults: this.results,
      performance: performanceMetrics,
      coverage: {
        total: overallCoverage,
        byCategory: this.calculateCoverageByCategory(),
        threshold: this.config.coverageThreshold,
        passed: overallCoverage >= this.config.coverageThreshold,
      },
      security: securityStatus,
      recommendations: await this.generateRecommendations(),
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: `${os.type()} ${os.release()}`,
        totalMemory: os.totalmem(),
        cpuCount: os.cpus().length,
      },
    };

    if (this.config.generateReports) {
      await this.saveReport(report);
    }

    this.displaySummary(report);
    return report;
  }

  /**
   * Run coverage analysis
   */
  private async runCoverageAnalysis(): Promise<ComprehensiveReport> {
    console.log('📊 Running coverage analysis...\n');

    const coverageSuites = ['coverage-analysis', 'test:migration:coverage'];
    
    for (const suiteName of coverageSuites) {
      try {
        await this.executeTestSuite(suiteName);
      } catch (error) {
        console.warn(`⚠️ Coverage suite ${suiteName} failed:`, error);
      }
    }

    const report = await this.generateComprehensiveReport();
    
    // Check coverage threshold
    if (report.coverage.total < this.config.coverageThreshold) {
      console.error(`❌ Coverage ${report.coverage.total}% is below threshold ${this.config.coverageThreshold}%`);
      process.exit(1);
    }

    return report;
  }

  /**
   * Aggregate results from multiple test runs
   */
  private async aggregateResults(): Promise<ComprehensiveReport> {
    console.log('📈 Aggregating test results...\n');

    if (!this.config.inputDir) {
      throw new Error('Input directory required for aggregation mode');
    }

    // Load results from input directory
    const resultFiles = await this.loadResultFiles(this.config.inputDir);
    
    // Process and combine results
    this.results = await this.processResultFiles(resultFiles);

    return await this.generateComprehensiveReport();
  }

  /**
   * Perform status check based on test results
   */
  private async performStatusCheck(): Promise<ComprehensiveReport> {
    console.log('🔍 Performing status check...\n');

    if (!this.config.inputDir) {
      throw new Error('Input directory required for status check');
    }

    const report = await this.aggregateResults();
    
    // Determine exit code based on results
    const exitCode = this.calculateExitCode(report);
    
    console.log(`\n📋 Status Check Complete - Exit Code: ${exitCode}`);
    process.exit(exitCode);
  }

  /**
   * Validate deployment readiness
   */
  private async validateDeploymentReadiness(): Promise<ComprehensiveReport> {
    console.log('🚀 Validating deployment readiness...\n');

    // Run critical tests only
    const criticalSuites = this.testSuites.filter(suite => suite.critical);
    
    for (const suite of criticalSuites) {
      const result = await this.executeTestSuite(suite.name);
      
      if (result.status === 'failed') {
        console.error(`❌ Critical test failed: ${suite.name}`);
        process.exit(1);
      }
    }

    const report = await this.generateComprehensiveReport();
    
    // Additional deployment checks
    const deploymentChecks = await this.performDeploymentChecks();
    
    if (!deploymentChecks.passed) {
      console.error('❌ Deployment validation failed:', deploymentChecks.errors);
      process.exit(1);
    }

    console.log('✅ Deployment validation passed');
    return report;
  }

  /**
   * Generate deployment report
   */
  private async generateDeploymentReport(): Promise<ComprehensiveReport> {
    console.log('📋 Generating deployment report...\n');

    const report = await this.runAllTests();
    
    // Generate deployment-specific report
    const deploymentReport = {
      ...report,
      deployment: {
        readiness: this.assessDeploymentReadiness(report),
        risks: this.identifyDeploymentRisks(report),
        recommendations: this.getDeploymentRecommendations(report),
        checklist: this.generateDeploymentChecklist(report),
      },
    };

    await this.saveDeploymentReport(deploymentReport);
    return report;
  }

  /**
   * Extract gas metrics from test output
   */
  private extractGasMetrics(output: string): number {
    const gasMatch = output.match(/Gas used: (\d+)/g);
    if (gasMatch) {
      const gasValues = gasMatch.map(match => parseInt(match.match(/\d+/)![0]));
      return gasValues.reduce((sum, val) => sum + val, 0) / gasValues.length;
    }
    return 0;
  }

  /**
   * Extract performance metrics from test output
   */
  private extractPerformanceMetrics(output: string): Record<string, any> {
    const metrics: Record<string, any> = {};
    
    // Extract various performance metrics
    const patterns = {
      gasUsed: /Gas used: (\d+)/g,
      executionTime: /Duration: (\d+)ms/g,
      throughput: /Throughput: ([\d.]+) ops\/sec/g,
    };

    for (const [key, pattern] of Object.entries(patterns)) {
      const matches = output.match(pattern);
      if (matches) {
        metrics[key] = matches.map(match => parseFloat(match.split(':')[1]));
      }
    }

    return metrics;
  }

  /**
   * Extract coverage metrics from test output
   */
  private extractCoverageMetrics(output: string): number {
    const coverageMatch = output.match(/All files\s+\|\s+([\d.]+)/);
    return coverageMatch ? parseFloat(coverageMatch[1]) : 0;
  }

  /**
   * Calculate performance metrics and detect regressions
   */
  private async calculatePerformanceMetrics(): Promise<PerformanceMetrics> {
    const performanceResults = this.results.filter(r => r.gasUsage !== undefined || r.metrics);
    
    let totalGasUsage = 0;
    let gasCount = 0;
    let maxMemory = 0;

    for (const result of performanceResults) {
      if (result.gasUsage) {
        totalGasUsage += result.gasUsage;
        gasCount++;
      }
      
      if (result.memoryUsage) {
        maxMemory = Math.max(maxMemory, result.memoryUsage.heapUsed);
      }
    }

    const avgGasUsage = gasCount > 0 ? totalGasUsage / gasCount : 0;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    // Check for performance regression
    const regressionDetected = this.detectPerformanceRegression(avgGasUsage);

    return {
      totalDuration: Math.round(totalDuration / 1000),
      avgGasUsage: Math.round(avgGasUsage),
      maxMemoryUsage: Math.round(maxMemory / 1024 / 1024), // MB
      regressionDetected,
      regressionThreshold: this.config.performanceThreshold,
      baselineComparison: this.performanceBaseline,
    };
  }

  /**
   * Analyze security test results
   */
  private analyzeSecurityResults(results: TestResult[]): ComprehensiveReport['security'] {
    let vulnerabilitiesFound = 0;
    let criticalIssues = 0;

    for (const result of results) {
      if (result.output) {
        // Parse security scan output
        const vulnMatches = result.output.match(/vulnerabilities? found/gi);
        const criticalMatches = result.output.match(/critical|high severity/gi);
        
        if (vulnMatches) vulnerabilitiesFound += vulnMatches.length;
        if (criticalMatches) criticalIssues += criticalMatches.length;
      }
    }

    const status = criticalIssues > 0 ? 'critical' : vulnerabilitiesFound > 0 ? 'warnings' : 'secure';

    return {
      vulnerabilitiesFound,
      criticalIssues,
      status,
    };
  }

  /**
   * Calculate coverage by category
   */
  private calculateCoverageByCategory(): Record<string, number> {
    const categories: Record<string, number[]> = {};

    for (const result of this.results) {
      if (result.coverage !== undefined) {
        const category = result.suite.split('-')[0];
        if (!categories[category]) categories[category] = [];
        categories[category].push(result.coverage);
      }
    }

    const averages: Record<string, number> = {};
    for (const [category, values] of Object.entries(categories)) {
      averages[category] = values.reduce((sum, val) => sum + val, 0) / values.length;
    }

    return averages;
  }

  /**
   * Generate recommendations based on test results
   */
  private async generateRecommendations(): Promise<string[]> {
    const recommendations: string[] = [];
    const failedTests = this.results.filter(r => r.status === 'failed');

    if (failedTests.length > 0) {
      recommendations.push(`Address ${failedTests.length} failed test suite(s) before deployment`);
      
      const criticalFailures = failedTests.filter(r => {
        const suite = this.testSuites.find(s => s.name === r.suite);
        return suite?.critical;
      });

      if (criticalFailures.length > 0) {
        recommendations.push(`CRITICAL: ${criticalFailures.length} critical test(s) failed - deployment not recommended`);
      }
    }

    const slowTests = this.results.filter(r => r.duration > 300000); // 5 minutes
    if (slowTests.length > 0) {
      recommendations.push(`Optimize ${slowTests.length} slow-running test suite(s) for better CI performance`);
    }

    const highMemoryTests = this.results.filter(r => r.memoryUsage && r.memoryUsage.heapUsed > 1024 * 1024 * 512); // 512MB
    if (highMemoryTests.length > 0) {
      recommendations.push(`Consider memory optimization for ${highMemoryTests.length} memory-intensive test suite(s)`);
    }

    // Performance recommendations
    const performanceResults = this.results.filter(r => r.suite.includes('performance'));
    if (performanceResults.some(r => r.status === 'failed')) {
      recommendations.push('Review performance test failures before production deployment');
    }

    // Security recommendations
    const securityResults = this.results.filter(r => r.suite.includes('security'));
    if (securityResults.some(r => r.status === 'failed')) {
      recommendations.push('SECURITY: Address security test failures immediately');
    }

    // General recommendations
    recommendations.push('Monitor test execution times and optimize slow suites');
    recommendations.push('Maintain test coverage above 80% for all categories');
    recommendations.push('Regular security scans should be integrated into CI/CD pipeline');

    return recommendations;
  }

  /**
   * Save comprehensive report to file
   */
  private async saveReport(report: ComprehensiveReport): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(this.config.outputDir, `test-report-${timestamp}.json`);
    
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    // Also save a latest.json for easy access
    const latestPath = path.join(this.config.outputDir, 'latest.json');
    await fs.writeFile(latestPath, JSON.stringify(report, null, 2));

    // Generate summary for CI
    const summaryPath = path.join(this.config.outputDir, 'summary.json');
    const summary = {
      overall_status: report.summary.overallStatus,
      unit_tests: this.results.filter(r => r.suite.startsWith('unit-')).every(r => r.status === 'passed') ? 'PASSED' : 'FAILED',
      integration_tests: this.results.filter(r => r.suite.startsWith('integration-')).every(r => r.status === 'passed') ? 'PASSED' : 'FAILED',
      security_tests: this.results.filter(r => r.suite.startsWith('security-')).every(r => r.status === 'passed') ? 'PASSED' : 'FAILED',
      performance_tests: this.results.filter(r => r.suite.startsWith('performance-')).every(r => r.status === 'passed') ? 'PASSED' : 'FAILED',
      edge_case_tests: this.results.filter(r => r.suite.includes('edge-case')).every(r => r.status === 'passed') ? 'PASSED' : 'FAILED',
      coverage: `${Math.round(report.coverage.total)}`,
      performance_status: report.performance.regressionDetected ? 'REGRESSION_DETECTED' : 'STABLE',
      security_status: report.security.status.toUpperCase(),
    };
    
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

    console.log(`\n📊 Reports saved:`);
    console.log(`   • Detailed: ${reportPath}`);
    console.log(`   • Latest: ${latestPath}`);
    console.log(`   • Summary: ${summaryPath}`);
  }

  /**
   * Display comprehensive summary
   */
  private displaySummary(report: ComprehensiveReport): void {
    console.log('\n' + '='.repeat(80));
    console.log('🎭 TEST ORCHESTRATION SUMMARY');
    console.log('='.repeat(80));
    
    console.log(`\n📊 EXECUTION SUMMARY:`);
    console.log(`   Status: ${this.getStatusIcon(report.summary.overallStatus)} ${report.summary.overallStatus.toUpperCase()}`);
    console.log(`   Total Suites: ${report.summary.totalSuites}`);
    console.log(`   Passed: ${report.summary.passedSuites} ✅`);
    console.log(`   Failed: ${report.summary.failedSuites} ${report.summary.failedSuites > 0 ? '❌' : '✅'}`);
    console.log(`   Skipped: ${report.summary.skippedSuites} ⚠️`);
    console.log(`   Duration: ${report.summary.executionTime}s`);
    
    console.log(`\n📈 COVERAGE ANALYSIS:`);
    console.log(`   Overall: ${Math.round(report.coverage.total)}% ${report.coverage.passed ? '✅' : '❌'}`);
    console.log(`   Threshold: ${report.coverage.threshold}%`);
    
    if (Object.keys(report.coverage.byCategory).length > 0) {
      console.log(`   By Category:`);
      for (const [category, coverage] of Object.entries(report.coverage.byCategory)) {
        console.log(`     • ${category}: ${Math.round(coverage)}%`);
      }
    }
    
    console.log(`\n⚡ PERFORMANCE METRICS:`);
    console.log(`   Average Gas Usage: ${report.performance.avgGasUsage.toLocaleString()}`);
    console.log(`   Max Memory Usage: ${report.performance.maxMemoryUsage}MB`);
    console.log(`   Regression Detected: ${report.performance.regressionDetected ? '⚠️ YES' : '✅ NO'}`);
    
    console.log(`\n🔒 SECURITY ANALYSIS:`);
    console.log(`   Status: ${this.getSecurityIcon(report.security.status)} ${report.security.status.toUpperCase()}`);
    console.log(`   Vulnerabilities: ${report.security.vulnerabilitiesFound}`);
    console.log(`   Critical Issues: ${report.security.criticalIssues}`);
    
    if (report.recommendations.length > 0) {
      console.log(`\n💡 RECOMMENDATIONS:`);
      report.recommendations.slice(0, 5).forEach(rec => {
        console.log(`   • ${rec}`);
      });
      
      if (report.recommendations.length > 5) {
        console.log(`   ... and ${report.recommendations.length - 5} more (see detailed report)`);
      }
    }
    
    console.log(`\n💻 ENVIRONMENT:`);
    console.log(`   Node: ${report.environment.nodeVersion}`);
    console.log(`   Platform: ${report.environment.platform}`);
    console.log(`   Memory: ${Math.round(report.environment.totalMemory / 1024 / 1024 / 1024)}GB`);
    console.log(`   CPUs: ${report.environment.cpuCount}`);
    
    console.log('\n' + '='.repeat(80));
    
    const finalStatus = this.getFinalStatus(report);
    console.log(`🎯 FINAL STATUS: ${finalStatus.icon} ${finalStatus.message}`);
    console.log('='.repeat(80) + '\n');
  }

  /**
   * Helper methods for display
   */
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'success': return '🎉';
      case 'partial': return '⚠️';
      case 'failed': return '❌';
      default: return '❓';
    }
  }

  private getSecurityIcon(status: string): string {
    switch (status) {
      case 'secure': return '🔒';
      case 'warnings': return '⚠️';
      case 'critical': return '🚨';
      default: return '❓';
    }
  }

  private getFinalStatus(report: ComprehensiveReport): { icon: string; message: string } {
    if (report.security.status === 'critical') {
      return { icon: '🚨', message: 'CRITICAL SECURITY ISSUES - DO NOT DEPLOY' };
    }
    
    if (report.summary.overallStatus === 'success' && report.coverage.passed) {
      return { icon: '🎉', message: 'ALL SYSTEMS GO - READY FOR DEPLOYMENT' };
    }
    
    if (report.summary.overallStatus === 'partial') {
      return { icon: '⚠️', message: 'PARTIAL SUCCESS - REVIEW REQUIRED' };
    }
    
    return { icon: '❌', message: 'TESTS FAILED - FIX ISSUES BEFORE DEPLOYMENT' };
  }

  /**
   * Utility methods
   */
  private async ensureOutputDirectory(): Promise<void> {
    await fs.mkdir(this.config.outputDir, { recursive: true });
  }

  private async loadPerformanceBaseline(): Promise<void> {
    try {
      const baselinePath = path.join(process.cwd(), 'reports', 'performance-baseline.json');
      const data = await fs.readFile(baselinePath, 'utf-8');
      this.performanceBaseline = JSON.parse(data);
    } catch {
      // No baseline available, start fresh
      this.performanceBaseline = {};
    }
  }

  private detectPerformanceRegression(currentGasUsage: number): boolean {
    const baseline = this.performanceBaseline.gasUsage;
    if (!baseline) return false;
    
    const increase = ((currentGasUsage - baseline) / baseline) * 100;
    return increase > this.config.performanceThreshold;
  }

  private calculateExitCode(report: ComprehensiveReport): number {
    if (report.security.status === 'critical') return 2;
    if (report.summary.failedSuites > 0) return 1;
    if (!report.coverage.passed) return 1;
    return 0;
  }

  private async loadResultFiles(inputDir: string): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(inputDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subFiles = await this.loadResultFiles(path.join(inputDir, entry.name));
          files.push(...subFiles);
        } else if (entry.name.endsWith('.json')) {
          files.push(path.join(inputDir, entry.name));
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not read directory ${inputDir}:`, error);
    }

    return files;
  }

  private async processResultFiles(files: string[]): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const file of files) {
      try {
        const data = await fs.readFile(file, 'utf-8');
        const parsed = JSON.parse(data);
        
        // Handle different result formats
        if (Array.isArray(parsed)) {
          results.push(...parsed);
        } else if (parsed.suiteResults) {
          results.push(...parsed.suiteResults);
        } else {
          // Convert single result
          results.push(this.convertToTestResult(parsed, file));
        }
      } catch (error) {
        console.warn(`Warning: Could not process result file ${file}:`, error);
      }
    }

    return results;
  }

  private convertToTestResult(data: any, filename: string): TestResult {
    return {
      suite: data.suite || path.basename(filename, '.json'),
      status: data.status || 'failed',
      duration: data.duration || 0,
      startTime: data.startTime || 0,
      endTime: data.endTime || 0,
      coverage: data.coverage,
      gasUsage: data.gasUsage,
      memoryUsage: data.memoryUsage,
      error: data.error,
      output: data.output,
      metrics: data.metrics,
    };
  }

  private async performDeploymentChecks(): Promise<{ passed: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Check critical test results
    const criticalSuites = this.testSuites.filter(s => s.critical);
    const failedCritical = this.results.filter(r => {
      const suite = criticalSuites.find(s => s.name === r.suite);
      return suite && r.status === 'failed';
    });

    if (failedCritical.length > 0) {
      errors.push(`Critical tests failed: ${failedCritical.map(r => r.suite).join(', ')}`);
    }

    // Check security status
    const securityResults = this.analyzeSecurityResults(this.results.filter(r => r.suite.includes('security')));
    if (securityResults.criticalIssues > 0) {
      errors.push(`Critical security issues detected: ${securityResults.criticalIssues}`);
    }

    // Check coverage
    const coverageResults = this.results.filter(r => r.coverage !== undefined);
    if (coverageResults.length > 0) {
      const avgCoverage = coverageResults.reduce((sum, r) => sum + (r.coverage || 0), 0) / coverageResults.length;
      if (avgCoverage < this.config.coverageThreshold) {
        errors.push(`Coverage ${Math.round(avgCoverage)}% below threshold ${this.config.coverageThreshold}%`);
      }
    }

    return { passed: errors.length === 0, errors };
  }

  private assessDeploymentReadiness(report: ComprehensiveReport): 'ready' | 'review' | 'blocked' {
    if (report.security.status === 'critical') return 'blocked';
    if (report.summary.failedSuites > 0) return 'blocked';
    if (!report.coverage.passed) return 'review';
    if (report.performance.regressionDetected) return 'review';
    return 'ready';
  }

  private identifyDeploymentRisks(report: ComprehensiveReport): string[] {
    const risks: string[] = [];
    
    if (report.security.vulnerabilitiesFound > 0) {
      risks.push(`${report.security.vulnerabilitiesFound} security vulnerabilities identified`);
    }
    
    if (report.performance.regressionDetected) {
      risks.push('Performance regression detected');
    }
    
    const failedTests = report.summary.failedSuites;
    if (failedTests > 0) {
      risks.push(`${failedTests} test suites failing`);
    }
    
    return risks;
  }

  private getDeploymentRecommendations(report: ComprehensiveReport): string[] {
    const recommendations = [...report.recommendations];
    
    if (this.assessDeploymentReadiness(report) === 'ready') {
      recommendations.unshift('✅ System is ready for deployment');
    } else {
      recommendations.unshift('⚠️ Address identified issues before deployment');
    }
    
    return recommendations;
  }

  private generateDeploymentChecklist(report: ComprehensiveReport): Array<{ item: string; status: 'complete' | 'pending' | 'failed' }> {
    return [
      { item: 'All critical tests passing', status: report.summary.failedSuites === 0 ? 'complete' : 'failed' },
      { item: 'Security scan clean', status: report.security.status === 'secure' ? 'complete' : 'failed' },
      { item: 'Coverage above threshold', status: report.coverage.passed ? 'complete' : 'failed' },
      { item: 'No performance regression', status: !report.performance.regressionDetected ? 'complete' : 'failed' },
      { item: 'Edge cases handled', status: this.results.some(r => r.suite.includes('edge-case') && r.status === 'passed') ? 'complete' : 'pending' },
    ];
  }

  private async saveDeploymentReport(report: any): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const deploymentReportPath = path.join(this.config.outputDir, `deployment-report-${timestamp}.json`);
    
    await fs.writeFile(deploymentReportPath, JSON.stringify(report, null, 2));
    console.log(`📋 Deployment report saved: ${deploymentReportPath}`);
  }

  private async cleanup(): Promise<void> {
    // Kill any remaining processes
    for (const [name, process] of this.runningProcesses.entries()) {
      console.log(`🧹 Cleaning up process: ${name}`);
      process.kill('SIGTERM');
    }
    
    this.runningProcesses.clear();
  }
}

/**
 * CLI interface
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config: Partial<TestOrchestrationConfig> = {};

  // Parse CLI arguments
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '');
    const value = args[i + 1];

    switch (key) {
      case 'mode':
        config.mode = value as any;
        break;
      case 'parallel':
        config.parallel = value === 'true';
        break;
      case 'concurrency':
        config.maxConcurrency = parseInt(value);
        break;
      case 'coverage-threshold':
      case 'threshold':
        config.coverageThreshold = parseInt(value);
        break;
      case 'performance-threshold':
        config.performanceThreshold = parseInt(value);
        break;
      case 'output':
        config.outputDir = value;
        break;
      case 'input':
        config.inputDir = value;
        break;
      case 'no-reports':
        config.generateReports = false;
        i--; // No value for this flag
        break;
      case 'help':
        console.log(`
Test Orchestrator Usage:

  tsx scripts/test/test-orchestrator.ts [options]

Options:
  --mode <mode>                   Test mode: all|unit|integration|security|performance|coverage|aggregate|status-check|deployment-validation|deployment-report
  --parallel <true|false>         Run tests in parallel (default: true)
  --concurrency <number>          Max concurrent tests (default: CPU cores / 2)
  --threshold <number>            Coverage threshold percentage (default: 80)
  --performance-threshold <number> Performance regression threshold (default: 10)
  --output <directory>            Output directory for reports (default: reports/orchestration)
  --input <directory>             Input directory for aggregation mode
  --no-reports                    Skip report generation
  --help                          Show this help

Examples:
  tsx scripts/test/test-orchestrator.ts --mode all
  tsx scripts/test/test-orchestrator.ts --mode unit --parallel false
  tsx scripts/test/test-orchestrator.ts --mode coverage --threshold 85
  tsx scripts/test/test-orchestrator.ts --mode aggregate --input test-results/
        `);
        process.exit(0);
    }
  }

  const orchestrator = new TestOrchestrator(config);
  
  try {
    const report = await orchestrator.execute();
    
    // Exit with appropriate code
    const exitCode = orchestrator['calculateExitCode'](report);
    process.exit(exitCode);
    
  } catch (error) {
    console.error('❌ Test orchestration failed:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main().catch(console.error);
}

export { TestOrchestrator, TestOrchestrationConfig, ComprehensiveReport };