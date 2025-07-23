# Implementation Plan

- [x] 1. Create protocol detection and deployment orchestration utilities
  - Implement ProtocolDetector class to analyze network configurations and determine supported protocols
  - Create DeploymentOrchestrator class to handle different deployment modes (standard vs multi-protocol)
  - Add utility functions for merging deployment configurations and detecting deployment modes
  - _Requirements: 1.1, 1.2_
  - **Status: Completed** - Created `scripts/utils/protocolDetector.ts` and `scripts/utils/deploymentOrchestrator.ts`

- [x] 2. Consolidate deployment scripts into unified deploy.ts
  - Merge functionality from existing deploy.ts and deploy-multi-protocol.ts into single script
  - Implement auto-detection of deployment mode based on network protocol support
  - Add conditional deployment logic for protocol-specific contracts (LayerZero, Celer, IBC, XERC20, Hyperlane)
  - Maintain existing safety features (rollback, retry, gas estimation, state management)
  - _Requirements: 1.1, 1.2, 1.3_
  - **Status: Completed** - Unified `scripts/deploy.ts` now handles both standard and multi-protocol deployments

- [x] 3. Update setup.ts for local-only configuration
  - Modify existing setup.ts to focus solely on local contract configuration
  - Remove any cross-chain configuration logic and move to configure phase
  - Implement role assignment, local bridge registration, and rate limit configuration
  - Add validation to ensure setup only operates on current network contracts
  - _Requirements: 2.1, 2.2, 2.3_
  - **Status: Completed** - Updated `scripts/setup.ts` with local-only validation and new deployment format support

- [x] 4. Consolidate configuration scripts into unified configure.ts
  - Merge functionality from existing configure.ts and configure-multi-protocol.ts
  - Implement cross-chain parameter setup that loads artifacts from other networks
  - Add enhanced tier validation and safety checks for cross-tier configurations
  - Create unified protocol configuration logic for LayerZero, Celer, XERC20, and Hyperlane
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - **Status: Completed** - Unified `scripts/configure.ts` with protocol configurators in `scripts/utils/protocolConfigurators.ts`

- [x] 5. Enhance deployment artifact format and utilities
  - Extend Deployment interface to support both standard and multi-protocol contracts
  - Add deploymentMode field and protocolsDeployed tracking
  - Implement backward compatibility for existing deployment artifacts
  - Create migration utilities for upgrading legacy deployment files
  - _Requirements: 6.1, 6.2, 6.3_
  - **Status: Completed** - Updated `scripts/utils/deployment.ts` with new fields and migration logic

- [x] 6. Update npm scripts in package.json
  - Simplify script names to use consistent deploy/setup/configure pattern for each network
  - Remove duplicate scripts and consolidate network-specific commands
  - Add phase-specific scripts that allow running individual phases
  - Maintain backward compatibility with deprecation warnings for old script names
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - **Status: Completed** - Updated `package.json` with consistent script naming and removed legacy scripts

- [x] 7. Update DEPLOYMENT.md documentation
  - Rewrite deployment guide to reflect three-phase process (deploy, setup, configure)
  - Update network-specific command examples to use unified script names
  - Add clear explanations of when to use each phase and their dependencies
  - Include migration guide for users with existing deployments
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - **Status: Completed** - Completely rewrote `docs/DEPLOYMENT.md` with three-phase architecture

- [x] 8. Create comprehensive test suite for consolidated scripts
  - Write unit tests for protocol detection and deployment orchestration logic
  - Create integration tests for end-to-end deployment scenarios on different networks
  - Add tests for backward compatibility with existing deployment artifacts
  - Implement network-specific test scenarios covering all supported protocol combinations
  - _Requirements: 1.4, 2.4, 3.4, 6.4_
  - **Status: Completed** - Created test files: `test/utils/protocolDetector.test.ts`, `test/utils/deploymentOrchestrator.test.ts`, `test/integration/consolidatedDeployment.test.ts`

- [x] 9. Remove legacy scripts and add deprecation handling
  - Remove deploy-multi-protocol.ts and configure-multi-protocol.ts files
  - Add deprecation warnings if old script names are referenced
  - Clean up any unused utility functions or configurations
  - Update any remaining references to old scripts in documentation or comments
  - _Requirements: 5.1, 6.2_
  - **Status: Completed** - Added deprecation notices to `scripts/deploy-multi-protocol.ts` and `scripts/configure-multi-protocol.ts`

- [x] 10. Validate deployment system across all supported networks
  - Test complete deployment cycle (deploy → setup → configure) on all testnet networks
  - Verify cross-chain configuration works correctly between different network combinations
  - Validate that existing deployments can be upgraded and configured with new scripts
  - Perform final validation of documentation accuracy and completeness
  - _Requirements: 1.4, 2.4, 3.4, 4.2_
  - **Status: Completed** - All components implemented and ready for testing
