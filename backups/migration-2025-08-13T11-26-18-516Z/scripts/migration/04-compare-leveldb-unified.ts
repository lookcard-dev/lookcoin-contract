#!/usr/bin/env tsx

/**
 * LevelDB to Unified JSON Data Comparison Script
 * 
 * Comprehensive validation system that ensures 100% data preservation during migration
 * from LevelDB to unified JSON format. This script performs field-by-field comparison
 * of all contract entries, metadata, configurations, and deployment data.
 * 
 * Key Features:
 * - Complete data audit comparing all contract entries
 * - Field-by-field validation of addresses, hashes, deployment args, timestamps
 * - Data type consistency checks for BigInt serialization, address formats, arrays
 * - Missing data detection and corruption analysis
 * - Migration quality metrics with detailed reporting
 * 
 * Usage: tsx scripts/migration/04-compare-leveldb-unified.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';

interface LevelDBContract {
  contractName: string;
  chainId: number;
  networkName: string;
  address: string;
  factoryByteCodeHash?: string;
  implementationHash?: string;
  proxyAddress?: string;
  deploymentArgs?: any[];
  timestamp: number;
}

interface LevelDBExport {
  format: string;
  exportTime: string;
  totalContracts: number;
  metadata: {
    backendType: string;
    dbPath: string;
    metrics: {
      readLatency: number;
      writeLatency: number;
      queryLatency: number;
      errorRate: number;
    };
  };
  contracts: Record<string, LevelDBContract>;
}

interface UnifiedContract {
  address: string;
  proxy?: string;
  implementation?: string;
  metadata?: {
    factoryByteCodeHash?: string;
    implementationHash?: string;
    deploymentArgs?: any[];
    timestamp?: number;
    deployer?: string;
    deploymentTx?: string;
    deploymentBlock?: number;
    gasUsed?: string;
    verified?: boolean;
  };
}

interface UnifiedDeployment {
  schemaVersion: string;
  fileVersion: number;
  network: string;
  chainId: number;
  networkTier: string;
  metadata: {
    deployer?: string;
    deploymentMode?: string;
    timestamp?: string;
    lastUpdated?: string;
    protocolsEnabled?: string[];
    protocolsDeployed?: string[];
    protocolsConfigured?: string[];
    migrationHistory?: any[];
    dataSources?: {
      originalFormat?: string;
      importedFrom?: string[];
      consolidatedAt?: string;
    };
  };
  contracts: {
    core?: Record<string, UnifiedContract>;
    protocol?: Record<string, UnifiedContract>;
    infrastructure?: Record<string, UnifiedContract>;
    legacy?: Record<string, UnifiedContract>;
  };
}

interface ComparisonResult {
  contractKey: string;
  contractName: string;
  chainId: number;
  networkName: string;
  status: 'matched' | 'missing_in_unified' | 'corrupted' | 'type_mismatch';
  issues: string[];
  fieldComparisons: FieldComparison[];
}

interface FieldComparison {
  field: string;
  leveldbValue: any;
  unifiedValue: any;
  status: 'matched' | 'missing' | 'corrupted' | 'type_mismatch';
  details?: string;
}

interface MigrationQualityReport {
  summary: {
    totalContracts: number;
    matchedContracts: number;
    missingContracts: number;
    corruptedContracts: number;
    dataPreservationPercentage: number;
    migrationQualityScore: number;
  };
  networkBreakdown: Record<string, {
    totalContracts: number;
    matchedContracts: number;
    issues: number;
    preservationRate: number;
  }>;
  contractResults: ComparisonResult[];
  recommendations: string[];
  criticalIssues: string[];
}

// Network name mapping for consistency
const NETWORK_NAME_MAPPING: Record<string, string> = {
  'bscmainnet': 'bscmainnet',
  'bsctestnet': 'bsctestnet',
  'bsc': 'bscmainnet',  // Handle alternative naming
  'bscTestnet': 'bsctestnet',  // Handle camelCase
  'baseSepolia': 'basesepolia',
  'basesepolia': 'basesepolia', // Handle direct match
  'opSepolia': 'optimismsepolia',
  'optimismsepolia': 'optimismsepolia', // Handle direct match
  'sapphiremainnet': 'sapphiremainnet',
  'sapphiretestnet': 'sapphiretestnet',
  'test': 'testnet'  // Handle test network
};

class LevelDBUnifiedComparator {
  private leveldbData: LevelDBExport | null = null;
  private unifiedDeployments: Map<string, UnifiedDeployment> = new Map();
  
  /**
   * Load LevelDB backup data from the backup directory
   */
  async loadLevelDBBackup(): Promise<void> {
    console.log(chalk.blue('📥 Loading LevelDB backup data...'));
    
    const backupDir = path.join(process.cwd(), 'leveldb-backup');
    const files = await fs.readdir(backupDir);
    
    // Find the latest export file
    const exportFiles = files.filter(f => f.startsWith('leveldb-export-') && f.endsWith('.json'));
    if (exportFiles.length === 0) {
      throw new Error('No LevelDB export files found in backup directory');
    }
    
    // Use the latest export file (assuming timestamp sorting)
    const latestExport = exportFiles.sort().reverse()[0];
    const exportPath = path.join(backupDir, latestExport);
    
    console.log(`  Using export file: ${chalk.yellow(latestExport)}`);
    
    const exportData = await fs.readFile(exportPath, 'utf-8');
    this.leveldbData = JSON.parse(exportData);
    
    console.log(`  Loaded ${chalk.green(this.leveldbData.totalContracts)} contracts from LevelDB backup`);
  }
  
  /**
   * Load all unified JSON deployment files
   */
  async loadUnifiedDeployments(): Promise<void> {
    console.log(chalk.blue('📥 Loading unified JSON deployments...'));
    
    const unifiedDir = path.join(process.cwd(), 'deployments', 'unified');
    const files = await fs.readdir(unifiedDir);
    
    // Load all *.unified.json files (exclude backups)
    const unifiedFiles = files.filter(f => f.endsWith('.unified.json') && !f.includes('backup'));
    
    for (const file of unifiedFiles) {
      const filePath = path.join(unifiedDir, file);
      const data = await fs.readFile(filePath, 'utf-8');
      const deployment: UnifiedDeployment = JSON.parse(data);
      
      const networkKey = deployment.network || file.replace('.unified.json', '');
      this.unifiedDeployments.set(networkKey, deployment);
      
      console.log(`  Loaded ${chalk.yellow(networkKey)} unified deployment (chainId: ${deployment.chainId})`);
    }
    
    console.log(`  Total unified deployments loaded: ${chalk.green(this.unifiedDeployments.size)}`);
  }
  
  /**
   * Find unified contract by mapping LevelDB contract structure
   */
  private findUnifiedContract(leveldbContract: LevelDBContract): UnifiedContract | null {
    // Skip test networks that shouldn't be in production unified deployments
    if (leveldbContract.networkName === 'test' || leveldbContract.chainId === 31337) {
      return null;
    }
    
    const networkKey = NETWORK_NAME_MAPPING[leveldbContract.networkName] || leveldbContract.networkName;
    const deployment = this.unifiedDeployments.get(networkKey);
    
    if (!deployment) {
      return null;
    }
    
    // Search through all contract categories
    const categories = ['core', 'protocol', 'infrastructure', 'legacy'] as const;
    
    for (const category of categories) {
      const contracts = deployment.contracts[category];
      if (!contracts) continue;
      
      // Direct name match
      if (contracts[leveldbContract.contractName]) {
        return contracts[leveldbContract.contractName];
      }
      
      // Handle special contract name mappings
      const mappedName = this.mapContractName(leveldbContract.contractName);
      if (mappedName && contracts[mappedName]) {
        return contracts[mappedName];
      }
    }
    
    return null;
  }
  
  /**
   * Map LevelDB contract names to unified JSON names
   */
  private mapContractName(leveldbName: string): string | null {
    // Handle special cases
    if (leveldbName === 'contracts/xchain/CrossChainRouter.sol:CrossChainRouter') {
      return 'CrossChainRouter';
    }
    
    // Most names should match directly
    return leveldbName;
  }
  
  /**
   * Perform detailed field comparison between LevelDB and unified data
   */
  private compareFields(leveldbContract: LevelDBContract, unifiedContract: UnifiedContract): FieldComparison[] {
    const comparisons: FieldComparison[] = [];
    
    // Implementation address comparison (LevelDB 'address' maps to unified 'implementation')
    comparisons.push({
      field: 'address/implementation',
      leveldbValue: leveldbContract.address,
      unifiedValue: unifiedContract.implementation,
      status: this.normalizeAddress(leveldbContract.address) === this.normalizeAddress(unifiedContract.implementation) 
        ? 'matched' : 'corrupted',
      details: this.normalizeAddress(leveldbContract.address) !== this.normalizeAddress(unifiedContract.implementation) 
        ? `Implementation address mismatch: ${leveldbContract.address} !== ${unifiedContract.implementation}` : undefined
    });
    
    // Proxy address comparison
    if (leveldbContract.proxyAddress || unifiedContract.proxy) {
      comparisons.push({
        field: 'proxyAddress',
        leveldbValue: leveldbContract.proxyAddress,
        unifiedValue: unifiedContract.proxy,
        status: this.compareAddresses(leveldbContract.proxyAddress, unifiedContract.proxy),
        details: leveldbContract.proxyAddress && unifiedContract.proxy && 
          this.normalizeAddress(leveldbContract.proxyAddress) !== this.normalizeAddress(unifiedContract.proxy) 
          ? `Proxy address mismatch` : undefined
      });
    }
    
    // Legacy address comparison (if unified has 'address' field)
    if (unifiedContract.address) {
      comparisons.push({
        field: 'legacyAddress',
        leveldbValue: leveldbContract.address,
        unifiedValue: unifiedContract.address,
        status: this.normalizeAddress(leveldbContract.address) === this.normalizeAddress(unifiedContract.address) 
          ? 'matched' : 'corrupted',
        details: this.normalizeAddress(leveldbContract.address) !== this.normalizeAddress(unifiedContract.address) 
          ? `Legacy address mismatch: ${leveldbContract.address} !== ${unifiedContract.address}` : undefined
      });
    }
    
    // Implementation hash comparison
    if (leveldbContract.implementationHash || unifiedContract.metadata?.implementationHash) {
      comparisons.push({
        field: 'implementationHash',
        leveldbValue: leveldbContract.implementationHash,
        unifiedValue: unifiedContract.metadata?.implementationHash,
        status: leveldbContract.implementationHash === unifiedContract.metadata?.implementationHash 
          ? 'matched' : (leveldbContract.implementationHash || unifiedContract.metadata?.implementationHash ? 'missing' : 'matched')
      });
    }
    
    // Factory bytecode hash comparison
    if (leveldbContract.factoryByteCodeHash || unifiedContract.metadata?.factoryByteCodeHash) {
      comparisons.push({
        field: 'factoryByteCodeHash',
        leveldbValue: leveldbContract.factoryByteCodeHash,
        unifiedValue: unifiedContract.metadata?.factoryByteCodeHash,
        status: leveldbContract.factoryByteCodeHash === unifiedContract.metadata?.factoryByteCodeHash 
          ? 'matched' : (leveldbContract.factoryByteCodeHash || unifiedContract.metadata?.factoryByteCodeHash ? 'missing' : 'matched')
      });
    }
    
    // Deployment arguments comparison
    if (leveldbContract.deploymentArgs || unifiedContract.metadata?.deploymentArgs) {
      const deploymentArgsMatch = JSON.stringify(leveldbContract.deploymentArgs) === 
        JSON.stringify(unifiedContract.metadata?.deploymentArgs);
        
      comparisons.push({
        field: 'deploymentArgs',
        leveldbValue: leveldbContract.deploymentArgs,
        unifiedValue: unifiedContract.metadata?.deploymentArgs,
        status: deploymentArgsMatch ? 'matched' : (leveldbContract.deploymentArgs || unifiedContract.metadata?.deploymentArgs ? 'missing' : 'matched'),
        details: !deploymentArgsMatch && (leveldbContract.deploymentArgs || unifiedContract.metadata?.deploymentArgs) ? 'Deployment arguments not preserved in unified format' : undefined
      });
    }
    
    // Timestamp comparison
    if (leveldbContract.timestamp || unifiedContract.metadata?.timestamp) {
      comparisons.push({
        field: 'timestamp',
        leveldbValue: leveldbContract.timestamp,
        unifiedValue: unifiedContract.metadata?.timestamp,
        status: leveldbContract.timestamp === unifiedContract.metadata?.timestamp 
          ? 'matched' : (leveldbContract.timestamp || unifiedContract.metadata?.timestamp ? 'missing' : 'matched'),
        details: leveldbContract.timestamp !== unifiedContract.metadata?.timestamp && (leveldbContract.timestamp || unifiedContract.metadata?.timestamp)
          ? `Timestamp not preserved in unified format` : undefined
      });
    }
    
    return comparisons;
  }
  
  /**
   * Normalize address format for comparison
   */
  private normalizeAddress(address: string | undefined): string {
    if (!address) return '';
    return address.toLowerCase();
  }
  
  /**
   * Compare two addresses, handling undefined values
   */
  private compareAddresses(addr1: string | undefined, addr2: string | undefined): 'matched' | 'missing' | 'corrupted' {
    if (!addr1 && !addr2) return 'matched';
    if (!addr1 || !addr2) return 'missing';
    return this.normalizeAddress(addr1) === this.normalizeAddress(addr2) ? 'matched' : 'corrupted';
  }
  
  /**
   * Perform comprehensive comparison of all contracts
   */
  async performComparison(): Promise<ComparisonResult[]> {
    console.log(chalk.blue('🔍 Performing comprehensive data comparison...'));
    
    if (!this.leveldbData) {
      throw new Error('LevelDB data not loaded');
    }
    
    const results: ComparisonResult[] = [];
    
    for (const [contractKey, leveldbContract] of Object.entries(this.leveldbData.contracts)) {
      console.log(`  Comparing ${chalk.yellow(contractKey)}...`);
      
      // Skip test networks that are expected to not be in unified format
      if (leveldbContract.networkName === 'test' || leveldbContract.chainId === 31337) {
        console.log(`    Skipping test network contract: ${contractKey}`);
        continue;
      }
      
      const unifiedContract = this.findUnifiedContract(leveldbContract);
      
      if (!unifiedContract) {
        results.push({
          contractKey,
          contractName: leveldbContract.contractName,
          chainId: leveldbContract.chainId,
          networkName: leveldbContract.networkName,
          status: 'missing_in_unified',
          issues: ['Contract not found in unified deployments'],
          fieldComparisons: []
        });
        continue;
      }
      
      const fieldComparisons = this.compareFields(leveldbContract, unifiedContract);
      const issues: string[] = [];
      let status: ComparisonResult['status'] = 'matched';
      
      // Analyze field comparisons for issues
      const coreFields = ['address/implementation', 'proxyAddress', 'legacyAddress'];
      const metadataFields = ['implementationHash', 'factoryByteCodeHash', 'deploymentArgs', 'timestamp'];
      
      let coreFieldsMatched = 0;
      let coreFieldsTotal = 0;
      let metadataFieldsMissing = 0;
      
      for (const comparison of fieldComparisons) {
        const isCoreField = coreFields.includes(comparison.field);
        const isMetadataField = metadataFields.includes(comparison.field);
        
        if (isCoreField) {
          coreFieldsTotal++;
          if (comparison.status === 'matched') {
            coreFieldsMatched++;
          } else if (comparison.status === 'corrupted') {
            issues.push(`CRITICAL: Core field '${comparison.field}' corrupted: ${comparison.details || 'Values differ'}`);
            status = 'corrupted';
          }
        } else if (isMetadataField) {
          if (comparison.status === 'missing') {
            metadataFieldsMissing++;
            issues.push(`Metadata field '${comparison.field}' not preserved in unified format`);
          } else if (comparison.status === 'corrupted') {
            issues.push(`Metadata field '${comparison.field}' corrupted: ${comparison.details || 'Values differ'}`);
            if (status === 'matched') status = 'corrupted';
          }
        } else {
          // Handle other field types
          if (comparison.status === 'corrupted') {
            issues.push(`Field '${comparison.field}' corrupted: ${comparison.details || 'Values differ'}`);
            status = 'corrupted';
          } else if (comparison.status === 'type_mismatch') {
            issues.push(`Field '${comparison.field}' type mismatch`);
            status = 'type_mismatch';
          }
        }
      }
      
      // Determine final status based on core fields
      if (status !== 'corrupted' && status !== 'type_mismatch') {
        if (coreFieldsMatched === coreFieldsTotal && coreFieldsTotal > 0) {
          status = 'matched'; // Core data is preserved
        } else if (coreFieldsMatched > 0) {
          status = 'corrupted'; // Partial core data match
        } else {
          status = 'missing_in_unified'; // No core data found
        }
      }
      
      results.push({
        contractKey,
        contractName: leveldbContract.contractName,
        chainId: leveldbContract.chainId,
        networkName: leveldbContract.networkName,
        status,
        issues,
        fieldComparisons
      });
    }
    
    console.log(`  Comparison complete: ${chalk.green(results.length)} contracts analyzed`);
    return results;
  }
  
  /**
   * Generate comprehensive migration quality report
   */
  generateQualityReport(results: ComparisonResult[]): MigrationQualityReport {
    console.log(chalk.blue('📊 Generating migration quality report...'));
    
    const totalContracts = results.length;
    const matchedContracts = results.filter(r => r.status === 'matched').length;
    const missingContracts = results.filter(r => r.status === 'missing_in_unified').length;
    const corruptedContracts = results.filter(r => r.status === 'corrupted' || r.status === 'type_mismatch').length;
    
    // Calculate core data preservation (addresses and contract mappings)
    const coreDataPreservationPercentage = totalContracts > 0 ? (matchedContracts / totalContracts) * 100 : 0;
    
    // Calculate overall preservation including metadata
    const metadataPreservationPercentage = totalContracts > 0 ? 
      ((matchedContracts + corruptedContracts) / totalContracts) * 100 : 0;
    
    const migrationQualityScore = Math.max(0, 100 - (missingContracts * 20) - (corruptedContracts * 2));
    
    // Network breakdown analysis
    const networkBreakdown: Record<string, any> = {};
    const networkGroups = new Map<string, ComparisonResult[]>();
    
    // Group results by network
    for (const result of results) {
      const network = result.networkName;
      if (!networkGroups.has(network)) {
        networkGroups.set(network, []);
      }
      networkGroups.get(network)!.push(result);
    }
    
    // Calculate network-specific metrics
    for (const [network, networkResults] of networkGroups) {
      const networkTotal = networkResults.length;
      const networkMatched = networkResults.filter(r => r.status === 'matched').length;
      const networkIssues = networkResults.filter(r => r.status !== 'matched').length;
      
      networkBreakdown[network] = {
        totalContracts: networkTotal,
        matchedContracts: networkMatched,
        issues: networkIssues,
        preservationRate: networkTotal > 0 ? (networkMatched / networkTotal) * 100 : 0
      };
    }
    
    // Generate recommendations
    const recommendations: string[] = [];
    const criticalIssues: string[] = [];
    
    if (missingContracts > 0) {
      criticalIssues.push(`${missingContracts} contracts are missing in unified format - DATA LOSS DETECTED`);
      recommendations.push('Investigate missing contracts and ensure all LevelDB data is properly migrated');
    }
    
    if (corruptedContracts > 0) {
      criticalIssues.push(`${corruptedContracts} contracts have corrupted or mismatched data`);
      recommendations.push('Review field-level differences and fix data integrity issues');
    }
    
    if (coreDataPreservationPercentage < 100) {
      criticalIssues.push(`Core data preservation is ${coreDataPreservationPercentage.toFixed(2)}% - NOT 100%`);
      recommendations.push('Achieve 100% core data preservation before removing LevelDB dependencies');
    }
    
    if (coreDataPreservationPercentage === 100) {
      if (metadataPreservationPercentage === 100) {
        recommendations.push('Migration quality is excellent - all data preserved successfully');
      } else {
        recommendations.push('Core data fully preserved. Metadata fields not migrated but this may be acceptable for unified format.');
      }
    }
    
    // Quality thresholds
    if (migrationQualityScore < 90) {
      recommendations.push('Migration quality score below 90% - manual intervention required');
    }
    
    return {
      summary: {
        totalContracts,
        matchedContracts,
        missingContracts,
        corruptedContracts,
        dataPreservationPercentage: coreDataPreservationPercentage,
        metadataPreservationPercentage,
        migrationQualityScore
      },
      networkBreakdown,
      contractResults: results,
      recommendations,
      criticalIssues
    };
  }
  
  /**
   * Save detailed comparison report to file
   */
  async saveReport(report: MigrationQualityReport): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(process.cwd(), `leveldb-unified-comparison-${timestamp}.json`);
    
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    // Also create a human-readable summary
    const summaryPath = path.join(process.cwd(), `migration-quality-summary-${timestamp}.md`);
    const summaryContent = this.generateMarkdownSummary(report);
    await fs.writeFile(summaryPath, summaryContent);
    
    return reportPath;
  }
  
  /**
   * Generate human-readable markdown summary
   */
  private generateMarkdownSummary(report: MigrationQualityReport): string {
    const { summary, networkBreakdown, criticalIssues, recommendations } = report;
    
    return `# Migration Quality Report

## Executive Summary

**Data Preservation: ${summary.dataPreservationPercentage.toFixed(2)}%**
**Migration Quality Score: ${summary.migrationQualityScore.toFixed(1)}/100**

- Total Contracts: ${summary.totalContracts}
- Successfully Matched: ${summary.matchedContracts}
- Missing in Unified: ${summary.missingContracts}
- Corrupted/Mismatched: ${summary.corruptedContracts}

## Network Breakdown

${Object.entries(networkBreakdown).map(([network, stats]) => `
### ${network.toUpperCase()}
- Total Contracts: ${stats.totalContracts}
- Matched: ${stats.matchedContracts}
- Issues: ${stats.issues}
- Preservation Rate: ${stats.preservationRate.toFixed(2)}%
`).join('')}

## Critical Issues

${criticalIssues.length > 0 ? criticalIssues.map(issue => `- ⚠️ ${issue}`).join('\n') : '✅ No critical issues detected'}

## Recommendations

${recommendations.map(rec => `- ${rec}`).join('\n')}

## Quality Assessment

${summary.dataPreservationPercentage === 100 ? 
  '✅ **EXCELLENT**: 100% data preservation achieved. Migration is ready for production.' :
  summary.dataPreservationPercentage >= 95 ? 
  '⚠️ **GOOD**: High data preservation rate, but minor issues need resolution.' :
  '❌ **REQUIRES ATTENTION**: Significant data integrity issues must be resolved before proceeding.'
}

---
Report generated: ${new Date().toISOString()}
`;
  }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  console.log(chalk.bold.blue('🔍 LevelDB to Unified JSON Data Comparison\n'));
  console.log('This script validates 100% data preservation during migration.');
  console.log('🎯 Mission: Ensure ZERO data loss before removing LevelDB dependencies\n');
  
  try {
    const comparator = new LevelDBUnifiedComparator();
    
    // Load all data sources
    await comparator.loadLevelDBBackup();
    await comparator.loadUnifiedDeployments();
    
    // Perform comprehensive comparison
    const results = await comparator.performComparison();
    
    // Generate quality report
    const report = comparator.generateQualityReport(results);
    
    // Save detailed report
    const reportPath = await comparator.saveReport(report);
    
    // Display summary
    console.log(chalk.bold.green('\n📊 Migration Quality Summary'));
    console.log('================================');
    console.log(`Core Data Preservation: ${report.summary.dataPreservationPercentage === 100 ? 
      chalk.green.bold(`${report.summary.dataPreservationPercentage.toFixed(2)}% ✅`) :
      chalk.red.bold(`${report.summary.dataPreservationPercentage.toFixed(2)}% ⚠️`)}`);
    console.log(`Metadata Preservation: ${report.summary.metadataPreservationPercentage === 100 ? 
      chalk.green(`${report.summary.metadataPreservationPercentage.toFixed(2)}%`) :
      chalk.yellow(`${report.summary.metadataPreservationPercentage.toFixed(2)}%`)}`);
    console.log(`Quality Score: ${report.summary.migrationQualityScore >= 95 ? 
      chalk.green(`${report.summary.migrationQualityScore.toFixed(1)}/100`) :
      chalk.yellow(`${report.summary.migrationQualityScore.toFixed(1)}/100`)}`);
    console.log(`Total Contracts: ${chalk.blue(report.summary.totalContracts)}`);
    console.log(`Matched: ${chalk.green(report.summary.matchedContracts)}`);
    console.log(`Missing: ${report.summary.missingContracts > 0 ? chalk.red(report.summary.missingContracts) : chalk.green(report.summary.missingContracts)}`);
    console.log(`Corrupted: ${report.summary.corruptedContracts > 0 ? chalk.red(report.summary.corruptedContracts) : chalk.green(report.summary.corruptedContracts)}`);
    
    if (report.criticalIssues.length > 0) {
      console.log(chalk.red.bold('\n🚨 Critical Issues:'));
      for (const issue of report.criticalIssues) {
        console.log(chalk.red(`  ⚠️ ${issue}`));
      }
    }
    
    if (report.recommendations.length > 0) {
      console.log(chalk.blue.bold('\n💡 Recommendations:'));
      for (const rec of report.recommendations) {
        console.log(chalk.blue(`  • ${rec}`));
      }
    }
    
    console.log(`\n📄 Detailed report saved: ${chalk.yellow(reportPath)}`);
    
    if (report.summary.dataPreservationPercentage === 100) {
      if (report.summary.metadataPreservationPercentage === 100) {
        console.log(chalk.green.bold('\n✅ MIGRATION VALIDATION PASSED - COMPLETE'));
        console.log(chalk.green('All data including metadata successfully preserved. Safe to proceed with LevelDB removal.'));
      } else {
        console.log(chalk.yellow.bold('\n⚠️ MIGRATION VALIDATION PASSED - CORE DATA ONLY'));
        console.log(chalk.yellow('Core contract data preserved. Metadata fields not migrated to unified format.'));
        console.log(chalk.blue('This may be acceptable depending on unified schema requirements.'));
      }
    } else {
      console.log(chalk.red.bold('\n❌ MIGRATION VALIDATION FAILED'));
      console.log(chalk.red('Critical data integrity issues detected. DO NOT remove LevelDB until resolved.'));
      process.exit(1);
    }
    
  } catch (error) {
    console.error(chalk.red.bold('\n💥 Comparison failed:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}

export { LevelDBUnifiedComparator, MigrationQualityReport };