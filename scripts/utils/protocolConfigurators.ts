import { ethers } from "hardhat";
import { Deployment, getLayerZeroChainId, getCelerChainId } from "./deployment";
import { ChainConfig } from "../../hardhat.config";

/**
 * Protocol-specific configuration functions for cross-chain setup
 * These functions handle the configuration logic for each protocol
 */

export interface ConfigurationResult {
  protocol: string;
  configured: boolean;
  details?: string;
  error?: string;
}

/**
 * Configure LayerZero trusted remotes and DVN settings
 */
export async function configureLayerZero(
  deployment: Deployment,
  otherDeployments: { [chainId: string]: Deployment },
  chainConfig: ChainConfig
): Promise<ConfigurationResult> {
  try {
    const lookCoin = await ethers.getContractAt("LookCoin", deployment.contracts.LookCoin.proxy);
    const currentLzChainId = chainConfig.layerZero.lzChainId || deployment.chainId;
    let configured = false;
    const details: string[] = [];

    for (const [chainId, otherDeployment] of Object.entries(otherDeployments)) {
      // Skip if the other deployment doesn't have LayerZero
      if (!otherDeployment.protocolsDeployed?.includes("layerZero") && 
          !otherDeployment.config?.layerZeroEndpoint) {
        continue;
      }

      const remoteLzChainId = getLayerZeroChainId(Number(chainId));
      const remoteAddress = otherDeployment.contracts.LookCoin.proxy;
      const currentTrustedRemote = await lookCoin.trustedRemoteLookup(remoteLzChainId);

      if (currentTrustedRemote === "0x") {
        console.log(`Setting trusted remote for LZ chain ${remoteLzChainId}...`);
        const encodedRemote = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [remoteAddress]
        );
        const tx = await lookCoin.setTrustedRemote(remoteLzChainId, encodedRemote);
        await tx.wait();
        details.push(`Chain ${remoteLzChainId}: ${remoteAddress}`);
        configured = true;
      }
    }

    // Configure DVN if specified
    if (chainConfig.layerZero.sendDvn || chainConfig.layerZero.receiveDvn) {
      console.log("Configuring LayerZero DVN settings...");
      
      if (chainConfig.layerZero.sendDvn && chainConfig.layerZero.sendDvn !== ethers.ZeroAddress) {
        const tx = await lookCoin.setSendDvn(chainConfig.layerZero.sendDvn);
        await tx.wait();
        details.push(`Send DVN: ${chainConfig.layerZero.sendDvn}`);
        configured = true;
      }

      if (chainConfig.layerZero.receiveDvn && chainConfig.layerZero.receiveDvn !== ethers.ZeroAddress) {
        const tx = await lookCoin.setReceiveDvn(chainConfig.layerZero.receiveDvn);
        await tx.wait();
        details.push(`Receive DVN: ${chainConfig.layerZero.receiveDvn}`);
        configured = true;
      }
    }

    return {
      protocol: "LayerZero",
      configured,
      details: configured ? `Configured: ${details.join(", ")}` : "Already configured"
    };
  } catch (error: any) {
    return {
      protocol: "LayerZero",
      configured: false,
      error: error.message
    };
  }
}

/**
 * Configure Celer remote modules, fee parameters, and rate limits
 */
export async function configureCeler(
  deployment: Deployment,
  otherDeployments: { [chainId: string]: Deployment },
  chainConfig: ChainConfig
): Promise<ConfigurationResult> {
  try {
    if (!deployment.contracts.CelerIMModule && !deployment.protocolContracts?.celerIMModule) {
      return {
        protocol: "Celer",
        configured: false,
        details: "Celer module not deployed"
      };
    }

    const celerModuleAddress = deployment.contracts.CelerIMModule?.proxy || 
                              deployment.protocolContracts?.celerIMModule;
    const celerModule = await ethers.getContractAt("CelerIMModule", celerModuleAddress!);
    const currentCelerChainId = getCelerChainId(deployment.chainId);
    let configured = false;
    const details: string[] = [];

    for (const [chainId, otherDeployment] of Object.entries(otherDeployments)) {
      // Skip if the other deployment doesn't have Celer
      if (!otherDeployment.contracts.CelerIMModule && 
          !otherDeployment.protocolContracts?.celerIMModule) {
        continue;
      }

      const remoteCelerChainId = getCelerChainId(Number(chainId));
      const remoteModuleAddress = otherDeployment.contracts.CelerIMModule?.proxy || 
                                 otherDeployment.protocolContracts?.celerIMModule;
      
      const currentRemoteModule = await celerModule.remoteModules(remoteCelerChainId);

      if (currentRemoteModule === ethers.ZeroAddress && remoteModuleAddress) {
        console.log(`Setting Celer remote module for chain ${remoteCelerChainId}...`);
        const tx = await celerModule.setRemoteModule(remoteCelerChainId, remoteModuleAddress);
        await tx.wait();
        details.push(`Chain ${remoteCelerChainId}: ${remoteModuleAddress}`);
        configured = true;
      }
    }

    // Configure fee structure
    const currentFee = await celerModule.transferFee();
    const desiredFee = ethers.parseEther("0.001"); // 0.001 LOOK per transfer
    
    if (currentFee !== desiredFee) {
      console.log("Setting Celer transfer fee...");
      const tx = await celerModule.setTransferFee(desiredFee);
      await tx.wait();
      details.push(`Transfer fee: 0.001 LOOK`);
      configured = true;
    }

    // Configure rate limits
    const currentDailyLimit = await celerModule.dailyLimit();
    const desiredDailyLimit = ethers.parseEther("1000000"); // 1M LOOK daily limit
    
    if (currentDailyLimit !== desiredDailyLimit) {
      console.log("Setting Celer daily limit...");
      const tx = await celerModule.setDailyLimit(desiredDailyLimit);
      await tx.wait();
      details.push(`Daily limit: 1M LOOK`);
      configured = true;
    }

    return {
      protocol: "Celer",
      configured,
      details: configured ? `Configured: ${details.join(", ")}` : "Already configured"
    };
  } catch (error: any) {
    return {
      protocol: "Celer",
      configured: false,
      error: error.message
    };
  }
}


/**
 * Configure XERC20 bridge registration and limits
 */
export async function configureXERC20(
  deployment: Deployment,
  otherDeployments: { [chainId: string]: Deployment },
  chainConfig: ChainConfig
): Promise<ConfigurationResult> {
  try {
    if (!deployment.protocolContracts?.xerc20Module) {
      return {
        protocol: "XERC20",
        configured: false,
        details: "XERC20 module not deployed"
      };
    }

    const xerc20Module = await ethers.getContractAt("XERC20Module", deployment.protocolContracts.xerc20Module);
    let configured = false;
    const details: string[] = [];

    // Configure bridge limits
    const currentMintLimit = await xerc20Module.mintingMaxLimitOf(deployment.protocolContracts.xerc20Module);
    const desiredMintLimit = ethers.parseEther("5000000"); // 5M LOOK mint limit
    
    if (currentMintLimit < desiredMintLimit) {
      console.log("Setting XERC20 minting limit...");
      const tx = await xerc20Module.setLimits(
        deployment.protocolContracts.xerc20Module,
        desiredMintLimit,
        desiredMintLimit // Same for burning
      );
      await tx.wait();
      details.push(`Mint/Burn limit: 5M LOOK`);
      configured = true;
    }

    // Register remote XERC20 bridges
    for (const [chainId, otherDeployment] of Object.entries(otherDeployments)) {
      if (!otherDeployment.protocolContracts?.xerc20Module) {
        continue;
      }

      const remoteChainId = Number(chainId);
      const remoteBridge = otherDeployment.protocolContracts.xerc20Module;
      
      // Check if remote bridge is registered
      const isRegistered = await xerc20Module.registeredBridges(remoteChainId, remoteBridge);
      
      if (!isRegistered) {
        console.log(`Registering XERC20 bridge for chain ${remoteChainId}...`);
        const tx = await xerc20Module.registerRemoteBridge(remoteChainId, remoteBridge);
        await tx.wait();
        details.push(`Chain ${remoteChainId}: ${remoteBridge}`);
        configured = true;
      }
    }

    return {
      protocol: "XERC20",
      configured,
      details: configured ? `Configured: ${details.join(", ")}` : "Already configured"
    };
  } catch (error: any) {
    return {
      protocol: "XERC20",
      configured: false,
      error: error.message
    };
  }
}

/**
 * Configure Hyperlane trusted senders and mailbox configuration
 */
export async function configureHyperlane(
  deployment: Deployment,
  otherDeployments: { [chainId: string]: Deployment },
  chainConfig: ChainConfig
): Promise<ConfigurationResult> {
  try {
    if (!deployment.protocolContracts?.hyperlaneModule) {
      return {
        protocol: "Hyperlane",
        configured: false,
        details: "Hyperlane module not deployed"
      };
    }

    const hyperlaneModule = await ethers.getContractAt("HyperlaneModule", deployment.protocolContracts.hyperlaneModule);
    let configured = false;
    const details: string[] = [];

    // Configure trusted senders
    for (const [chainId, otherDeployment] of Object.entries(otherDeployments)) {
      if (!otherDeployment.protocolContracts?.hyperlaneModule) {
        continue;
      }

      const remoteChainId = Number(chainId);
      const remoteSender = otherDeployment.protocolContracts.hyperlaneModule;
      
      const currentTrustedSender = await hyperlaneModule.trustedSenders(remoteChainId);
      
      if (currentTrustedSender === ethers.ZeroAddress) {
        console.log(`Setting Hyperlane trusted sender for chain ${remoteChainId}...`);
        const tx = await hyperlaneModule.setTrustedSender(remoteChainId, remoteSender);
        await tx.wait();
        details.push(`Chain ${remoteChainId}: ${remoteSender}`);
        configured = true;
      }
    }

    // Configure ISM (Interchain Security Module) if specified
    if (chainConfig.protocols?.hyperlane?.ism && 
        chainConfig.protocols.hyperlane.ism !== ethers.ZeroAddress) {
      const currentISM = await hyperlaneModule.interchainSecurityModule();
      
      if (currentISM !== chainConfig.protocols.hyperlane.ism) {
        console.log("Setting Hyperlane ISM...");
        const tx = await hyperlaneModule.setInterchainSecurityModule(chainConfig.protocols.hyperlane.ism);
        await tx.wait();
        details.push(`ISM: ${chainConfig.protocols.hyperlane.ism}`);
        configured = true;
      }
    }

    // Configure gas parameters if specified
    if (chainConfig.protocols?.hyperlane?.igp && 
        chainConfig.protocols.hyperlane.igp !== ethers.ZeroAddress) {
      console.log("Setting Hyperlane Interchain Gas Paymaster...");
      const tx = await hyperlaneModule.setInterchainGasPaymaster(chainConfig.protocols.hyperlane.igp);
      await tx.wait();
      details.push(`IGP: ${chainConfig.protocols.hyperlane.igp}`);
      configured = true;
    }

    return {
      protocol: "Hyperlane",
      configured,
      details: configured ? `Configured: ${details.join(", ")}` : "Already configured"
    };
  } catch (error: any) {
    return {
      protocol: "Hyperlane",
      configured: false,
      error: error.message
    };
  }
}

/**
 * Configure CrossChainRouter protocol registration and chain support
 */
export async function configureCrossChainRouter(
  deployment: Deployment,
  otherDeployments: { [chainId: string]: Deployment },
  chainConfig: ChainConfig
): Promise<ConfigurationResult> {
  try {
    if (!deployment.infrastructureContracts?.crossChainRouter) {
      return {
        protocol: "CrossChainRouter",
        configured: false,
        details: "CrossChainRouter not deployed"
      };
    }

    const router = await ethers.getContractAt(
      "CrossChainRouter", 
      deployment.infrastructureContracts.crossChainRouter
    );
    let configured = false;
    const details: string[] = [];

    // Register supported protocols
    const protocols = [
      { name: "LayerZero", module: deployment.contracts.LookCoin.proxy },
      { name: "Celer", module: deployment.protocolContracts?.celerIMModule },
      { name: "XERC20", module: deployment.protocolContracts?.xerc20Module },
      { name: "Hyperlane", module: deployment.protocolContracts?.hyperlaneModule }
    ];

    for (const protocol of protocols) {
      if (protocol.module) {
        const isRegistered = await router.supportedProtocols(protocol.name);
        
        if (!isRegistered) {
          console.log(`Registering ${protocol.name} with CrossChainRouter...`);
          const tx = await router.registerProtocol(protocol.name, protocol.module);
          await tx.wait();
          details.push(`${protocol.name}: ${protocol.module}`);
          configured = true;
        }
      }
    }

    // Register supported chains
    for (const [chainId, otherDeployment] of Object.entries(otherDeployments)) {
      const remoteChainId = Number(chainId);
      const isSupported = await router.supportedChains(remoteChainId);
      
      if (!isSupported) {
        console.log(`Registering chain ${remoteChainId} with CrossChainRouter...`);
        const tx = await router.addSupportedChain(remoteChainId);
        await tx.wait();
        details.push(`Chain ${remoteChainId}`);
        configured = true;
      }
    }

    return {
      protocol: "CrossChainRouter",
      configured,
      details: configured ? `Configured: ${details.join(", ")}` : "Already configured"
    };
  } catch (error: any) {
    return {
      protocol: "CrossChainRouter",
      configured: false,
      error: error.message
    };
  }
}

/**
 * Configure FeeManager protocol module updates
 */
export async function configureFeeManager(
  deployment: Deployment,
  otherDeployments: { [chainId: string]: Deployment },
  chainConfig: ChainConfig
): Promise<ConfigurationResult> {
  try {
    if (!deployment.infrastructureContracts?.feeManager) {
      return {
        protocol: "FeeManager",
        configured: false,
        details: "FeeManager not deployed"
      };
    }

    const feeManager = await ethers.getContractAt(
      "FeeManager", 
      deployment.infrastructureContracts.feeManager
    );
    let configured = false;
    const details: string[] = [];

    // Set protocol-specific fees
    const protocolFees = [
      { protocol: "LayerZero", fee: ethers.parseEther("0.01") }, // 0.01 LOOK
      { protocol: "Celer", fee: ethers.parseEther("0.001") }, // 0.001 LOOK
      { protocol: "XERC20", fee: ethers.parseEther("0") }, // Free for XERC20
      { protocol: "Hyperlane", fee: ethers.parseEther("0.002") } // 0.002 LOOK
    ];

    for (const { protocol, fee } of protocolFees) {
      const currentFee = await feeManager.protocolFees(protocol);
      
      if (currentFee !== fee) {
        console.log(`Setting fee for ${protocol}...`);
        const tx = await feeManager.setProtocolFee(protocol, fee);
        await tx.wait();
        details.push(`${protocol}: ${ethers.formatEther(fee)} LOOK`);
        configured = true;
      }
    }

    // Set fee recipient
    const currentRecipient = await feeManager.feeRecipient();
    const desiredRecipient = chainConfig.governanceVault;
    
    if (currentRecipient !== desiredRecipient) {
      console.log("Setting fee recipient...");
      const tx = await feeManager.setFeeRecipient(desiredRecipient);
      await tx.wait();
      details.push(`Recipient: ${desiredRecipient}`);
      configured = true;
    }

    return {
      protocol: "FeeManager",
      configured,
      details: configured ? `Configured: ${details.join(", ")}` : "Already configured"
    };
  } catch (error: any) {
    return {
      protocol: "FeeManager",
      configured: false,
      error: error.message
    };
  }
}

/**
 * Configure ProtocolRegistry protocol registration
 */
export async function configureProtocolRegistry(
  deployment: Deployment,
  otherDeployments: { [chainId: string]: Deployment },
  chainConfig: ChainConfig
): Promise<ConfigurationResult> {
  try {
    if (!deployment.infrastructureContracts?.protocolRegistry) {
      return {
        protocol: "ProtocolRegistry",
        configured: false,
        details: "ProtocolRegistry not deployed"
      };
    }

    const registry = await ethers.getContractAt(
      "ProtocolRegistry", 
      deployment.infrastructureContracts.protocolRegistry
    );
    let configured = false;
    const details: string[] = [];

    // Register all deployed protocols with metadata
    const protocols = [
      {
        id: "layerzero-v2",
        name: "LayerZero V2",
        protocolType: 1, // BURN_MINT
        module: deployment.contracts.LookCoin.proxy,
        metadata: ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "address"],
          ["endpoint", chainConfig.layerZero.endpoint]
        )
      },
      {
        id: "celer-im",
        name: "Celer IM",
        protocolType: 2, // LOCK_MINT
        module: deployment.protocolContracts?.celerIMModule,
        metadata: ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "address"],
          ["messageBus", chainConfig.celer.messageBus]
        )
      },
      {
        id: "xerc20",
        name: "XERC20 Standard",
        protocolType: 1, // BURN_MINT
        module: deployment.protocolContracts?.xerc20Module,
        metadata: ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "address"],
          ["factory", chainConfig.protocols?.xerc20?.factory || ethers.ZeroAddress]
        )
      },
      {
        id: "hyperlane",
        name: "Hyperlane",
        protocolType: 1, // BURN_MINT
        module: deployment.protocolContracts?.hyperlaneModule,
        metadata: ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "address"],
          ["mailbox", chainConfig.protocols?.hyperlane?.mailbox || ethers.ZeroAddress]
        )
      }
    ];

    for (const protocol of protocols) {
      if (protocol.module) {
        const isRegistered = await registry.protocols(protocol.id);
        
        if (!isRegistered.active) {
          console.log(`Registering ${protocol.name} in ProtocolRegistry...`);
          const tx = await registry.registerProtocol(
            protocol.id,
            protocol.name,
            protocol.protocolType,
            protocol.module,
            protocol.metadata
          );
          await tx.wait();
          details.push(protocol.name);
          configured = true;
        }
      }
    }

    return {
      protocol: "ProtocolRegistry",
      configured,
      details: configured ? `Registered: ${details.join(", ")}` : "Already configured"
    };
  } catch (error: any) {
    return {
      protocol: "ProtocolRegistry",
      configured: false,
      error: error.message
    };
  }
}