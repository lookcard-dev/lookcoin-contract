import { ethers } from "hardhat";
import { getChainConfig } from "../hardhat.config";
import { loadDeployment, getNetworkName } from "./utils/deployment";

async function main() {
  console.log("Starting LookCoin post-deployment setup...");

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = getNetworkName(chainId);

  console.log(`Running setup on ${networkName} with account: ${deployer.address}`);

  // Get centralized configuration
  const chainConfig = getChainConfig(networkName.toLowerCase().replace(/\s+/g, ""));

  // Load deployment data
  const deployment = loadDeployment(networkName);
  if (!deployment) {
    throw new Error(`No deployment found for ${networkName}. Please run deploy.ts first.`);
  }

  console.log(`Found deployment from ${deployment.timestamp}`);

  // Get contract instances
  const lookCoin = await ethers.getContractAt("LookCoin", deployment.contracts.LookCoin.proxy);
  const supplyOracle = await ethers.getContractAt("SupplyOracle", deployment.contracts.SupplyOracle.proxy);

  // Configuration steps
  console.log("\n1. Configuring roles...");

  // Check and grant MINTER_ROLE to CelerIMModule
  if (deployment.contracts.CelerIMModule) {
    const celerModuleAddress = deployment.contracts.CelerIMModule.proxy;
    const minterRole = await lookCoin.MINTER_ROLE();
    const hasMinterRole = await lookCoin.hasRole(minterRole, celerModuleAddress);

    if (!hasMinterRole) {
      console.log(`Granting MINTER_ROLE to CelerIMModule at ${celerModuleAddress}...`);
      const tx = await lookCoin.grantRole(minterRole, celerModuleAddress);
      await tx.wait();
      console.log(`✅ MINTER_ROLE granted to CelerIMModule`);
    } else {
      console.log(`✓ CelerIMModule already has MINTER_ROLE`);
    }
  }

  // Check and grant MINTER_ROLE to IBCModule
  if (deployment.contracts.IBCModule) {
    const ibcModuleAddress = deployment.contracts.IBCModule.proxy;
    const minterRole = await lookCoin.MINTER_ROLE();
    const hasMinterRole = await lookCoin.hasRole(minterRole, ibcModuleAddress);

    if (!hasMinterRole) {
      console.log(`Granting MINTER_ROLE to IBCModule at ${ibcModuleAddress}...`);
      const tx = await lookCoin.grantRole(minterRole, ibcModuleAddress);
      await tx.wait();
      console.log(`✅ MINTER_ROLE granted to IBCModule`);
    } else {
      console.log(`✓ IBCModule already has MINTER_ROLE`);
    }
  }

  // Check and grant BURNER_ROLE to LookCoin itself (for LayerZero burns)
  const lookCoinAddress = deployment.contracts.LookCoin.proxy;
  const burnerRole = await lookCoin.BURNER_ROLE();
  const hasBurnerRole = await lookCoin.hasRole(burnerRole, lookCoinAddress);

  if (!hasBurnerRole) {
    console.log(`Granting BURNER_ROLE to LookCoin at ${lookCoinAddress}...`);
    const tx = await lookCoin.grantRole(burnerRole, lookCoinAddress);
    await tx.wait();
    console.log(`✅ BURNER_ROLE granted to LookCoin`);
  } else {
    console.log(`✓ LookCoin already has BURNER_ROLE`);
  }

  console.log("\n2. Registering bridges with SupplyOracle...");

  // Register LookCoin bridge using proper chain ID from config
  const bridgeChainId = chainConfig.layerZero.lzChainId || chainId;
  try {
    const isRegistered = await supplyOracle.bridgeInfo(bridgeChainId, lookCoinAddress);
    if (!isRegistered.isActive) {
      console.log(`Registering LookCoin as bridge for chain ${bridgeChainId}...`);
      const tx = await supplyOracle.registerBridge(bridgeChainId, lookCoinAddress);
      await tx.wait();
      console.log(`✅ LookCoin registered with SupplyOracle`);
    } else {
      console.log(`✓ LookCoin already registered with SupplyOracle`);
    }
  } catch (error) {
    // Bridge not registered yet
    console.log(`Registering LookCoin as bridge for chain ${bridgeChainId}...`);
    const tx = await supplyOracle.registerBridge(bridgeChainId, lookCoinAddress);
    await tx.wait();
    console.log(`✅ LookCoin registered with SupplyOracle`);
  }

  // Register CelerIMModule bridge
  if (deployment.contracts.CelerIMModule) {
    const celerModuleAddress = deployment.contracts.CelerIMModule.proxy;
    try {
      const celerChainId = chainConfig.celer.celerChainId || chainId;
      const isRegistered = await supplyOracle.bridgeInfo(celerChainId, celerModuleAddress);
      if (!isRegistered.isActive) {
        console.log(`Registering CelerIMModule as bridge for chain ${celerChainId}...`);
        const tx = await supplyOracle.registerBridge(celerChainId, celerModuleAddress);
        await tx.wait();
        console.log(`✅ CelerIMModule registered with SupplyOracle`);
      } else {
        console.log(`✓ CelerIMModule already registered with SupplyOracle`);
      }
    } catch (error) {
      // Bridge not registered yet
      const celerChainId = chainConfig.celer.celerChainId || chainId;
      console.log(`Registering CelerIMModule as bridge for chain ${celerChainId}...`);
      const tx = await supplyOracle.registerBridge(celerChainId, celerModuleAddress);
      await tx.wait();
      console.log(`✅ CelerIMModule registered with SupplyOracle`);
    }
  }

  // Register IBCModule bridge
  if (deployment.contracts.IBCModule) {
    const ibcModuleAddress = deployment.contracts.IBCModule.proxy;
    try {
      // IBC uses regular chain ID for now, can be adjusted if needed
      const ibcChainId = chainId;
      const isRegistered = await supplyOracle.bridgeInfo(ibcChainId, ibcModuleAddress);
      if (!isRegistered.isActive) {
        console.log(`Registering IBCModule as bridge for chain ${ibcChainId}...`);
        const tx = await supplyOracle.registerBridge(ibcChainId, ibcModuleAddress);
        await tx.wait();
        console.log(`✅ IBCModule registered with SupplyOracle`);
      } else {
        console.log(`✓ IBCModule already registered with SupplyOracle`);
      }
    } catch (error) {
      // Bridge not registered yet
      const ibcChainId = chainId;
      console.log(`Registering IBCModule as bridge for chain ${ibcChainId}...`);
      const tx = await supplyOracle.registerBridge(ibcChainId, ibcModuleAddress);
      await tx.wait();
      console.log(`✅ IBCModule registered with SupplyOracle`);
    }
  }

  console.log("\n3. Configuration Summary:");
  console.log(`- Network: ${networkName} (Chain ID: ${chainId})`);
  console.log(`- Governance Vault: ${chainConfig.governanceVault}`);
  console.log(`- LookCoin: ${lookCoinAddress}`);
  console.log(`- SupplyOracle: ${deployment.contracts.SupplyOracle.proxy}`);
  if (deployment.contracts.CelerIMModule) {
    console.log(`- CelerIMModule: ${deployment.contracts.CelerIMModule.proxy}`);
  }
  if (deployment.contracts.IBCModule) {
    console.log(`- IBCModule: ${deployment.contracts.IBCModule.proxy}`);
  }

  console.log("\n✅ Setup completed successfully!");
  console.log("\n⚠️  Next steps:");
  console.log("1. Run configure.ts to set up cross-chain connections");
  console.log("2. Verify all roles are correctly assigned");
  console.log("3. Test bridge functionality");
  console.log("4. Monitor SupplyOracle for cross-chain balance tracking");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });