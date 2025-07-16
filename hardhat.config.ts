import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import "solidity-coverage";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import * as dotenv from "dotenv";

dotenv.config();

// Network RPC URLs
const BSC_RPC_URL = process.env.BSC_RPC_URL || "https://bsc-rpc.publicnode.com";
const BSC_TESTNET_RPC_URL = process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com";
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://base-rpc.publicnode.com";
const BASE_TESTNET_RPC_URL = process.env.BASE_TESTNET_RPC_URL || "https://base-sepolia-rpc.publicnode.com";
const OPTIMISM_RPC_URL = process.env.OPTIMISM_RPC_URL || "https://optimism-rpc.publicnode.com";
const OPTIMISM_TESTNET_RPC_URL = process.env.OPTIMISM_TESTNET_RPC_URL || "https://optimism-sepolia-rpc.publicnode.com";
const SAPPHIRE_RPC_URL = process.env.SAPPHIRE_RPC_URL || "https://sapphire.oasis.io";
const SAPPHIRE_TESTNET_RPC_URL = process.env.SAPPHIRE_TESTNET_RPC_URL || "https://testnet.sapphire.oasis.io";
const AKASHIC_RPC_URL = process.env.AKASHIC_RPC_URL || "https://rpc-mainnet.akashicrecords.io";

// Private key for deployments
const DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000";

// LayerZero Endpoints
const LZ_ENDPOINTS = {
  bsc: "0x1a44076050125825900e736c501f859c50fE728c",
  bscTestnet: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  base: "0x1a44076050125825900e736c501f859c50fE728c",
  baseSepolia: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  optimism: "0x1a44076050125825900e736c501f859c50fE728c",
  opSepolia: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  sapphire: "0x0000000000000000000000000000000000000000", // Not supported by LayerZero
  sapphireTestnet: "0x0000000000000000000000000000000000000000", // Not supported by LayerZero
  akashic: "0x0000000000000000000000000000000000000000", // IBC only
};

// Celer MessageBus Addresses
const CELER_MESSAGEBUS = {
  bsc: "0x95714818fdd7a5454f73da9c777b3ee6ebaeea6b",
  bscTestnet: "0xAd204986D6cB67A5Bc76a3CB8974823F43Cb9AAA",
  base: "0x0000000000000000000000000000000000000000", // Not supported by Celer
  baseSepolia: "0x0000000000000000000000000000000000000000", // Not supported by Celer
  optimism: "0x0D71D18126E03646eb09FEc929e2ae87b7CAE69d",
  opSepolia: "0x0000000000000000000000000000000000000000", // Not supported by Celer
  sapphire: "0x9Bb46D5100d2Db4608112026951c9C965b233f4D",
  sapphireTestnet: "0x9Bb46D5100d2Db4608112026951c9C965b233f4D",
  akashic: "0x0000000000000000000000000000000000000000", // IBC only
};

// DVN (Decentralized Verifier Network) Addresses for LayerZero
const LZ_DVN = {
  bsc: [
    "0xfD6865c841c2d64565562fCc7e05e619A30615f0", // LayerZero Lab
    "0xd56e4eab23cb81f43168f9f45211eb027b9ac7cc", // Google Cloud
    "0x31f748a368a893bdb5abb67ec95f232507601a73", // Nethermind
  ],
  base: [
    "0x9e059a54699a285714207b43b055483e78faac25", // LayerZero Lab
    "0xd56e4eab23cb81f43168f9f45211eb027b9ac7cc", // Google Cloud
    "0xcd37ca043f8479064e10635020c65ffc005d36f6", // Nethermind
  ],
  optimism: [
    "0x6a02d83e8d433304bba74ef1c427913958187142", // LayerZero Lab
    "0xd56e4eab23cb81f43168f9f45211eb027b9ac7cc", // Google Cloud
    "0xa7b5189bca84cd304d8553977c7c614329750d99", // Nethermind
  ],
};

// IBC Validator Set Configuration
const IBC_VALIDATORS = {
  minValidators: 21,
  threshold: 14, // 2/3 majority
  unbondingPeriod: 14 * 24 * 60 * 60, // 14 days in seconds
  packetTimeout: 60 * 60, // 1 hour in seconds
};

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 9999,
      },
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      forking: {
        url: BSC_RPC_URL,
        enabled: false,
      },
    },
    bsc: {
      url: BSC_RPC_URL,
      chainId: 56,
      accounts: [DEPLOYER_PRIVATE_KEY],
      gasPrice: 5000000000, // 5 gwei
    },
    bscTestnet: {
      url: BSC_TESTNET_RPC_URL,
      chainId: 97,
      accounts: [DEPLOYER_PRIVATE_KEY],
      gasPrice: 10000000000, // 10 gwei
    },
    base: {
      url: BASE_RPC_URL,
      chainId: 8453,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    baseSepolia: {
      url: BASE_TESTNET_RPC_URL,
      chainId: 84532,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    optimism: {
      url: OPTIMISM_RPC_URL,
      chainId: 10,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    opSepolia: {
      url: OPTIMISM_TESTNET_RPC_URL,
      chainId: 11155420,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    sapphire: {
      url: SAPPHIRE_RPC_URL,
      chainId: 23295,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    sapphireTestnet: {
      url: SAPPHIRE_TESTNET_RPC_URL,
      chainId: 23295, // Same as mainnet
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    akashic: {
      url: AKASHIC_RPC_URL,
      chainId: 9070,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: !!process.env.CONTRACT_SIZER,
    disambiguatePaths: false,
    only: ["LookCoin", "LayerZeroModule", "CelerIMModule", "IBCModule", "RateLimiter", "SupplyOracle", "MPCMultisig"],
  },
  gasReporter: {
    enabled: !!process.env.REPORT_GAS,
    currency: "USD",
    gasPrice: 5, // BSC gas price in gwei
    token: "BNB",
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    excludeContracts: ["Mock*"],
  },
  etherscan: {
    apiKey: {
      bsc: process.env.BSCSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || "",
      baseSepolia: process.env.BASESCAN_API_KEY || "",
      optimisticEthereum: process.env.OPTIMISM_API_KEY || "",
      optimisticSepolia: process.env.OPTIMISM_API_KEY || "",
      sapphire: process.env.SAPPHIRE_API_KEY || "",
      sapphireTestnet: process.env.SAPPHIRE_API_KEY || "",
    },
  },
};

// Celer Chain IDs mapping
const CELER_CHAIN_IDS = {
  bsc: 56,
  bscTestnet: 97,
  optimism: 10,
  opSepolia: 11155420,
  sapphire: 23295,
  sapphireTestnet: 23295,
};

// IBC Channel and Port configuration
const IBC_CHANNELS = {
  akashic: {
    channelId: "channel-0",
    portId: "transfer",
  },
};

// Celer Fee Parameters
const CELER_FEES = {
  bsc: {
    feePercentage: 10, // 0.1%
    minFee: "1000000000000000000", // 1 LOOK
    maxFee: "100000000000000000000", // 100 LOOK
    feeCollector: "0x0000000000000000000000000000000000000000",
  },
  bscTestnet: {
    feePercentage: 10,
    minFee: "1000000000000000000",
    maxFee: "100000000000000000000",
    feeCollector: "0x0000000000000000000000000000000000000000",
  },
  optimism: {
    feePercentage: 10,
    minFee: "1000000000000000000",
    maxFee: "100000000000000000000",
    feeCollector: "0x0000000000000000000000000000000000000000",
  },
  opSepolia: {
    feePercentage: 10,
    minFee: "1000000000000000000",
    maxFee: "100000000000000000000",
    feeCollector: "0x0000000000000000000000000000000000000000",
  },
  sapphire: {
    feePercentage: 10,
    minFee: "1000000000000000000",
    maxFee: "100000000000000000000",
    feeCollector: "0x0000000000000000000000000000000000000000",
  },
  sapphireTestnet: {
    feePercentage: 10,
    minFee: "1000000000000000000",
    maxFee: "100000000000000000000",
    feeCollector: "0x0000000000000000000000000000000000000000",
  },
};

// Supported chains per module type
const SUPPORTED_CHAINS = {
  layerZero: ["bsc", "bscTestnet", "base", "baseSepolia", "optimism", "opSepolia"],
  celer: ["bsc", "bscTestnet", "optimism", "opSepolia", "sapphire", "sapphireTestnet"],
  ibc: ["akashic"],
};

// Remote modules configuration for cross-chain communication
const REMOTE_MODULES = {
  bsc: {
    base: "0x0000000000000000000000000000000000000000", // To be filled after deployment
    optimism: "0x0000000000000000000000000000000000000000",
    sapphire: "0x0000000000000000000000000000000000000000",
    akashic: "0x0000000000000000000000000000000000000000",
  },
  base: {
    bsc: "0x0000000000000000000000000000000000000000",
  },
  optimism: {
    bsc: "0x0000000000000000000000000000000000000000",
  },
  sapphire: {
    bsc: "0x0000000000000000000000000000000000000000",
  },
  akashic: {
    bsc: "0x0000000000000000000000000000000000000000",
  },
};

// Oracle bridge registrations per network
const ORACLE_BRIDGE_REGISTRATIONS = {
  bsc: {
    layerZero: { selector: "0x1", module: "0x0000000000000000000000000000000000000000" },
    celer: { selector: "0x2", module: "0x0000000000000000000000000000000000000000" },
    ibc: { selector: "0x3", module: "0x0000000000000000000000000000000000000000" },
  },
  base: {
    layerZero: { selector: "0x1", module: "0x0000000000000000000000000000000000000000" },
  },
  optimism: {
    celer: { selector: "0x2", module: "0x0000000000000000000000000000000000000000" },
  },
  sapphire: {
    celer: { selector: "0x2", module: "0x0000000000000000000000000000000000000000" },
  },
  akashic: {
    ibc: { selector: "0x3", module: "0x0000000000000000000000000000000000000000" },
  },
};

// IBC Validator addresses per network
const IBC_VALIDATOR_ADDRESSES = {
  akashic: [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333",
  ],
};

// Governance vault addresses per network
const GOVERNANCE_VAULTS = {
  bsc: process.env.GOVERNANCE_VAULT || "0x0000000000000000000000000000000000000000",
  bscTestnet: process.env.GOVERNANCE_VAULT || "0x0000000000000000000000000000000000000000",
  base: process.env.GOVERNANCE_VAULT || "0x0000000000000000000000000000000000000000",
  baseSepolia: process.env.GOVERNANCE_VAULT || "0x0000000000000000000000000000000000000000",
  optimism: process.env.GOVERNANCE_VAULT || "0x0000000000000000000000000000000000000000",
  opSepolia: process.env.GOVERNANCE_VAULT || "0x0000000000000000000000000000000000000000",
  sapphire: process.env.GOVERNANCE_VAULT || "0x0000000000000000000000000000000000000000",
  sapphireTestnet: process.env.GOVERNANCE_VAULT || "0x0000000000000000000000000000000000000000",
  akashic: process.env.GOVERNANCE_VAULT || "0x0000000000000000000000000000000000000000",
};

// LayerZero Chain IDs
const LZ_CHAIN_IDS = {
  bsc: 30102,
  bscTestnet: 40102,
  base: 30184,
  baseSepolia: 40245,
  optimism: 30111,
  opSepolia: 40232,
};

// Comprehensive chain configuration
export interface ChainConfig {
  chainId: number;
  name: string;
  totalSupply: string;
  governanceVault: string;
  layerZero: {
    endpoint: string;
    lzChainId: number;
    dvns: string[];
    requiredDVNs: string[];
    optionalDVNs: string[];
    optionalDVNThreshold: number;
    confirmations: number;
  };
  celer: {
    messageBus: string;
    celerChainId: number;
    fees: {
      feePercentage: number;
      minFee: string;
      maxFee: string;
      feeCollector: string;
    };
  };
  ibc: {
    channelId: string;
    portId: string;
    validators: string[];
    minValidators: number;
    threshold: number;
    unbondingPeriod: number;
    packetTimeout: number;
  };
  oracle: {
    bridges: {
      layerZero?: { selector: string; module: string };
      celer?: { selector: string; module: string };
      ibc?: { selector: string; module: string };
    };
    updateInterval: number;
    tolerance: number;
  };
  rateLimiter: {
    perAccountLimit: string;
    perAccountTimeWindow: number;
    maxTransactionsPerAccount: number;
    globalDailyLimit: string;
  };
  remoteModules: { [network: string]: string };
}

// Centralized chain configuration
export const CHAIN_CONFIG: { [network: string]: ChainConfig } = {
  bscmainnet: {
    chainId: 56,
    name: "BSC Mainnet",
    totalSupply: "10000000000000000000000000000", // 10 billion tokens
    governanceVault: GOVERNANCE_VAULTS.bsc,
    layerZero: {
      endpoint: LZ_ENDPOINTS.bsc,
      lzChainId: LZ_CHAIN_IDS.bsc,
      dvns: LZ_DVN.bsc || [],
      requiredDVNs: [LZ_DVN.bsc?.[0] || ""],
      optionalDVNs: LZ_DVN.bsc?.slice(1) || [],
      optionalDVNThreshold: 1,
      confirmations: 15,
    },
    celer: {
      messageBus: CELER_MESSAGEBUS.bsc,
      celerChainId: CELER_CHAIN_IDS.bsc,
      fees: CELER_FEES.bsc,
    },
    ibc: {
      channelId: "",
      portId: "",
      validators: [],
      minValidators: 0,
      threshold: 0,
      unbondingPeriod: 0,
      packetTimeout: 0,
    },
    oracle: {
      bridges: ORACLE_BRIDGE_REGISTRATIONS.bsc,
      updateInterval: 900, // 15 minutes
      tolerance: 100, // 1%
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000", // 500K tokens
      perAccountTimeWindow: 3600, // 1 hour
      maxTransactionsPerAccount: 3,
      globalDailyLimit: "2000000000000000000000000000", // 20% of total supply
    },
    remoteModules: REMOTE_MODULES.bsc || {},
  },
  bsctestnet: {
    chainId: 97,
    name: "BSC Testnet",
    totalSupply: "10000000000000000000000000000",
    governanceVault: GOVERNANCE_VAULTS.bscTestnet,
    layerZero: {
      endpoint: LZ_ENDPOINTS.bscTestnet,
      lzChainId: LZ_CHAIN_IDS.bscTestnet,
      dvns: [],
      requiredDVNs: [],
      optionalDVNs: [],
      optionalDVNThreshold: 0,
      confirmations: 1,
    },
    celer: {
      messageBus: CELER_MESSAGEBUS.bscTestnet,
      celerChainId: CELER_CHAIN_IDS.bscTestnet,
      fees: CELER_FEES.bscTestnet,
    },
    ibc: {
      channelId: "",
      portId: "",
      validators: [],
      minValidators: 0,
      threshold: 0,
      unbondingPeriod: 0,
      packetTimeout: 0,
    },
    oracle: {
      bridges: {},
      updateInterval: 900,
      tolerance: 100,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000",
      perAccountTimeWindow: 3600,
      maxTransactionsPerAccount: 3,
      globalDailyLimit: "2000000000000000000000000000",
    },
    remoteModules: {},
  },
  basemainnet: {
    chainId: 8453,
    name: "Base Mainnet",
    totalSupply: "0", // Minted via bridge
    governanceVault: GOVERNANCE_VAULTS.base,
    layerZero: {
      endpoint: LZ_ENDPOINTS.base,
      lzChainId: LZ_CHAIN_IDS.base,
      dvns: LZ_DVN.base || [],
      requiredDVNs: [LZ_DVN.base?.[0] || ""],
      optionalDVNs: LZ_DVN.base?.slice(1) || [],
      optionalDVNThreshold: 1,
      confirmations: 15,
    },
    celer: {
      messageBus: CELER_MESSAGEBUS.base,
      celerChainId: 0,
      fees: {
        feePercentage: 0,
        minFee: "0",
        maxFee: "0",
        feeCollector: "0x0000000000000000000000000000000000000000",
      },
    },
    ibc: {
      channelId: "",
      portId: "",
      validators: [],
      minValidators: 0,
      threshold: 0,
      unbondingPeriod: 0,
      packetTimeout: 0,
    },
    oracle: {
      bridges: ORACLE_BRIDGE_REGISTRATIONS.base || {},
      updateInterval: 900,
      tolerance: 100,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000",
      perAccountTimeWindow: 3600,
      maxTransactionsPerAccount: 3,
      globalDailyLimit: "2000000000000000000000000000",
    },
    remoteModules: REMOTE_MODULES.base || {},
  },
  basesepolia: {
    chainId: 84532,
    name: "Base Sepolia",
    totalSupply: "0",
    governanceVault: GOVERNANCE_VAULTS.baseSepolia,
    layerZero: {
      endpoint: LZ_ENDPOINTS.baseSepolia,
      lzChainId: LZ_CHAIN_IDS.baseSepolia,
      dvns: [],
      requiredDVNs: [],
      optionalDVNs: [],
      optionalDVNThreshold: 0,
      confirmations: 1,
    },
    celer: {
      messageBus: CELER_MESSAGEBUS.baseSepolia,
      celerChainId: 0,
      fees: {
        feePercentage: 0,
        minFee: "0",
        maxFee: "0",
        feeCollector: "0x0000000000000000000000000000000000000000",
      },
    },
    ibc: {
      channelId: "",
      portId: "",
      validators: [],
      minValidators: 0,
      threshold: 0,
      unbondingPeriod: 0,
      packetTimeout: 0,
    },
    oracle: {
      bridges: {},
      updateInterval: 900,
      tolerance: 100,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000",
      perAccountTimeWindow: 3600,
      maxTransactionsPerAccount: 3,
      globalDailyLimit: "2000000000000000000000000000",
    },
    remoteModules: {},
  },
  optimismmainnet: {
    chainId: 10,
    name: "Optimism Mainnet",
    totalSupply: "0",
    governanceVault: GOVERNANCE_VAULTS.optimism,
    layerZero: {
      endpoint: LZ_ENDPOINTS.optimism,
      lzChainId: LZ_CHAIN_IDS.optimism,
      dvns: LZ_DVN.optimism || [],
      requiredDVNs: [LZ_DVN.optimism?.[0] || ""],
      optionalDVNs: LZ_DVN.optimism?.slice(1) || [],
      optionalDVNThreshold: 1,
      confirmations: 15,
    },
    celer: {
      messageBus: CELER_MESSAGEBUS.optimism,
      celerChainId: CELER_CHAIN_IDS.optimism,
      fees: CELER_FEES.optimism,
    },
    ibc: {
      channelId: "",
      portId: "",
      validators: [],
      minValidators: 0,
      threshold: 0,
      unbondingPeriod: 0,
      packetTimeout: 0,
    },
    oracle: {
      bridges: ORACLE_BRIDGE_REGISTRATIONS.optimism || {},
      updateInterval: 900,
      tolerance: 100,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000",
      perAccountTimeWindow: 3600,
      maxTransactionsPerAccount: 3,
      globalDailyLimit: "2000000000000000000000000000",
    },
    remoteModules: REMOTE_MODULES.optimism || {},
  },
  optimismsepolia: {
    chainId: 11155420,
    name: "Optimism Sepolia",
    totalSupply: "0",
    governanceVault: GOVERNANCE_VAULTS.opSepolia,
    layerZero: {
      endpoint: LZ_ENDPOINTS.opSepolia,
      lzChainId: LZ_CHAIN_IDS.opSepolia,
      dvns: [],
      requiredDVNs: [],
      optionalDVNs: [],
      optionalDVNThreshold: 0,
      confirmations: 1,
    },
    celer: {
      messageBus: CELER_MESSAGEBUS.opSepolia,
      celerChainId: CELER_CHAIN_IDS.opSepolia,
      fees: CELER_FEES.opSepolia,
    },
    ibc: {
      channelId: "",
      portId: "",
      validators: [],
      minValidators: 0,
      threshold: 0,
      unbondingPeriod: 0,
      packetTimeout: 0,
    },
    oracle: {
      bridges: {},
      updateInterval: 900,
      tolerance: 100,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000",
      perAccountTimeWindow: 3600,
      maxTransactionsPerAccount: 3,
      globalDailyLimit: "2000000000000000000000000000",
    },
    remoteModules: {},
  },
  sapphiremainnet: {
    chainId: 23295,
    name: "Sapphire Mainnet",
    totalSupply: "0",
    governanceVault: GOVERNANCE_VAULTS.sapphire,
    layerZero: {
      endpoint: LZ_ENDPOINTS.sapphire,
      lzChainId: 0,
      dvns: [],
      requiredDVNs: [],
      optionalDVNs: [],
      optionalDVNThreshold: 0,
      confirmations: 0,
    },
    celer: {
      messageBus: CELER_MESSAGEBUS.sapphire,
      celerChainId: CELER_CHAIN_IDS.sapphire,
      fees: CELER_FEES.sapphire,
    },
    ibc: {
      channelId: "",
      portId: "",
      validators: [],
      minValidators: 0,
      threshold: 0,
      unbondingPeriod: 0,
      packetTimeout: 0,
    },
    oracle: {
      bridges: ORACLE_BRIDGE_REGISTRATIONS.sapphire || {},
      updateInterval: 900,
      tolerance: 100,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000",
      perAccountTimeWindow: 3600,
      maxTransactionsPerAccount: 3,
      globalDailyLimit: "2000000000000000000000000000",
    },
    remoteModules: REMOTE_MODULES.sapphire || {},
  },
  sapphiretestnet: {
    chainId: 23295,
    name: "Sapphire Testnet",
    totalSupply: "0",
    governanceVault: GOVERNANCE_VAULTS.sapphireTestnet,
    layerZero: {
      endpoint: LZ_ENDPOINTS.sapphireTestnet,
      lzChainId: 0,
      dvns: [],
      requiredDVNs: [],
      optionalDVNs: [],
      optionalDVNThreshold: 0,
      confirmations: 0,
    },
    celer: {
      messageBus: CELER_MESSAGEBUS.sapphireTestnet,
      celerChainId: CELER_CHAIN_IDS.sapphireTestnet,
      fees: CELER_FEES.sapphireTestnet,
    },
    ibc: {
      channelId: "",
      portId: "",
      validators: [],
      minValidators: 0,
      threshold: 0,
      unbondingPeriod: 0,
      packetTimeout: 0,
    },
    oracle: {
      bridges: {},
      updateInterval: 900,
      tolerance: 100,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000",
      perAccountTimeWindow: 3600,
      maxTransactionsPerAccount: 3,
      globalDailyLimit: "2000000000000000000000000000",
    },
    remoteModules: {},
  },
  akashicmainnet: {
    chainId: 9070,
    name: "Akashic Mainnet",
    totalSupply: "0",
    governanceVault: GOVERNANCE_VAULTS.akashic,
    layerZero: {
      endpoint: LZ_ENDPOINTS.akashic,
      lzChainId: 0,
      dvns: [],
      requiredDVNs: [],
      optionalDVNs: [],
      optionalDVNThreshold: 0,
      confirmations: 0,
    },
    celer: {
      messageBus: CELER_MESSAGEBUS.akashic,
      celerChainId: 0,
      fees: {
        feePercentage: 0,
        minFee: "0",
        maxFee: "0",
        feeCollector: "0x0000000000000000000000000000000000000000",
      },
    },
    ibc: {
      channelId: IBC_CHANNELS.akashic.channelId,
      portId: IBC_CHANNELS.akashic.portId,
      validators: IBC_VALIDATOR_ADDRESSES.akashic,
      minValidators: IBC_VALIDATORS.minValidators,
      threshold: IBC_VALIDATORS.threshold,
      unbondingPeriod: IBC_VALIDATORS.unbondingPeriod,
      packetTimeout: IBC_VALIDATORS.packetTimeout,
    },
    oracle: {
      bridges: ORACLE_BRIDGE_REGISTRATIONS.akashic || {},
      updateInterval: 900,
      tolerance: 100,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000",
      perAccountTimeWindow: 3600,
      maxTransactionsPerAccount: 3,
      globalDailyLimit: "2000000000000000000000000000",
    },
    remoteModules: REMOTE_MODULES.akashic || {},
  },
  hardhat: {
    chainId: 31337,
    name: "Hardhat",
    totalSupply: "10000000000000000000000000000", // 10 billion tokens for testing
    governanceVault: "0x0000000000000000000000000000000000000000",
    layerZero: {
      endpoint: "0x0000000000000000000000000000000000000000",
      lzChainId: 0,
      dvns: [],
      requiredDVNs: [],
      optionalDVNs: [],
      optionalDVNThreshold: 0,
      confirmations: 1,
    },
    celer: {
      messageBus: "0x0000000000000000000000000000000000000000",
      celerChainId: 0,
      fees: {
        feePercentage: 0,
        minFee: "0",
        maxFee: "0",
        feeCollector: "0x0000000000000000000000000000000000000000",
      },
    },
    ibc: {
      channelId: "",
      portId: "",
      validators: [],
      minValidators: 0,
      threshold: 0,
      unbondingPeriod: 0,
      packetTimeout: 0,
    },
    oracle: {
      bridges: {},
      updateInterval: 900,
      tolerance: 100,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000",
      perAccountTimeWindow: 3600,
      maxTransactionsPerAccount: 10, // More permissive for testing
      globalDailyLimit: "2000000000000000000000000000",
    },
    remoteModules: {},
  },
};

// Helper function to get chain configuration
export function getChainConfig(network: string): ChainConfig {
  const config = CHAIN_CONFIG[network];
  if (!config) {
    throw new Error(`Configuration not found for network: ${network}`);
  }
  return config;
}

// Helper function to generate Ignition parameters from centralized config
export function generateIgnitionParams(network: string): any {
  const chainConfig = getChainConfig(network);

  return {
    // LookCoin module parameters
    LookCoin: {
      totalSupply: chainConfig.totalSupply,
      governanceVault: chainConfig.governanceVault,
    },
    // IBC module parameters
    IBCModule: {
      validators: chainConfig.ibc.validators,
      minValidators: chainConfig.ibc.minValidators,
      threshold: chainConfig.ibc.threshold,
      channelId: chainConfig.ibc.channelId,
      portId: chainConfig.ibc.portId,
      unbondingPeriod: chainConfig.ibc.unbondingPeriod,
      packetTimeout: chainConfig.ibc.packetTimeout,
    },
    // Celer module parameters
    CelerModule: {
      messageBus: chainConfig.celer.messageBus,
      feePercentage: chainConfig.celer.fees.feePercentage,
      minFee: chainConfig.celer.fees.minFee,
      maxFee: chainConfig.celer.fees.maxFee,
      feeCollector: chainConfig.celer.fees.feeCollector,
    },
    // Oracle module parameters
    OracleModule: {
      updateInterval: chainConfig.oracle.updateInterval,
      tolerance: chainConfig.oracle.tolerance,
    },
    // Common parameters
    chainId: chainConfig.chainId,
    lzEndpoint: chainConfig.layerZero.endpoint,
    lzChainId: chainConfig.layerZero.lzChainId,
    celerChainId: chainConfig.celer.celerChainId,
    dvns: chainConfig.layerZero.dvns,
    requiredDVNs: chainConfig.layerZero.requiredDVNs,
    optionalDVNs: chainConfig.layerZero.optionalDVNs,
    optionalDVNThreshold: chainConfig.layerZero.optionalDVNThreshold,
    confirmations: chainConfig.layerZero.confirmations,
  };
}

// Export LayerZero and Celer configurations for use in scripts (DEPRECATED - use getChainConfig instead)
export { LZ_ENDPOINTS, CELER_MESSAGEBUS, LZ_DVN, IBC_VALIDATORS };

// Additional exports for backward compatibility
export {
  CELER_CHAIN_IDS,
  IBC_CHANNELS,
  CELER_FEES,
  SUPPORTED_CHAINS,
  REMOTE_MODULES,
  ORACLE_BRIDGE_REGISTRATIONS,
  IBC_VALIDATOR_ADDRESSES,
  GOVERNANCE_VAULTS,
  LZ_CHAIN_IDS,
};

export default config;
