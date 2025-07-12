import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { parseEther } from "ethers";

const MocksModule = buildModule("MocksModule", (m) => {
  // Deploy MockLayerZero contracts
  const mockLayerZeroEndpoint = m.contract("MockLayerZeroEndpoint");
  const mockDVN = m.contract("MockDVN");
  const mockUltraLightNode = m.contract("MockUltraLightNode", [56]); // BSC chain ID

  // Configure MockLayerZero endpoint
  m.call(mockLayerZeroEndpoint, "setUltraLightNode", [mockUltraLightNode]);
  
  // Set up chain configurations for LayerZero - hardcoded for testing
  const testChainIds = [56, 8453, 10, 23295, 999];
  m.call(mockLayerZeroEndpoint, "setDestination", [56, mockLayerZeroEndpoint]);
  m.call(mockLayerZeroEndpoint, "setDestination", [8453, mockLayerZeroEndpoint]);
  m.call(mockLayerZeroEndpoint, "setDestination", [10, mockLayerZeroEndpoint]);
  m.call(mockLayerZeroEndpoint, "setDestination", [23295, mockLayerZeroEndpoint]);
  m.call(mockLayerZeroEndpoint, "setDestination", [999, mockLayerZeroEndpoint]);

  // Deploy MockCeler contracts
  const mockMessageBus = m.contract("MockMessageBus");
  const mockSGN = m.contract("MockSGN");
  const mockCBridge = m.contract("MockCBridge");

  // Configure MockMessageBus
  m.call(mockMessageBus, "setSGN", [mockSGN]);
  m.call(mockMessageBus, "setCBridge", [mockCBridge]);
  
  // Set up fee parameters for Celer
  const feeBase = m.getParameter("celerFeeBase", parseEther("0.001"));
  const feePerByte = m.getParameter("celerFeePerByte", 1000); // wei per byte
  m.call(mockMessageBus, "setFeeParams", [feeBase, feePerByte]);

  // Deploy MockIBC contracts
  const mockIBCRelayer = m.contract("MockIBCRelayer");
  const mockAkashicValidators = m.contract("MockAkashicValidators");
  const mockIBCLightClient = m.contract("MockIBCLightClient");

  // Configure IBC validators (21 validators as per spec)
  // Note: Validator setup should be done post-deployment

  // Set up IBC parameters
  const packetTimeout = m.getParameter("ibcPacketTimeout", 3600); // 1 hour
  const unbondingPeriod = m.getParameter("ibcUnbondingPeriod", 14 * 24 * 60 * 60); // 14 days
  m.call(mockIBCRelayer, "setTimeoutParams", [packetTimeout, unbondingPeriod]);

  // Deploy utility contracts for testing
  const mockTimeDelay = m.contract("MockTimeDelay");
  const mockNetworkSimulator = m.contract("MockNetworkSimulator");

  // Configure network simulator with default conditions
  m.call(mockNetworkSimulator, "setConditions", [
    1000, // latency in ms
    0,    // packet loss percentage
    100,  // jitter in ms
  ]);

  return {
    // LayerZero mocks
    mockLayerZeroEndpoint,
    mockDVN,
    mockUltraLightNode,
    
    // Celer mocks
    mockMessageBus,
    mockSGN,
    mockCBridge,
    
    // IBC mocks
    mockIBCRelayer,
    mockAkashicValidators,
    mockIBCLightClient,
    
    // Utility mocks
    mockTimeDelay,
    mockNetworkSimulator,
    
    // Configuration
    testChainIds,
  };
});

export default MocksModule;