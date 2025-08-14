import "dotenv/config";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import { HardhatUserConfig } from "hardhat/config";

export const TOTAL_SUPPLY = "5000000000000000000000000000"; // 5 billion tokens

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
const AKASHIC_TESTNET_RPC_URL = process.env.AKASHIC_TESTNET_RPC_URL || "https://rpc-testnet.akashicrecords.io";

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
  akashic: "0x0000000000000000000000000000000000000000", // Hyperlane only
  akashicTestnet: "0x0000000000000000000000000000000000000000", // Hyperlane only
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
  akashic: "0x0000000000000000000000000000000000000000", // Hyperlane only
  akashicTestnet: "0x0000000000000000000000000000000000000000", // Hyperlane only
};

// Hyperlane Mailbox Addresses
const HYPERLANE_MAILBOX = {
  bsc: "0x0000000000000000000000000000000000000000",
  bscTestnet: "0x0000000000000000000000000000000000000000",
  base: "0x0000000000000000000000000000000000000000",
  baseSepolia: "0x0000000000000000000000000000000000000000",
  optimism: "0x0000000000000000000000000000000000000000",
  opSepolia: "0x0000000000000000000000000000000000000000",
  sapphire: "0x0000000000000000000000000000000000000000", // Not supported by Hyperlane
  sapphireTestnet: "0x0000000000000000000000000000000000000000", // Not supported by Hyperlane
  akashic: "0x0000000000000000000000000000000000000000", // Custom Hyperlane deployment needed
};

// Hyperlane Gas Paymaster Addresses
const HYPERLANE_GAS_PAYMASTER = {
  bsc: "0x0000000000000000000000000000000000000000",
  bscTestnet: "0x0000000000000000000000000000000000000000",
  base: "0x0000000000000000000000000000000000000000",
  baseSepolia: "0x0000000000000000000000000000000000000000",
  optimism: "0x0000000000000000000000000000000000000000",
  opSepolia: "0x0000000000000000000000000000000000000000",
  sapphire: "0x0000000000000000000000000000000000000000",
  sapphireTestnet: "0x0000000000000000000000000000000000000000",
  akashic: "0x0000000000000000000000000000000000000000",
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

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 9999,
      },
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
      chainId: 23294,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    sapphireTestnet: {
      url: SAPPHIRE_TESTNET_RPC_URL,
      chainId: 23295,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    akashic: {
      url: AKASHIC_RPC_URL,
      chainId: 9070,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    akashicTestnet: {
      url: AKASHIC_TESTNET_RPC_URL,
      chainId: 9071,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: !!process.env.CONTRACT_SIZER,
    disambiguatePaths: false,
    only: [
      "LookCoin",
      "CelerIMModule",
      "SupplyOracle",
      "CrossChainRouter",
      "HyperlaneModule",
      "LayerZeroModule",
      "FeeManager",
      "SecurityManager",
      "ProtocolRegistry",
    ],
  },
  etherscan: {
    enabled: true,
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  sourcify: {
    enabled: true,
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  mocha: {
    timeout: 100000,
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    gasPrice: 20, // gwei
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    token: "BNB",
    gasPriceApi: "https://api.bscscan.com/api?module=proxy&action=eth_gasPrice",
    showTimeSpent: true,
    showMethodSig: true,
    excludeContracts: ["Mock", "Test"],
    outputFile: process.env.GAS_REPORT_FILE || "gas-report.txt",
    rst: true,
    rstTitle: "Gas Usage Report",
  },
};

// Celer Chain IDs mapping
const CELER_CHAIN_IDS = {
  bsc: 56,
  bscTestnet: 97,
  optimism: 10,
  sapphire: 23294,
  sapphireTestnet: 23295,
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


// Oracle bridge registrations per network
const ORACLE_BRIDGE_REGISTRATIONS = {
  bsc: {
    layerZero: { selector: "0x1", module: "0x0000000000000000000000000000000000000000" },
    celer: { selector: "0x2", module: "0x0000000000000000000000000000000000000000" },
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
  akashic: {},
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

// Dev team address for technical roles
const DEV_TEAM_ADDRESS = process.env.DEV_TEAM_ADDRESS || undefined;

// LayerZero Chain IDs
const LZ_CHAIN_IDS = {
  bsc: 30102,
  bscTestnet: 40102,
  base: 30184,
  baseSepolia: 40245,
  optimism: 30111,
  opSepolia: 40232,
};

// Hyperlane Domain IDs (NOT the same as chain IDs)
const HYPERLANE_DOMAIN_IDS = {
  bsc: 56,
  bscTestnet: 97,
  base: 8453,
  baseSepolia: 84532,
  optimism: 10,
  opSepolia: 11155420,
  sapphire: 0, // Not supported by Hyperlane
  akashic: 0, // Not supported by Hyperlane
};

// Comprehensive chain configuration
export interface ChainConfig {
  chainId: number;
  name: string;
  tier: "mainnet" | "testnet" | "dev";
  totalSupply: string;
  governanceVault: string;
  devTeamAddress?: string; // Optional dev team address for technical roles
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
  oracle: {
    bridges: {
      layerZero?: { selector: string; module: string };
      celer?: { selector: string; module: string };
      hyperlane?: { selector: string; module: string };
    };
    updateInterval: number;
    tolerance: number;
  };
  hyperlane: {
    mailbox: string;
    gasPaymaster: string;
    hyperlaneDomainId: number;
    validatorSet: string[];
    ism: string; // Interchain Security Module
  };
  protocols: {
    layerZero: boolean;
    celer: boolean;
    hyperlane: boolean;
  };
  rateLimiter: {
    perAccountLimit: string;
    maxTransactionsPerAccount: number;
  };
}

// Centralized chain configuration
export const CHAIN_CONFIG: { [network: string]: ChainConfig } = {
  bscmainnet: {
    chainId: 56,
    name: "BSC Mainnet",
    tier: "mainnet",
    totalSupply: TOTAL_SUPPLY,
    governanceVault: GOVERNANCE_VAULTS.bsc,
    devTeamAddress: DEV_TEAM_ADDRESS,
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
    oracle: {
      bridges: ORACLE_BRIDGE_REGISTRATIONS.bsc,
      updateInterval: 900, // 15 minutes
      tolerance: 100, // 1%
    },
    hyperlane: {
      mailbox: HYPERLANE_MAILBOX.bsc,
      gasPaymaster: HYPERLANE_GAS_PAYMASTER.bsc,
      hyperlaneDomainId: HYPERLANE_DOMAIN_IDS.bsc,
      validatorSet: [],
      ism: "0x0000000000000000000000000000000000000000",
    },
    protocols: {
      layerZero: true,
      celer: true,
      hyperlane: true,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000", // 500K tokens
      maxTransactionsPerAccount: 3,
    },
  },
  bsctestnet: {
    chainId: 97,
    name: "BSC Testnet",
    tier: "testnet",
    totalSupply: TOTAL_SUPPLY,
    governanceVault: GOVERNANCE_VAULTS.bscTestnet,
    devTeamAddress: DEV_TEAM_ADDRESS,
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
    oracle: {
      bridges: {},
      updateInterval: 900,
      tolerance: 100,
    },
    hyperlane: {
      mailbox: HYPERLANE_MAILBOX.bscTestnet,
      gasPaymaster: HYPERLANE_GAS_PAYMASTER.bscTestnet,
      hyperlaneDomainId: HYPERLANE_DOMAIN_IDS.bscTestnet,
      validatorSet: [],
      ism: "0x0000000000000000000000000000000000000000",
    },
    protocols: {
      layerZero: true,
      celer: true,
      hyperlane: true,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000", // 500K tokens
      maxTransactionsPerAccount: 3,
    },
  },
  basemainnet: {
    chainId: 8453,
    name: "Base Mainnet",
    tier: "mainnet",
    totalSupply: "0", // Minted via bridge
    governanceVault: GOVERNANCE_VAULTS.base,
    devTeamAddress: DEV_TEAM_ADDRESS,
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
    oracle: {
      bridges: ORACLE_BRIDGE_REGISTRATIONS.base || {},
      updateInterval: 900,
      tolerance: 100,
    },
    hyperlane: {
      mailbox: HYPERLANE_MAILBOX.base,
      gasPaymaster: HYPERLANE_GAS_PAYMASTER.base,
      hyperlaneDomainId: HYPERLANE_DOMAIN_IDS.base,
      validatorSet: [],
      ism: "0x0000000000000000000000000000000000000000",
    },
    protocols: {
      layerZero: true,
      celer: false, // Not supported by Celer
      hyperlane: true,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000", // 500K tokens
      maxTransactionsPerAccount: 3,
    },
  },
  basesepolia: {
    chainId: 84532,
    name: "Base Sepolia",
    tier: "testnet",
    totalSupply: TOTAL_SUPPLY,
    governanceVault: GOVERNANCE_VAULTS.baseSepolia,
    devTeamAddress: DEV_TEAM_ADDRESS,
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
    oracle: {
      bridges: {},
      updateInterval: 900,
      tolerance: 100,
    },
    hyperlane: {
      mailbox: HYPERLANE_MAILBOX.baseSepolia,
      gasPaymaster: HYPERLANE_GAS_PAYMASTER.baseSepolia,
      hyperlaneDomainId: HYPERLANE_DOMAIN_IDS.baseSepolia,
      validatorSet: [],
      ism: "0x0000000000000000000000000000000000000000",
    },
    protocols: {
      layerZero: true,
      celer: false,
      hyperlane: true,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000", // 500K tokens
      maxTransactionsPerAccount: 3,
    },
  },
  optimismmainnet: {
    chainId: 10,
    name: "Optimism Mainnet",
    tier: "mainnet",
    totalSupply: TOTAL_SUPPLY,
    governanceVault: GOVERNANCE_VAULTS.optimism,
    devTeamAddress: DEV_TEAM_ADDRESS,
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
    oracle: {
      bridges: ORACLE_BRIDGE_REGISTRATIONS.optimism || {},
      updateInterval: 900,
      tolerance: 100,
    },
    hyperlane: {
      mailbox: HYPERLANE_MAILBOX.optimism,
      gasPaymaster: HYPERLANE_GAS_PAYMASTER.optimism,
      hyperlaneDomainId: HYPERLANE_DOMAIN_IDS.optimism,
      validatorSet: [],
      ism: "0x0000000000000000000000000000000000000000",
    },
    protocols: {
      layerZero: true,
      celer: true,
      hyperlane: true,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000", // 500K tokens
      maxTransactionsPerAccount: 3,
    },
  },
  optimismsepolia: {
    chainId: 11155420,
    name: "Optimism Sepolia",
    tier: "testnet",
    totalSupply: TOTAL_SUPPLY,
    governanceVault: GOVERNANCE_VAULTS.opSepolia,
    devTeamAddress: DEV_TEAM_ADDRESS,
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
      messageBus: "0x0000000000000000000000000000000000000000", // Not supported by Celer
      celerChainId: 0, // Not supported by Celer
      fees: {
        feePercentage: 0,
        minFee: "0",
        maxFee: "0",
        feeCollector: "0x0000000000000000000000000000000000000000",
      },
    },
    oracle: {
      bridges: {},
      updateInterval: 900,
      tolerance: 100,
    },
    hyperlane: {
      mailbox: HYPERLANE_MAILBOX.opSepolia,
      gasPaymaster: HYPERLANE_GAS_PAYMASTER.opSepolia,
      hyperlaneDomainId: HYPERLANE_DOMAIN_IDS.opSepolia,
      validatorSet: [],
      ism: "0x0000000000000000000000000000000000000000",
    },
    protocols: {
      layerZero: true,
      celer: false,
      hyperlane: true,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000", // 500K tokens
      maxTransactionsPerAccount: 3,
    },
  },
  sapphiremainnet: {
    chainId: 23294,
    name: "Sapphire Mainnet",
    tier: "mainnet",
    totalSupply: TOTAL_SUPPLY,
    governanceVault: GOVERNANCE_VAULTS.sapphire,
    devTeamAddress: DEV_TEAM_ADDRESS,
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
    oracle: {
      bridges: ORACLE_BRIDGE_REGISTRATIONS.sapphire || {},
      updateInterval: 900,
      tolerance: 100,
    },
    hyperlane: {
      mailbox: HYPERLANE_MAILBOX.sapphire,
      gasPaymaster: HYPERLANE_GAS_PAYMASTER.sapphire,
      hyperlaneDomainId: 23294,
      validatorSet: [],
      ism: "0x0000000000000000000000000000000000000000",
    },
    protocols: {
      layerZero: false, // Not supported by LayerZero
      celer: true,
      hyperlane: true,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000", // 500K tokens
      maxTransactionsPerAccount: 3,
    },
  },
  sapphiretestnet: {
    chainId: 23295,
    name: "Sapphire Testnet",
    tier: "testnet",
    totalSupply: TOTAL_SUPPLY,
    governanceVault: GOVERNANCE_VAULTS.sapphireTestnet,
    devTeamAddress: DEV_TEAM_ADDRESS,
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
    oracle: {
      bridges: {},
      updateInterval: 900,
      tolerance: 100,
    },
    hyperlane: {
      mailbox: HYPERLANE_MAILBOX.sapphireTestnet,
      gasPaymaster: HYPERLANE_GAS_PAYMASTER.sapphireTestnet,
      hyperlaneDomainId: 23295,
      validatorSet: [],
      ism: "0x0000000000000000000000000000000000000000",
    },
    protocols: {
      layerZero: false,
      celer: true,
      hyperlane: true,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000", // 500K tokens
      maxTransactionsPerAccount: 3,
    },
  },
  akashicmainnet: {
    chainId: 9070,
    name: "Akashic Mainnet",
    tier: "mainnet",
    totalSupply: TOTAL_SUPPLY,
    governanceVault: GOVERNANCE_VAULTS.akashic,
    devTeamAddress: DEV_TEAM_ADDRESS,
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
    oracle: {
      bridges: ORACLE_BRIDGE_REGISTRATIONS.akashic || {},
      updateInterval: 900,
      tolerance: 100,
    },
    hyperlane: {
      mailbox: HYPERLANE_MAILBOX.akashic,
      gasPaymaster: HYPERLANE_GAS_PAYMASTER.akashic,
      hyperlaneDomainId: 9070,
      validatorSet: [],
      ism: "0x0000000000000000000000000000000000000000",
    },
    protocols: {
      layerZero: false, // Not supported by LayerZero
      celer: false, // Not supported by Celer
      hyperlane: true,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000", // 500K tokens
      maxTransactionsPerAccount: 3,
    },
  },
  hardhat: {
    chainId: 31337,
    name: "Hardhat Network",
    tier: "dev",
    totalSupply: TOTAL_SUPPLY,
    governanceVault: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // First hardhat account
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
    oracle: {
      bridges: {},
      updateInterval: 900,
      tolerance: 100,
    },
    hyperlane: {
      mailbox: "0x0000000000000000000000000000000000000000",
      gasPaymaster: "0x0000000000000000000000000000000000000000",
      hyperlaneDomainId: 31337,
      validatorSet: [],
      ism: "0x0000000000000000000000000000000000000000",
    },
    protocols: {
      layerZero: false,
      celer: false,
      hyperlane: false,
    },
    rateLimiter: {
      perAccountLimit: "500000000000000000000000", // 500K tokens
      maxTransactionsPerAccount: 3,
    },
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

// Helper function to check if Hyperlane is ready for a chain
export function isHyperlaneReady(chainConfig: ChainConfig): boolean {
  return (
    chainConfig.hyperlane.mailbox !== "0x0000000000000000000000000000000000000000" &&
    chainConfig.hyperlane.gasPaymaster !== "0x0000000000000000000000000000000000000000"
  );
}

// Helper function to generate Ignition parameters from centralized config
export function generateIgnitionParams(network: string): Record<string, unknown> {
  const chainConfig = getChainConfig(network);

  return {
    // LookCoin module parameters
    LookCoin: {
      totalSupply: chainConfig.totalSupply,
      governanceVault: chainConfig.governanceVault,
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
    // Hyperlane module parameters
    HyperlaneModule: {
      mailbox: chainConfig.hyperlane?.mailbox || "0x0000000000000000000000000000000000000000",
      gasPaymaster: chainConfig.hyperlane?.gasPaymaster || "0x0000000000000000000000000000000000000000",
      hyperlaneDomainId: chainConfig.hyperlane?.hyperlaneDomainId || 0,
      validatorSet: chainConfig.hyperlane?.validatorSet || [],
      ism: chainConfig.hyperlane?.ism || "0x0000000000000000000000000000000000000000",
    },
    // Router module parameters
    CrossChainRouter: {
      protocols: chainConfig.protocols || {
        layerZero: false,
        celer: false,
        hyperlane: false,
      },
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

// Helper function to get network name from chain ID
export function getNetworkName(chainId: number): string {
  // Iterate through CHAIN_CONFIG to find a network with matching chainId
  for (const [networkName, config] of Object.entries(CHAIN_CONFIG)) {
    if (config.chainId === chainId) {
      return networkName;
    }
  }

  // Fallback for unknown chain IDs
  return `Unknown (${chainId})`;
}

// Helper function to get network tier
export function getNetworkTier(chainId: number): "mainnet" | "testnet" | "dev" | "unknown" {
  // First try to find the network using getNetworkName and getChainConfig
  try {
    const networkName = getNetworkName(chainId);
    const config = getChainConfig(networkName);
    if (config && config.tier) {
      return config.tier;
    }
  } catch {
    // Continue with fallback logic
  }

  // Fallback: try to determine from chain ID patterns
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

// Export LayerZero and Celer configurations for use in scripts (DEPRECATED - use getChainConfig instead)
export { LZ_ENDPOINTS, CELER_MESSAGEBUS, LZ_DVN };

// Additional exports for backward compatibility
export {
  CELER_CHAIN_IDS,
  CELER_FEES,
  ORACLE_BRIDGE_REGISTRATIONS,
  GOVERNANCE_VAULTS,
  LZ_CHAIN_IDS,
};

export default config;
