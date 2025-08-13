#!/usr/bin/env tsx

/**
 * Migration Cleanup Runner
 * 
 * Orchestrates the complete cleanup process:
 * 1. Validates the unified system is working
 * 2. Runs the finalization cleanup
 * 3. Provides comprehensive reporting
 */

import { execSync } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';

interface RunnerConfig {
  dryRun: boolean;
  skipValidation: boolean;
  preserveAnalysis: boolean;
  force: boolean;
  quiet: boolean;
}

class MigrationCleanupRunner {
  private config: RunnerConfig;
  private rootPath: string;

  constructor(config: Partial<RunnerConfig> = {}) {
    this.config = {
      dryRun: false,
      skipValidation: false,
      preserveAnalysis: false,
      force: false,
      quiet: false,
      ...config
    };
    
    this.rootPath = process.cwd();
  }

  async run(): Promise<void> {
    const startTime = Date.now();
    
    try {
      this.log('🚀 MIGRATION CLEANUP ORCHESTRATOR');
      this.log('=================================\n');
      
      // Step 1: Validate unified system (unless skipped)
      if (!this.config.skipValidation) {
        this.log('🔍 Step 1: Validating unified system...');
        await this.runValidation();
        this.log('');
      } else {
        this.log('⚠️  Step 1: SKIPPED - Unified system validation');
        this.log('');
      }
      
      // Step 2: Run cleanup
      this.log('🧹 Step 2: Running cleanup finalization...');
      await this.runCleanup();
      
      // Step 3: Final report
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      this.log(`\n🎉 MIGRATION CLEANUP COMPLETED in ${duration}s`);
      this.log('==========================================');
      
      await this.generateSummaryReport();
      
    } catch (error) {
      this.log(`\n❌ CLEANUP FAILED: ${error}`);
      throw error;
    }
  }

  private async runValidation(): Promise<void> {
    try {
      const validationScript = join(this.rootPath, 'scripts', 'cleanup', 'validate-unified-system.ts');
      const result = execSync(`tsx "${validationScript}"`, { 
        encoding: 'utf8',
        stdio: this.config.quiet ? 'pipe' : 'inherit'
      });
      
      if (!this.config.quiet) {
        console.log(result);
      }
      
      this.log('✅ Unified system validation passed');
    } catch (error) {
      if (!this.config.force) {
        throw new Error('Unified system validation failed. Use --force to proceed anyway.');
      } else {
        this.log('⚠️  Unified system validation failed but proceeding due to --force flag');
      }
    }
  }

  private async runCleanup(): Promise<void> {
    const cleanupScript = join(this.rootPath, 'scripts', 'cleanup', 'finalize-migration-cleanup.ts');
    const args: string[] = [];
    
    if (this.config.dryRun) args.push('--dry-run');
    if (this.config.preserveAnalysis) args.push('--preserve-analysis');
    if (this.config.force) args.push('--force');
    if (this.config.quiet) args.push('--quiet');
    if (this.config.skipValidation) args.push('--skip-backup-validation');
    
    const command = `tsx "${cleanupScript}" ${args.join(' ')}`;
    
    try {
      const result = execSync(command, { 
        encoding: 'utf8',
        stdio: this.config.quiet ? 'pipe' : 'inherit',
        cwd: this.rootPath
      });
      
      if (!this.config.quiet) {
        console.log(result);
      }
      
      this.log('✅ Cleanup finalization completed');
    } catch (error) {
      throw new Error(`Cleanup failed: ${error}`);
    }
  }

  private async generateSummaryReport(): Promise<void> {
    const summaryReport = {
      timestamp: new Date().toISOString(),
      configuration: this.config,
      systemState: await this.getSystemState(),
      recommendations: this.getRecommendations(),
      nextSteps: this.getNextSteps()
    };
    
    const reportPath = join(this.rootPath, `cleanup-summary-${Date.now()}.json`);
    await fs.writeFile(reportPath, JSON.stringify(summaryReport, null, 2));
    
    this.log(`\n📊 SUMMARY REPORT`);
    this.log('================');
    this.log(`Configuration: ${this.config.dryRun ? 'DRY RUN' : 'LIVE RUN'}`);
    this.log(`Legacy Files: ${summaryReport.systemState.legacyFilesRemaining ? 'REMAINING' : 'ARCHIVED'}`);
    this.log(`LevelDB: ${summaryReport.systemState.leveldbRemoved ? 'REMOVED' : 'PRESENT'}`);
    this.log(`Unified System: ${summaryReport.systemState.unifiedSystemActive ? 'ACTIVE' : 'INACTIVE'}`);
    this.log(`Report: ${reportPath}`);
    
    if (summaryReport.recommendations.length > 0) {
      this.log('\n📋 RECOMMENDATIONS:');
      summaryReport.recommendations.forEach((rec, i) => {
        this.log(`   ${i + 1}. ${rec}`);
      });
    }
    
    this.log('\n🎯 NEXT STEPS:');
    summaryReport.nextSteps.forEach((step, i) => {
      this.log(`   ${i + 1}. ${step}`);
    });
  }

  private async getSystemState(): Promise<{
    legacyFilesRemaining: boolean;
    leveldbRemoved: boolean;
    unifiedSystemActive: boolean;
    backupSystemActive: boolean;
  }> {
    const legacyFiles = ['basesepolia.json', 'bscmainnet.json', 'bsctestnet.json'];
    const legacyFilesRemaining = await Promise.all(
      legacyFiles.map(file => this.pathExists(join(this.rootPath, 'deployments', file)))
    ).then(results => results.some(exists => exists));
    
    const leveldbRemoved = !await this.pathExists(join(this.rootPath, 'leveldb'));
    const unifiedSystemActive = await this.pathExists(join(this.rootPath, 'deployments', 'unified'));
    const backupSystemActive = await this.pathExists(join(this.rootPath, 'backups'));
    
    return {
      legacyFilesRemaining,
      leveldbRemoved,
      unifiedSystemActive,
      backupSystemActive
    };
  }

  private getRecommendations(): string[] {
    const recommendations: string[] = [];
    
    if (this.config.dryRun) {
      recommendations.push('Run without --dry-run to apply changes');
    }
    
    if (!this.config.preserveAnalysis) {
      recommendations.push('Consider backing up analysis files before removal');
    }
    
    recommendations.push('Test deployment scripts with unified system');
    recommendations.push('Update documentation to reflect new deployment structure');
    recommendations.push('Train team on new unified deployment format');
    
    return recommendations;
  }

  private getNextSteps(): string[] {
    const steps = [
      'Verify all deployment scripts work with unified format',
      'Update CI/CD pipelines to use deployments/unified/',
      'Remove any remaining references to legacy JSON files',
      'Update team documentation and procedures',
      'Consider archiving old migration scripts after verification period'
    ];
    
    if (this.config.dryRun) {
      steps.unshift('Run actual cleanup (remove --dry-run flag)');
    }
    
    return steps;
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private log(message: string): void {
    if (!this.config.quiet) {
      console.log(message);
    }
  }
}

// CLI interface
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  const config: Partial<RunnerConfig> = {
    dryRun: args.includes('--dry-run'),
    skipValidation: args.includes('--skip-validation'),
    preserveAnalysis: args.includes('--preserve-analysis'),
    force: args.includes('--force'),
    quiet: args.includes('--quiet')
  };
  
  // Help text
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Migration Cleanup Runner

Orchestrates the complete migration cleanup process.

Usage: tsx scripts/cleanup/run-migration-cleanup.ts [options]

Options:
  --dry-run             Preview changes without applying them
  --skip-validation     Skip unified system validation
  --preserve-analysis   Keep LevelDB analysis files
  --force               Proceed even if validation fails
  --quiet               Suppress verbose output
  --help, -h            Show this help message

Examples:
  # Preview cleanup (recommended first run)
  tsx scripts/cleanup/run-migration-cleanup.ts --dry-run
  
  # Full cleanup with validation
  tsx scripts/cleanup/run-migration-cleanup.ts
  
  # Cleanup with preserved analysis files
  tsx scripts/cleanup/run-migration-cleanup.ts --preserve-analysis
  
  # Force cleanup without validation (dangerous)
  tsx scripts/cleanup/run-migration-cleanup.ts --force --skip-validation
`);
    return;
  }
  
  console.log('🎛️  CONFIGURATION:');
  console.log(`   Dry Run: ${config.dryRun ? 'ON' : 'OFF'}`);
  console.log(`   Skip Validation: ${config.skipValidation ? 'ON' : 'OFF'}`);
  console.log(`   Preserve Analysis: ${config.preserveAnalysis ? 'ON' : 'OFF'}`);
  console.log(`   Force Mode: ${config.force ? 'ON' : 'OFF'}`);
  console.log(`   Quiet Mode: ${config.quiet ? 'ON' : 'OFF'}`);
  console.log('');
  
  if (config.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }
  
  if (config.force) {
    console.log('⚠️  FORCE MODE - Proceeding without full validation\n');
  }
  
  const runner = new MigrationCleanupRunner(config);
  await runner.run();
}

if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Cleanup runner failed:', error.message);
    process.exit(1);
  });
}

export { MigrationCleanupRunner };