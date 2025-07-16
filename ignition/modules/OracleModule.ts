import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { parseEther, keccak256, toUtf8Bytes } from "ethers";
import {
  validateNonZeroAddress,
  validateParseEther,
  validateBridgeRegistrations,
  createParameterError,
  validateChainId
} from "../utils/parameterValidation";

const OracleModule = buildModule("OracleModule", (m) => {
  // Validate and parse parameters
  let governanceVault: string;
  let totalSupply: bigint;
  let reconciliationInterval: number;
  let toleranceThreshold: bigint;
  let requiredSignatures: number;
  let bridgeRegistrations: { [chainId: string]: string } = {};
  
  try {
    // Validate governance vault
    const governanceVaultParam = m.getParameter("governanceVault", m.getAccount(0));
    governanceVault = validateNonZeroAddress(governanceVaultParam as string, "governanceVault");
    
    // Parse and validate total supply
    const totalSupplyParam = m.getParameter("totalSupply", "1000000000"); // 1B tokens as string
    if (typeof totalSupplyParam === "string") {
      totalSupply = validateParseEther(totalSupplyParam, "totalSupply");
    } else {
      totalSupply = totalSupplyParam as bigint;
    }
    
    // Validate reconciliation interval
    reconciliationInterval = m.getParameter("reconciliationInterval", 15 * 60) as number; // 15 minutes
    if (reconciliationInterval <= 0) {
      throw createParameterError("reconciliationInterval", "positive number", reconciliationInterval.toString());
    }
    
    // Parse and validate tolerance threshold
    const toleranceThresholdParam = m.getParameter("toleranceThreshold", "1000"); // 1000 tokens as string
    if (typeof toleranceThresholdParam === "string") {
      toleranceThreshold = validateParseEther(toleranceThresholdParam, "toleranceThreshold");
    } else {
      toleranceThreshold = toleranceThresholdParam as bigint;
    }
    
    // Validate required signatures
    requiredSignatures = m.getParameter("requiredSignatures", 3) as number;
    if (requiredSignatures <= 0) {
      throw createParameterError("requiredSignatures", "positive number", requiredSignatures.toString());
    }
    
    // Parse and validate bridge registrations from JSON string
    const bridgeRegistrationsParam = m.getParameter("bridgeRegistrations", "{}");
    if (typeof bridgeRegistrationsParam === "string") {
      bridgeRegistrations = validateBridgeRegistrations(bridgeRegistrationsParam, "bridgeRegistrations");
    } else if (typeof bridgeRegistrationsParam === "object") {
      // If it's already an object, validate each entry
      for (const [chainIdStr, address] of Object.entries(bridgeRegistrationsParam)) {
        const chainId = parseInt(chainIdStr);
        if (isNaN(chainId)) {
          throw createParameterError(`bridgeRegistrations.${chainIdStr}`, "numeric chain ID", chainIdStr);
        }
        validateChainId(chainId, `bridgeRegistrations.${chainIdStr}`);
        validateNonZeroAddress(address as string, `bridgeRegistrations.${chainIdStr}`);
        bridgeRegistrations[chainIdStr] = address as string;
      }
    }
    
  } catch (error: any) {
    throw new Error(`OracleModule parameter validation failed: ${error.message}`);
  }

  // Deploy SupplyOracle
  const supplyOracle = m.contract("SupplyOracle");

  // Initialize the oracle with validated parameters
  m.call(supplyOracle, "initialize", [governanceVault, totalSupply], {
    id: "initializeOracle",
  });

  // Configure reconciliation parameters
  m.call(supplyOracle, "updateReconciliationParams", [reconciliationInterval, toleranceThreshold], {
    id: "updateReconciliationParams",
  });

  // Set up multi-signature requirements
  m.call(supplyOracle, "updateRequiredSignatures", [requiredSignatures], {
    id: "updateRequiredSignatures",
  });

  // Grant emergency role to governance vault
  try {
    const EMERGENCY_ROLE = keccak256(toUtf8Bytes("EMERGENCY_ROLE"));
    m.call(supplyOracle, "grantRole", [EMERGENCY_ROLE, governanceVault], {
      id: "grantEmergencyRole",
    });
  } catch (error: any) {
    throw new Error(`Failed to grant EMERGENCY_ROLE: ${error.message}`);
  }

  // Register bridge contracts for each chain
  const supportedChains = m.getParameter("supportedChains", "56,8453,10,23295,999"); // BSC, Base, Optimism, Sapphire, Akashic
  let chainIds: number[] = [];
  
  if (typeof supportedChains === "string") {
    chainIds = supportedChains.split(',').map(id => {
      const chainId = parseInt(id.trim());
      if (isNaN(chainId)) {
        throw createParameterError("supportedChains", "comma-separated chain IDs", id);
      }
      return validateChainId(chainId, `supportedChains[${id}]`);
    });
  } else if (Array.isArray(supportedChains)) {
    chainIds = (supportedChains as number[]).map(id => 
      validateChainId(id, `supportedChains[${id}]`)
    );
  }

  // Register bridges for supported chains
  for (const chainId of chainIds) {
    const bridgeAddress = bridgeRegistrations[chainId.toString()];
    if (bridgeAddress) {
      m.call(supplyOracle, "registerBridge", [chainId, bridgeAddress], {
        id: `registerBridge_${chainId}`,
      });
    }
  }

  // Note: Oracle and operator role granting should be done post-deployment
  // as they require the deployed contract addresses

  return {
    supplyOracle,
  };
});

export default OracleModule;