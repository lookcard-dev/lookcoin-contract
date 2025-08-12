import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";
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
import { ROLES } from "./constants";
import { DeploymentFixture } from "./fixtures";

// Contract types that support access control
type AccessControlContract = 
  | LookCoin 
  | CrossChainRouter 
  | LayerZeroModule 
  | CelerIMModule 
  | HyperlaneModule 
  | SupplyOracle 
  | SecurityManager 
  | FeeManager 
  | ProtocolRegistry 
  | MinimalTimelock;

// Role configuration interface
export interface RoleConfig {
  contract: AccessControlContract;
  role: string;
  account: string;
  granter?: SignerWithAddress;
}

// Batch role configuration
export interface BatchRoleConfig {
  contracts: AccessControlContract[];
  roles: string[];
  accounts: string[];
  granter: SignerWithAddress;
}

/**
 * Grant a single role to an account
 */
export async function grantRole(
  contract: AccessControlContract,
  role: string,
  account: string,
  granter?: SignerWithAddress
): Promise<void> {
  const signer = granter || (await ethers.getSigners())[0];
  await contract.connect(signer).grantRole(role, account);
}

/**
 * Revoke a single role from an account
 */
export async function revokeRole(
  contract: AccessControlContract,
  role: string,
  account: string,
  revoker?: SignerWithAddress
): Promise<void> {
  const signer = revoker || (await ethers.getSigners())[0];
  await contract.connect(signer).revokeRole(role, account);
}

/**
 * Grant multiple roles at once
 */
export async function grantMultipleRoles(configs: RoleConfig[]): Promise<void> {
  for (const config of configs) {
    await grantRole(config.contract, config.role, config.account, config.granter);
  }
}

/**
 * Setup all LookCoin roles for a complete test environment
 */
export async function setupLookCoinRoles(
  lookCoin: LookCoin,
  fixture: DeploymentFixture
): Promise<void> {
  const admin = fixture.governance; // LookCoin admin is governance
  
  const roleAssignments: Array<{ role: string; account: string }> = [
    { role: await lookCoin.MINTER_ROLE(), account: fixture.minter.address },
    { role: await lookCoin.BURNER_ROLE(), account: fixture.burner.address },
    { role: await lookCoin.PAUSER_ROLE(), account: fixture.pauser.address },
    { role: await lookCoin.UPGRADER_ROLE(), account: fixture.upgrader.address },
    { role: await lookCoin.BRIDGE_ROLE(), account: fixture.bridgeOperator.address },
    { role: await lookCoin.PROTOCOL_ADMIN_ROLE(), account: fixture.protocolAdmin.address },
    
    // Grant bridge role to all bridge modules
    { role: await lookCoin.BRIDGE_ROLE(), account: await fixture.layerZeroModule.getAddress() },
    { role: await lookCoin.BRIDGE_ROLE(), account: await fixture.celerIMModule.getAddress() },
    { role: await lookCoin.BRIDGE_ROLE(), account: await fixture.hyperlaneModule.getAddress() },
    { role: await lookCoin.BRIDGE_ROLE(), account: await fixture.crossChainRouter.getAddress() },
    
    // Grant minter role to bridge modules and router
    { role: await lookCoin.MINTER_ROLE(), account: await fixture.layerZeroModule.getAddress() },
    { role: await lookCoin.MINTER_ROLE(), account: await fixture.celerIMModule.getAddress() },
    { role: await lookCoin.MINTER_ROLE(), account: await fixture.hyperlaneModule.getAddress() },
    { role: await lookCoin.MINTER_ROLE(), account: await fixture.crossChainRouter.getAddress() },
    
    // Grant burner role to bridge modules and router
    { role: await lookCoin.BURNER_ROLE(), account: await fixture.layerZeroModule.getAddress() },
    { role: await lookCoin.BURNER_ROLE(), account: await fixture.celerIMModule.getAddress() },
    { role: await lookCoin.BURNER_ROLE(), account: await fixture.hyperlaneModule.getAddress() },
    { role: await lookCoin.BURNER_ROLE(), account: await fixture.crossChainRouter.getAddress() },
  ];
  
  for (const assignment of roleAssignments) {
    await lookCoin.connect(admin).grantRole(assignment.role, assignment.account);
  }
}

/**
 * Setup CrossChainRouter roles
 */
export async function setupRouterRoles(
  router: CrossChainRouter,
  fixture: DeploymentFixture
): Promise<void> {
  const admin = fixture.admin;
  
  const roleAssignments: Array<{ role: string; account: string }> = [
    { role: await router.ROUTER_ADMIN_ROLE(), account: fixture.operator.address },
    { role: await router.UPGRADER_ROLE(), account: fixture.upgrader.address },
  ];
  
  for (const assignment of roleAssignments) {
    await router.connect(admin).grantRole(assignment.role, assignment.account);
  }
}

/**
 * Setup SupplyOracle roles
 */
export async function setupSupplyOracleRoles(
  oracle: SupplyOracle,
  fixture: DeploymentFixture
): Promise<void> {
  const admin = fixture.admin;
  
  // Grant oracle roles to signers
  const ORACLE_ROLE = await oracle.ORACLE_ROLE();
  await oracle.connect(admin).grantRole(ORACLE_ROLE, fixture.oracleSigner1.address);
  await oracle.connect(admin).grantRole(ORACLE_ROLE, fixture.oracleSigner2.address);
  await oracle.connect(admin).grantRole(ORACLE_ROLE, fixture.oracleSigner3.address);
  
  // Grant upgrader role
  await oracle.connect(admin).grantRole(
    await oracle.UPGRADER_ROLE(),
    fixture.upgrader.address
  );
}

/**
 * Setup SecurityManager roles
 */
export async function setupSecurityManagerRoles(
  securityManager: SecurityManager,
  fixture: DeploymentFixture
): Promise<void> {
  const admin = fixture.admin;
  
  const roleAssignments: Array<{ role: string; account: string }> = [
    { role: await securityManager.OPERATOR_ROLE(), account: fixture.operator.address },
    { role: await securityManager.UPGRADER_ROLE(), account: fixture.upgrader.address },
    { role: await securityManager.EMERGENCY_ROLE(), account: fixture.securityAdmin.address },
  ];
  
  for (const assignment of roleAssignments) {
    await securityManager.connect(admin).grantRole(assignment.role, assignment.account);
  }
}

/**
 * Setup Timelock roles
 */
export async function setupTimelockRoles(
  timelock: MinimalTimelock,
  fixture: DeploymentFixture
): Promise<void> {
  const admin = fixture.governance; // Timelock admin is governance
  
  const roleAssignments: Array<{ role: string; account: string }> = [
    { role: await timelock.PROPOSER_ROLE(), account: fixture.governance.address },
    { role: await timelock.EXECUTOR_ROLE(), account: fixture.governance.address },
    { role: await timelock.CANCELLER_ROLE(), account: fixture.governance.address },
  ];
  
  for (const assignment of roleAssignments) {
    await timelock.connect(admin).grantRole(assignment.role, assignment.account);
  }
}

/**
 * Setup all roles for a complete deployment fixture
 */
export async function setupAllRoles(fixture: DeploymentFixture): Promise<void> {
  // Setup LookCoin roles
  await setupLookCoinRoles(fixture.lookCoin, fixture);
  
  // Setup infrastructure roles
  await setupRouterRoles(fixture.crossChainRouter, fixture);
  await setupSupplyOracleRoles(fixture.supplyOracle, fixture);
  await setupSecurityManagerRoles(fixture.securityManager, fixture);
  await setupTimelockRoles(fixture.timelock, fixture);
  
  // Setup bridge module roles (they get admin role by default in constructor)
  // Additional roles can be added here if needed
}

/**
 * Verify role assignment
 */
export async function hasRole(
  contract: AccessControlContract,
  role: string,
  account: string
): Promise<boolean> {
  return await contract.hasRole(role, account);
}

/**
 * Verify multiple role assignments
 */
export async function verifyRoles(
  expectations: Array<{
    contract: AccessControlContract;
    role: string;
    account: string;
    shouldHave: boolean;
  }>
): Promise<boolean> {
  for (const expectation of expectations) {
    const hasIt = await hasRole(expectation.contract, expectation.role, expectation.account);
    if (hasIt !== expectation.shouldHave) {
      console.error(
        `Role mismatch: ${expectation.account} ${
          expectation.shouldHave ? "should have" : "should not have"
        } role ${expectation.role} on contract ${await expectation.contract.getAddress()}`
      );
      return false;
    }
  }
  return true;
}

/**
 * Get all accounts with a specific role
 */
export async function getRoleMembers(
  contract: AccessControlContract,
  role: string
): Promise<string[]> {
  const members: string[] = [];
  // Note: OpenZeppelin AccessControl doesn't have enumeration by default
  // This would require AccessControlEnumerable upgrade
  // For testing, we can check known accounts
  return members;
}

/**
 * Renounce a role (caller renounces their own role)
 */
export async function renounceRole(
  contract: AccessControlContract,
  role: string,
  account: SignerWithAddress
): Promise<void> {
  await contract.connect(account).renounceRole(role, account.address);
}

/**
 * Transfer admin role to a new account
 */
export async function transferAdminRole(
  contract: AccessControlContract,
  newAdmin: string,
  currentAdmin: SignerWithAddress
): Promise<void> {
  // Grant admin role to new admin
  await contract.connect(currentAdmin).grantRole(ROLES.DEFAULT_ADMIN_ROLE, newAdmin);
  
  // Optionally revoke from current admin
  // await contract.connect(currentAdmin).renounceRole(ROLES.DEFAULT_ADMIN_ROLE, currentAdmin.address);
}

/**
 * Setup emergency roles across all critical contracts
 */
export async function setupEmergencyRoles(
  fixture: DeploymentFixture,
  emergencyAdmin: SignerWithAddress
): Promise<void> {
  // Grant pause role on LookCoin
  await fixture.lookCoin
    .connect(fixture.governance)
    .grantRole(await fixture.lookCoin.PAUSER_ROLE(), emergencyAdmin.address);
  
  // Grant emergency role on SecurityManager
  await fixture.securityManager
    .connect(fixture.admin)
    .grantRole(await fixture.securityManager.EMERGENCY_ROLE(), emergencyAdmin.address);
  
  // Grant emergency role on CrossChainRouter
  await fixture.crossChainRouter
    .connect(fixture.admin)
    .grantRole(await fixture.crossChainRouter.EMERGENCY_ROLE(), emergencyAdmin.address);
}

/**
 * Remove all roles from an account across all contracts
 */
export async function revokeAllRoles(
  fixture: DeploymentFixture,
  account: string
): Promise<void> {
  const contracts: AccessControlContract[] = [
    fixture.lookCoin,
    fixture.crossChainRouter,
    fixture.supplyOracle,
    fixture.securityManager,
    fixture.feeManager,
    fixture.protocolRegistry,
    fixture.timelock,
    fixture.layerZeroModule,
    fixture.celerIMModule,
    fixture.hyperlaneModule,
  ];
  
  for (const contract of contracts) {
    // Check common roles
    const rolesToCheck = [
      ROLES.DEFAULT_ADMIN_ROLE,
      ROLES.MINTER_ROLE,
      ROLES.BURNER_ROLE,
      ROLES.PAUSER_ROLE,
      ROLES.UPGRADER_ROLE,
      ROLES.BRIDGE_ROLE,
      ROLES.PROTOCOL_ADMIN_ROLE,
      ROLES.EMERGENCY_ROLE,
    ];
    
    for (const role of rolesToCheck) {
      try {
        if (await contract.hasRole(role, account)) {
          // Find appropriate admin for this contract
          let admin: SignerWithAddress;
          if (contract === fixture.lookCoin || contract === fixture.timelock) {
            admin = fixture.governance;
          } else {
            admin = fixture.admin;
          }
          
          await contract.connect(admin).revokeRole(role, account);
        }
      } catch {
        // Role might not exist on this contract, continue
      }
    }
  }
}

/**
 * Create a role configuration for testing unauthorized access
 */
export function createUnauthorizedTest(
  contract: AccessControlContract,
  functionName: string,
  args: any[],
  requiredRole: string,
  authorizedAccount: SignerWithAddress,
  unauthorizedAccount: SignerWithAddress
) {
  return {
    contract,
    functionName,
    args,
    requiredRole,
    authorizedAccount,
    unauthorizedAccount,
  };
}