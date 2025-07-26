import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Contract } from "ethers";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  LookCoin,
  LookCoin__factory,
  CrossChainRouter,
  CrossChainRouter__factory,
  LayerZeroModule,
  LayerZeroModule__factory,
  CelerIMModule,
  CelerIMModule__factory,
  HyperlaneModule,
  HyperlaneModule__factory,
  MockLayerZeroEndpoint,
  MockLayerZeroEndpoint__factory,
  MockMessageBus,
  MockMessageBus__factory,
  MockHyperlaneMailbox,
  MockHyperlaneMailbox__factory,
  IERC20,
  ILayerZeroUserApplicationConfig,
} from "../../typechain-types";
import { TEST_CHAINS } from "../utils/testConfig";

export interface BooleanCombination {
  from: boolean;
  to: boolean;
  description: string;
}

export const BOOLEAN_COMBINATIONS: BooleanCombination[] = [
  { from: false, to: true, description: "false → true" },
  { from: true, to: false, description: "true → false" },
  { from: false, to: false, description: "false → false" },
  { from: true, to: true, description: "true → true" },
];

export interface DeploymentFixture {
  lookCoin: LookCoin;
  crossChainRouter: CrossChainRouter;
  layerZeroModule: LayerZeroModule;
  celerIMModule: CelerIMModule;
  hyperlaneModule: HyperlaneModule;
  mockLayerZero: MockLayerZeroEndpoint;
  mockCeler: MockMessageBus;
  mockHyperlane: MockHyperlaneMailbox;
  owner: SignerWithAddress;
  admin: SignerWithAddress;
  operator: SignerWithAddress;
  user: SignerWithAddress;
  user2: SignerWithAddress;
  minter: SignerWithAddress;
  burner: SignerWithAddress;
  pauser: SignerWithAddress;
  upgrader: SignerWithAddress;
  bridgeOperator: SignerWithAddress;
  protocolAdmin: SignerWithAddress;
  securityAdmin: SignerWithAddress;
  feeCollector: SignerWithAddress;
}

// Boolean Combination Testing Utilities
export async function testBooleanCombinations(
  testName: string,
  getState: () => Promise<boolean>,
  setState: (value: boolean) => Promise<void>,
  testFunction: (combination: BooleanCombination) => Promise<void>
) {
  for (const combination of BOOLEAN_COMBINATIONS) {
    await describe(`${testName} - ${combination.description}`, async () => {
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

export async function testRoleBasedFunction(
  contract: Contract,
  functionName: string,
  args: any[],
  requiredRole: string,
  authorizedSigner: SignerWithAddress,
  unauthorizedSigner: SignerWithAddress
) {
  // Test with authorized signer
  await expect(contract.connect(authorizedSigner)[functionName](...args))
    .to.not.be.reverted;

  // Test with unauthorized signer
  await expect(contract.connect(unauthorizedSigner)[functionName](...args))
    .to.be.revertedWithCustomError(contract, "AccessControlUnauthorizedAccount")
    .withArgs(unauthorizedSigner.address, requiredRole);
}

export async function testPausableFunction(
  contract: Contract,
  functionName: string,
  args: any[],
  pauserSigner: SignerWithAddress
) {
  // Test function works when not paused
  await expect(contract[functionName](...args)).to.not.be.reverted;

  // Pause the contract
  await contract.connect(pauserSigner).pause();
  
  // Test function reverts when paused
  await expect(contract[functionName](...args))
    .to.be.revertedWithCustomError(contract, "EnforcedPause");

  // Unpause the contract
  await contract.connect(pauserSigner).unpause();

  // Test function works again when unpaused
  await expect(contract[functionName](...args)).to.not.be.reverted;
}

export async function testConfigurationDependency(
  contract: Contract,
  functionName: string,
  args: any[],
  configureFunction: () => Promise<void>,
  unconfigureFunction: () => Promise<void>,
  expectedError: string
) {
  // Test function fails without configuration
  await unconfigureFunction();
  await expect(contract[functionName](...args))
    .to.be.revertedWithCustomError(contract, expectedError);

  // Configure
  await configureFunction();

  // Test function works with configuration
  await expect(contract[functionName](...args)).to.not.be.reverted;

  // Unconfigure again
  await unconfigureFunction();
  
  // Test function fails again
  await expect(contract[functionName](...args))
    .to.be.revertedWithCustomError(contract, expectedError);
}

// Contract Deployment Helpers
export async function deployLookCoinFixture(): Promise<DeploymentFixture> {
  const [owner, admin, operator, user, user2, minter, burner, pauser, upgrader, bridgeOperator, protocolAdmin, securityAdmin, feeCollector] = await ethers.getSigners();

  // Deploy mocks
  const MockLayerZero = await ethers.getContractFactory("MockLayerZeroEndpoint");
  const mockLayerZero = await MockLayerZero.deploy() as MockLayerZeroEndpoint;
  await mockLayerZero.waitForDeployment();

  const MockCeler = await ethers.getContractFactory("MockMessageBus");
  const mockCeler = await MockCeler.deploy() as MockMessageBus;
  await mockCeler.waitForDeployment();

  const MockHyperlane = await ethers.getContractFactory("MockHyperlaneMailbox");
  const mockHyperlane = await MockHyperlane.deploy() as MockHyperlaneMailbox;
  await mockHyperlane.waitForDeployment();

  // Deploy LookCoin with proxy
  const LookCoin = await ethers.getContractFactory("LookCoin");
  const lookCoin = await upgrades.deployProxy(
    LookCoin,
    [owner.address, await mockLayerZero.getAddress()],
    { initializer: "initialize" }
  ) as unknown as LookCoin;

  // Deploy FeeManager
  const FeeManager = await ethers.getContractFactory("FeeManager");
  const feeManager = await upgrades.deployProxy(
    FeeManager,
    [admin.address],
    { initializer: "initialize" }
  );

  // Deploy SecurityManager 
  const SecurityManager = await ethers.getContractFactory("SecurityManager");
  const securityManager = await upgrades.deployProxy(
    SecurityManager,
    [admin.address, ethers.parseEther("20000000")], // 20M daily limit
    { initializer: "initialize" }
  );

  // Deploy CrossChainRouter with proxy
  const CrossChainRouter = await ethers.getContractFactory("contracts/xchain/CrossChainRouter.sol:CrossChainRouter");
  const crossChainRouter = await upgrades.deployProxy(
    CrossChainRouter,
    [await lookCoin.getAddress(), await feeManager.getAddress(), await securityManager.getAddress(), admin.address],
    { initializer: "initialize" }
  ) as unknown as CrossChainRouter;

  // Deploy bridge modules
  const LayerZeroModule = await ethers.getContractFactory("LayerZeroModule");
  const layerZeroModule = await upgrades.deployProxy(
    LayerZeroModule,
    [await lookCoin.getAddress(), await mockLayerZero.getAddress(), admin.address],
    { initializer: "initialize" }
  ) as unknown as LayerZeroModule;

  const CelerIMModule = await ethers.getContractFactory("CelerIMModule");
  const celerIMModule = await upgrades.deployProxy(
    CelerIMModule,
    [await mockCeler.getAddress(), await lookCoin.getAddress(), admin.address],
    { initializer: "initialize" }
  ) as unknown as CelerIMModule;

  const HyperlaneModule = await ethers.getContractFactory("HyperlaneModule");
  const hyperlaneModule = await upgrades.deployProxy(
    HyperlaneModule,
    [
      await lookCoin.getAddress(),
      await mockHyperlane.getAddress(),
      await mockHyperlane.getAddress(), // Using same mock for gas paymaster
      admin.address
    ],
    { initializer: "initialize" }
  ) as unknown as HyperlaneModule;

  // Grant roles
  await lookCoin.grantRole(await lookCoin.MINTER_ROLE(), minter.address);
  await lookCoin.grantRole(await lookCoin.BURNER_ROLE(), burner.address);
  await lookCoin.grantRole(await lookCoin.PAUSER_ROLE(), pauser.address);
  await lookCoin.grantRole(await lookCoin.UPGRADER_ROLE(), upgrader.address);
  await lookCoin.grantRole(await lookCoin.BRIDGE_ROLE(), bridgeOperator.address);
  await lookCoin.grantRole(await lookCoin.PROTOCOL_ADMIN_ROLE(), protocolAdmin.address);

  // Grant bridge role to modules
  await lookCoin.grantRole(await lookCoin.BRIDGE_ROLE(), await layerZeroModule.getAddress());
  await lookCoin.grantRole(await lookCoin.BRIDGE_ROLE(), await celerIMModule.getAddress());
  await lookCoin.grantRole(await lookCoin.BRIDGE_ROLE(), await hyperlaneModule.getAddress());

  // Register protocols with router
  await crossChainRouter.connect(admin).registerProtocol(0, await layerZeroModule.getAddress()); // LayerZero
  await crossChainRouter.connect(admin).registerProtocol(1, await celerIMModule.getAddress()); // Celer
  await crossChainRouter.connect(admin).registerProtocol(2, await hyperlaneModule.getAddress()); // Hyperlane

  return {
    lookCoin,
    crossChainRouter,
    layerZeroModule,
    celerIMModule,
    hyperlaneModule,
    mockLayerZero,
    mockCeler,
    mockHyperlane,
    owner,
    admin,
    operator,
    user,
    user2,
    minter,
    burner,
    pauser,
    upgrader,
    bridgeOperator,
    protocolAdmin,
    securityAdmin,
    feeCollector,
  };
}

// Configuration Management Helpers
export async function configureLookCoinForTesting(
  lookCoin: LookCoin,
  protocolAdmin: SignerWithAddress,
  destinationChainId: number,
  trustedRemote: string,
  gasAmount: number = 200000
) {
  // Set trusted remote for destination chain
  await lookCoin.connect(protocolAdmin).setTrustedRemote(
    destinationChainId,
    trustedRemote
  );

  // Set gas for destination
  await lookCoin.connect(protocolAdmin).setGasForDestinationLzReceive(
    destinationChainId,
    gasAmount
  );
}

export async function configureLayerZeroModule(
  module: LayerZeroModule,
  admin: SignerWithAddress,
  destinationChainId: number,
  remoteAddress: string
) {
  await module.connect(admin).setTrustedRemote(destinationChainId, remoteAddress);
  await module.connect(admin).setDestinationGas(destinationChainId, 200000);
}

export async function configureCelerModule(
  module: CelerIMModule,
  admin: SignerWithAddress,
  destinationChainId: number,
  remoteAddress: string,
  feeCollector: string
) {
  await module.connect(admin).setSupportedChain(destinationChainId, true);
  await module.connect(admin).setRemoteModule(destinationChainId, remoteAddress);
  await module.connect(admin).updateFeeCollector(feeCollector);
}

export async function configureHyperlaneModule(
  module: HyperlaneModule,
  admin: SignerWithAddress,
  destinationDomain: number,
  destinationChainId: number,
  trustedSender: string
) {
  await module.connect(admin).setDomainMapping(destinationDomain, destinationChainId);
  await module.connect(admin).setTrustedSender(destinationDomain, trustedSender);
  await module.connect(admin).setRequiredGasAmount(destinationDomain, 200000);
}

export async function configureAllBridges(
  fixture: DeploymentFixture,
  destinationChainId: number,
  destinationDomain: number = 2 // Default for Hyperlane
) {
  const remoteAddress = "0x" + "1".repeat(40);
  const trustedRemote = ethers.solidityPacked(["address", "address"], [remoteAddress, await fixture.lookCoin.getAddress()]);

  // Configure LookCoin OFT
  await configureLookCoinForTesting(
    fixture.lookCoin,
    fixture.protocolAdmin,
    destinationChainId,
    trustedRemote
  );

  // Configure LayerZero module
  await configureLayerZeroModule(
    fixture.layerZeroModule,
    fixture.admin,
    destinationChainId,
    remoteAddress
  );

  // Configure Celer module
  await configureCelerModule(
    fixture.celerIMModule,
    fixture.admin,
    destinationChainId,
    remoteAddress,
    fixture.feeCollector.address
  );

  // Configure Hyperlane module
  await configureHyperlaneModule(
    fixture.hyperlaneModule,
    fixture.admin,
    destinationDomain,
    destinationChainId,
    remoteAddress
  );

  // Configure router chain support
  await fixture.crossChainRouter.connect(fixture.admin).setChainProtocolSupport(destinationChainId, 0, true); // LayerZero
  await fixture.crossChainRouter.connect(fixture.admin).setChainProtocolSupport(destinationChainId, 1, true); // Celer
  await fixture.crossChainRouter.connect(fixture.admin).setChainProtocolSupport(destinationChainId, 2, true); // Hyperlane
}

// Mock Management Helpers
export async function setupMockLayerZero(
  mock: MockLayerZeroEndpoint,
  successMode: boolean = true,
  estimatedFee: bigint = ethers.parseEther("0.01")
) {
  // Mock doesn't have these methods - just return for now
  // The mock always returns 0.01 ether as fee
}

export async function setupMockCeler(
  mock: MockMessageBus,
  successMode: boolean = true,
  messageFee: bigint = ethers.parseEther("0.005")
) {
  // Set fee parameters on the mock
  await mock.setFeeParams(messageFee, 1000);
}

export async function setupMockHyperlane(
  mock: MockHyperlaneMailbox,
  successMode: boolean = true,
  gasPayment: bigint = ethers.parseEther("0.008")
) {
  // Mock doesn't have these methods - just return for now
  // The mock has basic dispatch functionality
}

export async function simulateCrossChainMessage(
  sourceChainId: number,
  targetContract: Contract,
  messageData: string,
  protocol: "layerzero" | "celer" | "hyperlane"
) {
  switch (protocol) {
    case "layerzero":
      // Simulate LayerZero message
      const packet = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint16", "bytes"],
        [0, messageData] // PT_SEND = 0
      );
      await targetContract.lzReceive(sourceChainId, "0x", 0, packet);
      break;
    case "celer":
      // Simulate Celer message
      await targetContract.executeMessageWithTransfer(
        "0x", // sender
        targetContract.address,
        messageData,
        0 // messageId
      );
      break;
    case "hyperlane":
      // Simulate Hyperlane message
      await targetContract.handle(
        1, // origin domain
        ethers.encodeBytes32String("sender"),
        messageData
      );
      break;
  }
}

// Role and Permission Helpers
export async function grantAllRoles(
  lookCoin: LookCoin,
  account: SignerWithAddress
) {
  const roles = [
    await lookCoin.MINTER_ROLE(),
    await lookCoin.BURNER_ROLE(),
    await lookCoin.PAUSER_ROLE(),
    await lookCoin.UPGRADER_ROLE(),
    await lookCoin.BRIDGE_ROLE(),
    await lookCoin.PROTOCOL_ADMIN_ROLE(),
  ];

  for (const role of roles) {
    await lookCoin.grantRole(role, account.address);
  }
}

export async function revokeAllRoles(
  lookCoin: LookCoin,
  account: SignerWithAddress
) {
  const roles = [
    await lookCoin.MINTER_ROLE(),
    await lookCoin.BURNER_ROLE(),
    await lookCoin.PAUSER_ROLE(),
    await lookCoin.UPGRADER_ROLE(),
    await lookCoin.BRIDGE_ROLE(),
    await lookCoin.PROTOCOL_ADMIN_ROLE(),
  ];

  for (const role of roles) {
    await lookCoin.revokeRole(role, account.address);
  }
}

export async function testRolePermissions(
  contract: Contract,
  roleName: string,
  roleFunction: string,
  args: any[],
  authorizedSigner: SignerWithAddress,
  unauthorizedSigner: SignerWithAddress
) {
  const role = await contract[roleName]();
  await testRoleBasedFunction(
    contract,
    roleFunction,
    args,
    role,
    authorizedSigner,
    unauthorizedSigner
  );
}

// State Manipulation Helpers
export async function pauseAllContracts(fixture: DeploymentFixture) {
  await fixture.lookCoin.connect(fixture.pauser).pause();
  await fixture.crossChainRouter.connect(fixture.admin).pause();
  await fixture.celerIMModule.connect(fixture.admin).pause();
  await fixture.hyperlaneModule.connect(fixture.admin).pause();
}

export async function unpauseAllContracts(fixture: DeploymentFixture) {
  await fixture.lookCoin.connect(fixture.pauser).unpause();
  await fixture.crossChainRouter.connect(fixture.admin).unpause();
  await fixture.celerIMModule.connect(fixture.admin).unpause();
  await fixture.hyperlaneModule.connect(fixture.admin).unpause();
}

export async function enableAllProtocols(
  router: CrossChainRouter,
  admin: SignerWithAddress
) {
  await router.connect(admin).updateProtocolStatus(0, true);
  await router.connect(admin).updateProtocolStatus(1, true);
  await router.connect(admin).updateProtocolStatus(2, true);
}

export async function disableAllProtocols(
  router: CrossChainRouter,
  admin: SignerWithAddress
) {
  await router.connect(admin).updateProtocolStatus(0, false);
  await router.connect(admin).updateProtocolStatus(1, false);
  await router.connect(admin).updateProtocolStatus(2, false);
}

// Transfer and Operation Helpers
export async function executeCrossChainTransfer(
  lookCoin: LookCoin,
  sender: SignerWithAddress,
  recipient: string,
  amount: bigint,
  destinationChainId: number,
  refundAddress: string = sender.address,
  zroPaymentAddress: string = ethers.ZeroAddress,
  adapterParams: string = "0x"
): Promise<any> {
  // Approve if needed
  const lookCoinAddress = await lookCoin.getAddress();
  const allowance = await lookCoin.allowance(sender.address, lookCoinAddress);
  if (allowance < amount) {
    await lookCoin.connect(sender).approve(lookCoinAddress, amount);
  }

  // Estimate fee
  const [nativeFee] = await lookCoin.estimateSendFee(
    destinationChainId,
    recipient,
    amount,
    false,
    adapterParams
  );

  // Execute transfer
  const tx = await lookCoin.connect(sender).sendFrom(
    sender.address,
    destinationChainId,
    recipient,
    amount,
    refundAddress,
    zroPaymentAddress,
    adapterParams,
    { value: nativeFee }
  );

  return tx;
}

export async function simulateTransferFailure(
  mock: MockLayerZeroEndpoint | MockMessageBus | MockHyperlaneMailbox,
  protocol: "layerzero" | "celer" | "hyperlane"
) {
  // The current mocks don't have failure simulation methods
  // This would need to be implemented in the mock contracts
  // For now, just log that simulation is not supported
}

// Assertion and Validation Helpers
export async function assertRoleBasedAccess(
  contract: Contract,
  functionName: string,
  args: any[],
  role: string,
  authorizedSigner: SignerWithAddress,
  unauthorizedSigner: SignerWithAddress
) {
  // Should succeed with authorized signer
  await expect(
    contract.connect(authorizedSigner)[functionName](...args)
  ).to.not.be.reverted;

  // Should fail with unauthorized signer
  await expect(
    contract.connect(unauthorizedSigner)[functionName](...args)
  ).to.be.revertedWithCustomError(contract, "AccessControlUnauthorizedAccount")
    .withArgs(unauthorizedSigner.address, role);
}

export async function assertEventEmission(
  tx: any,
  contract: Contract,
  eventName: string,
  expectedArgs: any[]
) {
  await expect(tx)
    .to.emit(contract, eventName)
    .withArgs(...expectedArgs);
}

export async function assertBalanceChanges(
  token: LookCoin,
  account: string,
  expectedChange: bigint,
  operation: () => Promise<any>
) {
  const balanceBefore = await token.balanceOf(account);
  await operation();
  const balanceAfter = await token.balanceOf(account);
  expect(balanceAfter - balanceBefore).to.equal(expectedChange);
}

export async function assertSupplyChanges(
  token: LookCoin,
  expectedMintChange: bigint,
  expectedBurnChange: bigint,
  operation: () => Promise<any>
) {
  const mintedBefore = await token.totalMinted();
  const burnedBefore = await token.totalBurned();
  
  await operation();
  
  const mintedAfter = await token.totalMinted();
  const burnedAfter = await token.totalBurned();
  
  expect(mintedAfter - mintedBefore).to.equal(expectedMintChange);
  expect(burnedAfter - burnedBefore).to.equal(expectedBurnChange);
}

// Time and Block Manipulation Helpers
export async function advanceTimeAndBlock(seconds: number) {
  await time.increase(seconds);
  await ethers.provider.send("evm_mine", []);
}

// Error and Exception Helpers
export async function expectSpecificRevert(
  operation: () => Promise<any>,
  contract: Contract,
  errorName: string,
  ...errorArgs: any[]
) {
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
}

export async function testAllRevertScenarios(
  scenarios: Array<{
    name: string;
    operation: () => Promise<any>;
    contract: Contract;
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

// Coverage and Reporting Helpers
export interface CoverageReport {
  contract: string;
  functions: Map<string, boolean>;
  branches: Map<string, boolean>;
  booleanCombinations: Map<string, boolean>;
}

export class CoverageTracker {
  private reports: Map<string, CoverageReport> = new Map();

  trackFunction(contract: string, functionName: string) {
    if (!this.reports.has(contract)) {
      this.reports.set(contract, {
        contract,
        functions: new Map(),
        branches: new Map(),
        booleanCombinations: new Map(),
      });
    }
    this.reports.get(contract)!.functions.set(functionName, true);
  }

  trackBranch(contract: string, branchName: string) {
    if (!this.reports.has(contract)) {
      this.reports.set(contract, {
        contract,
        functions: new Map(),
        branches: new Map(),
        booleanCombinations: new Map(),
      });
    }
    this.reports.get(contract)!.branches.set(branchName, true);
  }

  trackBooleanCombination(contract: string, combinationName: string) {
    if (!this.reports.has(contract)) {
      this.reports.set(contract, {
        contract,
        functions: new Map(),
        branches: new Map(),
        booleanCombinations: new Map(),
      });
    }
    this.reports.get(contract)!.booleanCombinations.set(combinationName, true);
  }

  generateReport(): string {
    let report = "Coverage Report:\n\n";
    
    for (const [contractName, coverage] of this.reports) {
      report += `Contract: ${contractName}\n`;
      report += `  Functions: ${coverage.functions.size} tested\n`;
      report += `  Branches: ${coverage.branches.size} tested\n`;
      report += `  Boolean Combinations: ${coverage.booleanCombinations.size} tested\n\n`;
    }
    
    return report;
  }

  validateCompleteCoverage(
    expectedFunctions: string[],
    expectedBranches: string[],
    expectedCombinations: string[]
  ): boolean {
    for (const [contractName, coverage] of this.reports) {
      const missingFunctions = expectedFunctions.filter(f => !coverage.functions.has(f));
      const missingBranches = expectedBranches.filter(b => !coverage.branches.has(b));
      const missingCombinations = expectedCombinations.filter(c => !coverage.booleanCombinations.has(c));
      
      if (missingFunctions.length > 0 || missingBranches.length > 0 || missingCombinations.length > 0) {
        console.error(`Missing coverage in ${contractName}:`);
        if (missingFunctions.length > 0) console.error(`  Functions: ${missingFunctions.join(", ")}`);
        if (missingBranches.length > 0) console.error(`  Branches: ${missingBranches.join(", ")}`);
        if (missingCombinations.length > 0) console.error(`  Combinations: ${missingCombinations.join(", ")}`);
        return false;
      }
    }
    return true;
  }
}

export const coverageTracker = new CoverageTracker();

// Integration Testing Helpers
export async function testProtocolInteroperability(
  fixture: DeploymentFixture,
  amount: bigint,
  destinationChainId: number
) {
  const recipient = "0x" + "2".repeat(40);
  
  // Test all protocols can bridge
  for (const protocol of [0, 1, 2]) { // LayerZero, Celer, Hyperlane
    const options = await fixture.crossChainRouter.getBridgeOptions(destinationChainId);
    const protocolOption = options.find(o => o.protocol === protocol);
    
    expect(protocolOption).to.not.be.undefined;
    expect(protocolOption!.available).to.be.true;
    
    // Execute bridge via router
    await fixture.lookCoin.connect(fixture.user).approve(await fixture.crossChainRouter.getAddress(), amount);
    
    const tx = await fixture.crossChainRouter.connect(fixture.user).bridgeToken(
      protocol,
      destinationChainId,
      recipient,
      amount,
      { value: protocolOption!.estimatedFee }
    );
    
    await expect(tx).to.emit(fixture.crossChainRouter, "TransferInitiated");
  }
}

export async function validateCrossContractInteractions(
  fixture: DeploymentFixture,
  operation: () => Promise<any>
) {
  // Track state before operation
  const lookCoinSupplyBefore = await fixture.lookCoin.totalSupply();
  const routerPausedBefore = await fixture.crossChainRouter.paused();
  
  // Execute operation
  await operation();
  
  // Validate state consistency
  const lookCoinSupplyAfter = await fixture.lookCoin.totalSupply();
  const routerPausedAfter = await fixture.crossChainRouter.paused();
  
  // Add specific validations based on operation type
  return {
    supplyChanged: lookCoinSupplyAfter !== lookCoinSupplyBefore,
    pauseStateChanged: routerPausedAfter !== routerPausedBefore,
  };
}