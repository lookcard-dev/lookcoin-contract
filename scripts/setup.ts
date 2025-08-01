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
    if (deployment.protocolContracts.layerZeroModule) {
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
  if (deployment.contracts.CelerIMModule) {
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
  }


  // ============================================================================
  // 1.4 DIRECT LAYERZERO OFT CONFIGURATION
  // LookCoin implements LayerZero OFT V2 natively for optimal gas efficiency
  // This allows direct cross-chain transfers without going through modules
  // ============================================================================
  
  // Grant BURNER_ROLE to LookCoin itself to enable direct OFT burns
  const lookCoinAddress = deployment.contracts.LookCoin.proxy;
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

  // ============================================================================
  // SECTION 2: SUPPLY ORACLE BRIDGE REGISTRATION
  // The SupplyOracle tracks cross-chain token movements for supply reconciliation
  // ============================================================================
  console.log("\n2. Registering bridges with SupplyOracle...");

  // Helper function to register bridge with the SupplyOracle
  // Each bridge must be registered to enable cross-chain supply tracking
  async function registerBridgeIfNeeded(chainId: number, bridgeAddress: string, bridgeName: string) {
    try {
      const bridgeInfo = await supplyOracle.bridgeInfo(chainId, bridgeAddress);
      // Check if bridge is already registered and active
      if (bridgeInfo.isActive) {
        console.log(`✓ ${bridgeName} already registered with SupplyOracle for chain ${chainId}`);
        return;
      }
      // Bridge exists but not active, re-register
      console.log(`Registering ${bridgeName} as bridge for chain ${chainId}...`);
      const tx = await supplyOracle.registerBridge(chainId, bridgeAddress);
      await tx.wait();
      console.log(`✅ ${bridgeName} registered with SupplyOracle`);
    } catch (error) {
      // Bridge not registered yet (first time)
      console.log(`Registering ${bridgeName} as bridge for chain ${chainId}...`);
      const tx = await supplyOracle.registerBridge(chainId, bridgeAddress);
      await tx.wait();
      console.log(`✅ ${bridgeName} registered with SupplyOracle`);
    }
  }

  // Register LookCoin itself for direct LayerZero OFT transfers
  // Uses LayerZero chain ID instead of regular chain ID
  if (deployment.protocolsDeployed && deployment.protocolsDeployed.includes("layerZero")) {
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
  if (deployment.contracts.CelerIMModule) {
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
    }

    // Register protocol modules with the CrossChainRouter
    // Each protocol is assigned a unique ID for routing
    if (deployment.protocolContracts) {
      // Register LayerZero module (Protocol ID: 0)
      if (deployment.protocolContracts.layerZeroModule) {
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
      if (deployment.contracts.CelerIMModule) {
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
      if (deployment.protocolContracts.layerZeroModule) {
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
    if (deployment.contracts?.CelerIMModule) {
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
  // SECTION 3: CONFIGURATION SUMMARY
  // Display the final configuration state after all setup operations
  // ============================================================================
  console.log("\n3. Configuration Summary:");
  console.log(`- Network: ${networkName} (Chain ID: ${chainId})`);
  console.log(`- Deployment Mode: ${deployment.deploymentMode || 'legacy'}`);
  console.log(`- Governance Vault: ${chainConfig.governanceVault}`);
  if (chainConfig.devTeamAddress) {
    console.log(`- Dev Team Address: ${chainConfig.devTeamAddress}`);
  }
  console.log(`- LookCoin: ${lookCoinAddress}`);
  console.log(`- SupplyOracle: ${deployment.contracts.SupplyOracle.proxy}`);
  
  // Show protocol status
  if (isHyperlaneReady(chainConfig)) {
    console.log(`- Hyperlane: Ready (Domain ID: ${chainConfig.hyperlane?.hyperlaneDomainId})`);
  } else {
    console.log(`- Hyperlane: Not ready (missing mailbox or gas paymaster)`);
  }
  
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
