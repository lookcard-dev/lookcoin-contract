#!/usr/bin/env tsx

/**
 * Unified System Validation Script
 * 
 * Validates that the unified JSON deployment system is working properly
 * before proceeding with cleanup operations.
 */

import { promises as fs } from 'fs';
import { join } from 'path';

interface ValidationResult {
  success: boolean;
  checks: ValidationCheck[];
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

interface ValidationCheck {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: string;
}

class UnifiedSystemValidator {
  private checks: ValidationCheck[] = [];
  private rootPath: string;

  constructor() {
    this.rootPath = process.cwd();
  }

  async validate(): Promise<ValidationResult> {
    console.log('🔍 VALIDATING UNIFIED DEPLOYMENT SYSTEM');
    console.log('=====================================\n');

    await this.checkUnifiedDirectory();
    await this.checkUnifiedFiles();
    await this.checkFileIntegrity();
    await this.checkBackupSystem();
    await this.validateContractData();
    await this.checkDependencies();

    const summary = {
      totalChecks: this.checks.length,
      passed: this.checks.filter(c => c.status === 'pass').length,
      failed: this.checks.filter(c => c.status === 'fail').length,
      warnings: this.checks.filter(c => c.status === 'warning').length
    };

    const success = summary.failed === 0;

    console.log('\n📊 VALIDATION SUMMARY');
    console.log('===================');
    console.log(`✅ Passed: ${summary.passed}`);
    console.log(`❌ Failed: ${summary.failed}`);
    console.log(`⚠️  Warnings: ${summary.warnings}`);
    console.log(`📋 Total: ${summary.totalChecks}`);
    console.log(`\n🎯 Overall Status: ${success ? '✅ READY FOR CLEANUP' : '❌ NOT READY'}`);

    return {
      success,
      checks: this.checks,
      summary
    };
  }

  private async checkUnifiedDirectory(): Promise<void> {
    const unifiedPath = join(this.rootPath, 'deployments', 'unified');
    
    try {
      const stats = await fs.stat(unifiedPath);
      if (stats.isDirectory()) {
        this.addCheck('Unified Directory', 'pass', 'Unified deployment directory exists');
      } else {
        this.addCheck('Unified Directory', 'fail', 'Unified path exists but is not a directory');
      }
    } catch {
      this.addCheck('Unified Directory', 'fail', 'Unified deployment directory not found');
    }
  }

  private async checkUnifiedFiles(): Promise<void> {
    const unifiedPath = join(this.rootPath, 'deployments', 'unified');
    const expectedFiles = [
      'bscmainnet.unified.json',
      'bsctestnet.unified.json', 
      'basesepolia.unified.json',
      'optimismsepolia.unified.json',
      'sapphiremainnet.unified.json'
    ];

    let foundFiles = 0;
    let totalFiles = 0;

    try {
      const files = await fs.readdir(unifiedPath);
      totalFiles = files.filter(f => f.endsWith('.unified.json')).length;

      for (const expectedFile of expectedFiles) {
        const filePath = join(unifiedPath, expectedFile);
        try {
          await fs.access(filePath);
          foundFiles++;
        } catch {
          this.addCheck(`Unified File: ${expectedFile}`, 'warning', 'Expected unified file not found');
        }
      }

      if (foundFiles >= 3) {
        this.addCheck('Unified Files', 'pass', `Found ${foundFiles} unified deployment files`);
      } else if (foundFiles > 0) {
        this.addCheck('Unified Files', 'warning', `Only found ${foundFiles} unified files, expected more`);
      } else {
        this.addCheck('Unified Files', 'fail', 'No unified deployment files found');
      }
    } catch {
      this.addCheck('Unified Files', 'fail', 'Cannot read unified directory');
    }
  }

  private async checkFileIntegrity(): Promise<void> {
    const unifiedPath = join(this.rootPath, 'deployments', 'unified');
    
    try {
      const files = await fs.readdir(unifiedPath);
      const unifiedFiles = files.filter(f => f.endsWith('.unified.json'));
      
      let validFiles = 0;
      let totalContracts = 0;

      for (const file of unifiedFiles) {
        const filePath = join(unifiedPath, file);
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const data = JSON.parse(content);
          
          // Check for unified schema format
          if (data.metadata && data.contracts && data.schemaVersion) {
            validFiles++;
            
            // Count contracts - unified format has flat contract structure
            if (data.contracts) {
              // Count core contracts
              if (data.contracts.core) {
                totalContracts += Object.keys(data.contracts.core).length;
              }
              // Count bridge contracts
              if (data.contracts.bridges) {
                totalContracts += Object.keys(data.contracts.bridges).length;
              }
              // Count infrastructure contracts
              if (data.contracts.infrastructure) {
                totalContracts += Object.keys(data.contracts.infrastructure).length;
              }
            }
          }
        } catch (error) {
          this.addCheck(`File Integrity: ${file}`, 'fail', `Invalid JSON or structure: ${error}`);
        }
      }

      if (validFiles === unifiedFiles.length && validFiles > 0) {
        this.addCheck('File Integrity', 'pass', 
          `All ${validFiles} unified files have valid structure with ${totalContracts} total contracts`);
      } else if (validFiles > 0) {
        this.addCheck('File Integrity', 'warning', 
          `${validFiles}/${unifiedFiles.length} files have valid structure`);
      } else {
        this.addCheck('File Integrity', 'fail', 'No files have valid unified structure');
      }
    } catch {
      this.addCheck('File Integrity', 'fail', 'Cannot validate file integrity');
    }
  }

  private async checkBackupSystem(): Promise<void> {
    const backupPath = join(this.rootPath, 'backups');
    
    try {
      const backupExists = await this.pathExists(backupPath);
      if (!backupExists) {
        this.addCheck('Backup System', 'fail', 'Backup directory not found');
        return;
      }

      const backupDirs = await fs.readdir(backupPath);
      const migrationBackups = backupDirs.filter(dir => dir.startsWith('migration-'));
      
      if (migrationBackups.length > 0) {
        // Check latest backup
        const latestBackup = migrationBackups.sort().reverse()[0];
        const manifestPath = join(backupPath, latestBackup, 'BACKUP_MANIFEST.json');
        
        if (await this.pathExists(manifestPath)) {
          try {
            const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
            if (manifest.backupComplete && manifest.verificationPassed) {
              this.addCheck('Backup System', 'pass', 
                `Valid backup found: ${latestBackup}`);
            } else {
              this.addCheck('Backup System', 'warning', 
                'Latest backup may be incomplete or failed verification');
            }
          } catch {
            this.addCheck('Backup System', 'warning', 'Cannot read backup manifest');
          }
        } else {
          this.addCheck('Backup System', 'warning', 'Backup manifest not found');
        }
      } else {
        this.addCheck('Backup System', 'fail', 'No migration backups found');
      }
    } catch {
      this.addCheck('Backup System', 'fail', 'Cannot validate backup system');
    }
  }

  private async validateContractData(): Promise<void> {
    const unifiedPath = join(this.rootPath, 'deployments', 'unified');
    
    try {
      const files = await fs.readdir(unifiedPath);
      const mainnetFiles = files.filter(f => 
        (f.includes('mainnet') || f.includes('bsc')) && f.endsWith('.unified.json')
      );
      
      let validMainnetContracts = 0;

      for (const file of mainnetFiles) {
        const filePath = join(unifiedPath, file);
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const data = JSON.parse(content);
          
          // Check for essential contracts in unified format
          if (data.contracts && data.contracts.core) {
            const contracts = data.contracts.core;
            if (contracts.LookCoin && contracts.LookCoin.address) {
              validMainnetContracts++;
            }
          }
        } catch {
          // Skip invalid files
        }
      }

      if (validMainnetContracts > 0) {
        this.addCheck('Contract Data', 'pass', 
          `Found valid contract deployments in ${validMainnetContracts} mainnet files`);
      } else if (mainnetFiles.length > 0) {
        this.addCheck('Contract Data', 'warning', 
          'Mainnet files found but no valid contract addresses detected');
      } else {
        this.addCheck('Contract Data', 'warning', 
          'No mainnet deployment files found - may be testnet only');
      }
    } catch {
      this.addCheck('Contract Data', 'fail', 'Cannot validate contract data');
    }
  }

  private async checkDependencies(): Promise<void> {
    try {
      // Check if we can load the state manager
      const stateManagerPath = join(this.rootPath, 'scripts', 'utils', 'state.ts');
      if (await this.pathExists(stateManagerPath)) {
        this.addCheck('Dependencies', 'pass', 'State management utilities available');
      } else {
        this.addCheck('Dependencies', 'warning', 'State management utilities not found');
      }

      // Check if package.json is valid
      const packagePath = join(this.rootPath, 'package.json');
      if (await this.pathExists(packagePath)) {
        const packageContent = await fs.readFile(packagePath, 'utf8');
        const packageJson = JSON.parse(packageContent);
        
        if (packageJson.dependencies) {
          this.addCheck('Package Dependencies', 'pass', 'Package.json is valid');
        } else {
          this.addCheck('Package Dependencies', 'warning', 'Package.json missing dependencies');
        }
      } else {
        this.addCheck('Package Dependencies', 'fail', 'Package.json not found');
      }
    } catch (error) {
      this.addCheck('Dependencies', 'fail', `Dependency check failed: ${error}`);
    }
  }

  private addCheck(name: string, status: 'pass' | 'fail' | 'warning', message: string, details?: string): void {
    this.checks.push({ name, status, message, details });
    
    const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️ ';
    console.log(`${icon} ${name}: ${message}`);
    
    if (details) {
      console.log(`   ${details}`);
    }
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}

// Main execution
async function main(): Promise<void> {
  const validator = new UnifiedSystemValidator();
  const result = await validator.validate();
  
  // Write validation report
  const reportPath = join(process.cwd(), `unified-validation-${Date.now()}.json`);
  await fs.writeFile(reportPath, JSON.stringify(result, null, 2));
  
  console.log(`\n📄 Validation report saved: ${reportPath}`);
  
  process.exit(result.success ? 0 : 1);
}

if (require.main === module) {
  main().catch(console.error);
}

export { UnifiedSystemValidator };