/**
 * Enhanced Deployment Schema Validation
 * 
 * Comprehensive validation utilities for the enhanced deployment schema v2.0.0
 * with full infrastructure contract support and backward compatibility.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'fs';
import { join } from 'path';
import { 
  EnhancedDeployment, 
  DeploymentMode, 
  Protocol, 
  NetworkTier,
  ContractName,
  MigrationResult,
  isEnhancedDeployment,
  isProxyContract,
  isBigIntSerialized,
  SerializableValue
} from '../types/enhanced-deployment';

// ============================================================================
// JSON Schema Validation
// ============================================================================

let ajvInstance: Ajv | null = null;
let schemaValidator: any = null;

export function getAjvInstance(): Ajv {
  if (!ajvInstance) {
    ajvInstance = new Ajv({ 
      allErrors: true,
      strict: false,
      validateFormats: true
    });
    addFormats(ajvInstance);
    
    // Load and compile the JSON schema
    try {
      const schemaPath = join(__dirname, '../schemas/enhanced-deployment-schema.json');
      const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
      schemaValidator = ajvInstance.compile(schema);
    } catch (error) {
      console.error('Failed to load enhanced deployment schema:', error);
      throw new Error('Enhanced deployment schema validation unavailable');
    }
  }
  return ajvInstance;
}

export function validateDeploymentSchema(data: any): ValidationResult {
  if (!schemaValidator) {
    getAjvInstance(); // Initialize if not already done
  }

  const isValid = schemaValidator(data);
  
  return {
    isValid,
    errors: schemaValidator.errors || [],
    warnings: []
  };
}

export interface ValidationResult {
  isValid: boolean;
  errors: any[];
  warnings: string[];
}

// ============================================================================
// Business Logic Validation
// ============================================================================

export function validateDeploymentLogic(deployment: EnhancedDeployment): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate deployment mode consistency
  const deploymentModeValidation = validateDeploymentMode(deployment);
  errors.push(...deploymentModeValidation.errors);
  warnings.push(...deploymentModeValidation.warnings);

  // Validate protocol configurations
  const protocolValidation = validateProtocolConfigurations(deployment);
  errors.push(...protocolValidation.errors);
  warnings.push(...protocolValidation.warnings);

  // Validate network tier compatibility
  const networkValidation = validateNetworkCompatibility(deployment);
  errors.push(...networkValidation.errors);
  warnings.push(...networkValidation.warnings);

  // Validate contract addresses
  const addressValidation = validateContractAddresses(deployment);
  errors.push(...addressValidation.errors);
  warnings.push(...addressValidation.warnings);

  // Validate infrastructure requirements
  const infrastructureValidation = validateInfrastructureRequirements(deployment);
  errors.push(...infrastructureValidation.errors);
  warnings.push(...infrastructureValidation.warnings);

  return {
    isValid: errors.length === 0,
    errors: errors.map(e => ({ message: e })),
    warnings
  };
}

function validateDeploymentMode(deployment: EnhancedDeployment): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { deploymentMode, protocolsEnabled } = deployment.metadata;
  const { protocol, infrastructure } = deployment.contracts;

  switch (deploymentMode) {
    case 'multi-protocol':
      // Multi-protocol mode should have multiple protocols or infrastructure contracts
      const protocolCount = protocolsEnabled?.length || 0;
      const hasInfrastructure = infrastructure && Object.keys(infrastructure).length > 0;
      
      if (protocolCount <= 1 && !hasInfrastructure) {
        warnings.push(`Multi-protocol deployment mode but only ${protocolCount} protocol(s) enabled and no infrastructure`);
      }

      // BSC networks should have infrastructure in multi-protocol mode
      if (isBSCNetwork(deployment.chainId) && !hasInfrastructure) {
        errors.push('Multi-protocol mode on BSC network requires infrastructure contracts');
      }
      break;

    case 'standard':
      // Standard mode should have one protocol, no infrastructure
      if (infrastructure && Object.keys(infrastructure).length > 0) {
        warnings.push('Standard deployment mode should not include infrastructure contracts');
      }
      break;

    case 'simple':
      // Simple mode for development, minimal validation
      if (protocolsEnabled && protocolsEnabled.length > 1) {
        warnings.push('Simple deployment mode with multiple protocols may be unstable');
      }
      break;
  }

  return { errors, warnings };
}

function validateProtocolConfigurations(deployment: EnhancedDeployment): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { protocolsEnabled } = deployment.metadata;
  const { configuration } = deployment;

  if (!protocolsEnabled || protocolsEnabled.length === 0) {
    warnings.push('No protocols enabled in deployment');
    return { errors, warnings };
  }

  // Validate each enabled protocol has proper configuration
  for (const protocol of protocolsEnabled) {
    switch (protocol) {
      case 'layerZero':
        if (!configuration?.protocols?.layerZero?.endpoint) {
          errors.push('LayerZero protocol enabled but no endpoint configured');
        }
        if (!deployment.contracts.protocol?.LayerZeroModule) {
          errors.push('LayerZero protocol enabled but LayerZeroModule not deployed');
        }
        break;

      case 'celer':
        if (!configuration?.protocols?.celer?.messageBus) {
          errors.push('Celer protocol enabled but no MessageBus configured');
        }
        if (!deployment.contracts.protocol?.CelerIMModule) {
          errors.push('Celer protocol enabled but CelerIMModule not deployed');
        }
        break;

      case 'hyperlane':
        if (!configuration?.protocols?.hyperlane?.mailbox) {
          errors.push('Hyperlane protocol enabled but no Mailbox configured');
        }
        if (!deployment.contracts.protocol?.HyperlaneModule) {
          errors.push('Hyperlane protocol enabled but HyperlaneModule not deployed');
        }
        break;
    }
  }

  return { errors, warnings };
}

function validateNetworkCompatibility(deployment: EnhancedDeployment): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { chainId, networkTier } = deployment.metadata;
  const expectedTier = getExpectedNetworkTier(chainId);

  if (networkTier && networkTier !== expectedTier) {
    warnings.push(`Network tier mismatch: specified '${networkTier}' but chain ${chainId} is '${expectedTier}'`);
  }

  // Validate cross-chain connections are compatible
  const { connectedChains } = deployment.topology || {};
  if (connectedChains) {
    for (const connection of connectedChains) {
      const connectionTier = getExpectedNetworkTier(connection.chainId);
      if (expectedTier !== connectionTier && !isCompatibleNetworkTier(expectedTier, connectionTier)) {
        errors.push(`Incompatible network connection: ${chainId} (${expectedTier}) -> ${connection.chainId} (${connectionTier})`);
      }
    }
  }

  return { errors, warnings };
}

function validateContractAddresses(deployment: EnhancedDeployment): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const addressPattern = /^0x[a-fA-F0-9]{40}$/;
  const addresses = new Set<string>();

  // Helper to validate and track addresses
  const validateAddress = (address: string | undefined, context: string) => {
    if (!address) return;
    
    if (!addressPattern.test(address)) {
      errors.push(`Invalid address format in ${context}: ${address}`);
    } else if (addresses.has(address.toLowerCase())) {
      warnings.push(`Duplicate address detected in ${context}: ${address}`);
    } else {
      addresses.add(address.toLowerCase());
    }
  };

  // Validate core contracts
  const { core, protocol, infrastructure } = deployment.contracts;
  
  validateAddress(core.LookCoin.proxy, 'core.LookCoin.proxy');
  validateAddress(core.LookCoin.implementation, 'core.LookCoin.implementation');
  validateAddress(core.SupplyOracle.proxy, 'core.SupplyOracle.proxy');
  validateAddress(core.SupplyOracle.implementation, 'core.SupplyOracle.implementation');

  // Validate protocol contracts
  if (protocol) {
    Object.entries(protocol).forEach(([name, contract]) => {
      if (contract) {
        if (isProxyContract(contract)) {
          validateAddress(contract.proxy, `protocol.${name}.proxy`);
          validateAddress(contract.implementation, `protocol.${name}.implementation`);
        } else {
          validateAddress(contract.address, `protocol.${name}.address`);
        }
      }
    });
  }

  // Validate infrastructure contracts
  if (infrastructure) {
    Object.entries(infrastructure).forEach(([name, contract]) => {
      if (contract) {
        validateAddress(contract.proxy, `infrastructure.${name}.proxy`);
        validateAddress(contract.implementation, `infrastructure.${name}.implementation`);
      }
    });
  }

  return { errors, warnings };
}

function validateInfrastructureRequirements(deployment: EnhancedDeployment): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { deploymentMode } = deployment.metadata;
  const { infrastructure } = deployment.contracts;
  
  // Infrastructure contracts are required for BSC multi-protocol deployments
  if (isBSCNetwork(deployment.chainId) && deploymentMode === 'multi-protocol') {
    const requiredInfrastructure = ['CrossChainRouter', 'FeeManager', 'SecurityManager', 'ProtocolRegistry'];
    
    if (!infrastructure) {
      errors.push('BSC multi-protocol deployment requires infrastructure contracts');
      return { errors, warnings };
    }

    for (const contractName of requiredInfrastructure) {
      if (!infrastructure[contractName as keyof typeof infrastructure]) {
        errors.push(`Missing required infrastructure contract: ${contractName}`);
      }
    }
  }

  // Infrastructure contracts should not exist on non-BSC networks in standard mode
  if (!isBSCNetwork(deployment.chainId) && infrastructure && Object.keys(infrastructure).length > 0) {
    warnings.push('Infrastructure contracts deployed on non-BSC network (may be unused)');
  }

  return { errors, warnings };
}

// ============================================================================
// Network and Chain Utilities
// ============================================================================

function isBSCNetwork(chainId: number): boolean {
  return chainId === 56 || chainId === 97; // BSC Mainnet or Testnet
}

function getExpectedNetworkTier(chainId: number): NetworkTier {
  const mainnetChains = [1, 56, 8453, 10, 137, 43114, 23295]; // Major mainnets
  const testnetChains = [97, 84532, 11155420, 80001, 43113, 23294]; // Common testnets
  
  if (mainnetChains.includes(chainId)) return 'mainnet';
  if (testnetChains.includes(chainId)) return 'testnet';
  return 'dev';
}

function isCompatibleNetworkTier(tier1: NetworkTier, tier2: NetworkTier): boolean {
  // Same tier networks are compatible
  if (tier1 === tier2) return true;
  
  // Dev tier is compatible with testnets for development
  if ((tier1 === 'dev' && tier2 === 'testnet') || (tier1 === 'testnet' && tier2 === 'dev')) {
    return true;
  }
  
  // All other cross-tier combinations are incompatible
  return false;
}

// ============================================================================
// BigInt Serialization Validation
// ============================================================================

export function validateSerializableValues(values: SerializableValue[]): ValidationResult {
  const errors: string[] = [];
  
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    
    if (isBigIntSerialized(value)) {
      // Validate BigInt serialization format
      if (typeof value.value !== 'string') {
        errors.push(`BigInt value at index ${i} must be a string`);
      } else if (!/^[0-9]+$/.test(value.value)) {
        errors.push(`BigInt value at index ${i} contains invalid characters: ${value.value}`);
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors.map(e => ({ message: e })),
    warnings: []
  };
}

export function serializeBigInt(value: bigint): SerializableValue {
  return {
    type: 'BigInt',
    value: value.toString()
  };
}

export function deserializeBigInt(serialized: SerializableValue): bigint | SerializableValue {
  if (isBigIntSerialized(serialized)) {
    try {
      return BigInt(serialized.value);
    } catch (error) {
      throw new Error(`Failed to deserialize BigInt: ${serialized.value}`);
    }
  }
  return serialized;
}

// ============================================================================
// Comprehensive Validation Function
// ============================================================================

export function validateEnhancedDeployment(data: any): ValidationResult {
  // First, validate JSON schema
  const schemaResult = validateDeploymentSchema(data);
  if (!schemaResult.isValid) {
    return {
      isValid: false,
      errors: schemaResult.errors,
      warnings: [...schemaResult.warnings, 'Business logic validation skipped due to schema errors']
    };
  }

  // Then validate business logic
  if (!isEnhancedDeployment(data)) {
    return {
      isValid: false,
      errors: [{ message: 'Data does not match enhanced deployment interface' }],
      warnings: []
    };
  }

  const logicResult = validateDeploymentLogic(data);
  
  return {
    isValid: logicResult.isValid,
    errors: [...schemaResult.errors, ...logicResult.errors],
    warnings: [...schemaResult.warnings, ...logicResult.warnings]
  };
}

// ============================================================================
// Validation Report Generation
// ============================================================================

export interface ValidationReport {
  deployment: {
    network: string;
    chainId: number;
    schemaVersion: string;
    deploymentMode: DeploymentMode;
  };
  validation: {
    passed: boolean;
    errorCount: number;
    warningCount: number;
    timestamp: string;
  };
  details: {
    errors: Array<{ category: string; message: string; severity: 'error' | 'warning' }>;
    summary: string;
  };
}

export function generateValidationReport(deployment: EnhancedDeployment, result: ValidationResult): ValidationReport {
  const errors = result.errors.map(e => ({
    category: 'validation',
    message: typeof e === 'string' ? e : e.message || 'Unknown error',
    severity: 'error' as const
  }));

  const warnings = result.warnings.map(w => ({
    category: 'validation',
    message: w,
    severity: 'warning' as const
  }));

  const allIssues = [...errors, ...warnings];

  return {
    deployment: {
      network: deployment.network,
      chainId: deployment.chainId,
      schemaVersion: deployment.schemaVersion,
      deploymentMode: deployment.metadata.deploymentMode
    },
    validation: {
      passed: result.isValid,
      errorCount: errors.length,
      warningCount: warnings.length,
      timestamp: new Date().toISOString()
    },
    details: {
      errors: allIssues,
      summary: result.isValid 
        ? 'Deployment configuration is valid'
        : `Validation failed with ${errors.length} error(s) and ${warnings.length} warning(s)`
    }
  };
}

// ============================================================================
// Export All Validation Functions
// ============================================================================

export {
  validateDeploymentSchema,
  validateDeploymentLogic,
  validateEnhancedDeployment,
  generateValidationReport,
  getAjvInstance
};