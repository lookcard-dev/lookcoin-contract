import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroAddress, parseEther } from "ethers";
import {
  validateAddress,
  validateNonZeroAddress,
  validateRemoteModules,
  validateFeeParameters,
  validateParseEther,
  createParameterError,
  validateChainId,
} from "../utils/parameterValidation";

const CelerModule = buildModule("CelerModule", (m) => {
  // Validate and parse parameters
  let messageBus: any; // Can be string or contract reference
  let lookCoin: any; // Can be string or contract reference
  let governanceVault: any; // Can be string or AccountRuntimeValue
  let chainId: number;
  let remoteModules: { [chainId: string]: string } = {};
  let feePercentage: number;
  let minFee: bigint;
  let maxFee: bigint;
  let feeCollector: any; // Can be string or AccountRuntimeValue

  try {
    // Get message bus parameter
    const messageBusParam = m.getParameter("messageBus", ZeroAddress);
    if (messageBusParam === ZeroAddress) {
      console.warn("Warning: messageBus is ZeroAddress, Celer features will be disabled");
      messageBus = ZeroAddress;
    } else if (typeof messageBusParam === "string") {
      messageBus = validateNonZeroAddress(messageBusParam, "messageBus");
    } else {
      // It's a contract reference or other object, use as-is
      messageBus = messageBusParam;
    }

    // Get lookCoin parameter
    const lookCoinParam = m.getParameter("lookCoin", ZeroAddress);
    if (lookCoinParam === ZeroAddress) {
      console.warn("Warning: lookCoin is ZeroAddress, bridge functionality will be limited");
      lookCoin = ZeroAddress;
    } else if (typeof lookCoinParam === "string") {
      lookCoin = validateNonZeroAddress(lookCoinParam, "lookCoin");
    } else {
      // It's a contract reference or other object, use as-is
      lookCoin = lookCoinParam;
    }

    // Get governance vault parameter
    const governanceVaultParam = m.getParameter("governanceVault", m.getAccount(0));
    
    // If it's a string, validate it
    if (typeof governanceVaultParam === "string") {
      governanceVault = validateNonZeroAddress(governanceVaultParam, "governanceVault");
    } else {
      // Otherwise, it's an AccountRuntimeValue from m.getAccount(0)
      governanceVault = governanceVaultParam;
    }

    // Get chain ID parameter
    const chainIdParam = m.getParameter("chainId", 56); // Default to BSC
    
    // Validate chain ID if it's a number
    if (typeof chainIdParam === "number") {
      chainId = validateChainId(chainIdParam, "chainId");
    } else {
      // If it's not a number at module build time, use the default
      chainId = 56; // BSC mainnet
      console.warn("Warning: chainId parameter is not a number at build time, using default BSC (56)");
    }

    // Parse and validate remote modules from JSON string
    const remoteModulesParam = m.getParameter("remoteModules", "{}");
    if (typeof remoteModulesParam === "string") {
      remoteModules = validateRemoteModules(remoteModulesParam, "remoteModules", chainId);
    } else if (typeof remoteModulesParam === "object") {
      // If it's already an object, validate it if possible
      try {
        for (const [remoteChainIdStr, address] of Object.entries(remoteModulesParam)) {
          const remoteChainId = parseInt(remoteChainIdStr);
          if (isNaN(remoteChainId)) {
            // Skip validation at build time if keys are not numeric
            console.warn(`Warning: remoteModules key '${remoteChainIdStr}' is not numeric at build time, skipping validation`);
            continue;
          }
          if (remoteChainId === chainId) {
            console.warn(`Warning: remoteModules contains current chain ID ${remoteChainId}`);
            continue;
          }
          if (typeof address === "string") {
            validateNonZeroAddress(address, `remoteModules.${remoteChainIdStr}`);
          }
          remoteModules[remoteChainIdStr] = address as string;
        }
      } catch (e) {
        // If object.entries fails (due to computed properties), use as-is
        remoteModules = remoteModulesParam as any;
      }
    }

    // Validate fee percentage
    feePercentage = m.getParameter("feePercentage", 50) as number; // 0.5% in basis points
    if (feePercentage < 0 || feePercentage > 10000) {
      throw createParameterError("feePercentage", "0-10000 (basis points)", feePercentage.toString());
    }

    // Parse and validate min fee
    const minFeeParam = m.getParameter("minFee", "10"); // 10 LOOK tokens as string
    if (typeof minFeeParam === "string") {
      minFee = validateParseEther(minFeeParam, "minFee");
    } else if (typeof minFeeParam === "bigint") {
      minFee = minFeeParam;
    } else {
      // Handle legacy format (10n * 10n ** 18n)
      minFee = parseEther("10");
    }

    // Parse and validate max fee
    const maxFeeParam = m.getParameter("maxFee", "1000"); // 1000 LOOK tokens as string
    if (typeof maxFeeParam === "string") {
      maxFee = validateParseEther(maxFeeParam, "maxFee");
    } else if (typeof maxFeeParam === "bigint") {
      maxFee = maxFeeParam;
    } else {
      // Handle legacy format (1000n * 10n ** 18n)
      maxFee = parseEther("1000");
    }

    // Validate fee parameters relationship
    if (minFee > maxFee) {
      throw createParameterError("minFee", `<= maxFee (${maxFee})`, minFee.toString());
    }

    // Get fee collector parameter
    const feeCollectorParam = m.getParameter("feeCollector", governanceVault);
    
    // If it's a string, validate it
    if (typeof feeCollectorParam === "string") {
      feeCollector = validateNonZeroAddress(feeCollectorParam, "feeCollector");
    } else {
      // Otherwise, it's an AccountRuntimeValue or same as governanceVault
      feeCollector = feeCollectorParam;
    }
  } catch (error: any) {
    throw new Error(`CelerModule parameter validation failed: ${error.message}`);
  }

  // Deploy CelerIMModule
  const celerIMModule = m.contract("CelerIMModule");

  // Initialize the module with validated parameters
  m.call(celerIMModule, "initialize", [messageBus, lookCoin, governanceVault], {
    id: "initializeCeler",
  });

  // Configure remote modules for supported chains
  const supportedChains = m.getParameter("celerSupportedChains", "56,10,23295"); // BSC, Optimism, Sapphire
  let chainIds: number[] = [];

  if (typeof supportedChains === "string") {
    chainIds = supportedChains.split(",").map((id) => {
      const parsedId = parseInt(id.trim());
      if (isNaN(parsedId)) {
        throw createParameterError("celerSupportedChains", "comma-separated chain IDs", id);
      }
      return validateChainId(parsedId, `celerSupportedChains[${id}]`);
    });
  } else if (Array.isArray(supportedChains)) {
    chainIds = (supportedChains as number[]).map((id) => validateChainId(id, `celerSupportedChains[${id}]`));
  }

  // Set remote modules for each supported chain
  for (const remoteChainId of chainIds) {
    if (remoteChainId !== chainId && remoteModules[remoteChainId.toString()]) {
      m.call(celerIMModule, "setRemoteModule", [remoteChainId, remoteModules[remoteChainId.toString()]], {
        id: `setRemoteModule_${remoteChainId}`,
      });
    }
  }

  // Configure fee parameters with validated values
  m.call(celerIMModule, "updateFeeParameters", [feePercentage, minFee, maxFee], {
    id: "updateFeeParameters",
  });
  m.call(celerIMModule, "updateFeeCollector", [feeCollector], {
    id: "updateFeeCollector",
  });

  // Note: MINTER_ROLE granting and whitelist configuration should be done post-deployment
  // as they require the deployed contract addresses

  return {
    celerIMModule,
  };
});

export default CelerModule;
