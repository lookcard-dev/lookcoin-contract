import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroAddress, parseEther } from "ethers";
import {
  validateAddress,
  validateNonZeroAddress,
  validateRemoteModules,
  validateFeeParameters,
  validateParseEther,
  createParameterError,
  validateChainId
} from "../utils/parameterValidation";

const CelerModule = buildModule("CelerModule", (m) => {
  // Validate and parse parameters
  let messageBus: string;
  let lookCoin: string;
  let governanceVault: string;
  let chainId: number;
  let remoteModules: { [chainId: string]: string } = {};
  let feePercentage: number;
  let minFee: bigint;
  let maxFee: bigint;
  let feeCollector: string;
  
  try {
    // Validate message bus address
    const messageBusParam = m.getParameter("messageBus", ZeroAddress);
    if (messageBusParam === ZeroAddress) {
      console.warn("Warning: messageBus is ZeroAddress, Celer features will be disabled");
      messageBus = ZeroAddress;
    } else {
      messageBus = validateNonZeroAddress(messageBusParam as string, "messageBus");
    }
    
    // Validate lookCoin address
    const lookCoinParam = m.getParameter("lookCoin", ZeroAddress);
    if (lookCoinParam === ZeroAddress) {
      console.warn("Warning: lookCoin is ZeroAddress, bridge functionality will be limited");
      lookCoin = ZeroAddress;
    } else {
      lookCoin = validateNonZeroAddress(lookCoinParam as string, "lookCoin");
    }
    
    // Validate governance vault
    const governanceVaultParam = m.getParameter("governanceVault", m.getAccount(0));
    governanceVault = validateNonZeroAddress(governanceVaultParam as string, "governanceVault");
    
    // Validate chain ID
    const chainIdParam = m.getParameter("chainId", 56); // Default to BSC
    chainId = validateChainId(chainIdParam as number, "chainId");
    
    // Parse and validate remote modules from JSON string
    const remoteModulesParam = m.getParameter("remoteModules", "{}");
    if (typeof remoteModulesParam === "string") {
      remoteModules = validateRemoteModules(remoteModulesParam, "remoteModules", chainId);
    } else if (typeof remoteModulesParam === "object") {
      // If it's already an object, validate it
      for (const [remoteChainIdStr, address] of Object.entries(remoteModulesParam)) {
        const remoteChainId = parseInt(remoteChainIdStr);
        if (isNaN(remoteChainId)) {
          throw createParameterError(`remoteModules.${remoteChainIdStr}`, "numeric chain ID", remoteChainIdStr);
        }
        if (remoteChainId === chainId) {
          throw createParameterError(`remoteModules.${remoteChainIdStr}`, "different from current chain ID", remoteChainIdStr);
        }
        validateNonZeroAddress(address as string, `remoteModules.${remoteChainIdStr}`);
        remoteModules[remoteChainIdStr] = address as string;
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
    
    // Validate fee collector
    const feeCollectorParam = m.getParameter("feeCollector", governanceVault);
    feeCollector = validateNonZeroAddress(feeCollectorParam as string, "feeCollector");
    
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
    chainIds = supportedChains.split(',').map(id => {
      const parsedId = parseInt(id.trim());
      if (isNaN(parsedId)) {
        throw createParameterError("celerSupportedChains", "comma-separated chain IDs", id);
      }
      return validateChainId(parsedId, `celerSupportedChains[${id}]`);
    });
  } else if (Array.isArray(supportedChains)) {
    chainIds = (supportedChains as number[]).map(id => 
      validateChainId(id, `celerSupportedChains[${id}]`)
    );
  }

  // Set remote modules for each supported chain
  for (const remoteChainId of chainIds) {
    if (remoteChainId !== chainId && remoteModules[remoteChainId.toString()]) {
      m.call(celerIMModule, "setRemoteModule", [
        remoteChainId,
        remoteModules[remoteChainId.toString()],
      ], {
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