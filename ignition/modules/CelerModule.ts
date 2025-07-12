import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroAddress } from "ethers";

const CelerModule = buildModule("CelerModule", (m) => {
  // Module parameters
  const messageBus = m.getParameter("messageBus", ZeroAddress);
  const lookCoin = m.getParameter("lookCoin", ZeroAddress);
  const admin = m.getParameter("admin", m.getAccount(0));
  const chainId = m.getParameter("chainId", 56); // Current chain ID

  // Deploy CelerIMModule
  const celerIMModule = m.contract("CelerIMModule");

  // Initialize the module
  m.call(celerIMModule, "initialize", [messageBus, lookCoin, admin]);

  // Configure remote modules for supported chains
  const remoteModules = m.getParameter("remoteModules", {});
  const supportedChains = [56, 10, 23295]; // BSC, Optimism, Sapphire

  for (const remoteChainId of supportedChains) {
    if (remoteChainId !== chainId && remoteModules[remoteChainId]) {
      m.call(celerIMModule, "setRemoteModule", [
        remoteChainId,
        remoteModules[remoteChainId],
      ]);
    }
  }

  // Grant MINTER_ROLE on LookCoin to the bridge module
  if (lookCoin !== ZeroAddress) {
    const lookCoinContract = m.contractAt("LookCoin", lookCoin);
    // Note: MINTER_ROLE granting should be done separately after deployment
    // as we need the computed keccak256 hash of "MINTER_ROLE"
  }

  // Configure fee parameters
  const feePercentage = m.getParameter("feePercentage", 50); // 0.5%
  const minFee = m.getParameter("minFee", 10n * 10n ** 18n);
  const maxFee = m.getParameter("maxFee", 1000n * 10n ** 18n);
  const feeCollector = m.getParameter("feeCollector", admin);

  m.call(celerIMModule, "updateFeeParameters", [feePercentage, minFee, maxFee]);
  m.call(celerIMModule, "updateFeeCollector", [feeCollector]);

  // Set up initial whitelist (optional)
  // Note: Whitelist configuration should be done post-deployment
  // as parameters don't support array types well

  return {
    celerIMModule,
    messageBus,
    lookCoin,
    admin,
    chainId,
    remoteModules,
  };
});

export default CelerModule;