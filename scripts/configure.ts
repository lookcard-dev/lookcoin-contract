import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface Deployment {
  contracts: {
    LookCoin: { proxy: string };
    CelerIMModule?: { proxy: string };
    IBCModule?: { proxy: string };
    SupplyOracle: { proxy: string };
    MPCMultisig: { proxy: string };
  };
}

async function main() {
  console.log("Starting LookCoin cross-chain configuration...");
  
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId;
  
  console.log(`Configuring on chain ${chainId} with account: ${deployer.address}`);
  
  // Load deployment data
  const networkName = getNetworkName(chainId);
  const deploymentPath = path.join(__dirname, `../deployments/${networkName.toLowerCase().replace(/\s+/g, "-")}.json`);
  
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found: ${deploymentPath}`);
  }
  
  const deployment: Deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
  console.log(`Loaded deployment from: ${deploymentPath}`);
  
  // Load other chain deployments
  const otherChainDeployments = loadOtherChainDeployments(chainId);
  
  // Get contract instances
  const lookCoin = await ethers.getContractAt("LookCoin", deployment.contracts.LookCoin.proxy);
  const supplyOracle = await ethers.getContractAt("SupplyOracle", deployment.contracts.SupplyOracle.proxy);
  
  // Configure LayerZero trusted remotes
  console.log("\n1. Configuring LayerZero trusted remotes...");
  for (const [otherChainId, otherDeployment] of Object.entries(otherChainDeployments)) {
    const remoteChainId = getLayerZeroChainId(parseInt(otherChainId));
    const remoteLookCoin = otherDeployment.contracts.LookCoin.proxy;
    
    const trustedRemote = ethers.utils.solidityPack(
      ["address", "address"],
      [remoteLookCoin, deployment.contracts.LookCoin.proxy]
    );
    
    console.log(`Setting trusted remote for chain ${remoteChainId}: ${remoteLookCoin}`);
    await lookCoin.setTrustedRemote(remoteChainId, trustedRemote);
  }
  
  // Configure DVN settings
  console.log("\n2. Configuring DVN settings...");
  const dvnConfig = {
    requiredDVNs: [
      "0x1234567890123456789012345678901234567890", // Example DVN 1
      "0x2345678901234567890123456789012345678901" // Example DVN 2
    ],
    optionalDVNs: [
      "0x3456789012345678901234567890123456789012" // Example DVN 3
    ],
    optionalDVNThreshold: 1,
    confirmations: 15
  };
  
  // Note: Actual DVN configuration would require LayerZero V2 specific methods
  console.log("DVN configuration (to be implemented with LayerZero V2 SDK)");
  
  // Configure Celer IM modules
  if (deployment.contracts.CelerIMModule) {
    console.log("\n3. Configuring Celer IM module...");
    const celerModule = await ethers.getContractAt("CelerIMModule", deployment.contracts.CelerIMModule.proxy);
    
    for (const [otherChainId, otherDeployment] of Object.entries(otherChainDeployments)) {
      if (otherDeployment.contracts.CelerIMModule) {
        const remoteCelerChainId = getCelerChainId(parseInt(otherChainId));
        const remoteCelerModule = otherDeployment.contracts.CelerIMModule.proxy;
        
        console.log(`Setting remote Celer module for chain ${remoteCelerChainId}: ${remoteCelerModule}`);
        await celerModule.setRemoteModule(remoteCelerChainId, remoteCelerModule);
      }
    }
    
    // Configure fee parameters
    console.log("Setting Celer fee parameters...");
    await celerModule.updateFeeParameters(
      50,  // 0.5% fee
      ethers.utils.parseUnits("10", 8),  // 10 LOOK minimum fee
      ethers.utils.parseUnits("1000", 8) // 1000 LOOK maximum fee
    );
    
    // Configure rate limits
    console.log("Setting Celer rate limits...");
    await celerModule.updateRateLimits(
      ethers.utils.parseUnits("100000", 8),  // 100k LOOK per user per hour
      ethers.utils.parseUnits("10000000", 8) // 10M LOOK global per hour
    );
  }
  
  // Configure IBC module (BSC only)
  if (deployment.contracts.IBCModule && (chainId === 56 || chainId === 97)) {
    console.log("\n4. Configuring IBC module...");
    const ibcModule = await ethers.getContractAt("IBCModule", deployment.contracts.IBCModule.proxy);
    
    // Add validators (in production, use actual validator addresses)
    const validators = [
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
      // ... add remaining validators up to 21
    ];
    
    console.log("Setting IBC validators...");
    await ibcModule.updateValidatorSet(validators.slice(0, 21), 14); // 14/21 threshold
    
    // Update IBC configuration
    const ibcConfig = {
      channelId: "channel-0",
      portId: "transfer",
      timeoutHeight: 0,
      timeoutTimestamp: 3600, // 1 hour
      minValidators: 21,
      unbondingPeriod: 14 * 24 * 60 * 60 // 14 days in seconds
    };
    
    console.log("Updating IBC configuration...");
    await ibcModule.updateIBCConfig(ibcConfig);
    
    // Set daily limit
    console.log("Setting IBC daily limit...");
    await ibcModule.updateDailyLimit(ethers.utils.parseUnits("1000000", 8)); // 1M LOOK daily
  }
  
  // Configure Supply Oracle
  console.log("\n5. Configuring Supply Oracle...");
  
  // Register all chain supplies
  for (const [otherChainId, otherDeployment] of Object.entries(otherChainDeployments)) {
    const lzChainId = getLayerZeroChainId(parseInt(otherChainId));
    console.log(`Registering bridge for chain ${lzChainId}`);
    
    await supplyOracle.registerBridge(lzChainId, otherDeployment.contracts.LookCoin.proxy);
    
    if (otherDeployment.contracts.CelerIMModule) {
      await supplyOracle.registerBridge(lzChainId, otherDeployment.contracts.CelerIMModule.proxy);
    }
    
    if (otherDeployment.contracts.IBCModule) {
      await supplyOracle.registerBridge(lzChainId, otherDeployment.contracts.IBCModule.proxy);
    }
  }
  
  // Set reconciliation parameters
  console.log("Setting reconciliation parameters...");
  await supplyOracle.updateReconciliationParams(
    15 * 60, // 15 minutes
    ethers.utils.parseUnits("1000", 8) // 1000 LOOK tolerance
  );
  
  // Configure rate limits on main contract
  console.log("\n6. Configuring main contract rate limits...");
  await lookCoin.updateRateLimits(
    ethers.utils.parseUnits("1000000", 8),  // 1M LOOK per window
    100 // 100 transactions per window
  );
  
  // Grant oracle roles
  console.log("\n7. Granting oracle roles...");
  const ORACLE_ROLE = await supplyOracle.ORACLE_ROLE();
  const OPERATOR_ROLE = await supplyOracle.OPERATOR_ROLE();
  
  // In production, grant to actual oracle operators
  await supplyOracle.grantRole(ORACLE_ROLE, deployer.address);
  await supplyOracle.grantRole(OPERATOR_ROLE, deployer.address);
  
  console.log("\n✅ Configuration completed successfully!");
  
  // Generate configuration summary
  const configSummary = {
    chainId,
    timestamp: new Date().toISOString(),
    layerZeroRemotes: Object.entries(otherChainDeployments).map(([chainId, dep]) => ({
      chainId: getLayerZeroChainId(parseInt(chainId)),
      lookCoin: dep.contracts.LookCoin.proxy
    })),
    celerRemotes: deployment.contracts.CelerIMModule ? 
      Object.entries(otherChainDeployments)
        .filter(([_, dep]) => dep.contracts.CelerIMModule)
        .map(([chainId, dep]) => ({
          chainId: getCelerChainId(parseInt(chainId)),
          module: dep.contracts.CelerIMModule!.proxy
        })) : [],
    supplyOracleConfig: {
      reconciliationInterval: "15 minutes",
      toleranceThreshold: "1000 LOOK"
    }
  };
  
  console.log("\nConfiguration Summary:");
  console.log(JSON.stringify(configSummary, null, 2));
  
  // Save configuration
  const configPath = `./deployments/config-${networkName.toLowerCase().replace(/\s+/g, "-")}.json`;
  fs.writeFileSync(configPath, JSON.stringify(configSummary, null, 2));
  console.log(`\nConfiguration saved to: ${configPath}`);
}

function getNetworkName(chainId: number): string {
  const networks: { [key: number]: string } = {
    56: "BSC Mainnet",
    97: "BSC Testnet",
    8453: "Base Mainnet",
    84531: "Base Testnet",
    10: "Optimism Mainnet",
    420: "Optimism Testnet"
  };
  return networks[chainId] || `Unknown (${chainId})`;
}

function getLayerZeroChainId(chainId: number): number {
  const lzChainIds: { [key: number]: number } = {
    56: 102,    // BSC
    97: 10102,  // BSC Testnet
    8453: 184,  // Base
    84531: 10184, // Base Testnet
    10: 111,    // Optimism
    420: 10111  // Optimism Testnet
  };
  return lzChainIds[chainId] || chainId;
}

function getCelerChainId(chainId: number): number {
  const celerChainIds: { [key: number]: number } = {
    56: 56,     // BSC
    97: 97,     // BSC Testnet
    8453: 8453, // Base
    84531: 84531, // Base Testnet
    10: 10,     // Optimism
    420: 420    // Optimism Testnet
  };
  return celerChainIds[chainId] || chainId;
}

function loadOtherChainDeployments(currentChainId: number): { [chainId: string]: Deployment } {
  const deployments: { [chainId: string]: Deployment } = {};
  const deploymentsDir = path.join(__dirname, "../deployments");
  
  if (!fs.existsSync(deploymentsDir)) {
    console.warn("No deployments directory found");
    return deployments;
  }
  
  const files = fs.readdirSync(deploymentsDir);
  
  for (const file of files) {
    if (file.endsWith(".json") && !file.includes("config")) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(deploymentsDir, file), "utf-8"));
        if (content.chainId && content.chainId !== currentChainId) {
          deployments[content.chainId] = content;
        }
      } catch (e) {
        console.warn(`Failed to load deployment file: ${file}`);
      }
    }
  }
  
  return deployments;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });