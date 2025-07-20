import hre from "hardhat";
import { ethers, upgrades } from "hardhat";
import { getChainConfig, getNetworkName } from "../hardhat.config";
import { loadDeployment, saveDeployment, getBytecodeHash, Deployment } from "./utils/deployment";
import { fetchDeployOrUpgradeProxy } from "./utils/state";
import fs from "fs";
import path from "path";

// Deployment state management
interface DeploymentStep {
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
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

// Load latest deployment state
function loadDeploymentState(network: string): DeploymentState | null {
  const latestPath = path.join(__dirname, `../deployments/.state/${network}-latest.json`);
  if (fs.existsSync(latestPath)) {
    return JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  }
  return null;
}

// Wait for transaction with timeout
async function waitForTransaction(hash: string, confirmations = 2, timeoutMs = 300000) {
  const provider = ethers.provider;
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const receipt = await provider.waitForTransaction(hash, confirmations);
      if (receipt && receipt.status === 1) {
        return receipt;
      } else if (receipt && receipt.status === 0) {
        throw new Error("Transaction failed");
      }
    } catch (error) {
      if (Date.now() - startTime >= timeoutMs) {
        throw new Error(`Transaction timeout after ${timeoutMs}ms`);
      }
      // Continue waiting
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  throw new Error(`Transaction timeout after ${timeoutMs}ms`);
}

// Retry logic with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.log(`Attempt ${i + 1} failed: ${error}`);
      
      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

async function main() {
  console.log("Starting LookCoin deployment with enhanced safety features...");

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`Deploying on chain ${chainId} with account: ${deployer.address}`);
  console.log(`Account balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  
  // Check network connectivity
  try {
    const blockNumber = await ethers.provider.getBlockNumber();
    console.log(`Connected to network at block ${blockNumber}`);
  } catch (error) {
    console.error("❌ Network connectivity check failed:", error);
    throw new Error("Cannot connect to network");
  }

  // Get network name and centralized configuration
  const networkName = getNetworkName(chainId);
  const chainConfig = getChainConfig(networkName.toLowerCase().replace(/\s+/g, ""));

  // Get governance vault from centralized config or CLI override
  const governanceVault = process.argv[2] || chainConfig.governanceVault;
  if (!governanceVault || governanceVault === "0x0000000000000000000000000000000000000000") {
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
      { name: "LookCoin", status: 'pending' },
      { name: "CelerIMModule", status: 'pending' },
      { name: "IBCModule", status: 'pending' },
      { name: "SupplyOracle", status: 'pending' }
    ],
    checkpoint: existingDeployment
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

  // Deploy or upgrade LookCoin
  console.log("\n⌛️ 1. Processing LookCoin...");
  const lookCoinStep = deploymentState.steps.find(s => s.name === "LookCoin")!;
  lookCoinStep.status = 'in_progress';
  lookCoinStep.timestamp = new Date().toISOString();
  saveDeploymentState(deploymentState);
  
  try {
    const lookCoin = await retryWithBackoff(async () => {
      // Estimate gas before deployment
      console.log("  📊 Estimating gas...");
      const deployTx = await ethers.getContractFactory("LookCoin").then(f => f.getDeployTransaction());
      const gasEstimate = await ethers.provider.estimateGas(deployTx);
      console.log(`  ⛽ Estimated gas: ${gasEstimate.toString()}`);
      
      return fetchDeployOrUpgradeProxy(hre, "LookCoin", [governanceVault, lzEndpoint], {
        initializer: "initialize",
        kind: "uups",
      });
    });
    
    const lookCoinAddress = await lookCoin.getAddress();
    const lookCoinArtifact = await hre.artifacts.readArtifact("LookCoin");
    const lookCoinBytecodeHash = getBytecodeHash(lookCoinArtifact.deployedBytecode);

    // Verify deployment
    console.log("  🔍 Verifying deployment...");
    const code = await ethers.provider.getCode(lookCoinAddress);
    if (code === "0x") {
      throw new Error("Contract deployment failed - no code at address");
    }

    deployment.contracts.LookCoin = {
      proxy: lookCoinAddress,
      implementation: await upgrades.erc1967.getImplementationAddress(lookCoinAddress),
    };
    deployment.implementationHashes!.LookCoin = lookCoinBytecodeHash;
    
    lookCoinStep.status = 'completed';
    lookCoinStep.contractAddress = lookCoinAddress;
    saveDeploymentState(deploymentState);
    
    console.log("✅ 1. LookCoin completed at:", lookCoinAddress);
  } catch (error: any) {
    lookCoinStep.status = 'failed';
    lookCoinStep.error = error.message;
    saveDeploymentState(deploymentState);
    
    console.error("❌ Failed to deploy/upgrade LookCoin:", error);
    console.error("\n🔄 Rollback information saved. To resume, run: npm run deploy:resume");
    throw error;
  }

  // Deploy or upgrade CelerIMModule (if Celer is available on this chain)
  let celerModuleAddress: string | null = null;
  if (celerMessageBus !== "0x0000000000000000000000000000000000000000") {
    console.log("\n⌛️ 2. Processing CelerIMModule...");
    const celerStep = deploymentState.steps.find(s => s.name === "CelerIMModule")!;
    celerStep.status = 'in_progress';
    celerStep.timestamp = new Date().toISOString();
    saveDeploymentState(deploymentState);
    
    try {
      const lookCoinAddress = deployment.contracts.LookCoin.proxy;
      const celerModule = await retryWithBackoff(async () => {
        return fetchDeployOrUpgradeProxy(
          hre,
          "CelerIMModule",
          [lookCoinAddress, celerMessageBus, governanceVault],
          { initializer: "initialize", kind: "uups" },
        );
      });
      
      celerModuleAddress = await celerModule.getAddress();
      
      // Verify deployment
      const code = await ethers.provider.getCode(celerModuleAddress);
      if (code === "0x") {
        throw new Error("Contract deployment failed - no code at address");
      }
      
      const celerArtifact = await hre.artifacts.readArtifact("CelerIMModule");
      const celerBytecodeHash = getBytecodeHash(celerArtifact.deployedBytecode);

      deployment.contracts.CelerIMModule = {
        proxy: celerModuleAddress,
        implementation: await upgrades.erc1967.getImplementationAddress(celerModuleAddress),
      };
      deployment.implementationHashes!.CelerIMModule = celerBytecodeHash;
      
      celerStep.status = 'completed';
      celerStep.contractAddress = celerModuleAddress;
      saveDeploymentState(deploymentState);
      console.log("✅ 2. CelerIMModule completed");
    } catch (error) {
      console.error("❌ Failed to deploy/upgrade CelerIMModule:", error);
      throw error;
    }
  }

  // Deploy or upgrade IBCModule (only on BSC)
  let ibcModuleAddress: string | null = null;
  if (chainId === 56 || chainId === 97) {
    console.log("\n⌛️ 3. Processing IBCModule...");
    try {
      const lookCoinAddress = deployment.contracts.LookCoin.proxy;
      const vaultAddress = governanceVault;
      const ibcModule = await fetchDeployOrUpgradeProxy(
        hre,
        "IBCModule",
        [lookCoinAddress, vaultAddress, governanceVault],
        { initializer: "initialize", kind: "uups" },
      );
      ibcModuleAddress = await ibcModule.getAddress();
      const ibcArtifact = await hre.artifacts.readArtifact("IBCModule");
      const ibcBytecodeHash = getBytecodeHash(ibcArtifact.deployedBytecode);

      deployment.contracts.IBCModule = {
        proxy: ibcModuleAddress,
        implementation: await upgrades.erc1967.getImplementationAddress(ibcModuleAddress),
      };
      deployment.implementationHashes!.IBCModule = ibcBytecodeHash;
      console.log("✅ 3. IBCModule completed");
    } catch (error) {
      console.error("❌ Failed to deploy/upgrade IBCModule:", error);
      throw error;
    }
  }

  // Deploy or upgrade SupplyOracle
  console.log("\n⌛️ 4. Processing SupplyOracle...");
  try {
    const totalSupply = chainConfig.totalSupply;
    const supplyOracle = await fetchDeployOrUpgradeProxy(hre, "SupplyOracle", [governanceVault, totalSupply], {
      initializer: "initialize",
      kind: "uups",
    });
    const supplyOracleAddress = await supplyOracle.getAddress();
    const oracleArtifact = await hre.artifacts.readArtifact("SupplyOracle");
    const oracleBytecodeHash = getBytecodeHash(oracleArtifact.deployedBytecode);

    deployment.contracts.SupplyOracle = {
      proxy: supplyOracleAddress,
      implementation: await upgrades.erc1967.getImplementationAddress(supplyOracleAddress),
    };
    deployment.implementationHashes!.SupplyOracle = oracleBytecodeHash;
    console.log("✅ 4. SupplyOracle completed");
  } catch (error) {
    console.error("❌ Failed to deploy/upgrade SupplyOracle:", error);
    throw error;
  }

  // Update deployment timestamp
  deployment.timestamp = new Date().toISOString();
  deployment.lastDeployed = new Date().toISOString();

  console.log("\n5. Deployment Summary:");
  console.log(JSON.stringify(deployment, null, 2));

  // Save deployment
  await saveDeployment(networkName, deployment);

  console.log("\n✅ Deployment completed successfully!");
  console.log("\n⚠️  Next steps:");
  console.log(`1. Run setup script: npm run setup:${networkName.toLowerCase().replace(/\s+/g, "-")}`);

  // Provide network-specific configure script instructions
  const networkKey = networkName.toLowerCase().replace(/\s+/g, "");
  const configureScriptMap: { [key: string]: string } = {
    bsctestnet: "npm run configure:bsc-testnet",
    basesepolia: "npm run configure:base-sepolia",
    opsepolia: "npm run configure:optimism-sepolia",
    optimismsepolia: "npm run configure:optimism-sepolia",
    sapphire: "npm run configure:sapphire-mainnet",
  };

  if (configureScriptMap[networkKey]) {
    console.log(`2. Run configure script: ${configureScriptMap[networkKey]}`);
  } else {
    console.log("2. No network-specific configure script available for this network");
  }

  console.log("3. Verify contracts on block explorer");
  console.log("4. Configure monitoring and alerting");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
