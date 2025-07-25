import { ethers } from "hardhat";
import * as fs from "fs";
import { getChainConfig, getNetworkTier, getNetworkName } from "../hardhat.config";
import { getLayerZeroChainId, getCelerChainId, loadOtherChainDeployments, loadDeployment, validateDeploymentFormat } from "./utils/deployment";
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
      console.log(`Configuring ${protocol}...`);
      
      let result: configurators.ConfigurationResult;
      switch (protocol.toLowerCase()) {
        case 'layerzero':
          result = await configurators.configureLayerZero(deployment, otherChainDeployments, chainConfig);
          break;
        case 'celer':
          result = await configurators.configureCeler(deployment, otherChainDeployments, chainConfig);
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
    
    const infraResults = await Promise.all([
      configurators.configureCrossChainRouter(deployment, otherChainDeployments, chainConfig),
      configurators.configureFeeManager(deployment, otherChainDeployments, chainConfig),
      configurators.configureProtocolRegistry(deployment, otherChainDeployments, chainConfig)
    ]);
    
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
    console.log("\n[WARNING]  Legacy deployment detected, configuring LayerZero...");
    const result = await configurators.configureLayerZero(deployment, otherChainDeployments, chainConfig);
    configurationResults.push(result);
  }
  
  if (!deployment.protocolsDeployed && deployment.contracts.CelerIMModule) {
    console.log("\n[WARNING]  Legacy deployment detected, configuring Celer...");
    const result = await configurators.configureCeler(deployment, otherChainDeployments, chainConfig);
    configurationResults.push(result);
  }
  

  // Configure Supply Oracle
  console.log("\n5. Configuring Supply Oracle...");

  // Register all chain supplies
  for (const [otherChainId, otherDeployment] of Object.entries(otherChainDeployments)) {
    const lzChainId = getLayerZeroChainId(parseInt(otherChainId));
    const remoteTier = getNetworkTier(parseInt(otherChainId));
    const tierWarning = remoteTier !== currentTier ? ` [WARNING]  (${remoteTier} tier)` : "";

    console.log(`Registering bridge for chain ${lzChainId}${tierWarning}`);

    await supplyOracle.registerBridge(lzChainId, otherDeployment.contracts.LookCoin.proxy);

    if (otherDeployment.contracts.CelerIMModule) {
      await supplyOracle.registerBridge(lzChainId, otherDeployment.contracts.CelerIMModule.proxy);
    }

  }

  // Set reconciliation parameters from centralized config
  console.log("Setting reconciliation parameters...");
  await supplyOracle.updateReconciliationParams(
    chainConfig.oracle.updateInterval,
    ethers.parseUnits(String(chainConfig.oracle.tolerance * 10), 8), // Convert basis points to LOOK tokens
  );

  // Note: Rate limiting is handled by SecurityManager in the infrastructure contracts
  // The SecurityManager is already configured with rate limits during deployment

  // Grant oracle roles
  console.log("\n7. Granting oracle roles...");
  const ORACLE_ROLE = await supplyOracle.ORACLE_ROLE();
  const OPERATOR_ROLE = await supplyOracle.OPERATOR_ROLE();

  // In production, grant to actual oracle operators
  await supplyOracle.grantRole(ORACLE_ROLE, deployer.address);
  await supplyOracle.grantRole(OPERATOR_ROLE, deployer.address);

  console.log("\n[OK] Configuration completed successfully!");

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
