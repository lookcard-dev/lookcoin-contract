import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import "solidity-coverage";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import * as dotenv from "dotenv";

dotenv.config();

// Network RPC URLs
const BSC_RPC_URL = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/";
const BSC_TESTNET_RPC_URL = process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545/";
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const BASE_TESTNET_RPC_URL = process.env.BASE_TESTNET_RPC_URL || "https://sepolia.base.org";
const OPTIMISM_RPC_URL = process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io";
const OPTIMISM_TESTNET_RPC_URL = process.env.OPTIMISM_TESTNET_RPC_URL || "https://sepolia.optimism.io";
const SAPPHIRE_RPC_URL = process.env.SAPPHIRE_RPC_URL || "https://sapphire.oasis.io";
const SAPPHIRE_TESTNET_RPC_URL = process.env.SAPPHIRE_TESTNET_RPC_URL || "https://testnet.sapphire.oasis.io";
const AKASHIC_RPC_URL = process.env.AKASHIC_RPC_URL || "https://rpc.akashic.city";
const AKASHIC_TESTNET_RPC_URL = process.env.AKASHIC_TESTNET_RPC_URL || "https://testnet.rpc.akashic.city";

// Private key for deployments
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000";

// LayerZero Endpoints
const LZ_ENDPOINTS = {
  bsc: "0x3c2269811836af69497E5F486A85D7316753cf62",
  bscTestnet: "0x6Fcb97553D41516Cb228ac03FdC8B9a0a9df04A1",
  base: "0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7",
  baseTestnet: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  baseSepolia: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  optimism: "0x3c2269811836af69497E5F486A85D7316753cf62",
  optimismTestnet: "0x6Fcb97553D41516Cb228ac03FdC8B9a0a9df04A1",
  opSepolia: "0x6EDCE65403992e310A62460808c4b910D972f10f",
  sapphire: "0x0000000000000000000000000000000000000000", // Not supported by LayerZero
  sapphireTestnet: "0x0000000000000000000000000000000000000000", // Not supported by LayerZero
  akashic: "0x0000000000000000000000000000000000000000", // IBC only
  akashicTestnet: "0x0000000000000000000000000000000000000000" // IBC only
};

// Celer MessageBus Addresses
const CELER_MESSAGEBUS = {
  bsc: "0x95714818fdd7a5454F73Da9c777B3ee6EbAEEa6B",
  bscTestnet: "0xAd204986D6cB67A5Bc76a3CB8974823F43Cb9AAA",
  base: "0x0000000000000000000000000000000000000000", // Not supported by Celer
  baseTestnet: "0x0000000000000000000000000000000000000000", // Not supported by Celer
  baseSepolia: "0x0000000000000000000000000000000000000000", // Not supported by Celer
  optimism: "0x0D71D18126E03646eb09FEc929e2ae87b7CAE69d",
  optimismTestnet: "0x9Bb46D5100d2Db4608112026951c9C965b233f4D",
  opSepolia: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
  sapphire: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
  sapphireTestnet: "0x7dB27eE2Ecc1c9C3310a745d387C09667b38e60A",
  akashic: "0x0000000000000000000000000000000000000000", // IBC only
  akashicTestnet: "0x0000000000000000000000000000000000000000" // IBC only
};

// DVN (Decentralized Verifier Network) Addresses for LayerZero
const LZ_DVN = {
  bsc: ["0xfD6865c841c2d64565562fCc7e05e619A30615f0", "0xA59BA433ac34D2927232918Ef5B2eaAfcF130BA5", "0xe9AE261D3aFf7d3fCCF38Fa2d612DD3897e07B5d"],
  base: ["0x75dC8e5F50C8221a82CA6aF64aF811caA983B65f", "0xce975Ed97e5968592c9417755b2809a8Cf2EF7d8", "0x8ddF05F9A5c488b4973897E278B58895bF87Cb24"],
  optimism: ["0x6A02D83e8d433304bba74EF1c427913958187142", "0x2AC5EDe9bCC59A2e19F109952b0cC23720CE6C72", "0xD56e4eAb23cb81f43168F9F45211Eb027b9aC7cc"]
};

// IBC Validator Set Configuration
const IBC_VALIDATORS = {
  minValidators: 21,
  threshold: 14, // 2/3 majority
  unbondingPeriod: 14 * 24 * 60 * 60, // 14 days in seconds
  packetTimeout: 60 * 60 // 1 hour in seconds
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
    baseTestnet: {
      url: BASE_TESTNET_RPC_URL,
      chainId: 84531,
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
    optimismTestnet: {
      url: OPTIMISM_TESTNET_RPC_URL,
      chainId: 420,
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
      chainId: 12641,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    akashicTestnet: {
      url: AKASHIC_TESTNET_RPC_URL,
      chainId: 12641, // Same as mainnet
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: !!process.env.CONTRACT_SIZER,
    disambiguatePaths: false,
    only: [
      "LookCoin",
      "LayerZeroModule",
      "CelerIMModule",
      "IBCModule",
      "RateLimiter",
      "SupplyOracle",
      "MPCMultisig",
    ],
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
      baseTestnet: process.env.BASESCAN_API_KEY || "",
      optimisticEthereum: process.env.OPTIMISM_API_KEY || "",
      optimisticGoerli: process.env.OPTIMISM_API_KEY || "",
      optimisticSepolia: process.env.OPTIMISM_API_KEY || "",
      sapphire: process.env.SAPPHIRE_API_KEY || "",
      sapphireTestnet: process.env.SAPPHIRE_API_KEY || "",
    },
  },
};

// Export LayerZero and Celer configurations for use in scripts
export { LZ_ENDPOINTS, CELER_MESSAGEBUS, LZ_DVN, IBC_VALIDATORS };

export default config;