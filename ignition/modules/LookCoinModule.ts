import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroAddress, parseEther } from "ethers";

const LookCoinModule = buildModule("LookCoinModule", (m) => {
  // Module parameters
  const admin = m.getParameter("admin", m.getAccount(0));
  const lzEndpoint = m.getParameter("lzEndpoint", ZeroAddress);
  const totalSupply = m.getParameter("totalSupply", parseEther("1000000000")); // 1B tokens
  const chainId = m.getParameter("chainId", 56); // Default to BSC

  // Deploy LookCoin implementation
  const lookCoinImpl = m.contract("LookCoin", [], { id: "LookCoinImpl" });

  // Encode initialization data
  const initData = m.encodeFunctionCall(lookCoinImpl, "initialize", [
    admin,
    lzEndpoint,
  ]);

  // Deploy UUPS proxy
  const proxy = m.contract("UUPSProxy", [
    lookCoinImpl,
    initData,
  ], { id: "LookCoinProxy" });

  // Get proxy as LookCoin interface
  const lookCoin = m.contractAt("LookCoin", proxy, { id: "LookCoinProxyInterface" });

  // Grant roles to admin
  m.call(lookCoin, "grantRole", [m.readEventArgument(lookCoin, "RoleGranted", "role", { emitter: lookCoin, eventIndex: 0 }), admin]);
  
  // Configure initial DVN settings if LayerZero endpoint is provided
  if (lzEndpoint !== ZeroAddress) {
    // Example DVN addresses (these should be parameterized for production)
    const dvns = m.getParameter("dvns", []);
    const requiredDVNs = m.getParameter("requiredDVNs", 2);
    const optionalDVNs = m.getParameter("optionalDVNs", 1);
    const threshold = m.getParameter("dvnThreshold", 66); // 66%

    if (dvns.length > 0) {
      m.call(lookCoin, "configureDVN", [dvns, requiredDVNs, optionalDVNs, threshold]);
    }
  }

  // Configure rate limiting
  const configureRateLimits = m.getParameter("configureRateLimits", true);
  if (configureRateLimits) {
    // Rate limits are configured in the initialize function
    // Additional configuration can be done here if needed
  }

  return {
    lookCoin,
    implementation: lookCoinImpl,
    proxy,
    admin,
    totalSupply,
    chainId,
  };
});

export default LookCoinModule;