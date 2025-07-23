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

  try {
    return await database.get(key);
  } catch (error: any) {
    if (error.code === "LEVEL_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

export async function putContract(chainId: number, contract: ContractType): Promise<void> {
  const database = await createDatabase();
  const key = `${chainId}-${contract.contractName}`;
  
  // Convert BigInt values to strings for serialization
  const serializedContract = {
    ...contract,
    deploymentArgs: contract.deploymentArgs?.map(arg => 
      typeof arg === 'bigint' ? arg.toString() : arg
    )
  };
  
  await database.put(key, serializedContract);
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

  console.log(`⌛️ Processing ${contractName}...`);

  // Get the contract factory
  const factory = await ethers.getContractFactory(contractName);
  const factoryBytecodeHash = getBytecodeHash(factory.bytecode);

  // Check if contract exists in database
  const existingContract = await getContract(chainId, contractName);

  if (existingContract && existingContract.proxyAddress) {
    // Contract exists, check if bytecode has changed
    if (existingContract.implementationHash === factoryBytecodeHash) {
      console.log(`✅ ${contractName} already deployed with same bytecode at ${existingContract.proxyAddress}`);
      return factory.attach(existingContract.proxyAddress) as T;
    }

    // Bytecode has changed, upgrade the proxy
    console.log(`🔄 ${contractName} bytecode changed, upgrading proxy...`);
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

    await putContract(chainId, updatedContract);
    console.log(
      `✅ ${contractName} upgraded at proxy: ${existingContract.proxyAddress}, new implementation: ${implementationAddress}`,
    );

    return upgraded as T;
  }

  // Contract doesn't exist, deploy new proxy
  console.log(`🚀 Deploying new ${contractName} proxy...`);
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

  await putContract(chainId, newContract);
  console.log(`✅ ${contractName} deployed at proxy: ${proxyAddress}, implementation: ${implementationAddress}`);

  return deployed as T;
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
