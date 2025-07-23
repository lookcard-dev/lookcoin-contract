/**
 * LookCoin Deployment Utilities
 *
 * This module handles deployment management for the LookCoin omnichain token.
 *
 * IMPORTANT: Why @ethereum-sourcify/bytecode-utils is required for LookCoin but not Supchad:
 *
 * LookCoin uses UUPS proxy pattern where:
 * - The proxy delegates all calls to an implementation contract
 * - Upgrades involve deploying new implementation contracts
 * - Solidity embeds metadata hashes in bytecode that change with each compilation
 * - normalizeBytecode() strips this metadata for reliable upgrade detection
 *
 * Supchad uses diamond pattern where:
 * - Contracts are deployed directly without proxy indirection
 * - Direct bytecode comparison works because there's no metadata variance
 * - No normalization needed since contracts are compared as-is
 *
 * The normalizeBytecode function is essential for LookCoin's upgrade safety checks
 * to ensure implementation contracts haven't changed unexpectedly.
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { splitAuxdata } from "@ethereum-sourcify/bytecode-utils";
import { putContract, getAllContracts } from "./state";
import { getChainConfig, getNetworkTier, getNetworkName } from "../../hardhat.config";

// Extended deployment interface with bytecode hashes
export interface Deployment {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  deploymentMode?: "standard" | "multi-protocol"; // New field
  protocolsDeployed?: string[]; // New field
  contracts: {
    LookCoin: {
      proxy: string;
      implementation?: string;
    };
    CelerIMModule?: {
      proxy: string;
      implementation?: string;
    };
    SupplyOracle: {
      proxy: string;
      implementation?: string;
    };
  };
  protocolContracts?: { // New field for protocol-specific contracts
    layerZeroModule?: string;
    celerIMModule?: string;
    xerc20Module?: string;
    hyperlaneModule?: string;
  };
  infrastructureContracts?: { // New field for multi-protocol infrastructure
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

// Migration function for legacy deployment formats
function migrateDeploymentFormat(deployment: any): Deployment {
  // If already has new fields, return as-is
  if (deployment.deploymentMode && deployment.protocolsDeployed) {
    return deployment;
  }

  // Detect deployment mode by analyzing contracts
  const hasMultipleProtocols = 
    (deployment.contracts.CelerIMModule && deployment.config?.layerZeroEndpoint) ||
    (deployment.contracts.CelerIMModule && deployment.config?.layerZeroEndpoint);

  const protocolsDeployed: string[] = [];
  const protocolContracts: any = {};

  // Detect LayerZero
  if (deployment.config?.layerZeroEndpoint && deployment.config.layerZeroEndpoint !== ethers.ZeroAddress) {
    protocolsDeployed.push("layerZero");
    protocolContracts.layerZeroModule = deployment.contracts.LookCoin.proxy;
  }

  // Detect Celer
  if (deployment.contracts.CelerIMModule) {
    protocolsDeployed.push("celer");
    protocolContracts.celerIMModule = deployment.contracts.CelerIMModule.proxy;
  }


  // Check for infrastructure contracts (these would exist in multi-protocol deployments)
  const infrastructureContracts: any = {};
  if ((deployment.contracts as any).CrossChainRouter) {
    infrastructureContracts.crossChainRouter = (deployment.contracts as any).CrossChainRouter.proxy;
  }
  if ((deployment.contracts as any).FeeManager) {
    infrastructureContracts.feeManager = (deployment.contracts as any).FeeManager.proxy;
  }
  if ((deployment.contracts as any).SecurityManager) {
    infrastructureContracts.securityManager = (deployment.contracts as any).SecurityManager.proxy;
  }
  if ((deployment.contracts as any).ProtocolRegistry) {
    infrastructureContracts.protocolRegistry = (deployment.contracts as any).ProtocolRegistry.proxy;
  }

  // Determine deployment mode
  const deploymentMode = (protocolsDeployed.length > 1 || Object.keys(infrastructureContracts).length > 0) 
    ? "multi-protocol" 
    : "standard";

  // Return migrated deployment
  return {
    ...deployment,
    deploymentMode,
    protocolsDeployed,
    protocolContracts: Object.keys(protocolContracts).length > 0 ? protocolContracts : undefined,
    infrastructureContracts: Object.keys(infrastructureContracts).length > 0 ? infrastructureContracts : undefined
  };
}

// Validation function for deployment format
export function validateDeploymentFormat(deployment: Deployment): boolean {
  // Check required fields
  if (!deployment.network || !deployment.chainId || !deployment.contracts) {
    return false;
  }

  // Check core contracts
  if (!deployment.contracts.LookCoin || !deployment.contracts.SupplyOracle) {
    return false;
  }

  // Validate deployment mode consistency
  if (deployment.deploymentMode === "multi-protocol") {
    if (!deployment.protocolsDeployed || deployment.protocolsDeployed.length <= 1) {
      console.warn("Multi-protocol mode but only one or no protocols deployed");
    }
  }

  // Validate protocol contracts consistency
  if (deployment.protocolsDeployed && deployment.protocolsDeployed.length > 0) {
    if (!deployment.protocolContracts) {
      console.warn("Protocols deployed but no protocol contracts tracked");
    }
  }

  return true;
}

// Network mapping functions

export function getLayerZeroChainId(chainId: number): number {
  const networkName = getNetworkName(chainId);
  try {
    const chainConfig = getChainConfig(networkName.toLowerCase().replace(/\s+/g, ""));
    return chainConfig.layerZero.lzChainId || chainId;
  } catch (error) {
    // Fallback to hardcoded values for backward compatibility
    const lzChainIds: { [key: number]: number } = {
      56: 30102, // BSC
      97: 40102, // BSC Testnet
      8453: 30184, // Base
      84532: 40245, // Base Sepolia
      10: 30111, // Optimism
      11155420: 40232, // Optimism Sepolia
    };
    return lzChainIds[chainId] || chainId;
  }
}

export function getCelerChainId(chainId: number): number {
  const networkName = getNetworkName(chainId);
  try {
    const chainConfig = getChainConfig(networkName.toLowerCase().replace(/\s+/g, ""));
    return chainConfig.celer.celerChainId || chainId;
  } catch (error) {
    // Fallback to hardcoded values for backward compatibility
    const celerChainIds: { [key: number]: number } = {
      56: 56, // BSC
      97: 97, // BSC Testnet
      8453: 8453, // Base
      84532: 84532, // Base Sepolia
      10: 10, // Optimism
      11155420: 11155420, // Optimism Sepolia
    };
    return celerChainIds[chainId] || chainId;
  }
}

// Network tier compatibility check
export function isCompatibleNetworkTier(currentChainId: number, targetChainId: number): boolean {
  const currentTier = getNetworkTier(currentChainId);
  const targetTier = getNetworkTier(targetChainId);

  // Unknown tiers are not compatible with anything for safety
  if (currentTier === "unknown" || targetTier === "unknown") {
    return false;
  }

  // Same tier networks are compatible
  if (currentTier === targetTier) {
    return true;
  }

  // Dev tier (Hardhat) is compatible with testnets for development purposes
  if ((currentTier === "dev" && targetTier === "testnet") || (currentTier === "testnet" && targetTier === "dev")) {
    return true;
  }

  // All other cross-tier combinations are incompatible
  return false;
}

// Deployment file management
export function getDeploymentPath(networkName: string): string {
  const deploymentsDir = path.join(__dirname, "../../deployments");
  // Use canonical CHAIN_CONFIG key format: lowercase, no spaces or dashes
  const fileName = networkName.toLowerCase().replace(/\s+/g, "") + ".json";
  return path.join(deploymentsDir, fileName);
}

export function loadDeployment(networkName: string, useLevel: boolean = false): Deployment | null {
  if (!useLevel) {
    // Default behavior - load from JSON file
    const deploymentPath = getDeploymentPath(networkName);

    if (!fs.existsSync(deploymentPath)) {
      // Check for legacy hyphenated filename for backward compatibility
      const deploymentsDir = path.join(__dirname, "../../deployments");
      const legacyFileName = networkName.toLowerCase().replace(/\s+/g, "-") + ".json";
      const legacyPath = path.join(deploymentsDir, legacyFileName);

      if (fs.existsSync(legacyPath)) {
        console.warn(`⚠️  Using legacy deployment file: ${legacyFileName}. Consider renaming to canonical format.`);
        try {
          const content = fs.readFileSync(legacyPath, "utf-8");
          const deployment = JSON.parse(content);
          return migrateDeploymentFormat(deployment);
        } catch (error) {
          console.error(`Failed to load legacy deployment from ${legacyPath}:`, error);
          return null;
        }
      }

      return null;
    }

    try {
      const content = fs.readFileSync(deploymentPath, "utf-8");
      const deployment = JSON.parse(content);
      return migrateDeploymentFormat(deployment);
    } catch (error) {
      console.error(`Failed to load deployment from ${deploymentPath}:`, error);
      return null;
    }
  }

  // Load from Level database - this would need to be async, so we keep the default sync behavior
  // for backward compatibility and add a separate async function below
  console.warn("Synchronous Level database loading not supported. Use loadDeploymentFromLevel() instead.");
  return null;
}

export async function saveDeployment(networkName: string, deployment: Deployment): Promise<void> {
  const deploymentPath = getDeploymentPath(networkName);
  const deploymentsDir = path.dirname(deploymentPath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Store each contract in Level database
  const chainId = deployment.chainId;
  for (const [contractName, contractData] of Object.entries(deployment.contracts)) {
    if (contractData && contractData.proxy) {
      await putContract(chainId, {
        contractName,
        chainId,
        networkName: deployment.network,
        address: contractData.implementation || contractData.proxy,
        factoryByteCodeHash: deployment.implementationHashes?.[contractName] || "",
        implementationHash: deployment.implementationHashes?.[contractName],
        proxyAddress: contractData.proxy,
        timestamp: Date.now(),
      });
    }
  }

  // Write to JSON file for backward compatibility
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`Deployment saved to ${deploymentPath}`);
}

export function loadOtherChainDeployments(
  currentChainId: number,
  options?: { allowCrossTier?: boolean },
): { [chainId: string]: Deployment } {
  const allowCrossTier = options?.allowCrossTier || false;
  const deployments: { [chainId: string]: Deployment } = {};
  const deploymentsDir = path.join(__dirname, "../../deployments");
  const currentTier = getNetworkTier(currentChainId);

  if (!fs.existsSync(deploymentsDir)) {
    console.warn("No deployments directory found");
    return deployments;
  }

  const files = fs.readdirSync(deploymentsDir);

  for (const file of files) {
    if (file.endsWith(".json") && !file.includes("config")) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(deploymentsDir, file), "utf-8"));
        if (content.chainId && content.chainId !== currentChainId) {
          // Check tier compatibility
          const targetTier = getNetworkTier(content.chainId);
          const isCompatible = isCompatibleNetworkTier(currentChainId, content.chainId);

          if (isCompatible || allowCrossTier) {
            deployments[content.chainId] = content;
            if (!isCompatible && allowCrossTier) {
              console.warn(
                `⚠️  Loading cross-tier deployment: ${file} (${targetTier}) from current network (${currentTier})`,
              );
            }
          } else {
            console.log(
              `Skipping incompatible deployment: ${file} - ${targetTier} tier not compatible with current ${currentTier} tier`,
            );
          }
        }
      } catch (e) {
        console.warn(`Failed to load deployment file: ${file}`);
      }
    }
  }

  return deployments;
}

// Convenience function with clearer naming
export function loadCompatibleDeployments(
  currentChainId: number,
  options?: { allowCrossTier?: boolean },
): { [chainId: string]: Deployment } {
  return loadOtherChainDeployments(currentChainId, options);
}

// Bytecode comparison utilities
export function getBytecodeHash(bytecode: string): string {
  // Split auxdata to get execution bytecode without metadata
  const [executionBytecode] = splitAuxdata(bytecode);
  // Return keccak256 hash of execution bytecode
  return ethers.keccak256(executionBytecode);
}

// New function to load deployment from Level database
export async function loadDeploymentFromLevel(chainId: number): Promise<Deployment | null> {
  try {
    const contracts = await getAllContracts(chainId);
    if (contracts.length === 0) {
      return null;
    }

    // Reconstruct deployment object from Level database entries
    const deployment: Deployment = {
      network: contracts[0].networkName,
      chainId: chainId,
      deployer: "", // This information is not stored in Level DB
      timestamp: new Date(contracts[0].timestamp).toISOString(),
      contracts: {
        LookCoin: { proxy: "" },
        SupplyOracle: { proxy: "" },
      },
      implementationHashes: {},
    };

    // Populate contracts from Level database
    for (const contract of contracts) {
      const contractEntry = {
        proxy: contract.proxyAddress || "",
        implementation: contract.address,
      };

      switch (contract.contractName) {
        case "LookCoin":
          deployment.contracts.LookCoin = contractEntry;
          break;
        case "CelerIMModule":
          deployment.contracts.CelerIMModule = contractEntry;
          break;
        case "SupplyOracle":
          deployment.contracts.SupplyOracle = contractEntry;
          break;
      }

      if (contract.implementationHash && deployment.implementationHashes) {
        deployment.implementationHashes[contract.contractName] = contract.implementationHash;
      }
    }

    return deployment;
  } catch (error) {
    console.error("Failed to load deployment from Level database:", error);
    return null;
  }
}
