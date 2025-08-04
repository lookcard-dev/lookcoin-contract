import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  LookCoin,
  MockReentrantAttacker,
} from "../../typechain-types";
import { expectSpecificRevert } from "./utils";
import { AMOUNTS } from "./constants";

// Coverage tracking for security tests
export interface SecurityCoverageReport {
  contract: string;
  functions: Map<string, boolean>;
  branches: Map<string, boolean>;
  securityScenarios: Map<string, boolean>;
  vulnerabilities: Map<string, boolean>;
}

export class SecurityCoverageTracker {
  private reports: Map<string, SecurityCoverageReport> = new Map();

  trackFunction(contract: string, functionName: string) {
    this.getOrCreateReport(contract).functions.set(functionName, true);
  }

  trackBranch(contract: string, branchName: string) {
    this.getOrCreateReport(contract).branches.set(branchName, true);
  }

  trackSecurityScenario(contract: string, scenarioName: string) {
    this.getOrCreateReport(contract).securityScenarios.set(scenarioName, true);
  }

  trackVulnerability(contract: string, vulnerabilityName: string) {
    this.getOrCreateReport(contract).vulnerabilities.set(vulnerabilityName, true);
  }

  private getOrCreateReport(contract: string): SecurityCoverageReport {
    if (!this.reports.has(contract)) {
      this.reports.set(contract, {
        contract,
        functions: new Map(),
        branches: new Map(),
        securityScenarios: new Map(),
        vulnerabilities: new Map(),
      });
    }
    return this.reports.get(contract)!;
  }

  generateReport(): string {
    let report = "Security Coverage Report:\n\n";
    
    for (const [contractName, coverage] of this.reports) {
      report += `Contract: ${contractName}\n`;
      report += `  Functions: ${coverage.functions.size} tested\n`;
      report += `  Branches: ${coverage.branches.size} tested\n`;
      report += `  Security Scenarios: ${coverage.securityScenarios.size} tested\n`;
      report += `  Vulnerabilities: ${coverage.vulnerabilities.size} tested\n\n`;
    }
    
    return report;
  }
}

export const securityTracker = new SecurityCoverageTracker();

// Reentrancy attack testing utilities
export interface ReentrancyTestConfig {
  contract: LookCoin;
  attacker: MockReentrantAttacker;
  victim: SignerWithAddress;
  amount: bigint;
  maxDepth: number;
}

/**
 * Test reentrancy protection on mint function
 */
export async function testMintReentrancyProtection(config: ReentrancyTestConfig) {
  const { contract, attacker, victim, amount } = config;
  
  // MockReentrantAttacker doesn't have initialize method, use attackMint directly
  // Attempt reentrancy attack on mint - should fail due to nonReentrant modifier
  await expectSpecificRevert(
    async () => attacker.attackMint(victim.address, amount),
    contract,
    "ReentrancyGuardReentrantCall"
  );
  
  securityTracker.trackSecurityScenario("LookCoin", "mint-reentrancy-protection");
}

/**
 * Test reentrancy protection on burn function
 */
export async function testBurnReentrancyProtection(config: ReentrancyTestConfig) {
  const { contract, attacker, victim, amount } = config;
  
  // Fund attacker for burn test
  await contract.connect(victim).transfer(await attacker.getAddress(), amount);
  
  // Attempt reentrancy attack on burn - should fail due to nonReentrant modifier
  await expectSpecificRevert(
    async () => attacker.attackBurn(victim.address, amount),
    contract,
    "ReentrancyGuardReentrantCall"
  );
  
  securityTracker.trackSecurityScenario("LookCoin", "burn-reentrancy-protection");
}

/**
 * Demonstrate reentrancy vulnerability on unprotected contract
 */
export async function demonstrateReentrancyVulnerability() {
  // Deploy vulnerable token for comparison
  const VulnerableToken = await ethers.getContractFactory("MockVulnerableToken");
  const vulnerableToken = await VulnerableToken.deploy();
  await vulnerableToken.waitForDeployment();

  // Deploy vulnerable attacker
  const VulnerableAttacker = await ethers.getContractFactory("MockReentrantVulnerableAttacker");
  const vulnerableAttacker = await VulnerableAttacker.deploy(await vulnerableToken.getAddress());
  await vulnerableAttacker.waitForDeployment();
  
  // Grant roles to attacker on vulnerable token
  await vulnerableToken.grantMinterRole(await vulnerableAttacker.getAddress());
  await vulnerableToken.grantBurnerRole(await vulnerableAttacker.getAddress());
  await vulnerableToken.setMintBurnHook(await vulnerableAttacker.getAddress());
  
  const amount = AMOUNTS.HUNDRED_TOKENS;
  const [user] = await ethers.getSigners();
  
  // Attack should succeed on vulnerable token
  await vulnerableAttacker.attackMint(user.address, amount);
  
  expect(await vulnerableAttacker.wasAttackSuccessful()).to.be.true;
  expect(await vulnerableAttacker.successfulReentries()).to.be.gt(0);
  
  // More tokens minted than intended due to reentrancy
  const balance = await vulnerableToken.balanceOf(user.address);
  expect(balance).to.be.gt(amount);

  securityTracker.trackVulnerability("MockVulnerableToken", "reentrancy-vulnerability-demonstrated");
  return { vulnerableToken, vulnerableAttacker, balance };
}

/**
 * Test with simple reentrancy tester to show guard effectiveness
 */
export async function testReentrancyGuardEffectiveness() {
  const SimpleReentrancyTester = await ethers.getContractFactory("SimpleReentrancyTester");
  const simpleTester = await SimpleReentrancyTester.deploy();
  await simpleTester.waitForDeployment();
  
  const SimpleAttacker = await ethers.getContractFactory("SimpleAttacker");
  const simpleAttacker = await SimpleAttacker.deploy(await simpleTester.getAddress());
  await simpleAttacker.waitForDeployment();
  
  await simpleTester.setAttacker(await simpleAttacker.getAddress());
  
  // Test vulnerable function (no guard)
  const vulnerableCounterBefore = await simpleTester.counter();
  await simpleTester.vulnerableFunction();
  const vulnerableCounterAfter = await simpleTester.counter();
  
  // Reentrancy succeeds, counter increments multiple times
  expect(vulnerableCounterAfter - vulnerableCounterBefore).to.be.gt(1);
  
  // Reset and test protected function
  await simpleAttacker.reset();
  const protectedCounterBefore = await simpleTester.counter();
  await simpleTester.protectedFunction();
  const protectedCounterAfter = await simpleTester.counter();
  
  // Reentrancy blocked, counter increments only once
  expect(protectedCounterAfter - protectedCounterBefore).to.equal(1);

  securityTracker.trackSecurityScenario("SimpleReentrancyTester", "guard-effectiveness-demonstrated");
  return { simpleTester, simpleAttacker };
}

// Access control testing utilities
export interface AccessControlTestConfig {
  contract: LookCoin;
  functionName: string;
  args: any[];
  requiredRole: string;
  authorizedSigner: SignerWithAddress;
  unauthorizedSigners: SignerWithAddress[];
}

/**
 * Comprehensive access control testing
 */
export async function testAccessControl(config: AccessControlTestConfig) {
  const { contract, functionName, args, requiredRole, authorizedSigner, unauthorizedSigners } = config;
  
  // Test with authorized signer
  await expect((contract.connect(authorizedSigner) as any)[functionName](...args))
    .to.not.be.reverted;
  
  // Test with multiple unauthorized signers
  for (const unauthorizedSigner of unauthorizedSigners) {
    await expect((contract.connect(unauthorizedSigner) as any)[functionName](...args))
      .to.be.revertedWithCustomError(contract, "AccessControlUnauthorizedAccount")
      .withArgs(unauthorizedSigner.address, requiredRole);
  }
  
  securityTracker.trackSecurityScenario("LookCoin", `access-control-${functionName}`);
}

/**
 * Test role hierarchy and admin capabilities
 */
export async function testRoleHierarchy(contract: LookCoin, admin: SignerWithAddress, testRole: string, testAccount: string) {
  // Initially should not have role
  expect(await contract.hasRole(testRole, testAccount)).to.be.false;
  
  // Admin can grant role
  await contract.connect(admin).grantRole(testRole, testAccount);
  expect(await contract.hasRole(testRole, testAccount)).to.be.true;
  
  // Admin can revoke role
  await contract.connect(admin).revokeRole(testRole, testAccount);
  expect(await contract.hasRole(testRole, testAccount)).to.be.false;
  
  securityTracker.trackSecurityScenario("LookCoin", "role-hierarchy-management");
}

// Input validation testing
export interface InputValidationTest {
  name: string;
  operation: () => Promise<any>;
  expectedError: string;
  errorArgs?: any[];
}

/**
 * Test input validation with edge cases
 */
export async function testInputValidation(contract: LookCoin, tests: InputValidationTest[]) {
  for (const test of tests) {
    await expectSpecificRevert(
      test.operation,
      contract,
      test.expectedError,
      ...(test.errorArgs || [])
    );
    
    securityTracker.trackSecurityScenario("LookCoin", `input-validation-${test.name}`);
  }
}

/**
 * Test zero address validation
 */
export async function testZeroAddressValidation(contract: LookCoin, minter: SignerWithAddress) {
  const amount = AMOUNTS.TEN_TOKENS;
  
  await expectSpecificRevert(
    () => contract.connect(minter).mint(ethers.ZeroAddress, amount),
    contract,
    "LookCoin: mint to zero address"
  );
  
  securityTracker.trackSecurityScenario("LookCoin", "zero-address-validation");
}

/**
 * Test zero amount validation
 */
export async function testZeroAmountValidation(contract: LookCoin, minter: SignerWithAddress, user: SignerWithAddress) {
  await expectSpecificRevert(
    () => contract.connect(minter).mint(user.address, 0),
    contract,
    "LookCoin: amount must be greater than zero"
  );
  
  securityTracker.trackSecurityScenario("LookCoin", "zero-amount-validation");
}

// Integer overflow/underflow testing
/**
 * Test integer overflow protection
 */
export async function testIntegerOverflowProtection(contract: LookCoin, minter: SignerWithAddress, user: SignerWithAddress) {
  // Mint maximum possible amount
  const maxAmount = ethers.MaxUint256;
  
  // This should revert due to supply limits or overflow protection
  await expectSpecificRevert(
    () => contract.connect(minter).mint(user.address, maxAmount),
    contract,
    "LookCoin: amount must be greater than zero" // Or other appropriate error
  );
  
  securityTracker.trackVulnerability("LookCoin", "integer-overflow-protection");
}

/**
 * Test burn amount exceeds balance
 */
export async function testBurnExceedsBalance(contract: LookCoin, burner: SignerWithAddress, user: SignerWithAddress) {
  const balance = await contract.balanceOf(user.address);
  const excessAmount = balance + BigInt(1);
  
  await expectSpecificRevert(
    () => contract.connect(burner).burnFrom(user.address, excessAmount),
    contract,
    "ERC20: burn amount exceeds balance"
  );
  
  securityTracker.trackSecurityScenario("LookCoin", "burn-exceeds-balance-protection");
}

// Pause mechanism testing
/**
 * Test emergency pause scenarios
 */
export async function testEmergencyPause(contract: LookCoin, pauser: SignerWithAddress, user: SignerWithAddress) {
  const amount = AMOUNTS.TEN_TOKENS;
  
  // Pause contract
  await contract.connect(pauser).pause();
  expect(await contract.paused()).to.be.true;
  
  // All critical operations should be blocked
  const pausableOperations = [
    () => contract.connect(user).transfer(ethers.ZeroAddress, amount),
    () => contract.connect(user).approve(ethers.ZeroAddress, amount),
  ];
  
  for (const operation of pausableOperations) {
    await expectSpecificRevert(
      operation,
      contract,
      "EnforcedPause"
    );
  }
  
  // Unpause
  await contract.connect(pauser).unpause();
  expect(await contract.paused()).to.be.false;
  
  securityTracker.trackSecurityScenario("LookCoin", "emergency-pause-recovery");
}

// Supply invariant testing
/**
 * Test supply invariants under stress
 */
export async function testSupplyInvariants(
  contract: LookCoin,
  minter: SignerWithAddress,
  burner: SignerWithAddress,
  user: SignerWithAddress
) {
  const operations = [
    { type: "mint", amount: AMOUNTS.THOUSAND_TOKENS },
    { type: "burn", amount: AMOUNTS.HUNDRED_TOKENS },
    { type: "mint", amount: AMOUNTS.TEN_TOKENS },
    { type: "burn", amount: AMOUNTS.TEN_TOKENS },
  ];

  let expectedMinted = BigInt(0);
  let expectedBurned = BigInt(0);

  for (const op of operations) {
    if (op.type === "mint") {
      await contract.connect(minter).mint(user.address, op.amount);
      expectedMinted += op.amount;
    } else {
      await contract.connect(burner).burnFrom(user.address, op.amount);
      expectedBurned += op.amount;
    }
    
    // Verify invariants
    const totalMinted = await contract.totalMinted();
    const totalBurned = await contract.totalBurned();
    const totalSupply = await contract.totalSupply();
    const circulatingSupply = await contract.circulatingSupply();
    
    expect(totalMinted).to.equal(expectedMinted);
    expect(totalBurned).to.equal(expectedBurned);
    expect(totalSupply).to.equal(expectedMinted - expectedBurned);
    expect(circulatingSupply).to.equal(expectedMinted - expectedBurned);
  }
  
  securityTracker.trackSecurityScenario("LookCoin", "supply-invariant-maintenance");
}

// Gas limit testing
/**
 * Test gas limit scenarios
 */
export async function testGasLimits(contract: LookCoin, minter: SignerWithAddress, user: SignerWithAddress) {
  const amount = AMOUNTS.ONE_TOKEN;
  
  // Test normal operation gas usage
  const tx = await contract.connect(minter).mint(user.address, amount);
  const receipt = await tx.wait();
  
  // Gas should be reasonable (adjust based on actual contract)
  expect(receipt!.gasUsed).to.be.lt(200000);
  
  securityTracker.trackSecurityScenario("LookCoin", "gas-limit-validation");
}

// Cross-chain security testing
/**
 * Test bridge address validation
 */
export async function testBridgeAddressValidation(contract: LookCoin, user: SignerWithAddress) {
  const amount = AMOUNTS.TEN_TOKENS;
  const testChainId = 97;
  
  // Test invalid address formats
  const invalidFormats = [
    "0x123", // Too short
    "0x", // Empty
    "0x" + "g".repeat(40), // Invalid hex
  ];
  
  for (const invalidFormat of invalidFormats) {
    await expectSpecificRevert(
      () => contract.connect(user).bridgeToken(testChainId, invalidFormat, amount),
      contract,
      "LookCoin: invalid recipient format"
    );
  }
  
  // Test zero address
  const zeroBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [ethers.ZeroAddress]);
  await expectSpecificRevert(
    () => contract.connect(user).bridgeToken(testChainId, zeroBytes, amount),
    contract,
    "LookCoin: recipient is zero address"
  );
  
  securityTracker.trackSecurityScenario("LookCoin", "bridge-address-validation");
}

/**
 * Test unconfigured chain protection
 */
export async function testUnconfiguredChainProtection(contract: LookCoin, user: SignerWithAddress) {
  const amount = AMOUNTS.TEN_TOKENS;
  const unconfiguredChainId = 999999;
  const recipient = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user.address]);
  
  await expectSpecificRevert(
    () => contract.connect(user).bridgeToken(unconfiguredChainId, recipient, amount),
    contract,
    "LookCoin: destination chain not configured"
  );
  
  securityTracker.trackSecurityScenario("LookCoin", "unconfigured-chain-protection");
}