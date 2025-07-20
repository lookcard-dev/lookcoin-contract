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
  let governanceVault: string;
  let lzEndpoint: string;
  let totalSupply: bigint;
  let chainId: number;
  let dvnAddresses: string[] = [];

  try {
    // Validate governance vault
    const governanceVaultParam = m.getParameter("governanceVault", m.getAccount(0));
    governanceVault = validateNonZeroAddress(governanceVaultParam as string, "governanceVault");

    // Validate LayerZero endpoint (can be ZeroAddress)
    const lzEndpointParam = m.getParameter("lzEndpoint", ZeroAddress);
    if (lzEndpointParam === ZeroAddress) {
      console.warn("Warning: lzEndpoint is ZeroAddress, LayerZero features will be disabled");
      lzEndpoint = ZeroAddress;
    } else {
      lzEndpoint = validateAddress(lzEndpointParam as string, "lzEndpoint");
    }

    // Parse and validate total supply
    const totalSupplyParam = m.getParameter("totalSupply", "1000000000"); // 1B tokens as string
    if (typeof totalSupplyParam === "string") {
      totalSupply = validateParseEther(totalSupplyParam, "totalSupply");
    } else {
      // Handle case where parseEther was already called
      totalSupply = totalSupplyParam as bigint;
    }

    // Validate chain ID
    const chainIdParam = m.getParameter("chainId", 56); // Default to BSC
    chainId = validateChainId(chainIdParam as number, "chainId");

    // Parse DVN addresses from comma-separated string if provided
    const dvnsParam = m.getParameter("dvns", "");
    if (dvnsParam && dvnsParam !== "" && lzEndpoint !== ZeroAddress) {
      dvnAddresses = parseCommaSeparatedAddresses(dvnsParam as string, "dvns");
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
