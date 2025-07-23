import { ethers } from "hardhat";
import hre from "hardhat";
import { ChainConfig } from "../../hardhat.config";
import { ProtocolDetector, ProtocolSupport } from "./protocolDetector";
import { fetchDeployOrUpgradeProxy } from "./state";
import { Deployment } from "./deployment";

export interface DeploymentConfig {
  chainConfig: ChainConfig;
  deployer: string;
  deploymentName: string;
  existingDeployment?: Deployment | null;
}

export interface CoreContracts {
  lookCoin: string;
  supplyOracle: string;
}

export interface ProtocolContracts {
  layerZeroModule?: string;
  celerIMModule?: string;
  xerc20Module?: string;
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

    // Deploy XERC20 module if supported
    if (protocolSupport.xerc20) {
      // XERC20Module contract doesn't exist, skip deployment
      console.log("⚠️  Skipping XERC20Module deployment - contract not found");
      /*
      console.log("🏭 Deploying XERC20 module...");
      const xerc20ModuleContract = await fetchDeployOrUpgradeProxy(
        hre,
        "XERC20Module",
        "contracts/bridges/XERC20Module.sol:XERC20Module",
        [
          config.existingDeployment?.contracts?.LookCoin?.proxy || "",
          config.chainConfig.xerc20.bridge,
          config.deployer
        ],
        config.deploymentName
      );
      contracts.xerc20Module = await xerc20ModuleContract.getAddress();
      console.log("✅ XERC20Module deployed at:", contracts.xerc20Module);
      */
    }

    // Deploy Hyperlane module if supported
    if (protocolSupport.hyperlane) {
      // HyperlaneModule contract doesn't exist, skip deployment
      console.log("⚠️  Skipping HyperlaneModule deployment - contract not found");
      /*
      console.log("📮 Deploying Hyperlane module...");
      const hyperlaneModuleContract = await fetchDeployOrUpgradeProxy(
        hre,
        "HyperlaneModule",
        "contracts/bridges/HyperlaneModule.sol:HyperlaneModule",
        [
          config.existingDeployment?.contracts?.LookCoin?.proxy || "",
          config.chainConfig.hyperlane.mailbox,
          config.chainConfig.hyperlane.ism || ethers.ZeroAddress,
          config.deployer
        ],
        config.deploymentName
      );
      contracts.hyperlaneModule = await hyperlaneModuleContract.getAddress();
      console.log("✅ HyperlaneModule deployed at:", contracts.hyperlaneModule);
      */
    }


    return contracts;
  }

  /**
   * Deploys infrastructure contracts for multi-protocol mode
   * @param config Deployment configuration
   * @returns Infrastructure contract addresses
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static async deployInfrastructure(config: DeploymentConfig): Promise<InfraContracts> {
    console.log("\n🏗️  Deploying multi-protocol infrastructure...");

    // Deploy CrossChainRouter
    // CrossChainRouter contract doesn't exist, skip deployment
    console.log("⚠️  Skipping CrossChainRouter deployment - contract not found");
    /*
    const crossChainRouterContract = await fetchDeployOrUpgradeProxy(
      hre,
      "CrossChainRouter",
      "contracts/infrastructure/CrossChainRouter.sol:CrossChainRouter",
      [config.deployer],
      config.deploymentName
    );
    const crossChainRouterAddress = await crossChainRouterContract.getAddress();
    */
    // console.log("✅ CrossChainRouter deployed at:", crossChainRouterAddress);

    // Deploy FeeManager
    // FeeManager contract doesn't exist, skip deployment
    console.log("⚠️  Skipping FeeManager deployment - contract not found");
    /*
    const feeManagerContract = await fetchDeployOrUpgradeProxy(
      hre,
      "FeeManager",
      "contracts/infrastructure/FeeManager.sol:FeeManager",
      [
        config.existingDeployment?.contracts?.LookCoin?.proxy || "",
        config.deployer,
        config.deployer
      ],
      config.deploymentName
    );
    const feeManagerAddress = await feeManagerContract.getAddress();
    */
    // console.log("✅ FeeManager deployed at:", feeManagerAddress);

    // Deploy SecurityManager
    // SecurityManager contract doesn't exist, skip deployment
    console.log("⚠️  Skipping SecurityManager deployment - contract not found");
    /*
    const securityManagerContract = await fetchDeployOrUpgradeProxy(
      hre,
      "SecurityManager",
      "contracts/infrastructure/SecurityManager.sol:SecurityManager",
      [config.deployer],
      config.deploymentName
    );
    const securityManagerAddress = await securityManagerContract.getAddress();
    */
    // console.log("✅ SecurityManager deployed at:", securityManagerAddress);

    // Deploy ProtocolRegistry
    // ProtocolRegistry contract doesn't exist, skip deployment
    console.log("⚠️  Skipping ProtocolRegistry deployment - contract not found");
    /*
    const protocolRegistryContract = await fetchDeployOrUpgradeProxy(
      hre,
      "ProtocolRegistry",
      "contracts/infrastructure/ProtocolRegistry.sol:ProtocolRegistry",
      [config.deployer],
      config.deploymentName
    );
    const protocolRegistryAddress = await protocolRegistryContract.getAddress();
    */
    // console.log("✅ ProtocolRegistry deployed at:", protocolRegistryAddress);

    // Return empty addresses for now as contracts don't exist
    return {
      crossChainRouter: "",
      feeManager: "",
      securityManager: "",
      protocolRegistry: ""
    };
  }

  /**
   * Determines deployment mode based on protocol support
   * @param protocolSupport The detected protocol support
   * @returns "standard" or "multi-protocol"
   */
  static determineDeploymentMode(protocolSupport: ProtocolSupport): "standard" | "multi-protocol" {
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
}