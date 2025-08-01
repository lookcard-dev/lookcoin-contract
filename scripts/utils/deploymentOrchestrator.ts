import { ethers } from "hardhat";
import hre from "hardhat";
import { ChainConfig, TOTAL_SUPPLY } from "../../hardhat.config";
import { ProtocolDetector, ProtocolSupport, isHyperlaneReady } from "./protocolDetector";
import { fetchDeployOrUpgradeProxy } from "./state";
import { Deployment } from "./deployment";

export interface DeploymentConfig {
  chainConfig: ChainConfig;
  deployer: string;
  deploymentName: string;
  existingDeployment?: Deployment | null;
  forceStandardMode?: boolean; // Add this parameter
}

export interface CoreContracts {
  lookCoin: string;
  supplyOracle: string;
}

export interface ProtocolContracts {
  layerZeroModule?: string;
  celerIMModule?: string;
  hyperlaneModule?: string;
}

export interface InfraContracts {
  crossChainRouter: string;
  feeManager: string;
  securityManager: string;
  protocolRegistry: string;
}

export class DeploymentOrchestrator {
  /**
   * Deploys core contracts that are always needed
   * @param config Deployment configuration
   * @returns Core contract addresses
   */
  static async deployCore(config: DeploymentConfig): Promise<CoreContracts> {
    console.log("\n🚀 Deploying core contracts...");
    
    // Deploy LookCoin
    const lookCoinContract = await fetchDeployOrUpgradeProxy(
      hre,
      "LookCoin",
      [config.deployer, config.chainConfig.layerZero.endpoint]
    );
    const lookCoinAddress = await lookCoinContract.getAddress();
    console.log("✅ LookCoin deployed at:", lookCoinAddress);

    // Determine supported chain IDs based on network tier
    const chainId = config.chainConfig.chainId;
    let supportedChainIds: number[];
    
    // Check if mainnet or testnet based on chain ID
    if ([56, 8453, 10, 23295, 9070].includes(chainId)) {
      // Mainnet chain IDs
      supportedChainIds = [56, 8453, 10, 23295, 9070]; // BSC, Base, Optimism, Sapphire, Akashic
    } else {
      // Testnet chain IDs
      supportedChainIds = [97, 84532, 11155420, 23295, 9071]; // BSC Testnet, Base Sepolia, Optimism Sepolia, Sapphire Testnet, Akashic Testnet
    }

    // Deploy SupplyOracle
    const supplyOracleContract = await fetchDeployOrUpgradeProxy(
      hre,
      "SupplyOracle",
      [
        config.deployer, 
        TOTAL_SUPPLY, // Total supply from hardhat config
        supportedChainIds
      ]
    );
    const supplyOracleAddress = await supplyOracleContract.getAddress();
    console.log("✅ SupplyOracle deployed at:", supplyOracleAddress);

    return {
      lookCoin: lookCoinAddress,
      supplyOracle: supplyOracleAddress
    };
  }

  /**
   * Conditionally deploys protocol modules based on protocol detection
   * @param config Deployment configuration
   * @param lookCoinAddress LookCoin contract address
   * @returns Protocol contract addresses
   */
  static async deployProtocols(config: DeploymentConfig, lookCoinAddress: string): Promise<ProtocolContracts> {
    console.log("\n🔗 Deploying protocol modules...");
    
    const protocolSupport = ProtocolDetector.detectSupportedProtocols(config.chainConfig);
    const contracts: ProtocolContracts = {};
    
    // Validation for required protocol configuration
    if (protocolSupport.protocols.length === 0) {
      console.error("❌ No protocols detected for deployment!");
      console.error("   Please check your hardhat.config.ts to ensure at least one protocol is configured.");
      console.error("   Required: LayerZero endpoint, Celer messageBus, or Hyperlane mailbox");
      throw new Error("No protocols configured for deployment");
    }

    // Deploy LayerZero module if supported
    if (protocolSupport.layerZero) {
      console.log("📡 Deploying LayerZero module...");
      contracts.layerZeroModule = await this.deployLayerZeroModule(config);
    }

    // Deploy Celer IM module if supported
    if (protocolSupport.celer) {
      console.log("🌉 Deploying Celer IM module...");
      const celerIMModuleContract = await fetchDeployOrUpgradeProxy(
        hre,
        "CelerIMModule",
        [
          config.chainConfig.celer.messageBus,
          lookCoinAddress,
          config.deployer
        ]
      );
      contracts.celerIMModule = await celerIMModuleContract.getAddress();
      console.log("✅ CelerIMModule deployed at:", contracts.celerIMModule);
    }


    // Deploy Hyperlane module if supported
    if (protocolSupport.hyperlane) {
      // Check if Hyperlane is ready
      if (isHyperlaneReady(config.chainConfig)) {
        console.log("📮 Deploying Hyperlane module...");
        // Like LayerZero, Hyperlane uses the main LookCoin contract
        contracts.hyperlaneModule = await this.deployHyperlaneModule(config);
        console.log("✅ Hyperlane module configured");
      } else {
        console.log("⚠️  Skipping Hyperlane - mailbox or gas paymaster not configured");
      }
    }


    return contracts;
  }

  /**
   * Deploys infrastructure contracts for multi-protocol mode
   * @param config Deployment configuration
   * @returns Infrastructure contract addresses
   */
  static async deployInfrastructure(config: DeploymentConfig): Promise<InfraContracts> {
    console.log("\n🏗️  Deploying multi-protocol infrastructure...");
    
    // Additional check to ensure we only deploy when actually needed
    if (config.forceStandardMode) {
      console.log("⚠️  Skipping infrastructure deployment - standard mode forced");
      throw new Error("Infrastructure deployment called in standard mode - this should not happen");
    }

    // Deploy ProtocolRegistry first (no dependencies)
    console.log("📋 Deploying ProtocolRegistry...");
    const protocolRegistryContract = await fetchDeployOrUpgradeProxy(
      hre,
      "ProtocolRegistry",
      [config.deployer]
    );
    const protocolRegistryAddress = await protocolRegistryContract.getAddress();
    console.log("✅ ProtocolRegistry deployed at:", protocolRegistryAddress);

    // Deploy FeeManager (only depends on admin)
    console.log("💰 Deploying FeeManager...");
    const feeManagerContract = await fetchDeployOrUpgradeProxy(
      hre,
      "FeeManager",
      [config.deployer]
    );
    const feeManagerAddress = await feeManagerContract.getAddress();
    console.log("✅ FeeManager deployed at:", feeManagerAddress);

    // Deploy SecurityManager (depends on admin and global daily limit)
    console.log("🔒 Deploying SecurityManager...");
    const globalDailyLimit = ethers.parseEther("20000000"); // 20M tokens daily limit
    const securityManagerContract = await fetchDeployOrUpgradeProxy(
      hre,
      "SecurityManager",
      [config.deployer, globalDailyLimit]
    );
    const securityManagerAddress = await securityManagerContract.getAddress();
    console.log("✅ SecurityManager deployed at:", securityManagerAddress);

    // Deploy CrossChainRouter (depends on other contracts)
    console.log("🌐 Deploying CrossChainRouter...");
    const lookCoinAddress = config.existingDeployment?.contracts?.LookCoin?.proxy;
    if (!lookCoinAddress) {
      throw new Error("LookCoin address not found for CrossChainRouter deployment");
    }
    
    const crossChainRouterContract = await fetchDeployOrUpgradeProxy(
      hre,
      "contracts/xchain/CrossChainRouter.sol:CrossChainRouter",
      [
        lookCoinAddress,
        feeManagerAddress,
        securityManagerAddress,
        config.deployer
      ]
    );
    const crossChainRouterAddress = await crossChainRouterContract.getAddress();
    console.log("✅ CrossChainRouter deployed at:", crossChainRouterAddress);

    return {
      crossChainRouter: crossChainRouterAddress,
      feeManager: feeManagerAddress,
      securityManager: securityManagerAddress,
      protocolRegistry: protocolRegistryAddress
    };
  }

  /**
   * Determines deployment mode based on protocol support
   * @param protocolSupport The detected protocol support
   * @param forceStandard Optional force standard mode even for multi-protocol chains
   * @returns "standard" or "multi-protocol"
   */
  static determineDeploymentMode(protocolSupport: ProtocolSupport, forceStandard?: boolean): "standard" | "multi-protocol" {
    if (forceStandard) {
      console.log("📍 Forcing standard deployment mode");
      return "standard";
    }
    return protocolSupport.protocols.length > 1 ? "multi-protocol" : "standard";
  }

  /**
   * Private helper to deploy LayerZero module with special handling
   * @param config Deployment configuration
   * @returns LayerZero module address
   */
  private static async deployLayerZeroModule(config: DeploymentConfig): Promise<string> {
    const lookCoinAddress = config.existingDeployment?.contracts?.LookCoin?.proxy;
    
    if (!lookCoinAddress) {
      console.log("⚠️  LookCoin address not found for LayerZero module");
      return "";
    }

    // Deploy the LayerZeroModule
    const layerZeroModuleContract = await fetchDeployOrUpgradeProxy(
      hre,
      "LayerZeroModule",
      [
        lookCoinAddress,
        config.chainConfig.layerZero.endpoint,
        config.deployer
      ]
    );
    const layerZeroModuleAddress = await layerZeroModuleContract.getAddress();
    console.log("✅ LayerZeroModule deployed at:", layerZeroModuleAddress);

    // Grant BRIDGE_ROLE to the module so it can burn/mint
    const lookCoin = await ethers.getContractAt("LookCoin", lookCoinAddress);
    const BRIDGE_ROLE = await lookCoin.BRIDGE_ROLE();
    const hasRole = await lookCoin.hasRole(BRIDGE_ROLE, layerZeroModuleAddress);
    if (!hasRole) {
      const tx = await lookCoin.grantRole(BRIDGE_ROLE, layerZeroModuleAddress);
      await tx.wait();
      console.log("✅ Granted BRIDGE_ROLE to LayerZeroModule");
    } else {
      console.log("✓ LayerZeroModule already has BRIDGE_ROLE");
    }

    return layerZeroModuleAddress;
  }

  /**
   * Private helper to deploy Hyperlane module with special handling
   * @param config Deployment configuration
   * @returns Hyperlane module address
   */
  private static async deployHyperlaneModule(config: DeploymentConfig): Promise<string> {
    const lookCoinAddress = config.existingDeployment?.contracts?.LookCoin?.proxy;
    
    if (!lookCoinAddress) {
      console.log("⚠️  LookCoin address not found for Hyperlane module");
      return "";
    }

    // Check if Hyperlane is properly configured
    if (!config.chainConfig.hyperlane?.mailbox || !config.chainConfig.hyperlane?.gasPaymaster) {
      console.log("⚠️  Hyperlane not fully configured (missing mailbox or gas paymaster)");
      return "";
    }

    // Deploy the HyperlaneModule
    const hyperlaneModuleContract = await fetchDeployOrUpgradeProxy(
      hre,
      "HyperlaneModule",
      [
        lookCoinAddress,
        config.chainConfig.hyperlane.mailbox,
        config.chainConfig.hyperlane.gasPaymaster,
        config.deployer
      ]
    );
    const hyperlaneModuleAddress = await hyperlaneModuleContract.getAddress();
    console.log("✅ HyperlaneModule deployed at:", hyperlaneModuleAddress);

    // Grant BRIDGE_ROLE to the module so it can burn/mint
    const lookCoin = await ethers.getContractAt("LookCoin", lookCoinAddress);
    const BRIDGE_ROLE = await lookCoin.BRIDGE_ROLE();
    const hasRole = await lookCoin.hasRole(BRIDGE_ROLE, hyperlaneModuleAddress);
    if (!hasRole) {
      const tx = await lookCoin.grantRole(BRIDGE_ROLE, hyperlaneModuleAddress);
      await tx.wait();
      console.log("✅ Granted BRIDGE_ROLE to HyperlaneModule");
    } else {
      console.log("✓ HyperlaneModule already has BRIDGE_ROLE");
    }

    return hyperlaneModuleAddress;
  }
}