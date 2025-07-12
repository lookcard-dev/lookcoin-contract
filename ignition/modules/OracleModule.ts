import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { parseEther } from "ethers";

const OracleModule = buildModule("OracleModule", (m) => {
  // Module parameters
  const admin = m.getParameter("admin", m.getAccount(0));
  const totalSupply = m.getParameter("totalSupply", parseEther("1000000000")); // 1B tokens
  const reconciliationInterval = m.getParameter("reconciliationInterval", 15 * 60); // 15 minutes
  const toleranceThreshold = m.getParameter("toleranceThreshold", parseEther("1000")); // 1000 tokens

  // Deploy SupplyOracle
  const supplyOracle = m.contract("SupplyOracle");

  // Initialize the oracle
  m.call(supplyOracle, "initialize", [admin, totalSupply]);

  // Configure reconciliation parameters
  m.call(supplyOracle, "updateReconciliationParams", [reconciliationInterval, toleranceThreshold]);

  // Set up multi-signature requirements
  const requiredSignatures = m.getParameter("requiredSignatures", 3);
  m.call(supplyOracle, "updateRequiredSignatures", [requiredSignatures]);

  // Grant oracle and operator roles
  // Note: Role granting should be done post-deployment
  // as parameters don't support array types well

  // Grant emergency roles
  const emergencyOperators = m.getParameter("emergencyOperators", [admin]);
  const EMERGENCY_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EMERGENCY_ROLE"));
  
  for (const operator of emergencyOperators) {
    m.call(supplyOracle, "grantRole", [EMERGENCY_ROLE, operator]);
  }

  // Register bridge contracts for each chain
  const bridgeRegistrations = m.getParameter("bridgeRegistrations", {});
  const supportedChains = [56, 8453, 10, 23295, 999]; // BSC, Base, Optimism, Sapphire, Akashic

  for (const chainId of supportedChains) {
    if (bridgeRegistrations[chainId]) {
      for (const bridgeAddress of bridgeRegistrations[chainId]) {
        m.call(supplyOracle, "registerBridge", [chainId, bridgeAddress]);
      }
    }
  }

  return {
    supplyOracle,
    admin,
    totalSupply,
    reconciliationInterval,
    toleranceThreshold,
    requiredSignatures,
    supportedChains,
  };
});

export default OracleModule;