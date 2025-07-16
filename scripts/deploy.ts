import hre from "hardhat";
import { ethers, upgrades } from "hardhat";
import { getChainConfig } from "../hardhat.config";
import { 
  getNetworkName, 
  loadDeployment, 
  saveDeployment, 
  getBytecodeHash,
  Deployment 
} from "./utils/deployment";
import { fetchDeployOrUpgradeProxy } from "./utils/state";

async function main() {
  console.log("Starting LookCoin deployment...");

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`Deploying on chain ${chainId} with account: ${deployer.address}`);
  console.log(`Account balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

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

  // Prepare deployment object
  const deployment: Deployment = existingDeployment || {
    network: networkName,
    chainId: chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      LookCoin: { proxy: "" },
      SupplyOracle: { proxy: "" }
    },
    config: {
      layerZeroEndpoint: lzEndpoint,
      celerMessageBus: celerMessageBus,
      governanceVault: governanceVault,
    },
    implementationHashes: {},
    lastDeployed: new Date().toISOString()
  };

  // Deploy or upgrade LookCoin
  console.log("\n⌛️ 1. Processing LookCoin...");
  try {
    const lookCoin = await fetchDeployOrUpgradeProxy(
      hre,
      "LookCoin",
      [lzEndpoint, governanceVault, chainConfig.totalSupply],
      { initializer: "initialize", kind: "uups" }
    );
    const lookCoinAddress = await lookCoin.getAddress();
    const lookCoinArtifact = await hre.artifacts.readArtifact("LookCoin");
    const lookCoinBytecodeHash = getBytecodeHash(lookCoinArtifact.deployedBytecode);
    
    deployment.contracts.LookCoin = {
      proxy: lookCoinAddress,
      implementation: await upgrades.erc1967.getImplementationAddress(lookCoinAddress),
    };
    deployment.implementationHashes!.LookCoin = lookCoinBytecodeHash;
    console.log("✅ 1. LookCoin completed");
  } catch (error) {
    console.error("❌ Failed to deploy/upgrade LookCoin:", error);
    throw error;
  }

  // Deploy or upgrade CelerIMModule (if Celer is available on this chain)
  let celerModuleAddress: string | null = null;
  if (celerMessageBus !== "0x0000000000000000000000000000000000000000") {
    console.log("\n⌛️ 2. Processing CelerIMModule...");
    try {
      const lookCoinAddress = deployment.contracts.LookCoin.proxy;
      const celerModule = await fetchDeployOrUpgradeProxy(
        hre,
        "CelerIMModule",
        [celerMessageBus, lookCoinAddress, governanceVault],
        { initializer: "initialize", kind: "uups" }
      );
      celerModuleAddress = await celerModule.getAddress();
      const celerArtifact = await hre.artifacts.readArtifact("CelerIMModule");
      const celerBytecodeHash = getBytecodeHash(celerArtifact.deployedBytecode);
      
      deployment.contracts.CelerIMModule = {
        proxy: celerModuleAddress,
        implementation: await upgrades.erc1967.getImplementationAddress(celerModuleAddress),
      };
      deployment.implementationHashes!.CelerIMModule = celerBytecodeHash;
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
        { initializer: "initialize", kind: "uups" }
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
    const supplyOracle = await fetchDeployOrUpgradeProxy(
      hre,
      "SupplyOracle",
      [governanceVault, totalSupply],
      { initializer: "initialize", kind: "uups" }
    );
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
  console.log("2. Run configure.ts to set up cross-chain connections");
  console.log("3. Verify contracts on block explorer");
  console.log("4. Configure monitoring and alerting");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });