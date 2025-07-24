import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("ProtocolRegistryModule", (m) => {
  // Get parameters
  const governanceVault = m.getParameter("governanceVault");

  // Validate parameters
  if (!governanceVault || governanceVault === "0x0000000000000000000000000000000000000000") {
    throw new Error("governanceVault address is required");
  }

  // Deploy ProtocolRegistry
  const protocolRegistry = m.contract("ProtocolRegistry");

  // Initialize ProtocolRegistry
  m.call(protocolRegistry, "initialize", [governanceVault]);

  // Register initial protocols if modules are provided
  const layerZeroModule = m.getParameter("layerZeroModule");
  const celerModule = m.getParameter("celerModule");
  const hyperlaneModule = m.getParameter("hyperlaneModule");

  // Get supported chains for each protocol
  const layerZeroChains = m.getParameter("layerZeroChains", [1, 56, 10, 137, 8453, 42161]);
  const celerChains = m.getParameter("celerChains", [56, 10, 23295]);
  const hyperlaneChains = m.getParameter("hyperlaneChains", [56, 8453, 10, 9070]);

  if (layerZeroModule && layerZeroModule !== "0x0000000000000000000000000000000000000000") {
    m.call(protocolRegistry, "registerProtocol", [
      0, // Protocol.LayerZero
      layerZeroModule,
      "1.0.0",
      layerZeroChains,
    ]);
  }

  if (celerModule && celerModule !== "0x0000000000000000000000000000000000000000") {
    m.call(protocolRegistry, "registerProtocol", [
      1, // Protocol.Celer
      celerModule,
      "1.0.0",
      celerChains,
    ]);
  }


  if (hyperlaneModule && hyperlaneModule !== "0x0000000000000000000000000000000000000000") {
    m.call(protocolRegistry, "registerProtocol", [
      2, // Protocol.Hyperlane
      hyperlaneModule,
      "1.0.0",
      hyperlaneChains,
    ]);
  }

  return { protocolRegistry };
});