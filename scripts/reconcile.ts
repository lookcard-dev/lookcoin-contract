/**
 * LookCoin Cross-Chain Supply Reconciliation Script
 * 
 * This script performs comprehensive supply reconciliation across all deployed chains.
 * It collects supply data from multiple chains and submits updates to the SupplyOracle,
 * which requires multi-signature validation (3 signatures by default).
 * 
 * Workflow:
 * 1. Collect supply data from all chains (total supply, minted, burned)
 * 2. Calculate aggregate supply across the ecosystem
 * 3. Submit supply updates to SupplyOracle (requires ORACLE_ROLE)
 * 4. After 3 oracle signatures, updates execute automatically
 * 5. If supply discrepancy > tolerance, bridges pause automatically
 * 
 * Multi-Sig Process:
 * - Oracle 1 runs script: Submits updates (1/3 signatures)
 * - Oracle 2 runs script: Submits updates (2/3 signatures)
 * - Oracle 3 runs script: Submits updates (3/3 signatures) - EXECUTES!
 * 
 * Automation:
 * - Can be run manually: npm run reconcile
 * - Can be automated with AWS Lambda via scripts/handlers/reconcile.ts
 * - Should run every 15 minutes across 3+ independent oracle nodes
 * 
 * Prerequisites:
 * - Deployment artifacts for all chains in /deployments
 * - Network RPC access to query each chain
 * - ORACLE_ROLE permissions on SupplyOracle
 * - Coordination on nonce (using timestamp)
 * 
 * @see SupplyOracle.sol for contract implementation
 * @see scripts/handlers/reconcile.ts for AWS Lambda handler
 */

import { ethers } from "hardhat";
import hre from "hardhat";
import { Contract } from "ethers";
import { loadDeployment, loadOtherChainDeployments } from "./utils/deployment";
import { getNetworkName, TOTAL_SUPPLY } from "../hardhat.config";

// Chain supply data structure matching SupplyOracle
interface ChainSupplyData {
  chainId: number;
  chainName: string;
  totalSupply: bigint;
  totalMinted: bigint;
  totalBurned: bigint;
  lockedSupply: bigint;
  circulatingSupply: bigint;
  lastChecked: Date;
}

// Global constants
const GLOBAL_TOTAL_SUPPLY = BigInt(TOTAL_SUPPLY); // Total supply from hardhat config
const TOLERANCE_THRESHOLD = ethers.parseEther("1000"); // 1000 LOOK tolerance

export async function performReconciliation(privateKey?: string) {
  console.log("🔄 Starting LookCoin Cross-Chain Supply Reconciliation...\n");

  // Use provided private key for Lambda, or default signer for local
  const signer = privateKey 
    ? new ethers.Wallet(privateKey, ethers.provider)
    : (await ethers.getSigners())[0];
    
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = getNetworkName(chainId);

  console.log(`Running reconciliation from ${networkName} with account: ${signer.address}`);

  // Load current chain deployment
  const currentDeployment = loadDeployment(networkName);
  if (!currentDeployment) {
    throw new Error(`No deployment found for ${networkName}`);
  }

  // Get SupplyOracle instance
  const supplyOracle = await ethers.getContractAt("SupplyOracle", currentDeployment.contracts.SupplyOracle.proxy);
  
  // Verify SupplyOracle exists on this chain
  if (!currentDeployment.contracts.SupplyOracle) {
    console.error("❌ Error: SupplyOracle not found on this chain");
    console.log("Note: Each chain should have its own SupplyOracle for local bridge control");
    return;
  }
  
  // Check if we have ORACLE_ROLE
  const ORACLE_ROLE = await supplyOracle.ORACLE_ROLE();
  const hasOracleRole = await supplyOracle.hasRole(ORACLE_ROLE, signer.address);
  
  if (!hasOracleRole) {
    console.error("❌ Error: Signer does not have ORACLE_ROLE on SupplyOracle");
    console.log("Please ensure your account has been granted ORACLE_ROLE to perform reconciliation");
    return;
  }

  // ============================================================================
  // STEP 1: COLLECT SUPPLY DATA FROM ALL CHAINS
  // ============================================================================
  console.log("\n📊 Step 1: Collecting supply data from all chains...\n");

  const chainSupplies: ChainSupplyData[] = [];
  const errors: string[] = [];

  // Collect data from current chain
  try {
    const lookCoin = await ethers.getContractAt("LookCoin", currentDeployment.contracts.LookCoin.proxy);
    const currentChainData = await collectChainSupplyData(
      chainId,
      networkName,
      lookCoin
    );
    chainSupplies.push(currentChainData);
    console.log(`✅ Collected data from ${networkName} (current chain)`);
  } catch (error) {
    const errorMsg = `Failed to collect data from ${networkName}: ${error}`;
    errors.push(errorMsg);
    console.error(`❌ ${errorMsg}`);
  }

  // Load other chain deployments
  const otherDeployments = loadOtherChainDeployments(chainId);
  console.log(`\nFound ${Object.keys(otherDeployments).length} other chain deployments`);

  // Collect data from other chains
  for (const [otherChainId, deployment] of Object.entries(otherDeployments)) {
    const otherNetworkName = getNetworkName(Number(otherChainId));
    const networkKey = otherNetworkName.toLowerCase().replace(/\s+/g, "");
    const networkConfig = hre.config.networks?.[networkKey];
    
    if (!networkConfig || typeof networkConfig === 'string') {
      console.log(`⚠️  Skipping ${otherNetworkName} - no RPC URL configured`);
      continue;
    }

    try {
      console.log(`\nQuerying ${otherNetworkName}...`);
      
      // Create provider for the other chain
      const rpcUrl = 'url' in networkConfig ? networkConfig.url : undefined;
      if (!rpcUrl) {
        console.log(`⚠️  Skipping ${otherNetworkName} - no RPC URL configured`);
        continue;
      }
      
      // Create provider for the other chain
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      
      // Get LookCoin contract on other chain
      const lookCoinAddress = deployment.contracts.LookCoin.proxy;
      const lookCoin = new ethers.Contract(
        lookCoinAddress,
        ["function totalSupply() view returns (uint256)",
         "function totalMinted() view returns (uint256)",
         "function totalBurned() view returns (uint256)"],
        provider
      );

      // Collect supply data
      const chainData = await collectChainSupplyData(
        Number(otherChainId),
        otherNetworkName,
        lookCoin
      );
      
      chainSupplies.push(chainData);
      console.log(`✅ Collected data from ${otherNetworkName}`);
      
    } catch (error) {
      const errorMsg = `Failed to collect data from ${otherNetworkName}: ${error}`;
      errors.push(errorMsg);
      console.error(`❌ ${errorMsg}`);
    }
  }

  // ============================================================================
  // STEP 2: CALCULATE AGGREGATE SUPPLY
  // ============================================================================
  console.log("\n📊 Step 2: Calculating aggregate supply across all chains...\n");

  let totalSupplyAcrossChains = 0n;
  let totalMintedAcrossChains = 0n;
  let totalBurnedAcrossChains = 0n;
  let totalCirculatingSupply = 0n;

  console.log("Chain Supply Summary:");
  console.log("─".repeat(80));
  
  for (const chain of chainSupplies) {
    totalSupplyAcrossChains += chain.totalSupply;
    totalMintedAcrossChains += chain.totalMinted;
    totalBurnedAcrossChains += chain.totalBurned;
    totalCirculatingSupply += chain.circulatingSupply;

    console.log(`${chain.chainName} (Chain ${chain.chainId}):`);
    console.log(`  - Total Supply: ${ethers.formatEther(chain.totalSupply)} LOOK`);
    console.log(`  - Minted: ${ethers.formatEther(chain.totalMinted)} LOOK`);
    console.log(`  - Burned: ${ethers.formatEther(chain.totalBurned)} LOOK`);
    console.log(`  - Circulating: ${ethers.formatEther(chain.circulatingSupply)} LOOK`);
  }
  
  console.log("─".repeat(80));
  console.log("Global Totals:");
  console.log(`  - Total Supply: ${ethers.formatEther(totalSupplyAcrossChains)} LOOK`);
  console.log(`  - Total Minted: ${ethers.formatEther(totalMintedAcrossChains)} LOOK`);
  console.log(`  - Total Burned: ${ethers.formatEther(totalBurnedAcrossChains)} LOOK`);
  console.log(`  - Circulating: ${ethers.formatEther(totalCirculatingSupply)} LOOK`);
  console.log(`  - Expected: ${ethers.formatEther(GLOBAL_TOTAL_SUPPLY)} LOOK`);

  // ============================================================================
  // STEP 3: CHECK SUPPLY HEALTH
  // ============================================================================
  console.log("\n🏥 Step 3: Checking supply health...\n");

  const expectedSupply = await supplyOracle.totalExpectedSupply();
  const discrepancy = totalSupplyAcrossChains > expectedSupply ? 
    totalSupplyAcrossChains - expectedSupply : 
    expectedSupply - totalSupplyAcrossChains;

  const isHealthy = discrepancy <= TOLERANCE_THRESHOLD;

  console.log(`Expected Supply: ${ethers.formatEther(expectedSupply)} LOOK`);
  console.log(`Actual Supply: ${ethers.formatEther(totalSupplyAcrossChains)} LOOK`);
  console.log(`Discrepancy: ${ethers.formatEther(discrepancy)} LOOK`);
  console.log(`Tolerance: ${ethers.formatEther(TOLERANCE_THRESHOLD)} LOOK`);
  console.log(`Status: ${isHealthy ? "✅ HEALTHY" : "❌ UNHEALTHY"}`);

  if (!isHealthy) {
    console.log("\n⚠️  WARNING: Supply discrepancy exceeds tolerance threshold!");
    console.log("Bridges may be automatically paused by SupplyOracle.");
  }

  // Check for data collection errors
  if (errors.length > 0) {
    console.log("\n⚠️  Warning: Could not collect data from all chains:");
    errors.forEach(error => console.log(`   - ${error}`));
    console.log("\nReconciliation may be incomplete. Consider:");
    console.log("1. Checking RPC endpoints in hardhat.config.ts");
    console.log("2. Ensuring all chains are accessible");
    console.log("3. Verifying deployment artifacts exist for all chains");
  }

  // ============================================================================
  // STEP 4: UPDATE SUPPLY ORACLE (Multi-Sig Required)
  // ============================================================================
  console.log("\n📝 Step 4: Updating Supply Oracle with chain data...\n");

  // Check if reconciliation is needed
  const lastReconciliationTime = await supplyOracle.lastReconciliationTime();
  const reconciliationInterval = await supplyOracle.reconciliationInterval();
  const currentTime = Math.floor(Date.now() / 1000);
  
  const timeSinceLastReconciliation = BigInt(currentTime) - lastReconciliationTime;
  const shouldUpdate = timeSinceLastReconciliation >= reconciliationInterval;

  console.log(`Last Reconciliation: ${new Date(Number(lastReconciliationTime) * 1000).toISOString()}`);
  console.log(`Time Since Last: ${timeSinceLastReconciliation} seconds`);
  console.log(`Interval: ${reconciliationInterval} seconds`);
  console.log(`Should Update: ${shouldUpdate ? "Yes" : "No"}`);

  // Get protocol-specific chain IDs for supply updates
  const { getLayerZeroChainId, getCelerChainId } = await import("./utils/deployment");
  const { getChainConfig } = await import("../hardhat.config");

  if (shouldUpdate || !isHealthy) {
    console.log("\n🔄 Submitting supply updates for each chain...");
    console.log("Note: This requires 3 oracle signatures to execute\n");
    
    // Use timestamp as nonce for coordination between oracles
    const nonce = currentTime;
    console.log(`Using nonce: ${nonce} (current timestamp)\n`);

    // Check if contract supports batch updates
    const contractCode = await ethers.provider.getCode(supplyOracle.target);
    const supportsBatchUpdate = contractCode.includes(ethers.id("batchUpdateSupply(tuple[],uint256)").slice(2, 10));
    
    if (supportsBatchUpdate) {
      // Use optimized batch update (single transaction)
      console.log("Using optimized batch update...\n");
      
      // Prepare batch update data
      const batchUpdates = chainSupplies.map(chain => {
        const networkNameForChain = getNetworkName(chain.chainId);
        const chainConfig = getChainConfig(networkNameForChain.toLowerCase().replace(/\s+/g, ""));
        
        let oracleChainId = chain.chainId;
        if (chainConfig.protocols.layerZero) {
          oracleChainId = getLayerZeroChainId(chain.chainId);
        } else if (chainConfig.protocols.celer) {
          oracleChainId = getCelerChainId(chain.chainId);
        }
        
        console.log(`  - ${chain.chainName}: ${ethers.formatEther(chain.totalSupply)} LOOK (locked: ${ethers.formatEther(chain.lockedSupply)})`);
        
        return {
          chainId: oracleChainId,
          totalSupply: chain.totalSupply,
          lockedSupply: chain.lockedSupply
        };
      });
      
      try {
        console.log("\nSubmitting batch update...");
        const tx = await supplyOracle.batchUpdateSupply(batchUpdates, nonce);
        console.log(`Transaction: ${tx.hash}`);
        await tx.wait();
        console.log("✅ Batch update submitted successfully!");
        
        // Check signature count
        const updateHash = ethers.solidityPackedKeccak256(
          ["bytes", "uint256"],
          [ethers.AbiCoder.defaultAbiCoder().encode(
            ["tuple(uint32,uint256,uint256)[]"],
            [batchUpdates]
          ), nonce]
        );
        const signatureCount = await supplyOracle.updateSignatureCount(updateHash);
        const requiredSignatures = await supplyOracle.requiredSignatures();
        console.log(`Signatures: ${signatureCount}/${requiredSignatures}`);
        
      } catch (error: any) {
        if (error.message?.includes("already signed")) {
          console.log("⚠️  You have already signed this batch update");
        } else {
          console.error(`❌ Failed to submit batch update: ${error.message || error}`);
        }
      }
    } else {
      // Fallback to individual updates for older contracts
      console.log("Using individual updates (legacy mode)...\n");
      
      for (const chain of chainSupplies) {
        try {
          const networkName = getNetworkName(chain.chainId);
          const chainConfig = getChainConfig(networkName.toLowerCase().replace(/\s+/g, ""));
          
          let oracleChainId = chain.chainId;
          if (chainConfig.protocols.layerZero) {
            oracleChainId = getLayerZeroChainId(chain.chainId);
          } else if (chainConfig.protocols.celer) {
            oracleChainId = getCelerChainId(chain.chainId);
          }

          console.log(`Submitting update for ${chain.chainName} (Oracle Chain ID: ${oracleChainId}):`);
          console.log(`  - Total Supply: ${ethers.formatEther(chain.totalSupply)} LOOK`);
          console.log(`  - Locked Supply: ${ethers.formatEther(chain.lockedSupply)} LOOK`);
          
          const tx = await supplyOracle.updateSupply(
            oracleChainId,
            chain.totalSupply,
            chain.lockedSupply,
            nonce
          );
          
          console.log(`  - Transaction: ${tx.hash}`);
          await tx.wait();
          console.log(`  ✅ Supply update submitted successfully`);
          
          const updateHash = ethers.solidityPackedKeccak256(
            ["uint32", "uint256", "uint256", "uint256"],
            [oracleChainId, chain.totalSupply, chain.lockedSupply, nonce]
          );
          const signatureCount = await supplyOracle.updateSignatureCount(updateHash);
          const requiredSignatures = await supplyOracle.requiredSignatures();
          
          console.log(`  - Signatures: ${signatureCount}/${requiredSignatures}\n`);
          
        } catch (error: any) {
          if (error.message?.includes("already signed")) {
            console.log(`  ⚠️  You have already signed this update\n`);
          } else {
            console.error(`  ❌ Failed to submit update: ${error.message || error}\n`);
          }
        }
      }
    }
    
    console.log("\n📊 Supply Update Summary:");
    console.log("- Updates submitted for all chains");
    console.log("- Waiting for additional oracle signatures to execute");
    console.log("- Once threshold is reached, reconciliation will execute automatically");
    
    // Try to trigger reconciliation (will only work if we have enough signatures)
    try {
      console.log("\n🔄 Attempting to trigger reconciliation...");
      const tx = await supplyOracle.reconcileSupply();
      console.log(`Transaction submitted: ${tx.hash}`);
      await tx.wait();
      console.log("✅ Reconciliation completed successfully!");
    } catch (error: any) {
      if (error.message?.includes("paused")) {
        console.log("⚠️  SupplyOracle is paused");
      } else {
        console.log("ℹ️  Reconciliation will execute automatically when signature threshold is reached");
      }
    }
  } else {
    console.log("\n✅ No supply update needed at this time");
  }

  // ============================================================================
  // STEP 5: GENERATE REPORT
  // ============================================================================
  console.log("\n📋 Reconciliation Report");
  console.log("=".repeat(80));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Initiated From: ${networkName} (Chain ${chainId})`);
  console.log(`Chains Checked: ${chainSupplies.length}`);
  console.log(`Chains Failed: ${errors.length}`);
  console.log(`Total Supply: ${ethers.formatEther(totalSupplyAcrossChains)} / ${ethers.formatEther(GLOBAL_TOTAL_SUPPLY)} LOOK`);
  console.log(`Health Status: ${isHealthy ? "HEALTHY ✅" : "UNHEALTHY ❌"}`);
  console.log(`Reconciliation Triggered: ${shouldUpdate || !isHealthy ? "Yes" : "No"}`);
  console.log("=".repeat(80));

  // ============================================================================
  // RECOMMENDATIONS
  // ============================================================================
  console.log("\n💡 Recommendations:\n");

  if (totalMintedAcrossChains < GLOBAL_TOTAL_SUPPLY) {
    const remaining = GLOBAL_TOTAL_SUPPLY - totalMintedAcrossChains;
    console.log(`1. ${ethers.formatEther(remaining)} LOOK remains unminted from the 5 billion cap`);
    
    // Check if BSC has minted the full supply
    const bscChain = chainSupplies.find(c => c.chainName.toLowerCase().includes('bsc'));
    if (bscChain && bscChain.totalMinted < GLOBAL_TOTAL_SUPPLY) {
      console.log(`   - BSC (home chain) should mint the remaining tokens`);
    }
  }

  if (!isHealthy) {
    console.log("2. Supply discrepancy detected - investigate immediately:");
    console.log("   - Check for unauthorized minting");
    console.log("   - Verify bridge operations are balanced");
    console.log("   - Review recent cross-chain transfers");
  }

  if (errors.length > 0) {
    console.log(`3. Failed to query ${errors.length} chain(s) - ensure all RPC endpoints are accessible`);
  }

  console.log("\n✅ Reconciliation process completed!");
  
  // Return summary for Lambda handler
  return {
    success: true,
    chainId,
    networkName,
    chainsChecked: chainSupplies.length,
    chainsFailed: errors.length,
    totalSupply: ethers.formatEther(totalSupplyAcrossChains),
    expectedSupply: ethers.formatEther(GLOBAL_TOTAL_SUPPLY),
    isHealthy,
    updateSubmitted: shouldUpdate || !isHealthy,
    timestamp: new Date().toISOString()
  };
}

/**
 * Collect supply data from a specific chain
 */
async function collectChainSupplyData(
  chainId: number,
  chainName: string,
  lookCoin: Contract
): Promise<ChainSupplyData> {
  const totalSupply = await lookCoin.totalSupply();
  const totalMinted = await lookCoin.totalMinted();
  const totalBurned = await lookCoin.totalBurned();
  
  // Calculate locked supply by checking bridge balances
  // In a burn-and-mint architecture, locked supply is typically 0
  // as tokens are burned when bridging out, not locked
  const lockedSupply = 0n;
  
  // Note: For lock-and-mint bridges, you would calculate locked supply like this:
  // const bridgeAddresses = [...]; // Get from deployment config
  // let lockedSupply = 0n;
  // for (const bridge of bridgeAddresses) {
  //   const balance = await lookCoin.balanceOf(bridge);
  //   lockedSupply += balance;
  // }
  
  const circulatingSupply = totalSupply - lockedSupply;

  return {
    chainId,
    chainName,
    totalSupply,
    totalMinted,
    totalBurned,
    lockedSupply,
    circulatingSupply,
    lastChecked: new Date()
  };
}

// Support both direct execution and module import
if (require.main === module) {
  performReconciliation()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}