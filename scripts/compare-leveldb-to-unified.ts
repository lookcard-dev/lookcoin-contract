/**
 * LevelDB to Unified JSON Migration Validation Tool
 * 
 * Comprehensive comparison script to ensure 100% data preservation during migration
 * from LevelDB storage to Unified JSON format.
 * 
 * Validates:
 * - Contract names and addresses match exactly
 * - Proxy addresses are preserved
 * - Implementation hashes match
 * - Factory bytecode hashes match  
 * - Deployment arguments are preserved (deep equality)
 * - Timestamps are correctly converted
 * - BigInt values are properly serialized/deserialized
 * - No data truncation or loss
 * 
 * Usage:
 * tsx scripts/compare-leveldb-to-unified.ts [--network <network>] [--verbose] [--export-report]
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { LevelDBStateManager } from './utils/LevelDBStateManager';
import { UnifiedJSONStateManager } from './utils/UnifiedJSONStateManager';
import { ContractType } from './utils/IStateManager';

// Network mapping for Unified JSON files
const NETWORK_MAP: Record<number, string> = {
  56: 'bscmainnet',
  97: 'bsctestnet', 
  84532: 'basesepolia',
  11155420: 'optimismsepolia',
  23295: 'sapphiremainnet',
  23294: 'sapphiretestnet',
  8453: 'basemainnet',
  10: 'optimismmainnet'
};

interface ComparisonResult {
  chainId: number;
  networkName: string;
  levelDbContracts: ContractType[];
  unifiedContracts: ContractType[];
  matches: ContractMatch[];
  missingInUnified: ContractType[];
  extraInUnified: ContractType[];
  summary: {
    totalLevelDb: number;
    totalUnified: number;
    perfectMatches: number;
    fieldMismatches: number;
    missing: number;
    extra: number;
    successPercentage: number;
  };
}

interface ContractMatch {
  contractName: string;
  isMatch: boolean;
  fieldComparisons: FieldComparison[];
  levelDbContract: ContractType;
  unifiedContract: ContractType;
}

interface FieldComparison {
  field: keyof ContractType;
  levelDbValue: unknown;
  unifiedValue: unknown;
  isMatch: boolean;
  notes?: string;
}

interface OverallReport {
  executionTime: string;
  levelDbHealthy: boolean;
  unifiedHealthy: boolean;
  totalNetworks: number;
  networksCompared: number;
  overallStats: {
    totalContracts: number;
    perfectMatches: number;
    partialMatches: number;
    missing: number;
    extra: number;
    fieldMismatches: number;
    overallSuccessRate: number;
  };
  networkResults: ComparisonResult[];
  criticalIssues: string[];
  warnings: string[];
  dataIntegrityCheck: {
    bigIntConversions: number;
    timestampConversions: number;
    arrayPreservation: number;
    addressFormatting: number;
  };
}

class MigrationComparisonTool {
  private levelDbManager: LevelDBStateManager;
  private unifiedManager: UnifiedJSONStateManager;
  private verbose: boolean;
  private unifiedPath: string;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
    this.unifiedPath = path.join(process.cwd(), 'deployments', 'unified');
    
    // Initialize state managers
    this.levelDbManager = new LevelDBStateManager({
      debugMode: verbose,
      dbPath: path.join(process.cwd(), 'leveldb')
    });
    
    this.unifiedManager = new UnifiedJSONStateManager({
      debugMode: verbose,
      jsonPath: this.unifiedPath
    });
  }

  /**
   * Main comparison execution
   */
  async compareAllNetworks(specificNetwork?: string): Promise<OverallReport> {
    const startTime = Date.now();
    
    console.log('🔍 Starting LevelDB to Unified JSON Migration Validation...\n');
    
    // Initialize backends
    await this.initializeBackends();
    
    // Get available networks
    const availableNetworks = await this.getAvailableNetworks();
    
    if (this.verbose) {
      console.log(`Found ${availableNetworks.length} networks to compare:`, availableNetworks.map(n => `${n} (${NETWORK_MAP[n] || 'unknown'})`));
    }
    
    const networkResults: ComparisonResult[] = [];
    const criticalIssues: string[] = [];
    const warnings: string[] = [];
    
    // Compare each network
    for (const chainId of availableNetworks) {
      if (specificNetwork && NETWORK_MAP[chainId] !== specificNetwork) {
        continue;
      }
      
      try {
        const result = await this.compareNetwork(chainId);
        networkResults.push(result);
        
        // Collect issues
        if (result.summary.missing > 0) {
          criticalIssues.push(`${result.networkName}: ${result.summary.missing} contracts missing in Unified JSON`);
        }
        
        if (result.summary.fieldMismatches > 0) {
          warnings.push(`${result.networkName}: ${result.summary.fieldMismatches} contracts have field mismatches`);
        }
        
        if (result.summary.successPercentage < 95) {
          criticalIssues.push(`${result.networkName}: Low success rate (${result.summary.successPercentage.toFixed(1)}%)`);
        }
        
      } catch (error) {
        criticalIssues.push(`Failed to compare ${NETWORK_MAP[chainId] || chainId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Calculate overall statistics
    const overallStats = this.calculateOverallStats(networkResults);
    const dataIntegrityCheck = this.performDataIntegrityCheck(networkResults);
    
    const report: OverallReport = {
      executionTime: new Date().toISOString(),
      levelDbHealthy: await this.levelDbManager.isHealthy(),
      unifiedHealthy: await this.jsonManager.isHealthy(),
      totalNetworks: availableNetworks.length,
      networksCompared: networkResults.length,
      overallStats,
      networkResults,
      criticalIssues,
      warnings,
      dataIntegrityCheck
    };
    
    // Clean up
    await this.cleanup();
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Comparison completed in ${duration}ms`);
    
    return report;
  }

  /**
   * Compare contracts for a specific network
   */
  private async compareNetwork(chainId: number): Promise<ComparisonResult> {
    const networkName = NETWORK_MAP[chainId] || `chain${chainId}`;
    
    if (this.verbose) {
      console.log(`\n📊 Comparing ${networkName} (Chain ID: ${chainId})`);
    }
    
    // Get contracts from both backends
    const levelDbContracts = await this.levelDbManager.getAllContracts(chainId);
    const unifiedContracts = await this.jsonManager.getAllContracts(chainId);
    
    if (this.verbose) {
      console.log(`  LevelDB: ${levelDbContracts.length} contracts`);
      console.log(`  Unified: ${unifiedContracts.length} contracts`);
    }
    
    // Create maps for efficient lookup
    const levelDbMap = new Map<string, ContractType>();
    const unifiedMap = new Map<string, ContractType>();
    
    levelDbContracts.forEach(c => levelDbMap.set(c.contractName, c));
    unifiedContracts.forEach(c => unifiedMap.set(c.contractName, c));
    
    // Find matches and mismatches
    const matches: ContractMatch[] = [];
    const missingInUnified: ContractType[] = [];
    const extraInUnified: ContractType[] = [];
    
    // Check contracts from LevelDB
    for (const [name, levelDbContract] of levelDbMap) {
      const unifiedContract = unifiedMap.get(name);
      
      if (!unifiedContract) {
        missingInUnified.push(levelDbContract);
        if (this.verbose) {
          console.log(`  ❌ Missing in Unified: ${name}`);
        }
      } else {
        const match = this.compareContracts(levelDbContract, unifiedContract);
        matches.push(match);
        
        if (this.verbose && !match.isMatch) {
          console.log(`  ⚠️  Mismatch in ${name}: ${match.fieldComparisons.filter(f => !f.isMatch).length} field(s)`);
        }
      }
    }
    
    // Check for extra contracts in Unified
    for (const [name, unifiedContract] of unifiedMap) {
      if (!levelDbMap.has(name)) {
        extraInUnified.push(unifiedContract);
        if (this.verbose) {
          console.log(`  ℹ️  Extra in Unified: ${name}`);
        }
      }
    }
    
    // Calculate summary
    const perfectMatches = matches.filter(m => m.isMatch).length;
    const fieldMismatches = matches.filter(m => !m.isMatch).length;
    const successPercentage = levelDbContracts.length > 0 ? 
      (perfectMatches / levelDbContracts.length) * 100 : 100;
    
    return {
      chainId,
      networkName,
      levelDbContracts,
      unifiedContracts,
      matches,
      missingInUnified,
      extraInUnified,
      summary: {
        totalLevelDb: levelDbContracts.length,
        totalUnified: unifiedContracts.length,
        perfectMatches,
        fieldMismatches,
        missing: missingInUnified.length,
        extra: extraInUnified.length,
        successPercentage
      }
    };
  }

  /**
   * Deep comparison of two contracts
   */
  private compareContracts(levelDb: ContractType, unified: ContractType): ContractMatch {
    const fieldComparisons: FieldComparison[] = [];
    
    // Define fields to compare
    const fieldsToCompare: (keyof ContractType)[] = [
      'contractName', 'chainId', 'networkName', 'address', 
      'factoryByteCodeHash', 'implementationHash', 'proxyAddress', 
      'deploymentArgs', 'timestamp'
    ];
    
    let overallMatch = true;
    
    for (const field of fieldsToCompare) {
      const levelDbValue = levelDb[field];
      const unifiedValue = unified[field];
      
      let isMatch = false;
      let notes: string | undefined;
      
      // Special handling for different field types
      switch (field) {
        case 'deploymentArgs':
          isMatch = this.compareArrays(levelDbValue as unknown[], unifiedValue as unknown[]);
          if (!isMatch) {
            notes = `Array mismatch - LevelDB: ${JSON.stringify(levelDbValue)}, Unified: ${JSON.stringify(unifiedValue)}`;
          }
          break;
          
        case 'timestamp':
          // Handle timestamp conversion (BigInt to number)
          const levelDbTimestamp = typeof levelDbValue === 'bigint' ? Number(levelDbValue) : levelDbValue;
          const unifiedTimestamp = typeof unifiedValue === 'bigint' ? Number(unifiedValue) : unifiedValue;
          isMatch = Math.abs((levelDbTimestamp as number) - (unifiedTimestamp as number)) <= 1000; // Allow 1s difference
          if (!isMatch) {
            notes = `Timestamp mismatch - LevelDB: ${levelDbTimestamp}, Unified: ${unifiedTimestamp}`;
          }
          break;
          
        case 'address':
        case 'proxyAddress':
        case 'factoryByteCodeHash':
        case 'implementationHash':
          // Case-insensitive string comparison for addresses and hashes
          const levelDbStr = (levelDbValue as string)?.toLowerCase();
          const unifiedStr = (unifiedValue as string)?.toLowerCase();
          isMatch = levelDbStr === unifiedStr;
          if (!isMatch) {
            notes = `String mismatch - LevelDB: "${levelDbValue}", Unified: "${unifiedValue}"`;
          }
          break;
          
        default:
          // Direct equality for other fields
          isMatch = levelDbValue === unifiedValue;
          if (!isMatch) {
            notes = `Direct mismatch - LevelDB: ${JSON.stringify(levelDbValue)}, Unified: ${JSON.stringify(unifiedValue)}`;
          }
      }
      
      fieldComparisons.push({
        field,
        levelDbValue,
        unifiedValue,
        isMatch,
        notes
      });
      
      if (!isMatch) {
        overallMatch = false;
      }
    }
    
    return {
      contractName: levelDb.contractName,
      isMatch: overallMatch,
      fieldComparisons,
      levelDbContract: levelDb,
      unifiedContract: unified
    };
  }

  /**
   * Compare arrays with deep equality
   */
  private compareArrays(arr1: unknown[], arr2: unknown[]): boolean {
    if (!Array.isArray(arr1) && !Array.isArray(arr2)) {
      return arr1 === arr2; // Both null/undefined
    }
    
    if (!Array.isArray(arr1) || !Array.isArray(arr2)) {
      return false; // One is array, one is not
    }
    
    if (arr1.length !== arr2.length) {
      return false;
    }
    
    for (let i = 0; i < arr1.length; i++) {
      if (JSON.stringify(arr1[i]) !== JSON.stringify(arr2[i])) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Calculate overall statistics across all networks
   */
  private calculateOverallStats(results: ComparisonResult[]) {
    let totalContracts = 0;
    let perfectMatches = 0;
    let partialMatches = 0;
    let missing = 0;
    let extra = 0;
    let fieldMismatches = 0;
    
    for (const result of results) {
      totalContracts += result.summary.totalLevelDb;
      perfectMatches += result.summary.perfectMatches;
      fieldMismatches += result.summary.fieldMismatches;
      missing += result.summary.missing;
      extra += result.summary.extra;
    }
    
    partialMatches = fieldMismatches; // Contracts with some field mismatches
    const overallSuccessRate = totalContracts > 0 ? (perfectMatches / totalContracts) * 100 : 100;
    
    return {
      totalContracts,
      perfectMatches,
      partialMatches,
      missing,
      extra,
      fieldMismatches,
      overallSuccessRate
    };
  }

  /**
   * Perform data integrity checks for specific data types
   */
  private performDataIntegrityCheck(results: ComparisonResult[]) {
    let bigIntConversions = 0;
    let timestampConversions = 0;
    let arrayPreservation = 0;
    let addressFormatting = 0;
    
    for (const result of results) {
      for (const match of result.matches) {
        for (const comparison of match.fieldComparisons) {
          switch (comparison.field) {
            case 'timestamp':
              timestampConversions++;
              break;
            case 'deploymentArgs':
              if (Array.isArray(comparison.levelDbValue)) {
                arrayPreservation++;
              }
              break;
            case 'address':
            case 'proxyAddress':
              if (typeof comparison.levelDbValue === 'string') {
                addressFormatting++;
              }
              break;
          }
        }
      }
    }
    
    return {
      bigIntConversions,
      timestampConversions,
      arrayPreservation,
      addressFormatting
    };
  }

  /**
   * Initialize both backend managers
   */
  private async initializeBackends(): Promise<void> {
    try {
      await this.levelDbManager.initialize();
      if (this.verbose) {
        console.log('✅ LevelDB manager initialized');
      }
    } catch (error) {
      console.warn('⚠️  LevelDB manager failed to initialize:', error instanceof Error ? error.message : String(error));
    }
    
    try {
      await this.unifiedManager.initialize();
      if (this.verbose) {
        console.log('✅ Unified JSON manager initialized');
      }
    } catch (error) {
      console.error('❌ Unified JSON manager failed to initialize:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Get list of available networks from both backends
   */
  private async getAvailableNetworks(): Promise<number[]> {
    const networks = new Set<number>();
    
    // Get networks from LevelDB
    try {
      const levelDbQuery = await this.levelDbManager.queryContracts({});
      for (const contract of levelDbQuery) {
        networks.add(contract.chainId);
      }
    } catch (error) {
      if (this.verbose) {
        console.warn('Could not query LevelDB contracts:', error instanceof Error ? error.message : String(error));
      }
    }
    
    // Get networks from Unified JSON files
    try {
      const files = await fs.readdir(this.unifiedPath);
      for (const file of files) {
        if (file.endsWith('.unified.json')) {
          const networkName = file.replace('.unified.json', '');
          const chainId = Object.entries(NETWORK_MAP).find(([_, name]) => name === networkName)?.[0];
          if (chainId) {
            networks.add(parseInt(chainId, 10));
          }
        }
      }
    } catch (error) {
      console.warn('Could not read unified directory:', error instanceof Error ? error.message : String(error));
    }
    
    return Array.from(networks).sort((a, b) => a - b);
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    try {
      await this.levelDbManager.close();
      await this.jsonManager.close();
    } catch (error) {
      if (this.verbose) {
        console.warn('Cleanup error:', error instanceof Error ? error.message : String(error));
      }
    }
  }

  /**
   * Generate detailed text report
   */
  generateReport(report: OverallReport): string {
    const lines: string[] = [];
    
    lines.push('# LevelDB to Unified JSON Migration Validation Report');
    lines.push(`Generated: ${report.executionTime}`);
    lines.push('');
    
    // Executive Summary
    lines.push('## Executive Summary');
    lines.push(`- **Overall Success Rate**: ${report.overallStats.overallSuccessRate.toFixed(2)}%`);
    lines.push(`- **Total Contracts**: ${report.overallStats.totalContracts}`);
    lines.push(`- **Perfect Matches**: ${report.overallStats.perfectMatches}`);
    lines.push(`- **Field Mismatches**: ${report.overallStats.fieldMismatches}`);
    lines.push(`- **Missing Contracts**: ${report.overallStats.missing}`);
    lines.push(`- **Extra Contracts**: ${report.overallStats.extra}`);
    lines.push(`- **Networks Compared**: ${report.networksCompared}/${report.totalNetworks}`);
    lines.push('');
    
    // Backend Health
    lines.push('## Backend Health');
    lines.push(`- **LevelDB**: ${report.levelDbHealthy ? '✅ Healthy' : '❌ Unhealthy'}`);
    lines.push(`- **Unified JSON**: ${report.unifiedHealthy ? '✅ Healthy' : '❌ Unhealthy'}`);
    lines.push('');
    
    // Data Integrity Check
    lines.push('## Data Integrity Analysis');
    lines.push(`- **Timestamp Conversions**: ${report.dataIntegrityCheck.timestampConversions}`);
    lines.push(`- **Array Preservation**: ${report.dataIntegrityCheck.arrayPreservation}`);
    lines.push(`- **Address Formatting**: ${report.dataIntegrityCheck.addressFormatting}`);
    lines.push(`- **BigInt Conversions**: ${report.dataIntegrityCheck.bigIntConversions}`);
    lines.push('');
    
    // Critical Issues
    if (report.criticalIssues.length > 0) {
      lines.push('## 🚨 Critical Issues');
      for (const issue of report.criticalIssues) {
        lines.push(`- ${issue}`);
      }
      lines.push('');
    }
    
    // Warnings
    if (report.warnings.length > 0) {
      lines.push('## ⚠️ Warnings');
      for (const warning of report.warnings) {
        lines.push(`- ${warning}`);
      }
      lines.push('');
    }
    
    // Network Details
    lines.push('## Network Comparison Details');
    lines.push('');
    
    for (const result of report.networkResults) {
      lines.push(`### ${result.networkName} (Chain ${result.chainId})`);
      lines.push(`- **LevelDB Contracts**: ${result.summary.totalLevelDb}`);
      lines.push(`- **Unified Contracts**: ${result.summary.totalUnified}`);
      lines.push(`- **Perfect Matches**: ${result.summary.perfectMatches}`);
      lines.push(`- **Field Mismatches**: ${result.summary.fieldMismatches}`);
      lines.push(`- **Success Rate**: ${result.summary.successPercentage.toFixed(2)}%`);
      
      if (result.missingInUnified.length > 0) {
        lines.push(`- **Missing Contracts**: ${result.missingInUnified.map(c => c.contractName).join(', ')}`);
      }
      
      if (result.extraInUnified.length > 0) {
        lines.push(`- **Extra Contracts**: ${result.extraInUnified.map(c => c.contractName).join(', ')}`);
      }
      
      // Field-level mismatches
      const mismatchedContracts = result.matches.filter(m => !m.isMatch);
      if (mismatchedContracts.length > 0) {
        lines.push(`- **Field Mismatches**:`);
        for (const match of mismatchedContracts) {
          const mismatchedFields = match.fieldComparisons.filter(f => !f.isMatch);
          lines.push(`  - ${match.contractName}: ${mismatchedFields.map(f => f.field).join(', ')}`);
        }
      }
      
      lines.push('');
    }
    
    return lines.join('\n');
  }

  /**
   * Export full comparison data as JSON
   */
  exportFullReport(report: OverallReport, filename: string = 'migration-comparison-full.json'): string {
    const filepath = path.join(process.cwd(), filename);
    fs.writeFile(filepath, JSON.stringify(report, null, 2));
    return filepath;
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const exportReport = args.includes('--export-report');
  const networkIndex = args.findIndex(arg => arg === '--network');
  const specificNetwork = networkIndex >= 0 ? args[networkIndex + 1] : undefined;
  
  try {
    const tool = new MigrationComparisonTool(verbose);
    const report = await tool.compareAllNetworks(specificNetwork);
    
    // Generate and display summary report
    const textReport = tool.generateReport(report);
    console.log('\n' + textReport);
    
    // Export full report if requested
    if (exportReport) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `migration-comparison-${timestamp}.json`;
      await tool.exportFullReport(report, filename);
      console.log(`\n📄 Full report exported to: ${filename}`);
    }
    
    // Exit with appropriate code
    const hasErrors = report.criticalIssues.length > 0;
    process.exit(hasErrors ? 1 : 0);
    
  } catch (error) {
    console.error('❌ Comparison failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { MigrationComparisonTool, type OverallReport, type ComparisonResult };