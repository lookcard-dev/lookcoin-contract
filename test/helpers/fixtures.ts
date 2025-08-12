import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
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
  MockLayerZeroEndpoint,
  MockMessageBus,
  MockHyperlaneMailbox,
} from "../../typechain-types";

export interface DeploymentFixture {
  // Core contracts
  lookCoin: LookCoin;
  crossChainRouter: CrossChainRouter;
  supplyOracle: SupplyOracle;
  securityManager: SecurityManager;
  feeManager: FeeManager;
  protocolRegistry: ProtocolRegistry;
  timelock: MinimalTimelock;
  
  // Bridge modules
  layerZeroModule: LayerZeroModule;
  celerIMModule: CelerIMModule;
  hyperlaneModule: HyperlaneModule;
  
  // Mock contracts
  mockLayerZero: MockLayerZeroEndpoint;
  mockCeler: MockMessageBus;
  mockHyperlane: MockHyperlaneMailbox;
  mockHyperlaneGasPaymaster: any; // MockHyperlaneGasPaymaster
  
  // Signers with specific roles
  owner: SignerWithAddress;
  admin: SignerWithAddress;
  governance: SignerWithAddress;
  minter: SignerWithAddress;
  burner: SignerWithAddress;
  pauser: SignerWithAddress;
  upgrader: SignerWithAddress;
  bridgeOperator: SignerWithAddress;
  protocolAdmin: SignerWithAddress;
  securityAdmin: SignerWithAddress;
  feeCollector: SignerWithAddress;
  user1: SignerWithAddress;
  user2: SignerWithAddress;
  attacker: SignerWithAddress;
  oracleSigner1: SignerWithAddress;
  oracleSigner2: SignerWithAddress;
  oracleSigner3: SignerWithAddress;
  operator: SignerWithAddress;
  
  // Convenience aliases and test properties
  user: SignerWithAddress; // Alias for user1
  testChainId: number; // Test chain ID for cross-chain operations
  testDomain: number; // Hyperlane domain for testing
  testEid: number; // LayerZero EID for testing
  remoteAddress: string; // Remote address for cross-chain testing
}

/**
 * Complete deployment fixture for all LookCoin contracts and infrastructure
 */
export async function deployLookCoinFixture(): Promise<DeploymentFixture> {
  const INITIAL_SUPPLY = ethers.parseEther("1000000000"); // 1 billion LOOK
  
  const [
    owner,
    admin, 
    governance,
    minter,
    burner,
    pauser,
    upgrader,
    bridgeOperator,
    protocolAdmin,
    securityAdmin,
    feeCollector,
    user1,
    user2,
    attacker,
    oracleSigner1,
    oracleSigner2,
    oracleSigner3,
    operator
  ] = await ethers.getSigners();

  // Deploy mock contracts first
  const MockLayerZero = await ethers.getContractFactory("MockLayerZeroEndpoint");
  const mockLayerZero = await MockLayerZero.deploy() as unknown as MockLayerZeroEndpoint;
  await mockLayerZero.waitForDeployment();

  const MockCeler = await ethers.getContractFactory("MockMessageBus");
  const mockCeler = await MockCeler.deploy() as unknown as MockMessageBus;
  await mockCeler.waitForDeployment();

  const MockHyperlane = await ethers.getContractFactory("MockHyperlaneMailbox");
  const mockHyperlane = await MockHyperlane.deploy() as unknown as MockHyperlaneMailbox;
  await mockHyperlane.waitForDeployment();

  const MockHyperlaneGasPaymaster = await ethers.getContractFactory("MockHyperlaneGasPaymaster");
  const mockHyperlaneGasPaymaster = await MockHyperlaneGasPaymaster.deploy();
  await mockHyperlaneGasPaymaster.waitForDeployment();

  // Deploy core LookCoin contract
  const LookCoin = await ethers.getContractFactory("LookCoin");
  const lookCoin = await upgrades.deployProxy(
    LookCoin,
    [governance.address, await mockLayerZero.getAddress()],
    { initializer: "initialize" }
  ) as unknown as LookCoin;

  // Deploy MinimalTimelock for governance
  const MinimalTimelock = await ethers.getContractFactory("MinimalTimelock");
  const timelock = await upgrades.deployProxy(
    MinimalTimelock,
    [governance.address],
    { initializer: "initialize" }
  ) as unknown as MinimalTimelock;

  // Deploy infrastructure contracts
  const FeeManager = await ethers.getContractFactory("FeeManager");
  const feeManager = await upgrades.deployProxy(
    FeeManager,
    [admin.address],
    { initializer: "initialize" }
  ) as unknown as FeeManager;

  const SecurityManager = await ethers.getContractFactory("SecurityManager");
  const securityManager = await upgrades.deployProxy(
    SecurityManager,
    [admin.address, ethers.parseEther("20000000")], // 20M daily limit
    { initializer: "initialize" }
  ) as unknown as SecurityManager;

  const ProtocolRegistry = await ethers.getContractFactory("ProtocolRegistry");
  const protocolRegistry = await upgrades.deployProxy(
    ProtocolRegistry,
    [admin.address],
    { initializer: "initialize" }
  ) as unknown as ProtocolRegistry;

  // Deploy CrossChainRouter
  const CrossChainRouter = await ethers.getContractFactory("CrossChainRouter");
  const crossChainRouter = await upgrades.deployProxy(
    CrossChainRouter,
    [
      await lookCoin.getAddress(),
      await feeManager.getAddress(),
      await securityManager.getAddress(),
      admin.address
    ],
    { initializer: "initialize" }
  ) as unknown as CrossChainRouter;

  // Deploy SupplyOracle
  const SupplyOracle = await ethers.getContractFactory("SupplyOracle");
  const supplyOracle = await upgrades.deployProxy(
    SupplyOracle,
    [
      admin.address,
      INITIAL_SUPPLY, // Total expected supply
      [31337, 97, 84532, 11155420] // Test chain IDs (Hardhat, BSC Testnet, Base Sepolia, Optimism Sepolia)
    ],
    { initializer: "initialize" }
  ) as unknown as SupplyOracle;

  // Deploy bridge modules
  const LayerZeroModule = await ethers.getContractFactory("LayerZeroModule");
  const layerZeroModule = await upgrades.deployProxy(
    LayerZeroModule,
    [
      await lookCoin.getAddress(),
      await mockLayerZero.getAddress(),
      admin.address
    ],
    { initializer: "initialize" }
  ) as unknown as LayerZeroModule;

  const CelerIMModule = await ethers.getContractFactory("CelerIMModule");
  const celerIMModule = await upgrades.deployProxy(
    CelerIMModule,
    [
      await mockCeler.getAddress(),
      await lookCoin.getAddress(),
      admin.address
    ],
    { initializer: "initialize" }
  ) as unknown as CelerIMModule;

  const HyperlaneModule = await ethers.getContractFactory("HyperlaneModule");
  const hyperlaneModule = await upgrades.deployProxy(
    HyperlaneModule,
    [
      await lookCoin.getAddress(),
      await mockHyperlane.getAddress(),
      await mockHyperlaneGasPaymaster.getAddress(), // Separate gas paymaster mock
      admin.address
    ],
    { initializer: "initialize" }
  ) as unknown as HyperlaneModule;

  // Grant roles to LookCoin (using governance account which is the admin)
  await lookCoin.connect(governance).grantRole(await lookCoin.MINTER_ROLE(), minter.address);
  await lookCoin.connect(governance).grantRole(await lookCoin.BURNER_ROLE(), burner.address);
  await lookCoin.connect(governance).grantRole(await lookCoin.PAUSER_ROLE(), pauser.address);
  await lookCoin.connect(governance).grantRole(await lookCoin.UPGRADER_ROLE(), upgrader.address);
  await lookCoin.connect(governance).grantRole(await lookCoin.BRIDGE_ROLE(), bridgeOperator.address);
  await lookCoin.connect(governance).grantRole(await lookCoin.PROTOCOL_ADMIN_ROLE(), protocolAdmin.address);

  // Grant bridge roles to modules and router
  await lookCoin.connect(governance).grantRole(await lookCoin.BRIDGE_ROLE(), await layerZeroModule.getAddress());
  await lookCoin.connect(governance).grantRole(await lookCoin.BRIDGE_ROLE(), await celerIMModule.getAddress());
  await lookCoin.connect(governance).grantRole(await lookCoin.BRIDGE_ROLE(), await hyperlaneModule.getAddress());
  await lookCoin.connect(governance).grantRole(await lookCoin.BRIDGE_ROLE(), await crossChainRouter.getAddress());
  
  // Grant minter/burner roles to bridge modules
  await lookCoin.connect(governance).grantRole(await lookCoin.MINTER_ROLE(), await layerZeroModule.getAddress());
  await lookCoin.connect(governance).grantRole(await lookCoin.MINTER_ROLE(), await celerIMModule.getAddress());
  await lookCoin.connect(governance).grantRole(await lookCoin.MINTER_ROLE(), await hyperlaneModule.getAddress());
  await lookCoin.connect(governance).grantRole(await lookCoin.MINTER_ROLE(), await crossChainRouter.getAddress());
  
  await lookCoin.connect(governance).grantRole(await lookCoin.BURNER_ROLE(), await layerZeroModule.getAddress());
  await lookCoin.connect(governance).grantRole(await lookCoin.BURNER_ROLE(), await celerIMModule.getAddress());
  await lookCoin.connect(governance).grantRole(await lookCoin.BURNER_ROLE(), await hyperlaneModule.getAddress());
  await lookCoin.connect(governance).grantRole(await lookCoin.BURNER_ROLE(), await crossChainRouter.getAddress());

  // Configure timelock roles
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
  const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
  
  await timelock.connect(governance).grantRole(PROPOSER_ROLE, governance.address);
  await timelock.connect(governance).grantRole(EXECUTOR_ROLE, governance.address);
  await timelock.connect(governance).grantRole(CANCELLER_ROLE, governance.address);

  // Phase 2: Setup - Configure local settings and roles
  
  // Register protocols with router
  await crossChainRouter.connect(admin).registerProtocol(0, await layerZeroModule.getAddress()); // LayerZero
  await crossChainRouter.connect(admin).registerProtocol(1, await celerIMModule.getAddress()); // Celer  
  await crossChainRouter.connect(admin).registerProtocol(2, await hyperlaneModule.getAddress()); // Hyperlane
  
  // Enable all protocols
  await crossChainRouter.connect(admin).updateProtocolStatus(0, true);
  await crossChainRouter.connect(admin).updateProtocolStatus(1, true);
  await crossChainRouter.connect(admin).updateProtocolStatus(2, true);
  
  // Configure SecurityManager
  // Note: SecurityManager configuration is done through constructor parameters
  
  // Configure SupplyOracle with oracle signers via ORACLE_ROLE
  const ORACLE_ROLE = await supplyOracle.ORACLE_ROLE();
  await supplyOracle.connect(admin).grantRole(ORACLE_ROLE, oracleSigner1.address);
  await supplyOracle.connect(admin).grantRole(ORACLE_ROLE, oracleSigner2.address);
  await supplyOracle.connect(admin).grantRole(ORACLE_ROLE, oracleSigner3.address);
  
  // Configure FeeManager
  // Note: FeeManager configuration is typically done through constructor or separate setup
  
  // Update protocol fee configurations if needed
  await feeManager.connect(admin).updateProtocolFees(0, 10000, 0); // LayerZero: 1x multiplier, 0 base fee
  await feeManager.connect(admin).updateProtocolFees(1, 10050, 100); // Celer: 1.005x multiplier (0.5% fee), 100 base
  await feeManager.connect(admin).updateProtocolFees(2, 10000, 0); // Hyperlane: 1x multiplier, 0 base fee
  
  // Grant router admin role to operator (if needed)
  const ROUTER_ADMIN_ROLE = await crossChainRouter.ROUTER_ADMIN_ROLE();
  await crossChainRouter.connect(admin).grantRole(ROUTER_ADMIN_ROLE, operator.address);
  
  // Grant operator roles to bridge modules
  const CELER_OPERATOR_ROLE = await celerIMModule.OPERATOR_ROLE();
  await celerIMModule.connect(admin).grantRole(CELER_OPERATOR_ROLE, operator.address);
  
  // Phase 3: Configure - Cross-chain setup (partial for testing)
  const testChainId = 31337; // Hardhat chain ID
  const testDomain = 2; // Hyperlane test domain
  const testEid = 30102; // LayerZero test EID
  const remoteAddress = "0x" + "1".repeat(40);
  
  return {
    lookCoin,
    crossChainRouter,
    supplyOracle,
    securityManager,
    feeManager,
    protocolRegistry,
    timelock,
    layerZeroModule,
    celerIMModule,
    hyperlaneModule,
    mockLayerZero,
    mockCeler,
    mockHyperlane,
    mockHyperlaneGasPaymaster,
    owner,
    admin,
    governance,
    minter,
    burner,
    pauser,
    upgrader,
    bridgeOperator,
    protocolAdmin,
    securityAdmin,
    feeCollector,
    user1,
    user2,
    attacker,
    user: user1, // Alias for user1
    oracleSigner1,
    oracleSigner2,
    oracleSigner3,
    operator,
    testChainId, // Hardhat default chain ID
    testDomain, // Hyperlane test domain
    testEid, // LayerZero test EID
    remoteAddress, // Remote address for testing
  };
}

/**
 * Minimal fixture for testing basic LookCoin functionality
 */
export async function deployLookCoinOnlyFixture() {
  const [owner, admin, user1, user2] = await ethers.getSigners();

  const MockLayerZero = await ethers.getContractFactory("MockLayerZeroEndpoint");
  const mockLayerZero = await MockLayerZero.deploy();
  await mockLayerZero.waitForDeployment();

  const LookCoin = await ethers.getContractFactory("LookCoin");
  const lookCoin = await upgrades.deployProxy(
    LookCoin,
    [admin.address, await mockLayerZero.getAddress()],
    { initializer: "initialize" }
  ) as unknown as LookCoin;

  return {
    lookCoin,
    mockLayerZero,
    owner,
    admin,
    user1,
    user2,
  };
}

/**
 * Bridge-specific fixture for testing cross-chain functionality
 */
export async function deployBridgeFixture() {
  const fixture = await deployLookCoinFixture();
  
  // Use test values from main fixture
  const { testChainId, testDomain, testEid, remoteAddress } = fixture;
  
  // Configure LayerZero OFT on LookCoin
  // LookCoin expects just the remote address (20 bytes)
  await fixture.lookCoin.connect(fixture.protocolAdmin).setTrustedRemote(
    testEid,
    remoteAddress
  );
  // Set gas for LayerZero receive - requires DEFAULT_ADMIN_ROLE (governance)
  await fixture.lookCoin.connect(fixture.governance).setGasForDestinationLzReceive(200000);
  
  // Configure LayerZero module
  await fixture.layerZeroModule.connect(fixture.admin).setTrustedRemote(testEid, remoteAddress);
  
  // Configure Celer IM module
  await fixture.celerIMModule.connect(fixture.admin).setSupportedChain(testChainId, true);
  await fixture.celerIMModule.connect(fixture.admin).setRemoteModule(testChainId, remoteAddress);
  // Note: CelerIMModule doesn't have fee collector functionality
  
  // Configure Hyperlane module
  await fixture.hyperlaneModule.connect(fixture.admin).setDomainMapping(testDomain, testChainId);
  await fixture.hyperlaneModule.connect(fixture.admin).setTrustedSender(testDomain, remoteAddress);
  await fixture.hyperlaneModule.connect(fixture.admin).setRequiredGasAmount(BigInt(200000));
  
  // Configure router chain support for all protocols
  await fixture.crossChainRouter.connect(fixture.admin).setChainProtocolSupport(testChainId, 0, true); // LayerZero
  await fixture.crossChainRouter.connect(fixture.admin).setChainProtocolSupport(testChainId, 1, true); // Celer
  await fixture.crossChainRouter.connect(fixture.admin).setChainProtocolSupport(testChainId, 2, true); // Hyperlane
  
  // Note: Supply oracle initialization happens during deployment
  
  return fixture;
}