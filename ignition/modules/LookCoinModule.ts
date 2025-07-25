import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroAddress, parseEther } from "ethers";
import {
  validateAddress,
  validateNonZeroAddress,
  parseCommaSeparatedAddresses,
  validateParseEther,
  validateDVNParameters,
  createParameterError,
  validateChainId,
} from "../utils/parameterValidation";

const LookCoinModule = buildModule("LookCoinModule", (m) => {
  // Validate and parse parameters
  let governanceVault: any; // Can be string or AccountRuntimeValue
  let lzEndpoint: any; // Can be string or contract reference
  let totalSupply: bigint;
  let chainId: number;
  let dvnAddresses: any[] = []; // Can be strings or contract references

  try {
    // Get governance vault parameter
    const governanceVaultParam = m.getParameter("governanceVault", m.getAccount(0));
    
    // If it's a string, validate it
    if (typeof governanceVaultParam === "string") {
      governanceVault = validateNonZeroAddress(governanceVaultParam, "governanceVault");
    } else {
      // Otherwise, it's an AccountRuntimeValue from m.getAccount(0)
      governanceVault = governanceVaultParam;
    }

    // Get LayerZero endpoint parameter
    const lzEndpointParam = m.getParameter("lzEndpoint", ZeroAddress);
    
    // Handle different parameter types
    if (lzEndpointParam === ZeroAddress) {
      console.warn("Warning: lzEndpoint is ZeroAddress, LayerZero features will be disabled");
      lzEndpoint = ZeroAddress;
    } else if (typeof lzEndpointParam === "string") {
      lzEndpoint = validateAddress(lzEndpointParam, "lzEndpoint");
    } else {
      // It's a contract reference or other object, use as-is
      lzEndpoint = lzEndpointParam as any;
    }

    // Parse and validate total supply
    const totalSupplyParam = m.getParameter("totalSupply", "1000000000"); // 1B tokens as string
    if (typeof totalSupplyParam === "string") {
      totalSupply = validateParseEther(totalSupplyParam, "totalSupply");
    } else {
      // Handle case where parseEther was already called
      totalSupply = totalSupplyParam as bigint;
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

    // Parse DVN addresses if provided
    const dvnsParam = m.getParameter("dvns", "");
    if (dvnsParam && dvnsParam !== "" && lzEndpoint !== ZeroAddress) {
      if (typeof dvnsParam === "string") {
        dvnAddresses = parseCommaSeparatedAddresses(dvnsParam, "dvns");
      } else if (Array.isArray(dvnsParam)) {
        // It's already an array of addresses or contract references
        dvnAddresses = dvnsParam;
      }
    }
  } catch (error: any) {
    throw new Error(`LookCoinModule parameter validation failed: ${error.message}`);
  }

  // Deploy LookCoin implementation
  const lookCoinImpl = m.contract("LookCoin", [], { id: "LookCoinImpl" });

  // Encode initialization data with validated parameters
  const initData = m.encodeFunctionCall(lookCoinImpl, "initialize", [governanceVault, lzEndpoint]);

  // Deploy UUPS proxy
  const proxy = m.contract("contracts/test/UUPSProxy.sol:UUPSProxy", [lookCoinImpl, initData], { id: "LookCoinProxy" });

  // Get proxy as LookCoin interface
  const lookCoin = m.contractAt("LookCoin", proxy, { id: "LookCoinProxyInterface" });

  // Configure initial DVN settings if LayerZero endpoint is provided and DVNs are configured
  if (lzEndpoint !== ZeroAddress && dvnAddresses.length > 0) {
    try {
      // Get DVN configuration parameters
      const requiredDVNs = m.getParameter("requiredDVNs", 2) as number;
      const optionalDVNs = m.getParameter("optionalDVNs", 1) as number;
      const threshold = m.getParameter("dvnThreshold", 66) as number; // 66%

      // Validate DVN parameters
      validateDVNParameters({
        dvns: dvnAddresses.join(","),
        requiredDVNs,
        optionalDVNs,
        dvnThreshold: threshold,
      });

      // Validate threshold percentage
      if (threshold < 1 || threshold > 100) {
        throw createParameterError("dvnThreshold", "percentage between 1 and 100", threshold.toString());
      }

      // Configure DVNs
      m.call(lookCoin, "configureDVN", [dvnAddresses, requiredDVNs, optionalDVNs, threshold], {
        id: "configureDVN",
      });
    } catch (error: any) {
      throw new Error(`DVN configuration failed: ${error.message}`);
    }
  }

  // Note: Rate limiting is automatically configured during initialization
  // Additional configuration can be done post-deployment if needed

  return {
    lookCoin,
    implementation: lookCoinImpl,
    proxy,
  };
});

export default LookCoinModule;
