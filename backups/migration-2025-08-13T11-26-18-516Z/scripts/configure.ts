import { ethers } from "hardhat";
import * as fs from "fs";
import { getChainConfig, getNetworkTier, getNetworkName } from "../hardhat.config";
import { getLayerZeroChainId, getCelerChainId, loadOtherChainDeployments, loadDeployment, validateDeploymentFormat } from "./utils/deployment-unified";
import { ProtocolDetector, isHyperlaneReady } from "./utils/protocolDetector";
import * as configurators from "./utils/protocolConfigurators";

// Dynamically import readline/promises
const readlinePromises = import("readline/promises");

async function main() {
  console.log("Starting LookCoin cross-chain configuration...");

  // Parse command-line arguments
  const forceCrossTier = process.argv.includes("--force-cross-tier");
  const allowCrossTier = forceCrossTier || process.env.CROSS_TIER_OK === "1";
  const isCI = process.env.CI === "true";

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  // Get network name and configuration
  const networkName = getNetworkName(chainId);
  const chainConfig = getChainConfig(networkName.toLowerCase().replace(/\s+/g, ""));

  // Get current network tier
  const currentTier = getNetworkTier(chainId);
  console.log(`Current network: ${networkName} (${currentTier} tier)`);

  if (currentTier === "unknown") {
    throw new Error(
      `Cannot determine network tier for chain ${chainId}. ` +
        `Please ensure the network is properly configured in hardhat.config.ts`,
    );
  }

  // Get governance vault from centralized config or CLI override
  // const governanceVault = process.argv[2] || chainConfig.governanceVault;

  console.log(`Configuring on chain ${chainId} with account: ${deployer.address}`);
  const deployment = loadDeployment(networkName);

  if (!deployment) {
    throw new Error(`Deployment not found for ${networkName}. Please run deploy.ts first.`);
  }
  console.log(`Loaded ${deployment.deploymentMode || 'legacy'} deployment from ${networkName}`);
  
  // Validate deployment format
  if (!validateDeploymentFormat(deployment)) {
    console.warn("[WARNING]  Deployment format validation warnings detected");
  }

  // Load other chain deployments with tier filtering
  const otherChainDeployments = loadOtherChainDeployments(chainId, { allowCrossTier });

  // Validate cross-tier configuration
  const crossTierDeployments: Array<{ chainId: number; network: string; tier: string }> = [];
  for (const [remoteChainId, remoteDeployment] of Object.entries(otherChainDeployments)) {
    const remoteTier = getNetworkTier(Number(remoteChainId));
    if (remoteTier !== currentTier && remoteTier !== "dev" && currentTier !== "dev") {
      crossTierDeployments.push({
        chainId: Number(remoteChainId),
        network: remoteDeployment.network,
        tier: remoteTier,
      });
    }
  }

  // Handle cross-tier safety check
  if (crossTierDeployments.length > 0 && !allowCrossTier) {
    const details = crossTierDeployments.map((d) => `  - ${d.network} (chain ${d.chainId}, ${d.tier} tier)`).join("\n");
    throw new Error(
      `Cross-tier configuration detected but not allowed!\n\n` +
        `Current network is ${currentTier} tier, but found deployments from:\n${details}\n\n` +
        `To allow cross-tier configuration, use --force-cross-tier flag or set CROSS_TIER_OK=1`,
    );
  }

  // Display warning and require confirmation for cross-tier configuration
  if (crossTierDeployments.length > 0 && allowCrossTier && !isCI) {
    console.warn("\n[WARNING]  WARNING: Cross-tier configuration detected! [WARNING]");
    console.warn(`\nYou are configuring a ${currentTier} network to trust contracts from:`);
    crossTierDeployments.forEach((d) => {
      console.warn(`  - ${d.network} (${d.tier} tier)`);
    });
    console.warn("\nThis could create security vulnerabilities if done incorrectly.");
    console.warn("Only proceed if you understand the risks.\n");

    const { createInterface } = await readlinePromises;
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await rl.question("Do you want to continue? (yes/no): ");
    rl.close();

    if (answer.toLowerCase() !== "yes") {
      console.log("Configuration cancelled by user.");
      process.exit(0);
    }
  }

  // Get contract instances
  const supplyOracle = await ethers.getContractAt("SupplyOracle", deployment.contracts.SupplyOracle.proxy);
  
  
  // Detect protocols to configure
  const protocolSupport = ProtocolDetector.detectSupportedProtocols(chainConfig);
  console.log(`\nDetected protocols: ${protocolSupport.protocols.join(", ")}`);

  // Configure protocols based on deployment
  console.log("\n[OK] Configuring protocols...");
  const configurationResults: configurators.ConfigurationResult[] = [];
  
  // Configure each deployed protocol
  if (deployment.protocolsDeployed) {
    for (const protocol of deployment.protocolsDeployed) {
      console.log(`\nChecking ${protocol} configuration...`);
      
      // Check if protocol is supported on this network
      const isProtocolSupported = () => {
        switch (protocol.toLowerCase()) {
          case 'layerzero':
            return chainConfig.protocols.layerZero;
          case 'celer':
            return chainConfig.protocols.celer;
          case 'hyperlane':
            return chainConfig.protocols.hyperlane;
          default:
            return false;
        }
      };
      
      if (!isProtocolSupported()) {
        console.log(`⚠️  WARNING: ${protocol} was deployed but is not supported on ${networkName}`);
        console.log(`   Skipping configuration for this protocol.`);
        const result = { 
          protocol, 
          configured: false, 
          details: `Not supported on ${networkName}` 
        };
        configurationResults.push(result);
        continue;
      }
      
      console.log(`Configuring ${protocol}...`);
      
      let result: configurators.ConfigurationResult;
      switch (protocol.toLowerCase()) {
        case 'layerzero':
          result = await configurators.configureLayerZero(deployment, otherChainDeployments, chainConfig);
          break;
        case 'celer':
          result = await configurators.configureCeler(deployment, otherChainDeployments);
          break;
        case 'hyperlane':
          if (isHyperlaneReady(chainConfig)) {
            result = await configurators.configureHyperlane(deployment, otherChainDeployments, chainConfig);
          } else {
            result = { protocol, configured: false, details: 'Hyperlane not ready - missing mailbox or gas paymaster' };
            console.log(`[INFO] Skipping Hyperlane configuration - not ready`);
          }
          break;
        default:
          result = { protocol, configured: false, details: 'Unknown protocol' };
      }
      
      configurationResults.push(result);
      if (result.error) {
        console.error(`[ERROR] ${result.protocol}: ${result.error}`);
      } else if (result.configured) {
        console.log(`[OK] ${result.protocol}: ${result.details}`);
      } else {
        console.log(`[INFO]  ${result.protocol}: ${result.details}`);
      }
    }
  }
  
  // Configure infrastructure for multi-protocol deployments
  if (deployment.deploymentMode === 'multi-protocol' && deployment.infrastructureContracts) {
    console.log("\n[CONFIG]  Configuring multi-protocol infrastructure...");
    
    // Run infrastructure configurations sequentially to avoid nonce conflicts
    const infraResults = [];
    
    // Configure CrossChainRouter first
    infraResults.push(await configurators.configureCrossChainRouter(deployment, otherChainDeployments));
    
    // Then configure FeeManager
    infraResults.push(await configurators.configureFeeManager(deployment));
    
    // Finally configure ProtocolRegistry
    infraResults.push(await configurators.configureProtocolRegistry(deployment, otherChainDeployments, chainConfig));
    
    configurationResults.push(...infraResults);
    
    infraResults.forEach(result => {
      if (result.error) {
        console.error(`[ERROR] ${result.protocol}: ${result.error}`);
      } else if (result.configured) {
        console.log(`[OK] ${result.protocol}: ${result.details}`);
      } else {
        console.log(`[INFO]  ${result.protocol}: ${result.details}`);
      }
    });
  }

  // Legacy support for deployments without protocolsDeployed field
  if (!deployment.protocolsDeployed && deployment.config?.layerZeroEndpoint) {
    console.log("\n[WARNING]  Legacy deployment detected, checking LayerZero...");
    if (chainConfig.protocols.layerZero) {
      const result = await configurators.configureLayerZero(deployment, otherChainDeployments, chainConfig);
      configurationResults.push(result);
    } else {
      console.log("⚠️  LayerZero endpoint found but protocol not supported on this network");
      configurationResults.push({ 
        protocol: 'layerZero', 
        configured: false, 
        details: 'Not supported on this network' 
      });
    }
  }
  
  if (!deployment.protocolsDeployed && deployment.contracts.CelerIMModule) {
    console.log("\n[WARNING]  Legacy deployment detected, checking Celer...");
    if (chainConfig.protocols.celer) {
      const result = await configurators.configureCeler(deployment, otherChainDeployments);
      configurationResults.push(result);
    } else {
      console.log("⚠️  Celer module found but protocol not supported on this network");
      configurationResults.push({ 
        protocol: 'celer', 
        configured: false, 
        details: 'Not supported on this network' 
      });
    }
  }
  

  // Configure Supply Oracle
  console.log("\n5. Configuring Supply Oracle (Cross-Chain Bridges)...");
  console.log("   Note: Local bridges were already registered in setup.ts");

  // Helper function to register bridge with idempotency check
  async function registerBridgeIfNeeded(chainId: number, bridgeAddress: string, bridgeName: string) {
    try {
      // Check if bridge is already registered
      const isRegistered = await supplyOracle.isBridgeRegistered(chainId, bridgeAddress);
      
      if (isRegistered) {
        console.log(`  ✓ ${bridgeName} already registered for chain ${chainId}`);
        return;
      }
      
      // Register the bridge
      console.log(`  - Registering ${bridgeName} (chain ${chainId})...`);
      const tx = await supplyOracle.registerBridge(chainId, bridgeAddress);
      await tx.wait();
      console.log(`  ✅ ${bridgeName} registered successfully`);
    } catch (error) {
      console.error(`  ❌ Failed to register ${bridgeName}:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  // Register bridges from OTHER chains (cross-chain configuration)
  for (const [otherChainId, otherDeployment] of Object.entries(otherChainDeployments)) {
    const remoteTier = getNetworkTier(parseInt(otherChainId));
    const tierWarning = remoteTier !== currentTier ? ` [WARNING]  (${remoteTier} tier)` : "";
    const otherNetworkName = getNetworkName(parseInt(otherChainId));
    const otherChainConfig = getChainConfig(otherNetworkName.toLowerCase().replace(/\s+/g, ""));

    console.log(`\nRegistering bridges for ${otherNetworkName}${tierWarning}`);

    // Register LayerZero bridge if both chains support it
    if (chainConfig.protocols.layerZero && otherChainConfig.protocols.layerZero && 
        (otherDeployment.protocolsDeployed?.includes('layerZero') || otherDeployment.config?.layerZeroEndpoint)) {
      const lzChainId = getLayerZeroChainId(parseInt(otherChainId));
      await registerBridgeIfNeeded(lzChainId, otherDeployment.contracts.LookCoin.proxy, "LayerZero bridge");
    }

    // Register Celer bridge if both chains support it
    if (chainConfig.protocols.celer && otherChainConfig.protocols.celer && otherDeployment.contracts.CelerIMModule) {
      const celerChainId = getCelerChainId(parseInt(otherChainId));
      await registerBridgeIfNeeded(celerChainId, otherDeployment.contracts.CelerIMModule.proxy, "Celer bridge");
    }

    // Register Hyperlane bridge if both chains support it
    if (chainConfig.protocols.hyperlane && otherChainConfig.protocols.hyperlane && 
        otherDeployment.protocolsDeployed?.includes('hyperlane')) {
      const hyperlaneDomainId = otherChainConfig.hyperlane?.hyperlaneDomainId || parseInt(otherChainId);
      // For Hyperlane, we register the HyperlaneModule if it exists
      const hyperlaneModule = otherDeployment.protocolContracts?.hyperlaneModule || otherDeployment.contracts.LookCoin.proxy;
      await registerBridgeIfNeeded(hyperlaneDomainId, hyperlaneModule, "Hyperlane bridge");
    }
  }

  console.log("\n[OK] Cross-chain configuration completed successfully!");
  
  // Show configuration warnings if any protocols were skipped
  const skippedProtocols = configurationResults.filter(r => !r.configured && r.details?.includes('Not supported'));
  if (skippedProtocols.length > 0) {
    console.log("\n⚠️  Configuration Warnings:");
    skippedProtocols.forEach(result => {
      console.log(`   - ${result.protocol}: ${result.details}`);
    });
    console.log("\n   These protocols were deployed but are not supported on this network.");
    console.log("   Consider redeploying with the correct protocol configuration.");
  }

  // Generate configuration summary
  const configSummary = {
    chainId,
    network: networkName,
    networkTier: currentTier,
    deploymentMode: deployment.deploymentMode || 'legacy',
    timestamp: new Date().toISOString(),
    tierValidation: {
      crossTierAllowed: allowCrossTier,
      crossTierDetected: crossTierDeployments.length > 0,
      overrideMethod: forceCrossTier
        ? "--force-cross-tier"
        : process.env.CROSS_TIER_OK === "1"
          ? "CROSS_TIER_OK=1"
          : "none",
    },
    protocolsConfigured: configurationResults.map(r => ({
      protocol: r.protocol,
      configured: r.configured,
      details: r.details,
      error: r.error
    })),
    layerZeroRemotes: deployment.protocolsDeployed?.includes('layerZero') || deployment.config?.layerZeroEndpoint
      ? Object.entries(otherChainDeployments)
          .filter(([, dep]) => dep.protocolsDeployed?.includes('layerZero') || dep.config?.layerZeroEndpoint)
          .map(([chainId, dep]) => ({
            chainId: getLayerZeroChainId(parseInt(chainId)),
            networkTier: getNetworkTier(parseInt(chainId)),
            lookCoin: dep.contracts.LookCoin.proxy,
          }))
      : [],
    celerRemotes: deployment.protocolsDeployed?.includes('celer') || deployment.contracts.CelerIMModule
      ? Object.entries(otherChainDeployments)
          .filter(([, dep]) => dep.protocolsDeployed?.includes('celer') || dep.contracts.CelerIMModule)
          .map(([chainId, dep]) => ({
            chainId: getCelerChainId(parseInt(chainId)),
            networkTier: getNetworkTier(parseInt(chainId)),
            module: dep.contracts.CelerIMModule?.proxy || dep.protocolContracts?.celerIMModule || '',
          }))
      : [],
    hyperlaneRemotes: deployment.protocolsDeployed?.includes('hyperlane') && isHyperlaneReady(chainConfig)
      ? Object.entries(otherChainDeployments)
          .filter(([, dep]) => dep.protocolsDeployed?.includes('hyperlane'))
          .map(([chainId, dep]) => {
            const otherChainConfig = getChainConfig(getNetworkName(parseInt(chainId)).toLowerCase().replace(/\s+/g, ""));
            return {
              domainId: otherChainConfig.hyperlane?.hyperlaneDomainId || parseInt(chainId),
              networkTier: getNetworkTier(parseInt(chainId)),
              module: dep.contracts.LookCoin.proxy, // Hyperlane uses LookCoin as the module
            };
          })
      : [],
    supplyOracleConfig: {
      reconciliationInterval: `${chainConfig.oracle.updateInterval} seconds`,
      toleranceThreshold: `${chainConfig.oracle.tolerance} basis points`,
    },
    hyperlaneStatus: isHyperlaneReady(chainConfig) ? 'ready' : 'not ready',
  };

  console.log("\nConfiguration Summary:");
  console.log(JSON.stringify(configSummary, null, 2));

  // Save configuration
  const configPath = `./deployments/config-${networkName.toLowerCase().replace(/\s+/g, "-")}.json`;
  fs.writeFileSync(configPath, JSON.stringify(configSummary, null, 2));
  console.log(`\nConfiguration saved to: ${configPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
