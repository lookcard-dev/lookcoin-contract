import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  LookCoin,
  SandwichAttacker,
  MEVExtractor,
  FeeManipulator,
  LiquidityDrainer,
  CrossChainArbitrageBot,
  TokenVelocityAttacker,
  MockLayerZeroEndpoint,
  CelerIMModule,
  CrossChainRouter
} from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { 
  economicAnalysis, 
  economicTestUtils, 
  EconomicAnalysisHelper,
  AttackProfitability,
  MarketImpactAnalysis,
  EconomicMetrics
} from "../helpers/economicAnalysis";
import { CONTRACT_ROLES, AMOUNTS, TEST_CHAINS, ERROR_MESSAGES } from "../helpers/constants";

/**
 * @title Economic Attack Vector Tests
 * @dev Comprehensive testing suite for economic security vulnerabilities
 * @notice Tests various economic attack scenarios including MEV, arbitrage, 
 *         fee manipulation, and market manipulation attacks
 * @dev Validates economic security measures and profit/loss calculations
 */
describe("Economic Attack Vector Tests", function () {
  // Contract instances
  let lookCoin: LookCoin;
  let sandwichAttacker: SandwichAttacker;
  let mevExtractor: MEVExtractor;
  let feeManipulator: FeeManipulator;
  let liquidityDrainer: LiquidityDrainer;
  let arbitrageBot: CrossChainArbitrageBot;
  let velocityAttacker: TokenVelocityAttacker;
  let mockEndpoint: MockLayerZeroEndpoint;
  let celerModule: CelerIMModule;
  let crossChainRouter: CrossChainRouter;

  // Test accounts
  let admin: SignerWithAddress;
  let attacker: SignerWithAddress;
  let victim: SignerWithAddress;
  let mpcVault: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let users: SignerWithAddress[];

  // Economic analysis helper
  let economicHelper: EconomicAnalysisHelper;

  // Test constants
  const INITIAL_SUPPLY = ethers.parseEther("1000000"); // 1M LOOK for testing
  const ATTACK_AMOUNT = ethers.parseEther("10000"); // 10K LOOK per attack
  const GAS_PRICE = ethers.parseUnits("20", "gwei");
  const ETH_PRICE = ethers.parseEther("3000"); // $3000 ETH
  const LOOK_PRICE = ethers.parseEther("1"); // $1 LOOK

  /**
   * @dev Deploy all contracts and set up test environment
   */
  async function deployEconomicTestFixture() {
    const signers = await ethers.getSigners();
    [admin, attacker, victim, mpcVault, feeCollector, ...users] = signers;

    // Deploy MockLayerZeroEndpoint
    const MockLayerZeroEndpoint = await ethers.getContractFactory("MockLayerZeroEndpoint");
    mockEndpoint = await MockLayerZeroEndpoint.deploy();

    // Deploy LookCoin
    const LookCoin = await ethers.getContractFactory("LookCoin");
    lookCoin = await upgrades.deployProxy(
      LookCoin,
      [admin.address, await mockEndpoint.getAddress()],
      { initializer: "initialize", kind: "uups" }
    ) as unknown as LookCoin;

    // Grant roles
    await lookCoin.grantRole(CONTRACT_ROLES.LookCoin.MINTER_ROLE, mpcVault.address);
    await lookCoin.grantRole(CONTRACT_ROLES.LookCoin.BURNER_ROLE, mpcVault.address);

    // Mint initial supply for testing
    await lookCoin.connect(mpcVault).mint(admin.address, INITIAL_SUPPLY);

    // Deploy Celer IM Module mock
    const MockMessageBus = await ethers.getContractFactory("MockMessageBus");
    const mockMessageBus = await MockMessageBus.deploy();

    const CelerIMModule = await ethers.getContractFactory("CelerIMModule");
    celerModule = await upgrades.deployProxy(
      CelerIMModule,
      [await mockMessageBus.getAddress(), await lookCoin.getAddress(), admin.address],
      { initializer: "initialize", kind: "uups" }
    ) as unknown as CelerIMModule;

    // Deploy FeeManager
    const FeeManager = await ethers.getContractFactory("FeeManager");
    const feeManager = await upgrades.deployProxy(
      FeeManager,
      [admin.address],
      { initializer: "initialize", kind: "uups" }
    );

    // Deploy SecurityManager
    const SecurityManager = await ethers.getContractFactory("SecurityManager");
    const securityManager = await upgrades.deployProxy(
      SecurityManager,
      [await lookCoin.getAddress(), admin.address],
      { initializer: "initialize", kind: "uups" }
    );

    // Deploy CrossChainRouter
    const CrossChainRouter = await ethers.getContractFactory("CrossChainRouter");
    crossChainRouter = await upgrades.deployProxy(
      CrossChainRouter,
      [
        await lookCoin.getAddress(), 
        await feeManager.getAddress(), 
        await securityManager.getAddress(), 
        admin.address
      ],
      { initializer: "initialize", kind: "uups" }
    ) as unknown as CrossChainRouter;

    // Deploy attack contracts
    const SandwichAttacker = await ethers.getContractFactory("SandwichAttacker");
    sandwichAttacker = await SandwichAttacker.deploy(
      await lookCoin.getAddress(),
      await crossChainRouter.getAddress()
    );

    const MEVExtractor = await ethers.getContractFactory("MEVExtractor");
    mevExtractor = await MEVExtractor.deploy(
      await lookCoin.getAddress(),
      await crossChainRouter.getAddress()
    );

    const FeeManipulator = await ethers.getContractFactory("FeeManipulator");
    feeManipulator = await FeeManipulator.deploy(
      await lookCoin.getAddress(),
      await crossChainRouter.getAddress()
    );

    const LiquidityDrainer = await ethers.getContractFactory("LiquidityDrainer");
    liquidityDrainer = await LiquidityDrainer.deploy(
      await lookCoin.getAddress(),
      await crossChainRouter.getAddress()
    );

    const CrossChainArbitrageBot = await ethers.getContractFactory("CrossChainArbitrageBot");
    arbitrageBot = await CrossChainArbitrageBot.deploy(
      await lookCoin.getAddress(),
      await crossChainRouter.getAddress()
    );

    const TokenVelocityAttacker = await ethers.getContractFactory("TokenVelocityAttacker");
    velocityAttacker = await TokenVelocityAttacker.deploy(
      await lookCoin.getAddress(),
      await crossChainRouter.getAddress()
    );

    // Setup LayerZero configuration
    await lookCoin.connectPeer(TEST_CHAINS.BSC_TESTNET, 
      ethers.zeroPadValue(await lookCoin.getAddress(), 32));
    await lookCoin.setEnforcedOptions(TEST_CHAINS.BSC_TESTNET, 350000);

    // Fund attackers for testing
    const attackerFunding = ATTACK_AMOUNT * 10n; // 10x attack amount
    await lookCoin.transfer(await sandwichAttacker.getAddress(), attackerFunding);
    await lookCoin.transfer(await mevExtractor.getAddress(), attackerFunding);
    await lookCoin.transfer(await feeManipulator.getAddress(), attackerFunding);
    await lookCoin.transfer(await liquidityDrainer.getAddress(), attackerFunding);
    await lookCoin.transfer(await arbitrageBot.getAddress(), attackerFunding);
    await lookCoin.transfer(await velocityAttacker.getAddress(), attackerFunding);

    // Fund users
    for (let i = 0; i < Math.min(users.length, 5); i++) {
      await lookCoin.transfer(users[i].address, AMOUNTS.THOUSAND_TOKENS);
    }

    // Initialize economic helper
    economicHelper = new EconomicAnalysisHelper(GAS_PRICE, ETH_PRICE, LOOK_PRICE);

    return {
      lookCoin,
      sandwichAttacker,
      mevExtractor,
      feeManipulator,
      liquidityDrainer,
      arbitrageBot,
      velocityAttacker,
      mockEndpoint,
      celerModule,
      crossChainRouter,
      admin,
      attacker,
      victim,
      mpcVault,
      feeCollector,
      users,
      economicHelper
    };
  }

  beforeEach(async function () {
    const fixture = await loadFixture(deployEconomicTestFixture);
    Object.assign(this, fixture);
    
    // Store contracts in test context
    lookCoin = fixture.lookCoin;
    sandwichAttacker = fixture.sandwichAttacker;
    mevExtractor = fixture.mevExtractor;
    feeManipulator = fixture.feeManipulator;
    liquidityDrainer = fixture.liquidityDrainer;
    arbitrageBot = fixture.arbitrageBot;
    velocityAttacker = fixture.velocityAttacker;
    economicHelper = fixture.economicHelper;
  });

  describe("Sandwich Attack Security", function () {
    it("Should prevent profitable sandwich attacks on bridge operations", async function () {
      const victimAmount = ethers.parseEther("5000");
      const frontRunAmount = ethers.parseEther("1000");
      const backRunAmount = ethers.parseEther("1000");
      const targetChain = TEST_CHAINS.BSC_TESTNET;

      // Record initial states
      const initialAttackerBalance = await lookCoin.balanceOf(await sandwichAttacker.getAddress());
      const initialVictimBalance = await lookCoin.balanceOf(victim.address);

      // Fund victim for bridge operation
      await lookCoin.transfer(victim.address, victimAmount);

      // Simulate victim transaction in mempool
      const victimTx = lookCoin.interface.encodeFunctionData("bridgeToken", [
        targetChain,
        ethers.zeroPadValue(victim.address, 32),
        victimAmount
      ]);

      // Attempt sandwich attack
      const attackTx = sandwichAttacker.executeSandwichAttack(
        victimTx,
        frontRunAmount,
        backRunAmount,
        targetChain,
        { value: ethers.parseEther("0.1") }
      );

      // Attack should fail or be unprofitable
      await expect(attackTx).to.be.revertedWithCustomError(lookCoin, "EnforcedPause")
        .or.to.be.revertedWith("LookCoin: destination chain not configured");

      // Analyze attack profitability
      const attackData = economicTestUtils.generateTransactionData(1, "sandwich", frontRunAmount);
      const profitability = economicHelper.analyzeAttackProfitability(
        "sandwich",
        { amount: frontRunAmount, duration: 60, complexity: 5 },
        { actualProfit: 0n, gasUsed: 200000n, successCount: 0, totalAttempts: 1 }
      );

      // Attack should be unprofitable
      expect(profitability.netProfit).to.be.lte(0n);
      expect(profitability.profitMargin).to.be.lte(0);

      // Validate economic incentives are properly aligned
      const incentiveAnalysis = economicHelper.validateEconomicIncentives(
        "attacker",
        "sandwich",
        { gasCost: 200000n * GAS_PRICE, opportunityCost: 0n, riskPremium: frontRunAmount / 100n },
        { directReward: 0n, indirectBenefit: 0n, reputationValue: 0n }
      );

      expect(incentiveAnalysis.isIncentiveAligned).to.be.true;
      expect(incentiveAnalysis.recommendation).to.include("properly disincentivized");
    });

    it("Should resist MEV extraction through front-running", async function () {
      const targetAmount = ethers.parseEther("8000");
      const gasPremium = ethers.parseUnits("50", "gwei"); // High gas price
      
      // Create target transaction
      const targetTx = lookCoin.interface.encodeFunctionData("bridgeToken", [
        TEST_CHAINS.BSC_TESTNET,
        ethers.zeroPadValue(victim.address, 32),
        targetAmount
      ]);

      const initialBalance = await lookCoin.balanceOf(await mevExtractor.getAddress());

      // Attempt front-running with high gas price
      await expect(
        mevExtractor.frontRunTransaction(targetTx, gasPremium, { 
          value: ethers.parseEther("0.1"),
          gasPrice: gasPremium 
        })
      ).to.not.emit(mevExtractor, "MEVExtracted");

      const finalBalance = await lookCoin.balanceOf(await mevExtractor.getAddress());
      
      // Should not extract value
      expect(finalBalance).to.be.lte(initialBalance);

      // Calculate MEV extraction efficiency
      const mevData = economicTestUtils.generateTransactionData(5, "mev", targetAmount);
      const metrics = economicHelper.calculateEconomicMetrics(mevData, 3600);
      
      // MEV extraction should be inefficient/unprofitable
      expect(metrics.profitabilityRatio).to.be.lte(1.0);
      expect(metrics.netPosition).to.be.lte(0n);
    });

    it("Should analyze complex MEV bundle execution economics", async function () {
      const bundle = {
        targets: [await lookCoin.getAddress()],
        calldata_: [lookCoin.interface.encodeFunctionData("bridgeToken", [
          TEST_CHAINS.BSC_TESTNET,
          ethers.zeroPadValue(await mevExtractor.getAddress(), 32),
          ethers.parseEther("2000")
        ])],
        values: [ethers.parseEther("0.05")],
        expectedProfit: ethers.parseEther("10"), // Unrealistic expectation
        gasLimit: 500000
      };

      // Bundle execution should fail due to insufficient profit
      await expect(
        mevExtractor.executeMEVBundle(bundle, { 
          value: ethers.parseEther("0.1") 
        })
      ).to.be.revertedWith("Insufficient profit");

      // Analyze bundle economics
      const bundleAnalysis = economicHelper.analyzeAttackProfitability(
        "mev",
        { amount: ethers.parseEther("2000"), duration: 60, complexity: 8 },
        { actualProfit: 0n, gasUsed: bundle.gasLimit, successCount: 0, totalAttempts: 1 }
      );

      expect(bundleAnalysis.isIncentiveAligned).to.be.undefined;
      expect(bundleAnalysis.netProfit).to.be.lt(0n);
    });
  });

  describe("Fee Manipulation Attack Prevention", function () {
    it("Should prevent gas estimation manipulation for reduced fees", async function () {
      const bridgeAmount = ethers.parseEther("5000");
      const fakeGasLimit = 100000; // Artificially low gas limit
      
      const initialSavings = await feeManipulator.totalFeesSaved();

      // Attempt gas estimation manipulation
      await expect(
        feeManipulator.manipulateGasEstimation(
          TEST_CHAINS.BSC_TESTNET,
          bridgeAmount,
          fakeGasLimit,
          { value: ethers.parseEther("0.1") }
        )
      ).to.emit(feeManipulator, "ManipulationBlocked");

      // Should not save any fees
      const finalSavings = await feeManipulator.totalFeesSaved();
      expect(finalSavings).to.equal(initialSavings);

      // Analyze fee manipulation economics
      const feeData = [
        { feeAmount: ethers.parseEther("25"), feeRate: 50, timestamp: Date.now() },
        { feeAmount: ethers.parseEther("50"), feeRate: 100, timestamp: Date.now() }
      ];
      const volumeData = [
        { volume: ethers.parseEther("5000"), timestamp: Date.now() },
        { volume: ethers.parseEther("5000"), timestamp: Date.now() }
      ];

      const feeAnalysis = economicHelper.analyzeFeeStructure(feeData, volumeData);
      
      // Fee structure should be robust against manipulation
      expect(feeAnalysis.feeEfficiency).to.be.gte(0.1); // At least 10% efficiency
      expect(feeAnalysis.totalFeesCollected).to.be.gt(0n);
    });

    it("Should resist fee calculation exploits", async function () {
      const exploitAmount = ethers.MaxUint256 / 2n; // Large amount to cause overflow
      
      // Attempt overflow exploit
      await expect(
        feeManipulator.exploitFeeCalculation(exploitAmount, 1, 0) // Celer protocol, overflow type
      ).to.not.emit(feeManipulator, "FeeManipulationAttempted");

      // Attempt rounding exploit with small amount
      const smallAmount = ethers.parseEther("0.01");
      await feeManipulator.exploitFeeCalculation(smallAmount, 1, 1); // Rounding type

      // Verify no significant fee savings
      const stats = await feeManipulator.getManipulationStats();
      expect(stats.averageSaving).to.be.lte(ethers.parseEther("1")); // Max 1 LOOK savings
    });

    it("Should prevent cross-chain fee arbitrage exploitation", async function () {
      const arbitrageAmount = ethers.parseEther("10000");
      const sourceChain = TEST_CHAINS.BSC_TESTNET;
      const destChain = TEST_CHAINS.BASE_SEPOLIA;

      const initialSavings = await feeManipulator.totalFeesSaved();

      // Attempt fee arbitrage
      await feeManipulator.executeFeeArbitrage(
        sourceChain,
        destChain,
        arbitrageAmount,
        { value: ethers.parseEther("0.1") }
      );

      const finalSavings = await feeManipulator.totalFeesSaved();
      const arbitrageProfit = finalSavings - initialSavings;

      // Profit from arbitrage should be minimal
      expect(arbitrageProfit).to.be.lte(ethers.parseEther("50")); // Max 50 LOOK profit

      // Analyze arbitrage economics
      const arbitrageAnalysis = economicHelper.validateEconomicIncentives(
        "attacker",
        "fee_arbitrage",
        { 
          gasCost: 300000n * GAS_PRICE, 
          opportunityCost: arbitrageAmount / 1000n,
          riskPremium: arbitrageAmount / 100n 
        },
        { 
          directReward: arbitrageProfit, 
          indirectBenefit: 0n, 
          reputationValue: 0n 
        }
      );

      expect(arbitrageAnalysis.isIncentiveAligned).to.be.true; // Attack should be disincentivized
    });
  });

  describe("Liquidity Drainage Attack Resistance", function () {
    it("Should prevent large-scale liquidity drainage attempts", async function () {
      const drainAmount = ethers.parseEther("100000"); // Large drain attempt
      const targetChain = TEST_CHAINS.BSC_TESTNET;

      // Attempt liquidity drainage
      await expect(
        liquidityDrainer.attemptLiquidityDrainage(
          targetChain,
          drainAmount,
          false, // No flash loan
          { value: ethers.parseEther("0.5") }
        )
      ).to.emit(liquidityDrainer, "DrainageBlocked");

      // Verify drainage was blocked
      const stats = await liquidityDrainer.getDrainageStats();
      expect(stats.successRate).to.be.lte(10); // Max 10% success rate

      // Analyze drainage profitability
      const drainageProfit = await liquidityDrainer.calculateDrainageProfit(targetChain, drainAmount);
      
      // Should not be profitable
      expect(drainageProfit.profit).to.be.lte(ethers.parseEther("100")); // Max 100 LOOK profit
      expect(drainageProfit.risk).to.be.gte(50); // At least 50% risk
    });

    it("Should resist flash loan enhanced liquidity attacks", async function () {
      const drainAmount = ethers.parseEther("50000");
      const targetChain = TEST_CHAINS.BSC_TESTNET;

      // Attempt flash loan enhanced drainage
      await expect(
        liquidityDrainer.attemptLiquidityDrainage(
          targetChain,
          drainAmount,
          true, // Use flash loan
          { value: ethers.parseEther("0.3") }
        )
      ).to.emit(liquidityDrainer, "DrainageBlocked");

      // Calculate expected vs actual drainage impact
      const preAttackState = economicTestUtils.createMarketConditions("medium");
      const postAttackState = economicTestUtils.createMarketConditions("medium");
      
      const marketImpact = economicHelper.analyzeMarketImpact(
        preAttackState,
        postAttackState,
        drainAmount
      );

      // Market impact should be minimal
      expect(marketImpact.liquidityReduction).to.be.lte(preAttackState.liquidity / 20n); // Max 5% reduction
      expect(marketImpact.marketEfficiency).to.be.gte(0.9); // Maintain 90% efficiency
    });

    it("Should implement effective drainage cooldown mechanisms", async function () {
      const smallDrainAmount = ethers.parseEther("1000");
      const targetChain = TEST_CHAINS.BSC_TESTNET;

      // First drainage attempt (should be limited)
      await liquidityDrainer.attemptLiquidityDrainage(
        targetChain,
        smallDrainAmount,
        false,
        { value: ethers.parseEther("0.1") }
      );

      // Immediate second attempt should be blocked by cooldown
      await expect(
        liquidityDrainer.attemptLiquidityDrainage(
          targetChain,
          smallDrainAmount,
          false,
          { value: ethers.parseEther("0.1") }
        )
      ).to.be.revertedWith("Drainage cooldown active");

      // Verify cooldown is enforced
      const lastDrainTime = await liquidityDrainer.lastDrainTime(targetChain);
      const currentTime = await time.latest();
      expect(lastDrainTime).to.be.closeTo(currentTime, 10);
    });
  });

  describe("Cross-Chain Arbitrage Attack Prevention", function () {
    it("Should limit profitable cross-chain arbitrage opportunities", async function () {
      const arbitrageAmount = ethers.parseEther("20000");
      const sourceChain = TEST_CHAINS.BSC_TESTNET;
      const destChains = [TEST_CHAINS.BASE_SEPOLIA, TEST_CHAINS.OPTIMISM_SEPOLIA];

      // Scan for arbitrage opportunities
      const opportunities = await arbitrageBot.scanArbitrageOpportunities(
        sourceChain,
        destChains,
        arbitrageAmount
      );

      // Should find limited opportunities
      const validOpportunities = opportunities.filter(id => id !== ethers.ZeroHash);
      expect(validOpportunities.length).to.be.lte(1); // Max 1 profitable opportunity

      // If opportunity exists, execute and analyze
      if (validOpportunities.length > 0) {
        const opportunityId = validOpportunities[0];
        
        await expect(
          arbitrageBot.executeArbitrage(opportunityId, { 
            value: ethers.parseEther("0.2") 
          })
        ).to.emit(arbitrageBot, "ArbitrageExecuted")
          .or.to.emit(arbitrageBot, "ArbitrageFailed");

        const stats = await arbitrageBot.getArbitrageStats();
        
        // Arbitrage profit should be limited
        expect(stats.averageProfit).to.be.lte(arbitrageAmount / 100n); // Max 1% profit
      }
    });

    it("Should resist price manipulation through coordinated arbitrage", async function () {
      const manipulationAmount = ethers.parseEther("50000");
      
      // Update chain prices to simulate manipulation attempt
      await arbitrageBot.updateChainPrice(TEST_CHAINS.BSC_TESTNET, ethers.parseEther("0.95")); // Lower price
      await arbitrageBot.updateChainPrice(TEST_CHAINS.BASE_SEPOLIA, ethers.parseEther("1.05")); // Higher price

      // Scan for artificially created opportunities
      const opportunities = await arbitrageBot.scanArbitrageOpportunities(
        TEST_CHAINS.BSC_TESTNET,
        [TEST_CHAINS.BASE_SEPOLIA],
        manipulationAmount
      );

      // Even with price differences, opportunities should be limited by fees/restrictions
      const validOpportunities = opportunities.filter(id => id !== ethers.ZeroHash);
      
      if (validOpportunities.length > 0) {
        const opportunityId = validOpportunities[0];
        
        // Execute arbitrage
        await arbitrageBot.executeArbitrage(opportunityId, { 
          value: ethers.parseEther("0.3") 
        });

        const stats = await arbitrageBot.getArbitrageStats();
        
        // Profit should be reasonable despite price manipulation
        const profitRatio = Number(stats.totalProfit * 10000n / manipulationAmount) / 100;
        expect(profitRatio).to.be.lte(2.0); // Max 2% profit even with manipulation
      }
    });

    it("Should implement arbitrage opportunity expiration", async function () {
      const arbitrageAmount = ethers.parseEther("5000");
      
      // Create opportunity
      const opportunities = await arbitrageBot.scanArbitrageOpportunities(
        TEST_CHAINS.BSC_TESTNET,
        [TEST_CHAINS.BASE_SEPOLIA],
        arbitrageAmount
      );

      const validOpportunities = opportunities.filter(id => id !== ethers.ZeroHash);
      
      if (validOpportunities.length > 0) {
        const opportunityId = validOpportunities[0];
        
        // Fast forward past expiration (5 minutes)
        await time.increase(400); // 6+ minutes
        
        // Attempt to execute expired opportunity
        await expect(
          arbitrageBot.executeArbitrage(opportunityId, { 
            value: ethers.parseEther("0.1") 
          })
        ).to.be.revertedWith("Opportunity expired");
      }
    });
  });

  describe("Token Velocity Attack Mitigation", function () {
    it("Should prevent high-frequency velocity manipulation", async function () {
      const targetVolume = ethers.parseEther("100000");
      const batchSize = ethers.parseEther("1000");
      const targetChain = TEST_CHAINS.BSC_TESTNET;

      // Attempt velocity attack
      await expect(
        velocityAttacker.executeVelocityAttack(
          targetVolume,
          batchSize,
          targetChain,
          { value: ethers.parseEther("1.0") }
        )
      ).to.emit(velocityAttacker, "VelocityAttackStarted");

      // Verify frequency limiting
      const currentBlock = await ethers.provider.getBlockNumber();
      const blockTxCount = await velocityAttacker.blockTransactionCount(currentBlock);
      
      // Should be limited to maximum frequency
      expect(blockTxCount).to.be.lte(10); // MAX_ATTACK_FREQUENCY = 10

      const stats = await velocityAttacker.getAttackStats();
      
      // Efficiency should be low
      expect(stats.efficiency).to.be.lte(100); // Max 1% efficiency (100 basis points)
    });

    it("Should resist token metrics manipulation for profit", async function () {
      const manipulationAmount = ethers.parseEther("10000");

      // Test different manipulation types
      for (let type = 0; type < 3; type++) {
        const initialExtracted = await velocityAttacker.extractedValue();
        
        await velocityAttacker.manipulateTokenMetrics(type, manipulationAmount);
        
        const finalExtracted = await velocityAttacker.extractedValue();
        const extractionProfit = finalExtracted - initialExtracted;
        
        // Extraction should be minimal
        expect(extractionProfit).to.be.lte(manipulationAmount / 100n); // Max 1% extraction
      }

      // Analyze overall manipulation effectiveness
      const manipulationData = economicTestUtils.generateTransactionData(
        20,
        "velocity_manipulation", 
        manipulationAmount
      );
      
      const metrics = economicHelper.calculateEconomicMetrics(manipulationData, 3600);
      
      // Manipulation should not be profitable
      expect(metrics.profitabilityRatio).to.be.lte(1.1); // Max 10% profitability
      expect(metrics.sharpeRatio).to.be.lte(0.5); // Poor risk-adjusted returns
    });

    it("Should calculate optimal attack parameters correctly", async function () {
      const targetProfit = ethers.parseEther("100");
      const riskTolerance = 50; // Medium risk tolerance

      const optimalParams = await velocityAttacker.calculateOptimalAttack(
        targetProfit,
        riskTolerance
      );

      // Verify parameters are reasonable
      expect(optimalParams.optimalVolume).to.be.gte(targetProfit * 100n); // At least 100x target profit
      expect(optimalParams.optimalBatchSize).to.be.gte(ethers.parseEther("100")); // Min attack amount
      expect(optimalParams.estimatedGasCost).to.be.gt(0n); // Should have gas cost estimate

      // Calculate actual profitability with these parameters
      const actualProfitability = economicHelper.analyzeAttackProfitability(
        "velocity_manipulation",
        {
          amount: optimalParams.optimalVolume,
          duration: 3600,
          complexity: 7
        },
        {
          actualProfit: targetProfit / 2n, // Assume 50% of target achieved
          gasUsed: Number(optimalParams.estimatedGasCost) / Number(GAS_PRICE),
          successCount: 1,
          totalAttempts: 2
        }
      );

      // Should not be highly profitable
      expect(actualProfitability.profitMargin).to.be.lte(20); // Max 20% profit margin
    });
  });

  describe("Economic Security Stress Testing", function () {
    it("Should maintain economic security under high load", async function () {
      const stressScenarios = economicTestUtils.generateStressTestScenarios();
      
      for (const scenario of stressScenarios) {
        const initialState = {
          balance: await lookCoin.balanceOf(admin.address),
          supply: await lookCoin.totalSupply()
        };

        // Execute stress test scenario
        const transactions = economicTestUtils.generateTransactionData(
          scenario.parameters.transactionCount,
          scenario.parameters.attackTypes[0], // Use first attack type
          scenario.parameters.maxAmount
        );

        // Analyze economic metrics under stress
        const stressMetrics = economicHelper.calculateEconomicMetrics(
          transactions,
          scenario.parameters.duration
        );

        // System should remain economically secure
        expect(stressMetrics.profitabilityRatio).to.be.lte(1.5); // Max 50% profitability
        expect(stressMetrics.sharpeRatio).to.be.lte(1.0); // Reasonable risk-adjusted returns

        const finalState = {
          balance: await lookCoin.balanceOf(admin.address),
          supply: await lookCoin.totalSupply()
        };

        // Verify economic invariants hold
        economicTestUtils.assertEconomicInvariants(
          initialState,
          finalState,
          [{ type: "stress_test", amount: scenario.parameters.maxAmount }]
        );
      }
    });

    it("Should perform Monte Carlo simulation of attack scenarios", async function () {
      const attackTypes = ["sandwich", "mev", "fee_manipulation", "liquidity_drainage"];
      
      for (const attackType of attackTypes) {
        const simulationResults = await economicHelper.simulateAttackScenarios(
          attackType,
          {
            minAmount: ethers.parseEther("1000"),
            maxAmount: ethers.parseEther("50000"),
            minDuration: 60,
            maxDuration: 3600,
            successRate: 30 // 30% success rate assumption
          },
          100 // 100 iterations for testing (production would use more)
        );

        // Attacks should have low profitability probability
        expect(simulationResults.breakEvenProbability).to.be.lte(30); // Max 30% break-even
        expect(simulationResults.averageProfit).to.be.lte(0n); // Average should be unprofitable
        
        // Should recommend low risk
        expect(simulationResults.recommendation).to.include("LOW RISK")
          .or.to.include("MEDIUM RISK");
      }
    });

    it("Should validate economic incentive alignment across all scenarios", async function () {
      const participantTypes = ["attacker", "user", "validator"];
      const actionTypes = ["bridge", "attack", "validate"];
      
      for (const participantType of participantTypes) {
        for (const actionType of actionTypes) {
          const incentiveAnalysis = economicHelper.validateEconomicIncentives(
            participantType,
            actionType,
            {
              gasCost: ethers.parseEther("0.01"), // 0.01 ETH gas cost
              opportunityCost: ethers.parseEther("10"), // 10 LOOK opportunity cost
              riskPremium: ethers.parseEther("5") // 5 LOOK risk premium
            },
            {
              directReward: participantType === "attacker" ? 0n : ethers.parseEther("20"), // 20 LOOK reward
              indirectBenefit: ethers.parseEther("5"), // 5 LOOK indirect benefit
              reputationValue: ethers.parseEther("2") // 2 LOOK reputation value
            }
          );

          if (participantType === "attacker") {
            // Attackers should be disincentivized
            expect(incentiveAnalysis.isIncentiveAligned).to.be.true;
            expect(incentiveAnalysis.incentiveRatio).to.be.lte(1.0);
          } else {
            // Legitimate participants should be incentivized
            expect(incentiveAnalysis.isIncentiveAligned).to.be.true;
            expect(incentiveAnalysis.incentiveRatio).to.be.gte(1.2);
          }
        }
      }
    });
  });

  describe("Market Impact Analysis", function () {
    it("Should analyze market impact of coordinated attacks", async function () {
      // Create realistic market conditions
      const preAttackState = economicTestUtils.createMarketConditions("low");
      
      // Simulate coordinated attack impact
      const attackVolume = ethers.parseEther("100000");
      
      // Execute multiple attack types simultaneously
      const attackPromises = [
        sandwichAttacker.fundAttacker(ATTACK_AMOUNT),
        mevExtractor.fundBot(ATTACK_AMOUNT),
        feeManipulator.fundDrainer?.(ATTACK_AMOUNT) || Promise.resolve(), // Optional method
        liquidityDrainer.fundDrainer(ATTACK_AMOUNT)
      ];
      
      await Promise.allSettled(attackPromises);

      // Simulate post-attack state
      const postAttackState = economicTestUtils.createMarketConditions("high");
      
      const marketImpact = economicHelper.analyzeMarketImpact(
        preAttackState,
        postAttackState,
        attackVolume
      );

      // Market should remain relatively stable
      expect(marketImpact.priceImpact).to.be.lte(preAttackState.price / 20n); // Max 5% price impact
      expect(marketImpact.liquidityReduction).to.be.lte(preAttackState.liquidity / 10n); // Max 10% liquidity reduction
      expect(marketImpact.marketEfficiency).to.be.gte(0.8); // Maintain at least 80% efficiency
    });

    it("Should measure protocol resilience under economic pressure", async function () {
      const pressureTests = [
        { name: "High Volume", volume: ethers.parseEther("1000000"), expectedImpact: "low" },
        { name: "Rapid Transactions", volume: ethers.parseEther("100000"), expectedImpact: "medium" },
        { name: "Sustained Attack", volume: ethers.parseEther("500000"), expectedImpact: "medium" }
      ];

      for (const test of pressureTests) {
        const preState = economicTestUtils.createMarketConditions("medium");
        
        // Simulate pressure test
        const transactionData = economicTestUtils.generateTransactionData(
          50,
          "combined_attack",
          test.volume / 50n
        );
        
        const pressureMetrics = economicHelper.calculateEconomicMetrics(transactionData);
        
        // Calculate resilience score
        const resilienceScore = Math.max(0, 100 - Number(pressureMetrics.totalLoss * 100n / test.volume));
        
        if (test.expectedImpact === "low") {
          expect(resilienceScore).to.be.gte(90);
        } else if (test.expectedImpact === "medium") {
          expect(resilienceScore).to.be.gte(70);
        }
        
        // Risk metrics should be within acceptable bounds
        const riskMetrics = economicHelper.calculateRiskMetrics(
          transactionData.map((tx, i) => ({ 
            value: tx.profit - tx.loss, 
            timestamp: tx.timestamp 
          }))
        );
        
        expect(riskMetrics.valueAtRisk).to.be.lte(test.volume / 10n); // Max 10% VaR
        expect(riskMetrics.volatility).to.be.lte(50); // Reasonable volatility bounds
      }
    });
  });

  describe("Economic Parameter Validation", function () {
    it("Should validate economic parameters remain within safe bounds", async function () {
      const economicParams = economicHelper.getEconomicParameters();
      
      // Validate parameters are realistic
      expect(economicParams.gasPrice).to.be.gte(ethers.parseUnits("1", "gwei"));
      expect(economicParams.gasPrice).to.be.lte(ethers.parseUnits("500", "gwei"));
      expect(economicParams.ethPrice).to.be.gte(ethers.parseEther("500"));
      expect(economicParams.ethPrice).to.be.lte(ethers.parseEther("10000"));
      expect(economicParams.lookPrice).to.be.gte(ethers.parseEther("0.1"));
      expect(economicParams.lookPrice).to.be.lte(ethers.parseEther("10"));
    });

    it("Should update economic parameters and recalculate metrics", async function () {
      // Update parameters
      const newGasPrice = ethers.parseUnits("50", "gwei");
      const newEthPrice = ethers.parseEther("4000");
      const newLookPrice = ethers.parseEther("1.5");
      
      economicHelper.updateEconomicParameters(newGasPrice, newEthPrice, newLookPrice);
      
      // Verify parameters updated
      const updatedParams = economicHelper.getEconomicParameters();
      expect(updatedParams.gasPrice).to.equal(newGasPrice);
      expect(updatedParams.ethPrice).to.equal(newEthPrice);
      expect(updatedParams.lookPrice).to.equal(newLookPrice);
      
      // Recalculate metrics with new parameters
      const testData = economicTestUtils.generateTransactionData(10, "sandwich");
      const updatedMetrics = economicHelper.calculateEconomicMetrics(testData);
      
      // Metrics should reflect updated parameters
      expect(updatedMetrics.totalProfit).to.be.gte(0n);
      expect(updatedMetrics.netPosition).to.be.finite;
    });
  });

  describe("Comprehensive Economic Security Report", function () {
    it("Should generate comprehensive economic security assessment", async function () {
      const securityReport = {
        attackVectors: [] as Array<{
          type: string;
          profitability: AttackProfitability;
          marketImpact: MarketImpactAnalysis;
          recommendation: string;
        }>
      };

      const attackTypes = [
        "sandwich", "mev", "fee_manipulation", 
        "liquidity_drainage", "cross_chain_arbitrage", "velocity_manipulation"
      ];

      for (const attackType of attackTypes) {
        // Analyze each attack vector
        const profitability = economicHelper.analyzeAttackProfitability(
          attackType,
          { amount: ATTACK_AMOUNT, duration: 3600, complexity: 5 },
          { actualProfit: ATTACK_AMOUNT / 1000n, gasUsed: 250000n, successCount: 1, totalAttempts: 3 }
        );

        const preState = economicTestUtils.createMarketConditions("medium");
        const postState = economicTestUtils.createMarketConditions("medium");
        const marketImpact = economicHelper.analyzeMarketImpact(preState, postState, ATTACK_AMOUNT);

        let recommendation = "";
        if (profitability.netProfit <= 0n) {
          recommendation = `${attackType} attack is properly disincentivized - no immediate action needed`;
        } else if (profitability.profitMargin < 5) {
          recommendation = `${attackType} attack has low profitability - monitor for changes`;
        } else {
          recommendation = `${attackType} attack may be profitable - consider additional protections`;
        }

        securityReport.attackVectors.push({
          type: attackType,
          profitability,
          marketImpact,
          recommendation
        });
      }

      // Validate overall security posture
      const profitableAttacks = securityReport.attackVectors.filter(
        vector => vector.profitability.netProfit > 0n
      );

      // Should have minimal profitable attack vectors
      expect(profitableAttacks.length).to.be.lte(2); // Max 2 potentially profitable vectors

      const highRiskAttacks = securityReport.attackVectors.filter(
        vector => vector.profitability.profitMargin > 10
      );

      // Should have no high-risk attacks
      expect(highRiskAttacks.length).to.equal(0);

      // Overall market impact should be minimal
      const avgPriceImpact = securityReport.attackVectors.reduce(
        (sum, vector) => sum + Number(vector.marketImpact.priceImpact),
        0
      ) / securityReport.attackVectors.length;

      expect(avgPriceImpact).to.be.lte(Number(ethers.parseEther("0.05"))); // Max 5% average impact
    });
  });
});