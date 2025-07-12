import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroAddress } from "ethers";

const IBCModule = buildModule("IBCModule", (m) => {
  // Module parameters
  const lookCoin = m.getParameter("lookCoin", ZeroAddress);
  const vault = m.getParameter("vault", ZeroAddress);
  const admin = m.getParameter("admin", m.getAccount(0));
  
  // Validator configuration
  const validators = m.getParameter("validators", []);
  const minValidators = 21; // Minimum required by spec

  // Ensure we have enough validators
  if (validators.length > 0 && validators.length < minValidators) {
    throw new Error(`IBC requires at least ${minValidators} validators, got ${validators.length}`);
  }

  // Deploy IBCModule
  const ibcModule = m.contract("IBCModule");

  // Initialize the module
  m.call(ibcModule, "initialize", [lookCoin, vault, admin]);

  // Set up validator set if provided
  if (validators.length >= minValidators) {
    const validatorThreshold = Math.ceil((validators.length * 2) / 3); // 2/3 majority
    m.call(ibcModule, "updateValidatorSet", [validators, validatorThreshold]);
  }

  // Grant MINTER_ROLE on LookCoin to the bridge module
  if (lookCoin !== ZeroAddress) {
    const lookCoinContract = m.contractAt("LookCoin", lookCoin);
    // Note: MINTER_ROLE granting should be done separately after deployment
    // as we need the computed keccak256 hash of "MINTER_ROLE"
  }

  // Configure IBC parameters
  const channelId = m.getParameter("channelId", "channel-0");
  const portId = m.getParameter("portId", "transfer");
  const timeoutTimestamp = m.getParameter("timeoutTimestamp", 3600); // 1 hour
  const unbondingPeriod = m.getParameter("unbondingPeriod", 14 * 24 * 60 * 60); // 14 days

  const ibcConfig = {
    channelId,
    portId,
    timeoutHeight: 0,
    timeoutTimestamp,
    minValidators,
    unbondingPeriod,
  };

  m.call(ibcModule, "updateIBCConfig", [ibcConfig]);

  // Grant roles
  // Note: Relayer role granting should be done post-deployment
  // as parameters don't support array types well

  return {
    ibcModule,
    lookCoin,
    vault,
    admin,
    validators,
    validatorThreshold: validators.length >= minValidators ? Math.ceil((validators.length * 2) / 3) : 0,
    ibcConfig,
  };
});

export default IBCModule;