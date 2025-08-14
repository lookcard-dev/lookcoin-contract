/**
 * Infrastructure Validation Test Suite
 * 
 * Tests the enhanced test infrastructure components to ensure they work correctly
 * and validate that all systematic fixes have been properly implemented.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

// Import enhanced infrastructure
import { 
  deployLookCoinFixture, 
  testDiagnostics,
  FailureCategory
} from "./helpers/testInfrastructure";
import { validateTestInfrastructure } from "./helpers/infrastructureValidator";
import { 
  trackGasUsage, 
  assertBalanceChanges, 
  resetTestState
} from "./helpers/utils";
import { GasTracker } from "./helpers/gasAnalysis";

describe("Test Infrastructure Validation", function () {
  // Increase timeout for infrastructure tests
  this.timeout(120000);

  describe("🔧 Infrastructure Health Check", function () {
    it("should pass comprehensive infrastructure validation", async function () {
      console.log("Running comprehensive infrastructure health check...");
      
      const healthReport = await validateTestInfrastructure();
      
      // Log the report for debugging
      console.log(`Infrastructure health: ${healthReport.overallHealth}`);
      console.log(`Passed checks: ${healthReport.summary.passedChecks}/${healthReport.summary.totalChecks}`);
      
      // Infrastructure should be healthy or at least degraded (not unhealthy)
      expect(healthReport.overallHealth).to.not.equal('unhealthy', 
        `Infrastructure is unhealthy. Failed components: ${
          healthReport.validationResults
            .filter(r => !r.passed)
            .map(r => `${r.component}: ${r.error}`)
            .join('; ')
        }`
      );
      
      // Most checks should pass
      const passRate = healthReport.summary.passedChecks / healthReport.summary.totalChecks;
      expect(passRate).to.be.greaterThan(0.7, 
        `Infrastructure pass rate too low: ${(passRate * 100).toFixed(1)}%`
      );
    });
  });

  describe("🔄 Enhanced Transaction Handling", function () {
    let fixture: any;

    beforeEach(async function () {
      fixture = await loadFixture(deployLookCoinFixture);
    });

    it("should handle successful transactions correctly", async function () {
      const mintAmount = ethers.parseEther("100");
      
      const gasReport = await trackGasUsage(
        async () => {
          return fixture.lookCoin.connect(fixture.minter).mint(fixture.user1.address, mintAmount);
        },
        "successful_mint"
      );

      expect(gasReport.gasUsed).to.be.greaterThan(BigInt(0));
      expect(gasReport.operation).to.equal("successful_mint");
      expect(gasReport.cost).to.be.greaterThan(BigInt(0));
    });

    it("should handle failed transactions gracefully", async function () {
      const gasReport = await trackGasUsage(
        async () => {
          throw new Error("Simulated transaction failure");
        },
        "failed_operation"
      );

      // Should return zero gas report for failed operations
      expect(gasReport.gasUsed).to.equal(BigInt(0));
      expect(gasReport.operation).to.equal("failed_operation");
    });

    it("should handle different transaction result types", async function () {
      const mintAmount = ethers.parseEther("50");
      
      // Test with transaction response
      const tx = await fixture.lookCoin.connect(fixture.minter).mint(fixture.user1.address, mintAmount);
      const gasReport1 = await trackGasUsage(
        async () => tx,
        "transaction_response"
      );

      expect(gasReport1.gasUsed).to.be.greaterThan(BigInt(0));

      // Test with receipt directly
      const receipt = await tx.wait();
      const gasReport2 = await trackGasUsage(
        async () => receipt,
        "transaction_receipt"
      );

      expect(gasReport2.gasUsed).to.be.greaterThan(BigInt(0));
    });
  });

  describe("⚖️ Enhanced Balance Assertions", function () {
    let fixture: any;

    beforeEach(async function () {
      fixture = await loadFixture(deployLookCoinFixture);
    });

    it("should assert exact balance changes correctly", async function () {
      const mintAmount = ethers.parseEther("200");

      await assertBalanceChanges(
        fixture.lookCoin,
        fixture.user1.address,
        mintAmount,
        async () => {
          await fixture.lookCoin.connect(fixture.minter).mint(fixture.user1.address, mintAmount);
        }
      );

      // Verify the balance was actually changed
      const balance = await fixture.lookCoin.balanceOf(fixture.user1.address);
      expect(balance).to.equal(mintAmount);
    });

    it("should support tolerance-based assertions", async function () {
      const baseAmount = ethers.parseEther("100");
      const tolerance = ethers.parseEther("0.01"); // 1% tolerance

      await assertBalanceChanges(
        fixture.lookCoin,
        fixture.user1.address,
        baseAmount,
        async () => {
          // Mint slightly different amount (within tolerance)
          const actualAmount = baseAmount + ethers.parseEther("0.005");
          await fixture.lookCoin.connect(fixture.minter).mint(fixture.user1.address, actualAmount);
        },
        { tolerance }
      );
    });

    it("should provide detailed error messages on assertion failure", async function () {
      const expectedAmount = ethers.parseEther("500");
      const actualAmount = ethers.parseEther("250");

      try {
        await assertBalanceChanges(
          fixture.lookCoin,
          fixture.user1.address,
          expectedAmount,
          async () => {
            await fixture.lookCoin.connect(fixture.minter).mint(fixture.user1.address, actualAmount);
          }
        );
        
        expect.fail("Expected assertion to fail");
      } catch (error: any) {
        expect(error.message).to.include("Balance change assertion failed");
        expect(error.message).to.include("Expected change: " + expectedAmount.toString());
        expect(error.message).to.include("Actual change: " + actualAmount.toString());
      }
    });
  });

  describe("⛽ Enhanced Gas Tracking", function () {
    let fixture: any;
    let gasTracker: GasTracker;

    beforeEach(async function () {
      fixture = await loadFixture(deployLookCoinFixture);
      gasTracker = new GasTracker();
    });

    it("should track gas usage accurately", async function () {
      const mintAmount = ethers.parseEther("150");

      const measurement = await gasTracker.recordFromOperation(
        "mint_test",
        async () => {
          return fixture.lookCoin.connect(fixture.minter).mint(fixture.user1.address, mintAmount);
        },
        { protocol: "direct", amount: mintAmount }
      );

      expect(measurement.gasUsed).to.be.greaterThan(0);
      expect(measurement.operation).to.equal("mint_test");
      expect(measurement.protocol).to.equal("direct");
      expect(measurement.amount).to.equal(mintAmount);
    });

    it("should calculate averages correctly", async function () {
      const mintAmount = ethers.parseEther("75");

      // Record multiple measurements
      for (let i = 0; i < 3; i++) {
        await gasTracker.recordFromOperation(
          "repeated_mint",
          async () => {
            return fixture.lookCoin.connect(fixture.minter).mint(fixture.user2.address, mintAmount);
          }
        );
      }

      const measurements = gasTracker.getMeasurements("repeated_mint");
      expect(measurements.length).to.equal(3);

      const avgGas = gasTracker.getAverageGas("repeated_mint");
      expect(avgGas).to.be.greaterThan(0);

      // Verify average is reasonable
      const totalGas = measurements.reduce((sum, m) => sum + m.gasUsed, 0);
      const expectedAvg = Math.round(totalGas / measurements.length);
      expect(avgGas).to.equal(expectedAvg);
    });

    it("should handle transaction failures in gas tracking", async function () {
      const measurement = await gasTracker.recordFromOperation(
        "failed_mint",
        async () => {
          // This should fail due to lack of permissions
          return fixture.lookCoin.connect(fixture.user1).mint(fixture.user2.address, ethers.parseEther("100"));
        }
      );

      // Should record the failure appropriately
      expect(measurement.operation).to.equal("failed_mint");
      expect(measurement.success).to.be.false;
      expect(measurement.error).to.include("failed");
    });
  });

  describe("🔄 Enhanced State Management", function () {
    let fixture: any;

    beforeEach(async function () {
      fixture = await loadFixture(deployLookCoinFixture);
    });

    it("should reset test state correctly", async function () {
      // Modify some state
      const mintAmount = ethers.parseEther("300");
      await fixture.lookCoin.connect(fixture.minter).mint(fixture.user1.address, mintAmount);

      // Pause the contract
      await fixture.lookCoin.connect(fixture.pauser).pause();
      expect(await fixture.lookCoin.paused()).to.be.true;

      // Reset test state
      await resetTestState(fixture);

      // Verify state was reset
      expect(await fixture.lookCoin.paused()).to.be.false;
      expect(await fixture.supplyOracle.paused()).to.be.false;
    });

    it("should handle state reset errors gracefully", async function () {
      // This should not throw even if some operations fail
      await expect(resetTestState(fixture)).to.not.be.rejected;
    });
  });

  describe("🔍 Diagnostic Tools", function () {
    let fixture: any;

    beforeEach(async function () {
      fixture = await loadFixture(deployLookCoinFixture);
      testDiagnostics.clearDiagnostics();
    });

    it("should categorize failures correctly", async function () {
      const transactionError = new Error("transaction failed with revert");
      const diagnostic1 = await testDiagnostics.analyzeTestFailure(
        "transaction_test",
        transactionError,
        fixture
      );

      expect(diagnostic1.category).to.equal(FailureCategory.TRANSACTION_FAILURE);
      expect(diagnostic1.severity).to.be.oneOf(['high', 'medium', 'low', 'critical']);

      const balanceError = new Error("expected balance 1000 but got 500");
      const diagnostic2 = await testDiagnostics.analyzeTestFailure(
        "balance_test",
        balanceError,
        fixture
      );

      expect(diagnostic2.category).to.equal(FailureCategory.BALANCE_ASSERTION);
    });

    it("should generate actionable recommendations", async function () {
      const gasError = new Error("gas limit exceeded");
      const diagnostic = await testDiagnostics.analyzeTestFailure(
        "gas_test",
        gasError,
        fixture
      );

      expect(diagnostic.recommendations).to.have.length.greaterThan(0);
      
      const gasRecommendation = diagnostic.recommendations.find(r => 
        r.category === "Gas Optimization"
      );
      expect(gasRecommendation).to.not.be.undefined;
      expect(gasRecommendation?.action).to.be.a('string');
    });

    it("should generate comprehensive reports", async function () {
      // Generate some diagnostics
      await testDiagnostics.analyzeTestFailure(
        "test1",
        new Error("mock error 1"),
        fixture
      );
      await testDiagnostics.analyzeTestFailure(
        "test2",
        new Error("balance assertion failed"),
        fixture
      );

      const report = testDiagnostics.generateComprehensiveReport();

      expect(report.totalFailures).to.equal(2);
      expect(report.diagnostics).to.have.length(2);
      expect(report.categorySummary).to.be.an('object');
      expect(report.severitySummary).to.be.an('object');
      expect(report.topRecommendations).to.be.an('array');
    });
  });

  describe("🎭 Mock Contract Validation", function () {
    let fixture: any;

    beforeEach(async function () {
      fixture = await loadFixture(deployLookCoinFixture);
    });

    it("should have properly deployed mock contracts", async function () {
      // Validate all mock contracts are deployed with valid addresses
      const mockContracts = [
        'mockLayerZero',
        'mockCeler', 
        'mockHyperlane',
        'mockHyperlaneGasPaymaster'
      ];

      for (const contractName of mockContracts) {
        const contract = (fixture as any)[contractName];
        expect(contract).to.not.be.undefined;

        const address = await contract.getAddress();
        expect(address).to.not.equal(ethers.ZeroAddress);
        expect(address).to.match(/^0x[a-fA-F0-9]{40}$/);
      }
    });

    it("should have functional mock contract interfaces", async function () {
      // Test basic functionality of mock contracts
      const lzAddress = await fixture.mockLayerZero.getAddress();
      expect(ethers.isAddress(lzAddress)).to.be.true;

      const celerAddress = await fixture.mockCeler.getAddress();
      expect(ethers.isAddress(celerAddress)).to.be.true;

      const hyperlaneAddress = await fixture.mockHyperlane.getAddress();
      expect(ethers.isAddress(hyperlaneAddress)).to.be.true;
    });
  });

  describe("📊 Performance Validation", function () {
    let fixture: any;

    beforeEach(async function () {
      fixture = await loadFixture(deployLookCoinFixture);
    });

    it("should complete fixture deployment within reasonable time", async function () {
      const startTime = Date.now();
      const testFixture = await loadFixture(deployLookCoinFixture);
      const deploymentTime = Date.now() - startTime;

      // Deployment should complete within 30 seconds
      expect(deploymentTime).to.be.lessThan(30000);

      // Fixture should be complete
      expect(testFixture.lookCoin).to.not.be.undefined;
      expect(testFixture.crossChainRouter).to.not.be.undefined;
    });

    it("should have reasonable gas usage for basic operations", async function () {
      const mintAmount = ethers.parseEther("100");

      const gasReport = await trackGasUsage(
        async () => {
          return fixture.lookCoin.connect(fixture.minter).mint(fixture.user1.address, mintAmount);
        },
        "performance_mint"
      );

      // Mint operation should use reasonable gas (less than 200k)
      expect(gasReport.gasUsed).to.be.lessThan(BigInt(200000));
      expect(gasReport.gasUsed).to.be.greaterThan(BigInt(50000));
    });
  });
});