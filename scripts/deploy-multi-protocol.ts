import hre from "hardhat";
import { ethers, upgrades } from "hardhat";
import { getChainConfig, getNetworkName } from "../hardhat.config";
import { loadDeployment, saveDeployment, getBytecodeHash, Deployment } from "./utils/deployment";
import { fetchDeployOrUpgradeProxy } from "./utils/state";

async function main() {
  console.log("Starting Multi-Protocol LookCoin deployment...");

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`Deploying on chain ${chainId} with account: ${deployer.address}`);
  console.log(`Account balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  // Get network configuration
  const networkName = getNetworkName(chainId);
  const chainConfig = getChainConfig(networkName.toLowerCase().replace(/\s+/g, ""));

  const governanceVault = process.argv[2] || chainConfig.governanceVault;
  if (!governanceVault || governanceVault === "0x0000000000000000000000000000000000000000") {
    throw new Error("GOVERNANCE_VAULT address is required");
  }

  console.log(`Governance Vault: ${governanceVault}`);
  console.log(`\nDeploying on ${networkName}`);

  // Load existing deployment
  const deployment: Deployment = loadDeployment(networkName) || {
    network: networkName,
    chainId: chainId,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {},
    implementationHashes: {},
  };

  // 1. Deploy LookCoin (if not exists)
  console.log("\n⌛️ 1. Deploying LookCoin...");
  let lookCoinAddress: string;
  
  if (deployment.contracts.LookCoin?.proxy) {
    console.log("  ✅ LookCoin already deployed at:", deployment.contracts.LookCoin.proxy);
    lookCoinAddress = deployment.contracts.LookCoin.proxy;
  } else {
    const lookCoin = await fetchDeployOrUpgradeProxy(
      "LookCoin",
      [governanceVault, chainConfig.layerZero.endpoint],
      existingDeployment?.contracts.LookCoin?.proxy || null,
      {
        initializer: "initialize",
        kind: "uups",
      }
    );
    
    lookCoinAddress = await lookCoin.getAddress();
    deployment.contracts.LookCoin = {
      proxy: lookCoinAddress,
      implementation: await upgrades.erc1967.getImplementationAddress(lookCoinAddress),
    };
    
    console.log("✅ LookCoin deployed at:", lookCoinAddress);
  }

  // 2. Deploy FeeManager
  console.log("\n⌛️ 2. Deploying FeeManager...");
  let feeManagerAddress: string;
  
  if (deployment.contracts.FeeManager?.proxy) {
    console.log("  ✅ FeeManager already deployed at:", deployment.contracts.FeeManager.proxy);
    feeManagerAddress = deployment.contracts.FeeManager.proxy;
  } else {
    const feeManager = await fetchDeployOrUpgradeProxy(
      "FeeManager",
      [governanceVault],
      null,
      {
        initializer: "initialize",
        kind: "uups",
      }
    );
    
    feeManagerAddress = await feeManager.getAddress();
    deployment.contracts.FeeManager = {
      proxy: feeManagerAddress,
      implementation: await upgrades.erc1967.getImplementationAddress(feeManagerAddress),
    };
    
    console.log("✅ FeeManager deployed at:", feeManagerAddress);
  }

  // 3. Deploy SecurityManager
  console.log("\n⌛️ 3. Deploying SecurityManager...");
  let securityManagerAddress: string;
  
  if (deployment.contracts.SecurityManager?.proxy) {
    console.log("  ✅ SecurityManager already deployed at:", deployment.contracts.SecurityManager.proxy);
    securityManagerAddress = deployment.contracts.SecurityManager.proxy;
  } else {
    const globalDailyLimit = chainConfig.totalSupply; // Use total supply as global limit
    const securityManager = await fetchDeployOrUpgradeProxy(
      "SecurityManager",
      [governanceVault, globalDailyLimit],
      null,
      {
        initializer: "initialize",
        kind: "uups",
      }
    );
    
    securityManagerAddress = await securityManager.getAddress();
    deployment.contracts.SecurityManager = {
      proxy: securityManagerAddress,
      implementation: await upgrades.erc1967.getImplementationAddress(securityManagerAddress),
    };
    
    console.log("✅ SecurityManager deployed at:", securityManagerAddress);
  }

  // 4. Deploy ProtocolRegistry
  console.log("\n⌛️ 4. Deploying ProtocolRegistry...");
  let protocolRegistryAddress: string;
  
  if (deployment.contracts.ProtocolRegistry?.proxy) {
    console.log("  ✅ ProtocolRegistry already deployed at:", deployment.contracts.ProtocolRegistry.proxy);
    protocolRegistryAddress = deployment.contracts.ProtocolRegistry.proxy;
  } else {
    const protocolRegistry = await fetchDeployOrUpgradeProxy(
      "ProtocolRegistry",
      [governanceVault],
      null,
      {
        initializer: "initialize",
        kind: "uups",
      }
    );
    
    protocolRegistryAddress = await protocolRegistry.getAddress();
    deployment.contracts.ProtocolRegistry = {
      proxy: protocolRegistryAddress,
      implementation: await upgrades.erc1967.getImplementationAddress(protocolRegistryAddress),
    };
    
    console.log("✅ ProtocolRegistry deployed at:", protocolRegistryAddress);
  }

  // 5. Deploy Protocol Modules based on chain support
  const protocolModules: { [key: string]: string } = {};

  // Deploy LayerZero Module if supported
  if (chainConfig.protocols?.layerZero && chainConfig.layerZero.endpoint !== "0x0000000000000000000000000000000000000000") {
    console.log("\n⌛️ 5a. Deploying LayerZeroModule...");
    
    if (deployment.contracts.LayerZeroModule?.proxy) {
      console.log("  ✅ LayerZeroModule already deployed at:", deployment.contracts.LayerZeroModule.proxy);
      protocolModules.layerZero = deployment.contracts.LayerZeroModule.proxy;
    } else {
      const layerZeroModule = await fetchDeployOrUpgradeProxy(
        "LayerZeroModule",
        [lookCoinAddress, chainConfig.layerZero.endpoint, governanceVault],
        null,
        {
          initializer: "initialize",
          kind: "uups",
        }
      );
      
      const layerZeroAddress = await layerZeroModule.getAddress();
      deployment.contracts.LayerZeroModule = {
        proxy: layerZeroAddress,
        implementation: await upgrades.erc1967.getImplementationAddress(layerZeroAddress),
      };
      protocolModules.layerZero = layerZeroAddress;
      
      console.log("✅ LayerZeroModule deployed at:", layerZeroAddress);
    }
  }

  // Deploy Celer Module if supported
  if (chainConfig.protocols?.celer && chainConfig.celer.messageBus !== "0x0000000000000000000000000000000000000000") {
    console.log("\n⌛️ 5b. Deploying CelerIMModule...");
    
    if (deployment.contracts.CelerIMModule?.proxy) {
      console.log("  ✅ CelerIMModule already deployed at:", deployment.contracts.CelerIMModule.proxy);
      protocolModules.celer = deployment.contracts.CelerIMModule.proxy;
    } else {
      const celerModule = await fetchDeployOrUpgradeProxy(
        "CelerIMModule",
        [lookCoinAddress, chainConfig.celer.messageBus, governanceVault],
        existingDeployment?.contracts.CelerIMModule?.proxy || null,
        {
          initializer: "initialize",
          kind: "uups",
        }
      );
      
      const celerAddress = await celerModule.getAddress();
      deployment.contracts.CelerIMModule = {
        proxy: celerAddress,
        implementation: await upgrades.erc1967.getImplementationAddress(celerAddress),
      };
      protocolModules.celer = celerAddress;
      
      console.log("✅ CelerIMModule deployed at:", celerAddress);
    }
  }

  // Deploy XERC20 Module if supported
  if (chainConfig.protocols?.xerc20) {
    console.log("\n⌛️ 5c. Deploying XERC20Module...");
    
    if (deployment.contracts.XERC20Module?.proxy) {
      console.log("  ✅ XERC20Module already deployed at:", deployment.contracts.XERC20Module.proxy);
      protocolModules.xerc20 = deployment.contracts.XERC20Module.proxy;
    } else {
      const xerc20Module = await fetchDeployOrUpgradeProxy(
        "XERC20Module",
        [lookCoinAddress, governanceVault],
        null,
        {
          initializer: "initialize",
          kind: "uups",
        }
      );
      
      const xerc20Address = await xerc20Module.getAddress();
      deployment.contracts.XERC20Module = {
        proxy: xerc20Address,
        implementation: await upgrades.erc1967.getImplementationAddress(xerc20Address),
      };
      protocolModules.xerc20 = xerc20Address;
      
      console.log("✅ XERC20Module deployed at:", xerc20Address);
    }
  }

  // Deploy Hyperlane Module if supported
  if (chainConfig.protocols?.hyperlane && chainConfig.hyperlane?.mailbox !== "0x0000000000000000000000000000000000000000") {
    console.log("\n⌛️ 5d. Deploying HyperlaneModule...");
    
    if (deployment.contracts.HyperlaneModule?.proxy) {
      console.log("  ✅ HyperlaneModule already deployed at:", deployment.contracts.HyperlaneModule.proxy);
      protocolModules.hyperlane = deployment.contracts.HyperlaneModule.proxy;
    } else {
      const hyperlaneModule = await fetchDeployOrUpgradeProxy(
        "HyperlaneModule",
        [lookCoinAddress, chainConfig.hyperlane.mailbox, chainConfig.hyperlane.gasPaymaster, governanceVault],
        null,
        {
          initializer: "initialize",
          kind: "uups",
        }
      );
      
      const hyperlaneAddress = await hyperlaneModule.getAddress();
      deployment.contracts.HyperlaneModule = {
        proxy: hyperlaneAddress,
        implementation: await upgrades.erc1967.getImplementationAddress(hyperlaneAddress),
      };
      protocolModules.hyperlane = hyperlaneAddress;
      
      console.log("✅ HyperlaneModule deployed at:", hyperlaneAddress);
    }
  }

  // 6. Deploy CrossChainRouter
  console.log("\n⌛️ 6. Deploying CrossChainRouter...");
  let crossChainRouterAddress: string;
  
  if (deployment.contracts.CrossChainRouter?.proxy) {
    console.log("  ✅ CrossChainRouter already deployed at:", deployment.contracts.CrossChainRouter.proxy);
    crossChainRouterAddress = deployment.contracts.CrossChainRouter.proxy;
  } else {
    const crossChainRouter = await fetchDeployOrUpgradeProxy(
      "CrossChainRouter",
      [lookCoinAddress, feeManagerAddress, securityManagerAddress, governanceVault],
      null,
      {
        initializer: "initialize",
        kind: "uups",
      }
    );
    
    crossChainRouterAddress = await crossChainRouter.getAddress();
    deployment.contracts.CrossChainRouter = {
      proxy: crossChainRouterAddress,
      implementation: await upgrades.erc1967.getImplementationAddress(crossChainRouterAddress),
    };
    
    console.log("✅ CrossChainRouter deployed at:", crossChainRouterAddress);
  }

  // Update deployment metadata
  deployment.timestamp = new Date().toISOString();
  deployment.lastDeployed = new Date().toISOString();

  // Save deployment
  await saveDeployment(networkName, deployment);

  console.log("\n✅ Multi-Protocol Deployment Summary:");
  console.log("=====================================");
  console.log(`LookCoin: ${lookCoinAddress}`);
  console.log(`CrossChainRouter: ${crossChainRouterAddress}`);
  console.log(`FeeManager: ${feeManagerAddress}`);
  console.log(`SecurityManager: ${securityManagerAddress}`);
  console.log(`ProtocolRegistry: ${protocolRegistryAddress}`);
  
  console.log("\nProtocol Modules:");
  if (protocolModules.layerZero) console.log(`  LayerZero: ${protocolModules.layerZero}`);
  if (protocolModules.celer) console.log(`  Celer: ${protocolModules.celer}`);
  if (protocolModules.xerc20) console.log(`  XERC20: ${protocolModules.xerc20}`);
  if (protocolModules.hyperlane) console.log(`  Hyperlane: ${protocolModules.hyperlane}`);

  console.log("\n⚠️  Next steps:");
  console.log(`1. Run setup script: npm run setup:${networkName.toLowerCase().replace(/\s+/g, "-")}`);
  console.log(`2. Run configure script: npm run configure:multi-protocol`);
  console.log("3. Verify contracts on block explorer");
  console.log("4. Test bridge operations");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });