import { ethers } from "hardhat";
import * as fs from "fs";
import { getChainConfig, getNetworkTier, getNetworkName } from "../hardhat.config";
import { getLayerZeroChainId, getCelerChainId, loadOtherChainDeployments, loadDeployment } from "./utils/deployment";

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
  console.log(`Loaded deployment from ${networkName}`);

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
    console.warn("\n⚠️  WARNING: Cross-tier configuration detected! ⚠️");
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
  const lookCoin = await ethers.getContractAt("LookCoin", deployment.contracts.LookCoin.proxy);
  const supplyOracle = await ethers.getContractAt("SupplyOracle", deployment.contracts.SupplyOracle.proxy);

  // Configure LayerZero trusted remotes
  console.log("\n1. Configuring LayerZero trusted remotes...");
  for (const [otherChainId, otherDeployment] of Object.entries(otherChainDeployments)) {
    const remoteChainId = getLayerZeroChainId(parseInt(otherChainId));
    const remoteLookCoin = otherDeployment.contracts.LookCoin.proxy;
    const remoteTier = getNetworkTier(parseInt(otherChainId));

    const trustedRemote = ethers.solidityPacked(
      ["address", "address"],
      [remoteLookCoin, deployment.contracts.LookCoin.proxy],
    );

    const tierWarning = remoteTier !== currentTier ? ` ⚠️  (${remoteTier} tier)` : "";
    console.log(`Setting trusted remote for chain ${remoteChainId}: ${remoteLookCoin}${tierWarning}`);
    await lookCoin.setTrustedRemote(remoteChainId, trustedRemote);
  }

  // Configure DVN settings
  console.log("\n2. Configuring DVN settings...");
  const dvnConfig = {
    requiredDVNs: chainConfig.layerZero.requiredDVNs,
    optionalDVNs: chainConfig.layerZero.optionalDVNs,
    optionalDVNThreshold: chainConfig.layerZero.optionalDVNThreshold,
    confirmations: chainConfig.layerZero.confirmations,
  };

  // Note: Actual DVN configuration would require LayerZero V2 specific methods
  console.log("DVN configuration (to be implemented with LayerZero V2 SDK):");
  console.log(JSON.stringify(dvnConfig, null, 2));

  // Configure Celer IM modules
  if (deployment.contracts.CelerIMModule) {
    console.log("\n3. Configuring Celer IM module...");
    const celerModule = await ethers.getContractAt("CelerIMModule", deployment.contracts.CelerIMModule.proxy);

    for (const [otherChainId, otherDeployment] of Object.entries(otherChainDeployments)) {
      if (otherDeployment.contracts.CelerIMModule) {
        const remoteCelerChainId = getCelerChainId(parseInt(otherChainId));
        const remoteCelerModule = otherDeployment.contracts.CelerIMModule.proxy;
        const remoteTier = getNetworkTier(parseInt(otherChainId));

        const tierWarning = remoteTier !== currentTier ? ` ⚠️  (${remoteTier} tier)` : "";
        console.log(`Setting remote Celer module for chain ${remoteCelerChainId}: ${remoteCelerModule}${tierWarning}`);
        await celerModule.setRemoteModule(remoteCelerChainId, remoteCelerModule);
      }
    }

    // Configure fee parameters from centralized config
    console.log("Setting Celer fee parameters...");
    await celerModule.updateFeeParameters(
      chainConfig.celer.fees.feePercentage,
      chainConfig.celer.fees.minFee,
      chainConfig.celer.fees.maxFee,
    );

    // Configure rate limits from centralized config
    console.log("Setting Celer rate limits...");
    await celerModule.updateRateLimits(
      chainConfig.rateLimiter.perAccountLimit,
      chainConfig.rateLimiter.globalDailyLimit,
    );
  }

  // Configure IBC module (BSC only)
  // if (deployment.contracts.IBCModule && (chainId === 56 || chainId === 97)) {
  //   console.log("\n4. Configuring IBC module...");
  //   const ibcModule = await ethers.getContractAt("IBCModule", deployment.contracts.IBCModule.proxy);

  //   // Add validators from centralized config
  //   const validators = chainConfig.ibc.validators;

  //   console.log("Setting IBC validators...");
  //   await ibcModule.updateValidatorSet(validators, chainConfig.ibc.threshold);

  //   // Update IBC configuration from centralized config
  //   const ibcConfig = {
  //     channelId: chainConfig.ibc.channelId,
  //     portId: chainConfig.ibc.portId,
  //     timeoutHeight: 0,
  //     timeoutTimestamp: chainConfig.ibc.packetTimeout,
  //     minValidators: chainConfig.ibc.minValidators,
  //     unbondingPeriod: chainConfig.ibc.unbondingPeriod
  //   };

  //   console.log("Updating IBC configuration...");
  //   await ibcModule.updateIBCConfig(ibcConfig);

  //   // Set daily limit from centralized config
  //   console.log("Setting IBC daily limit...");
  //   await ibcModule.updateDailyLimit(chainConfig.rateLimiter.globalDailyLimit);
  // }

  // Configure Supply Oracle
  console.log("\n5. Configuring Supply Oracle...");

  // Register all chain supplies
  for (const [otherChainId, otherDeployment] of Object.entries(otherChainDeployments)) {
    const lzChainId = getLayerZeroChainId(parseInt(otherChainId));
    const remoteTier = getNetworkTier(parseInt(otherChainId));
    const tierWarning = remoteTier !== currentTier ? ` ⚠️  (${remoteTier} tier)` : "";

    console.log(`Registering bridge for chain ${lzChainId}${tierWarning}`);

    await supplyOracle.registerBridge(lzChainId, otherDeployment.contracts.LookCoin.proxy);

    if (otherDeployment.contracts.CelerIMModule) {
      await supplyOracle.registerBridge(lzChainId, otherDeployment.contracts.CelerIMModule.proxy);
    }

    if (otherDeployment.contracts.IBCModule) {
      await supplyOracle.registerBridge(lzChainId, otherDeployment.contracts.IBCModule.proxy);
    }
  }

  // Set reconciliation parameters from centralized config
  console.log("Setting reconciliation parameters...");
  await supplyOracle.updateReconciliationParams(
    chainConfig.oracle.updateInterval,
    ethers.parseUnits(String(chainConfig.oracle.tolerance * 10), 8), // Convert basis points to LOOK tokens
  );

  // Configure rate limits on main contract from centralized config
  console.log("\n6. Configuring main contract rate limits...");
  await lookCoin.updateRateLimits(
    chainConfig.rateLimiter.perAccountLimit,
    chainConfig.rateLimiter.maxTransactionsPerAccount,
  );

  // Grant oracle roles
  console.log("\n7. Granting oracle roles...");
  const ORACLE_ROLE = await supplyOracle.ORACLE_ROLE();
  const OPERATOR_ROLE = await supplyOracle.OPERATOR_ROLE();

  // In production, grant to actual oracle operators
  await supplyOracle.grantRole(ORACLE_ROLE, deployer.address);
  await supplyOracle.grantRole(OPERATOR_ROLE, deployer.address);

  console.log("\n✅ Configuration completed successfully!");

  // Generate configuration summary
  const configSummary = {
    chainId,
    networkTier: currentTier,
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
    layerZeroRemotes: Object.entries(otherChainDeployments).map(([chainId, dep]) => ({
      chainId: getLayerZeroChainId(parseInt(chainId)),
      networkTier: getNetworkTier(parseInt(chainId)),
      lookCoin: dep.contracts.LookCoin.proxy,
    })),
    celerRemotes: deployment.contracts.CelerIMModule
      ? Object.entries(otherChainDeployments)
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          .filter(([_, dep]) => dep.contracts.CelerIMModule)
          .map(([chainId, dep]) => ({
            chainId: getCelerChainId(parseInt(chainId)),
            networkTier: getNetworkTier(parseInt(chainId)),
            module: dep.contracts.CelerIMModule!.proxy,
          }))
      : [],
    supplyOracleConfig: {
      reconciliationInterval: `${chainConfig.oracle.updateInterval} seconds`,
      toleranceThreshold: `${chainConfig.oracle.tolerance} basis points`,
    },
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
