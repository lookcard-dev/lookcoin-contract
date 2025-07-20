/**
 * Network Tier Validation Utilities
 *
 * This module provides comprehensive network tier validation and safety checks
 * to prevent accidental cross-tier configuration between mainnet and testnet.
 */

import { getNetworkTier } from "../../hardhat.config";
import { Deployment } from "./deployment";

// Types and Interfaces
export interface ValidationResult {
  success: boolean;
  message: string;
  details?: string[];
}

export interface CrossTierReport {
  hasIssues: boolean;
  currentTier: string;
  mismatches: Array<{
    chainId: number;
    network: string;
    tier: string;
    contractType: string;
  }>;
}

export interface TierValidationOptions {
  allowCrossTier?: boolean;
  skipConfirmation?: boolean;
  verbose?: boolean;
}

export interface OverrideFlags {
  forceCrossTier: boolean;
  environmentOverride: boolean;
  ciMode: boolean;
}

export interface EnvironmentOverrides {
  crossTierOk: boolean;
  isCI: boolean;
}

// Core validation functions
export function validateNetworkTierCompatibility(currentChainId: number, targetChainIds: number[]): ValidationResult {
  const currentTier = getNetworkTier(currentChainId);

  if (currentTier === "unknown") {
    return {
      success: false,
      message: `Unknown network tier for chain ${currentChainId}`,
      details: ["Ensure the network is properly configured in hardhat.config.ts"],
    };
  }

  const incompatibleChains: Array<{ chainId: number; tier: string }> = [];

  for (const targetChainId of targetChainIds) {
    const targetTier = getNetworkTier(targetChainId);

    if (targetTier === "unknown") {
      incompatibleChains.push({ chainId: targetChainId, tier: "unknown" });
      continue;
    }

    // Check compatibility
    if (currentTier !== targetTier) {
      // Special case: dev tier is compatible with testnet
      if (
        !((currentTier === "dev" && targetTier === "testnet") || (currentTier === "testnet" && targetTier === "dev"))
      ) {
        incompatibleChains.push({ chainId: targetChainId, tier: targetTier });
      }
    }
  }

  if (incompatibleChains.length > 0) {
    const details = incompatibleChains.map(
      (c) => `Chain ${c.chainId} (${c.tier} tier) is incompatible with current ${currentTier} tier`,
    );
    return {
      success: false,
      message: `Found ${incompatibleChains.length} incompatible network(s)`,
      details,
    };
  }

  return {
    success: true,
    message: "All networks are tier-compatible",
  };
}

export function detectCrossTierDeployments(
  currentChainId: number,
  deployments: { [chainId: string]: Deployment },
): CrossTierReport {
  const currentTier = getNetworkTier(currentChainId);
  const mismatches: CrossTierReport["mismatches"] = [];

  for (const [chainIdStr, deployment] of Object.entries(deployments)) {
    const chainId = parseInt(chainIdStr);
    const deploymentTier = getNetworkTier(chainId);

    // Skip if same tier or special dev/testnet compatibility
    if (
      deploymentTier === currentTier ||
      (currentTier === "dev" && deploymentTier === "testnet") ||
      (currentTier === "testnet" && deploymentTier === "dev")
    ) {
      continue;
    }

    // Check each contract type
    if (deployment.contracts.LookCoin) {
      mismatches.push({
        chainId,
        network: deployment.network,
        tier: deploymentTier,
        contractType: "LookCoin",
      });
    }

    if (deployment.contracts.CelerIMModule) {
      mismatches.push({
        chainId,
        network: deployment.network,
        tier: deploymentTier,
        contractType: "CelerIMModule",
      });
    }

    if (deployment.contracts.IBCModule) {
      mismatches.push({
        chainId,
        network: deployment.network,
        tier: deploymentTier,
        contractType: "IBCModule",
      });
    }
  }

  return {
    hasIssues: mismatches.length > 0,
    currentTier,
    mismatches,
  };
}

// Safety check functions
export function validateConfigurationSafety(
  currentChainId: number,
  otherDeployments: { [chainId: string]: Deployment },
  options: TierValidationOptions = {},
): void {
  const report = detectCrossTierDeployments(currentChainId, otherDeployments);

  if (report.hasIssues && !options.allowCrossTier) {
    const errorDetails = report.mismatches
      .map((m) => `  - ${m.network} (chain ${m.chainId}, ${m.tier} tier) - ${m.contractType}`)
      .join("\n");

    throw new Error(
      `Cross-tier configuration detected!\n\n` +
        `Current network is ${report.currentTier} tier, but found contracts from:\n${errorDetails}\n\n` +
        `This could create security vulnerabilities. To proceed anyway:\n` +
        `  - Use --force-cross-tier flag\n` +
        `  - Set CROSS_TIER_OK=1 environment variable\n\n` +
        `Only do this if you understand the risks!`,
    );
  }

  if (report.hasIssues && options.allowCrossTier && options.verbose) {
    console.warn("\n⚠️  Cross-tier configuration warnings:");
    report.mismatches.forEach((m) => {
      console.warn(`  - ${m.contractType} from ${m.network} (${m.tier} tier)`);
    });
  }
}

export function logTierInformation(chainId: number, deployments: { [chainId: string]: Deployment }): void {
  const currentTier = getNetworkTier(chainId);
  console.log(`\nNetwork Tier Information:`);
  console.log(`Current network: ${currentTier} tier (chain ${chainId})`);

  if (Object.keys(deployments).length > 0) {
    console.log("\nOther deployments:");
    for (const [otherChainId, deployment] of Object.entries(deployments)) {
      const tier = getNetworkTier(parseInt(otherChainId));
      const warning = tier !== currentTier ? " ⚠️" : " ✓";
      console.log(`  - ${deployment.network}: ${tier} tier${warning}`);
    }
  }
}

export function generateTierWarnings(
  crossTierConnections: Array<{ from: string; to: string; type: string }>,
): string[] {
  const warnings: string[] = [];

  warnings.push("⚠️  SECURITY WARNING: Cross-tier connections detected! ⚠️");
  warnings.push("");
  warnings.push("The following cross-tier trust relationships will be established:");

  crossTierConnections.forEach((conn) => {
    warnings.push(`  - ${conn.from} → ${conn.to} (${conn.type})`);
  });

  warnings.push("");
  warnings.push("Risks:");
  warnings.push("  - Testnet contracts could manipulate mainnet state");
  warnings.push("  - Supply oracle could be deceived by testnet transactions");
  warnings.push("  - Rate limits could be bypassed using testnet tokens");
  warnings.push("");
  warnings.push("Only proceed if this is intentional and you understand the risks!");

  return warnings;
}

// CLI and environment helpers
export function parseOverrideFlags(argv: string[]): OverrideFlags {
  return {
    forceCrossTier: argv.includes("--force-cross-tier"),
    environmentOverride: process.env.CROSS_TIER_OK === "1",
    ciMode: process.env.CI === "true",
  };
}

export function checkEnvironmentOverrides(): EnvironmentOverrides {
  return {
    crossTierOk: process.env.CROSS_TIER_OK === "1",
    isCI: process.env.CI === "true",
  };
}

export function shouldSkipConfirmation(): boolean {
  const env = checkEnvironmentOverrides();
  return env.isCI;
}

// Interactive confirmation helper
export async function requireUserConfirmation(message: string, skipInCI: boolean = true): Promise<boolean> {
  if (skipInCI && shouldSkipConfirmation()) {
    console.log("Skipping confirmation in CI environment");
    return true;
  }

  // Dynamic import to avoid issues in non-interactive environments
  const readlinePromises = await import("readline/promises");
  const { createInterface } = readlinePromises;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(message);
    const answer = await rl.question("\nDo you want to continue? (yes/no): ");
    return answer.toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

// Summary generation
export function generateValidationSummary(
  currentChainId: number,
  deployments: { [chainId: string]: Deployment },
  options: TierValidationOptions,
): Record<string, unknown> {
  const report = detectCrossTierDeployments(currentChainId, deployments);
  const overrides = parseOverrideFlags(process.argv);

  return {
    currentNetwork: {
      chainId: currentChainId,
      tier: getNetworkTier(currentChainId),
    },
    validation: {
      crossTierDetected: report.hasIssues,
      crossTierAllowed: options.allowCrossTier || false,
      overrideMethod: overrides.forceCrossTier
        ? "CLI flag"
        : overrides.environmentOverride
          ? "Environment variable"
          : "None",
    },
    deployments: Object.entries(deployments).map(([chainId, dep]) => ({
      chainId: parseInt(chainId),
      network: dep.network,
      tier: getNetworkTier(parseInt(chainId)),
    })),
    warnings: report.mismatches.length,
  };
}
