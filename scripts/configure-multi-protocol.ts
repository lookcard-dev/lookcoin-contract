import { ethers } from "hardhat";
import { getChainConfig, getNetworkName } from "../hardhat.config";
import { loadDeployment, loadOtherChainDeployments } from "./utils/deployment";

async function main() {
  console.log("Starting Multi-Protocol cross-chain configuration...");

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  const networkName = getNetworkName(chainId);
  const chainConfig = getChainConfig(networkName.toLowerCase().replace(/\s+/g, ""));

  console.log(`Configuring on ${networkName} (${chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  // Load deployment
  const deployment = loadDeployment(networkName);
  if (!deployment) {
    throw new Error(`Deployment not found for ${networkName}. Please run deploy-multi-protocol.ts first.`);
  }

  // Load other chain deployments
  const otherChainDeployments = loadOtherChainDeployments(chainId, { allowCrossTier: true });

  // 1. Configure CrossChainRouter
  if (deployment.contracts.CrossChainRouter?.proxy) {
    console.log("\n1. Configuring CrossChainRouter...");
    const router = await ethers.getContractAt("CrossChainRouter", deployment.contracts.CrossChainRouter.proxy);

    // Register protocol modules
    if (deployment.contracts.LayerZeroModule?.proxy) {
      console.log("  - Registering LayerZero module...");
      await router.registerProtocol(0, deployment.contracts.LayerZeroModule.proxy);
    }

    if (deployment.contracts.CelerIMModule?.proxy) {
      console.log("  - Registering Celer module...");
      await router.registerProtocol(1, deployment.contracts.CelerIMModule.proxy);
    }

    if (deployment.contracts.XERC20Module?.proxy) {
      console.log("  - Registering XERC20 module...");
      await router.registerProtocol(2, deployment.contracts.XERC20Module.proxy);
    }

    if (deployment.contracts.HyperlaneModule?.proxy) {
      console.log("  - Registering Hyperlane module...");
      await router.registerProtocol(3, deployment.contracts.HyperlaneModule.proxy);
    }

    // Set up chain protocol support
    console.log("  - Setting up chain protocol support...");
    
    // Configure support for current chain
    if (chainConfig.protocols?.layerZero) {
      await router.setChainProtocolSupport(chainId, 0, true);
    }
    if (chainConfig.protocols?.celer) {
      await router.setChainProtocolSupport(chainId, 1, true);
    }
    if (chainConfig.protocols?.xerc20) {
      await router.setChainProtocolSupport(chainId, 2, true);
    }
    if (chainConfig.protocols?.hyperlane) {
      await router.setChainProtocolSupport(chainId, 3, true);
    }

    // Configure support for other chains
    for (const [otherChainName, otherDeployment] of Object.entries(otherChainDeployments)) {
      const otherChainId = otherDeployment.chainId;
      const otherConfig = getChainConfig(otherChainName.toLowerCase().replace(/\s+/g, ""));
      
      console.log(`  - Configuring support for ${otherChainName} (${otherChainId})...`);
      
      if (otherConfig.protocols?.layerZero) {
        await router.setChainProtocolSupport(otherChainId, 0, true);
      }
      if (otherConfig.protocols?.celer) {
        await router.setChainProtocolSupport(otherChainId, 1, true);
      }
      if (otherConfig.protocols?.xerc20) {
        await router.setChainProtocolSupport(otherChainId, 2, true);
      }
      if (otherConfig.protocols?.hyperlane) {
        await router.setChainProtocolSupport(otherChainId, 3, true);
      }
    }
  }

  // 2. Configure LookCoin
  if (deployment.contracts.LookCoin?.proxy) {
    console.log("\n2. Configuring LookCoin...");
    const lookCoin = await ethers.getContractAt("LookCoin", deployment.contracts.LookCoin.proxy);

    // Set CrossChainRouter
    if (deployment.contracts.CrossChainRouter?.proxy) {
      console.log("  - Setting CrossChainRouter...");
      await lookCoin.setCrossChainRouter(deployment.contracts.CrossChainRouter.proxy);
    }

    // Set Hyperlane mailbox if available
    if (chainConfig.hyperlane?.mailbox && chainConfig.hyperlane.mailbox !== "0x0000000000000000000000000000000000000000") {
      console.log("  - Setting Hyperlane mailbox...");
      await lookCoin.setHyperlaneMailbox(chainConfig.hyperlane.mailbox);
    }

    // Grant roles to protocol modules
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
    const BRIDGE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ROLE"));

    if (deployment.contracts.LayerZeroModule?.proxy) {
      console.log("  - Granting roles to LayerZero module...");
      await lookCoin.grantRole(MINTER_ROLE, deployment.contracts.LayerZeroModule.proxy);
      await lookCoin.grantRole(BURNER_ROLE, deployment.contracts.LayerZeroModule.proxy);
    }

    if (deployment.contracts.CelerIMModule?.proxy) {
      console.log("  - Granting roles to Celer module...");
      await lookCoin.grantRole(MINTER_ROLE, deployment.contracts.CelerIMModule.proxy);
    }

    if (deployment.contracts.XERC20Module?.proxy) {
      console.log("  - Granting roles to XERC20 module...");
      await lookCoin.grantRole(BRIDGE_ROLE, deployment.contracts.XERC20Module.proxy);
      await lookCoin.setAuthorizedBridge(deployment.contracts.XERC20Module.proxy, true);
    }

    if (deployment.contracts.HyperlaneModule?.proxy) {
      console.log("  - Granting roles to Hyperlane module...");
      await lookCoin.grantRole(MINTER_ROLE, deployment.contracts.HyperlaneModule.proxy);
      await lookCoin.grantRole(BURNER_ROLE, deployment.contracts.HyperlaneModule.proxy);
    }
  }

  // 3. Configure Protocol Modules
  // Configure LayerZero Module
  if (deployment.contracts.LayerZeroModule?.proxy) {
    console.log("\n3a. Configuring LayerZero Module...");
    const layerZeroModule = await ethers.getContractAt("LayerZeroModule", deployment.contracts.LayerZeroModule.proxy);

    // Set trusted remotes for other chains
    for (const [otherChainName, otherDeployment] of Object.entries(otherChainDeployments)) {
      if (otherDeployment.contracts.LayerZeroModule?.proxy) {
        console.log(`  - Setting trusted remote for ${otherChainName}...`);
        // Note: This requires LayerZero chain ID mapping
        // Actual implementation would need proper chain ID conversion
      }
    }
  }

  // Configure Celer Module
  if (deployment.contracts.CelerIMModule?.proxy) {
    console.log("\n3b. Configuring Celer Module...");
    const celerModule = await ethers.getContractAt("CelerIMModule", deployment.contracts.CelerIMModule.proxy);

    // Set remote modules
    for (const [otherChainName, otherDeployment] of Object.entries(otherChainDeployments)) {
      if (otherDeployment.contracts.CelerIMModule?.proxy) {
        const otherChainId = otherDeployment.chainId;
        console.log(`  - Setting remote module for ${otherChainName} (${otherChainId})...`);
        await celerModule.setRemoteModule(otherChainId, otherDeployment.contracts.CelerIMModule.proxy);
      }
    }

    // Set fee parameters
    console.log("  - Setting fee parameters...");
    await celerModule.setFeeParameters(25, ethers.parseEther("0.1"), ethers.parseEther("100"));
  }

  // Configure XERC20 Module
  if (deployment.contracts.XERC20Module?.proxy) {
    console.log("\n3c. Configuring XERC20 Module...");
    const xerc20Module = await ethers.getContractAt("XERC20Module", deployment.contracts.XERC20Module.proxy);

    // Register bridges based on chain
    if (chainConfig.xerc20?.bridge && chainConfig.xerc20.bridge !== "0x0000000000000000000000000000000000000000") {
      console.log("  - Registering SuperChain bridge...");
      await xerc20Module.registerBridge(
        chainConfig.xerc20.bridge,
        chainId,
        chainConfig.xerc20.mintingLimit || ethers.parseEther("1000000"),
        chainConfig.xerc20.burningLimit || ethers.parseEther("1000000")
      );
    }
  }

  // Configure Hyperlane Module
  if (deployment.contracts.HyperlaneModule?.proxy) {
    console.log("\n3d. Configuring Hyperlane Module...");
    const hyperlaneModule = await ethers.getContractAt("HyperlaneModule", deployment.contracts.HyperlaneModule.proxy);

    // Set trusted senders for other chains
    for (const [otherChainName, otherDeployment] of Object.entries(otherChainDeployments)) {
      if (otherDeployment.contracts.HyperlaneModule?.proxy) {
        const otherChainId = otherDeployment.chainId;
        console.log(`  - Setting trusted sender for ${otherChainName} (${otherChainId})...`);
        await hyperlaneModule.setTrustedSender(otherChainId, otherDeployment.contracts.HyperlaneModule.proxy);
      }
    }
  }

  // 4. Configure FeeManager
  if (deployment.contracts.FeeManager?.proxy) {
    console.log("\n4. Configuring FeeManager...");
    const feeManager = await ethers.getContractAt("FeeManager", deployment.contracts.FeeManager.proxy);

    // Update protocol modules
    if (deployment.contracts.LayerZeroModule?.proxy) {
      await feeManager.updateProtocolModule(0, deployment.contracts.LayerZeroModule.proxy);
    }
    if (deployment.contracts.CelerIMModule?.proxy) {
      await feeManager.updateProtocolModule(1, deployment.contracts.CelerIMModule.proxy);
    }
    if (deployment.contracts.XERC20Module?.proxy) {
      await feeManager.updateProtocolModule(2, deployment.contracts.XERC20Module.proxy);
    }
    if (deployment.contracts.HyperlaneModule?.proxy) {
      await feeManager.updateProtocolModule(3, deployment.contracts.HyperlaneModule.proxy);
    }
  }

  // 5. Configure ProtocolRegistry
  if (deployment.contracts.ProtocolRegistry?.proxy) {
    console.log("\n5. Configuring ProtocolRegistry...");
    const registry = await ethers.getContractAt("ProtocolRegistry", deployment.contracts.ProtocolRegistry.proxy);

    // Register protocols
    const supportedChains = [chainId, ...Object.values(otherChainDeployments).map(d => d.chainId)];

    if (deployment.contracts.LayerZeroModule?.proxy) {
      console.log("  - Registering LayerZero protocol...");
      await registry.registerProtocol(0, deployment.contracts.LayerZeroModule.proxy, "1.0.0", supportedChains);
    }

    if (deployment.contracts.CelerIMModule?.proxy) {
      console.log("  - Registering Celer protocol...");
      await registry.registerProtocol(1, deployment.contracts.CelerIMModule.proxy, "1.0.0", supportedChains);
    }

    if (deployment.contracts.XERC20Module?.proxy) {
      console.log("  - Registering XERC20 protocol...");
      await registry.registerProtocol(2, deployment.contracts.XERC20Module.proxy, "1.0.0", supportedChains);
    }

    if (deployment.contracts.HyperlaneModule?.proxy) {
      console.log("  - Registering Hyperlane protocol...");
      await registry.registerProtocol(3, deployment.contracts.HyperlaneModule.proxy, "1.0.0", supportedChains);
    }
  }

  console.log("\n✅ Multi-Protocol configuration completed!");
  console.log("\nConfiguration Summary:");
  console.log("====================");
  console.log(`Network: ${networkName} (${chainId})`);
  console.log(`CrossChainRouter: ${deployment.contracts.CrossChainRouter?.proxy || "Not deployed"}`);
  console.log("\nProtocol Modules Configured:");
  if (deployment.contracts.LayerZeroModule?.proxy) console.log(`  ✓ LayerZero`);
  if (deployment.contracts.CelerIMModule?.proxy) console.log(`  ✓ Celer`);
  if (deployment.contracts.XERC20Module?.proxy) console.log(`  ✓ XERC20`);
  if (deployment.contracts.HyperlaneModule?.proxy) console.log(`  ✓ Hyperlane`);
  console.log(`\nConnected to ${Object.keys(otherChainDeployments).length} other chains`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });