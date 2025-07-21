import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("XERC20Module", (m) => {
  // Get parameters
  const lookCoin = m.getParameter("lookCoin");
  const governanceVault = m.getParameter("governanceVault");

  // Validate parameters
  if (!lookCoin || lookCoin === "0x0000000000000000000000000000000000000000") {
    throw new Error("lookCoin address is required");
  }
  if (!governanceVault || governanceVault === "0x0000000000000000000000000000000000000000") {
    throw new Error("governanceVault address is required");
  }

  // Deploy XERC20Module
  const xerc20Module = m.contract("XERC20Module");

  // Initialize XERC20Module
  m.call(xerc20Module, "initialize", [lookCoin, governanceVault]);

  // Register bridges for SuperChain networks
  const bridgeRegistrations = m.getParameter("bridgeRegistrations", {});
  
  for (const [chainId, bridgeConfig] of Object.entries(bridgeRegistrations)) {
    const { bridge, mintingLimit, burningLimit } = bridgeConfig as any;
    
    if (bridge && bridge !== "0x0000000000000000000000000000000000000000") {
      m.call(xerc20Module, "registerBridge", [
        bridge,
        parseInt(chainId),
        mintingLimit || "1000000000000000000000000", // 1M tokens default
        burningLimit || "1000000000000000000000000", // 1M tokens default
      ]);
    }
  }

  // Authorize XERC20Module as a bridge on LookCoin
  m.call(lookCoin, "setAuthorizedBridge", [xerc20Module, true]);

  // Grant minting/burning roles if using role-based system
  m.call(lookCoin, "grantRole", [
    "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6", // MINTER_ROLE
    xerc20Module,
  ]);

  m.call(lookCoin, "grantRole", [
    "0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848", // BURNER_ROLE
    xerc20Module,
  ]);

  // Set limits on LookCoin for the module
  const moduleMintingLimit = m.getParameter("moduleMintingLimit", "10000000000000000000000000"); // 10M tokens
  const moduleBurningLimit = m.getParameter("moduleBurningLimit", "10000000000000000000000000"); // 10M tokens
  
  m.call(lookCoin, "setLimits", [xerc20Module, moduleMintingLimit, moduleBurningLimit]);

  return { xerc20Module };
});