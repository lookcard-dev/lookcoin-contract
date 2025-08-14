/**
 * Test Infrastructure Validator
 * 
 * Validates that all test infrastructure enhancements are working correctly
 * and provides health checks for the LookCoin test suite.
 */

import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

// Import enhanced infrastructure
import { 
  deployLookCoinFixture, 
  DeploymentFixture,
  TestDiagnosticTool,
  testDiagnostics,
  FailureCategory
} from "./testInfrastructure";
import { 
  trackGasUsage, 
  assertBalanceChanges, 
  resetTestState,
  unpauseAllContracts,
  resetSupplyOracleState
} from "./utils";
import { GasTracker } from "./gasAnalysis";

/**
 * Infrastructure validation results
 */
export interface ValidationResult {
  component: string;
  passed: boolean;
  error?: string;
  details?: any;
}

export interface InfrastructureHealthReport {
  overallHealth: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  validationResults: ValidationResult[];
  recommendations: string[];
  summary: {
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
  };
}

/**
 * Main infrastructure validator class
 */
export class InfrastructureValidator {
  private results: ValidationResult[] = [];

  /**
   * Run complete infrastructure validation suite
   */
  async validateInfrastructure(): Promise<InfrastructureHealthReport> {
    console.log('🔍 Starting test infrastructure validation...\n');
    
    this.results = [];

    // Test fixture deployment
    await this.validateFixtureDeployment();
    
    // Test transaction handling
    await this.validateTransactionHandling();
    
    // Test balance assertions
    await this.validateBalanceAssertions();
    
    // Test gas tracking
    await this.validateGasTracking();
    
    // Test state management
    await this.validateStateManagement();
    
    // Test diagnostic tools
    await this.validateDiagnosticTools();
    
    // Test mock contracts
    await this.validateMockContracts();

    return this.generateHealthReport();
  }

  /**
   * Validate fixture deployment and initialization
   */
  private async validateFixtureDeployment(): Promise<void> {
    console.log('📦 Validating fixture deployment...');
    
    try {
      const fixture = await loadFixture(deployLookCoinFixture);
      
      // Check that all required contracts are deployed
      const requiredContracts = [
        'lookCoin', 'crossChainRouter', 'supplyOracle', 
        'layerZeroModule', 'celerIMModule', 'hyperlaneModule',
        'mockLayerZero', 'mockCeler', 'mockHyperlane'
      ];
      
      for (const contractName of requiredContracts) {
        const contract = (fixture as any)[contractName];
        if (!contract) {
          throw new Error(`Contract ${contractName} not deployed in fixture`);
        }
        
        const address = await contract.getAddress();
        if (!address || address === ethers.ZeroAddress) {
          throw new Error(`Contract ${contractName} has invalid address: ${address}`);
        }
      }
      
      // Check that required signers are available
      const requiredSigners = [
        'owner', 'admin', 'governance', 'minter', 'burner', 
        'pauser', 'user1', 'user2'
      ];
      
      for (const signerName of requiredSigners) {
        const signer = (fixture as any)[signerName];
        if (!signer || !signer.address) {
          throw new Error(`Signer ${signerName} not available in fixture`);
        }
      }
      
      this.results.push({
        component: 'Fixture Deployment',
        passed: true,
        details: { 
          contractsDeployed: requiredContracts.length,
          signersAvailable: requiredSigners.length
        }
      });
      
    } catch (error) {
      this.results.push({
        component: 'Fixture Deployment',
        passed: false,
        error: `${error}`
      });
    }
  }

  /**
   * Validate enhanced transaction handling
   */
  private async validateTransactionHandling(): Promise<void> {
    console.log('🔄 Validating transaction handling...');
    
    try {
      const fixture = await loadFixture(deployLookCoinFixture);
      
      // Test successful transaction handling
      const mintAmount = ethers.parseEther('1000');
      const tx = await fixture.lookCoin.connect(fixture.minter).mint(fixture.user1.address, mintAmount);
      
      // Validate transaction result handling
      if (!tx || typeof tx.wait !== 'function') {
        throw new Error('Transaction result does not have wait function');
      }
      
      const receipt = await tx.wait();
      if (!receipt || !receipt.gasUsed) {
        throw new Error('Transaction receipt missing required properties');
      }
      
      // Test failed transaction handling
      try {
        await fixture.lookCoin.connect(fixture.user1).mint(fixture.user2.address, mintAmount);
        throw new Error('Expected transaction to fail due to permissions');
      } catch (error: any) {
        if (!error.message.includes('AccessControlUnauthorizedAccount')) {
          throw new Error(`Unexpected error message: ${error.message}`);
        }
      }
      
      this.results.push({
        component: 'Transaction Handling',
        passed: true,
        details: {
          successfulTransaction: true,
          failedTransactionHandled: true
        }
      });
      
    } catch (error) {
      this.results.push({
        component: 'Transaction Handling',
        passed: false,
        error: `${error}`
      });
    }
  }

  /**
   * Validate enhanced balance assertions
   */
  private async validateBalanceAssertions(): Promise<void> {
    console.log('⚖️ Validating balance assertions...');
    
    try {
      const fixture = await loadFixture(deployLookCoinFixture);
      
      const mintAmount = ethers.parseEther('500');
      
      // Test successful balance assertion
      await assertBalanceChanges(
        fixture.lookCoin,
        fixture.user1.address,
        mintAmount,
        async () => {
          await fixture.lookCoin.connect(fixture.minter).mint(fixture.user1.address, mintAmount);
        }
      );
      
      // Test balance assertion with tolerance
      await assertBalanceChanges(
        fixture.lookCoin,
        fixture.user1.address,
        ethers.parseEther('100'),
        async () => {
          await fixture.lookCoin.connect(fixture.minter).mint(fixture.user1.address, ethers.parseEther('100.0001'));
        },
        { tolerance: ethers.parseEther('0.001') }
      );
      
      // Test that balance assertion fails appropriately
      try {
        await assertBalanceChanges(
          fixture.lookCoin,
          fixture.user1.address,
          ethers.parseEther('1000'),
          async () => {
            await fixture.lookCoin.connect(fixture.minter).mint(fixture.user1.address, ethers.parseEther('500'));
          }
        );
        throw new Error('Expected balance assertion to fail');
      } catch (error: any) {
        if (!error.message.includes('Balance change assertion failed')) {
          throw new Error(`Unexpected error in balance assertion: ${error.message}`);
        }
      }
      
      this.results.push({
        component: 'Balance Assertions',
        passed: true,
        details: {
          successfulAssertion: true,
          toleranceSupported: true,
          failureDetection: true
        }
      });
      
    } catch (error) {
      this.results.push({
        component: 'Balance Assertions',
        passed: false,
        error: `${error}`
      });
    }
  }

  /**
   * Validate enhanced gas tracking
   */
  private async validateGasTracking(): Promise<void> {
    console.log('⛽ Validating gas tracking...');
    
    try {
      const fixture = await loadFixture(deployLookCoinFixture);
      const gasTracker = new GasTracker();
      
      // Test gas tracking with successful transaction
      const mintAmount = ethers.parseEther('250');
      const gasReport = await trackGasUsage(
        async () => {
          return fixture.lookCoin.connect(fixture.minter).mint(fixture.user1.address, mintAmount);
        },
        'mint_test'
      );
      
      if (!gasReport || !gasReport.gasUsed || gasReport.gasUsed === BigInt(0)) {
        throw new Error('Gas report missing or invalid');
      }
      
      // Test gas tracking with failed transaction
      const failedGasReport = await trackGasUsage(
        async () => {
          throw new Error('Simulated failure');
        },
        'failed_operation'
      );
      
      // Should return zero gas report for failed operations
      if (failedGasReport.gasUsed !== BigInt(0)) {
        throw new Error('Failed operations should return zero gas usage');
      }
      
      // Test GasTracker class
      await gasTracker.recordFromOperation(
        'test_operation',
        async () => {
          return fixture.lookCoin.connect(fixture.minter).mint(fixture.user2.address, mintAmount);
        }
      );
      
      const measurements = gasTracker.getMeasurements('test_operation');
      if (measurements.length === 0) {
        throw new Error('GasTracker failed to record measurements');
      }
      
      const avgGas = gasTracker.getAverageGas('test_operation');
      if (avgGas === 0) {
        throw new Error('GasTracker failed to calculate average gas');
      }
      
      this.results.push({
        component: 'Gas Tracking',
        passed: true,
        details: {
          gasReportGenerated: true,
          failureHandling: true,
          gasTrackerFunctional: true,
          averageGas: avgGas
        }
      });
      
    } catch (error) {
      this.results.push({
        component: 'Gas Tracking',
        passed: false,
        error: `${error}`
      });
    }
  }

  /**
   * Validate enhanced state management
   */
  private async validateStateManagement(): Promise<void> {
    console.log('🔄 Validating state management...');
    
    try {
      const fixture = await loadFixture(deployLookCoinFixture);
      
      // Test state reset functionality
      await resetTestState(fixture);
      
      // Test supply oracle reset
      await resetSupplyOracleState(fixture);
      
      // Test contract unpausing
      await unpauseAllContracts(fixture);
      
      // Verify contracts are in expected state after reset
      const lookCoinPaused = await fixture.lookCoin.paused();
      if (lookCoinPaused) {
        throw new Error('LookCoin should be unpaused after state reset');
      }
      
      const supplyOraclePaused = await fixture.supplyOracle.paused();
      if (supplyOraclePaused) {
        throw new Error('SupplyOracle should be unpaused after state reset');
      }
      
      this.results.push({
        component: 'State Management',
        passed: true,
        details: {
          stateResetCompleted: true,
          contractsUnpaused: true,
          supplyOracleReset: true
        }
      });
      
    } catch (error) {
      this.results.push({
        component: 'State Management',
        passed: false,
        error: `${error}`
      });
    }
  }

  /**
   * Validate diagnostic tools
   */
  private async validateDiagnosticTools(): Promise<void> {
    console.log('🔍 Validating diagnostic tools...');
    
    try {
      const fixture = await loadFixture(deployLookCoinFixture);
      const diagnosticTool = new TestDiagnosticTool();
      
      // Test diagnostic analysis of a simulated failure
      const testError = new Error('Simulated test failure for diagnostics');
      const diagnostic = await diagnosticTool.analyzeTestFailure(
        'test_diagnostic_validation',
        testError,
        fixture
      );
      
      if (!diagnostic) {
        throw new Error('Diagnostic tool failed to generate diagnostic');
      }
      
      if (!diagnostic.category || !diagnostic.severity || !diagnostic.recommendations) {
        throw new Error('Diagnostic missing required fields');
      }
      
      // Test diagnostic report generation
      const report = diagnosticTool.generateComprehensiveReport();
      if (!report || !report.diagnostics || report.diagnostics.length === 0) {
        throw new Error('Diagnostic report generation failed');
      }
      
      // Test global diagnostic instance
      const globalDiagnostic = await testDiagnostics.analyzeTestFailure(
        'global_diagnostic_test',
        new Error('Global diagnostic test'),
        fixture
      );
      
      if (!globalDiagnostic) {
        throw new Error('Global diagnostic instance not working');
      }
      
      this.results.push({
        component: 'Diagnostic Tools',
        passed: true,
        details: {
          diagnosticGenerated: true,
          reportGenerated: true,
          globalInstanceWorking: true,
          categoriesDetected: Object.keys(FailureCategory).length
        }
      });
      
    } catch (error) {
      this.results.push({
        component: 'Diagnostic Tools',
        passed: false,
        error: `${error}`
      });
    }
  }

  /**
   * Validate mock contracts
   */
  private async validateMockContracts(): Promise<void> {
    console.log('🎭 Validating mock contracts...');
    
    try {
      const fixture = await loadFixture(deployLookCoinFixture);
      
      // Test LayerZero mock
      const lzAddress = await fixture.mockLayerZero.getAddress();
      if (!lzAddress || lzAddress === ethers.ZeroAddress) {
        throw new Error('MockLayerZero has invalid address');
      }
      
      // Test basic functionality
      try {
        await fixture.mockLayerZero.estimatedFees(0, '0x', '0x', false, '0x');
      } catch (error) {
        // This might fail due to invalid parameters, but the function should exist
        if (!error.toString().includes('function') || error.toString().includes('does not exist')) {
          throw new Error('MockLayerZero basic functionality test failed');
        }
      }
      
      // Test Celer mock
      const celerAddress = await fixture.mockCeler.getAddress();
      if (!celerAddress || celerAddress === ethers.ZeroAddress) {
        throw new Error('MockMessageBus has invalid address');
      }
      
      // Test Hyperlane mock
      const hyperlaneAddress = await fixture.mockHyperlane.getAddress();
      if (!hyperlaneAddress || hyperlaneAddress === ethers.ZeroAddress) {
        throw new Error('MockHyperlaneMailbox has invalid address');
      }
      
      // Test Hyperlane gas paymaster mock
      const gasPaymasterAddress = await fixture.mockHyperlaneGasPaymaster.getAddress();
      if (!gasPaymasterAddress || gasPaymasterAddress === ethers.ZeroAddress) {
        throw new Error('MockHyperlaneGasPaymaster has invalid address');
      }
      
      this.results.push({
        component: 'Mock Contracts',
        passed: true,
        details: {
          layerZeroMockOperational: true,
          celerMockOperational: true,
          hyperlaneMockOperational: true,
          gasPaymasterMockOperational: true
        }
      });
      
    } catch (error) {
      this.results.push({
        component: 'Mock Contracts',
        passed: false,
        error: `${error}`
      });
    }
  }

  /**
   * Generate comprehensive health report
   */
  private generateHealthReport(): InfrastructureHealthReport {
    const passedChecks = this.results.filter(r => r.passed).length;
    const failedChecks = this.results.filter(r => !r.passed).length;
    const totalChecks = this.results.length;
    
    let overallHealth: 'healthy' | 'degraded' | 'unhealthy';
    
    if (failedChecks === 0) {
      overallHealth = 'healthy';
    } else if (failedChecks <= totalChecks * 0.25) { // Less than 25% failures
      overallHealth = 'degraded';
    } else {
      overallHealth = 'unhealthy';
    }
    
    const recommendations: string[] = [];
    
    // Generate recommendations based on failures
    for (const result of this.results) {
      if (!result.passed) {
        switch (result.component) {
          case 'Fixture Deployment':
            recommendations.push('Review fixture deployment process and ensure all required contracts are properly deployed');
            break;
          case 'Transaction Handling':
            recommendations.push('Check transaction handling logic and ensure proper error handling for failed transactions');
            break;
          case 'Balance Assertions':
            recommendations.push('Verify balance assertion logic and ensure tolerance calculations are working correctly');
            break;
          case 'Gas Tracking':
            recommendations.push('Review gas tracking implementation and ensure proper handling of different transaction types');
            break;
          case 'State Management':
            recommendations.push('Check state reset functionality and ensure proper cleanup between tests');
            break;
          case 'Diagnostic Tools':
            recommendations.push('Verify diagnostic tool implementation and ensure proper error categorization');
            break;
          case 'Mock Contracts':
            recommendations.push('Review mock contract deployment and ensure they provide the required functionality');
            break;
        }
      }
    }
    
    // Add general recommendations based on overall health
    if (overallHealth === 'degraded') {
      recommendations.push('Consider running individual component tests to isolate issues');
      recommendations.push('Review test environment setup and network conditions');
    } else if (overallHealth === 'unhealthy') {
      recommendations.push('Critical infrastructure issues detected - review all failing components');
      recommendations.push('Consider resetting test environment and redeploying infrastructure');
    }
    
    return {
      overallHealth,
      timestamp: Date.now(),
      validationResults: this.results,
      recommendations: [...new Set(recommendations)], // Remove duplicates
      summary: {
        totalChecks,
        passedChecks,
        failedChecks
      }
    };
  }
}

/**
 * Run infrastructure validation and log results
 */
export async function validateTestInfrastructure(): Promise<InfrastructureHealthReport> {
  const validator = new InfrastructureValidator();
  const report = await validator.validateInfrastructure();
  
  // Log results
  console.log('\n' + '='.repeat(80));
  console.log(`🏥 TEST INFRASTRUCTURE HEALTH REPORT`);
  console.log('='.repeat(80));
  console.log(`Overall Health: ${report.overallHealth.toUpperCase()}`);
  console.log(`Timestamp: ${new Date(report.timestamp).toISOString()}`);
  console.log(`\nSummary:`);
  console.log(`  Total Checks: ${report.summary.totalChecks}`);
  console.log(`  Passed: ${report.summary.passedChecks} ✅`);
  console.log(`  Failed: ${report.summary.failedChecks} ❌`);
  
  if (report.summary.failedChecks > 0) {
    console.log(`\n❌ Failed Components:`);
    report.validationResults
      .filter(r => !r.passed)
      .forEach(result => {
        console.log(`  • ${result.component}: ${result.error}`);
      });
  }
  
  if (report.recommendations.length > 0) {
    console.log(`\n💡 Recommendations:`);
    report.recommendations.forEach((rec, i) => {
      console.log(`  ${i + 1}. ${rec}`);
    });
  }
  
  console.log('\n' + '='.repeat(80));
  
  return report;
}

// Export validator instance for direct use
export const infrastructureValidator = new InfrastructureValidator();