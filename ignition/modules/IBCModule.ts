import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { ZeroAddress } from "ethers";
import { 
  validateNonZeroAddress, 
  parseCommaSeparatedAddresses,
  validateIBCParameters,
  getParam,
  createParameterError,
  validateAddress
} from "../utils/parameterValidation";

const IBCModule = buildModule("IBCModule", (m) => {
  // Validate and parse parameters
  let lookCoin: string;
  let vault: string;
  let governanceVault: string;
  let validatorAddresses: string[] = [];
  
  try {
    // Get and validate lookCoin address
    const lookCoinParam = m.getParameter("lookCoin", ZeroAddress);
    if (lookCoinParam === ZeroAddress) {
      console.warn("Warning: lookCoin is ZeroAddress, IBC module will have limited functionality");
      lookCoin = ZeroAddress;
    } else {
      lookCoin = validateNonZeroAddress(lookCoinParam as string, "lookCoin");
    }
    
    // Get and validate vault address
    const vaultParam = m.getParameter("vault", ZeroAddress);
    if (vaultParam === ZeroAddress) {
      console.warn("Warning: vault is ZeroAddress, IBC module will have limited functionality");
      vault = ZeroAddress;
    } else {
      vault = validateNonZeroAddress(vaultParam as string, "vault");
    }
    
    // Get and validate governance vault
    const governanceVaultParam = m.getParameter("governanceVault", m.getAccount(0));
    governanceVault = validateAddress(governanceVaultParam as string, "governanceVault");
    
    // Parse validators from comma-separated string
    const validatorsParam = m.getParameter("validators", "");
    if (validatorsParam && validatorsParam !== "") {
      validatorAddresses = parseCommaSeparatedAddresses(validatorsParam as string, "validators");
      
      // Validate minimum validators requirement
      const minValidators = 21;
      if (validatorAddresses.length > 0 && validatorAddresses.length < minValidators) {
        throw createParameterError("validators", `at least ${minValidators} validators`, `${validatorAddresses.length} validators`);
      }
    }
    
  } catch (error: any) {
    throw new Error(`IBCModule parameter validation failed: ${error.message}`);
  }

  // Deploy IBCModule
  const ibcModule = m.contract("IBCModule");

  // Initialize the module with validated parameters
  m.call(ibcModule, "initialize", [lookCoin, vault, governanceVault], {
    id: "ibcModuleInitialize",
  });

  // Set up validator set if we have enough validators
  if (validatorAddresses.length >= 21) {
    const validatorThreshold = Math.ceil((validatorAddresses.length * 2) / 3); // 2/3 majority
    m.call(ibcModule, "updateValidatorSet", [validatorAddresses, validatorThreshold], {
      id: "updateValidatorSet",
    });
  }

  // Configure IBC parameters with validation
  try {
    const channelId = m.getParameter("channelId", "channel-0") as string;
    const portId = m.getParameter("portId", "transfer") as string;
    const timeoutTimestamp = m.getParameter("timeoutTimestamp", 3600) as number;
    const unbondingPeriod = m.getParameter("unbondingPeriod", 14 * 24 * 60 * 60) as number;
    
    // Validate IBC configuration values
    if (timeoutTimestamp <= 0) {
      throw createParameterError("timeoutTimestamp", "positive number", timeoutTimestamp.toString());
    }
    
    if (unbondingPeriod <= 0) {
      throw createParameterError("unbondingPeriod", "positive number", unbondingPeriod.toString());
    }
    
    const ibcConfig = {
      channelId,
      portId,
      timeoutHeight: 0,
      timeoutTimestamp,
      minValidators: 21,
      unbondingPeriod,
    };

    m.call(ibcModule, "updateIBCConfig", [ibcConfig], {
      id: "updateIBCConfig",
    });
    
  } catch (error: any) {
    throw new Error(`IBCModule configuration failed: ${error.message}`);
  }

  // Note: MINTER_ROLE granting and relayer role configuration should be done post-deployment
  // as they require the deployed contract addresses and computed role hashes

  return {
    ibcModule,
  };
});

export default IBCModule;