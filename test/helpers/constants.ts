import { ethers } from "hardhat";

// Contract-specific role constants - matching actual contract implementations
export const CONTRACT_ROLES = {
  // LookCoin roles
  LookCoin: {
    DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
    MINTER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")),
    BURNER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE")),
    PAUSER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE")),
    UPGRADER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("UPGRADER_ROLE")),
    BRIDGE_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ROLE")),
    PROTOCOL_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("PROTOCOL_ADMIN_ROLE")),
    ROUTER_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ROUTER_ADMIN_ROLE")),
  },
  
  // CelerIMModule roles (uses ADMIN_ROLE, not BRIDGE_ADMIN_ROLE)
  CelerIMModule: {
    DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
    ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")),
    OPERATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE")),
  },
  
  // LayerZeroModule roles
  LayerZeroModule: {
    DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
    BRIDGE_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ADMIN_ROLE")),
    OPERATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE")),
    RELAYER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("RELAYER_ROLE")),
  },
  
  // HyperlaneModule roles
  HyperlaneModule: {
    DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
    BRIDGE_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ADMIN_ROLE")),
    OPERATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE")),
    RELAYER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("RELAYER_ROLE")),
  },
  
  // CrossChainRouter roles
  CrossChainRouter: {
    DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
    PROTOCOL_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("PROTOCOL_ADMIN_ROLE")),
    ROUTER_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ROUTER_ADMIN_ROLE")),
  },
  
  // SupplyOracle roles
  SupplyOracle: {
    DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
    ORACLE_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE")),
    OPERATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE")),
    EMERGENCY_ROLE: ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE")),
    UPGRADER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("UPGRADER_ROLE")),
  },
  
  // SecurityManager roles
  SecurityManager: {
    DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
    SECURITY_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("SECURITY_ADMIN_ROLE")),
    EMERGENCY_ROLE: ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE")),
    OPERATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE")),
    UPGRADER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("UPGRADER_ROLE")),
  },
  
  // FeeManager roles
  FeeManager: {
    DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
    FEE_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("FEE_ADMIN_ROLE")),
  },
  
  // ProtocolRegistry roles
  ProtocolRegistry: {
    DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
    REGISTRY_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("REGISTRY_ADMIN_ROLE")),
  },
  
  // MinimalTimelock roles
  MinimalTimelock: {
    DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
    PROPOSER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("PROPOSER_ROLE")),
    EXECUTOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("EXECUTOR_ROLE")),
    CANCELLER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("CANCELLER_ROLE")),
  },
};

// Legacy unified roles (for backward compatibility - will be deprecated)
export const ROLES = {
  DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
  MINTER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")),
  BURNER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE")),
  PAUSER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE")),
  UPGRADER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("UPGRADER_ROLE")),
  BRIDGE_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ROLE")),
  PROTOCOL_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("PROTOCOL_ADMIN_ROLE")),
  ROUTER_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ROUTER_ADMIN_ROLE")),
  ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")),
  BRIDGE_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ADMIN_ROLE")),
  OPERATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE")),
  RELAYER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("RELAYER_ROLE")),
  ORACLE_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE")),
  EMERGENCY_ROLE: ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_ROLE")),
  SECURITY_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("SECURITY_ADMIN_ROLE")),
  FEE_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("FEE_ADMIN_ROLE")),
  REGISTRY_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("REGISTRY_ADMIN_ROLE")),
  PROPOSER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("PROPOSER_ROLE")),
  EXECUTOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("EXECUTOR_ROLE")),
  CANCELLER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("CANCELLER_ROLE")),
};

// Test addresses
export const TEST_ADDRESSES = {
  ZERO_ADDRESS: ethers.ZeroAddress,
  DEAD_ADDRESS: "0x000000000000000000000000000000000000dEaD",
  RANDOM_ADDRESS: "0x" + "1".repeat(40),
  REMOTE_ADDRESS: "0x" + "2".repeat(40),
  INVALID_ADDRESS: "0x123", // Invalid format
};

// Chain IDs for testing
export const TEST_CHAINS = {
  ETHEREUM_MAINNET: 1,
  BSC_MAINNET: 56,
  BSC_TESTNET: 97,
  POLYGON_MAINNET: 137,
  AVALANCHE_MAINNET: 43114,
  ARBITRUM_MAINNET: 42161,
  OPTIMISM_MAINNET: 10,
  BASE_MAINNET: 8453,
  BASE_SEPOLIA: 84532,
  OPTIMISM_SEPOLIA: 11155420,
  
  // Test chain IDs
  TEST_CHAIN_1: 31337,
  TEST_CHAIN_2: 31338,
  INVALID_CHAIN: 999999,
};

// LayerZero endpoint IDs (different from chain IDs)
export const LAYERZERO_CHAIN_IDS = {
  ETHEREUM: 101,
  BSC: 102,
  AVALANCHE: 106,
  POLYGON: 109,
  ARBITRUM: 110,
  OPTIMISM: 111,
  BASE: 184,
};

// Hyperlane domain IDs
export const HYPERLANE_DOMAINS = {
  ETHEREUM: 1,
  BSC: 56,
  POLYGON: 137,
  AVALANCHE: 43114,
  ARBITRUM: 42161,
  OPTIMISM: 10,
  BASE: 8453,
  
  // Test domains
  TEST_DOMAIN_1: 1000,
  TEST_DOMAIN_2: 2000,
};

// Protocol identifiers - matching ICrossChainRouter.Protocol enum
export const PROTOCOLS = {
  LAYERZERO: 0, // Protocol.LayerZero
  CELER: 1,     // Protocol.Celer (renamed from CELER_IM)
  HYPERLANE: 2, // Protocol.Hyperlane
  INVALID: 999,
};

// Amount constants
export const AMOUNTS = {
  ZERO: BigInt(0),
  ONE_TOKEN: ethers.parseEther("1"),
  TEN_TOKENS: ethers.parseEther("10"),
  HUNDRED_TOKENS: ethers.parseEther("100"),
  THOUSAND_TOKENS: ethers.parseEther("1000"),
  MILLION_TOKENS: ethers.parseEther("1000000"),
  MAX_SUPPLY: ethers.parseEther("1000000000"), // 1B tokens
  
  // Small amounts for precision testing
  ONE_WEI: BigInt(1),
  ONE_GWEI: ethers.parseUnits("1", "gwei"),
  
  // Fee amounts
  DEFAULT_FEE: ethers.parseEther("0.01"),
  HIGH_FEE: ethers.parseEther("0.1"),
  LOW_FEE: ethers.parseEther("0.001"),
};

// Time constants (in seconds)
export const TIME_CONSTANTS = {
  ONE_MINUTE: 60,
  FIVE_MINUTES: 300,
  FIFTEEN_MINUTES: 900,
  ONE_HOUR: 3600,
  ONE_DAY: 86400,
  ONE_WEEK: 604800,
  ONE_MONTH: 2592000,
  
  // Timelock delays
  MIN_DELAY: 2 * 86400, // 2 days
  STANDARD_DELAY: 7 * 86400, // 1 week
  CRITICAL_DELAY: 14 * 86400, // 2 weeks
};

// Gas constants
export const GAS_LIMITS = {
  STANDARD: 200000,
  HIGH: 500000,
  VERY_HIGH: 1000000,
  BRIDGE_OPERATION: 300000,
  COMPLEX_OPERATION: 800000,
};

// Security thresholds
export const SECURITY_THRESHOLDS = {
  DAILY_LIMIT: ethers.parseEther("20000000"), // 20M tokens
  DEVIATION_THRESHOLD: 100, // 1% in basis points
  RATE_LIMIT_WINDOW: 3600, // 1 hour
  MAX_BRIDGE_AMOUNT: ethers.parseEther("1000000"), // 1M tokens
  MIN_BRIDGE_AMOUNT: ethers.parseEther("1"), // 1 token
};

// Error messages - matching actual contract error messages
export const ERROR_MESSAGES = {
  // Access control errors
  UNAUTHORIZED: "AccessControlUnauthorizedAccount",
  MISSING_ROLE: "AccessControlMissingRole",
  
  // LookCoin specific errors
  UNAUTHORIZED_MINTER: "LookCoin: unauthorized minter",
  UNAUTHORIZED_BURNER: "LookCoin: unauthorized burner",
  MINT_TO_ZERO_ADDRESS: "LookCoin: mint to zero address",
  BURN_FROM_ZERO_ADDRESS: "LookCoin: burn from zero address",
  INVALID_AMOUNT: "LookCoin: invalid amount",
  INSUFFICIENT_BALANCE: "LookCoin: insufficient balance",
  INSUFFICIENT_ALLOWANCE: "LookCoin: insufficient allowance",
  INVALID_RECIPIENT: "LookCoin: invalid recipient",
  RECIPIENT_ZERO: "LookCoin: recipient is zero address",
  CHAIN_NOT_CONFIGURED: "LookCoin: destination chain not configured",
  LAYERZERO_NOT_CONFIGURED: "LookCoin: LayerZero not configured",
  GAS_NOT_SET: "LookCoin: gas for destination not set",
  INVALID_ENDPOINT: "LookCoin: invalid endpoint",
  INVALID_GAS_LIMIT: "LookCoin: invalid gas limit",
  
  // Pause errors
  ENFORCED_PAUSE: "EnforcedPause",
  EXPECTED_PAUSE: "ExpectedPause",
  
  // Bridge errors
  INVALID_PROTOCOL: "CrossChainRouter: invalid protocol",
  PROTOCOL_NOT_SUPPORTED: "CrossChainRouter: protocol not supported",
  BRIDGE_PAUSED: "CrossChainRouter: bridge is paused",
  INSUFFICIENT_FEE: "CrossChainRouter: insufficient fee",
  
  // Supply oracle errors
  SUPPLY_DEVIATION: "SupplyOracle: supply deviation detected",
  ORACLE_PAUSED: "SupplyOracle: oracle is paused",
  
  // Security errors
  DAILY_LIMIT_EXCEEDED: "SecurityManager: daily limit exceeded",
  RATE_LIMIT_EXCEEDED: "SecurityManager: rate limit exceeded",
  
  // Timelock errors
  OPERATION_NOT_READY: "MinimalTimelock: operation not ready",
  OPERATION_EXISTS: "MinimalTimelock: operation already scheduled",
  INSUFFICIENT_DELAY: "MinimalTimelock: insufficient delay",
};

// Event names
export const EVENTS = {
  // ERC20 events
  TRANSFER: "Transfer",
  APPROVAL: "Approval",
  
  // LookCoin events
  PEER_CONNECTED: "PeerConnected",
  EMERGENCY_PAUSE: "EmergencyPause",
  BRIDGE_TOKEN: "BridgeToken",
  
  // Role events
  ROLE_GRANTED: "RoleGranted",
  ROLE_REVOKED: "RoleRevoked",
  
  // Pause events
  PAUSED: "Paused",
  UNPAUSED: "Unpaused",
  
  // Bridge events
  TRANSFER_INITIATED: "TransferInitiated",
  TRANSFER_COMPLETED: "TransferCompleted",
  
  // Timelock events
  CALL_SCHEDULED: "CallScheduled",
  CALL_EXECUTED: "CallExecuted",
  CALL_CANCELLED: "CallCancelled",
};

// LayerZero packet types
export const PACKET_TYPES = {
  PT_SEND: 0,
  PT_SEND_AND_CALL: 1,
};

// Test configuration
export const TEST_CONFIG = {
  INITIAL_SUPPLY: ethers.parseEther("1000000"), // 1M tokens for testing
  FUZZING_ITERATIONS: 100,
  MAX_GAS_PRICE: ethers.parseUnits("100", "gwei"),
  
  // Mock configuration
  MOCK_SUCCESS_RATE: 95, // 95% success rate for mocks
  MOCK_DELAY_MS: 100, // 100ms delay for async operations
};

// Boolean combinations for comprehensive testing
export const BOOLEAN_COMBINATIONS = [
  { from: false, to: true, description: "false → true" },
  { from: true, to: false, description: "true → false" },
  { from: false, to: false, description: "false → false" },
  { from: true, to: true, description: "true → true" },
];

// Fee calculation constants
export const FEE_CONFIG = {
  BASE_FEE_RATE: 10, // 0.1% in basis points
  PREMIUM_FEE_RATE: 50, // 0.5% in basis points
  MAX_FEE_RATE: 100, // 1% in basis points
  FEE_DENOMINATOR: 10000, // Basis points denominator
};

// Security test patterns
export const SECURITY_PATTERNS = {
  REENTRANCY_DEPTH: 5,
  OVERFLOW_TEST_VALUE: ethers.MaxUint256,
  UNDERFLOW_TEST_VALUE: BigInt(0),
  MAX_ARRAY_LENGTH: 1000,
  MAX_STRING_LENGTH: 1000,
};