import { Contract } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import path from "path";

import { getBytecodeHash } from "./deployment";
import { UnifiedJSONStateManager } from "./UnifiedJSONStateManager";
import { StateManagerFactory } from "./StateManagerFactory";
import { IStateManager, ContractType as IContractType } from "./IStateManager";

// Re-export ContractType interface for backward compatibility
export interface ContractType extends IContractType {}

// Create a singleton state manager instance
let stateManager: IStateManager | null = null;

/**
 * Get or create the state manager instance
 * Uses environment variable to determine which backend to use
 */
async function getStateManager(): Promise<IStateManager> {
  if (!stateManager) {
    const backend = process.env.STATE_BACKEND || 'unified'; // Default to unified JSON
    const isDebug = process.env.DEBUG_DEPLOYMENT === 'true';
    
    if (backend === 'unified') {
      // Use the new unified JSON state manager
      stateManager = new UnifiedJSONStateManager({
        unifiedPath: path.join(process.cwd(), 'deployments', 'unified'),
        debugMode: isDebug,
        prettyPrint: true,
        atomicWrites: true
      });
    } else if (backend === 'json') {
      // Use the standard JSON state manager
      stateManager = StateManagerFactory.create('json', {
        jsonPath: path.join(process.cwd(), 'deployments'),
        debugMode: isDebug
      });
    } else if (backend === 'leveldb') {
      // Fall back to LevelDB for backward compatibility
      console.warn('[WARNING] Using deprecated LevelDB backend. Please migrate to unified JSON.');
      stateManager = StateManagerFactory.create('leveldb', {
        dbPath: path.join(process.cwd(), 'leveldb'),
        debugMode: isDebug
      });
    } else {
      throw new Error(`Unknown state backend: ${backend}. Use 'unified', 'json', or 'leveldb'`);
    }
    
    await stateManager.initialize();
    
    if (isDebug) {
      console.log(`[DEBUG] State manager initialized with backend: ${backend}`);
    }
  }
  
  return stateManager;
}

/**
 * Get a contract from state storage
 * @param chainId - The chain ID
 * @param contractName - The contract name
 * @returns The contract data or null if not found
 */
export async function getContract(chainId: number, contractName: string): Promise<ContractType | null> {
  const manager = await getStateManager();
  const isDebug = process.env.DEBUG_DEPLOYMENT === 'true';
  
  try {
    const contract = await manager.getContract(chainId, contractName);
    if (contract && isDebug) {
      console.log(`[DEBUG] Retrieved ${contractName} from state for chain ${chainId}`);
    }
    return contract;
  } catch (error) {
    if (isDebug) {
      console.log(`[DEBUG] ${contractName} not found in state for chain ${chainId}`);
    }
    return null;
  }
}

/**
 * Store a contract in state storage
 * @param chainId - The chain ID
 * @param contract - The contract data to store
 */
export async function putContract(chainId: number, contract: ContractType): Promise<void> {
  const manager = await getStateManager();
  const isDebug = process.env.DEBUG_DEPLOYMENT === 'true';
  
  // Ensure chainId is set in the contract
  const contractWithChainId = {
    ...contract,
    chainId
  };
  
  try {
    await manager.putContract(chainId, contractWithChainId);
    if (isDebug) {
      console.log(`[DEBUG] Stored ${contract.contractName} to state for chain ${chainId}`);
      console.log(`[DEBUG]   - Implementation hash: ${contract.implementationHash}`);
    }
  } catch (error) {
    console.error(`[ERROR] Failed to store ${contract.contractName} in state:`, error);
    throw error;
  }
}

/**
 * Deploy or upgrade a proxy contract
 * @param hre - Hardhat runtime environment
 * @param contractName - Name of the contract to deploy
 * @param deploymentArgs - Constructor arguments
 * @param options - Deployment options
 * @returns The deployed contract instance
 */
export async function fetchDeployOrUpgradeProxy<T extends Contract>(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  deploymentArgs: unknown[],
  options: { initializer?: string; kind?: "uups" | "transparent" } = {},
): Promise<T> {
  const { network, ethers, upgrades } = hre;
  const chainId = network.config.chainId!;
  const networkName = network.name;

  const isDebug = process.env.DEBUG_DEPLOYMENT === 'true';
  const skipUpgradeCheck = process.env.SKIP_UPGRADE_CHECK === 'true';

  console.log(`⌛️ Processing ${contractName}...`);

  // Get the contract factory and deployed bytecode
  const factory = await ethers.getContractFactory(contractName);
  const factoryBytecode = factory.bytecode;
  const factoryBytecodeHash = getBytecodeHash(factoryBytecode);

  // Get the existing contract from state
  const existingContract = await getContract(chainId, contractName);

  if (existingContract) {
    // Contract exists - check if upgrade is needed
    const existingProxy = factory.attach(existingContract.proxyAddress || existingContract.address) as T;

    // Skip upgrade check if flag is set
    if (skipUpgradeCheck) {
      console.log(`   ✅ Skipping upgrade check for ${contractName}`);
      return existingProxy;
    }

    // Check if bytecode has changed
    const hashesMatch = existingContract.implementationHash === factoryBytecodeHash ||
                        existingContract.factoryByteCodeHash === factoryBytecodeHash;

    if (hashesMatch) {
      console.log(`   ✅ ${contractName} already deployed (unchanged)`);
      return existingProxy;
    }

    // Bytecode has changed - perform upgrade
    console.log(`   🔄 Upgrading ${contractName} implementation...`);
    
    try {
      const newImplementation = await upgrades.upgradeProxy(
        existingContract.proxyAddress || existingContract.address,
        factory,
        options
      );

      // Get the new implementation address
      const newImplAddress = await upgrades.erc1967.getImplementationAddress(
        await newImplementation.getAddress()
      );

      // Update state with new implementation
      const updatedContract: ContractType = {
        ...existingContract,
        address: newImplAddress,
        implementationHash: factoryBytecodeHash,
        factoryByteCodeHash: factoryBytecodeHash,
        timestamp: Date.now(),
      };

      await putContract(chainId, updatedContract);

      console.log(`   ✅ ${contractName} upgraded successfully`);
      console.log(`      Proxy: ${existingContract.proxyAddress || existingContract.address}`);
      console.log(`      New implementation: ${newImplAddress}`);

      return newImplementation as T;
    } catch (error) {
      console.error(`   ❌ Failed to upgrade ${contractName}:`, error);
      throw error;
    }
  } else {
    // Contract doesn't exist - deploy new
    console.log(`   📦 Deploying new ${contractName}...`);

    try {
      const proxy = await upgrades.deployProxy(factory, deploymentArgs, {
        ...options,
        kind: options.kind || "uups",
      });

      await proxy.waitForDeployment();

      const proxyAddress = await proxy.getAddress();
      const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

      // Store in state
      const newContract: ContractType = {
        contractName,
        chainId,
        networkName,
        address: implementationAddress,
        factoryByteCodeHash: factoryBytecodeHash,
        implementationHash: factoryBytecodeHash,
        proxyAddress,
        deploymentArgs,
        timestamp: Date.now(),
      };

      await putContract(chainId, newContract);

      console.log(`   ✅ ${contractName} deployed`);
      console.log(`      Proxy: ${proxyAddress}`);
      console.log(`      Implementation: ${implementationAddress}`);

      return proxy as T;
    } catch (error) {
      console.error(`   ❌ Failed to deploy ${contractName}:`, error);
      throw error;
    }
  }
}

/**
 * Export all contracts from state (for backup/migration)
 */
export async function exportAllContracts(): Promise<string> {
  const manager = await getStateManager();
  
  if ('exportAll' in manager && typeof manager.exportAll === 'function') {
    return await manager.exportAll({ format: 'json', prettyPrint: true });
  }
  
  throw new Error('Current state manager does not support export');
}

/**
 * Get all contracts for a specific chain
 */
export async function getAllContracts(chainId: number): Promise<ContractType[]> {
  const manager = await getStateManager();
  return await manager.getAllContracts(chainId);
}

/**
 * Close the state manager (cleanup)
 */
export async function closeStateManager(): Promise<void> {
  if (stateManager) {
    await stateManager.close();
    stateManager = null;
  }
}

// Export the ContractType for backward compatibility
export type { IStateManager };