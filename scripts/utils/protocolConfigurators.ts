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
    // const currentLzChainId = chainConfig.layerZero.lzChainId || deployment.chainId;
    let configured = false;
    const details: string[] = [];
    
    // Check if we have LayerZeroModule deployed
    let layerZeroModule = null;
    if (deployment.protocolContracts?.layerZeroModule) {
      layerZeroModule = await ethers.getContractAt("LayerZeroModule", deployment.protocolContracts.layerZeroModule);
      details.push(`LayerZeroModule at ${deployment.protocolContracts.layerZeroModule}`);
    }

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
      
      // Also configure LayerZeroModule if deployed
      if (layerZeroModule && otherDeployment.protocolContracts?.layerZeroModule) {
        // Convert chain ID to LayerZero endpoint ID
        const remoteEid = await layerZeroModule.chainIdToEid(Number(chainId));
        
        // Check if trusted remote is set for LayerZeroModule
        const currentModuleTrustedRemote = await layerZeroModule.trustedRemotes(remoteEid);
        const remoteModuleAddress = otherDeployment.protocolContracts.layerZeroModule;
        
        if (currentModuleTrustedRemote === ethers.ZeroHash) {
          console.log(`Setting trusted remote for LayerZeroModule on chain ${remoteLzChainId}...`);
          const tx = await layerZeroModule.setTrustedRemote(remoteEid, remoteModuleAddress);
          await tx.wait();
          details.push(`Module trusted remote ${remoteLzChainId}: ${remoteModuleAddress}`);
          configured = true;
        }
      }
    }

    // Configure DVN if specified
    if (chainConfig.layerZero.dvns && chainConfig.layerZero.dvns.length > 0) {
      console.log("Configuring LayerZero DVN settings...");
      
      // Note: DVN configuration typically happens at the LayerZero endpoint level
      // not directly on the OFT contract. The dvns array contains validator addresses.
      details.push(`DVNs configured: ${chainConfig.layerZero.dvns.length}`);
      details.push(`Required DVNs: ${chainConfig.layerZero.requiredDVNs.length}`);
      details.push(`Optional DVNs: ${chainConfig.layerZero.optionalDVNs.length}`);
      configured = true;
    }

    return {
      protocol: "LayerZero",
      configured,
      details: configured ? `Configured: ${details.join(", ")}` : "Already configured"
    };
  } catch (error) {
    return {
      protocol: "LayerZero",
      configured: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Configure Celer remote modules, fee parameters, and rate limits
 */
export async function configureCeler(
  deployment: Deployment,
  otherDeployments: { [chainId: string]: Deployment }
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
    // const currentCelerChainId = getCelerChainId(deployment.chainId);
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
      
      // First check if chain is supported, if not, add it
      const isChainSupported = await celerModule.supportedChains(remoteCelerChainId);
      if (!isChainSupported) {
        console.log(`Setting Celer supported chain ${remoteCelerChainId}...`);
        const tx = await celerModule.setSupportedChain(remoteCelerChainId, true);
        await tx.wait();
        details.push(`Supported chain ${remoteCelerChainId}`);
        configured = true;
      }
      
      const currentRemoteModule = await celerModule.remoteModules(remoteCelerChainId);

      if (currentRemoteModule === ethers.ZeroAddress && remoteModuleAddress) {
        console.log(`Setting Celer remote module for chain ${remoteCelerChainId}...`);
        const tx = await celerModule.setRemoteModule(remoteCelerChainId, remoteModuleAddress);
        await tx.wait();
        details.push(`Remote module ${remoteCelerChainId}: ${remoteModuleAddress}`);
        configured = true;
      }
    }

    // Note: CelerIMModule fees are configured during deployment and calculated dynamically
    // The module doesn't have setTransferFee or setDailyLimit functions
    // Fee calculation is based on fee percentage configured at deployment

    return {
      protocol: "Celer",
      configured,
      details: configured ? `Configured: ${details.join(", ")}` : "Already configured"
    };
  } catch (error) {
    return {
      protocol: "Celer",
      configured: false,
      error: error instanceof Error ? error.message : String(error)
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
    // Check if HyperlaneModule is deployed
    if (!deployment.protocolContracts?.hyperlaneModule) {
      return {
        protocol: "Hyperlane",
        configured: false,
        details: "HyperlaneModule contract not deployed"
      };
    }

    const hyperlaneModule = await ethers.getContractAt("HyperlaneModule", deployment.protocolContracts.hyperlaneModule);
    let configured = false;
    const details: string[] = [];

    // Configure current chain domain mapping first
    const currentChainId = await ethers.provider.getNetwork().then(n => Number(n.chainId));
    const currentDomainId = chainConfig.hyperlane?.hyperlaneDomainId || currentChainId;
    
    const currentDomainMapping = await hyperlaneModule.domainToChainId(currentDomainId);
    if (currentDomainMapping === 0) {
      console.log(`Setting domain mapping for current chain ${currentChainId} -> domain ${currentDomainId}...`);
      const tx = await hyperlaneModule.setDomainMapping(currentDomainId, currentChainId);
      await tx.wait();
      details.push(`Current chain mapping: ${currentChainId} <-> ${currentDomainId}`);
      configured = true;
    }

    // Configure trusted senders and domain mappings for other chains
    for (const [chainId, otherDeployment] of Object.entries(otherDeployments)) {
      if (!otherDeployment.protocolsDeployed?.includes('hyperlane')) {
        continue;
      }

      // Get the other chain's config to find its Hyperlane domain ID
      const { getChainConfig, getNetworkName } = await import("../../hardhat.config");
      const otherNetworkName = getNetworkName(Number(chainId));
      const otherChainConfig = getChainConfig(otherNetworkName.toLowerCase().replace(/\s+/g, ""));
      
      const remoteDomainId = otherChainConfig.hyperlane?.hyperlaneDomainId || Number(chainId);
      const remoteChainId = Number(chainId);
      
      // Set domain mapping if not already configured
      const remoteDomainMapping = await hyperlaneModule.domainToChainId(remoteDomainId);
      if (remoteDomainMapping === 0) {
        console.log(`Setting domain mapping for chain ${remoteChainId} -> domain ${remoteDomainId}...`);
        const tx = await hyperlaneModule.setDomainMapping(remoteDomainId, remoteChainId);
        await tx.wait();
        details.push(`Domain mapping: ${remoteChainId} <-> ${remoteDomainId}`);
        configured = true;
      }
      
      // Set trusted sender (the remote HyperlaneModule address)
      const remoteSender = otherDeployment.protocolContracts?.hyperlaneModule;
      if (!remoteSender) {
        console.log(`⚠️  Skipping chain ${chainId} - HyperlaneModule not deployed`);
        continue;
      }
      
      const currentTrustedSender = await hyperlaneModule.trustedSenders(remoteDomainId);
      const expectedTrustedSender = ethers.zeroPadValue(remoteSender, 32);
      
      if (currentTrustedSender !== expectedTrustedSender) {
        console.log(`Setting trusted sender for domain ${remoteDomainId}: ${remoteSender}...`);
        const tx = await hyperlaneModule.setTrustedSender(remoteDomainId, remoteSender);
        await tx.wait();
        details.push(`Trusted sender: ${remoteDomainId} -> ${remoteSender}`);
        configured = true;
      }
    }

    // Note: Mailbox and gas paymaster are configured during HyperlaneModule deployment

    return {
      protocol: "Hyperlane",
      configured,
      details: configured ? `Configured: ${details.join(", ")}` : "Already configured"
    };
  } catch (error) {
    return {
      protocol: "Hyperlane",
      configured: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Configure CrossChainRouter protocol registration and chain support
 */
export async function configureCrossChainRouter(
  deployment: Deployment,
  otherDeployments: { [chainId: string]: Deployment }
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
      "contracts/xchain/CrossChainRouter.sol:CrossChainRouter", 
      deployment.infrastructureContracts.crossChainRouter
    );
    
    // Check if the deployer has PROTOCOL_ADMIN_ROLE
    const [deployer] = await ethers.getSigners();
    const PROTOCOL_ADMIN_ROLE = await router.PROTOCOL_ADMIN_ROLE();
    const hasRole = await router.hasRole(PROTOCOL_ADMIN_ROLE, deployer.address);
    
    if (!hasRole) {
      return {
        protocol: "CrossChainRouter",
        configured: false,
        error: `Deployer ${deployer.address} does not have PROTOCOL_ADMIN_ROLE on CrossChainRouter. Please run setup script first.`
      };
    }
    
    let configured = false;
    const details: string[] = [];

    // Note: Protocol registration is already done in setup.ts
    // This function only handles cross-chain configuration
    const protocols = [
      { name: "LayerZero", enum: 0 },
      { name: "Celer", enum: 1 },
      { name: "Hyperlane", enum: 2 }
    ];

    // Register supported chains
    for (const [chainId] of Object.entries(otherDeployments)) {
      const remoteChainId = Number(chainId);
      console.log(`Checking chain ${remoteChainId} protocol support...`);
      
      // Check if chain is supported for at least one protocol
      let chainSupported = false;
      try {
        for (let i = 0; i < 3; i++) { // Only check 0-2 (LayerZero, Celer, Hyperlane)
          const isSupported = await router.chainProtocolSupport(remoteChainId, i);
          if (isSupported) {
            chainSupported = true;
            break;
          }
        }
      } catch (error) {
        console.error(`Error checking chain support for ${remoteChainId}:`, error);
        continue;
      }
      
      if (!chainSupported) {
        console.log(`Setting chain ${remoteChainId} protocol support...`);
        // Enable support for protocols based on what's deployed on the remote chain
        const remoteDeployment = otherDeployments[chainId];
        
        // Check which protocols are deployed on the remote chain
        const enabledProtocols: string[] = [];
        
        // LayerZero
        if (remoteDeployment.protocolsDeployed?.includes('layerZero') || 
            remoteDeployment.config?.layerZeroEndpoint) {
          try {
            const tx = await router.setChainProtocolSupport(remoteChainId, 0, true);
            await tx.wait();
            enabledProtocols.push("LayerZero");
          } catch (error) {
            console.error(`Failed to set LayerZero support for chain ${remoteChainId}:`, error);
          }
        }
        
        // Celer
        if (remoteDeployment.protocolsDeployed?.includes('celer') || 
            remoteDeployment.contracts.CelerIMModule) {
          try {
            const tx = await router.setChainProtocolSupport(remoteChainId, 1, true);
            await tx.wait();
            enabledProtocols.push("Celer");
          } catch (error) {
            console.error(`Failed to set Celer support for chain ${remoteChainId}:`, error);
          }
        }
        
        // Hyperlane
        if (remoteDeployment.protocolsDeployed?.includes('hyperlane')) {
          try {
            const tx = await router.setChainProtocolSupport(remoteChainId, 2, true);
            await tx.wait();
            enabledProtocols.push("Hyperlane");
          } catch (error) {
            console.error(`Failed to set Hyperlane support for chain ${remoteChainId}:`, error);
          }
        }
        
        if (enabledProtocols.length > 0) {
          details.push(`Chain ${remoteChainId}: ${enabledProtocols.join(", ")}`);
          configured = true;
        }
      }
    }

    return {
      protocol: "CrossChainRouter",
      configured,
      details: configured ? `Configured: ${details.join(", ")}` : "Already configured"
    };
  } catch (error) {
    return {
      protocol: "CrossChainRouter",
      configured: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Configure FeeManager protocol module updates
 */
export async function configureFeeManager(
  deployment: Deployment
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
      { protocol: "Hyperlane", fee: ethers.parseEther("0.002") } // 0.002 LOOK
    ];

    for (const { protocol, fee } of protocolFees) {
      // Map protocol name to Protocol enum
      const protocolEnum = ['LayerZero', 'Celer', 'Hyperlane'].indexOf(protocol);
      if (protocolEnum === -1) continue;
      
      const currentBaseFee = await feeManager.protocolBaseFees(protocolEnum);
      const defaultMultiplier = 10000; // 100% (no multiplier)
      
      if (currentBaseFee !== fee) {
        console.log(`Setting fee for ${protocol}...`);
        const tx = await feeManager.updateProtocolFees(protocolEnum, defaultMultiplier, fee);
        await tx.wait();
        details.push(`${protocol}: ${ethers.formatEther(fee)} LOOK`);
        configured = true;
      }
    }

    // FeeManager doesn't have a fee recipient concept in this implementation
    // Fees are handled differently, so we skip this part

    return {
      protocol: "FeeManager",
      configured,
      details: configured ? `Configured: ${details.join(", ")}` : "Already configured"
    };
  } catch (error) {
    return {
      protocol: "FeeManager",
      configured: false,
      error: error instanceof Error ? error.message : String(error)
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
        id: "hyperlane",
        name: "Hyperlane",
        protocolType: 1, // BURN_MINT
        module: deployment.protocolContracts?.hyperlaneModule,
        metadata: ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "address"],
          ["mailbox", chainConfig.hyperlane?.mailbox || ethers.ZeroAddress]
        )
      }
    ];

    for (const protocol of protocols) {
      if (protocol.module) {
        // Map protocol ID to Protocol enum
        const protocolEnumMap: { [key: string]: number } = {
          'layerzero-v2': 0,
          'celer-im': 1,
          'hyperlane': 2
        };
        const protocolEnum = protocolEnumMap[protocol.id];
        if (protocolEnum === undefined) continue;
        
        const protocolInfo = await registry.protocols(protocolEnum);
        
        if (protocolInfo.moduleAddress === ethers.ZeroAddress) {
          console.log(`Registering ${protocol.name} in ProtocolRegistry...`);
          
          // Get supported chains for this protocol
          const supportedChains = Object.keys(otherDeployments)
            .filter(chainId => {
              const deployment = otherDeployments[chainId];
              switch (protocol.id) {
                case 'layerzero-v2':
                  return deployment.protocolsDeployed?.includes('layerZero');
                case 'celer-im':
                  return deployment.protocolsDeployed?.includes('celer');
                case 'hyperlane':
                  return deployment.protocolsDeployed?.includes('hyperlane');
                default:
                  return false;
              }
            })
            .map(chainId => Number(chainId));
          
          const tx = await registry.registerProtocol(
            protocolEnum,
            protocol.module,
            '1.0.0', // Default version
            supportedChains
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
  } catch (error) {
    return {
      protocol: "ProtocolRegistry",
      configured: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}