import { ethers } from "hardhat";
import { getChainConfig, getNetworkName } from "../hardhat.config";
import { loadDeployment, validateDeploymentFormat } from "./utils/deployment";

async function main() {
  console.log("Starting LookCoin post-deployment setup (local configuration only)...");

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

  // Validate deployment format
  if (!validateDeploymentFormat(deployment)) {
    console.warn("⚠️  Deployment format validation warnings detected");
  }

  console.log(`Found ${deployment.deploymentMode || 'legacy'} deployment from ${deployment.timestamp}`);
  
  // Invariant: Only configure contracts deployed on current network
  if (deployment.chainId !== chainId) {
    throw new Error(`Deployment is for chain ${deployment.chainId} but current chain is ${chainId}`);
  }

  // Get contract instances
  const lookCoin = await ethers.getContractAt("LookCoin", deployment.contracts.LookCoin.proxy);
  const supplyOracle = await ethers.getContractAt("SupplyOracle", deployment.contracts.SupplyOracle.proxy);

  // Configuration steps
  console.log("\n1. Configuring roles...");

  // Handle protocol modules from the new deployment format
  if (deployment.protocolContracts) {
    // Grant MINTER_ROLE to protocol modules that need it
    const minterRole = await lookCoin.MINTER_ROLE();
    
    // XERC20Module needs MINTER_ROLE
    if (deployment.protocolContracts.xerc20Module) {
      const hasMinterRole = await lookCoin.hasRole(minterRole, deployment.protocolContracts.xerc20Module);
      if (!hasMinterRole) {
        console.log(`Granting MINTER_ROLE to XERC20Module at ${deployment.protocolContracts.xerc20Module}...`);
        const tx = await lookCoin.grantRole(minterRole, deployment.protocolContracts.xerc20Module);
        await tx.wait();
        console.log(`✅ MINTER_ROLE granted to XERC20Module`);
      } else {
        console.log(`✓ XERC20Module already has MINTER_ROLE`);
      }
    }
    
    // HyperlaneModule needs MINTER_ROLE
    if (deployment.protocolContracts.hyperlaneModule) {
      const hasMinterRole = await lookCoin.hasRole(minterRole, deployment.protocolContracts.hyperlaneModule);
      if (!hasMinterRole) {
        console.log(`Granting MINTER_ROLE to HyperlaneModule at ${deployment.protocolContracts.hyperlaneModule}...`);
        const tx = await lookCoin.grantRole(minterRole, deployment.protocolContracts.hyperlaneModule);
        await tx.wait();
        console.log(`✅ MINTER_ROLE granted to HyperlaneModule`);
      } else {
        console.log(`✓ HyperlaneModule already has MINTER_ROLE`);
      }
    }
  }

  // Check and grant MINTER_ROLE to CelerIMModule (legacy format support)
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

  // Helper function to register bridge
  async function registerBridgeIfNeeded(chainId: number, bridgeAddress: string, bridgeName: string) {
    try {
      const isRegistered = await supplyOracle.bridgeInfo(chainId, bridgeAddress);
      if (!isRegistered.isActive) {
        console.log(`Registering ${bridgeName} as bridge for chain ${chainId}...`);
        const tx = await supplyOracle.registerBridge(chainId, bridgeAddress);
        await tx.wait();
        console.log(`✅ ${bridgeName} registered with SupplyOracle`);
      } else {
        console.log(`✓ ${bridgeName} already registered with SupplyOracle`);
      }
    } catch (error) {
      // Bridge not registered yet
      console.log(`Registering ${bridgeName} as bridge for chain ${chainId}...`);
      const tx = await supplyOracle.registerBridge(chainId, bridgeAddress);
      await tx.wait();
      console.log(`✅ ${bridgeName} registered with SupplyOracle`);
    }
  }

  // Register bridges based on deployed protocols
  if (deployment.protocolsDeployed && deployment.protocolsDeployed.includes("layerZero")) {
    const bridgeChainId = chainConfig.layerZero.lzChainId || chainId;
    await registerBridgeIfNeeded(bridgeChainId, lookCoinAddress, "LookCoin (LayerZero)");
  }
  
  // Register protocol-specific bridges from new format
  if (deployment.protocolContracts) {
    if (deployment.protocolContracts.xerc20Module) {
      await registerBridgeIfNeeded(chainId, deployment.protocolContracts.xerc20Module, "XERC20Module");
    }
    
    if (deployment.protocolContracts.hyperlaneModule) {
      await registerBridgeIfNeeded(chainId, deployment.protocolContracts.hyperlaneModule, "HyperlaneModule");
    }
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


  console.log("\n3. Configuration Summary:");
  console.log(`- Network: ${networkName} (Chain ID: ${chainId})`);
  console.log(`- Deployment Mode: ${deployment.deploymentMode || 'legacy'}`);
  console.log(`- Governance Vault: ${chainConfig.governanceVault}`);
  console.log(`- LookCoin: ${lookCoinAddress}`);
  console.log(`- SupplyOracle: ${deployment.contracts.SupplyOracle.proxy}`);
  
  // Display protocol modules
  if (deployment.protocolsDeployed && deployment.protocolsDeployed.length > 0) {
    console.log(`- Protocols Deployed: ${deployment.protocolsDeployed.join(', ')}`);
  }
  
  // Display protocol contracts
  if (deployment.protocolContracts && Object.keys(deployment.protocolContracts).length > 0) {
    console.log("- Protocol Modules:");
    for (const [name, address] of Object.entries(deployment.protocolContracts)) {
      if (address) {
        console.log(`  - ${name}: ${address}`);
      }
    }
  }
  
  // Display infrastructure contracts for multi-protocol deployments
  if (deployment.infrastructureContracts && Object.keys(deployment.infrastructureContracts).length > 0) {
    console.log("- Infrastructure Contracts:");
    for (const [name, address] of Object.entries(deployment.infrastructureContracts)) {
      if (address) {
        console.log(`  - ${name}: ${address}`);
      }
    }
  }
  
  // Legacy format support
  if (deployment.contracts.CelerIMModule) {
    console.log(`- CelerIMModule: ${deployment.contracts.CelerIMModule.proxy}`);
  }

  console.log("\n✅ Setup completed successfully!");
  console.log("\n⚠️  Next steps:");

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
    console.log(`1. Run configure script for cross-chain setup: ${configureScriptMap[networkKey]}`);
    console.log("   (This will set up trusted remotes and cross-chain connections)");
  } else {
    console.log("1. Deploy to other networks before running cross-chain configuration");
  }

  console.log("2. Verify all roles are correctly assigned");
  console.log("3. Test bridge functionality on this network");
  console.log("4. Monitor SupplyOracle for cross-chain balance tracking");
  
  if (deployment.deploymentMode === "multi-protocol") {
    console.log("\n⚡ Multi-Protocol Mode: Additional protocol-specific configuration may be required");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
