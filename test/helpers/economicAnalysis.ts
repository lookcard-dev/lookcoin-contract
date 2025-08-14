import { ethers } from "hardhat";
import { expect } from "chai";

/**
 * @title Economic Analysis Helpers
 * @dev Comprehensive helpers for economic security testing and analysis
 * @notice Provides utilities for profit/loss analysis, market manipulation detection,
 *         and economic incentive validation for DeFi protocols
 */

// Economic analysis interfaces
export interface EconomicMetrics {
  totalProfit: bigint;
  totalLoss: bigint;
  netPosition: bigint;
  profitabilityRatio: number;
  riskAdjustedReturn: number;
  sharpeRatio: number;
}

export interface AttackProfitability {
  expectedProfit: bigint;
  actualProfit: bigint;
  gasCost: bigint;
  netProfit: bigint;
  profitMargin: number;
  successProbability: number;
}

export interface MarketImpactAnalysis {
  priceImpact: bigint;
  liquidityReduction: bigint;
  volumeIncrease: bigint;
  volatilityIncrease: number;
  marketEfficiency: number;
}

export interface FeeAnalysis {
  totalFeesCollected: bigint;
  averageFeeRate: number;
  feeEfficiency: number;
  revenueGenerated: bigint;
  feeOptimization: number;
}

export interface RiskMetrics {
  valueAtRisk: bigint;
  conditionalVaR: bigint;
  maxDrawdown: bigint;
  volatility: number;
  betaCoefficient: number;
  correlation: number;
}

// Economic analysis class
export class EconomicAnalysisHelper {
  private gasPrice: bigint;
  private ethPrice: bigint; // Price of ETH in USD (scaled by 1e18)
  private lookPrice: bigint; // Price of LOOK in USD (scaled by 1e18)

  constructor(
    gasPrice: bigint = ethers.parseUnits("20", "gwei"),
    ethPrice: bigint = ethers.parseEther("3000"), // $3000
    lookPrice: bigint = ethers.parseEther("1") // $1
  ) {
    this.gasPrice = gasPrice;
    this.ethPrice = ethPrice;
    this.lookPrice = lookPrice;
  }

  /**
   * @dev Calculate comprehensive economic metrics for an attack scenario
   * @param transactions Array of transaction data including costs and profits
   * @param timeframe Time period for the analysis
   * @return Economic metrics including profitability and risk measures
   */
  calculateEconomicMetrics(
    transactions: Array<{
      profit: bigint;
      loss: bigint;
      gasUsed: bigint;
      timestamp: number;
    }>,
    timeframe: number = 86400 // 24 hours default
  ): EconomicMetrics {
    let totalProfit = 0n;
    let totalLoss = 0n;
    let totalGasCost = 0n;

    for (const tx of transactions) {
      totalProfit += tx.profit;
      totalLoss += tx.loss + (tx.gasUsed * this.gasPrice);
      totalGasCost += tx.gasUsed * this.gasPrice;
    }

    const netPosition = totalProfit - totalLoss;
    const profitabilityRatio = totalLoss > 0n ? 
      Number(totalProfit * 10000n / totalLoss) / 10000 : 0;

    // Calculate risk-adjusted return (Sharpe ratio approximation)
    const returns = transactions.map(tx => 
      Number((tx.profit - tx.loss - (tx.gasUsed * this.gasPrice)) * 1000n / ethers.parseEther("1"))
    );
    
    const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const volatility = Math.sqrt(
      returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length
    );
    
    const sharpeRatio = volatility > 0 ? avgReturn / volatility : 0;
    const riskAdjustedReturn = avgReturn - (volatility * 0.1); // Risk penalty

    return {
      totalProfit,
      totalLoss,
      netPosition,
      profitabilityRatio,
      riskAdjustedReturn,
      sharpeRatio
    };
  }

  /**
   * @dev Analyze attack profitability with comprehensive cost accounting
   * @param attackType Type of attack being analyzed
   * @param attackParams Parameters of the attack
   * @param executionData Actual execution results
   * @return Detailed profitability analysis
   */
  analyzeAttackProfitability(
    attackType: string,
    attackParams: {
      amount: bigint;
      duration: number;
      complexity: number;
    },
    executionData: {
      actualProfit: bigint;
      gasUsed: bigint;
      successCount: number;
      totalAttempts: number;
    }
  ): AttackProfitability {
    // Calculate expected profit based on attack type and parameters
    const expectedProfit = this.calculateExpectedProfit(attackType, attackParams);
    
    // Calculate total gas costs
    const gasCost = executionData.gasUsed * this.gasPrice;
    
    // Calculate net profit after all costs
    const netProfit = executionData.actualProfit - gasCost;
    
    // Calculate profit margin
    const totalCost = gasCost;
    const profitMargin = totalCost > 0n ? 
      Number((netProfit * 10000n) / totalCost) / 100 : 0;
    
    // Calculate success probability
    const successProbability = executionData.totalAttempts > 0 ? 
      (executionData.successCount * 100) / executionData.totalAttempts : 0;

    return {
      expectedProfit,
      actualProfit: executionData.actualProfit,
      gasCost,
      netProfit,
      profitMargin,
      successProbability
    };
  }

  /**
   * @dev Calculate expected profit for different attack types
   */
  private calculateExpectedProfit(
    attackType: string,
    params: { amount: bigint; duration: number; complexity: number }
  ): bigint {
    switch (attackType.toLowerCase()) {
      case "sandwich":
        // Sandwich attacks typically extract 0.1-0.3% of volume
        return params.amount * 25n / 10000n; // 0.25% average

      case "mev":
        // MEV extraction varies widely, 0.05-0.5% of volume
        return params.amount * 15n / 10000n; // 0.15% average

      case "fee_manipulation":
        // Fee manipulation saves on fees, typically 50-90% of fee amount
        const estimatedFee = params.amount * 50n / 10000n; // 0.5% fee assumption
        return estimatedFee * 70n / 100n; // 70% savings

      case "liquidity_drainage":
        // Liquidity drainage profits from arbitrage, 0.5-2% depending on market conditions
        return params.amount * 100n / 10000n; // 1% average

      case "cross_chain_arbitrage":
        // Cross-chain arbitrage typically 0.2-1% depending on price differences
        return params.amount * 60n / 10000n; // 0.6% average

      case "velocity_manipulation":
        // Velocity attacks extract small amounts repeatedly, 0.01-0.1% per cycle
        const cycles = BigInt(params.duration / 3600); // Hourly cycles
        return params.amount * 5n / 10000n * cycles; // 0.05% per cycle

      default:
        return params.amount / 1000n; // Default 0.1% profit estimate
    }
  }

  /**
   * @dev Analyze market impact of attack transactions
   * @param preAttackState Market state before attack
   * @param postAttackState Market state after attack
   * @param attackVolume Total volume of attack transactions
   * @return Market impact analysis
   */
  analyzeMarketImpact(
    preAttackState: {
      price: bigint;
      liquidity: bigint;
      volume24h: bigint;
      volatility: number;
    },
    postAttackState: {
      price: bigint;
      liquidity: bigint;
      volume24h: bigint;
      volatility: number;
    },
    attackVolume: bigint
  ): MarketImpactAnalysis {
    // Calculate price impact
    const priceImpact = postAttackState.price > preAttackState.price ?
      postAttackState.price - preAttackState.price :
      preAttackState.price - postAttackState.price;

    // Calculate liquidity reduction
    const liquidityReduction = preAttackState.liquidity > postAttackState.liquidity ?
      preAttackState.liquidity - postAttackState.liquidity : 0n;

    // Calculate volume increase
    const volumeIncrease = postAttackState.volume24h > preAttackState.volume24h ?
      postAttackState.volume24h - preAttackState.volume24h : 0n;

    // Calculate volatility increase
    const volatilityIncrease = postAttackState.volatility - preAttackState.volatility;

    // Calculate market efficiency (lower is better after attack)
    const preEfficiency = this.calculateMarketEfficiency(preAttackState);
    const postEfficiency = this.calculateMarketEfficiency(postAttackState);
    const marketEfficiency = postEfficiency / preEfficiency;

    return {
      priceImpact,
      liquidityReduction,
      volumeIncrease,
      volatilityIncrease,
      marketEfficiency
    };
  }

  /**
   * @dev Calculate market efficiency score
   */
  private calculateMarketEfficiency(state: {
    price: bigint;
    liquidity: bigint;
    volume24h: bigint;
    volatility: number;
  }): number {
    // Higher liquidity and volume with lower volatility = more efficient
    const liquidityScore = Number(state.liquidity / ethers.parseEther("1"));
    const volumeScore = Number(state.volume24h / ethers.parseEther("1"));
    const volatilityPenalty = state.volatility * 100;
    
    return (liquidityScore + volumeScore) / (1 + volatilityPenalty);
  }

  /**
   * @dev Analyze fee structure and efficiency
   * @param feeData Array of fee collection data
   * @param volumeData Array of corresponding volume data
   * @return Fee analysis results
   */
  analyzeFeeStructure(
    feeData: Array<{
      feeAmount: bigint;
      feeRate: number;
      timestamp: number;
    }>,
    volumeData: Array<{
      volume: bigint;
      timestamp: number;
    }>
  ): FeeAnalysis {
    const totalFeesCollected = feeData.reduce((sum, fee) => sum + fee.feeAmount, 0n);
    const totalVolume = volumeData.reduce((sum, vol) => sum + vol.volume, 0n);
    
    // Calculate average fee rate
    const averageFeeRate = feeData.reduce((sum, fee) => sum + fee.feeRate, 0) / feeData.length;
    
    // Calculate fee efficiency (fees collected vs potential maximum fees)
    const potentialMaxFees = totalVolume * 100n / 10000n; // Assume 1% max fee
    const feeEfficiency = potentialMaxFees > 0n ? 
      Number(totalFeesCollected * 10000n / potentialMaxFees) / 100 : 0;

    // Calculate revenue in USD
    const revenueGenerated = totalFeesCollected * this.lookPrice / ethers.parseEther("1");

    // Calculate fee optimization score (balance between collection and usage)
    const volumeGrowthRate = this.calculateVolumeGrowthRate(volumeData);
    const feeOptimization = feeEfficiency * (1 + volumeGrowthRate / 100);

    return {
      totalFeesCollected,
      averageFeeRate,
      feeEfficiency,
      revenueGenerated,
      feeOptimization
    };
  }

  /**
   * @dev Calculate volume growth rate
   */
  private calculateVolumeGrowthRate(volumeData: Array<{ volume: bigint; timestamp: number }>): number {
    if (volumeData.length < 2) return 0;

    const sortedData = volumeData.sort((a, b) => a.timestamp - b.timestamp);
    const firstHalf = sortedData.slice(0, Math.floor(sortedData.length / 2));
    const secondHalf = sortedData.slice(Math.floor(sortedData.length / 2));

    const firstHalfVolume = firstHalf.reduce((sum, vol) => sum + vol.volume, 0n);
    const secondHalfVolume = secondHalf.reduce((sum, vol) => sum + vol.volume, 0n);

    if (firstHalfVolume === 0n) return 0;
    
    return Number((secondHalfVolume - firstHalfVolume) * 100n / firstHalfVolume);
  }

  /**
   * @dev Calculate comprehensive risk metrics
   * @param returns Array of return data points
   * @param benchmark Benchmark return data
   * @return Risk metrics including VaR, drawdown, and correlation
   */
  calculateRiskMetrics(
    returns: Array<{
      value: bigint;
      timestamp: number;
    }>,
    benchmark?: Array<{
      value: bigint;
      timestamp: number;
    }>
  ): RiskMetrics {
    const returnValues = returns.map(r => Number(r.value * 1000n / ethers.parseEther("1")));
    
    // Calculate Value at Risk (95% confidence level)
    const sortedReturns = returnValues.sort((a, b) => a - b);
    const var95Index = Math.floor(sortedReturns.length * 0.05);
    const valueAtRisk = BigInt(Math.abs(sortedReturns[var95Index])) * ethers.parseEther("1") / 1000n;

    // Calculate Conditional VaR (Expected Shortfall)
    const tailReturns = sortedReturns.slice(0, var95Index + 1);
    const avgTailReturn = tailReturns.reduce((sum, ret) => sum + ret, 0) / tailReturns.length;
    const conditionalVaR = BigInt(Math.abs(avgTailReturn)) * ethers.parseEther("1") / 1000n;

    // Calculate Maximum Drawdown
    let maxDrawdown = 0n;
    let peak = returns[0]?.value || 0n;
    
    for (const ret of returns) {
      if (ret.value > peak) {
        peak = ret.value;
      } else {
        const drawdown = peak - ret.value;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
    }

    // Calculate volatility
    const avgReturn = returnValues.reduce((sum, ret) => sum + ret, 0) / returnValues.length;
    const variance = returnValues.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returnValues.length;
    const volatility = Math.sqrt(variance);

    // Calculate beta coefficient (if benchmark provided)
    let betaCoefficient = 1.0;
    let correlation = 0;
    
    if (benchmark && benchmark.length === returns.length) {
      const benchmarkReturns = benchmark.map(b => Number(b.value * 1000n / ethers.parseEther("1")));
      const avgBenchmark = benchmarkReturns.reduce((sum, ret) => sum + ret, 0) / benchmarkReturns.length;
      
      let covariance = 0;
      let benchmarkVariance = 0;
      let correlationNum = 0;
      let correlationDenom1 = 0;
      let correlationDenom2 = 0;
      
      for (let i = 0; i < returns.length; i++) {
        const retDiff = returnValues[i] - avgReturn;
        const benchDiff = benchmarkReturns[i] - avgBenchmark;
        
        covariance += retDiff * benchDiff;
        benchmarkVariance += benchDiff * benchDiff;
        
        correlationNum += retDiff * benchDiff;
        correlationDenom1 += retDiff * retDiff;
        correlationDenom2 += benchDiff * benchDiff;
      }
      
      covariance /= returns.length;
      benchmarkVariance /= returns.length;
      
      betaCoefficient = benchmarkVariance > 0 ? covariance / benchmarkVariance : 1.0;
      
      const correlationDenom = Math.sqrt(correlationDenom1 * correlationDenom2);
      correlation = correlationDenom > 0 ? correlationNum / correlationDenom : 0;
    }

    return {
      valueAtRisk,
      conditionalVaR,
      maxDrawdown,
      volatility,
      betaCoefficient,
      correlation
    };
  }

  /**
   * @dev Validate economic incentives for protocol participants
   * @param participantType Type of participant (user, validator, attacker)
   * @param actionType Action being analyzed
   * @param costs Costs associated with the action
   * @param benefits Benefits from the action
   * @return Whether incentives are properly aligned
   */
  validateEconomicIncentives(
    participantType: string,
    actionType: string,
    costs: {
      gasCost: bigint;
      opportunityCost: bigint;
      riskPremium: bigint;
    },
    benefits: {
      directReward: bigint;
      indirectBenefit: bigint;
      reputationValue: bigint;
    }
  ): {
    isIncentiveAligned: boolean;
    incentiveRatio: number;
    riskAdjustedReturn: number;
    recommendation: string;
  } {
    const totalCosts = costs.gasCost + costs.opportunityCost + costs.riskPremium;
    const totalBenefits = benefits.directReward + benefits.indirectBenefit + benefits.reputationValue;
    
    const incentiveRatio = totalCosts > 0n ? 
      Number(totalBenefits * 1000n / totalCosts) / 1000 : 0;
    
    const riskAdjustedReturn = Number((totalBenefits - totalCosts) * 1000n / ethers.parseEther("1"));
    
    let isIncentiveAligned = false;
    let recommendation = "";
    
    if (participantType.toLowerCase() === "attacker") {
      // For attackers, we want negative incentives
      isIncentiveAligned = incentiveRatio < 1.0;
      recommendation = isIncentiveAligned ? 
        "Attack incentives properly disincentivized" :
        "WARNING: Attack may be profitable - increase costs or reduce potential benefits";
    } else {
      // For legitimate participants, we want positive incentives
      isIncentiveAligned = incentiveRatio > 1.2; // 20% minimum return
      recommendation = isIncentiveAligned ?
        "Incentives properly aligned for honest behavior" :
        "Consider increasing rewards or reducing costs for honest participants";
    }

    return {
      isIncentiveAligned,
      incentiveRatio,
      riskAdjustedReturn,
      recommendation
    };
  }

  /**
   * @dev Simulate economic attack scenarios with Monte Carlo method
   * @param attackType Type of attack to simulate
   * @param parameters Attack parameters
   * @param iterations Number of simulation iterations
   * @return Simulation results with confidence intervals
   */
  async simulateAttackScenarios(
    attackType: string,
    parameters: {
      minAmount: bigint;
      maxAmount: bigint;
      minDuration: number;
      maxDuration: number;
      successRate: number;
    },
    iterations: number = 1000
  ): Promise<{
    averageProfit: bigint;
    profitStdDev: bigint;
    successProbability: number;
    confidence95: { lower: bigint; upper: bigint };
    breakEvenProbability: number;
    recommendation: string;
  }> {
    const results: bigint[] = [];
    let successCount = 0;
    let breakEvenCount = 0;
    
    for (let i = 0; i < iterations; i++) {
      // Generate random parameters within bounds
      const randomAmount = parameters.minAmount + 
        BigInt(Math.floor(Math.random() * Number(parameters.maxAmount - parameters.minAmount)));
      const randomDuration = parameters.minDuration + 
        Math.floor(Math.random() * (parameters.maxDuration - parameters.minDuration));
      
      // Simulate attack execution
      const success = Math.random() < (parameters.successRate / 100);
      
      if (success) {
        const profit = this.calculateExpectedProfit(attackType, {
          amount: randomAmount,
          duration: randomDuration,
          complexity: Math.random() * 10
        });
        
        // Add randomness to profit (±50% variation)
        const variation = 0.5 + Math.random();
        const actualProfit = BigInt(Math.floor(Number(profit) * variation));
        
        // Subtract estimated gas costs
        const gasCost = BigInt(Math.floor(200000 * Number(this.gasPrice) * (1 + Math.random())));
        const netProfit = actualProfit - gasCost;
        
        results.push(netProfit);
        successCount++;
        
        if (netProfit >= 0n) {
          breakEvenCount++;
        }
      } else {
        // Failed attack - only gas costs
        const gasCost = BigInt(Math.floor(100000 * Number(this.gasPrice) * (1 + Math.random())));
        results.push(-gasCost);
      }
    }
    
    // Calculate statistics
    const averageProfit = results.reduce((sum, profit) => sum + profit, 0n) / BigInt(results.length);
    
    // Calculate standard deviation
    const variance = results.reduce((sum, profit) => {
      const diff = profit - averageProfit;
      return sum + (diff * diff);
    }, 0n) / BigInt(results.length);
    const profitStdDev = BigInt(Math.floor(Math.sqrt(Number(variance))));
    
    // Calculate confidence intervals
    const sortedResults = results.sort((a, b) => Number(a - b));
    const lowerIndex = Math.floor(iterations * 0.025);
    const upperIndex = Math.floor(iterations * 0.975);
    
    const confidence95 = {
      lower: sortedResults[lowerIndex],
      upper: sortedResults[upperIndex]
    };
    
    const successProbability = (successCount * 100) / iterations;
    const breakEvenProbability = (breakEvenCount * 100) / iterations;
    
    // Generate recommendation
    let recommendation = "";
    if (breakEvenProbability > 50) {
      recommendation = "HIGH RISK: Attack has >50% probability of being profitable. Increase defensive measures.";
    } else if (breakEvenProbability > 25) {
      recommendation = "MEDIUM RISK: Attack has moderate profitability. Monitor and consider additional protections.";
    } else {
      recommendation = "LOW RISK: Attack is likely unprofitable. Current protections appear adequate.";
    }
    
    return {
      averageProfit,
      profitStdDev,
      successProbability,
      confidence95,
      breakEvenProbability,
      recommendation
    };
  }

  /**
   * @dev Update economic parameters for analysis
   */
  updateEconomicParameters(
    gasPrice?: bigint,
    ethPrice?: bigint,
    lookPrice?: bigint
  ): void {
    if (gasPrice) this.gasPrice = gasPrice;
    if (ethPrice) this.ethPrice = ethPrice;
    if (lookPrice) this.lookPrice = lookPrice;
  }

  /**
   * @dev Get current economic parameters
   */
  getEconomicParameters(): {
    gasPrice: bigint;
    ethPrice: bigint;
    lookPrice: bigint;
  } {
    return {
      gasPrice: this.gasPrice,
      ethPrice: this.ethPrice,
      lookPrice: this.lookPrice
    };
  }
}

// Utility functions for economic testing
export class EconomicTestUtils {
  /**
   * @dev Create realistic market conditions for testing
   */
  static createMarketConditions(volatility: "low" | "medium" | "high" = "medium"): {
    price: bigint;
    liquidity: bigint;
    volume24h: bigint;
    volatility: number;
  } {
    const basePrice = ethers.parseEther("1"); // $1 base price
    const baseLiquidity = ethers.parseEther("1000000"); // 1M liquidity
    const baseVolume = ethers.parseEther("100000"); // 100K daily volume
    
    let volatilityMultiplier: number;
    switch (volatility) {
      case "low":
        volatilityMultiplier = 0.02; // 2%
        break;
      case "high":
        volatilityMultiplier = 0.15; // 15%
        break;
      default:
        volatilityMultiplier = 0.05; // 5%
    }
    
    // Add random variation
    const priceVariation = 1 + (Math.random() - 0.5) * volatilityMultiplier;
    const liquidityVariation = 1 + (Math.random() - 0.5) * 0.1;
    const volumeVariation = 1 + (Math.random() - 0.5) * 0.3;
    
    return {
      price: BigInt(Math.floor(Number(basePrice) * priceVariation)),
      liquidity: BigInt(Math.floor(Number(baseLiquidity) * liquidityVariation)),
      volume24h: BigInt(Math.floor(Number(baseVolume) * volumeVariation)),
      volatility: volatilityMultiplier
    };
  }

  /**
   * @dev Generate realistic transaction data for testing
   */
  static generateTransactionData(
    count: number,
    attackType: string,
    baseAmount: bigint = ethers.parseEther("1000")
  ): Array<{
    profit: bigint;
    loss: bigint;
    gasUsed: bigint;
    timestamp: number;
  }> {
    const transactions = [];
    const currentTime = Math.floor(Date.now() / 1000);
    
    for (let i = 0; i < count; i++) {
      // Generate realistic profit/loss based on attack type
      let profit = 0n;
      let loss = 0n;
      
      const amount = baseAmount + BigInt(Math.floor(Math.random() * Number(baseAmount) / 2));
      const success = Math.random() < 0.7; // 70% success rate
      
      if (success) {
        switch (attackType.toLowerCase()) {
          case "sandwich":
            profit = amount * BigInt(Math.floor(Math.random() * 30)) / 10000n; // 0-0.3%
            break;
          case "mev":
            profit = amount * BigInt(Math.floor(Math.random() * 50)) / 10000n; // 0-0.5%
            break;
          case "arbitrage":
            profit = amount * BigInt(Math.floor(Math.random() * 100)) / 10000n; // 0-1%
            break;
          default:
            profit = amount * BigInt(Math.floor(Math.random() * 20)) / 10000n; // 0-0.2%
        }
      } else {
        // Failed attack - only losses
        loss = amount / 1000n; // 0.1% loss on failure
      }
      
      const gasUsed = BigInt(150000 + Math.floor(Math.random() * 100000)); // 150-250k gas
      const timestamp = currentTime - (Math.floor(Math.random() * 86400)); // Within last 24h
      
      transactions.push({
        profit,
        loss,
        gasUsed,
        timestamp
      });
    }
    
    return transactions;
  }

  /**
   * @dev Assert economic invariants hold after operations
   */
  static assertEconomicInvariants(
    preState: { balance: bigint; supply: bigint },
    postState: { balance: bigint; supply: bigint },
    operations: Array<{ type: string; amount: bigint }>
  ): void {
    // Supply invariants
    let expectedSupplyChange = 0n;
    for (const op of operations) {
      if (op.type === "mint") {
        expectedSupplyChange += op.amount;
      } else if (op.type === "burn") {
        expectedSupplyChange -= op.amount;
      }
    }
    
    const actualSupplyChange = postState.supply - preState.supply;
    expect(actualSupplyChange).to.equal(expectedSupplyChange, "Supply invariant violated");
    
    // Balance conservation (for non-mint/burn operations)
    const nonMintBurnOps = operations.filter(op => op.type !== "mint" && op.type !== "burn");
    if (nonMintBurnOps.length > 0) {
      // Balance should only change by mint/burn amounts
      const expectedBalanceChange = operations
        .filter(op => op.type === "mint" || op.type === "burn")
        .reduce((sum, op) => sum + (op.type === "mint" ? op.amount : -op.amount), 0n);
      
      const actualBalanceChange = postState.balance - preState.balance;
      expect(actualBalanceChange).to.equal(expectedBalanceChange, "Balance conservation violated");
    }
  }

  /**
   * @dev Generate stress test scenarios
   */
  static generateStressTestScenarios(): Array<{
    name: string;
    description: string;
    parameters: {
      transactionCount: number;
      maxAmount: bigint;
      attackTypes: string[];
      duration: number;
    };
  }> {
    return [
      {
        name: "High Frequency Attack",
        description: "Rapid succession of small attacks to test rate limiting",
        parameters: {
          transactionCount: 100,
          maxAmount: ethers.parseEther("1000"),
          attackTypes: ["sandwich", "mev"],
          duration: 300 // 5 minutes
        }
      },
      {
        name: "Large Volume Attack",
        description: "Single large attack to test liquidity limits",
        parameters: {
          transactionCount: 1,
          maxAmount: ethers.parseEther("1000000"),
          attackTypes: ["liquidity_drainage"],
          duration: 60 // 1 minute
        }
      },
      {
        name: "Coordinated Multi-Vector",
        description: "Multiple attack types executed simultaneously",
        parameters: {
          transactionCount: 50,
          maxAmount: ethers.parseEther("100000"),
          attackTypes: ["sandwich", "mev", "arbitrage", "fee_manipulation"],
          duration: 900 // 15 minutes
        }
      },
      {
        name: "Extended Duration Attack",
        description: "Long-running attack to test sustained resistance",
        parameters: {
          transactionCount: 500,
          maxAmount: ethers.parseEther("10000"),
          attackTypes: ["velocity_manipulation"],
          duration: 86400 // 24 hours
        }
      }
    ];
  }
}

// Export helper instance for immediate use
export const economicAnalysis = new EconomicAnalysisHelper();
export const economicTestUtils = EconomicTestUtils;