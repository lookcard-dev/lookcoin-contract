#!/usr/bin/env tsx
/**
 * Cross-Network Data Integrity Validation Script
 * 
 * This script validates that all contract addresses, cross-chain references, 
 * and protocol configurations are consistent and correct across all 6 networks
 * in the unified JSON migration.
 * 
 * @version 1.0.0
 * @author Data Validation Specialist
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ============================================================================
// CONFIGURATION & EXPECTED VALUES
// ============================================================================

interface NetworkConfig {
  name: string;
  chainId: number;
  tier: 'mainnet' | 'testnet';
  expectedProtocols: string[];
  deploymentMode: 'standard' | 'multi-protocol';
}

const EXPECTED_NETWORKS: NetworkConfig[] = [
  {
    name: 'bscmainnet',
    chainId: 56,
    tier: 'mainnet',
    expectedProtocols: ['layerZero', 'celer'],
    deploymentMode: 'multi-protocol'
  },
  {
    name: 'bsctestnet',
    chainId: 97,
    tier: 'testnet',
    expectedProtocols: ['layerZero', 'celer'],
    deploymentMode: 'multi-protocol'
  },
  {
    name: 'basesepolia',
    chainId: 84532,
    tier: 'testnet',
    expectedProtocols: ['layerZero'],
    deploymentMode: 'standard'
  },
  {
    name: 'optimismsepolia',
    chainId: 11155420,
    tier: 'testnet',
    expectedProtocols: ['layerZero'],
    deploymentMode: 'standard'
  },
  {
    name: 'sapphiremainnet',
    chainId: 23295, // Deployed on 23295 (matches CLAUDE.md)
    tier: 'mainnet',
    expectedProtocols: ['celer'],
    deploymentMode: 'standard'
  },
  {
    name: 'sapphiretestnet',
    chainId: 23295, // Deployed on 23295 (matches hardhat.config.ts sapphireTestnet)
    tier: 'testnet',
    expectedProtocols: ['celer'],
    deploymentMode: 'standard'
  }
];

const EXPECTED_SCHEMA_VERSION = '3.0.0';
const REQUIRED_CORE_CONTRACTS = ['LookCoin', 'SupplyOracle'];
const REQUIRED_EXTENDED_FIELDS = ['factoryByteCodeHash', 'deploymentArgs', 'deployedAt'];

// LayerZero Endpoints (from hardhat.config.ts)
const LAYERZERO_ENDPOINTS: Record<string, string> = {
  '56': '0x1a44076050125825900e736c501f859c50fE728c',    // BSC
  '97': '0x6EDCE65403992e310A62460808c4b910D972f10f',    // BSC Testnet
  '84532': '0x6EDCE65403992e310A62460808c4b910D972f10f',  // Base Sepolia
  '11155420': '0x6EDCE65403992e310A62460808c4b910D972f10f', // Optimism Sepolia
  '23295': '0x0000000000000000000000000000000000000000', // Sapphire (not supported)
  '23294': '0x0000000000000000000000000000000000000000', // Sapphire Testnet (not supported)
};

// Celer MessageBus Addresses (from hardhat.config.ts)
const CELER_MESSAGEBUS: Record<string, string> = {
  '56': '0x95714818fdd7a5454f73da9c777b3ee6ebaeea6b',    // BSC
  '97': '0xAd204986D6cB67A5Bc76a3CB8974823F43Cb9AAA',    // BSC Testnet
  '84532': '0x0000000000000000000000000000000000000000', // Base Sepolia (not supported)
  '11155420': '0x0000000000000000000000000000000000000000', // Optimism Sepolia (not supported)
  '23295': '0x9Bb46D5100d2Db4608112026951c9C965b233f4D', // Sapphire Mainnet and Testnet
};

// ============================================================================
// VALIDATION INTERFACES
// ============================================================================

interface ValidationResult {
  network: string;
  passed: boolean;
  criticalErrors: string[];
  warnings: string[];
  info: string[];
}

interface DeploymentFile {
  schemaVersion: string;
  fileVersion: number;
  network: string;
  chainId: number;
  networkTier: string;
  metadata: {
    deployer: string;
    deploymentMode: string;
    protocolsEnabled: string[];
    protocolsDeployed: string[];
    timestamp: string;
    lastUpdated: string;
  };
  contracts: {
    core: Record<string, any>;
    bridges?: Record<string, any>;
    xchain?: Record<string, any>;
    security?: Record<string, any>;
  };
  configuration?: {
    protocols?: {
      layerZero?: {
        endpoint: string;
        lzChainId: number;
      };
      celer?: {
        messageBus: string;
        celerChainId: number;
      };
    };
  };
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function validateContractAddress(address: string, contractName: string, network: string): string[] {
  const errors: string[] = [];
  
  if (!address) {
    errors.push(`Missing address for ${contractName} on ${network}`);
  } else if (!isValidEthereumAddress(address)) {
    errors.push(`Invalid address format for ${contractName} on ${network}: ${address}`);
  } else if (address === '0x0000000000000000000000000000000000000000') {
    errors.push(`Zero address detected for ${contractName} on ${network}`);
  }
  
  return errors;
}

function validateExtendedFields(contract: any, contractName: string, network: string): string[] {
  const warnings: string[] = [];
  
  REQUIRED_EXTENDED_FIELDS.forEach(field => {
    if (!contract[field]) {
      warnings.push(`Missing extended field '${field}' for ${contractName} on ${network}`);
    }
  });
  
  // Validate factoryByteCodeHash format if present
  if (contract.factoryByteCodeHash && !/^0x[a-fA-F0-9]{64}$/.test(contract.factoryByteCodeHash)) {
    warnings.push(`Invalid factoryByteCodeHash format for ${contractName} on ${network}`);
  }
  
  // Validate deployedAt timestamp if present
  if (contract.deployedAt && isNaN(Date.parse(contract.deployedAt))) {
    warnings.push(`Invalid deployedAt timestamp for ${contractName} on ${network}`);
  }
  
  return warnings;
}

function validateNetworkBasics(file: DeploymentFile, expectedConfig: NetworkConfig): ValidationResult {
  const result: ValidationResult = {
    network: expectedConfig.name,
    passed: true,
    criticalErrors: [],
    warnings: [],
    info: []
  };
  
  // Schema version validation
  if (file.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    result.criticalErrors.push(
      `Schema version mismatch: expected ${EXPECTED_SCHEMA_VERSION}, got ${file.schemaVersion}`
    );
  }
  
  // Network name validation
  if (file.network !== expectedConfig.name) {
    result.criticalErrors.push(
      `Network name mismatch: expected ${expectedConfig.name}, got ${file.network}`
    );
  }
  
  // Chain ID validation
  if (file.chainId !== expectedConfig.chainId) {
    result.criticalErrors.push(
      `Chain ID mismatch: expected ${expectedConfig.chainId}, got ${file.chainId}`
    );
  }
  
  // Network tier validation
  if (file.networkTier !== expectedConfig.tier) {
    result.criticalErrors.push(
      `Network tier mismatch: expected ${expectedConfig.tier}, got ${file.networkTier}`
    );
  }
  
  // Deployment mode validation
  if (file.metadata.deploymentMode !== expectedConfig.deploymentMode) {
    result.warnings.push(
      `Deployment mode unexpected: expected ${expectedConfig.deploymentMode}, got ${file.metadata.deploymentMode}`
    );
  }
  
  // Deployer address validation
  const deployerErrors = validateContractAddress(
    file.metadata.deployer, 
    'deployer', 
    expectedConfig.name
  );
  result.criticalErrors.push(...deployerErrors);
  
  return result;
}

function validateCoreContracts(file: DeploymentFile, network: string): ValidationResult {
  const result: ValidationResult = {
    network,
    passed: true,
    criticalErrors: [],
    warnings: [],
    info: []
  };
  
  if (!file.contracts?.core) {
    result.criticalErrors.push(`No core contracts section found`);
    return result;
  }
  
  // Validate required core contracts
  REQUIRED_CORE_CONTRACTS.forEach(contractName => {
    const contract = file.contracts.core[contractName];
    
    if (!contract) {
      result.criticalErrors.push(`Missing required contract: ${contractName}`);
      return;
    }
    
    // Validate contract address - check both direct address and proxy/implementation
    const contractAddress = contract.address || contract.proxy;
    if (!contractAddress) {
      result.criticalErrors.push(`Missing address for ${contractName} on ${network}`);
    } else {
      const addressErrors = validateContractAddress(contractAddress, contractName, network);
      result.criticalErrors.push(...addressErrors);
    }
    
    // Check for proxy/implementation pattern
    if (contract.proxy && contract.implementation) {
      const proxyErrors = validateContractAddress(contract.proxy, `${contractName} proxy`, network);
      const implErrors = validateContractAddress(contract.implementation, `${contractName} implementation`, network);
      result.criticalErrors.push(...proxyErrors, ...implErrors);
      
      result.info.push(`${contractName} uses proxy pattern: proxy=${contract.proxy}, impl=${contract.implementation}`);
    }
    
    // Validate extended fields
    const extendedWarnings = validateExtendedFields(contract, contractName, network);
    result.warnings.push(...extendedWarnings);
  });
  
  return result;
}

function validateProtocolConfigurations(file: DeploymentFile, expectedConfig: NetworkConfig): ValidationResult {
  const result: ValidationResult = {
    network: expectedConfig.name,
    passed: true,
    criticalErrors: [],
    warnings: [],
    info: []
  };
  
  const chainIdStr = expectedConfig.chainId.toString();
  
  // Validate LayerZero configuration
  const layerZeroConfig = file.configuration?.protocols?.layerZero;
  if (expectedConfig.expectedProtocols.includes('layerZero')) {
    if (!layerZeroConfig) {
      result.criticalErrors.push(`Missing LayerZero configuration`);
    } else {
      // Check endpoint address
      const expectedEndpoint = LAYERZERO_ENDPOINTS[chainIdStr];
      if (layerZeroConfig.endpoint !== expectedEndpoint) {
        result.criticalErrors.push(
          `LayerZero endpoint mismatch: expected ${expectedEndpoint}, got ${layerZeroConfig.endpoint}`
        );
      }
      
      result.info.push(`LayerZero configured: endpoint=${layerZeroConfig.endpoint}, lzChainId=${layerZeroConfig.lzChainId}`);
    }
  } else if (layerZeroConfig && layerZeroConfig.endpoint !== '0x0000000000000000000000000000000000000000') {
    result.warnings.push(`LayerZero configuration present but protocol not expected`);
  }
  
  // Validate Celer configuration
  const celerConfig = file.configuration?.protocols?.celer;
  if (expectedConfig.expectedProtocols.includes('celer')) {
    if (!celerConfig) {
      result.criticalErrors.push(`Missing Celer configuration`);
    } else {
      // Check message bus address
      const expectedMessageBus = CELER_MESSAGEBUS[chainIdStr];
      if (celerConfig.messageBus !== expectedMessageBus) {
        result.criticalErrors.push(
          `Celer MessageBus mismatch: expected ${expectedMessageBus}, got ${celerConfig.messageBus}`
        );
      }
      
      // Check chain ID consistency
      if (celerConfig.celerChainId !== expectedConfig.chainId) {
        result.criticalErrors.push(
          `Celer chain ID mismatch: expected ${expectedConfig.chainId}, got ${celerConfig.celerChainId}`
        );
      }
      
      result.info.push(`Celer configured: messageBus=${celerConfig.messageBus}, celerChainId=${celerConfig.celerChainId}`);
    }
  } else if (celerConfig && celerConfig.messageBus !== '0x0000000000000000000000000000000000000000') {
    result.warnings.push(`Celer configuration present but protocol not expected`);
  }
  
  return result;
}

function validateCrossChainReferences(files: DeploymentFile[]): ValidationResult {
  const result: ValidationResult = {
    network: 'cross-chain',
    passed: true,
    criticalErrors: [],
    warnings: [],
    info: []
  };
  
  // Check for consistent cross-chain configurations
  const layerZeroNetworks = files.filter(f => f.configuration?.protocols?.layerZero);
  const celerNetworks = files.filter(f => f.configuration?.protocols?.celer);
  
  result.info.push(`LayerZero enabled on ${layerZeroNetworks.length} networks: ${layerZeroNetworks.map(f => f.network).join(', ')}`);
  result.info.push(`Celer enabled on ${celerNetworks.length} networks: ${celerNetworks.map(f => f.network).join(', ')}`);
  
  // Validate protocol consistency within each network type
  layerZeroNetworks.forEach(network => {
    if (!network.metadata.protocolsEnabled.includes('layerZero')) {
      result.warnings.push(`${network.network}: LayerZero config present but not in protocolsEnabled`);
    }
  });
  
  celerNetworks.forEach(network => {
    if (!network.metadata.protocolsEnabled.includes('celer')) {
      result.warnings.push(`${network.network}: Celer config present but not in protocolsEnabled`);
    }
  });
  
  return result;
}

// ============================================================================
// MAIN VALIDATION LOGIC
// ============================================================================

function loadDeploymentFile(networkName: string): DeploymentFile | null {
  const filePath = join(process.cwd(), 'deployments', 'unified', `${networkName}.unified.json`);
  
  if (!existsSync(filePath)) {
    console.error(`❌ Deployment file not found: ${filePath}`);
    return null;
  }
  
  try {
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content) as DeploymentFile;
  } catch (error) {
    console.error(`❌ Failed to parse ${networkName}: ${error}`);
    return null;
  }
}

function validateNetwork(expectedConfig: NetworkConfig): ValidationResult {
  console.log(`\n🔍 Validating ${expectedConfig.name}...`);
  
  const file = loadDeploymentFile(expectedConfig.name);
  if (!file) {
    return {
      network: expectedConfig.name,
      passed: false,
      criticalErrors: [`Failed to load deployment file`],
      warnings: [],
      info: []
    };
  }
  
  // Combine all validation results
  const basicResult = validateNetworkBasics(file, expectedConfig);
  const coreResult = validateCoreContracts(file, expectedConfig.name);
  const protocolResult = validateProtocolConfigurations(file, expectedConfig);
  
  const combinedResult: ValidationResult = {
    network: expectedConfig.name,
    passed: basicResult.criticalErrors.length === 0 && 
            coreResult.criticalErrors.length === 0 && 
            protocolResult.criticalErrors.length === 0,
    criticalErrors: [
      ...basicResult.criticalErrors,
      ...coreResult.criticalErrors,
      ...protocolResult.criticalErrors
    ],
    warnings: [
      ...basicResult.warnings,
      ...coreResult.warnings,
      ...protocolResult.warnings
    ],
    info: [
      ...basicResult.info,
      ...coreResult.info,
      ...protocolResult.info
    ]
  };
  
  // Display results
  if (combinedResult.passed) {
    console.log(`  ✅ ${expectedConfig.name}: PASSED`);
  } else {
    console.log(`  ❌ ${expectedConfig.name}: FAILED`);
  }
  
  combinedResult.criticalErrors.forEach(error => {
    console.log(`    🔴 CRITICAL: ${error}`);
  });
  
  combinedResult.warnings.forEach(warning => {
    console.log(`    🟡 WARNING: ${warning}`);
  });
  
  combinedResult.info.forEach(info => {
    console.log(`    ℹ️  INFO: ${info}`);
  });
  
  return combinedResult;
}

function generateSummaryReport(results: ValidationResult[], crossChainResult: ValidationResult): void {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 CROSS-NETWORK DATA INTEGRITY VALIDATION REPORT`);
  console.log(`${'='.repeat(80)}`);
  
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  const totalCriticalErrors = results.reduce((sum, r) => sum + r.criticalErrors.length, 0) + crossChainResult.criticalErrors.length;
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0) + crossChainResult.warnings.length;
  
  console.log(`\n📈 SUMMARY STATISTICS:`);
  console.log(`  Networks Validated: ${totalCount}`);
  console.log(`  Networks Passed: ${passedCount} (${((passedCount / totalCount) * 100).toFixed(1)}%)`);
  console.log(`  Networks Failed: ${totalCount - passedCount}`);
  console.log(`  Total Critical Errors: ${totalCriticalErrors}`);
  console.log(`  Total Warnings: ${totalWarnings}`);
  
  console.log(`\n🎯 VALIDATION BY NETWORK:`);
  results.forEach(result => {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    const errorCount = result.criticalErrors.length;
    const warningCount = result.warnings.length;
    console.log(`  ${result.network.padEnd(20)} ${status} (${errorCount} errors, ${warningCount} warnings)`);
  });
  
  console.log(`\n🌐 CROSS-CHAIN VALIDATION:`);
  const crossStatus = crossChainResult.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`  Cross-chain integrity: ${crossStatus}`);
  crossChainResult.criticalErrors.forEach(error => {
    console.log(`    🔴 ${error}`);
  });
  crossChainResult.warnings.forEach(warning => {
    console.log(`    🟡 ${warning}`);
  });
  crossChainResult.info.forEach(info => {
    console.log(`    ℹ️  ${info}`);
  });
  
  console.log(`\n🔧 CRITICAL FIELDS VALIDATED PER NETWORK:`);
  console.log(`  ✓ Schema version consistency (${EXPECTED_SCHEMA_VERSION})`);
  console.log(`  ✓ Chain ID accuracy`);
  console.log(`  ✓ Network tier classification`);
  console.log(`  ✓ Contract address format validation`);
  console.log(`  ✓ Required contracts presence (${REQUIRED_CORE_CONTRACTS.join(', ')})`);
  console.log(`  ✓ Extended fields completeness (${REQUIRED_EXTENDED_FIELDS.join(', ')})`);
  console.log(`  ✓ LayerZero endpoint accuracy`);
  console.log(`  ✓ Celer MessageBus accuracy`);
  console.log(`  ✓ Protocol configuration consistency`);
  
  if (totalCriticalErrors > 0) {
    console.log(`\n🚨 RECOMMENDATIONS:`);
    console.log(`  1. Address all critical errors before proceeding with migration`);
    console.log(`  2. Review and fix contract address inconsistencies`);
    console.log(`  3. Verify cross-chain protocol configurations`);
    console.log(`  4. Ensure all required contracts are deployed`);
    console.log(`  5. Update schema versions to match expected format`);
  } else {
    console.log(`\n🎉 VALIDATION SUCCESSFUL!`);
    console.log(`  All networks have passed critical validation checks.`);
    if (totalWarnings > 0) {
      console.log(`  Consider addressing warnings to improve deployment quality.`);
    }
  }
  
  console.log(`\n📅 Validation completed at: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(80)}`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main(): Promise<void> {
  console.log(`🚀 Starting Cross-Network Data Integrity Validation...`);
  console.log(`📋 Networks to validate: ${EXPECTED_NETWORKS.length}`);
  console.log(`📝 Expected schema version: ${EXPECTED_SCHEMA_VERSION}`);
  console.log(`🔒 Required contracts: ${REQUIRED_CORE_CONTRACTS.join(', ')}`);
  
  // Validate each network
  const results: ValidationResult[] = [];
  const loadedFiles: DeploymentFile[] = [];
  
  for (const networkConfig of EXPECTED_NETWORKS) {
    const result = validateNetwork(networkConfig);
    results.push(result);
    
    // Collect loaded files for cross-chain validation
    const file = loadDeploymentFile(networkConfig.name);
    if (file) {
      loadedFiles.push(file);
    }
  }
  
  // Validate cross-chain references
  console.log(`\n🔗 Validating cross-chain references...`);
  const crossChainResult = validateCrossChainReferences(loadedFiles);
  
  // Generate final report
  generateSummaryReport(results, crossChainResult);
  
  // Exit with appropriate code
  const hasErrors = results.some(r => !r.passed) || !crossChainResult.passed;
  if (hasErrors) {
    console.log(`\n❌ Validation failed with errors. Exiting with code 1.`);
    process.exit(1);
  } else {
    console.log(`\n✅ All validations passed successfully. Exiting with code 0.`);
    process.exit(0);
  }
}

// Execute if called directly
if (require.main === module) {
  main().catch(error => {
    console.error(`💥 Validation script failed:`, error);
    process.exit(2);
  });
}

export {
  validateNetwork,
  validateCrossChainReferences,
  ValidationResult,
  DeploymentFile,
  EXPECTED_NETWORKS
};