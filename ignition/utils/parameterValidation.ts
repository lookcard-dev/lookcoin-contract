import { parseEther } from "viem";
import { AddressLike } from "hardhat/types";

export interface ValidationError {
  parameter: string;
  expected: string;
  actual: string;
}

// Address validation functions
export function validateAddress(address: string | undefined, paramName: string): string {
  if (!address) {
    throw createParameterError(paramName, "valid address", "undefined");
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw createParameterError(paramName, "valid address format", address);
  }

  return address;
}

export function validateNonZeroAddress(address: string | undefined, paramName: string): string {
  const validAddress = validateAddress(address, paramName);

  if (validAddress === "0x0000000000000000000000000000000000000000") {
    throw createParameterError(paramName, "non-zero address", "ZeroAddress");
  }

  return validAddress;
}

export function validateAddressArray(addresses: string[], paramName: string, minLength?: number): string[] {
  if (!Array.isArray(addresses)) {
    throw createParameterError(paramName, "array of addresses", typeof addresses);
  }

  if (minLength && addresses.length < minLength) {
    throw createParameterError(paramName, `at least ${minLength} addresses`, `${addresses.length} addresses`);
  }

  return addresses.map((addr, index) => validateAddress(addr, `${paramName}[${index}]`));
}

// BigInt validation functions
export function validateBigIntString(value: string | undefined, paramName: string): bigint {
  if (!value) {
    throw createParameterError(paramName, "numeric string", "undefined");
  }

  try {
    return BigInt(value);
  } catch (error) {
    throw createParameterError(paramName, "valid numeric string", value);
  }
}

export function validateParseEther(value: string | undefined, paramName: string): bigint {
  if (!value) {
    throw createParameterError(paramName, "numeric string for ether value", "undefined");
  }

  try {
    return parseEther(value);
  } catch (error) {
    throw createParameterError(paramName, "valid ether amount", value);
  }
}

export function validateBigIntRange(value: bigint, min: bigint, max: bigint, paramName: string): bigint {
  if (value < min || value > max) {
    throw createParameterError(paramName, `value between ${min} and ${max}`, value.toString());
  }

  return value;
}

// Array parameter parsing
export function parseCommaSeparatedAddresses(str: string | undefined, paramName: string): string[] {
  if (!str) {
    return [];
  }

  const addresses = str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return validateAddressArray(addresses, paramName);
}

export function parseJsonParameter<T>(str: string | undefined, paramName: string): T {
  if (!str) {
    throw createParameterError(paramName, "JSON string", "undefined");
  }

  try {
    return JSON.parse(str);
  } catch (error) {
    throw createParameterError(paramName, "valid JSON", str);
  }
}

export function validateArrayLength(array: any[], min: number, max: number, paramName: string): void {
  if (array.length < min || array.length > max) {
    throw createParameterError(paramName, `array length between ${min} and ${max}`, `length ${array.length}`);
  }
}

// Chain ID validation
export function validateChainId(chainId: number | undefined, paramName: string): number {
  if (chainId === undefined || chainId === null) {
    throw createParameterError(paramName, "valid chain ID", "undefined");
  }

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw createParameterError(paramName, "positive integer chain ID", chainId.toString());
  }

  return chainId;
}

export function validateSupportedChain(chainId: number, supportedChains: number[], paramName: string): number {
  validateChainId(chainId, paramName);

  if (!supportedChains.includes(chainId)) {
    throw createParameterError(paramName, `one of ${supportedChains.join(", ")}`, chainId.toString());
  }

  return chainId;
}

// Parameter schema validation
export interface HyperlaneParameters {
  lookCoin?: string;
  mailbox?: string;
  gasPaymaster?: string;
  domain?: number;
  trustedSenders?: string;
  gasConfig?: string;
  defaultGasLimit?: number;
  defaultIsmConfig?: string;
}

export function validateHyperlaneParameters(params: HyperlaneParameters): void {
  if (params.lookCoin) validateNonZeroAddress(params.lookCoin, "lookCoin");
  if (params.mailbox) validateNonZeroAddress(params.mailbox, "mailbox");

  if (params.gasPaymaster) validateAddress(params.gasPaymaster, "gasPaymaster");
  
  if (params.domain !== undefined) {
    if (params.domain < 0) {
      throw createParameterError("domain", "positive integer", params.domain.toString());
    }
  }

  if (params.trustedSenders) {
    try {
      JSON.parse(params.trustedSenders);
    } catch {
      throw createParameterError("trustedSenders", "valid JSON string", params.trustedSenders);
    }
  }
}

export interface DVNParameters {
  dvns?: string;
  requiredDVNs?: number;
  optionalDVNs?: number;
  dvnThreshold?: number;
}

export function validateDVNParameters(params: DVNParameters): void {
  const dvnArray = params.dvns ? parseCommaSeparatedAddresses(params.dvns, "dvns") : [];

  if (params.requiredDVNs !== undefined) {
    if (params.requiredDVNs > dvnArray.length) {
      throw createParameterError("requiredDVNs", `<= ${dvnArray.length}`, params.requiredDVNs.toString());
    }
  }

  if (params.optionalDVNs !== undefined) {
    if (params.optionalDVNs > dvnArray.length) {
      throw createParameterError("optionalDVNs", `<= ${dvnArray.length}`, params.optionalDVNs.toString());
    }
  }

  if (params.dvnThreshold !== undefined) {
    const totalDVNs = (params.requiredDVNs || 0) + (params.optionalDVNs || 0);
    if (params.dvnThreshold > totalDVNs) {
      throw createParameterError("dvnThreshold", `<= ${totalDVNs}`, params.dvnThreshold.toString());
    }
  }
}

export interface FeeParameters {
  minFee?: string;
  maxFee?: string;
  feePercentage?: number;
  feeBase?: string;
  feePerByte?: string;
}

export function validateFeeParameters(params: FeeParameters): void {
  let minFee: bigint | undefined;
  let maxFee: bigint | undefined;

  if (params.minFee) {
    minFee = validateParseEther(params.minFee, "minFee");
  }

  if (params.maxFee) {
    maxFee = validateParseEther(params.maxFee, "maxFee");
  }

  if (minFee !== undefined && maxFee !== undefined && minFee > maxFee) {
    throw createParameterError("minFee", `<= maxFee (${maxFee})`, minFee.toString());
  }

  if (params.feePercentage !== undefined) {
    if (params.feePercentage < 0 || params.feePercentage > 10000) {
      throw createParameterError("feePercentage", "0-10000 (basis points)", params.feePercentage.toString());
    }
  }

  if (params.feeBase) {
    validateParseEther(params.feeBase, "feeBase");
  }

  if (params.feePerByte) {
    validateParseEther(params.feePerByte, "feePerByte");
  }
}

// Error handling utilities
export function createParameterError(param: string, expected: string, actual: string): Error {
  return new Error(`Parameter '${param}' validation failed: expected ${expected}, got ${actual}`);
}

export function validateRequired<T>(value: T | undefined, paramName: string): T {
  if (value === undefined || value === null) {
    throw createParameterError(paramName, "non-null value", "undefined/null");
  }

  return value;
}

// Helper function to safely get parameters with defaults
export function getParam<T>(params: Record<string, any>, key: string, defaultValue: T): T {
  return params[key] !== undefined ? params[key] : defaultValue;
}

// Validation for remote modules (Celer)
export interface RemoteModulesMap {
  [chainId: string]: string;
}

export function validateRemoteModules(
  remoteModulesStr: string | undefined,
  paramName: string,
  currentChainId: number,
): RemoteModulesMap {
  if (!remoteModulesStr) {
    return {};
  }

  const remoteModules = parseJsonParameter<RemoteModulesMap>(remoteModulesStr, paramName);

  for (const [chainIdStr, address] of Object.entries(remoteModules)) {
    const chainId = parseInt(chainIdStr);

    if (isNaN(chainId)) {
      throw createParameterError(`${paramName}.${chainIdStr}`, "numeric chain ID", chainIdStr);
    }

    if (chainId === currentChainId) {
      throw createParameterError(`${paramName}.${chainIdStr}`, "different from current chain ID", chainIdStr);
    }

    validateNonZeroAddress(address, `${paramName}.${chainIdStr}`);
  }

  return remoteModules;
}

// Validation for bridge registrations (Oracle)
export interface BridgeRegistrationsMap {
  [chainId: string]: string;
}

export function validateBridgeRegistrations(
  registrationsStr: string | undefined,
  paramName: string,
): BridgeRegistrationsMap {
  if (!registrationsStr) {
    return {};
  }

  const registrations = parseJsonParameter<BridgeRegistrationsMap>(registrationsStr, paramName);

  for (const [chainIdStr, address] of Object.entries(registrations)) {
    const chainId = parseInt(chainIdStr);

    if (isNaN(chainId)) {
      throw createParameterError(`${paramName}.${chainIdStr}`, "numeric chain ID", chainIdStr);
    }

    validateNonZeroAddress(address, `${paramName}.${chainIdStr}`);
  }

  return registrations;
}
