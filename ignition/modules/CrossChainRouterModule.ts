import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("CrossChainRouterModule", (m) => {
  // Get parameters
  const lookCoin = m.getParameter("lookCoin");
  const feeManager = m.getParameter("feeManager");
  const securityManager = m.getParameter("securityManager");
  const governanceVault = m.getParameter("governanceVault");

  // Validate parameters
  if (!lookCoin || lookCoin === "0x0000000000000000000000000000000000000000") {
    throw new Error("lookCoin address is required");
  }
  if (!governanceVault || governanceVault === "0x0000000000000000000000000000000000000000") {
    throw new Error("governanceVault address is required");
  }

  // Deploy CrossChainRouter
  const crossChainRouter = m.contract("CrossChainRouter");

  // Initialize CrossChainRouter
  m.call(crossChainRouter, "initialize", [
    lookCoin,
    feeManager || "0x0000000000000000000000000000000000000000",
    securityManager || "0x0000000000000000000000000000000000000000",
    governanceVault,
  ]);

  // Register protocol modules if provided
  const layerZeroModule = m.getParameter("layerZeroModule");
  const celerModule = m.getParameter("celerModule");
  const xerc20Module = m.getParameter("xerc20Module");
  const hyperlaneModule = m.getParameter("hyperlaneModule");

  if (layerZeroModule && layerZeroModule !== "0x0000000000000000000000000000000000000000") {
    m.call(crossChainRouter, "registerProtocol", [0, layerZeroModule]); // Protocol.LayerZero = 0
  }

  if (celerModule && celerModule !== "0x0000000000000000000000000000000000000000") {
    m.call(crossChainRouter, "registerProtocol", [1, celerModule]); // Protocol.Celer = 1
  }

  if (xerc20Module && xerc20Module !== "0x0000000000000000000000000000000000000000") {
    m.call(crossChainRouter, "registerProtocol", [2, xerc20Module]); // Protocol.XERC20 = 2
  }

  if (hyperlaneModule && hyperlaneModule !== "0x0000000000000000000000000000000000000000") {
    m.call(crossChainRouter, "registerProtocol", [3, hyperlaneModule]); // Protocol.Hyperlane = 3
  }

  // Set up chain protocol support based on configuration
  const protocols = m.getParameter("protocols", {
    layerZero: false,
    celer: false,
    xerc20: false,
    hyperlane: false,
  });

  const chainId = m.getParameter("chainId");
  if (chainId) {
    if (protocols.layerZero) {
      m.call(crossChainRouter, "setChainProtocolSupport", [chainId, 0, true]);
    }
    if (protocols.celer) {
      m.call(crossChainRouter, "setChainProtocolSupport", [chainId, 1, true]);
    }
    if (protocols.xerc20) {
      m.call(crossChainRouter, "setChainProtocolSupport", [chainId, 2, true]);
    }
    if (protocols.hyperlane) {
      m.call(crossChainRouter, "setChainProtocolSupport", [chainId, 3, true]);
    }
  }

  return { crossChainRouter };
});