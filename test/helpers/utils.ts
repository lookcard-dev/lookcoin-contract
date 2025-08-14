import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { 
  LookCoin,
  CrossChainRouter,
  LayerZeroModule,
  CelerIMModule,
  HyperlaneModule,
  SupplyOracle,
  SecurityManager,
  FeeManager,
  ProtocolRegistry,
  MinimalTimelock,
} from "../../typechain-types";
import { BOOLEAN_COMBINATIONS, PROTOCOLS } from "./constants";
import { DeploymentFixture } from "./fixtures";

// Boolean combination testing utilities
export interface BooleanCombination {
  from: boolean;
  to: boolean;
  description: string;
}

/**
 * Test all boolean state combinations for comprehensive coverage
 */
export async function testBooleanCombinations(
  testName: string,
  getState: () => Promise<boolean>,
  setState: (value: boolean) => Promise<void>,
  testFunction: (combination: BooleanCombination) => Promise<void>
) {
  for (const combination of BOOLEAN_COMBINATIONS) {
    describe(`${testName} - ${combination.description}`, async () => {
      // Set initial state
      await setState(combination.from);
      expect(await getState()).to.equal(combination.from);

      // Test the transition
      await testFunction(combination);

      // Verify final state if needed
      if (combination.from !== combination.to) {
        await setState(combination.to);
        expect(await getState()).to.equal(combination.to);
      }
    });
  }
}

/**
 * Test role-based access control for a function with explicit signature support
 */
export async function testRoleBasedFunction(
  contract: LookCoin,
  functionName: string,
  args: any[],
  requiredRole: string,
  authorizedSigner: SignerWithAddress,
  unauthorizedSigner: SignerWithAddress,
  functionSignature?: string // Optional explicit signature for overloaded functions
) {
  const callFunction = functionSignature
    ? (signer: SignerWithAddress) => contract.connect(signer).getFunction(functionSignature)(...args)
    : (signer: SignerWithAddress) => (contract.connect(signer) as any)[functionName](...args);

  // Test with authorized signer
  await expect(callFunction(authorizedSigner))
    .to.not.be.reverted;

  // Test with unauthorized signer
  await expect(callFunction(unauthorizedSigner))
    .to.be.revertedWithCustomError(contract, "AccessControlUnauthorizedAccount")
    .withArgs(unauthorizedSigner.address, requiredRole);
}

/**
 * Test pausable function behavior with explicit signature support
 */
export async function testPausableFunction(
  contract: LookCoin,
  functionName: string,
  args: any[],
  pauserSigner: SignerWithAddress,
  functionSignature?: string // Optional explicit signature for overloaded functions
) {
  const callFunction = functionSignature
    ? () => contract.getFunction(functionSignature)(...args)
    : () => (contract as any)[functionName](...args);

  // Test function works when not paused
  await expect(callFunction()).to.not.be.reverted;

  // Pause the contract
  await contract.connect(pauserSigner).pause();
  
  // Test function reverts when paused
  await expect(callFunction())
    .to.be.revertedWithCustomError(contract, "EnforcedPause");

  // Unpause the contract
  await contract.connect(pauserSigner).unpause();

  // Test function works again when unpaused
  await expect(callFunction()).to.not.be.reverted;
}

/**
 * Test configuration dependency for bridge functions
 */
export async function testConfigurationDependency(
  contract: LookCoin,
  functionName: string,
  args: any[],
  configureFunction: () => Promise<void>,
  unconfigureFunction: () => Promise<void>,
  expectedError: string
) {
  // Test function fails without configuration
  await unconfigureFunction();
  await expect((contract as any)[functionName](...args))
    .to.be.revertedWith(expectedError);

  // Configure
  await configureFunction();

  // Test function works with configuration
  await expect((contract as any)[functionName](...args)).to.not.be.reverted;

  // Unconfigure again
  await unconfigureFunction();
  
  // Test function fails again
  await expect((contract as any)[functionName](...args))
    .to.be.revertedWith(expectedError);
}

// Assertion helpers
/**
 * Assert event emission with specific arguments
 */
export async function assertEventEmission(
  tx: any,
  contract: any,
  eventName: string,
  expectedArgs: any[]
) {
  await expect(tx)
    .to.emit(contract, eventName)
    .withArgs(...expectedArgs);
}

/**
 * Assert balance changes for an account with enhanced error reporting and validation
 */
export async function assertBalanceChanges(
  token: LookCoin,
  account: string,
  expectedChange: bigint,
  operation: () => Promise<void>,
  options: {
    tolerance?: bigint;
    allowNegativeBalance?: boolean;
    validateOperation?: boolean;
  } = {}
) {
  // Validate inputs
  if (!account || account === ethers.ZeroAddress) {
    throw new Error('Invalid account address provided');
  }
  
  if (!token || !token.balanceOf) {
    throw new Error('Invalid token contract provided');
  }
  
  let balanceBefore: bigint;
  let balanceAfter: bigint;
  let operationError: Error | null = null;
  
  try {
    // Get initial balance with retry logic
    balanceBefore = await token.balanceOf(account);
  } catch (error) {
    throw new Error(`Failed to get initial balance for ${account}: ${error}`);
  }
  
  // Validate operation before execution if requested
  if (options.validateOperation && typeof operation !== 'function') {
    throw new Error('Operation must be a function');
  }
  
  // Execute operation with error handling
  try {
    await operation();
  } catch (error) {
    operationError = error as Error;
    console.warn(`Operation failed during balance assertion: ${error}`);
  }
  
  try {
    // Get final balance
    balanceAfter = await token.balanceOf(account);
  } catch (error) {
    throw new Error(`Failed to get final balance for ${account}: ${error}`);
  }
  
  const actualChange = balanceAfter - balanceBefore;
  const tolerance = options.tolerance || BigInt(0);
  const diff = actualChange > expectedChange ? actualChange - expectedChange : expectedChange - actualChange;
  
  // Validate balance constraints
  if (!options.allowNegativeBalance && balanceAfter < 0) {
    throw new Error(`Balance became negative after operation: ${balanceAfter.toString()}`);
  }
  
  // Check if change is within tolerance
  const withinTolerance = diff <= tolerance;
  
  if (!withinTolerance) {
    const errorMessage = [
      `Balance change assertion failed for account ${account}:`,
      `  Expected change: ${expectedChange.toString()}`,
      `  Actual change: ${actualChange.toString()}`,
      `  Difference: ${diff.toString()}`,
      `  Tolerance: ${tolerance.toString()}`,
      `  Balance before: ${balanceBefore.toString()}`,
      `  Balance after: ${balanceAfter.toString()}`,
      operationError ? `  Operation error: ${operationError.message}` : ''
    ].filter(Boolean).join('\n');
    
    throw new Error(errorMessage);
  }
  
  // Log successful assertion for debugging
  console.debug(`Balance assertion passed for ${account}: ${actualChange.toString()} (expected: ${expectedChange.toString()})`);
}

/**
 * Assert balance changes with tolerance for rounding errors (enhanced version)
 * Note: This function is deprecated. Use assertBalanceChanges with options.tolerance instead.
 */
export async function assertBalanceChangesWithTolerance(
  token: LookCoin,
  account: string,
  expectedChange: bigint,
  operation: () => Promise<void>,
  tolerance: bigint = BigInt(0)
) {
  console.warn('assertBalanceChangesWithTolerance is deprecated. Use assertBalanceChanges with options.tolerance instead.');
  
  return assertBalanceChanges(token, account, expectedChange, operation, {
    tolerance,
    validateOperation: true
  });
}

/**
 * Assert supply changes (minted and burned)
 */
export async function assertSupplyChanges(
  token: LookCoin,
  expectedMintChange: bigint,
  expectedBurnChange: bigint,
  operation: () => Promise<void>
) {
  const mintedBefore = await token.totalMinted();
  const burnedBefore = await token.totalBurned();
  
  await operation();
  
  const mintedAfter = await token.totalMinted();
  const burnedAfter = await token.totalBurned();
  
  expect(mintedAfter - mintedBefore).to.equal(expectedMintChange);
  expect(burnedAfter - burnedBefore).to.equal(expectedBurnChange);
}

/**
 * Assert multiple balance changes in a single operation
 */
export async function assertMultipleBalanceChanges(
  token: LookCoin,
  accounts: string[],
  expectedChanges: bigint[],
  operation: () => Promise<void>
) {
  if (accounts.length !== expectedChanges.length) {
    throw new Error("Accounts and expected changes arrays must have same length");
  }

  const balancesBefore = await Promise.all(
    accounts.map(account => token.balanceOf(account))
  );
  
  await operation();
  
  const balancesAfter = await Promise.all(
    accounts.map(account => token.balanceOf(account))
  );

  for (let i = 0; i < accounts.length; i++) {
    expect(balancesAfter[i] - balancesBefore[i]).to.equal(expectedChanges[i]);
  }
}

// Error handling utilities
/**
 * Expect specific revert with proper error handling and function disambiguation
 */
export async function expectSpecificRevert(
  operation: () => Promise<any>,
  contract: any,
  errorName: string,
  ...errorArgs: any[]
) {
  try {
    // Check if it's a string revert message (contains spaces or colons)
    if (errorName.includes(' ') || errorName.includes(':')) {
      await expect(operation()).to.be.revertedWith(errorName);
    } else if (errorArgs.length > 0) {
      await expect(operation())
        .to.be.revertedWithCustomError(contract, errorName)
        .withArgs(...errorArgs);
    } else {
      await expect(operation())
        .to.be.revertedWithCustomError(contract, errorName);
    }
  } catch (error: any) {
    // If the error is about ambiguous function description, re-throw with context
    if (error.message && error.message.includes('ambiguous function description')) {
      throw new Error(
        `Function ambiguity error in test: ${error.message}. ` +
        `Consider using explicit function signature instead of function name.`
      );
    }
    throw error;
  }
}

/**
 * Expect specific revert for explicitly typed contract calls
 */
export async function expectSpecificRevertTyped(
  operation: () => Promise<any>,
  contract: any,
  errorName: string,
  ...errorArgs: any[]
) {
  if (errorName.includes(' ') || errorName.includes(':')) {
    await expect(operation()).to.be.revertedWith(errorName);
  } else if (errorArgs.length > 0) {
    await expect(operation())
      .to.be.revertedWithCustomError(contract, errorName)
      .withArgs(...errorArgs);
  } else {
    await expect(operation())
      .to.be.revertedWithCustomError(contract, errorName);
  }
}

/**
 * Test all revert scenarios in batch
 */
export async function testAllRevertScenarios(
  scenarios: Array<{
    name: string;
    operation: () => Promise<any>;
    contract: any;
    errorName: string;
    errorArgs?: any[];
  }>
) {
  for (const scenario of scenarios) {
    it(`should revert: ${scenario.name}`, async () => {
      await expectSpecificRevert(
        scenario.operation,
        scenario.contract,
        scenario.errorName,
        ...(scenario.errorArgs || [])
      );
    });
  }
}

// Time manipulation utilities
/**
 * Advance time and mine a block
 */
export async function advanceTimeAndBlock(seconds: number) {
  await time.increase(seconds);
  await ethers.provider.send("evm_mine", []);
}

/**
 * Fast forward to a specific timestamp
 */
export async function fastForwardTo(timestamp: bigint) {
  await time.increaseTo(timestamp);
  await ethers.provider.send("evm_mine", []);
}

/**
 * Get current block timestamp
 */
export async function getCurrentTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp;
}

// Address utilities
/**
 * Generate a random address
 */
export function generateRandomAddress(): string {
  return ethers.Wallet.createRandom().address;
}

/**
 * Generate multiple random addresses
 */
export function generateRandomAddresses(count: number): string[] {
  return Array.from({ length: count }, () => generateRandomAddress());
}

/**
 * Create bytes32 from string
 */
export function stringToBytes32(str: string): string {
  return ethers.encodeBytes32String(str);
}

/**
 * Create address from bytes32
 */
export function bytes32ToAddress(bytes32: string): string {
  return ethers.getAddress(bytes32.slice(0, 42));
}

// Gas tracking utilities
export interface GasReport {
  operation: string;
  gasUsed: bigint;
  gasPrice: bigint;
  cost: bigint;
}

/**
 * Track gas usage for operations with enhanced transaction type detection
 */
export async function trackGasUsage(
  operation: () => Promise<any>,
  operationName: string
): Promise<GasReport> {
  let result;
  let receipt;
  let gasPrice = BigInt(0);
  let gasUsed = BigInt(0);
  
  try {
    result = await operation();
    
    // Enhanced transaction type detection
    if (!result) {
      console.warn(`No result returned from operation: ${operationName}`);
      return {
        operation: operationName,
        gasUsed: BigInt(0),
        gasPrice: BigInt(0),
        cost: BigInt(0),
      };
    }
    
    // Handle ContractTransactionResponse (has wait method)
    if (result && typeof result.wait === 'function') {
      receipt = await result.wait();
      if (!receipt) {
        console.warn(`Failed to get receipt for operation: ${operationName}`);
        return {
          operation: operationName,
          gasUsed: BigInt(0),
          gasPrice: BigInt(0),
          cost: BigInt(0),
        };
      }
      gasUsed = receipt.gasUsed || BigInt(0);
      gasPrice = receipt.gasPrice || result.gasPrice || BigInt(0);
    }
    // Handle ContractTransactionReceipt (already a receipt)
    else if (result && result.gasUsed !== undefined) {
      receipt = result;
      gasUsed = receipt.gasUsed || BigInt(0);
      gasPrice = receipt.gasPrice || BigInt(0);
    }
    // Handle transaction hash string
    else if (typeof result === 'string' && result.startsWith('0x')) {
      try {
        receipt = await ethers.provider.getTransactionReceipt(result);
        if (receipt) {
          gasUsed = receipt.gasUsed || BigInt(0);
          const tx = await ethers.provider.getTransaction(result);
          gasPrice = tx?.gasPrice || BigInt(0);
        }
      } catch (error) {
        console.warn(`Failed to get receipt for hash ${result}: ${error}`);
      }
    }
    // Handle complex objects that might contain transaction info
    else if (result && typeof result === 'object') {
      // Try to extract transaction info from complex response
      if (result.hash && typeof result.hash === 'string') {
        try {
          receipt = await ethers.provider.getTransactionReceipt(result.hash);
          if (receipt) {
            gasUsed = receipt.gasUsed || BigInt(0);
            gasPrice = receipt.gasPrice || result.gasPrice || BigInt(0);
          }
        } catch (error) {
          console.warn(`Failed to get receipt for complex result: ${error}`);
        }
      }
    }
    
    return {
      operation: operationName,
      gasUsed,
      gasPrice,
      cost: gasUsed * gasPrice,
    };
    
  } catch (error) {
    console.error(`Error tracking gas usage for ${operationName}:`, error);
    return {
      operation: operationName,
      gasUsed: BigInt(0),
      gasPrice: BigInt(0),
      cost: BigInt(0),
    };
  }
}

// Array utilities
/**
 * Create array with incremental values
 */
export function createIncrementalArray(length: number, start: number = 0): number[] {
  return Array.from({ length }, (_, i) => start + i);
}

/**
 * Chunk array into smaller arrays
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// Math utilities
/**
 * Calculate percentage with basis points
 */
export function calculateBasisPoints(amount: bigint, basisPoints: number): bigint {
  return (amount * BigInt(basisPoints)) / BigInt(10000);
}

/**
 * Generate random number in range
 */
export function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Contract interaction utilities for handling function overloads
/**
 * Safely call overloaded burn function with explicit signature
 */
export async function safeBurnCall(
  lookCoin: LookCoin,
  signer: any,
  addressOrAmount: string | bigint,
  amount?: bigint
): Promise<any> {
  if (typeof addressOrAmount === 'string' && amount !== undefined) {
    // burn(address,uint256)
    return lookCoin.connect(signer).getFunction('burn(address,uint256)')(addressOrAmount, amount);
  } else if (typeof addressOrAmount === 'bigint') {
    // burn(uint256)
    return lookCoin.connect(signer).getFunction('burn(uint256)')(addressOrAmount);
  } else {
    throw new Error('Invalid parameters for burn function');
  }
}

/**
 * Safely call overloaded mint function with explicit signature
 */
export async function safeMintCall(
  lookCoin: LookCoin,
  signer: any,
  addressOrAmount: string | bigint,
  amount?: bigint
): Promise<any> {
  if (typeof addressOrAmount === 'string' && amount !== undefined) {
    // mint(address,uint256)
    return lookCoin.connect(signer).getFunction('mint(address,uint256)')(addressOrAmount, amount);
  } else if (typeof addressOrAmount === 'bigint') {
    // mint(uint256) - if such function exists
    return lookCoin.connect(signer).getFunction('mint(uint256)')(addressOrAmount);
  } else {
    throw new Error('Invalid parameters for mint function');
  }
}

/**
 * Generic function caller that handles ambiguous function signatures
 */
export async function callWithExplicitSignature(
  contract: any,
  signer: any,
  functionSignature: string,
  args: any[]
): Promise<any> {
  try {
    return contract.connect(signer).getFunction(functionSignature)(...args);
  } catch (error: any) {
    if (error.message && error.message.includes('no matching function')) {
      throw new Error(`Function signature '${functionSignature}' not found on contract`);
    }
    throw error;
  }
}

/**
 * Generate random BigInt in range
 */
export function randomBigIntInRange(min: bigint, max: bigint): bigint {
  const range = max - min + BigInt(1);
  const randomBytes = ethers.randomBytes(32);
  const randomBigInt = ethers.toBigInt(randomBytes);
  return min + (randomBigInt % range);
}

// String utilities
/**
 * Generate random hex string
 */
export function randomHex(length: number): string {
  return "0x" + Array.from({ length }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
}

/**
 * Pad hex string to specific length
 */
export function padHex(hex: string, length: number): string {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  return "0x" + cleanHex.padStart(length, "0");
}

// Validation utilities
/**
 * Validate address format
 */
export function isValidAddress(address: string): boolean {
  try {
    ethers.getAddress(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate chain ID
 */
export function isValidChainId(chainId: number): boolean {
  return chainId > 0 && chainId <= 4294967295; // 2^32 - 1
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Network utilities
/**
 * Get network name from chain ID
 */
export function getNetworkName(chainId: number): string {
  const networks: { [key: number]: string } = {
    1: "ethereum",
    56: "bsc",
    137: "polygon",
    43114: "avalanche",
    42161: "arbitrum",
    10: "optimism",
    8453: "base",
    31337: "hardhat",
  };
  return networks[chainId] || `unknown-${chainId}`;
}

// Debug utilities
/**
 * Log transaction details
 */
export async function logTransactionDetails(tx: any, name: string = "Transaction") {
  const receipt = await tx.wait();
  console.log(`\n${name} Details:`);
  console.log(`  Hash: ${receipt.hash}`);
  console.log(`  Gas Used: ${receipt.gasUsed.toString()}`);
  console.log(`  Status: ${receipt.status}`);
  console.log(`  Block: ${receipt.blockNumber}`);
}

// Contract Relationship Setup Utilities
/**
 * Establish all contract relationships for a complete deployment
 */
export async function setupContractRelationships(fixture: DeploymentFixture): Promise<void> {
  // Setup Router <-> Module relationships
  await setupRouterModuleRelationships(fixture);
  
  // Setup Oracle <-> SecurityManager relationship
  await setupOracleSecurityRelationship(fixture);
  
  // Setup FeeManager relationships
  await setupFeeManagerRelationships(fixture);
  
  // Setup LookCoin <-> Module relationships
  await setupLookCoinModuleRelationships(fixture);
}

/**
 * Setup CrossChainRouter and bridge module relationships
 */
export async function setupRouterModuleRelationships(fixture: DeploymentFixture): Promise<void> {
  const { crossChainRouter, layerZeroModule, celerIMModule, hyperlaneModule, admin } = fixture;
  
  // Register protocols with router
  await crossChainRouter.connect(admin).registerProtocol(
    PROTOCOLS.LAYERZERO,
    await layerZeroModule.getAddress()
  );
  await crossChainRouter.connect(admin).registerProtocol(
    PROTOCOLS.CELER,
    await celerIMModule.getAddress()
  );
  await crossChainRouter.connect(admin).registerProtocol(
    PROTOCOLS.HYPERLANE,
    await hyperlaneModule.getAddress()
  );
  
  // Enable all protocols
  await crossChainRouter.connect(admin).updateProtocolStatus(PROTOCOLS.LAYERZERO, true);
  await crossChainRouter.connect(admin).updateProtocolStatus(PROTOCOLS.CELER, true);
  await crossChainRouter.connect(admin).updateProtocolStatus(PROTOCOLS.HYPERLANE, true);
}

/**
 * Setup SupplyOracle and SecurityManager relationship
 */
export async function setupOracleSecurityRelationship(fixture: DeploymentFixture): Promise<void> {
  // Note: The relationship between SupplyOracle and SecurityManager is typically
  // established through constructor parameters or deployment configuration
  // No runtime configuration needed in most cases
}

/**
 * Setup FeeManager relationships with other contracts
 */
export async function setupFeeManagerRelationships(fixture: DeploymentFixture): Promise<void> {
  const { feeManager, admin } = fixture;
  
  // Update protocol fee configurations
  await feeManager.connect(admin).updateProtocolFees(PROTOCOLS.LAYERZERO, 10000, 0); // 1x multiplier, 0 base
  await feeManager.connect(admin).updateProtocolFees(PROTOCOLS.CELER, 10050, 100); // 1.005x multiplier (0.5%), 100 base
  await feeManager.connect(admin).updateProtocolFees(PROTOCOLS.HYPERLANE, 10000, 0); // 1x multiplier, 0 base
}

/**
 * Setup LookCoin and bridge module relationships
 */
export async function setupLookCoinModuleRelationships(fixture: DeploymentFixture): Promise<void> {
  const { lookCoin, layerZeroModule, celerIMModule, hyperlaneModule, crossChainRouter, governance } = fixture;
  
  // Grant BRIDGE_ROLE to all modules and router
  const bridgeRole = await lookCoin.BRIDGE_ROLE();
  await lookCoin.connect(governance).grantRole(bridgeRole, await layerZeroModule.getAddress());
  await lookCoin.connect(governance).grantRole(bridgeRole, await celerIMModule.getAddress());
  await lookCoin.connect(governance).grantRole(bridgeRole, await hyperlaneModule.getAddress());
  await lookCoin.connect(governance).grantRole(bridgeRole, await crossChainRouter.getAddress());
  
  // Grant MINTER_ROLE to all modules and router
  const minterRole = await lookCoin.MINTER_ROLE();
  await lookCoin.connect(governance).grantRole(minterRole, await layerZeroModule.getAddress());
  await lookCoin.connect(governance).grantRole(minterRole, await celerIMModule.getAddress());
  await lookCoin.connect(governance).grantRole(minterRole, await hyperlaneModule.getAddress());
  await lookCoin.connect(governance).grantRole(minterRole, await crossChainRouter.getAddress());
  
  // Grant BURNER_ROLE to all modules and router
  const burnerRole = await lookCoin.BURNER_ROLE();
  await lookCoin.connect(governance).grantRole(burnerRole, await layerZeroModule.getAddress());
  await lookCoin.connect(governance).grantRole(burnerRole, await celerIMModule.getAddress());
  await lookCoin.connect(governance).grantRole(burnerRole, await hyperlaneModule.getAddress());
  await lookCoin.connect(governance).grantRole(burnerRole, await crossChainRouter.getAddress());
}

/**
 * Configure cross-chain settings for all protocols
 */
export async function configureCrossChainSettings(
  fixture: DeploymentFixture,
  destinationChainId: number,
  destinationDomain: number = 2,
  destinationEid: number = 30102
): Promise<void> {
  const remoteAddress = fixture.remoteAddress || "0x" + "1".repeat(40);
  
  // Configure LayerZero OFT on LookCoin
  // LookCoin expects just the remote address (20 bytes)
  await fixture.lookCoin.connect(fixture.protocolAdmin).setTrustedRemote(
    destinationEid,
    remoteAddress
  );
  await fixture.lookCoin.connect(fixture.governance).setGasForDestinationLzReceive(200000);
  
  // Configure LayerZero module
  await fixture.layerZeroModule.connect(fixture.admin).setTrustedRemote(
    destinationEid,
    remoteAddress
  );
  
  // Configure Celer module
  await fixture.celerIMModule.connect(fixture.admin).setSupportedChain(destinationChainId, true);
  await fixture.celerIMModule.connect(fixture.admin).setRemoteModule(destinationChainId, remoteAddress);
  
  // Configure Hyperlane module
  await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(
    destinationDomain,
    destinationChainId
  );
  await fixture.hyperlaneModule.connect(fixture.admin).setTrustedSender(
    destinationDomain,
    remoteAddress
  );
  await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(BigInt(200000));
  
  // Configure router chain support
  await fixture.crossChainRouter.connect(fixture.admin).setChainProtocolSupport(
    destinationChainId,
    PROTOCOLS.LAYERZERO,
    true
  );
  await fixture.crossChainRouter.connect(fixture.admin).setChainProtocolSupport(
    destinationChainId,
    PROTOCOLS.CELER,
    true
  );
  await fixture.crossChainRouter.connect(fixture.admin).setChainProtocolSupport(
    destinationChainId,
    PROTOCOLS.HYPERLANE,
    true
  );
  
  // Note: Supply oracle initialization happens during deployment
}

/**
 * Reset supply oracle state with enhanced nonce management
 */
export async function resetSupplyOracleState(fixture: DeploymentFixture): Promise<void> {
  if (!fixture.supplyOracle) {
    console.warn('Supply oracle not available in fixture');
    return;
  }
  
  const supportedChains = [31337, 97, 84532, 11155420]; // Hardhat, BSC Testnet, Base Sepolia, Optimism Sepolia
  const resetResults: { chainId: number; success: boolean; error?: string }[] = [];
  
  try {
    for (const chainId of supportedChains) {
      try {
        // Check if chain is supported by the oracle
        let currentNonce: number;
        try {
          currentNonce = await fixture.supplyOracle.getNextNonce(chainId);
        } catch (error) {
          // If getNextNonce fails, the chain might not be initialized
          console.debug(`Chain ${chainId} not initialized in supply oracle, skipping reset`);
          resetResults.push({ chainId, success: false, error: 'Chain not initialized' });
          continue;
        }
        
        // Validate oracle signer is available
        if (!fixture.oracleSigner1) {
          console.warn('Oracle signer not available, cannot reset supply oracle state');
          resetResults.push({ chainId, success: false, error: 'Oracle signer not available' });
          continue;
        }
        
        // Reset supply to 0 with proper nonce management
        // Use incremented nonce to ensure fresh state
        const resetNonce = Math.max(0, currentNonce);
        
        console.debug(`Resetting supply oracle for chain ${chainId} with nonce ${resetNonce}`);
        
        const tx = await fixture.supplyOracle.connect(fixture.oracleSigner1).updateSupply(
          chainId,
          0, // Reset supply to 0
          resetNonce,
          1 // Single signature for reset
        );
        
        // Wait for transaction to be mined
        await tx.wait();
        
        resetResults.push({ chainId, success: true });
        console.debug(`Successfully reset supply oracle for chain ${chainId}`);
        
      } catch (error: any) {
        // Log error but continue with other chains
        const errorMessage = error?.reason || error?.message || String(error);
        console.debug(`Error resetting supply oracle for chain ${chainId}: ${errorMessage}`);
        resetResults.push({ chainId, success: false, error: errorMessage });
        
        // If it's a nonce-related error, try with incremented nonce
        if (errorMessage.includes('nonce') || errorMessage.includes('replay')) {
          try {
            const newNonce = await fixture.supplyOracle.getNextNonce(chainId);
            const retryTx = await fixture.supplyOracle.connect(fixture.oracleSigner1).updateSupply(
              chainId,
              0,
              newNonce + 1, // Use incremented nonce for retry
              1
            );
            await retryTx.wait();
            resetResults[resetResults.length - 1] = { chainId, success: true };
            console.debug(`Successfully reset supply oracle for chain ${chainId} on retry`);
          } catch (retryError) {
            console.debug(`Retry failed for chain ${chainId}: ${retryError}`);
          }
        }
      }
    }
    
    // Log summary of reset operations
    const successCount = resetResults.filter(r => r.success).length;
    const totalCount = resetResults.length;
    
    if (successCount === 0) {
      console.warn('Failed to reset supply oracle state for any chains');
    } else if (successCount < totalCount) {
      console.warn(`Partially reset supply oracle state: ${successCount}/${totalCount} chains`);
    } else {
      console.debug('Successfully reset supply oracle state for all chains');
    }
    
  } catch (error: any) {
    console.error('Critical error during supply oracle reset:', error?.message || String(error));
    throw new Error(`Supply oracle reset failed: ${error?.message || String(error)}`);
  }
}

/**
 * Get fresh nonce for supply oracle operations
 */
export async function getFreshSupplyOracleNonce(
  supplyOracle: SupplyOracle,
  chainId: number
): Promise<number> {
  try {
    return await supplyOracle.getNextNonce(chainId);
  } catch (error) {
    // If getNextNonce fails, start with 0
    return 0;
  }
}

/**
 * Verify all contract relationships are properly established
 */
export async function verifyContractRelationships(fixture: DeploymentFixture): Promise<boolean> {
  const errors: string[] = [];
  
  // Verify router has all modules registered
  const layerZeroAddr = await fixture.crossChainRouter.protocolModules(PROTOCOLS.LAYERZERO);
  if (layerZeroAddr !== await fixture.layerZeroModule.getAddress()) {
    errors.push("LayerZero module not properly registered in router");
  }
  
  const celerAddr = await fixture.crossChainRouter.protocolModules(PROTOCOLS.CELER);
  if (celerAddr !== await fixture.celerIMModule.getAddress()) {
    errors.push("Celer module not properly registered in router");
  }
  
  const hyperlaneAddr = await fixture.crossChainRouter.protocolModules(PROTOCOLS.HYPERLANE);
  if (hyperlaneAddr !== await fixture.hyperlaneModule.getAddress()) {
    errors.push("Hyperlane module not properly registered in router");
  }
  
  // Verify protocols are enabled
  if (!await fixture.crossChainRouter.protocolStatus(PROTOCOLS.LAYERZERO)) {
    errors.push("LayerZero protocol not enabled");
  }
  if (!await fixture.crossChainRouter.protocolStatus(PROTOCOLS.CELER)) {
    errors.push("Celer protocol not enabled");
  }
  if (!await fixture.crossChainRouter.protocolStatus(PROTOCOLS.HYPERLANE)) {
    errors.push("Hyperlane protocol not enabled");
  }
  
  // Verify LookCoin roles
  const bridgeRole = await fixture.lookCoin.BRIDGE_ROLE();
  const minterRole = await fixture.lookCoin.MINTER_ROLE();
  const burnerRole = await fixture.lookCoin.BURNER_ROLE();
  
  const contracts = [
    fixture.layerZeroModule,
    fixture.celerIMModule,
    fixture.hyperlaneModule,
    fixture.crossChainRouter
  ];
  
  for (const contract of contracts) {
    const addr = await contract.getAddress();
    if (!await fixture.lookCoin.hasRole(bridgeRole, addr)) {
      errors.push(`${addr} missing BRIDGE_ROLE`);
    }
    if (!await fixture.lookCoin.hasRole(minterRole, addr)) {
      errors.push(`${addr} missing MINTER_ROLE`);
    }
    if (!await fixture.lookCoin.hasRole(burnerRole, addr)) {
      errors.push(`${addr} missing BURNER_ROLE`);
    }
  }
  
  // Log errors if any
  if (errors.length > 0) {
    console.error("Contract relationship verification failed:");
    errors.forEach(error => console.error(`  - ${error}`));
    return false;
  }
  
  return true;
}

/**
 * Comprehensive test state reset with enhanced error handling
 */
export async function resetTestState(fixture: DeploymentFixture): Promise<void> {
  const resetOperations: Promise<void>[] = [];
  const errors: string[] = [];
  
  console.debug('Starting comprehensive test state reset');
  
  // Reset contract relationships (non-blocking)
  resetOperations.push(
    resetContractRelationships(fixture).catch(error => {
      errors.push(`Contract relationships reset failed: ${error.message}`);
    })
  );
  
  // Reset supply oracle state (non-blocking)
  resetOperations.push(
    resetSupplyOracleState(fixture).catch(error => {
      errors.push(`Supply oracle reset failed: ${error.message}`);
    })
  );
  
  // Unpause contracts (non-blocking)
  resetOperations.push(
    unpauseAllContracts(fixture).catch(error => {
      errors.push(`Contract unpause failed: ${error.message}`);
    })
  );
  
  // Execute all reset operations in parallel
  await Promise.all(resetOperations);
  
  // Log any errors that occurred
  if (errors.length > 0) {
    console.warn('Test state reset completed with warnings:');
    errors.forEach(error => console.warn(`  - ${error}`));
  } else {
    console.debug('Test state reset completed successfully');
  }
}

/**
 * Unpause all contracts in the fixture
 */
export async function unpauseAllContracts(fixture: DeploymentFixture): Promise<void> {
  const unpauseOperations = [
    // Unpause LookCoin if paused
    async () => {
      try {
        if (fixture.lookCoin && await fixture.lookCoin.paused()) {
          if (fixture.pauser) {
            await fixture.lookCoin.connect(fixture.pauser).unpause();
            console.debug('LookCoin unpaused successfully');
          } else {
            console.warn('Pauser account not available for LookCoin unpause');
          }
        }
      } catch (error) {
        console.debug('LookCoin unpause failed or not needed:', error);
      }
    },
    
    // Unpause SupplyOracle if paused
    async () => {
      try {
        if (fixture.supplyOracle && await fixture.supplyOracle.paused()) {
          if (fixture.admin) {
            await fixture.supplyOracle.connect(fixture.admin).unpause();
            console.debug('SupplyOracle unpaused successfully');
          } else {
            console.warn('Admin account not available for SupplyOracle unpause');
          }
        }
      } catch (error) {
        console.debug('SupplyOracle unpause failed or not needed:', error);
      }
    },
    
    // Unpause CrossChainRouter if paused
    async () => {
      try {
        if (fixture.crossChainRouter && typeof fixture.crossChainRouter.paused === 'function') {
          if (await fixture.crossChainRouter.paused()) {
            if (fixture.admin) {
              await fixture.crossChainRouter.connect(fixture.admin).unpause();
              console.debug('CrossChainRouter unpaused successfully');
            } else {
              console.warn('Admin account not available for CrossChainRouter unpause');
            }
          }
        }
      } catch (error) {
        console.debug('CrossChainRouter unpause failed or not needed:', error);
      }
    }
  ];
  
  // Execute all unpause operations in parallel
  await Promise.all(unpauseOperations.map(op => op()));
}

/**
 * Reset all contract relationships (useful for testing)
 */
export async function resetContractRelationships(fixture: DeploymentFixture): Promise<void> {
  // Disable all protocols in router
  await fixture.crossChainRouter.connect(fixture.admin).updateProtocolStatus(PROTOCOLS.LAYERZERO, false);
  await fixture.crossChainRouter.connect(fixture.admin).updateProtocolStatus(PROTOCOLS.CELER, false);
  await fixture.crossChainRouter.connect(fixture.admin).updateProtocolStatus(PROTOCOLS.HYPERLANE, false);
  
  // Remove chain support
  const testChainId = fixture.testChainId;
  await fixture.crossChainRouter.connect(fixture.admin).setChainProtocolSupport(
    testChainId,
    PROTOCOLS.LAYERZERO,
    false
  );
  await fixture.crossChainRouter.connect(fixture.admin).setChainProtocolSupport(
    testChainId,
    PROTOCOLS.CELER,
    false
  );
  await fixture.crossChainRouter.connect(fixture.admin).setChainProtocolSupport(
    testChainId,
    PROTOCOLS.HYPERLANE,
    false
  );
}