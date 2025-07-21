import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("LayerZeroModule", (m) => {
  // Get parameters
  const lookCoin = m.getParameter("lookCoin");
  const lzEndpoint = m.getParameter("lzEndpoint");
  const governanceVault = m.getParameter("governanceVault");

  // Validate parameters
  if (!lookCoin || lookCoin === "0x0000000000000000000000000000000000000000") {
    throw new Error("lookCoin address is required");
  }
  if (!lzEndpoint || lzEndpoint === "0x0000000000000000000000000000000000000000") {
    throw new Error("lzEndpoint address is required");
  }
  if (!governanceVault || governanceVault === "0x0000000000000000000000000000000000000000") {
    throw new Error("governanceVault address is required");
  }

  // Deploy LayerZeroModule
  const layerZeroModule = m.contract("LayerZeroModule");

  // Initialize LayerZeroModule
  m.call(layerZeroModule, "initialize", [lookCoin, lzEndpoint, governanceVault]);

  // Set up chain mappings
  const chainMappings = m.getParameter("chainMappings", {
    "101": 1, // Ethereum
    "102": 56, // BSC
    "109": 10, // Optimism
    "110": 137, // Polygon
    "184": 8453, // Base
    "40161": 42161, // Arbitrum
    "40217": 97, // BSC Testnet
    "40232": 11155111, // Sepolia
  });

  for (const [lzChainId, standardChainId] of Object.entries(chainMappings)) {
    m.call(layerZeroModule, "updateChainMapping", [parseInt(lzChainId), standardChainId]);
  }

  // Set trusted remotes
  const trustedRemotes = m.getParameter("trustedRemotes", {});
  for (const [lzChainId, remote] of Object.entries(trustedRemotes)) {
    if (remote && remote !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      // Note: connectPeer function needs to be called on the LayerZeroModule
      // This is typically done in the configure script after deployment
    }
  }

  // Set gas limits
  const minDstGasLookup = m.getParameter("minDstGasLookup", {
    "101": 350000,
    "102": 350000,
    "109": 350000,
    "184": 350000,
  });

  // Grant roles to LayerZeroModule
  m.call(lookCoin, "grantRole", [
    "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6", // MINTER_ROLE
    layerZeroModule,
  ]);

  m.call(lookCoin, "grantRole", [
    "0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848", // BURNER_ROLE
    layerZeroModule,
  ]);

  return { layerZeroModule };
});