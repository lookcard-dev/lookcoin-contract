import hre from "hardhat";
import { ethers, upgrades } from "hardhat";
import { getChainConfig, getNetworkName } from "../hardhat.config";
import {
  loadDeployment,
  saveDeployment,
  getBytecodeHash,
  Deployment,
  validateDeploymentFormat,
} from "./utils/deployment";
import { ProtocolDetector } from "./utils/protocolDetector";
import { DeploymentOrchestrator, DeploymentConfig } from "./utils/deploymentOrchestrator";
import fs from "fs";
import path from "path";

// Deployment state management
interface DeploymentStep {
  name: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  contractAddress?: string;
  transactionHash?: string;
  error?: string;
  timestamp?: string;
}

interface DeploymentState {
  network: string;
  chainId: number;
  deployer: string;
  startTime: string;
  steps: DeploymentStep[];
  checkpoint: Deployment | null;
}

// Save deployment state for rollback
function saveDeploymentState(state: DeploymentState) {
  const stateDir = path.join(__dirname, "../deployments/.state");
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  const statePath = path.join(stateDir, `${state.network}-${Date.now()}.json`);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  // Also save as latest
  const latestPath = path.join(stateDir, `${state.network}-latest.json`);
  fs.writeFileSync(latestPath, JSON.stringify(state, null, 2));

  return statePath;
}

async function main() {
  // Parse command line options
  const args = process.argv.slice(2);
  const isDebug = args.includes("--debug") || process.env.DEBUG_DEPLOYMENT === "true";
  const isDryRun = args.includes("--dry-run");
  const skipUpgrade = args.includes("--skip-upgrade") || process.env.SKIP_UPGRADE_CHECK === "true";
  const simpleMode =
    args.includes("--simple-mode") ||
    process.env.BSC_SIMPLE_MODE === "true" ||
    process.env.FORCE_STANDARD_MODE === "true";

  // Get governance vault from non-flag arguments or config
  const governanceVaultArg = args.find((arg) => !arg.startsWith("--"));

  if (isDebug) {
    console.log("[DEBUG] Command line options:");
    console.log("[DEBUG]   - Debug mode:", isDebug);
    console.log("[DEBUG]   - Dry run:", isDryRun);
    console.log("[DEBUG]   - Skip upgrade:", skipUpgrade);
    console.log("[DEBUG]   - Simple mode:", simpleMode);
  }

  console.log("Starting LookCoin deployment with enhanced safety features...");

  if (isDryRun) {
    console.log("🔍 DRY RUN MODE - No actual deployment will occur");
  }
  if (skipUpgrade) {
    console.log("⚠️  SKIP UPGRADE MODE - Proxy upgrades will be skipped");
  }
  if (simpleMode) {
    console.log("🚀 SIMPLE MODE - Infrastructure contracts will be skipped");
  }

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`Deploying on chain ${chainId} with account: ${deployer.address}`);
  console.log(`Account balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  // Check network connectivity with retry
  let blockNumber: number;
  let retries = 3;
  while (retries > 0) {
    try {
      blockNumber = await ethers.provider.getBlockNumber();
      console.log(`Connected to network at block ${blockNumber}`);
      break;
    } catch (error) {
      retries--;
      if (retries === 0) {
        console.error("❌ Network connectivity check failed after 3 attempts:", error);
        console.error("\n💡 Troubleshooting tips:");
        console.error("   1. Check your internet connection");
        console.error("   2. Verify RPC URL in .env or hardhat.config.ts");
        console.error("   3. Ensure the network is not experiencing issues");
        console.error("   4. Try using a different RPC provider");
        throw new Error("Cannot connect to network after multiple attempts");
      }
      console.warn(`⚠️  Network connection failed, retrying... (${retries} attempts left)`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Get network name and centralized configuration
  const networkName = getNetworkName(chainId);
  const chainConfig = getChainConfig(networkName.toLowerCase().replace(/\s+/g, ""));

  // Get governance vault from centralized config or CLI override
  const governanceVault = governanceVaultArg || chainConfig.governanceVault;
  if (!governanceVault || governanceVault === "0x0000000000000000000000000000000000000000") {
    console.error("❌ GOVERNANCE_VAULT address is required but not found!");
    console.error("\n💡 How to fix:");
    console.error("   1. Set GOVERNANCE_VAULT in .env file");
    console.error("   2. Pass as command line argument: npm run deploy:network 0xYourVaultAddress");
    console.error("   3. Update hardhat.config.ts with your vault address");
    throw new Error("GOVERNANCE_VAULT address is required. Set in hardhat.config.ts or pass as argument.");
  }

  console.log(`Governance Vault Address: ${governanceVault}`);

  const lzEndpoint = chainConfig.layerZero.endpoint;
  const celerMessageBus = chainConfig.celer.messageBus;

  console.log(`\nDeploying on ${networkName}`);
  console.log(`LayerZero Endpoint: ${lzEndpoint}`);
  console.log(`Celer MessageBus: ${celerMessageBus}`);

  // Load existing deployment if it exists
  const existingDeployment = loadDeployment(networkName);

  // Initialize deployment state for rollback tracking
  const deploymentState: DeploymentState = {
    network: networkName,
    chainId: chainId,
    deployer: deployer.address,
    startTime: new Date().toISOString(),
    steps: [
      { name: "ProtocolDetection", status: "pending" },
      { name: "CoreContracts", status: "pending" },
      { name: "ProtocolModules", status: "pending" },
      { name: "Infrastructure", status: "pending" },
    ],
    checkpoint: existingDeployment,
  };

  // Save initial state
  const stateFile = saveDeploymentState(deploymentState);
  console.log(`\n📁 Deployment state saved to: ${stateFile}`);

  // Prepare deployment object
  const deployment: Deployment = existingDeployment || {
    network: networkName,
    chainId: chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    deploymentMode: "standard", // Will be updated based on detection
    protocolsDeployed: [], // Will be populated during deployment
    contracts: {
      LookCoin: { proxy: "" },
      SupplyOracle: { proxy: "" },
    },
    config: {
      layerZeroEndpoint: lzEndpoint,
      celerMessageBus: celerMessageBus,
      governanceVault: governanceVault,
    },
    implementationHashes: {},
    lastDeployed: new Date().toISOString(),
  };

  // Detect supported protocols
  console.log("\n🔍 Detecting supported protocols...");
  const protocolSupport = ProtocolDetector.detectSupportedProtocols(chainConfig);
  console.log("Supported protocols:", protocolSupport.protocols);

  // Determine deployment mode with simple mode override
  const deploymentMode = simpleMode ? "standard" : DeploymentOrchestrator.determineDeploymentMode(protocolSupport);

  // BSC optimization check
  if ((!simpleMode && chainId === 56) || chainId === 97) {
    // BSC mainnet or testnet
    const isMultiProtocol = protocolSupport.protocols.length > 1;
    if (isMultiProtocol) {
      console.log("\n🔍 BSC Multi-Protocol Deployment Detected");
      console.log("   You can deploy in simple mode for faster single-chain development.");
      console.log("   Use --simple-mode flag or set BSC_SIMPLE_MODE=true to skip infrastructure contracts.");
    }
  }

  console.log(`Deployment mode: ${deploymentMode}`);

  // Prepare deployment configuration
  const deploymentConfig: DeploymentConfig = {
    chainConfig,
    deployer: deployer.address,
    deploymentName: networkName,
    existingDeployment,
    forceStandardMode: simpleMode,
  };

  if (isDryRun) {
    console.log("\n🔍 DRY RUN - Deployment configuration:");
    console.log(JSON.stringify(deploymentConfig, null, 2));
    console.log("\n✅ Dry run complete. No contracts were deployed.");
    process.exit(0);
  }

  // Deploy core contracts
  console.log("\n🚀 Deploying core contracts...");
  const coreContracts = await DeploymentOrchestrator.deployCore(deploymentConfig);

  // Update deployment object with core contracts
  deployment.contracts.LookCoin = {
    proxy: coreContracts.lookCoin,
    implementation: await upgrades.erc1967.getImplementationAddress(coreContracts.lookCoin),
  };
  deployment.contracts.SupplyOracle = {
    proxy: coreContracts.supplyOracle,
    implementation: await upgrades.erc1967.getImplementationAddress(coreContracts.supplyOracle),
  };

  // Update deployment config with the newly deployed contracts
  deploymentConfig.existingDeployment = deployment;

  // Deploy protocol modules
  const protocolContracts = await DeploymentOrchestrator.deployProtocols(deploymentConfig, coreContracts.lookCoin);

  // Update deployment object with protocol contracts
  deployment.protocolContracts = {};
  deployment.protocolsDeployed = [];

  if (protocolContracts.layerZeroModule) {
    deployment.protocolContracts.layerZeroModule = protocolContracts.layerZeroModule;
    deployment.protocolsDeployed.push("layerZero");
  }

  if (protocolContracts.celerIMModule) {
    deployment.contracts.CelerIMModule = {
      proxy: protocolContracts.celerIMModule,
      implementation: await upgrades.erc1967.getImplementationAddress(protocolContracts.celerIMModule),
    };
    deployment.protocolContracts.celerIMModule = protocolContracts.celerIMModule;
    deployment.protocolsDeployed.push("celer");
  }

  if (protocolContracts.hyperlaneModule) {
    deployment.protocolContracts.hyperlaneModule = protocolContracts.hyperlaneModule;
    deployment.protocolsDeployed.push("hyperlane");
  }

  // Deploy infrastructure for multi-protocol mode (unless in simple mode)
  if (deploymentMode === "multi-protocol" && !simpleMode) {
    console.log("\n🏗️ Deploying infrastructure contracts...");
    const infraContracts = await DeploymentOrchestrator.deployInfrastructure(deploymentConfig);
    deployment.infrastructureContracts = infraContracts;
  } else if (deploymentMode === "multi-protocol" && simpleMode) {
    console.log("\n⚡ Skipping infrastructure contracts (simple mode enabled)");
    console.log("   Infrastructure contracts are not required for single-chain operation.");
  }

  // Set deployment mode
  deployment.deploymentMode = deploymentMode;

  // Update implementation hashes
  const lookCoinArtifact = await hre.artifacts.readArtifact("LookCoin");
  deployment.implementationHashes!.LookCoin = getBytecodeHash(lookCoinArtifact.deployedBytecode);

  const supplyOracleArtifact = await hre.artifacts.readArtifact("SupplyOracle");
  deployment.implementationHashes!.SupplyOracle = getBytecodeHash(supplyOracleArtifact.deployedBytecode);

  if (deployment.contracts.CelerIMModule) {
    const celerArtifact = await hre.artifacts.readArtifact("CelerIMModule");
    deployment.implementationHashes!.CelerIMModule = getBytecodeHash(celerArtifact.deployedBytecode);
  }

  // Update deployment timestamp
  deployment.timestamp = new Date().toISOString();
  deployment.lastDeployed = new Date().toISOString();

  // Validate deployment format
  if (!validateDeploymentFormat(deployment)) {
    console.warn("⚠️  Deployment format validation warnings detected. Please review.");
  }

  console.log("\n5. Deployment Summary:");
  console.log("=======================");
  console.log(`Network: ${deployment.network} (Chain ID: ${deployment.chainId})`);
  console.log(`Deployment Mode: ${deployment.deploymentMode}`);
  console.log(`Protocols Deployed: ${deployment.protocolsDeployed?.join(", ") || "None"}`);
  console.log("\nCore Contracts:");
  console.log(`  - LookCoin: ${deployment.contracts.LookCoin.proxy}`);
  console.log(`  - SupplyOracle: ${deployment.contracts.SupplyOracle.proxy}`);

  if (deployment.protocolContracts && Object.keys(deployment.protocolContracts).length > 0) {
    console.log("\nProtocol Modules:");
    for (const [name, address] of Object.entries(deployment.protocolContracts)) {
      console.log(`  - ${name}: ${address}`);
    }
  }

  if (deployment.infrastructureContracts && Object.keys(deployment.infrastructureContracts).length > 0) {
    console.log("\nInfrastructure Contracts:");
    for (const [name, address] of Object.entries(deployment.infrastructureContracts)) {
      console.log(`  - ${name}: ${address}`);
    }
  }

  // Save deployment
  await saveDeployment(networkName, deployment);

  console.log("\n✅ Deployment completed successfully!");
  console.log("\n📋 Next Steps:");
  console.log("=============");
  console.log(`1. Run setup script to configure local roles and settings:`);
  console.log(`   npm run setup:${networkName.toLowerCase().replace(/\s+/g, "-")}`);

  // Check if cross-chain configuration is available
  const hasOtherDeployments =
    fs.existsSync(path.join(__dirname, "../deployments")) &&
    fs
      .readdirSync(path.join(__dirname, "../deployments"))
      .filter((f) => f.endsWith(".json") && !f.includes(networkName.toLowerCase())).length > 0;

  if (hasOtherDeployments) {
    console.log(`\n2. Run configure script to set up cross-chain connections:`);
    const networkKey = networkName.toLowerCase().replace(/\s+/g, "");
    const configureScriptMap: { [key: string]: string } = {
      bsctestnet: "npm run configure:bsc-testnet",
      basesepolia: "npm run configure:base-sepolia",
      opsepolia: "npm run configure:optimism-sepolia",
      optimismsepolia: "npm run configure:optimism-sepolia",
      sapphire: "npm run configure:sapphire-mainnet",
    };

    if (configureScriptMap[networkKey]) {
      console.log(`   ${configureScriptMap[networkKey]}`);
    } else {
      console.log(`   npm run configure:${networkName.toLowerCase().replace(/\s+/g, "-")}`);
    }
  } else {
    console.log(`\n2. Configure script will be available after deploying to other networks`);
  }

  console.log("\n3. Verify contracts on block explorer:");
  console.log("   npm run verify");

  console.log("\n4. Monitor deployment health and set up alerts");

  if (deployment.deploymentMode === "multi-protocol") {
    console.log("\n⚡ Multi-Protocol Mode Detected!");
    console.log("Additional configuration may be required for protocol-specific settings.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
