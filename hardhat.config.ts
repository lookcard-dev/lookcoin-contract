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
const BASE_TESTNET_RPC_URL = process.env.BASE_TESTNET_RPC_URL || "https://goerli.base.org";
const OPTIMISM_RPC_URL = process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io";
const OPTIMISM_TESTNET_RPC_URL = process.env.OPTIMISM_TESTNET_RPC_URL || "https://goerli.optimism.io";

// Private key for deployments
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000";

// LayerZero Endpoints
const LZ_ENDPOINTS = {
  bsc: "0x3c2269811836af69497E5F486A85D7316753cf62",
  bscTestnet: "0x6Fcb97553D41516Cb228ac03FdC8B9a0a9df04A1",
  base: "0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7",
  baseTestnet: "0x6Fcb97553D41516Cb228ac03FdC8B9a0a9df04A1",
  optimism: "0x3c2269811836af69497E5F486A85D7316753cf62",
  optimismTestnet: "0x6Fcb97553D41516Cb228ac03FdC8B9a0a9df04A1"
};

// Celer MessageBus Addresses
const CELER_MESSAGEBUS = {
  bsc: "0x95714818fdd7a5454F73Da9c777B3ee6EbAEEa6B",
  bscTestnet: "0xAd204986D6cB67A5Bc76a3CB8974823F43Cb9AAA",
  base: "0x0000000000000000000000000000000000000000", // To be deployed
  baseTestnet: "0x0000000000000000000000000000000000000000", // To be deployed
  optimism: "0x0D71D18126E03646eb09FEc929e2ae87b7CAE69d",
  optimismTestnet: "0x9Bb46D5100d2Db4608112026951c9C965b233f4D"
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
    },
  },
};

// Export LayerZero and Celer configurations for use in scripts
export { LZ_ENDPOINTS, CELER_MESSAGEBUS };

export default config;