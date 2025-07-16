import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { getChainConfig, CHAIN_CONFIG } from "../../hardhat.config";

// Common test constants exported from centralized config
export const TEST_CHAINS = {
  BSC: getChainConfig("bsc").chainId,
  BSC_TESTNET: getChainConfig("bscTestnet").chainId,
  BASE: getChainConfig("base").chainId,
  BASE_SEPOLIA: getChainConfig("baseSepolia").chainId,
  OPTIMISM: getChainConfig("optimism").chainId,
  OP_SEPOLIA: getChainConfig("opSepolia").chainId,
  SAPPHIRE: getChainConfig("sapphire").chainId,
  AKASHIC: getChainConfig("akashic").chainId,
  HARDHAT: 31337,
};

// Common test addresses
export const TEST_ADDRESSES = {
  ZERO: ethers.ZeroAddress,
  DEAD: "0x000000000000000000000000000000000000dEaD",
  MOCK_ENDPOINT: "0x1234567890123456789012345678901234567890",
  MOCK_MESSAGE_BUS: "0x2345678901234567890123456789012345678901",
  MOCK_VAULT: "0x3456789012345678901234567890123456789012",
};

// Role hashes - calculate once and export
export const ROLES = {
  DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
  MINTER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")),
  BURNER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE")),
  PAUSER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE")),
  UPGRADER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("UPGRADER_ROLE")),
  ORACLE_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE")),
  OPERATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE")),
  EMERGENCY_ROLE: ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE")),
  GOVERNANCE_ROLE: ethers.keccak256(ethers.toUtf8Bytes("GOVERNANCE_ROLE")),
  BRIDGE_OPERATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_OPERATOR_ROLE")),
  VALIDATOR_MANAGER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_MANAGER_ROLE")),
};

// Common deployment parameters for tests
export interface TestDeploymentParams {
  totalSupply?: string;
  governanceVault?: string;
  lzEndpoint?: string;
  messageBus?: string;
  chainId?: number;
  validators?: string[];
  minValidators?: number;
  threshold?: number;
}

// Helper function to deploy mock contracts with standard configuration
export async function deployMockLookCoin(
  signer: SignerWithAddress,
  params: TestDeploymentParams = {}
) {
  const LookCoin = await ethers.getContractFactory("LookCoin", signer);
  const defaultParams = {
    totalSupply: getChainConfig("bsc").totalSupply,
    governanceVault: params.governanceVault || signer.address,
    lzEndpoint: params.lzEndpoint || TEST_ADDRESSES.MOCK_ENDPOINT,
  };
  
  const lookCoin = await LookCoin.deploy();
  await lookCoin.waitForDeployment();
  await lookCoin.initialize(
    defaultParams.lzEndpoint,
    defaultParams.governanceVault,
    defaultParams.totalSupply
  );
  
  return lookCoin;
}

// Helper function to deploy mock Celer module
export async function deployMockCelerModule(
  signer: SignerWithAddress,
  lookCoinAddress: string,
  params: TestDeploymentParams = {}
) {
  const CelerModule = await ethers.getContractFactory("CelerIMModule", signer);
  const defaultParams = {
    messageBus: params.messageBus || TEST_ADDRESSES.MOCK_MESSAGE_BUS,
    governanceVault: params.governanceVault || signer.address,
  };
  
  const celerModule = await CelerModule.deploy();
  await celerModule.waitForDeployment();
  await celerModule.initialize(
    defaultParams.messageBus,
    lookCoinAddress,
    defaultParams.governanceVault
  );
  
  return celerModule;
}

// Helper function to deploy mock IBC module
export async function deployMockIBCModule(
  signer: SignerWithAddress,
  lookCoinAddress: string,
  vaultAddress: string,
  params: TestDeploymentParams = {}
) {
  const IBCModule = await ethers.getContractFactory("IBCModule", signer);
  const defaultParams = {
    governanceVault: params.governanceVault || signer.address,
  };
  
  const ibcModule = await IBCModule.deploy();
  await ibcModule.waitForDeployment();
  await ibcModule.initialize(
    lookCoinAddress,
    vaultAddress,
    defaultParams.governanceVault
  );
  
  return ibcModule;
}

// Helper function to deploy mock Supply Oracle
export async function deployMockSupplyOracle(
  signer: SignerWithAddress,
  params: TestDeploymentParams = {}
) {
  const SupplyOracle = await ethers.getContractFactory("SupplyOracle", signer);
  const defaultParams = {
    governanceVault: params.governanceVault || signer.address,
    totalSupply: params.totalSupply || getChainConfig("bsc").totalSupply,
  };
  
  const supplyOracle = await SupplyOracle.deploy();
  await supplyOracle.waitForDeployment();
  await supplyOracle.initialize(
    defaultParams.governanceVault,
    defaultParams.totalSupply
  );
  
  return supplyOracle;
}

// Helper to create mock bridge registration data
export function createMockBridgeRegistration(
  chainId: number,
  bridgeAddress: string,
  selector: string = "0x01"
) {
  return {
    chainId,
    bridge: bridgeAddress,
    selector,
    isActive: true,
    lastUpdate: 0,
  };
}

// Helper to create mock remote module mapping
export function createMockRemoteModule(
  chainId: number,
  moduleAddress: string
) {
  return {
    chainId,
    module: moduleAddress,
  };
}

// Helper to generate test validator set
export function generateTestValidators(count: number): string[] {
  const validators: string[] = [];
  for (let i = 1; i <= count; i++) {
    validators.push(ethers.getAddress(`0x${i.toString(16).padStart(40, "0")}`));
  }
  return validators;
}

// Helper to encode LayerZero trusted remote
export function encodeTrustedRemote(
  remoteAddress: string,
  localAddress: string
): string {
  return ethers.solidityPacked(
    ["address", "address"],
    [remoteAddress, localAddress]
  );
}

// Helper to create test chain configuration override
export function createTestChainConfig(overrides: Partial<any> = {}) {
  const baseConfig = getChainConfig("bsc");
  return {
    ...baseConfig,
    ...overrides,
    layerZero: {
      ...baseConfig.layerZero,
      ...(overrides.layerZero || {}),
    },
    celer: {
      ...baseConfig.celer,
      ...(overrides.celer || {}),
    },
    ibc: {
      ...baseConfig.ibc,
      ...(overrides.ibc || {}),
    },
    oracle: {
      ...baseConfig.oracle,
      ...(overrides.oracle || {}),
    },
    rateLimiter: {
      ...baseConfig.rateLimiter,
      ...(overrides.rateLimiter || {}),
    },
  };
}

// Test-specific mock contracts
export const MockContracts = {
  async deployMockMessageBus(signer: SignerWithAddress) {
    const MockMessageBus = await ethers.getContractFactory("MockMessageBus", signer);
    const messageBus = await MockMessageBus.deploy();
    await messageBus.waitForDeployment();
    return messageBus;
  },
  
  async deployMockLayerZeroEndpoint(signer: SignerWithAddress, chainId: number) {
    const MockEndpoint = await ethers.getContractFactory("MockLayerZeroEndpoint", signer);
    const endpoint = await MockEndpoint.deploy(chainId);
    await endpoint.waitForDeployment();
    return endpoint;
  },
  
  async deployMockDVN(signer: SignerWithAddress) {
    const MockDVN = await ethers.getContractFactory("MockDVN", signer);
    const dvn = await MockDVN.deploy();
    await dvn.waitForDeployment();
    return dvn;
  },
};

// Common test scenarios data
export const TestScenarios = {
  // Standard cross-chain transfer amounts
  TRANSFER_AMOUNTS: {
    SMALL: ethers.parseUnits("100", 8),
    MEDIUM: ethers.parseUnits("10000", 8),
    LARGE: ethers.parseUnits("100000", 8),
    MAX_PER_TX: ethers.parseUnits("500000", 8),
  },
  
  // Common fee configurations for testing
  FEE_CONFIGS: {
    ZERO_FEES: { feePercentage: 0, minFee: "0", maxFee: "0" },
    LOW_FEES: { 
      feePercentage: 10, // 0.1%
      minFee: ethers.parseUnits("1", 8).toString(),
      maxFee: ethers.parseUnits("100", 8).toString(),
    },
    HIGH_FEES: {
      feePercentage: 100, // 1%
      minFee: ethers.parseUnits("10", 8).toString(),
      maxFee: ethers.parseUnits("1000", 8).toString(),
    },
  },
  
  // Common rate limit configurations
  RATE_LIMITS: {
    STRICT: {
      perAccountLimit: ethers.parseUnits("1000", 8).toString(),
      perAccountTimeWindow: 3600,
      maxTransactionsPerAccount: 3,
    },
    NORMAL: {
      perAccountLimit: ethers.parseUnits("500000", 8).toString(),
      perAccountTimeWindow: 3600,
      maxTransactionsPerAccount: 3,
    },
    RELAXED: {
      perAccountLimit: ethers.parseUnits("10000000", 8).toString(),
      perAccountTimeWindow: 3600,
      maxTransactionsPerAccount: 100,
    },
  },
};

// Export all chain configurations for easy test access
export { getChainConfig } from "../../hardhat.config";