import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { parseEther } from "ethers";
import {
  validateParseEther,
  validateChainId,
  createParameterError,
  parseJsonParameter,
  validateFeeParameters,
} from "../utils/parameterValidation";

const MocksModule = buildModule("MocksModule", (m) => {
  // Get and validate deployment parameters
  let baseChainId: number;
  let supportedChains: number[] = [];
  let celerFeeBase: bigint;
  let celerFeePerByte: bigint;

  try {
    // Get base chain ID from parameter or default
    const chainIdParam = m.getParameter("mockBaseChainId", 56); // Default to BSC
    
    // Validate chain ID if it's a number
    if (typeof chainIdParam === "number") {
      baseChainId = validateChainId(chainIdParam, "mockBaseChainId");
    } else {
      // If it's not a number at module build time, use the default
      baseChainId = 56; // BSC mainnet
      console.warn("Warning: mockBaseChainId parameter is not a number at build time, using default BSC (56)");
    }

    // Parse supported chains from parameter
    const supportedChainsParam = m.getParameter("mockSupportedChains", "56,8453,10,23295,999");
    if (typeof supportedChainsParam === "string") {
      supportedChains = supportedChainsParam.split(",").map((id) => {
        const chainId = parseInt(id.trim());
        if (isNaN(chainId)) {
          throw createParameterError("mockSupportedChains", "comma-separated chain IDs", id);
        }
        return validateChainId(chainId, `mockSupportedChains[${id}]`);
      });
    } else if (Array.isArray(supportedChainsParam)) {
      supportedChains = (supportedChainsParam as number[]).map((id) =>
        validateChainId(id, `mockSupportedChains[${id}]`),
      );
    }

    // Validate Celer fee parameters
    const feeBaseParam = m.getParameter("celerFeeBase", "0.001");
    if (typeof feeBaseParam === "string") {
      celerFeeBase = validateParseEther(feeBaseParam, "celerFeeBase");
    } else if (typeof feeBaseParam === "bigint") {
      celerFeeBase = feeBaseParam;
    } else {
      // Default if parameter type is not recognized at build time
      celerFeeBase = parseEther("0.001");
      console.warn("Warning: celerFeeBase parameter type not recognized at build time, using default");
    }

    const feePerByteParam = m.getParameter("celerFeePerByte", "0.000000001"); // 1 gwei per byte
    if (typeof feePerByteParam === "string") {
      celerFeePerByte = validateParseEther(feePerByteParam, "celerFeePerByte");
    } else if (typeof feePerByteParam === "bigint") {
      celerFeePerByte = feePerByteParam;
    } else {
      // Default if parameter type is not recognized at build time
      celerFeePerByte = parseEther("0.000000001");
      console.warn("Warning: celerFeePerByte parameter type not recognized at build time, using default");
    }

    // Skip fee validation at build time
    // Fee parameters will be validated at runtime

  } catch (error: any) {
    throw new Error(`MocksModule parameter validation failed: ${error.message}`);
  }

  // Deploy MockLayerZero contracts
  const mockLayerZeroEndpoint = m.contract("MockLayerZeroEndpoint");
  const mockDVN = m.contract("MockDVN");
  const mockUltraLightNode = m.contract("MockUltraLightNode", [baseChainId]);

  // Configure MockLayerZero endpoint
  m.call(mockLayerZeroEndpoint, "setUltraLightNode", [mockUltraLightNode], {
    id: "setUltraLightNode",
  });

  // Set up chain configurations for LayerZero - now parameter-driven
  supportedChains.forEach((chainId) => {
    m.call(mockLayerZeroEndpoint, "setDestination", [chainId, mockLayerZeroEndpoint], {
      id: `setDestination_${chainId}`,
    });
  });

  // Deploy MockCeler contracts
  const mockMessageBus = m.contract("MockMessageBus");
  const mockSGN = m.contract("MockSGN");
  const mockCBridge = m.contract("MockCBridge");

  // Configure MockMessageBus
  m.call(mockMessageBus, "setSGN", [mockSGN], {
    id: "setSGN",
  });
  m.call(mockMessageBus, "setCBridge", [mockCBridge], {
    id: "setCBridge",
  });

  // Set up fee parameters for Celer with validated values
  m.call(mockMessageBus, "setFeeParams", [celerFeeBase, celerFeePerByte], {
    id: "setFeeParams",
  });


  // Deploy utility contracts for testing
  const mockTimeDelay = m.contract("MockTimeDelay");
  const mockNetworkSimulator = m.contract("MockNetworkSimulator");

  // Configure network simulator with parameterized conditions
  const networkLatency = m.getParameter("networkLatency", 1000) as number; // latency in ms
  const packetLoss = m.getParameter("packetLoss", 0) as number; // packet loss percentage
  const networkJitter = m.getParameter("networkJitter", 100) as number; // jitter in ms

  // Validate network simulator parameters
  if (networkLatency < 0) {
    throw createParameterError("networkLatency", "non-negative number", networkLatency.toString());
  }
  if (packetLoss < 0 || packetLoss > 100) {
    throw createParameterError("packetLoss", "percentage between 0 and 100", packetLoss.toString());
  }
  if (networkJitter < 0) {
    throw createParameterError("networkJitter", "non-negative number", networkJitter.toString());
  }

  m.call(mockNetworkSimulator, "setConditions", [networkLatency, packetLoss, networkJitter], {
    id: "setNetworkConditions",
  });

  return {
    // LayerZero mocks
    mockLayerZeroEndpoint,
    mockDVN,
    mockUltraLightNode,

    // Celer mocks
    mockMessageBus,
    mockSGN,
    mockCBridge,


    // Utility mocks
    mockTimeDelay,
    mockNetworkSimulator,
  };
});

export default MocksModule;
