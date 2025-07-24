import { ethers } from "hardhat";
import hre from "hardhat";
import { ChainConfig } from "../../hardhat.config";
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

    // Deploy SupplyOracle
    const supplyOracleContract = await fetchDeployOrUpgradeProxy(
      hre,
      "SupplyOracle",
      [config.deployer, ethers.parseEther("1000000000")] // 1 billion total supply
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
    // For LayerZero, the LookCoin contract itself acts as the OFT
    // No separate module deployment needed, but we track it in the deployment
    const lookCoinAddress = config.existingDeployment?.contracts?.LookCoin?.proxy;
    
    if (!lookCoinAddress) {
      console.log("⚠️  LookCoin address not found for LayerZero module");
      return "";
    }
    
    const lookCoin = await ethers.getContractAt("LookCoin", lookCoinAddress);
    
    // Set LayerZero endpoint if not already set
    const currentEndpoint = await lookCoin.lzEndpoint();
    if (currentEndpoint === ethers.ZeroAddress && config.chainConfig.layerZero.endpoint) {
      console.log("🔧 Setting LayerZero endpoint on LookCoin...");
      const tx = await lookCoin.setLayerZeroEndpoint(config.chainConfig.layerZero.endpoint);
      await tx.wait();
    }

    // Return the LookCoin address as it serves as the LayerZero module
    return lookCoinAddress;
  }

  /**
   * Private helper to deploy Hyperlane module with special handling
   * @param config Deployment configuration
   * @returns Hyperlane module address
   */
  private static async deployHyperlaneModule(config: DeploymentConfig): Promise<string> {
    // For Hyperlane, the LookCoin contract itself acts as the message recipient
    // No separate module deployment needed, but we track it in the deployment
    const lookCoinAddress = config.existingDeployment?.contracts?.LookCoin?.proxy;
    
    if (!lookCoinAddress) {
      console.log("⚠️  LookCoin address not found for Hyperlane module");
      return "";
    }
    
    const lookCoin = await ethers.getContractAt("LookCoin", lookCoinAddress);
    
    // Set Hyperlane mailbox if not already set
    const currentMailbox = await lookCoin.hyperlaneMailbox();
    if (currentMailbox === ethers.ZeroAddress && config.chainConfig.hyperlane?.mailbox) {
      console.log("🔧 Setting Hyperlane mailbox on LookCoin...");
      const tx = await lookCoin.setHyperlaneMailbox(config.chainConfig.hyperlane.mailbox);
      await tx.wait();
    }

    // Set Hyperlane gas paymaster if not already set
    const currentGasPaymaster = await lookCoin.hyperlaneGasPaymaster();
    if (currentGasPaymaster === ethers.ZeroAddress && config.chainConfig.hyperlane?.gasPaymaster) {
      console.log("🔧 Setting Hyperlane gas paymaster on LookCoin...");
      const tx = await lookCoin.setHyperlaneGasPaymaster(config.chainConfig.hyperlane.gasPaymaster);
      await tx.wait();
    }

    // Return the LookCoin address as it serves as the Hyperlane module
    return lookCoinAddress;
  }
}