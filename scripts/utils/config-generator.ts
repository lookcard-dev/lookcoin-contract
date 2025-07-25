import fs from "fs";
import path from "path";
import { getChainConfig, CHAIN_CONFIG } from "../../hardhat.config";

const IGNITION_PARAMS_DIR = path.join(__dirname, "../../ignition/parameters");

interface IgnitionParameters {
  LookCoin?: {
    totalSupply: string;
    governanceVault: string;
  };
  CelerModule?: {
    messageBus: string;
    feePercentage: number;
    minFee: string;
    maxFee: string;
    feeCollector: string;
  };
  OracleModule?: {
    updateInterval: number;
    tolerance: number;
  };
  MocksModule?: {
    [key: string]: any;
  };
  chainId: number;
  lzEndpoint: string;
  lzChainId: number;
  celerChainId: number;
  dvns: string[];
  requiredDVNs: string[];
  optionalDVNs: string[];
  optionalDVNThreshold: number;
  confirmations: number;
}

function generateLookCoinParams(network: string): IgnitionParameters["LookCoin"] {
  const config = getChainConfig(network);

  // Only generate LookCoin params for home chain (BSC)
  if (network !== "bsc" && network !== "bscTestnet") {
    return undefined;
  }

  return {
    totalSupply: config.totalSupply,
    governanceVault: config.governanceVault,
  };
}


function generateCelerParams(network: string): IgnitionParameters["CelerModule"] {
  const config = getChainConfig(network);

  // Only generate Celer params for networks with Celer support
  if (config.celer.messageBus === "0x0000000000000000000000000000000000000000") {
    return undefined;
  }

  return {
    messageBus: config.celer.messageBus,
    feePercentage: config.celer.fees.feePercentage,
    minFee: config.celer.fees.minFee,
    maxFee: config.celer.fees.maxFee,
    feeCollector: config.celer.fees.feeCollector,
  };
}

function generateOracleParams(network: string): IgnitionParameters["OracleModule"] {
  const config = getChainConfig(network);

  return {
    updateInterval: config.oracle.updateInterval,
    tolerance: config.oracle.tolerance,
  };
}

function generateMockParams(network: string): IgnitionParameters["MocksModule"] {
  // Mocks are only used for local development
  if (network !== "hardhat" && network !== "localhost") {
    return undefined;
  }

  return {
    totalSupply: "10000000000000000000000000000",
    governanceVault: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // Hardhat account 0
  };
}

function generateIgnitionParameters(network: string): IgnitionParameters {
  const config = getChainConfig(network);

  const params: IgnitionParameters = {
    chainId: config.chainId,
    lzEndpoint: config.layerZero.endpoint,
    lzChainId: config.layerZero.lzChainId,
    celerChainId: config.celer.celerChainId,
    dvns: config.layerZero.dvns,
    requiredDVNs: config.layerZero.requiredDVNs,
    optionalDVNs: config.layerZero.optionalDVNs,
    optionalDVNThreshold: config.layerZero.optionalDVNThreshold,
    confirmations: config.layerZero.confirmations,
  };

  // Add module-specific parameters
  const lookCoinParams = generateLookCoinParams(network);
  if (lookCoinParams) {
    params.LookCoin = lookCoinParams;
  }


  const celerParams = generateCelerParams(network);
  if (celerParams) {
    params.CelerModule = celerParams;
  }

  const oracleParams = generateOracleParams(network);
  if (oracleParams) {
    params.OracleModule = oracleParams;
  }

  const mockParams = generateMockParams(network);
  if (mockParams) {
    params.MocksModule = mockParams;
  }

  return params;
}

function generateParameterFile(network: string): void {
  const params = generateIgnitionParameters(network);
  const filename = `${network}.json`;
  const filepath = path.join(IGNITION_PARAMS_DIR, filename);

  const content = {
    "//": "AUTO-GENERATED from hardhat.config.ts - DO NOT EDIT MANUALLY",
    "//2": "Run 'npm run config:generate' to regenerate this file",
    ...params,
  };

  // Create directory if it doesn't exist
  if (!fs.existsSync(IGNITION_PARAMS_DIR)) {
    fs.mkdirSync(IGNITION_PARAMS_DIR, { recursive: true });
  }

  // Write the file
  fs.writeFileSync(filepath, JSON.stringify(content, null, 2) + "\n");
  console.log(`✅ Generated ${filename}`);
}

function validateConfiguration(): void {
  console.log("Validating configuration...");

  for (const network of Object.keys(CHAIN_CONFIG)) {
    try {
      const config = getChainConfig(network);

      // Validate required fields
      if (!config.chainId) {
        throw new Error(`Missing chainId for ${network}`);
      }
      if (!config.governanceVault) {
        throw new Error(`Missing governanceVault for ${network}`);
      }

      // Validate LayerZero config if applicable
      if (config.layerZero.endpoint !== "0x0000000000000000000000000000000000000000") {
        if (!config.layerZero.lzChainId) {
          throw new Error(`Missing LayerZero chainId for ${network}`);
        }
      }

      // Validate Celer config if applicable
      if (config.celer.messageBus !== "0x0000000000000000000000000000000000000000") {
        if (!config.celer.celerChainId) {
          throw new Error(`Missing Celer chainId for ${network}`);
        }
      }


      console.log(`✅ ${network} configuration is valid`);
    } catch (error) {
      console.error(`❌ ${network} configuration error:`, error);
      process.exit(1);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const network = args[1];

  if (command === "validate") {
    validateConfiguration();
    return;
  }

  if (command === "generate") {
    if (network) {
      // Generate specific network
      if (!CHAIN_CONFIG[network]) {
        console.error(`Unknown network: ${network}`);
        process.exit(1);
      }
      generateParameterFile(network);
    } else {
      // Generate all networks
      console.log("Generating parameter files for all networks...");
      for (const net of Object.keys(CHAIN_CONFIG)) {
        generateParameterFile(net);
      }
    }
    return;
  }

  // Default: generate all
  console.log("Generating parameter files for all networks...");
  for (const net of Object.keys(CHAIN_CONFIG)) {
    generateParameterFile(net);
  }
}

// Handle local hardhat network special case
function generateLocalHardhatParams(): void {
  const params = {
    "//": "AUTO-GENERATED from hardhat.config.ts - DO NOT EDIT MANUALLY",
    "//2": "Run 'npm run config:generate' to regenerate this file",
    LookCoin: {
      totalSupply: "10000000000000000000000000000",
      governanceVault: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    },
    MocksModule: {
      totalSupply: "10000000000000000000000000000",
      governanceVault: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    },
    chainId: 31337,
    lzEndpoint: "0x0000000000000000000000000000000000000000",
    lzChainId: 0,
    celerChainId: 0,
    dvns: [],
    requiredDVNs: [],
    optionalDVNs: [],
    optionalDVNThreshold: 0,
    confirmations: 1,
  };

  const filepath = path.join(IGNITION_PARAMS_DIR, "local-hardhat.json");
  fs.writeFileSync(filepath, JSON.stringify(params, null, 2) + "\n");
  console.log("✅ Generated local-hardhat.json");
}

// Run the script
main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

// Generate local hardhat params as a special case
if (process.argv.includes("generate")) {
  generateLocalHardhatParams();
}
