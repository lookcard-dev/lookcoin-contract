import { Level } from "level";
import { Contract } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import path from "path";

import { getBytecodeHash } from "./deployment";

interface ContractType {
  contractName: string;
  chainId: number;
  networkName: string;
  address: string;
  factoryByteCodeHash: string;
  implementationHash?: string;
  proxyAddress?: string;
  deploymentArgs?: any[];
  timestamp: number;
}

let db: Level<string, ContractType>;

async function createDatabase(): Promise<Level<string, ContractType>> {
  if (!db) {
    const dbPath = path.join(process.cwd(), "leveldb");
    db = new Level<string, ContractType>(dbPath, {
      valueEncoding: "json",
      createIfMissing: true,
    });
    await db.open();
  }
  return db;
}

export async function getContract(chainId: number, contractName: string): Promise<ContractType | null> {
  const database = await createDatabase();
  const key = `${chainId}-${contractName}`;
  const isDebug = process.env.DEBUG_DEPLOYMENT === 'true';

  try {
    const contract = await database.get(key);
    if (isDebug) {
      console.log(`[DEBUG] Retrieved ${contractName} from LevelDB for chain ${chainId}`);
    }
    return contract;
  } catch (error: any) {
    if (error.code === "LEVEL_NOT_FOUND") {
      if (isDebug) {
        console.log(`[DEBUG] ${contractName} not found in LevelDB for chain ${chainId}`);
      }
      return null;
    }
    console.error(`[ERROR] LevelDB error retrieving ${contractName}:`, error);
    throw error;
  }
}

export async function putContract(chainId: number, contract: ContractType): Promise<void> {
  const database = await createDatabase();
  const key = `${chainId}-${contract.contractName}`;
  const isDebug = process.env.DEBUG_DEPLOYMENT === 'true';
  
  // Convert BigInt values to strings for serialization
  const serializedContract = {
    ...contract,
    deploymentArgs: contract.deploymentArgs?.map(arg => 
      typeof arg === 'bigint' ? arg.toString() : arg
    )
  };
  
  try {
    await database.put(key, serializedContract);
    if (isDebug) {
      console.log(`[DEBUG] Stored ${contract.contractName} to LevelDB for chain ${chainId}`);
      console.log(`[DEBUG]   - Key: ${key}`);
      console.log(`[DEBUG]   - Implementation hash: ${contract.implementationHash}`);
    }
  } catch (error) {
    console.error(`[ERROR] Failed to store ${contract.contractName} in LevelDB:`, error);
    throw error;
  }
}

export async function fetchDeployOrUpgradeProxy<T extends Contract>(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  deploymentArgs: any[],
  options: { initializer?: string; kind?: "uups" | "transparent" } = {},
): Promise<T> {
  const { network, ethers, upgrades } = hre;
  const chainId = network.config.chainId!;
  const networkName = network.name;

  const isDebug = process.env.DEBUG_DEPLOYMENT === 'true';
  const skipUpgradeCheck = process.env.SKIP_UPGRADE_CHECK === 'true';

  console.log(`⌛️ Processing ${contractName}...`);

  // Get the contract factory
  const factory = await ethers.getContractFactory(contractName);
  const factoryBytecodeHash = getBytecodeHash(factory.bytecode);

  if (isDebug) {
    console.log(`[DEBUG] ${contractName} factory bytecode hash: ${factoryBytecodeHash}`);
  }

  // Check if contract exists in database
  let existingContract: ContractType | null = null;
  try {
    existingContract = await getContract(chainId, contractName);
    if (isDebug && existingContract) {
      console.log(`[DEBUG] Found existing ${contractName} in LevelDB:`);
      console.log(`[DEBUG]   - Proxy: ${existingContract.proxyAddress}`);
      console.log(`[DEBUG]   - Implementation hash: ${existingContract.implementationHash}`);
      console.log(`[DEBUG]   - Factory hash: ${existingContract.factoryByteCodeHash}`);
      console.log(`[DEBUG]   - Deployed at: ${new Date(existingContract.timestamp).toISOString()}`);
    } else if (isDebug) {
      console.log(`[DEBUG] No existing ${contractName} found in LevelDB`);
    }
  } catch (error) {
    console.error(`[ERROR] Failed to retrieve ${contractName} from LevelDB:`, error);
    // Continue with deployment if retrieval fails
  }

  if (existingContract && existingContract.proxyAddress) {
    // Contract exists, check if bytecode has changed
    const hashesMatch = existingContract.implementationHash === factoryBytecodeHash;
    
    if (isDebug) {
      console.log(`[DEBUG] Hash comparison for ${contractName}:`);
      console.log(`[DEBUG]   - Existing implementation hash: ${existingContract.implementationHash}`);
      console.log(`[DEBUG]   - Current factory bytecode hash: ${factoryBytecodeHash}`);
      console.log(`[DEBUG]   - Hashes match: ${hashesMatch}`);
      console.log(`[DEBUG]   - Skip upgrade check: ${skipUpgradeCheck}`);
    }

    if (hashesMatch || skipUpgradeCheck) {
      if (skipUpgradeCheck && !hashesMatch) {
        console.log(`⚠️  ${contractName} bytecode changed but upgrade skipped (SKIP_UPGRADE_CHECK=true)`);
      } else {
        console.log(`✅ ${contractName} already deployed with same bytecode at ${existingContract.proxyAddress}`);
      }
      return factory.attach(existingContract.proxyAddress) as T;
    }

    // Bytecode has changed, upgrade the proxy
    console.log(`🔄 ${contractName} bytecode changed, upgrading proxy...`);
    if (isDebug) {
      console.log(`[DEBUG] Initiating proxy upgrade for ${contractName} at ${existingContract.proxyAddress}`);
    }

    try {
      const upgraded = await upgrades.upgradeProxy(existingContract.proxyAddress, factory, {
        kind: options.kind || "uups",
      });

      await upgraded.waitForDeployment();
      const implementationAddress = await upgrades.erc1967.getImplementationAddress(await upgraded.getAddress());

      // Update the contract in database
      const updatedContract: ContractType = {
        ...existingContract,
        address: implementationAddress,
        factoryByteCodeHash: factoryBytecodeHash,
        implementationHash: factoryBytecodeHash,
        timestamp: Date.now(),
      };

      if (isDebug) {
        console.log(`[DEBUG] Storing updated ${contractName} to LevelDB with new implementation hash: ${factoryBytecodeHash}`);
      }

      await putContract(chainId, updatedContract);
      console.log(
        `✅ ${contractName} upgraded at proxy: ${existingContract.proxyAddress}, new implementation: ${implementationAddress}`,
      );

      return upgraded as T;
    } catch (error) {
      console.error(`[ERROR] Failed to upgrade ${contractName}:`, error);
      throw error;
    }
  }

  // Contract doesn't exist, deploy new proxy
  console.log(`🚀 Deploying new ${contractName} proxy...`);
  if (isDebug) {
    console.log(`[DEBUG] Deploying with args:`, deploymentArgs);
  }

  try {
    const deployed = await upgrades.deployProxy(factory, deploymentArgs, {
      initializer: options.initializer || "initialize",
      kind: options.kind || "uups",
    });

    await deployed.waitForDeployment();
    const proxyAddress = await deployed.getAddress();
    const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

    // Store the new contract in database
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

    if (isDebug) {
      console.log(`[DEBUG] Storing new ${contractName} to LevelDB:`);
      console.log(`[DEBUG]   - Proxy: ${proxyAddress}`);
      console.log(`[DEBUG]   - Implementation: ${implementationAddress}`);
      console.log(`[DEBUG]   - Implementation hash: ${factoryBytecodeHash}`);
    }

    await putContract(chainId, newContract);
    console.log(`✅ ${contractName} deployed at proxy: ${proxyAddress}, implementation: ${implementationAddress}`);

    return deployed as T;
  } catch (error) {
    console.error(`[ERROR] Failed to deploy ${contractName}:`, error);
    throw error;
  }
}

export async function getAllContracts(chainId: number): Promise<ContractType[]> {
  const database = await createDatabase();
  const contracts: ContractType[] = [];

  for await (const [key, value] of database.iterator()) {
    if (key.startsWith(`${chainId}-`)) {
      contracts.push(value);
    }
  }

  return contracts;
}
