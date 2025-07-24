import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("FeeManagerModule", (m) => {
  // Get parameters
  const governanceVault = m.getParameter("governanceVault");

  // Validate parameters
  if (!governanceVault || governanceVault === "0x0000000000000000000000000000000000000000") {
    throw new Error("governanceVault address is required");
  }

  // Deploy FeeManager
  const feeManager = m.contract("FeeManager");

  // Initialize FeeManager
  m.call(feeManager, "initialize", [governanceVault]);

  // Set up initial fee parameters if provided
  const layerZeroModule = m.getParameter("layerZeroModule");
  const celerModule = m.getParameter("celerModule");
  const hyperlaneModule = m.getParameter("hyperlaneModule");

  // Update protocol modules
  if (layerZeroModule && layerZeroModule !== "0x0000000000000000000000000000000000000000") {
    m.call(feeManager, "updateProtocolModule", [0, layerZeroModule]);
  }

  if (celerModule && celerModule !== "0x0000000000000000000000000000000000000000") {
    m.call(feeManager, "updateProtocolModule", [1, celerModule]);
  }


  if (hyperlaneModule && hyperlaneModule !== "0x0000000000000000000000000000000000000000") {
    m.call(feeManager, "updateProtocolModule", [2, hyperlaneModule]);
  }

  // Set initial gas prices if provided
  const chainGasPrices = m.getParameter("chainGasPrices", {});
  for (const [chainId, gasPrice] of Object.entries(chainGasPrices)) {
    if (gasPrice && gasPrice !== "0") {
      m.call(feeManager, "updateGasPrice", [parseInt(chainId), gasPrice]);
    }
  }

  return { feeManager };
});