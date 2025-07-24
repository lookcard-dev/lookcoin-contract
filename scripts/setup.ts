import { ethers } from "hardhat";
import { getChainConfig, getNetworkName } from "../hardhat.config";
import { loadDeployment, validateDeploymentFormat } from "./utils/deployment";
import { isHyperlaneReady } from "./utils/protocolDetector";

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
    const bridgeRole = await lookCoin.BRIDGE_ROLE();
    
    // LayerZeroModule needs BRIDGE_ROLE (for burn/mint)
    if (deployment.protocolContracts.layerZeroModule) {
      const hasBridgeRole = await lookCoin.hasRole(bridgeRole, deployment.protocolContracts.layerZeroModule);
      if (!hasBridgeRole) {
        console.log(`Granting BRIDGE_ROLE to LayerZeroModule at ${deployment.protocolContracts.layerZeroModule}...`);
        const tx = await lookCoin.grantRole(bridgeRole, deployment.protocolContracts.layerZeroModule);
        await tx.wait();
        console.log(`✅ BRIDGE_ROLE granted to LayerZeroModule`);
      } else {
        console.log(`✓ LayerZeroModule already has BRIDGE_ROLE`);
      }
    }
    
    // HyperlaneModule needs MINTER_ROLE (only if ready)
    if (deployment.protocolContracts.hyperlaneModule && isHyperlaneReady(chainConfig)) {
      const hasMinterRole = await lookCoin.hasRole(minterRole, deployment.protocolContracts.hyperlaneModule);
      if (!hasMinterRole) {
        console.log(`Granting MINTER_ROLE to HyperlaneModule at ${deployment.protocolContracts.hyperlaneModule}...`);
        const tx = await lookCoin.grantRole(minterRole, deployment.protocolContracts.hyperlaneModule);
        await tx.wait();
        console.log(`✅ MINTER_ROLE granted to HyperlaneModule`);
      } else {
        console.log(`✓ HyperlaneModule already has MINTER_ROLE`);
      }
    } else if (deployment.protocolContracts.hyperlaneModule) {
      console.log(`⚠️  Skipping HyperlaneModule setup - Hyperlane not ready`);
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


  // Check and grant BURNER_ROLE to LookCoin itself (for direct LayerZero OFT burns)
  const lookCoinAddress = deployment.contracts.LookCoin.proxy;
  const burnerRole = await lookCoin.BURNER_ROLE();
  const hasBurnerRole = await lookCoin.hasRole(burnerRole, lookCoinAddress);

  if (!hasBurnerRole) {
    console.log(`Granting BURNER_ROLE to LookCoin for direct OFT functionality...`);
    const tx = await lookCoin.grantRole(burnerRole, lookCoinAddress);
    await tx.wait();
    console.log(`✅ BURNER_ROLE granted to LookCoin (enables direct LayerZero OFT)`)
  } else {
    console.log(`✓ LookCoin already has BURNER_ROLE (direct OFT enabled)`);
  }

  // Configure LayerZero endpoint if not already set (for direct OFT)
  const currentEndpoint = await lookCoin.lzEndpoint();
  if (currentEndpoint === ethers.ZeroAddress && chainConfig.layerZero?.endpoint) {
    console.log("Setting LayerZero endpoint on LookCoin for direct OFT...");
    const tx = await lookCoin.setLayerZeroEndpoint(chainConfig.layerZero.endpoint);
    await tx.wait();
    console.log(`✅ LayerZero endpoint set for direct OFT functionality`);
  } else if (currentEndpoint !== ethers.ZeroAddress) {
    console.log(`✓ LayerZero endpoint already configured: ${currentEndpoint}`);
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
    
    // Register Hyperlane bridge only if ready
    if (deployment.protocolContracts.hyperlaneModule && isHyperlaneReady(chainConfig)) {
      // Use Hyperlane domain ID instead of chain ID
      const hyperlaneDomainId = chainConfig.hyperlane?.hyperlaneDomainId || chainId;
      await registerBridgeIfNeeded(hyperlaneDomainId, deployment.protocolContracts.hyperlaneModule, "HyperlaneModule");
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


  // Configure CrossChainRouter if deployed
  if (deployment.infrastructureContracts?.crossChainRouter) {
    console.log("\n2.5. Configuring CrossChainRouter...");
    const crossChainRouter = await ethers.getContractAt(
      "CrossChainRouter", 
      deployment.infrastructureContracts.crossChainRouter
    );

    // Register protocol modules
    if (deployment.protocolContracts) {
      // Register LayerZero module
      if (deployment.protocolContracts.layerZeroModule) {
        console.log("Registering LayerZero module...");
        const tx1 = await crossChainRouter.registerProtocol(
          0, // Protocol.LayerZero
          deployment.protocolContracts.layerZeroModule
        );
        await tx1.wait();
        console.log("✅ LayerZero module registered");
      }

      // Register Celer module
      if (deployment.contracts.CelerIMModule) {
        console.log("Registering Celer module...");
        const tx2 = await crossChainRouter.registerProtocol(
          1, // Protocol.Celer
          deployment.contracts.CelerIMModule.proxy
        );
        await tx2.wait();
        console.log("✅ Celer module registered");
      }

      // Register Hyperlane module if ready
      if (deployment.protocolContracts.hyperlaneModule && isHyperlaneReady(chainConfig)) {
        console.log("Registering Hyperlane module...");
        const tx3 = await crossChainRouter.registerProtocol(
          2, // Protocol.Hyperlane
          deployment.protocolContracts.hyperlaneModule
        );
        await tx3.wait();
        console.log("✅ Hyperlane module registered");
      }
    }

    // Grant BRIDGE_ROLE to CrossChainRouter so it can call modules
    const BRIDGE_ROLE = await lookCoin.BRIDGE_ROLE();
    const hasRole = await lookCoin.hasRole(BRIDGE_ROLE, deployment.infrastructureContracts.crossChainRouter);
    if (!hasRole) {
      console.log("Granting BRIDGE_ROLE to CrossChainRouter...");
      const tx = await lookCoin.grantRole(BRIDGE_ROLE, deployment.infrastructureContracts.crossChainRouter);
      await tx.wait();
      console.log("✅ BRIDGE_ROLE granted to CrossChainRouter");
    }
  }

  console.log("\n3. Configuration Summary:");
  console.log(`- Network: ${networkName} (Chain ID: ${chainId})`);
  console.log(`- Deployment Mode: ${deployment.deploymentMode || 'legacy'}`);
  console.log(`- Governance Vault: ${chainConfig.governanceVault}`);
  console.log(`- LookCoin: ${lookCoinAddress}`);
  console.log(`- SupplyOracle: ${deployment.contracts.SupplyOracle.proxy}`);
  
  // Show protocol status
  if (isHyperlaneReady(chainConfig)) {
    console.log(`- Hyperlane: Ready (Domain ID: ${chainConfig.hyperlane?.hyperlaneDomainId})`);
  } else {
    console.log(`- Hyperlane: Not ready (missing mailbox or gas paymaster)`);
  }
  console.log(`- XERC20: Deprecated`);
  
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
