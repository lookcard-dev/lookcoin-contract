import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("HyperlaneModule", (m) => {
  // Get parameters
  const lookCoin = m.getParameter("lookCoin");
  const mailbox = m.getParameter("mailbox");
  const gasPaymaster = m.getParameter("gasPaymaster");
  const governanceVault = m.getParameter("governanceVault");

  // Validate parameters
  if (!lookCoin || lookCoin === "0x0000000000000000000000000000000000000000") {
    throw new Error("lookCoin address is required");
  }
  if (!mailbox || mailbox === "0x0000000000000000000000000000000000000000") {
    throw new Error("mailbox address is required");
  }
  if (!gasPaymaster || gasPaymaster === "0x0000000000000000000000000000000000000000") {
    throw new Error("gasPaymaster address is required");
  }
  if (!governanceVault || governanceVault === "0x0000000000000000000000000000000000000000") {
    throw new Error("governanceVault address is required");
  }

  // Deploy HyperlaneModule
  const hyperlaneModule = m.contract("HyperlaneModule");

  // Initialize HyperlaneModule
  m.call(hyperlaneModule, "initialize", [lookCoin, mailbox, gasPaymaster, governanceVault]);

  // Set up domain mappings
  const domainMappings = m.getParameter("domainMappings", {
    "56": 56, // BSC
    "97": 97, // BSC Testnet
    "9070": 9070, // Akashic
  });

  for (const [domain, chainId] of Object.entries(domainMappings)) {
    m.call(hyperlaneModule, "setDomainMapping", [parseInt(domain), chainId]);
  }

  // Set up trusted senders
  const trustedSenders = m.getParameter("trustedSenders", {});
  for (const [domain, sender] of Object.entries(trustedSenders)) {
    if (sender && sender !== "0x0000000000000000000000000000000000000000") {
      m.call(hyperlaneModule, "setTrustedSender", [parseInt(domain), sender]);
    }
  }

  // Set ISM if provided
  const ism = m.getParameter("ism");
  if (ism && ism !== "0x0000000000000000000000000000000000000000") {
    m.call(hyperlaneModule, "setInterchainSecurityModule", [ism]);
  }

  // Set gas amount
  const requiredGasAmount = m.getParameter("requiredGasAmount", 200000);
  m.call(hyperlaneModule, "setRequiredGasAmount", [requiredGasAmount]);

  // Grant roles
  m.call(lookCoin, "grantRole", [
    "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6", // MINTER_ROLE
    hyperlaneModule,
  ]);

  m.call(lookCoin, "grantRole", [
    "0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848", // BURNER_ROLE
    hyperlaneModule,
  ]);

  // Set Hyperlane mailbox on LookCoin
  m.call(lookCoin, "setHyperlaneMailbox", [mailbox]);

  return { hyperlaneModule };
});