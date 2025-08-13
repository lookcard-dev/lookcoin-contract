/**
 * LookCoin Setup Script - Stage 2 of the Three-Stage Deployment Process
 * 
 * This script performs local configuration after contract deployment.
 * It is part of the Deploy → Setup → Configure workflow.
 * 
 * Stage 2 (Setup) includes:
 * - Granting operational roles to the MPC vault and dev team
 * - Configuring bridge modules with proper permissions
 * - Registering bridges with the SupplyOracle
 * - Setting up the CrossChainRouter (if deployed)
 * - Enabling direct LayerZero OFT functionality
 * 
 * Prerequisites:
 * - Stage 1 (Deploy) must be completed with deployment artifacts in /deployments
 * - Environment variables configured (GOVERNANCE_VAULT, DEV_TEAM_ADDRESS)
 * - Network connection to the target chain
 * 
 * @see README.md for deployment process overview
 * @see docs/TECHNICAL.md for role assignments and access control
 */

import { ethers } from "hardhat";
import { getChainConfig, getNetworkName, TOTAL_SUPPLY } from "../hardhat.config";
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

  // ============================================================================
  // SECTION 0: SUPPLY ORACLE CONFIGURATION CHECK AND UPDATE
  // ============================================================================
  console.log("\n0. Checking and updating SupplyOracle configuration...");
  
  // Get global total supply from hardhat config
  const GLOBAL_TOTAL_SUPPLY = BigInt(TOTAL_SUPPLY); // Already in wei from config
  
  // Check SupplyOracle's expected total supply
  const oracleExpectedSupply = await supplyOracle.totalExpectedSupply();
  console.log(`- Current SupplyOracle Expected Supply: ${ethers.formatEther(oracleExpectedSupply)} LOOK`);
  console.log(`- Required Global Supply Cap: ${ethers.formatEther(GLOBAL_TOTAL_SUPPLY)} LOOK`);
  
  // Update SupplyOracle if needed
  if (oracleExpectedSupply !== GLOBAL_TOTAL_SUPPLY) {
    console.log("\n⚠️  SupplyOracle's expected supply doesn't match the global supply cap!");
    console.log(`   Current: ${ethers.formatEther(oracleExpectedSupply)} LOOK`);
    console.log(`   Required: ${ethers.formatEther(GLOBAL_TOTAL_SUPPLY)} LOOK`);
    
    // Check if we have the necessary role to update
    const DEFAULT_ADMIN_ROLE = await supplyOracle.DEFAULT_ADMIN_ROLE();
    const hasAdminRole = await supplyOracle.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    
    if (hasAdminRole || chainConfig.governanceVault === deployer.address) {
      console.log("\n🔧 Updating SupplyOracle's expected supply to 5 billion LOOK...");
      
      try {
        // The SupplyOracle doesn't have a direct setter for totalExpectedSupply
        // We need to check if there's an admin function or if we need to upgrade
        // First, let's check if there's an updateExpectedSupply function
        const updateTx = await supplyOracle.updateExpectedSupply(GLOBAL_TOTAL_SUPPLY);
        await updateTx.wait();
        
        // Verify the update
        const newExpectedSupply = await supplyOracle.totalExpectedSupply();
        if (newExpectedSupply === GLOBAL_TOTAL_SUPPLY) {
          console.log("✅ SupplyOracle expected supply updated successfully to 5 billion LOOK!");
        } else {
          console.log("❌ Failed to update SupplyOracle expected supply. Please check manually.");
        }
      } catch (error) {
        // If the function doesn't exist, we need to inform the user
        console.log("\n❌ Unable to update SupplyOracle expected supply automatically.");
        console.log("   The SupplyOracle contract may need to be upgraded to support supply updates.");
        console.log("   Please contact the admin to update the expected supply to 5 billion LOOK.");
        console.log("\n   Error details:", error instanceof Error ? error.message : String(error));
      }
    } else {
      console.log("\n⚠️  Cannot update SupplyOracle - deployer doesn't have DEFAULT_ADMIN_ROLE.");
      console.log("   Please ask an admin to update the expected supply to 5 billion LOOK.");
      console.log("   Admin command: supplyOracle.updateExpectedSupply(\"5000000000000000000000000000\")");
    }
  } else {
    console.log("✅ SupplyOracle is already correctly configured with 5 billion LOOK expected supply.");
  }
  
  // Show current chain supply info for reference
  const isHomeChain = networkName.toLowerCase().includes('bsc');
  const onChainSupply = await lookCoin.totalSupply();
  const totalMinted = await lookCoin.totalMinted();
  const totalBurned = await lookCoin.totalBurned();
  
  console.log(`\n📊 Current Chain Supply Info (${networkName}):`);
  console.log(`- Chain Type: ${isHomeChain ? 'Home Chain (BSC)' : 'Secondary Chain'}`);
  console.log(`- Current Supply: ${ethers.formatEther(onChainSupply)} LOOK`);
  console.log(`- Total Minted: ${ethers.formatEther(totalMinted)} LOOK`);
  console.log(`- Total Burned: ${ethers.formatEther(totalBurned)} LOOK`);
  
  if (isHomeChain && totalMinted == 0) {
    console.log("\n💡 Note: The home chain (BSC) should mint the full 5 billion LOOK supply initially.");
    console.log(`   To mint: lookCoin.mint("${chainConfig.governanceVault}", "${GLOBAL_TOTAL_SUPPLY.toString()}")`);
  }

  // ============================================================================
  // SECTION 1: ROLE CONFIGURATION
  // ============================================================================
  console.log("\n1. Configuring roles...");

  // Get all role constants from the LookCoin contract
  // These roles follow OpenZeppelin's AccessControl pattern
  const minterRole = await lookCoin.MINTER_ROLE();
  const burnerRole = await lookCoin.BURNER_ROLE();
  const bridgeRole = await lookCoin.BRIDGE_ROLE();
  const protocolAdminRole = await lookCoin.PROTOCOL_ADMIN_ROLE();
  const routerAdminRole = await lookCoin.ROUTER_ADMIN_ROLE();
  const upgraderRole = await lookCoin.UPGRADER_ROLE();

  // ============================================================================
  // 1.1 MPC VAULT ROLE ASSIGNMENTS
  // The MPC vault is the primary governance authority with financial control
  // ============================================================================
  console.log("\n1.1. Granting roles to MPC Vault...");
  const governanceVault = chainConfig.governanceVault;
  
  // Grant MINTER_ROLE to MPC Vault
  // This allows the MPC vault to mint new tokens for business operations
  const vaultHasMinterRole = await lookCoin.hasRole(minterRole, governanceVault);
  if (!vaultHasMinterRole) {
    console.log(`Granting MINTER_ROLE to MPC Vault at ${governanceVault}...`);
    const tx = await lookCoin.grantRole(minterRole, governanceVault);
    await tx.wait();
    console.log(`✅ MINTER_ROLE granted to MPC Vault`);
  } else {
    console.log(`✓ MPC Vault already has MINTER_ROLE`);
  }

  // Grant BURNER_ROLE to MPC Vault
  // This allows the MPC vault to burn tokens for supply management
  const vaultHasBurnerRole = await lookCoin.hasRole(burnerRole, governanceVault);
  if (!vaultHasBurnerRole) {
    console.log(`Granting BURNER_ROLE to MPC Vault at ${governanceVault}...`);
    const tx = await lookCoin.grantRole(burnerRole, governanceVault);
    await tx.wait();
    console.log(`✅ BURNER_ROLE granted to MPC Vault`);
  } else {
    console.log(`✓ MPC Vault already has BURNER_ROLE`);
  }

  // ============================================================================
  // 1.2 DEV TEAM ROLE ASSIGNMENTS (Optional)
  // The dev team receives technical roles without financial control
  // Configure by setting DEV_TEAM_ADDRESS environment variable
  // ============================================================================
  if (chainConfig.devTeamAddress) {
    console.log("\n1.2. Granting roles to Dev Team...");
    const devTeamAddress = chainConfig.devTeamAddress;

    // Grant PROTOCOL_ADMIN_ROLE to Dev Team
    // Allows configuration of protocol settings (trusted remotes, fees, etc.)
    const devHasProtocolAdminRole = await lookCoin.hasRole(protocolAdminRole, devTeamAddress);
    if (!devHasProtocolAdminRole) {
      console.log(`Granting PROTOCOL_ADMIN_ROLE to Dev Team at ${devTeamAddress}...`);
      const tx = await lookCoin.grantRole(protocolAdminRole, devTeamAddress);
      await tx.wait();
      console.log(`✅ PROTOCOL_ADMIN_ROLE granted to Dev Team`);
    } else {
      console.log(`✓ Dev Team already has PROTOCOL_ADMIN_ROLE`);
    }

    // Grant ROUTER_ADMIN_ROLE to Dev Team
    // Allows setting and updating the CrossChainRouter contract address
    const devHasRouterAdminRole = await lookCoin.hasRole(routerAdminRole, devTeamAddress);
    if (!devHasRouterAdminRole) {
      console.log(`Granting ROUTER_ADMIN_ROLE to Dev Team at ${devTeamAddress}...`);
      const tx = await lookCoin.grantRole(routerAdminRole, devTeamAddress);
      await tx.wait();
      console.log(`✅ ROUTER_ADMIN_ROLE granted to Dev Team`);
    } else {
      console.log(`✓ Dev Team already has ROUTER_ADMIN_ROLE`);
    }

    // Grant UPGRADER_ROLE to Dev Team (in addition to MPC Vault)
    // Provides redundancy for contract upgrades - both MPC vault and dev team can upgrade
    const devHasUpgraderRole = await lookCoin.hasRole(upgraderRole, devTeamAddress);
    if (!devHasUpgraderRole) {
      console.log(`Granting UPGRADER_ROLE to Dev Team at ${devTeamAddress}...`);
      const tx = await lookCoin.grantRole(upgraderRole, devTeamAddress);
      await tx.wait();
      console.log(`✅ UPGRADER_ROLE granted to Dev Team`);
    } else {
      console.log(`✓ Dev Team already has UPGRADER_ROLE`);
    }
  }

  // ============================================================================
  // 1.3 BRIDGE MODULE ROLE ASSIGNMENTS
  // Bridge contracts need specific roles to perform cross-chain token operations
  // All bridge modules use burn-and-mint mechanism for unified liquidity
  // ============================================================================
  console.log("\n1.3. Granting roles to protocol modules...");
  if (deployment.protocolContracts) {
    
    // LayerZeroModule needs MINTER_ROLE, BURNER_ROLE, and BRIDGE_ROLE
    // Uses burn-and-mint mechanism for cross-chain transfers
    // Only configure if LayerZero is supported on this network
    if (deployment.protocolContracts.layerZeroModule && chainConfig.protocols.layerZero) {
      const layerZeroModule = deployment.protocolContracts.layerZeroModule;
      
      // Grant MINTER_ROLE
      const hasMinterRole = await lookCoin.hasRole(minterRole, layerZeroModule);
      if (!hasMinterRole) {
        console.log(`Granting MINTER_ROLE to LayerZeroModule at ${layerZeroModule}...`);
        const tx = await lookCoin.grantRole(minterRole, layerZeroModule);
        await tx.wait();
        console.log(`✅ MINTER_ROLE granted to LayerZeroModule`);
      } else {
        console.log(`✓ LayerZeroModule already has MINTER_ROLE`);
      }

      // Grant BURNER_ROLE
      const hasBurnerRole = await lookCoin.hasRole(burnerRole, layerZeroModule);
      if (!hasBurnerRole) {
        console.log(`Granting BURNER_ROLE to LayerZeroModule at ${layerZeroModule}...`);
        const tx = await lookCoin.grantRole(burnerRole, layerZeroModule);
        await tx.wait();
        console.log(`✅ BURNER_ROLE granted to LayerZeroModule`);
      } else {
        console.log(`✓ LayerZeroModule already has BURNER_ROLE`);
      }

      // Grant BRIDGE_ROLE
      const hasBridgeRole = await lookCoin.hasRole(bridgeRole, layerZeroModule);
      if (!hasBridgeRole) {
        console.log(`Granting BRIDGE_ROLE to LayerZeroModule at ${layerZeroModule}...`);
        const tx = await lookCoin.grantRole(bridgeRole, layerZeroModule);
        await tx.wait();
        console.log(`✅ BRIDGE_ROLE granted to LayerZeroModule`);
      } else {
        console.log(`✓ LayerZeroModule already has BRIDGE_ROLE`);
      }
    } else if (deployment.protocolContracts.layerZeroModule && !chainConfig.protocols.layerZero) {
      console.log(`⚠️  Warning: LayerZeroModule was deployed but LayerZero is not supported on ${networkName}`);
      console.log(`   This module should not have been deployed on this network.`);
    }
    
    // HyperlaneModule needs MINTER_ROLE, BURNER_ROLE, and BRIDGE_ROLE
    // Only configured if Hyperlane infrastructure is ready (mailbox and gas paymaster)
    if (deployment.protocolContracts.hyperlaneModule && isHyperlaneReady(chainConfig)) {
      const hyperlaneModule = deployment.protocolContracts.hyperlaneModule;
      
      // Grant MINTER_ROLE
      const hasMinterRole = await lookCoin.hasRole(minterRole, hyperlaneModule);
      if (!hasMinterRole) {
        console.log(`Granting MINTER_ROLE to HyperlaneModule at ${hyperlaneModule}...`);
        const tx = await lookCoin.grantRole(minterRole, hyperlaneModule);
        await tx.wait();
        console.log(`✅ MINTER_ROLE granted to HyperlaneModule`);
      } else {
        console.log(`✓ HyperlaneModule already has MINTER_ROLE`);
      }

      // Grant BURNER_ROLE
      const hasBurnerRole = await lookCoin.hasRole(burnerRole, hyperlaneModule);
      if (!hasBurnerRole) {
        console.log(`Granting BURNER_ROLE to HyperlaneModule at ${hyperlaneModule}...`);
        const tx = await lookCoin.grantRole(burnerRole, hyperlaneModule);
        await tx.wait();
        console.log(`✅ BURNER_ROLE granted to HyperlaneModule`);
      } else {
        console.log(`✓ HyperlaneModule already has BURNER_ROLE`);
      }

      // Grant BRIDGE_ROLE
      const hasBridgeRole = await lookCoin.hasRole(bridgeRole, hyperlaneModule);
      if (!hasBridgeRole) {
        console.log(`Granting BRIDGE_ROLE to HyperlaneModule at ${hyperlaneModule}...`);
        const tx = await lookCoin.grantRole(bridgeRole, hyperlaneModule);
        await tx.wait();
        console.log(`✅ BRIDGE_ROLE granted to HyperlaneModule`);
      } else {
        console.log(`✓ HyperlaneModule already has BRIDGE_ROLE`);
      }
    } else if (deployment.protocolContracts.hyperlaneModule) {
      console.log(`⚠️  Skipping HyperlaneModule setup - Hyperlane not ready`);
    }
  }

  // CelerIMModule configuration (supports legacy deployment format)
  // Uses burn-and-mint mechanism via Celer's MessageBus
  // Only configure if Celer is supported on this network
  if (deployment.contracts.CelerIMModule && chainConfig.protocols.celer) {
    const celerModuleAddress = deployment.contracts.CelerIMModule.proxy;
    
    // Grant MINTER_ROLE
    const hasMinterRole = await lookCoin.hasRole(minterRole, celerModuleAddress);
    if (!hasMinterRole) {
      console.log(`Granting MINTER_ROLE to CelerIMModule at ${celerModuleAddress}...`);
      const tx = await lookCoin.grantRole(minterRole, celerModuleAddress);
      await tx.wait();
      console.log(`✅ MINTER_ROLE granted to CelerIMModule`);
    } else {
      console.log(`✓ CelerIMModule already has MINTER_ROLE`);
    }

    // Grant BRIDGE_ROLE
    const hasBridgeRole = await lookCoin.hasRole(bridgeRole, celerModuleAddress);
    if (!hasBridgeRole) {
      console.log(`Granting BRIDGE_ROLE to CelerIMModule at ${celerModuleAddress}...`);
      const tx = await lookCoin.grantRole(bridgeRole, celerModuleAddress);
      await tx.wait();
      console.log(`✅ BRIDGE_ROLE granted to CelerIMModule`);
    } else {
      console.log(`✓ CelerIMModule already has BRIDGE_ROLE`);
    }
  } else if (deployment.contracts.CelerIMModule && !chainConfig.protocols.celer) {
    console.log(`⚠️  Warning: CelerIMModule was deployed but Celer is not supported on ${networkName}`);
    console.log(`   This module should not have been deployed on this network.`);
  }


  // ============================================================================
  // 1.4 DIRECT LAYERZERO OFT CONFIGURATION
  // LookCoin implements LayerZero OFT V2 natively for optimal gas efficiency
  // This allows direct cross-chain transfers without going through modules
  // ============================================================================
  
  // Get LookCoin address for various operations
  const lookCoinAddress = deployment.contracts.LookCoin.proxy;
  
  // Only configure direct LayerZero OFT if LayerZero is supported on this network
  if (chainConfig.protocols.layerZero) {
    // Grant BURNER_ROLE to LookCoin itself to enable direct OFT burns
    const hasBurnerRoleForLookCoin = await lookCoin.hasRole(burnerRole, lookCoinAddress);

    if (!hasBurnerRoleForLookCoin) {
      console.log(`Granting BURNER_ROLE to LookCoin for direct OFT functionality...`);
      const tx = await lookCoin.grantRole(burnerRole, lookCoinAddress);
      await tx.wait();
      console.log(`✅ BURNER_ROLE granted to LookCoin (enables direct LayerZero OFT)`);
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
  } else {
    console.log("\n1.4. Skipping LayerZero OFT configuration (not supported on this network)");
  }

  // ============================================================================
  // SECTION 2: SUPPLY ORACLE BRIDGE REGISTRATION (LOCAL CHAIN ONLY)
  // The SupplyOracle tracks cross-chain token movements for supply reconciliation
  // Note: This registers bridges on the CURRENT CHAIN only
  // Remote chain bridges are registered in configure.ts (Stage 3)
  // ============================================================================
  console.log("\n2. Registering local bridges with SupplyOracle...");

  // Helper function to register bridge with the SupplyOracle
  // Each bridge must be registered to enable cross-chain supply tracking
  async function registerBridgeIfNeeded(chainId: number, bridgeAddress: string, bridgeName: string) {
    try {
      // Check if bridge is already registered
      const isRegistered = await supplyOracle.isBridgeRegistered(chainId, bridgeAddress);
      
      if (isRegistered) {
        console.log(`✓ ${bridgeName} already registered with SupplyOracle for chain ${chainId}`);
        return;
      }
      
      // Register the bridge
      console.log(`Registering ${bridgeName} as bridge for chain ${chainId}...`);
      const tx = await supplyOracle.registerBridge(chainId, bridgeAddress);
      await tx.wait();
      console.log(`✅ ${bridgeName} registered with SupplyOracle`);
    } catch (error) {
      // Handle registration errors
      if (error instanceof Error && error.message.includes("bridge already registered")) {
        console.log(`✓ ${bridgeName} already registered with SupplyOracle for chain ${chainId}`);
      } else {
        console.error(`❌ Failed to register ${bridgeName}:`, error instanceof Error ? error.message : String(error));
        throw error;
      }
    }
  }

  // Register LookCoin itself for direct LayerZero OFT transfers
  // Uses LayerZero chain ID instead of regular chain ID
  // Only register if LayerZero is supported on this network
  if (deployment.protocolsDeployed && deployment.protocolsDeployed.includes("layerZero") && chainConfig.protocols.layerZero) {
    const bridgeChainId = chainConfig.layerZero.lzChainId || chainId;
    await registerBridgeIfNeeded(bridgeChainId, lookCoinAddress, "LookCoin (LayerZero)");
  }
  
  // Register protocol-specific bridge modules
  if (deployment.protocolContracts) {
    
    // Register Hyperlane bridge module
    // Note: Uses Hyperlane domain ID which may differ from chain ID
    if (deployment.protocolContracts.hyperlaneModule && isHyperlaneReady(chainConfig)) {
      const hyperlaneDomainId = chainConfig.hyperlane?.hyperlaneDomainId || chainId;
      await registerBridgeIfNeeded(hyperlaneDomainId, deployment.protocolContracts.hyperlaneModule, "HyperlaneModule");
    }
  }

  // Register CelerIMModule bridge
  // Uses Celer-specific chain ID for cross-chain identification
  // Only register if Celer is supported on this network
  if (deployment.contracts.CelerIMModule && chainConfig.protocols.celer) {
    const celerModuleAddress = deployment.contracts.CelerIMModule.proxy;
    const celerChainId = chainConfig.celer.celerChainId || chainId;
    await registerBridgeIfNeeded(celerChainId, celerModuleAddress, "CelerIMModule");
  }


  // ============================================================================
  // SECTION 2.5: CROSSCHAINROUTER CONFIGURATION (Multi-Protocol Mode)
  // The CrossChainRouter provides unified interface for all bridge protocols
  // Only deployed in multi-protocol mode for protocol abstraction
  // ============================================================================
  if (deployment.infrastructureContracts?.crossChainRouter) {
    console.log("\n2.5. Configuring CrossChainRouter...");
    const crossChainRouter = await ethers.getContractAt(
      "contracts/xchain/CrossChainRouter.sol:CrossChainRouter", 
      deployment.infrastructureContracts.crossChainRouter
    );

    // Register CrossChainRouter with LookCoin
    // This enables the router to act as an intermediary for bridge operations
    const currentRouter = await lookCoin.crossChainRouter();
    if (currentRouter !== deployment.infrastructureContracts.crossChainRouter) {
      console.log("Setting CrossChainRouter in LookCoin...");
      const tx = await lookCoin.setCrossChainRouter(deployment.infrastructureContracts.crossChainRouter);
      await tx.wait();
      console.log("✅ CrossChainRouter registered with LookCoin");
    } else {
      console.log("✓ CrossChainRouter already registered with LookCoin");
    }

    // Grant PROTOCOL_ADMIN_ROLE to deployer (needed for registerProtocol calls)
    const PROTOCOL_ADMIN_ROLE_CCR = await crossChainRouter.PROTOCOL_ADMIN_ROLE();
    const deployerHasProtocolAdminRole = await crossChainRouter.hasRole(PROTOCOL_ADMIN_ROLE_CCR, deployer.address);
    if (!deployerHasProtocolAdminRole) {
      console.log(`Granting PROTOCOL_ADMIN_ROLE on CrossChainRouter to deployer...`);
      const tx = await crossChainRouter.grantRole(PROTOCOL_ADMIN_ROLE_CCR, deployer.address);
      await tx.wait();
      console.log(`✅ PROTOCOL_ADMIN_ROLE granted to deployer on CrossChainRouter`);
    } else {
      console.log(`✓ Deployer already has PROTOCOL_ADMIN_ROLE on CrossChainRouter`);
    }

    // Grant OPERATOR_ROLE to Dev Team on CrossChainRouter
    if (chainConfig.devTeamAddress) {
      const OPERATOR_ROLE = await crossChainRouter.OPERATOR_ROLE();
      const devHasOperatorRole = await crossChainRouter.hasRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
      if (!devHasOperatorRole) {
        console.log(`Granting OPERATOR_ROLE on CrossChainRouter to Dev Team...`);
        const tx = await crossChainRouter.grantRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
        await tx.wait();
        console.log(`✅ OPERATOR_ROLE granted to Dev Team on CrossChainRouter`);
      } else {
        console.log(`✓ Dev Team already has OPERATOR_ROLE on CrossChainRouter`);
      }
      
      // Also grant PROTOCOL_ADMIN_ROLE to Dev Team
      const devHasProtocolAdminRole = await crossChainRouter.hasRole(PROTOCOL_ADMIN_ROLE_CCR, chainConfig.devTeamAddress);
      if (!devHasProtocolAdminRole) {
        console.log(`Granting PROTOCOL_ADMIN_ROLE on CrossChainRouter to Dev Team...`);
        const tx = await crossChainRouter.grantRole(PROTOCOL_ADMIN_ROLE_CCR, chainConfig.devTeamAddress);
        await tx.wait();
        console.log(`✅ PROTOCOL_ADMIN_ROLE granted to Dev Team on CrossChainRouter`);
      } else {
        console.log(`✓ Dev Team already has PROTOCOL_ADMIN_ROLE on CrossChainRouter`);
      }
    }

    // Register protocol modules with the CrossChainRouter
    // Each protocol is assigned a unique ID for routing
    if (deployment.protocolContracts) {
      // Register LayerZero module (Protocol ID: 0)
      // Only register if LayerZero is supported on this network
      if (deployment.protocolContracts.layerZeroModule && chainConfig.protocols.layerZero) {
        try {
          const currentModule = await crossChainRouter.protocolModules(0); // Protocol.LayerZero
          if (currentModule === ethers.ZeroAddress || currentModule !== deployment.protocolContracts.layerZeroModule) {
            console.log("Registering LayerZero module...");
            const tx1 = await crossChainRouter.registerProtocol(
              0, // Protocol.LayerZero
              deployment.protocolContracts.layerZeroModule
            );
            await tx1.wait();
            console.log("✅ LayerZero module registered");
          } else {
            console.log("✓ LayerZero module already registered");
          }
        } catch (error) {
          // Module not registered yet
          console.log("Registering LayerZero module...");
          const tx1 = await crossChainRouter.registerProtocol(
            0, // Protocol.LayerZero
            deployment.protocolContracts.layerZeroModule
          );
          await tx1.wait();
          console.log("✅ LayerZero module registered");
        }
      }

      // Register Celer module (Protocol ID: 1)
      // Only register if Celer is supported on this network
      if (deployment.contracts.CelerIMModule && chainConfig.protocols.celer) {
        try {
          const currentModule = await crossChainRouter.protocolModules(1); // Protocol.Celer
          if (currentModule === ethers.ZeroAddress || currentModule !== deployment.contracts.CelerIMModule.proxy) {
            console.log("Registering Celer module...");
            const tx2 = await crossChainRouter.registerProtocol(
              1, // Protocol.Celer
              deployment.contracts.CelerIMModule.proxy
            );
            await tx2.wait();
            console.log("✅ Celer module registered");
          } else {
            console.log("✓ Celer module already registered");
          }
        } catch (error) {
          // Module not registered yet
          console.log("Registering Celer module...");
          const tx2 = await crossChainRouter.registerProtocol(
            1, // Protocol.Celer
            deployment.contracts.CelerIMModule.proxy
          );
          await tx2.wait();
          console.log("✅ Celer module registered");
        }
      } else if (deployment.contracts.CelerIMModule && !chainConfig.protocols.celer) {
        console.log("⚠️  Skipping Celer module registration - Celer not supported on this network");
      }

      // Register Hyperlane module (Protocol ID: 2)
      if (deployment.protocolContracts.hyperlaneModule && isHyperlaneReady(chainConfig)) {
        try {
          const currentModule = await crossChainRouter.protocolModules(2); // Protocol.Hyperlane
          if (currentModule === ethers.ZeroAddress || currentModule !== deployment.protocolContracts.hyperlaneModule) {
            console.log("Registering Hyperlane module...");
            const tx3 = await crossChainRouter.registerProtocol(
              2, // Protocol.Hyperlane
              deployment.protocolContracts.hyperlaneModule
            );
            await tx3.wait();
            console.log("✅ Hyperlane module registered");
          } else {
            console.log("✓ Hyperlane module already registered");
          }
        } catch (error) {
          // Module not registered yet
          console.log("Registering Hyperlane module...");
          const tx3 = await crossChainRouter.registerProtocol(
            2, // Protocol.Hyperlane
            deployment.protocolContracts.hyperlaneModule
          );
          await tx3.wait();
          console.log("✅ Hyperlane module registered");
        }
      }
    }

    // Grant BRIDGE_ROLE to CrossChainRouter
    // This allows the router to interact with bridge modules on behalf of users
    const BRIDGE_ROLE = await lookCoin.BRIDGE_ROLE();
    const hasRole = await lookCoin.hasRole(BRIDGE_ROLE, deployment.infrastructureContracts.crossChainRouter);
    if (!hasRole) {
      console.log("Granting BRIDGE_ROLE to CrossChainRouter...");
      const tx = await lookCoin.grantRole(BRIDGE_ROLE, deployment.infrastructureContracts.crossChainRouter);
      await tx.wait();
      console.log("✅ BRIDGE_ROLE granted to CrossChainRouter");
    } else {
      console.log("✓ CrossChainRouter already has BRIDGE_ROLE");
    }
  }

  // ============================================================================
  // SECTION 2.6: DEV TEAM OPERATOR ROLES ON INFRASTRUCTURE
  // Grant OPERATOR_ROLE to dev team for operational tasks on infrastructure contracts
  // This allows the dev team to configure protocol settings without financial control
  // ============================================================================
  if (chainConfig.devTeamAddress && (deployment.protocolContracts || deployment.infrastructureContracts)) {
    console.log("\n2.6. Granting OPERATOR_ROLE to Dev Team on infrastructure contracts...");
    
    // Grant OPERATOR_ROLE on FeeManager
    if (deployment.infrastructureContracts?.feeManager) {
      const feeManager = await ethers.getContractAt(
        "FeeManager",
        deployment.infrastructureContracts.feeManager
      );
      const OPERATOR_ROLE = await feeManager.OPERATOR_ROLE();
      const hasOperatorRole = await feeManager.hasRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
      if (!hasOperatorRole) {
        console.log("Granting OPERATOR_ROLE on FeeManager to Dev Team...");
        const tx = await feeManager.grantRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
        await tx.wait();
        console.log("✅ OPERATOR_ROLE granted to Dev Team on FeeManager");
      } else {
        console.log("✓ Dev Team already has OPERATOR_ROLE on FeeManager");
      }
    }

    // Grant OPERATOR_ROLE on SecurityManager
    if (deployment.infrastructureContracts?.securityManager) {
      const securityManager = await ethers.getContractAt(
        "SecurityManager",
        deployment.infrastructureContracts.securityManager
      );
      const OPERATOR_ROLE = await securityManager.OPERATOR_ROLE();
      const hasOperatorRole = await securityManager.hasRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
      if (!hasOperatorRole) {
        console.log("Granting OPERATOR_ROLE on SecurityManager to Dev Team...");
        const tx = await securityManager.grantRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
        await tx.wait();
        console.log("✅ OPERATOR_ROLE granted to Dev Team on SecurityManager");
      } else {
        console.log("✓ Dev Team already has OPERATOR_ROLE on SecurityManager");
      }
    }

    // Grant OPERATOR_ROLE on protocol modules
    if (deployment.protocolContracts) {
      // LayerZeroModule
      // Only configure if LayerZero is supported on this network
      if (deployment.protocolContracts.layerZeroModule && chainConfig.protocols.layerZero) {
        const layerZeroModule = await ethers.getContractAt(
          "LayerZeroModule",
          deployment.protocolContracts.layerZeroModule
        );
        const OPERATOR_ROLE = await layerZeroModule.OPERATOR_ROLE();
        const hasOperatorRole = await layerZeroModule.hasRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
        if (!hasOperatorRole) {
          console.log("Granting OPERATOR_ROLE on LayerZeroModule to Dev Team...");
          const tx = await layerZeroModule.grantRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
          await tx.wait();
          console.log("✅ OPERATOR_ROLE granted to Dev Team on LayerZeroModule");
        } else {
          console.log("✓ Dev Team already has OPERATOR_ROLE on LayerZeroModule");
        }
      }

      // HyperlaneModule
      if (deployment.protocolContracts.hyperlaneModule && isHyperlaneReady(chainConfig)) {
        const hyperlaneModule = await ethers.getContractAt(
          "HyperlaneModule",
          deployment.protocolContracts.hyperlaneModule
        );
        const OPERATOR_ROLE = await hyperlaneModule.OPERATOR_ROLE();
        const hasOperatorRole = await hyperlaneModule.hasRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
        if (!hasOperatorRole) {
          console.log("Granting OPERATOR_ROLE on HyperlaneModule to Dev Team...");
          const tx = await hyperlaneModule.grantRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
          await tx.wait();
          console.log("✅ OPERATOR_ROLE granted to Dev Team on HyperlaneModule");
        } else {
          console.log("✓ Dev Team already has OPERATOR_ROLE on HyperlaneModule");
        }
      }
    }

    // Grant OPERATOR_ROLE on CelerIMModule
    // Only configure if Celer is supported on this network
    if (deployment.contracts?.CelerIMModule && chainConfig.protocols.celer) {
      const celerIMModule = await ethers.getContractAt(
        "CelerIMModule",
        deployment.contracts.CelerIMModule.proxy
      );
      const OPERATOR_ROLE = await celerIMModule.OPERATOR_ROLE();
      const hasOperatorRole = await celerIMModule.hasRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
      if (!hasOperatorRole) {
        console.log("Granting OPERATOR_ROLE on CelerIMModule to Dev Team...");
        const tx = await celerIMModule.grantRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
        await tx.wait();
        console.log("✅ OPERATOR_ROLE granted to Dev Team on CelerIMModule");
      } else {
        console.log("✓ Dev Team already has OPERATOR_ROLE on CelerIMModule");
      }
    }
  }

  // ============================================================================
  // SECTION 3: SUPPLY ORACLE OPERATIONAL CONFIGURATION
  // Configure oracle parameters and grant operational roles
  // ============================================================================
  console.log("\n3. Configuring SupplyOracle operational parameters...");

  // Set reconciliation parameters from centralized config
  console.log("Setting reconciliation parameters...");
  const currentInterval = await supplyOracle.reconciliationInterval();
  const newInterval = BigInt(chainConfig.oracle.updateInterval);
  const currentTolerance = await supplyOracle.toleranceThreshold();
  const newTolerance = ethers.parseUnits(String(chainConfig.oracle.tolerance * 10), 8); // Convert basis points to LOOK tokens

  if (currentInterval !== newInterval || currentTolerance !== newTolerance) {
    const tx = await supplyOracle.updateReconciliationParams(
      chainConfig.oracle.updateInterval,
      newTolerance
    );
    await tx.wait();
    console.log(`✅ Updated reconciliation parameters:`);
    console.log(`   - Interval: ${chainConfig.oracle.updateInterval} seconds`);
    console.log(`   - Tolerance: ${chainConfig.oracle.tolerance} basis points`);
  } else {
    console.log(`✓ Reconciliation parameters already configured correctly`);
  }

  // Grant oracle roles to deployer (for testing/initial setup)
  // In production, these should be granted to actual oracle operators
  console.log("\nGranting oracle operational roles...");
  const ORACLE_ROLE = await supplyOracle.ORACLE_ROLE();
  const OPERATOR_ROLE = await supplyOracle.OPERATOR_ROLE();

  // Grant ORACLE_ROLE
  const hasOracleRole = await supplyOracle.hasRole(ORACLE_ROLE, deployer.address);
  if (!hasOracleRole) {
    console.log(`Granting ORACLE_ROLE to deployer for testing...`);
    const tx = await supplyOracle.grantRole(ORACLE_ROLE, deployer.address);
    await tx.wait();
    console.log(`✅ ORACLE_ROLE granted to deployer`);
  } else {
    console.log(`✓ Deployer already has ORACLE_ROLE`);
  }

  // Grant OPERATOR_ROLE
  const hasOperatorRole = await supplyOracle.hasRole(OPERATOR_ROLE, deployer.address);
  if (!hasOperatorRole) {
    console.log(`Granting OPERATOR_ROLE to deployer for operations...`);
    const tx = await supplyOracle.grantRole(OPERATOR_ROLE, deployer.address);
    await tx.wait();
    console.log(`✅ OPERATOR_ROLE granted to deployer`);
  } else {
    console.log(`✓ Deployer already has OPERATOR_ROLE`);
  }

  // Grant OPERATOR_ROLE to dev team if configured
  if (chainConfig.devTeamAddress) {
    const devHasOperatorRole = await supplyOracle.hasRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
    if (!devHasOperatorRole) {
      console.log(`Granting OPERATOR_ROLE on SupplyOracle to Dev Team...`);
      const tx = await supplyOracle.grantRole(OPERATOR_ROLE, chainConfig.devTeamAddress);
      await tx.wait();
      console.log(`✅ OPERATOR_ROLE granted to Dev Team on SupplyOracle`);
    } else {
      console.log(`✓ Dev Team already has OPERATOR_ROLE on SupplyOracle`);
    }
  }

  // ============================================================================
  // FINAL SUMMARY
  // Display the final configuration state after all setup operations
  // ============================================================================
  console.log("\n=== Configuration Summary ===");
  console.log(`- Network: ${networkName} (Chain ID: ${chainId})`);
  console.log(`- Deployment Mode: ${deployment.deploymentMode || 'legacy'}`);
  console.log(`- Governance Vault: ${chainConfig.governanceVault}`);
  if (chainConfig.devTeamAddress) {
    console.log(`- Dev Team Address: ${chainConfig.devTeamAddress}`);
  }
  console.log(`- LookCoin: ${lookCoinAddress}`);
  console.log(`- SupplyOracle: ${deployment.contracts.SupplyOracle.proxy}`);
  
  // Show protocol support vs deployment status
  console.log("\nProtocol Support:");
  console.log(`- LayerZero: ${chainConfig.protocols.layerZero ? '✅ Supported' : '❌ Not Supported'}`);
  console.log(`- Celer: ${chainConfig.protocols.celer ? '✅ Supported' : '❌ Not Supported'}`);
  console.log(`- Hyperlane: ${chainConfig.protocols.hyperlane ? '✅ Supported' : '❌ Not Supported'}`);
  
  if (chainConfig.protocols.hyperlane && isHyperlaneReady(chainConfig)) {
    console.log(`  └─ Hyperlane Infrastructure: Ready (Domain ID: ${chainConfig.hyperlane?.hyperlaneDomainId})`);
  } else if (chainConfig.protocols.hyperlane && !isHyperlaneReady(chainConfig)) {
    console.log(`  └─ Hyperlane Infrastructure: Not Ready (missing mailbox or gas paymaster)`);
  }
  
  // Display deployed protocols
  if (deployment.protocolsDeployed && deployment.protocolsDeployed.length > 0) {
    console.log(`\nProtocols Deployed: ${deployment.protocolsDeployed.join(', ')}`);
    
    // Check for mismatches
    const mismatches = [];
    if (deployment.protocolsDeployed.includes('layerZero') && !chainConfig.protocols.layerZero) {
      mismatches.push('LayerZero');
    }
    if (deployment.protocolsDeployed.includes('celer') && !chainConfig.protocols.celer) {
      mismatches.push('Celer');
    }
    if (deployment.protocolsDeployed.includes('hyperlane') && !chainConfig.protocols.hyperlane) {
      mismatches.push('Hyperlane');
    }
    
    if (mismatches.length > 0) {
      console.log(`\n⚠️  Warning: The following protocols were deployed but are not supported on ${networkName}:`);
      console.log(`   ${mismatches.join(', ')}`);
      console.log(`   Consider using the correct deployment configuration for this network.`);
    }
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
    if (!chainConfig.protocols.celer) {
      console.log(`  ⚠️ Warning: Module deployed but Celer not supported on this network`);
    }
  }

  // ============================================================================
  // COMPLETION AND NEXT STEPS
  // ============================================================================
  console.log("\n✅ Setup completed successfully!");
  console.log("\n⚠️  Next steps:");

  // Provide network-specific configure script instructions
  // Configure scripts are only available for networks with deployment artifacts from other networks
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
