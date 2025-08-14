/**
 * Unified Deployment Utilities
 * 
 * This module provides utilities for loading and working with both legacy and unified deployment formats.
 * It acts as a bridge between the old deployment structure and the new unified JSON schema.
 */

import * as fs from "fs";
import * as path from "path";
import { UnifiedDeployment, isUnifiedDeployment } from "../../schemas/unified-deployment-schema";

// Local implementation of getNetworkTier
function getNetworkTier(chainId: number): "mainnet" | "testnet" | "dev" | "unknown" {
  // Mainnet chain IDs
  const mainnetChainIds = [56, 8453, 10, 23294, 9070]; // BSC, Base, Optimism, Sapphire, Akashic
  if (mainnetChainIds.includes(chainId)) {
    return "mainnet";
  }

  // Testnet chain IDs
  const testnetChainIds = [97, 84532, 11155420, 23295]; // BSC Testnet, Base Sepolia, Optimism Sepolia, Sapphire Testnet
  if (testnetChainIds.includes(chainId)) {
    return "testnet";
  }

  // Hardhat network
  if (chainId === 31337) {
    return "dev";
  }

  return "unknown";
}

// Legacy Deployment interface (for backward compatibility)
export interface Deployment {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  deploymentMode?: "standard" | "multi-protocol";
  protocolsDeployed?: string[];
  protocolContracts?: {
    layerZeroModule?: string;
    celerIMModule?: string;
    hyperlaneModule?: string;
  };
  contracts: {
    LookCoin: {
      address: string;
      proxy: string;
    };
    SupplyOracle: {
      address: string;
      proxy: string;
    };
    CelerIMModule?: {
      address: string;
      proxy: string;
    };
    [key: string]: unknown;
  };
  infrastructureContracts?: {
    crossChainRouter?: string;
    feeManager?: string;
    securityManager?: string;
    protocolRegistry?: string;
  };
  config?: {
    governanceVault?: string;
    layerZeroEndpoint?: string;
    celerMessageBus?: string;
  };
  implementationHashes?: {
    [contractName: string]: string;
  };
  lastDeployed?: string;
  lastUpgraded?: string;
}

/**
 * Convert unified deployment to legacy format for backward compatibility
 */
function convertUnifiedToLegacy(unified: UnifiedDeployment): Deployment {
  const contracts: Record<string, { address: string; proxy: string }> = {
    LookCoin: {
      address: unified.contracts.core.LookCoin.implementation || unified.contracts.core.LookCoin.address,
      proxy: unified.contracts.core.LookCoin.proxy || unified.contracts.core.LookCoin.address
    },
    SupplyOracle: {
      address: unified.contracts.core.SupplyOracle.implementation || unified.contracts.core.SupplyOracle.address,
      proxy: unified.contracts.core.SupplyOracle.proxy || unified.contracts.core.SupplyOracle.address
    }
  };

  // Add protocol contracts
  if (unified.contracts.protocol) {
    for (const [name, contract] of Object.entries(unified.contracts.protocol)) {
      contracts[name] = {
        address: contract.implementation || contract.address,
        proxy: contract.proxy || contract.address
      };
    }
  }

  // Add infrastructure contracts as regular contracts for backward compatibility
  if (unified.contracts.infrastructure) {
    for (const [name, contract] of Object.entries(unified.contracts.infrastructure)) {
      contracts[name] = {
        address: contract.implementation || contract.address,
        proxy: contract.proxy || contract.address
      };
    }
  }

  // Extract protocol contracts
  const protocolContracts: Record<string, string> = {};
  if (unified.contracts.protocol?.LayerZeroModule) {
    protocolContracts.layerZeroModule = unified.contracts.protocol.LayerZeroModule.proxy;
  }
  if (unified.contracts.protocol?.CelerIMModule) {
    protocolContracts.celerIMModule = unified.contracts.protocol.CelerIMModule.proxy;
  }

  // Extract infrastructure contracts
  const infrastructureContracts: Record<string, string> = {};
  if (unified.contracts.infrastructure?.CrossChainRouter) {
    infrastructureContracts.crossChainRouter = unified.contracts.infrastructure.CrossChainRouter.proxy;
  }
  if (unified.contracts.infrastructure?.FeeManager) {
    infrastructureContracts.feeManager = unified.contracts.infrastructure.FeeManager.proxy;
  }
  if (unified.contracts.infrastructure?.SecurityManager) {
    infrastructureContracts.securityManager = unified.contracts.infrastructure.SecurityManager.proxy;
  }
  if (unified.contracts.infrastructure?.ProtocolRegistry) {
    infrastructureContracts.protocolRegistry = unified.contracts.infrastructure.ProtocolRegistry.proxy;
  }

  // Build config
  const config: Record<string, unknown> = {
    governanceVault: unified.configuration.governance.vault
  };

  if (unified.configuration.protocols?.layerZero) {
    config.layerZeroEndpoint = unified.configuration.protocols.layerZero.endpoint;
  }
  if (unified.configuration.protocols?.celer) {
    config.celerMessageBus = unified.configuration.protocols.celer.messageBus;
  }

  return {
    network: unified.network,
    chainId: unified.chainId,
    deployer: unified.metadata.deployer,
    timestamp: unified.metadata.timestamp,
    deploymentMode: unified.metadata.deploymentMode as "standard" | "multi-protocol",
    protocolsDeployed: unified.metadata.protocolsDeployed,
    protocolContracts: Object.keys(protocolContracts).length > 0 ? protocolContracts : undefined,
    contracts,
    infrastructureContracts: Object.keys(infrastructureContracts).length > 0 ? infrastructureContracts : undefined,
    config,
    implementationHashes: unified.verification?.implementationHashes,
    lastDeployed: unified.metadata.timestamp,
    lastUpgraded: unified.metadata.lastUpdated
  };
}

/**
 * Load deployment from either legacy or unified format
 */
export function loadDeployment(networkNameOrPath: string): Deployment | null {
  // If it's a file path, handle as direct file load
  if (networkNameOrPath.includes('/') || networkNameOrPath.includes('\\') || networkNameOrPath.endsWith('.json')) {
    if (!fs.existsSync(networkNameOrPath)) {
      return null;
    }
    try {
      const data = fs.readFileSync(networkNameOrPath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Check if it's unified format
      if (isUnifiedDeployment(parsed)) {
        return convertUnifiedToLegacy(parsed);
      }
      
      return parsed;
    } catch (error) {
      console.error(`Error loading deployment from ${networkNameOrPath}:`, error);
      return null;
    }
  }
  
  const networkName = networkNameOrPath;
  const deploymentsDir = path.join(__dirname, "../../deployments");
  
  // First, try to load from unified format
  const unifiedPath = path.join(deploymentsDir, "unified", `${networkName.toLowerCase().replace(/\s+/g, "")}.unified.json`);
  if (fs.existsSync(unifiedPath)) {
    try {
      const content = fs.readFileSync(unifiedPath, "utf-8");
      const unified = JSON.parse(content);
      
      if (isUnifiedDeployment(unified)) {
        console.log(`📁 Loaded unified deployment from ${path.basename(unifiedPath)}`);
        return convertUnifiedToLegacy(unified);
      }
    } catch (error) {
      console.warn(`Failed to load unified deployment from ${unifiedPath}:`, error);
    }
  }
  
  // Fallback to legacy JSON format
  const legacyPath = path.join(deploymentsDir, `${networkName.toLowerCase().replace(/\s+/g, "")}.json`);
  if (fs.existsSync(legacyPath)) {
    try {
      console.log(`📁 Loaded legacy deployment from ${path.basename(legacyPath)}`);
      const content = fs.readFileSync(legacyPath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.error(`Failed to load legacy deployment from ${legacyPath}:`, error);
      return null;
    }
  }
  
  // Check for hyphenated legacy filename
  const hyphenatedPath = path.join(deploymentsDir, `${networkName.toLowerCase().replace(/\s+/g, "-")}.json`);
  if (fs.existsSync(hyphenatedPath)) {
    try {
      console.warn(`⚠️  Using legacy hyphenated deployment file: ${path.basename(hyphenatedPath)}`);
      const content = fs.readFileSync(hyphenatedPath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.error(`Failed to load deployment from ${hyphenatedPath}:`, error);
      return null;
    }
  }
  
  return null;
}

/**
 * Load deployments from other chains for cross-chain configuration
 */
export function loadOtherChainDeployments(
  currentChainId: number,
  options: { allowCrossTier?: boolean } = {}
): { [chainId: string]: Deployment } {
  const currentTier = getNetworkTier(currentChainId);
  const deployments: { [chainId: string]: Deployment } = {};
  const deploymentsDir = path.join(__dirname, "../../deployments");
  
  // First check unified directory
  const unifiedDir = path.join(deploymentsDir, "unified");
  if (fs.existsSync(unifiedDir)) {
    const unifiedFiles = fs.readdirSync(unifiedDir).filter(f => f.endsWith('.unified.json'));
    
    for (const file of unifiedFiles) {
      try {
        const content = fs.readFileSync(path.join(unifiedDir, file), 'utf-8');
        const data = JSON.parse(content);
        
        if (isUnifiedDeployment(data) && data.chainId !== currentChainId) {
          const remoteTier = getNetworkTier(data.chainId);
          
          // Check tier compatibility
          if (!options.allowCrossTier && remoteTier !== currentTier && remoteTier !== "dev" && currentTier !== "dev") {
            console.log(`⚠️  Skipping ${data.network} (different tier: ${remoteTier} vs ${currentTier})`);
            continue;
          }
          
          deployments[data.chainId.toString()] = convertUnifiedToLegacy(data);
          console.log(`📁 Loaded ${data.network} deployment from unified format`);
        }
      } catch (error) {
        console.warn(`Failed to load ${file}:`, error);
      }
    }
  }
  
  // Then check legacy deployments
  const files = fs.readdirSync(deploymentsDir).filter(f => f.endsWith('.json') && !f.includes('unified'));
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(deploymentsDir, file), 'utf-8');
      const deployment = JSON.parse(content);
      
      if (deployment.chainId && deployment.chainId !== currentChainId) {
        // Skip if already loaded from unified
        if (deployments[deployment.chainId.toString()]) {
          continue;
        }
        
        const remoteTier = getNetworkTier(deployment.chainId);
        
        // Check tier compatibility
        if (!options.allowCrossTier && remoteTier !== currentTier && remoteTier !== "dev" && currentTier !== "dev") {
          console.log(`⚠️  Skipping ${deployment.network} (different tier: ${remoteTier} vs ${currentTier})`);
          continue;
        }
        
        deployments[deployment.chainId.toString()] = deployment;
        console.log(`📁 Loaded ${deployment.network} deployment from legacy format`);
      }
    } catch (error) {
      console.warn(`Failed to load ${file}:`, error);
    }
  }
  
  return deployments;
}

// Re-export other functions from original deployment.ts that don't need changes
export { 
  validateDeploymentFormat,
  getLayerZeroChainId,
  getCelerChainId,
  isCompatibleNetworkTier,
  getDeploymentPath,
  saveDeployment,
  getBytecodeHash
} from "./deployment";