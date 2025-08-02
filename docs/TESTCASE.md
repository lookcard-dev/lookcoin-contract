# LookCoin Contract Test Suite Documentation

This document provides a comprehensive overview of the LookCoin contract test suite, including test organization, coverage, and execution guidelines.

## Test Structure

The test suite is organized into two main categories:

### 1. Unit Tests (`/test/unit/`)

Unit tests focus on individual contract functionality in isolation.

#### LookCoin Core Tests (`/test/unit/lookcoin/`)

- **erc20Security.test.ts**: Comprehensive ERC20 security features including:
  - **Role-Based Access Control Tests**: MINTER_ROLE, BURNER_ROLE, PAUSER_ROLE, UPGRADER_ROLE, BRIDGE_ROLE validation
  - **Mint/Burn Security Tests**: Zero address/amount validation, supply tracking, authorization checks
  - **Pause Mechanism Tests**: All pausable functions (transfer, transferFrom, mint, burn, approve)
  - **Reentrancy Protection Tests**: Mock attacker contract testing for mint/burn operations
  - **Transfer and Approval Tests**: Standard ERC20 functionality with edge cases
  - **Supply Tracking Tests**: totalMinted, totalBurned, circulatingSupply validation
  - **Boolean Combination Testing**: Comprehensive state transition testing
  - **Edge Cases**: Maximum values, zero amounts, overflow protection

- **permit.test.ts**: EIP-2612 permit functionality:
  - **Domain Separator**: Correct EIP-712 domain configuration
  - **Permit Execution**: Valid signature processing and allowance setting
  - **Security Validations**: Expired deadlines, invalid signatures, nonce management
  - **Integration**: permit + transferFrom workflows

- **oft.test.ts**: LayerZero OFT V2 integration:
  - **OFT Configuration**: Trusted remote setup, gas configuration, DVN settings
  - **Cross-chain Transfer Validation**: Chain configuration checks, parameter validation
  - **Supply Tracking**: Mint/burn tracking across chains
  - **Bridge Convenience Functions**: estimateBridgeFee, bridgeToken helpers
  - **Access Control**: PROTOCOL_ADMIN_ROLE and DEFAULT_ADMIN_ROLE enforcement

#### Bridge Module Tests (`/test/unit/bridges/`)

**LayerZero (`/layerzero/`)**

- **configuration.test.ts**: Configuration management including endpoints, trusted remotes, gas limits, DVN settings
- **operations.test.ts**: Comprehensive bridge operations including:
  - **Outbound Transfer Tests**: sendFrom with various parameters, self-transfers, allowance validation
  - **Bridge Token Tests**: Direct LayerZero bridging vs CrossChainRouter integration
  - **Inbound Transfer Tests**: lzReceive validation, nonce tracking, packet type handling
  - **Fee Estimation Tests**: estimateSendFee, estimateBridgeFee with custom adapter params
  - **Configuration Integration**: Complete vs partial configuration validation
  - **Event Emission Tests**: SendToChain, CrossChainTransferInitiated, ReceiveFromChain events
  - **Boolean Combination Testing**: Authorized caller, trusted source, nonce processing combinations

**Celer (`/celer/`)**

- **configuration.test.ts**: MessageBus setup, remote modules, fee parameters, access control
- **operations.test.ts**: Token bridging, message handling, transfer ID tracking, fee management

**Hyperlane (`/hyperlane/`)**

- **configuration.test.ts**: Mailbox configuration, domain mapping, ISM settings, gas oracles
- **operations.test.ts**: Cross-chain transfers, message dispatching, fee estimation, domain validation

#### Router Tests (`/test/unit/router/`)

- **configuration.test.ts**: Protocol module registration, chain support, security levels
- **operations.test.ts**: Multi-protocol bridging, automatic route selection, transfer tracking, pause functionality

#### Fee Management (`/test/unit/feeManager/`)

- **feeManager.test.ts**: Protocol fees, chain multipliers, gas price management, fee collection/withdrawal

#### Protocol Registry (`/test/unit/protocolRegistry/`)

- **protocolRegistry.test.ts**: Protocol registration, chain support mapping, status management, emergency functions

#### Security Components (`/test/unit/security/`)

- **securityManager.test.ts**: Daily limits (global/chain/user), whitelist/blacklist, suspicious activity detection
- **supplyOracle.test.ts**: Multi-signature supply updates, deviation detection, chain management, reconciliation

### 2. Integration Tests (`/test/integration/`)

Integration tests verify end-to-end functionality and component interactions.

- **crossChainFlows.test.ts**: Complete bridge flows, multi-protocol failover, security integration, fee distribution
- **security.test.ts**: Access control across contracts, attack prevention, emergency response, governance security
- **consolidatedDeployment.test.ts**: Deployment script testing, artifact management, configuration validation

## Test Coverage Areas

### 1. Security Testing

- **Access Control**:
  - Role-based permissions (MINTER, BURNER, PAUSER, UPGRADER, BRIDGE, PROTOCOL_ADMIN)
  - Privilege escalation prevention with comprehensive role testing
  - Boolean combination testing for all role states
- **Reentrancy Protection**: Mock attacker contracts testing mint/burn operations
- **Supply Security**:
  - Multi-signature requirements for supply oracle updates
  - Deviation detection and anomaly response
  - Supply tracking validation (totalMinted, totalBurned, circulatingSupply)
- **Message Security**:
  - EIP-2612 permit signature validation and replay prevention
  - LayerZero trusted remote validation and nonce tracking
  - Cross-chain message authentication
- **Pause Mechanisms**: Comprehensive pausable function testing across all operations

### 2. Functional Testing

- **Token Operations**:
  - Standard ERC20 functionality (transfer, approve, transferFrom)
  - Minting and burning with proper authorization
  - Supply tracking and validation
- **Bridge Operations**:
  - LayerZero OFT sendFrom and lzReceive operations
  - Cross-chain transfers via all protocols (LayerZero, Celer, Hyperlane)
  - Fee estimation and payment validation
- **Configuration Management**:
  - Protocol setup and chain support configuration
  - Trusted remote and gas parameter management
  - DVN configuration for LayerZero
- **Event Emission**: Comprehensive event testing for all operations

### 3. Edge Cases and Boundary Testing

- **Zero Values**: Zero addresses, zero amounts with proper revert handling
- **Boundary Conditions**:
  - Maximum uint256 values and overflow protection
  - Insufficient balance and allowance scenarios
- **Configuration States**:
  - Partial vs complete configuration validation
  - Boolean combinations of configuration states
- **Timing and Nonces**:
  - Permit deadline enforcement
  - LayerZero nonce tracking and duplicate prevention

### 4. Boolean Combination Testing

- **Systematic State Testing**: All possible combinations of boolean states
- **Role Combinations**: Testing all role assignment/revocation scenarios
- **Configuration Combinations**: Testing all configuration state transitions
- **Pause State Combinations**: Testing pause/unpause across all functions

## Running Tests

### All Tests

```bash
npm test
```

### Unit Tests Only

```bash
npm run test:unit
```

### Specific Unit Test Categories

```bash
npm run test:unit:lookcoin    # Core LookCoin tests (ERC20Security, OFT, Permit)
npm run test:unit:bridges     # All bridge tests (LayerZero, Celer, Hyperlane)
npm run test:unit:router      # Router tests (Configuration, Operations)
npm run test:unit:security    # Security component tests (SecurityManager, SupplyOracle)
```

### Integration Tests

```bash
npm run test:integration                   # All integration tests
npm run test:integration:flows            # Cross-chain flow tests
npm run test:integration:security         # Security integration tests
npm run test:integration:deployment       # Deployment tests
```

### With Gas Reporting

```bash
npm run test:gas
```

### Coverage Reports

```bash
npm run coverage                # Full coverage
npm run coverage:unit          # Unit test coverage
npm run coverage:integration   # Integration test coverage
```

## Test Helpers

The test suite uses comprehensive helper utilities located in `/test/utils/comprehensiveTestHelpers.ts`:

### Core Fixtures and Deployment

- **deployLookCoinFixture**: Deploys complete test environment with all contracts and proper role assignments
- **DeploymentFixture Interface**: Standardized fixture structure with all contracts and signers
- **Mock Contracts**: MockLayerZeroEndpoint, MockMessageBus, MockHyperlaneMailbox with realistic behavior

### Configuration Helpers

- **configureLookCoinForTesting**: Sets up trusted remotes and gas configurations for OFT
- **configureLayerZeroModule**: Module-specific LayerZero configuration
- **configureCelerModule**: Celer MessageBus and fee configuration
- **configureHyperlaneModule**: Domain mapping and trusted sender setup
- **configureAllBridges**: One-command setup for all bridge protocols

### Testing Utilities

- **testBooleanCombinations**: Systematic testing of all boolean state combinations
- **testRoleBasedFunction**: Automated role-based access control testing
- **testPausableFunction**: Pause mechanism validation across functions
- **testConfigurationDependency**: Configuration requirement validation

### Assertion Helpers

- **assertBalanceChanges**: Validates token balance changes during operations
- **assertSupplyChanges**: Tracks totalMinted and totalBurned changes
- **assertEventEmission**: Event emission validation with parameter checking
- **expectSpecificRevert**: Custom error and revert message validation

### Coverage Tracking

- **CoverageTracker Class**: Tracks function, branch, and boolean combination coverage
- **coverageTracker**: Global instance for comprehensive test coverage reporting
- **Coverage Validation**: Ensures all expected test scenarios are covered

### State Management

- **pauseAllContracts/unpauseAllContracts**: System-wide pause state management
- **enableAllProtocols/disableAllProtocols**: Protocol status management
- **grantAllRoles/revokeAllRoles**: Bulk role management for testing

## Best Practices

1. **Isolation**: Each test uses `loadFixture(deployLookCoinFixture)` for complete isolation
2. **Completeness**:
   - Test both success and failure cases with `expectSpecificRevert`
   - Use boolean combination testing for comprehensive state coverage
   - Validate all event emissions and state changes
3. **Clarity**:
   - Descriptive test names explaining the specific scenario
   - Organized test suites by functionality (Role-Based Access Control, Mint/Burn Security, etc.)
4. **Performance**:
   - Strategic use of `beforeEach` for common setup
   - Efficient fixture loading with proper cleanup
5. **Assertions**:
   - Use specialized helpers (`assertBalanceChanges`, `assertSupplyChanges`)
   - Validate specific custom errors with parameters
   - Track coverage with `coverageTracker` for comprehensive reporting

## Adding New Tests

When adding new functionality:

1. **Unit Tests First**:
   - Create unit tests for new contract functions using the established patterns
   - Use `deployLookCoinFixture` for consistent test environment
   - Follow the boolean combination testing approach for state transitions

2. **Integration Tests**:
   - Add integration tests for cross-contract interactions
   - Use `configureAllBridges` helper for multi-protocol testing
   - Validate cross-contract state consistency

3. **Security Considerations**:
   - Include comprehensive access control testing with role-based helpers
   - Test all revert scenarios with `expectSpecificRevert`
   - Add reentrancy protection tests where applicable

4. **Coverage Tracking**:
   - Use `coverageTracker` to track function, branch, and boolean combination coverage
   - Ensure all expected scenarios are tested and documented

5. **Documentation**:
   - Update this file with new test descriptions and patterns
   - Document any new helper functions or testing utilities

## CI/CD Integration

The test suite is designed to run in CI/CD pipelines:

- All tests must pass before merging
- Coverage thresholds should be maintained (aim for >90%)
- Gas reports should be reviewed for optimization opportunities
- Security tests run on every commit

## Test Architecture Highlights

### Boolean Combination Testing

The test suite implements systematic boolean combination testing using the `testBooleanCombinations` helper:

- Tests all possible state transitions (false→true, true→false, false→false, true→true)
- Ensures comprehensive coverage of configuration states
- Validates role-based access control across all combinations

### Coverage Tracking System

- **CoverageTracker Class**: Tracks function calls, branch coverage, and boolean combinations
- **Automated Reporting**: Generates coverage reports showing tested scenarios
- **Validation**: Ensures all expected test combinations are covered

### Mock Integration

- **Realistic Mocks**: MockLayerZeroEndpoint, MockMessageBus, MockHyperlaneMailbox simulate real protocol behavior
- **Configurable Behavior**: Mocks support success/failure modes and custom parameters
- **Cross-Chain Simulation**: Helper functions simulate cross-chain message delivery

## Known Limitations

1. **Mock Limitations**: Bridge protocol mocks may not capture all edge cases of real protocols
2. **Time-Dependent Tests**: Time-sensitive tests use time manipulation helpers
3. **Upgrade Testing**: UUPS upgrade testing requires specific proxy setup patterns

## Future Enhancements

1. **Fuzzing Integration**: Add property-based testing for complex scenarios using foundry
2. **Performance Benchmarking**: Gas optimization tests with detailed reporting
3. **Chain-Specific Testing**: Network-specific tests for each supported blockchain
4. **Advanced Coverage**: Integration with solidity-coverage for line-by-line analysis
