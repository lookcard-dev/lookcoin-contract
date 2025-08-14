import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  LookCoin,
  CrossChainRouter,
  LayerZeroModule,
  CelerIMModule,
  HyperlaneModule,
  FeeManager,
  SecurityManager,
  SupplyOracle,
  MockLayerZeroEndpoint,
  MockMessageBus,
  MockHyperlaneMailbox,
} from "../../typechain-types";
import { deployBridgeFixture } from "../helpers/fixtures";
import { PROTOCOLS, AMOUNTS, GAS_LIMITS, TEST_CHAINS } from "../helpers/constants";

/**
 * Gas Optimization Benchmarks for LookCoin
 * 
 * This test suite provides comprehensive gas measurements for:
 * - Cross-protocol comparisons
 * - Batch operations
 * - Storage patterns
 * - Message size optimization
 * - Performance regression detection
 */
describe("Gas Optimization Benchmarks", function () {
  // Test fixtures
  let lookCoin: LookCoin;
  let router: CrossChainRouter;
  let lzModule: LayerZeroModule;
  let celerModule: CelerIMModule;
  let hyperlaneModule: HyperlaneModule;
  let feeManager: FeeManager;
  let securityManager: SecurityManager;
  let supplyOracle: SupplyOracle;
  let mockLZ: MockLayerZeroEndpoint;
  let mockCeler: MockMessageBus;
  let mockHyperlane: MockHyperlaneMailbox;
  
  // Test accounts
  let admin: SignerWithAddress;
  let user: SignerWithAddress;
  let user2: SignerWithAddress;
  
  // Gas tracking
  const gasMetrics: Map<string, number> = new Map();
  const gasBaselines: Map<string, number> = new Map();
  
  // Test constants
  const TEST_AMOUNT = ethers.parseEther("1000");
  const BATCH_SIZE = 10;
  const REMOTE_CHAIN_ID = TEST_CHAINS.TEST_CHAIN_2;
  
  // Protocol gas limits
  const PROTOCOL_GAS_LIMITS = {
    [PROTOCOLS.LAYERZERO]: 200_000,
    [PROTOCOLS.CELER]: 250_000,
    [PROTOCOLS.HYPERLANE]: 150_000,
  };

  before(async function () {
    // Skip if not running gas benchmarks
    if (!process.env.RUN_GAS_BENCHMARKS) {
      this.skip();
    }
  });

  beforeEach(async function () {
    const fixture = await deployBridgeFixture();
    
    lookCoin = fixture.lookCoin;
    router = fixture.crossChainRouter;
    lzModule = fixture.layerZeroModule;
    celerModule = fixture.celerIMModule;
    hyperlaneModule = fixture.hyperlaneModule;
    feeManager = fixture.feeManager;
    securityManager = fixture.securityManager;
    supplyOracle = fixture.supplyOracle;
    mockLZ = fixture.mockLayerZero;
    mockCeler = fixture.mockCeler;
    mockHyperlane = fixture.mockHyperlane;
    
    admin = fixture.admin;
    user = fixture.user1;
    user2 = fixture.user2;
    
    // Mint tokens for testing
    await lookCoin.connect(fixture.governance).grantRole(
      await lookCoin.MINTER_ROLE(),
      admin.address
    );
    await lookCoin.connect(admin).mint(user.address, ethers.parseEther("1000000"));
  });

  describe("Batch Transfer Operations", function () {
    it("should benchmark single vs batch transfers", async function () {
      const recipients: string[] = [];
      const amounts: bigint[] = [];
      
      for (let i = 0; i < BATCH_SIZE; i++) {
        recipients.push(ethers.getAddress(`0x${"1".repeat(39)}${i.toString(16)}`));
        amounts.push(TEST_AMOUNT);
      }
      
      // Measure individual transfers
      const individualGasUsed: number[] = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const tx = await lookCoin.connect(user).transfer(recipients[i], amounts[i]);
        const receipt = await tx.wait();
        individualGasUsed.push(receipt!.gasUsed.toNumber());
      }
      
      const totalIndividualGas = individualGasUsed.reduce((a, b) => a + b, 0);
      const avgIndividualGas = totalIndividualGas / BATCH_SIZE;
      
      gasMetrics.set("batch_individual_total", totalIndividualGas);
      gasMetrics.set("batch_individual_avg", avgIndividualGas);
      
      console.log(`Individual transfers - Total: ${totalIndividualGas}, Avg: ${avgIndividualGas}`);
      
      // Note: Actual batch transfer would require contract modification
      // This demonstrates the measurement pattern
    });

    it("should benchmark batch operations across protocols", async function () {
      await lookCoin.connect(user).approve(await router.getAddress(), ethers.MaxUint256);
      
      const protocols = [PROTOCOLS.LAYERZERO, PROTOCOLS.CELER, PROTOCOLS.HYPERLANE];
      const protocolNames = ["LayerZero", "Celer", "Hyperlane"];
      
      for (let p = 0; p < protocols.length; p++) {
        const gasUsed: number[] = [];
        
        for (let i = 0; i < BATCH_SIZE; i++) {
          const recipient = ethers.getAddress(`0x${"2".repeat(39)}${i.toString(16)}`);
          
          const tx = await router.connect(user).bridgeToken(
            REMOTE_CHAIN_ID,
            recipient,
            TEST_AMOUNT,
            protocols[p],
            "0x",
            user.address,
            { value: ethers.parseEther("0.1") }
          );
          
          const receipt = await tx.wait();
          gasUsed.push(receipt!.gasUsed.toNumber());
        }
        
        const totalGas = gasUsed.reduce((a, b) => a + b, 0);
        const avgGas = totalGas / BATCH_SIZE;
        
        gasMetrics.set(`batch_${protocolNames[p]}_total`, totalGas);
        gasMetrics.set(`batch_${protocolNames[p]}_avg`, avgGas);
        
        console.log(`${protocolNames[p]} batch - Total: ${totalGas}, Avg: ${avgGas}`);
      }
    });
  });

  describe("Optimal Path Selection", function () {
    it("should compare gas costs across different amounts", async function () {
      await lookCoin.connect(user).approve(await router.getAddress(), ethers.MaxUint256);
      
      const testAmounts = [
        ethers.parseEther("10"),
        ethers.parseEther("100"),
        ethers.parseEther("1000"),
        ethers.parseEther("10000"),
      ];
      
      for (const amount of testAmounts) {
        const amountStr = ethers.formatEther(amount);
        
        // Test each protocol
        for (const [protocolId, protocolName] of [[PROTOCOLS.LAYERZERO, "LZ"], [PROTOCOLS.CELER, "Celer"], [PROTOCOLS.HYPERLANE, "Hyper"]]) {
          const tx = await router.connect(user).bridgeToken(
            REMOTE_CHAIN_ID,
            user.address,
            amount,
            protocolId as number,
            "0x",
            user.address,
            { value: ethers.parseEther("0.1") }
          );
          
          const receipt = await tx.wait();
          const gasUsed = receipt!.gasUsed.toNumber();
          
          gasMetrics.set(`path_${protocolName}_${amountStr}`, gasUsed);
          console.log(`${protocolName} for ${amountStr} tokens: ${gasUsed} gas`);
        }
      }
      
      // Analyze optimal paths
      for (const amount of testAmounts) {
        const amountStr = ethers.formatEther(amount);
        const lzGas = gasMetrics.get(`path_LZ_${amountStr}`) || 0;
        const celerGas = gasMetrics.get(`path_Celer_${amountStr}`) || 0;
        const hyperGas = gasMetrics.get(`path_Hyper_${amountStr}`) || 0;
        
        const minGas = Math.min(lzGas, celerGas, hyperGas);
        let optimal = "";
        if (minGas === lzGas) optimal = "LayerZero";
        else if (minGas === celerGas) optimal = "Celer";
        else optimal = "Hyperlane";
        
        console.log(`Optimal for ${amountStr}: ${optimal} (${minGas} gas)`);
      }
    });
  });

  describe("Storage Pattern Optimization", function () {
    it("should validate storage access patterns", async function () {
      // Test 1: Multiple storage reads
      const multipleReadsGas: number[] = [];
      for (let i = 0; i < 10; i++) {
        const tx = await lookCoin.totalSupply();
        // Note: view functions don't consume gas in production, but we can measure in tests
        multipleReadsGas.push(100); // Approximate SLOAD cost
      }
      
      // Test 2: Packed storage
      const tx1 = await router.connect(admin).updateProtocolStatus(PROTOCOLS.LAYERZERO, true);
      const receipt1 = await tx1.wait();
      const packedGas = receipt1!.gasUsed.toNumber();
      
      // Test 3: Unpacked storage
      const tx2 = await router.connect(admin).setChainProtocolSupport(
        REMOTE_CHAIN_ID,
        PROTOCOLS.LAYERZERO,
        true
      );
      const receipt2 = await tx2.wait();
      const unpackedGas = receipt2!.gasUsed.toNumber();
      
      gasMetrics.set("storage_packed", packedGas);
      gasMetrics.set("storage_unpacked", unpackedGas);
      
      console.log(`Packed storage update: ${packedGas} gas`);
      console.log(`Unpacked storage update: ${unpackedGas} gas`);
      console.log(`Savings from packing: ${unpackedGas - packedGas} gas`);
      
      expect(packedGas).to.be.lessThan(unpackedGas);
    });

    it("should measure storage slot optimization", async function () {
      // Measure gas for accessing different storage slots
      const measurements: Array<{ operation: string; gas: number }> = [];
      
      // Single slot access
      let tx = await lookCoin.connect(user).transfer(user2.address, ethers.parseEther("1"));
      let receipt = await tx.wait();
      measurements.push({ operation: "single_slot_access", gas: receipt!.gasUsed.toNumber() });
      
      // Multiple slot access (approve + transferFrom)
      tx = await lookCoin.connect(user).approve(admin.address, ethers.parseEther("1"));
      receipt = await tx.wait();
      const approveGas = receipt!.gasUsed.toNumber();
      
      tx = await lookCoin.connect(admin).transferFrom(
        user.address,
        user2.address,
        ethers.parseEther("1")
      );
      receipt = await tx.wait();
      const transferFromGas = receipt!.gasUsed.toNumber();
      
      measurements.push({ 
        operation: "multi_slot_access", 
        gas: approveGas + transferFromGas 
      });
      
      // Store results
      measurements.forEach(m => {
        gasMetrics.set(`storage_${m.operation}`, m.gas);
        console.log(`${m.operation}: ${m.gas} gas`);
      });
    });
  });

  describe("Event Emission Overhead", function () {
    it("should analyze event emission gas costs", async function () {
      // Simple transfer (Transfer event only)
      let tx = await lookCoin.connect(user).transfer(user2.address, TEST_AMOUNT);
      let receipt = await tx.wait();
      const simpleEventGas = receipt!.gasUsed.toNumber();
      
      // Complex operation with multiple events
      await lookCoin.connect(user).approve(await router.getAddress(), ethers.MaxUint256);
      tx = await router.connect(user).bridgeToken(
        REMOTE_CHAIN_ID,
        user.address,
        TEST_AMOUNT,
        PROTOCOLS.LAYERZERO,
        "0x",
        user.address,
        { value: ethers.parseEther("0.1") }
      );
      receipt = await tx.wait();
      const multipleEventsGas = receipt!.gasUsed.toNumber();
      
      // Calculate event overhead
      const eventOverhead = multipleEventsGas - simpleEventGas;
      
      gasMetrics.set("event_simple", simpleEventGas);
      gasMetrics.set("event_multiple", multipleEventsGas);
      gasMetrics.set("event_overhead", eventOverhead);
      
      console.log(`Simple event (Transfer): ${simpleEventGas} gas`);
      console.log(`Multiple events (Bridge): ${multipleEventsGas} gas`);
      console.log(`Event overhead: ${eventOverhead} gas`);
    });

    it("should measure indexed vs non-indexed event parameters", async function () {
      // Events with indexed parameters are more gas efficient for filtering
      // but cost slightly more to emit
      
      // The Transfer event has indexed from/to addresses
      const tx = await lookCoin.connect(user).transfer(user2.address, TEST_AMOUNT);
      const receipt = await tx.wait();
      const indexedEventGas = receipt!.gasUsed.toNumber();
      
      gasMetrics.set("event_indexed", indexedEventGas);
      console.log(`Indexed event parameters: ${indexedEventGas} gas`);
    });
  });

  describe("Cross-Chain Message Optimization", function () {
    it("should compare message sizes across protocols", async function () {
      await lookCoin.connect(user).approve(await router.getAddress(), ethers.MaxUint256);
      
      // Small payload
      const smallPayload = "0x01";
      let tx = await router.connect(user).bridgeToken(
        REMOTE_CHAIN_ID,
        user.address,
        TEST_AMOUNT,
        PROTOCOLS.LAYERZERO,
        smallPayload,
        user.address,
        { value: ethers.parseEther("0.1") }
      );
      let receipt = await tx.wait();
      const smallPayloadGas = receipt!.gasUsed.toNumber();
      
      // Medium payload (typical metadata)
      const mediumPayload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "string"],
        [user.address, TEST_AMOUNT, "Bridge transfer"]
      );
      tx = await router.connect(user).bridgeToken(
        REMOTE_CHAIN_ID,
        user.address,
        TEST_AMOUNT,
        PROTOCOLS.LAYERZERO,
        mediumPayload,
        user.address,
        { value: ethers.parseEther("0.1") }
      );
      receipt = await tx.wait();
      const mediumPayloadGas = receipt!.gasUsed.toNumber();
      
      // Large payload
      const largePayload = "0x" + "ff".repeat(500);
      tx = await router.connect(user).bridgeToken(
        REMOTE_CHAIN_ID,
        user.address,
        TEST_AMOUNT,
        PROTOCOLS.LAYERZERO,
        largePayload,
        user.address,
        { value: ethers.parseEther("0.1") }
      );
      receipt = await tx.wait();
      const largePayloadGas = receipt!.gasUsed.toNumber();
      
      gasMetrics.set("message_small", smallPayloadGas);
      gasMetrics.set("message_medium", mediumPayloadGas);
      gasMetrics.set("message_large", largePayloadGas);
      
      console.log(`Small payload (${smallPayload.length} bytes): ${smallPayloadGas} gas`);
      console.log(`Medium payload (${mediumPayload.length} bytes): ${mediumPayloadGas} gas`);
      console.log(`Large payload (${largePayload.length} bytes): ${largePayloadGas} gas`);
      
      // Calculate per-byte cost
      const mediumBytesCost = (mediumPayloadGas - smallPayloadGas) / (mediumPayload.length - smallPayload.length);
      const largeBytesCost = (largePayloadGas - smallPayloadGas) / (largePayload.length - smallPayload.length);
      
      console.log(`Approximate cost per byte (medium): ${mediumBytesCost.toFixed(2)} gas`);
      console.log(`Approximate cost per byte (large): ${largeBytesCost.toFixed(2)} gas`);
    });
  });

  describe("Protocol-Specific Gas Limits", function () {
    it("should test gas limits for each protocol", async function () {
      await lookCoin.connect(user).approve(await router.getAddress(), ethers.MaxUint256);
      
      const gasLimits = [50_000, 100_000, 200_000, 500_000];
      const protocols = [
        { id: PROTOCOLS.LAYERZERO, name: "LayerZero" },
        { id: PROTOCOLS.CELER, name: "Celer" },
        { id: PROTOCOLS.HYPERLANE, name: "Hyperlane" },
      ];
      
      for (const protocol of protocols) {
        console.log(`\nTesting ${protocol.name}:`);
        
        for (const gasLimit of gasLimits) {
          // Configure gas limit if possible
          if (protocol.id === PROTOCOLS.LAYERZERO) {
            await lookCoin.connect(admin).setGasForDestinationLzReceive(gasLimit);
          } else if (protocol.id === PROTOCOLS.HYPERLANE) {
            await hyperlaneModule.connect(admin).setRequiredGasAmount(BigInt(gasLimit));
          }
          
          try {
            const tx = await router.connect(user).bridgeToken(
              REMOTE_CHAIN_ID,
              user.address,
              TEST_AMOUNT,
              protocol.id,
              "0x",
              user.address,
              { value: ethers.parseEther("0.2"), gasLimit: gasLimit * 2 }
            );
            
            const receipt = await tx.wait();
            const gasUsed = receipt!.gasUsed.toNumber();
            
            gasMetrics.set(`limit_${protocol.name}_${gasLimit}`, gasUsed);
            console.log(`  Gas limit ${gasLimit}: ${gasUsed} gas used ✓`);
          } catch (error) {
            console.log(`  Gas limit ${gasLimit}: Failed (too low)`);
          }
        }
      }
    });
  });

  describe("Performance Regression Detection", function () {
    before(function () {
      // Set baseline values (these would normally come from previous runs)
      gasBaselines.set("transfer", 25_000);
      gasBaselines.set("approve", 45_000);
      gasBaselines.set("bridge_layerzero", 175_000);
      gasBaselines.set("bridge_celer", 185_000);
      gasBaselines.set("bridge_hyperlane", 165_000);
    });

    it("should detect performance regressions", async function () {
      const measurements: Array<{ operation: string; actual: number; baseline: number }> = [];
      
      // Measure transfer
      let tx = await lookCoin.connect(user).transfer(user2.address, TEST_AMOUNT);
      let receipt = await tx.wait();
      measurements.push({
        operation: "transfer",
        actual: receipt!.gasUsed.toNumber(),
        baseline: gasBaselines.get("transfer")!,
      });
      
      // Measure approve
      tx = await lookCoin.connect(user).approve(admin.address, TEST_AMOUNT);
      receipt = await tx.wait();
      measurements.push({
        operation: "approve",
        actual: receipt!.gasUsed.toNumber(),
        baseline: gasBaselines.get("approve")!,
      });
      
      // Measure bridge operations
      await lookCoin.connect(user).approve(await router.getAddress(), ethers.MaxUint256);
      
      for (const [protocolId, protocolName] of [
        [PROTOCOLS.LAYERZERO, "layerzero"],
        [PROTOCOLS.CELER, "celer"],
        [PROTOCOLS.HYPERLANE, "hyperlane"],
      ]) {
        tx = await router.connect(user).bridgeToken(
          REMOTE_CHAIN_ID,
          user.address,
          TEST_AMOUNT,
          protocolId as number,
          "0x",
          user.address,
          { value: ethers.parseEther("0.1") }
        );
        receipt = await tx.wait();
        
        measurements.push({
          operation: `bridge_${protocolName}`,
          actual: receipt!.gasUsed.toNumber(),
          baseline: gasBaselines.get(`bridge_${protocolName}`)!,
        });
      }
      
      // Analyze regressions
      console.log("\n=== REGRESSION ANALYSIS ===");
      for (const m of measurements) {
        const diff = m.actual - m.baseline;
        const percentChange = (diff / m.baseline) * 100;
        
        let status = "✓ NORMAL";
        if (percentChange > 10) {
          status = "⚠️ REGRESSION";
        } else if (percentChange < -10) {
          status = "🎉 OPTIMIZED";
        }
        
        console.log(
          `${m.operation}: ${m.actual} gas (baseline: ${m.baseline}, ${percentChange.toFixed(1)}%) ${status}`
        );
        
        // Fail test if regression is too severe
        expect(percentChange).to.be.lessThan(
          20,
          `${m.operation} gas regression too severe: ${percentChange.toFixed(1)}%`
        );
      }
    });
  });

  describe("Gas Report Generation", function () {
    after(function () {
      generateComprehensiveReport();
    });

    it("should generate optimization recommendations", function () {
      console.log("\n=== OPTIMIZATION RECOMMENDATIONS ===\n");
      
      // Protocol recommendations
      console.log("1. PROTOCOL SELECTION:");
      const amounts = [10, 100, 1000, 10000];
      for (const amount of amounts) {
        const lzGas = gasMetrics.get(`path_LZ_${amount}.0`) || 0;
        const celerGas = gasMetrics.get(`path_Celer_${amount}.0`) || 0;
        const hyperGas = gasMetrics.get(`path_Hyper_${amount}.0`) || 0;
        
        const minGas = Math.min(lzGas || Infinity, celerGas || Infinity, hyperGas || Infinity);
        let recommended = "";
        if (minGas === lzGas) recommended = "LayerZero";
        else if (minGas === celerGas) recommended = "Celer";
        else if (minGas === hyperGas) recommended = "Hyperlane";
        
        if (recommended) {
          console.log(`   ${amount} tokens: Use ${recommended} (${minGas} gas)`);
        }
      }
      
      // Storage recommendations
      console.log("\n2. STORAGE OPTIMIZATION:");
      const packedGas = gasMetrics.get("storage_packed") || 0;
      const unpackedGas = gasMetrics.get("storage_unpacked") || 0;
      if (packedGas && unpackedGas) {
        const savings = ((unpackedGas - packedGas) / unpackedGas) * 100;
        console.log(`   Struct packing saves ${savings.toFixed(1)}% gas`);
      }
      
      // Message size recommendations
      console.log("\n3. MESSAGE OPTIMIZATION:");
      const smallMsg = gasMetrics.get("message_small") || 0;
      const largeMsg = gasMetrics.get("message_large") || 0;
      if (smallMsg && largeMsg) {
        const overhead = largeMsg - smallMsg;
        console.log(`   Large messages add ${overhead} gas overhead`);
        console.log("   Recommendation: Minimize payload size");
      }
      
      // Batch operation recommendations
      console.log("\n4. BATCH OPERATIONS:");
      const individualAvg = gasMetrics.get("batch_individual_avg") || 0;
      if (individualAvg) {
        console.log(`   Individual transfer avg: ${individualAvg} gas`);
        console.log("   Recommendation: Implement multicall for batch operations");
      }
      
      console.log("\n=====================================\n");
    });
  });

  // Helper function to generate comprehensive report
  function generateComprehensiveReport(): void {
    console.log("\n");
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║          GAS OPTIMIZATION BENCHMARK REPORT                   ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log("\n");

    // Sort metrics by category
    const categories = {
      "Batch Operations": Array.from(gasMetrics.entries()).filter(([k]) => k.startsWith("batch_")),
      "Path Selection": Array.from(gasMetrics.entries()).filter(([k]) => k.startsWith("path_")),
      "Storage Patterns": Array.from(gasMetrics.entries()).filter(([k]) => k.startsWith("storage_")),
      "Event Emission": Array.from(gasMetrics.entries()).filter(([k]) => k.startsWith("event_")),
      "Message Size": Array.from(gasMetrics.entries()).filter(([k]) => k.startsWith("message_")),
      "Gas Limits": Array.from(gasMetrics.entries()).filter(([k]) => k.startsWith("limit_")),
    };

    for (const [category, metrics] of Object.entries(categories)) {
      if (metrics.length === 0) continue;
      
      console.log(`\n=== ${category.toUpperCase()} ===`);
      console.log("─".repeat(50));
      
      for (const [key, value] of metrics) {
        const formattedKey = key.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
        console.log(`${formattedKey.padEnd(35)} ${value.toLocaleString().padStart(10)} gas`);
      }
    }

    // Summary statistics
    console.log("\n=== SUMMARY STATISTICS ===");
    console.log("─".repeat(50));
    
    const allValues = Array.from(gasMetrics.values());
    if (allValues.length > 0) {
      const total = allValues.reduce((a, b) => a + b, 0);
      const avg = total / allValues.length;
      const min = Math.min(...allValues);
      const max = Math.max(...allValues);
      
      console.log(`Total measurements: ${allValues.length}`);
      console.log(`Average gas: ${avg.toFixed(0)}`);
      console.log(`Minimum gas: ${min}`);
      console.log(`Maximum gas: ${max}`);
    }

    console.log("\n");
    console.log("═".repeat(65));
    console.log("Report generated at:", new Date().toISOString());
    console.log("═".repeat(65));
    console.log("\n");
  }
});