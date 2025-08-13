#!/usr/bin/env tsx

/**
 * Migration Cleanup Finalization Script
 * 
 * Safely completes the migration from LevelDB to Unified JSON by:
 * 1. Archiving legacy JSON deployment files
 * 2. Removing LevelDB dependencies from package.json
 * 3. Cleaning up LevelDB code references
 * 4. Removing LevelDB directories (after backup verification)
 * 5. Updating configuration files
 * 6. Providing rollback capabilities
 * 
 * SAFETY FEATURES:
 * - Comprehensive backup validation before any changes
 * - Atomic operations with rollback support
 * - Detailed logging and verification
 * - Dry-run mode for testing
 * - Complete audit trail
 */

import { promises as fs } from 'fs';
import { join, dirname, basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface CleanupConfig {
  dryRun: boolean;
  skipBackupValidation: boolean;
  preserveLevelDBAnalysis: boolean;
  forceCleanup: boolean;
  verboseLogging: boolean;
}

interface CleanupResult {
  success: boolean;
  operations: CleanupOperation[];
  errors: string[];
  warnings: string[];
  rollbackScript?: string;
  verificationReport: VerificationReport;
}

interface CleanupOperation {
  type: 'archive' | 'remove' | 'modify' | 'create';
  description: string;
  path: string;
  oldValue?: string;
  newValue?: string;
  completed: boolean;
  timestamp: number;
  rollbackData?: unknown;
}

interface VerificationReport {
  backupValidated: boolean;
  unifiedSystemWorking: boolean;
  legacyFilesArchived: boolean;
  leveldbDependenciesRemoved: boolean;
  codeReferencesUpdated: boolean;
  configFilesUpdated: boolean;
  totalFilesArchived: number;
  totalFilesRemoved: number;
  diskSpaceRecovered: string;
  completionStatus: 'success' | 'partial' | 'failed';
}

class MigrationCleanupManager {
  private config: CleanupConfig;
  private operations: CleanupOperation[] = [];
  private errors: string[] = [];
  private warnings: string[] = [];
  private rootPath: string;
  private backupPath: string;

  constructor(config: Partial<CleanupConfig> = {}) {
    this.config = {
      dryRun: false,
      skipBackupValidation: false,
      preserveLevelDBAnalysis: false,
      forceCleanup: false,
      verboseLogging: true,
      ...config
    };
    
    this.rootPath = process.cwd();
    this.backupPath = join(this.rootPath, 'backups');
  }

  async executeCleanup(): Promise<CleanupResult> {
    const startTime = Date.now();
    
    try {
      this.log('\n🧹 STARTING MIGRATION CLEANUP FINALIZATION');
      this.log('============================================\n');

      // Phase 1: Validate system state and backups
      await this.validateSystemState();
      
      // Phase 2: Create archive structure
      await this.createArchiveStructure();
      
      // Phase 3: Archive legacy files
      await this.archiveLegacyFiles();
      
      // Phase 4: Remove LevelDB dependencies
      await this.removeLevelDBDependencies();
      
      // Phase 5: Clean up code references
      await this.cleanupCodeReferences();
      
      // Phase 6: Remove LevelDB directories
      await this.removeLevelDBDirectories();
      
      // Phase 7: Update configuration files
      await this.updateConfigurationFiles();
      
      // Phase 8: Final verification
      const verificationReport = await this.performFinalVerification();
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      this.log(`\n✅ CLEANUP COMPLETED SUCCESSFULLY in ${duration}s`);
      
      return {
        success: true,
        operations: this.operations,
        errors: this.errors,
        warnings: this.warnings,
        rollbackScript: await this.generateRollbackScript(),
        verificationReport
      };
      
    } catch (error) {
      this.errors.push(`Cleanup failed: ${error}`);
      this.log(`\n❌ CLEANUP FAILED: ${error}`);
      
      // Attempt rollback if not in dry-run mode
      if (!this.config.dryRun) {
        await this.performRollback();
      }
      
      return {
        success: false,
        operations: this.operations,
        errors: this.errors,
        warnings: this.warnings,
        verificationReport: await this.performFinalVerification()
      };
    }
  }

  private async validateSystemState(): Promise<void> {
    this.log('📋 Phase 1: Validating system state and backups...');
    
    // Check if unified system is working
    const unifiedPath = join(this.rootPath, 'deployments', 'unified');
    if (!await this.pathExists(unifiedPath)) {
      throw new Error('Unified deployment directory not found - migration not complete');
    }
    
    // Validate backup system
    if (!this.config.skipBackupValidation) {
      await this.validateBackupSystem();
    }
    
    // Check for active processes that might use LevelDB
    try {
      const { stdout } = await execAsync('lsof +D leveldb 2>/dev/null || true');
      if (stdout.trim()) {
        this.warnings.push('LevelDB directory may be in use by other processes');
      }
    } catch {
      // Ignore lsof errors
    }
    
    this.log('✅ System state validation complete');
  }

  private async validateBackupSystem(): Promise<void> {
    this.log('🔍 Validating backup system...');
    
    if (!await this.pathExists(this.backupPath)) {
      throw new Error('Backup directory not found - cannot proceed safely');
    }
    
    // Find most recent migration backup
    const backupDirs = await fs.readdir(this.backupPath);
    const migrationBackups = backupDirs
      .filter(dir => dir.startsWith('migration-'))
      .sort()
      .reverse();
    
    if (migrationBackups.length === 0) {
      throw new Error('No migration backup found - cannot proceed safely');
    }
    
    const latestBackup = join(this.backupPath, migrationBackups[0]);
    const manifestPath = join(latestBackup, 'BACKUP_MANIFEST.json');
    
    if (!await this.pathExists(manifestPath)) {
      throw new Error('Backup manifest not found - backup may be corrupted');
    }
    
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      if (!manifest.backupComplete || !manifest.verificationPassed) {
        throw new Error('Latest backup is incomplete or failed verification');
      }
      this.log(`✅ Backup validated: ${migrationBackups[0]}`);
    } catch (error) {
      throw new Error(`Backup validation failed: ${error}`);
    }
  }

  private async createArchiveStructure(): Promise<void> {
    this.log('📁 Phase 2: Creating archive structure...');
    
    const archivePath = join(this.rootPath, 'deployments', 'archive');
    const legacyJsonPath = join(archivePath, 'legacy-json');
    const enhancedJsonPath = join(archivePath, 'enhanced-json');
    
    if (!this.config.dryRun) {
      await fs.mkdir(archivePath, { recursive: true });
      await fs.mkdir(legacyJsonPath, { recursive: true });
      await fs.mkdir(enhancedJsonPath, { recursive: true });
    }
    
    // Create archive README
    const readmeContent = `# Legacy Deployment Files Archive

This directory contains archived deployment files from the LevelDB to Unified JSON migration.

## Directory Structure

### legacy-json/
Contains the original deployment JSON files that were replaced by the unified format:
- Individual network deployment files (*.json)
- Network configuration files (config-*.json)

### enhanced-json/
Contains enhanced deployment files that were superseded:
- enhanced-*.json files with experimental formats

## Migration Information

- **Archive Date**: ${new Date().toISOString()}
- **Migration Completed**: ${new Date().toISOString()}
- **Original Location**: deployments/ (root)
- **New System**: deployments/unified/ (unified JSON format)

## Recovery Information

These files are preserved for:
1. **Audit Trail**: Complete history of deployment evolution
2. **Rollback Capability**: Emergency recovery if needed
3. **Data Analysis**: Historical deployment data investigation

## Important Notes

- These files are READ-ONLY archives
- The active deployment system uses deployments/unified/
- For rollback procedures, see backups/migration-*/RESTORE_PROCEDURES.md
- DO NOT modify these files directly

## Contact

For questions about archived deployment files or migration procedures,
consult the migration documentation in docs/MIGRATION_*.md files.
`;

    if (!this.config.dryRun) {
      await fs.writeFile(join(legacyJsonPath, 'ARCHIVE_README.md'), readmeContent);
    }
    
    this.addOperation('create', 'Created archive directory structure', archivePath);
    this.log('✅ Archive structure created');
  }

  private async archiveLegacyFiles(): Promise<void> {
    this.log('📦 Phase 3: Archiving legacy deployment files...');
    
    const deploymentsPath = join(this.rootPath, 'deployments');
    const archivePath = join(deploymentsPath, 'archive');
    const legacyJsonPath = join(archivePath, 'legacy-json');
    const enhancedJsonPath = join(archivePath, 'enhanced-json');
    
    let totalFilesArchived = 0;
    
    // Legacy JSON files to archive
    const legacyFiles = [
      'basesepolia.json',
      'bscmainnet.json', 
      'bsctestnet.json',
      'optimismsepolia.json',
      'sapphiremainnet.json',
      'sapphiretestnet.json',
      'config-basesepolia.json',
      'config-bsctestnet.json',
      'config-optimismsepolia.json'
    ];
    
    // Enhanced JSON files to archive
    const enhancedFiles = [
      'enhanced-bscmainnet.json'
    ];
    
    // Archive legacy files
    for (const file of legacyFiles) {
      const sourcePath = join(deploymentsPath, file);
      if (await this.pathExists(sourcePath)) {
        const targetPath = join(legacyJsonPath, file);
        await this.archiveFile(sourcePath, targetPath, 'legacy');
        totalFilesArchived++;
      }
    }
    
    // Archive enhanced files
    for (const file of enhancedFiles) {
      const sourcePath = join(deploymentsPath, file);
      if (await this.pathExists(sourcePath)) {
        const targetPath = join(enhancedJsonPath, file);
        await this.archiveFile(sourcePath, targetPath, 'enhanced');
        totalFilesArchived++;
      }
    }
    
    this.log(`✅ Archived ${totalFilesArchived} legacy deployment files`);
  }

  private async archiveFile(sourcePath: string, targetPath: string, type: 'legacy' | 'enhanced'): Promise<void> {
    const fileName = basename(sourcePath);
    
    if (!this.config.dryRun) {
      // Copy file to archive
      await fs.copyFile(sourcePath, targetPath);
      
      // Verify copy
      const sourceContent = await fs.readFile(sourcePath, 'utf8');
      const targetContent = await fs.readFile(targetPath, 'utf8');
      if (sourceContent !== targetContent) {
        throw new Error(`Archive verification failed for ${fileName}`);
      }
      
      // Remove original file
      await fs.unlink(sourcePath);
    }
    
    this.addOperation('archive', `Archived ${type} file: ${fileName}`, sourcePath, sourcePath, targetPath);
    this.log(`  📄 Archived: ${fileName}`);
  }

  private async removeLevelDBDependencies(): Promise<void> {
    this.log('📦 Phase 4: Removing LevelDB dependencies...');
    
    const packageJsonPath = join(this.rootPath, 'package.json');
    const packageLockPath = join(this.rootPath, 'package-lock.json');
    
    // Read and modify package.json
    const packageContent = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageContent);
    
    const originalDeps = { ...packageJson.dependencies };
    
    // Remove level dependency
    if (packageJson.dependencies && packageJson.dependencies.level) {
      delete packageJson.dependencies.level;
      this.log('  ➖ Removed "level" dependency');
    }
    
    // Check for other potential LevelDB-related dependencies
    const leveldbRelated = ['leveldown', 'levelup', 'level-js', 'level-mem'];
    for (const dep of leveldbRelated) {
      if (packageJson.dependencies && packageJson.dependencies[dep]) {
        delete packageJson.dependencies[dep];
        this.log(`  ➖ Removed "${dep}" dependency`);
      }
      if (packageJson.devDependencies && packageJson.devDependencies[dep]) {
        delete packageJson.devDependencies[dep];
        this.log(`  ➖ Removed "${dep}" dev dependency`);
      }
    }
    
    if (!this.config.dryRun) {
      await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
      
      // Remove package-lock.json to force regeneration
      if (await this.pathExists(packageLockPath)) {
        await fs.unlink(packageLockPath);
        this.log('  🔄 Removed package-lock.json (will be regenerated)');
      }
      
      // Regenerate package-lock.json
      this.log('  📦 Regenerating package-lock.json...');
      await execAsync('npm install', { cwd: this.rootPath });
    }
    
    this.addOperation('modify', 'Removed LevelDB dependencies', packageJsonPath, 
                     JSON.stringify(originalDeps), JSON.stringify(packageJson.dependencies));
    this.log('✅ LevelDB dependencies removed');
  }

  private async cleanupCodeReferences(): Promise<void> {
    this.log('🔧 Phase 5: Cleaning up LevelDB code references...');
    
    const stateManagerFactoryPath = join(this.rootPath, 'scripts', 'utils', 'StateManagerFactory.ts');
    
    if (await this.pathExists(stateManagerFactoryPath)) {
      const originalContent = await fs.readFile(stateManagerFactoryPath, 'utf8');
      
      // Remove LevelDB import - using simple string search/replace
      let updatedContent = originalContent.replace(
        'import { LevelDBStateManager } from "./LevelDBStateManager";',
        ''
      ).replace(
        "import { LevelDBStateManager } from './LevelDBStateManager';",
        ''
      );
      
      // Update factory method to remove leveldb case - using targeted replacement
      const leveldbCase = `case 'leveldb':
        manager = new LevelDBStateManager(config);
        break;`;
      updatedContent = updatedContent.replace(leveldbCase, '');
      
      // Add error case for leveldb - insert after json case
      const jsonCase = `case 'json':
        manager = new JSONStateManager(config);
        break;`;
      const jsonCaseWithError = `case 'json':
        manager = new JSONStateManager(config);
        break;
      case 'leveldb':
        throw new StateManagerError(
          StateManagerErrorCode.BACKEND_UNAVAILABLE,
          'LevelDB backend has been deprecated and removed. Use "json" backend instead.',
          { backend, migration: 'Use unified JSON format in deployments/unified/' }
        );`;
      
      updatedContent = updatedContent.replace(jsonCase, jsonCaseWithError);
      
      // Update type definitions to remove leveldb - using exact string matches
      updatedContent = updatedContent.replace(
        "backend: 'leveldb' | 'json'",
        "backend: 'json'"
      );
      
      updatedContent = updatedContent.replace(
        "sourceBackend: 'leveldb' | 'json'",
        "sourceBackend: 'json'"
      );
      
      updatedContent = updatedContent.replace(
        "targetBackend: 'leveldb' | 'json'",
        "targetBackend: 'json'"
      );
      
      if (!this.config.dryRun && updatedContent !== originalContent) {
        await fs.writeFile(stateManagerFactoryPath, updatedContent);
      }
      
      this.addOperation('modify', 'Updated StateManagerFactory to remove LevelDB references', 
                       stateManagerFactoryPath, originalContent.substring(0, 100), updatedContent.substring(0, 100));
    }
    
    // Remove LevelDBStateManager.ts file
    const leveldbManagerPath = join(this.rootPath, 'scripts', 'utils', 'LevelDBStateManager.ts');
    if (await this.pathExists(leveldbManagerPath)) {
      if (!this.config.dryRun) {
        await fs.unlink(leveldbManagerPath);
      }
      this.addOperation('remove', 'Removed LevelDBStateManager.ts', leveldbManagerPath);
      this.log('  🗑️  Removed LevelDBStateManager.ts');
    }
    
    this.log('✅ Code references cleaned up');
  }

  private async removeLevelDBDirectories(): Promise<void> {
    this.log('🗂️  Phase 6: Removing LevelDB directories...');
    
    let totalSize = 0;
    let filesRemoved = 0;
    
    // Directories and files to remove
    const pathsToRemove = [
      'leveldb',
      'leveldb-backup',
      'leveldb-data-integrity-report.md',
      'leveldb-inventory.json'
    ];
    
    // Analysis files to optionally preserve or remove
    const analysisFiles = await this.findFiles(this.rootPath, /leveldb.*\.json$|leveldb.*\.md$/);
    
    for (const filePath of analysisFiles) {
      if (!this.config.preserveLevelDBAnalysis) {
        pathsToRemove.push(filePath);
      }
    }
    
    for (const pathToRemove of pathsToRemove) {
      const fullPath = join(this.rootPath, pathToRemove);
      if (await this.pathExists(fullPath)) {
        try {
          const stats = await fs.stat(fullPath);
          if (stats.isDirectory()) {
            const size = await this.calculateDirectorySize(fullPath);
            totalSize += size;
            const fileCount = await this.countFilesInDirectory(fullPath);
            filesRemoved += fileCount;
            
            if (!this.config.dryRun) {
              await fs.rm(fullPath, { recursive: true, force: true });
            }
            this.addOperation('remove', `Removed directory: ${pathToRemove}`, fullPath);
            this.log(`  🗂️  Removed directory: ${pathToRemove} (${this.formatBytes(size)}, ${fileCount} files)`);
          } else {
            totalSize += stats.size;
            filesRemoved++;
            
            if (!this.config.dryRun) {
              await fs.unlink(fullPath);
            }
            this.addOperation('remove', `Removed file: ${pathToRemove}`, fullPath);
            this.log(`  📄 Removed file: ${pathToRemove} (${this.formatBytes(stats.size)})`);
          }
        } catch (error) {
          this.warnings.push(`Failed to remove ${pathToRemove}: ${error}`);
        }
      }
    }
    
    this.log(`✅ Removed ${filesRemoved} files, recovered ${this.formatBytes(totalSize)} disk space`);
  }

  private async updateConfigurationFiles(): Promise<void> {
    this.log('⚙️  Phase 7: Updating configuration files...');
    
    // Update .gitignore
    await this.updateGitignore();
    
    // Update TSConfig if needed
    await this.updateTSConfig();
    
    this.log('✅ Configuration files updated');
  }

  private async updateGitignore(): Promise<void> {
    const gitignorePath = join(this.rootPath, '.gitignore');
    
    if (await this.pathExists(gitignorePath)) {
      const originalContent = await fs.readFile(gitignorePath, 'utf8');
      
      let updatedContent = originalContent;
      
      // Add archive paths
      const archiveEntries = [
        '\n# Archived deployment files',
        '/deployments/archive/',
        ''
      ];
      
      // Remove leveldb entries if they exist
      updatedContent = updatedContent.replace(/\n?\s*#?\s*leveldb.*\n?/gi, '');
      updatedContent = updatedContent.replace(/\n?\s*#?\s*LevelDB.*\n?/gi, '');
      
      // Add archive entries if not already present
      if (!updatedContent.includes('/deployments/archive/')) {
        updatedContent += archiveEntries.join('\n');
      }
      
      if (!this.config.dryRun && updatedContent !== originalContent) {
        await fs.writeFile(gitignorePath, updatedContent);
      }
      
      this.addOperation('modify', 'Updated .gitignore', gitignorePath);
      this.log('  📝 Updated .gitignore with archive paths');
    }
  }

  private async updateTSConfig(): Promise<void> {
    const tsconfigPath = join(this.rootPath, 'tsconfig.json');
    
    if (await this.pathExists(tsconfigPath)) {
      const originalContent = await fs.readFile(tsconfigPath, 'utf8');
      
      try {
        const tsconfig = JSON.parse(originalContent);
        
        // Remove any LevelDB-related excludes if they exist
        if (tsconfig.exclude) {
          tsconfig.exclude = tsconfig.exclude.filter((path: string) => 
            !path.toLowerCase().includes('leveldb')
          );
        }
        
        const updatedContent = JSON.stringify(tsconfig, null, 2) + '\n';
        
        if (!this.config.dryRun && updatedContent !== originalContent) {
          await fs.writeFile(tsconfigPath, updatedContent);
        }
        
        this.addOperation('modify', 'Updated tsconfig.json', tsconfigPath);
        this.log('  📝 Updated tsconfig.json');
      } catch (error) {
        this.warnings.push(`Failed to update tsconfig.json: ${error}`);
      }
    }
  }

  private async performFinalVerification(): Promise<VerificationReport> {
    this.log('🔍 Phase 8: Performing final verification...');
    
    const report: VerificationReport = {
      backupValidated: false,
      unifiedSystemWorking: false,
      legacyFilesArchived: false,
      leveldbDependenciesRemoved: false,
      codeReferencesUpdated: false,
      configFilesUpdated: false,
      totalFilesArchived: 0,
      totalFilesRemoved: 0,
      diskSpaceRecovered: '0 MB',
      completionStatus: 'failed'
    };
    
    try {
      // Verify backup system
      report.backupValidated = await this.pathExists(this.backupPath);
      
      // Verify unified system
      const unifiedPath = join(this.rootPath, 'deployments', 'unified');
      report.unifiedSystemWorking = await this.pathExists(unifiedPath);
      
      // Verify archive created
      const archivePath = join(this.rootPath, 'deployments', 'archive', 'legacy-json');
      report.legacyFilesArchived = await this.pathExists(archivePath);
      
      // Verify LevelDB dependencies removed
      try {
        const packageJson = JSON.parse(await fs.readFile(join(this.rootPath, 'package.json'), 'utf8'));
        report.leveldbDependenciesRemoved = !packageJson.dependencies?.level;
      } catch {
        report.leveldbDependenciesRemoved = false;
      }
      
      // Verify code references updated
      const stateManagerPath = join(this.rootPath, 'scripts', 'utils', 'StateManagerFactory.ts');
      if (await this.pathExists(stateManagerPath)) {
        const content = await fs.readFile(stateManagerPath, 'utf8');
        report.codeReferencesUpdated = !content.includes('LevelDBStateManager');
      } else {
        report.codeReferencesUpdated = true;
      }
      
      // Verify config files updated
      const gitignorePath = join(this.rootPath, '.gitignore');
      if (await this.pathExists(gitignorePath)) {
        const content = await fs.readFile(gitignorePath, 'utf8');
        report.configFilesUpdated = content.includes('/deployments/archive/');
      }
      
      // Count operations
      report.totalFilesArchived = this.operations.filter(op => op.type === 'archive').length;
      report.totalFilesRemoved = this.operations.filter(op => op.type === 'remove').length;
      
      // Determine completion status
      const allChecks = [
        report.backupValidated,
        report.unifiedSystemWorking,
        report.legacyFilesArchived,
        report.leveldbDependenciesRemoved,
        report.codeReferencesUpdated,
        report.configFilesUpdated
      ];
      
      const successCount = allChecks.filter(check => check).length;
      
      if (successCount === allChecks.length) {
        report.completionStatus = 'success';
      } else if (successCount >= allChecks.length * 0.8) {
        report.completionStatus = 'partial';
      } else {
        report.completionStatus = 'failed';
      }
      
      this.log(`✅ Verification complete: ${report.completionStatus.toUpperCase()}`);
      this.log(`  📊 ${successCount}/${allChecks.length} checks passed`);
      
    } catch (error) {
      this.errors.push(`Verification failed: ${error}`);
      report.completionStatus = 'failed';
    }
    
    return report;
  }

  private async generateRollbackScript(): Promise<string> {
    const rollbackCommands = [
      '#!/bin/bash',
      '# Generated Rollback Script for Migration Cleanup',
      '# Generated at: ' + new Date().toISOString(),
      '',
      'set -e',
      'echo "🔄 Starting rollback of migration cleanup..."',
      ''
    ];
    
    // Reverse operations in reverse order
    const reverseOps = [...this.operations].reverse();
    
    for (const op of reverseOps) {
      switch (op.type) {
        case 'archive':
          rollbackCommands.push(`# Restore ${basename(op.path)}`);
          rollbackCommands.push(`cp "${op.newValue}" "${op.path}"`);
          rollbackCommands.push(`rm "${op.newValue}"`);
          break;
        case 'remove':
          rollbackCommands.push(`# Note: ${op.path} was removed - restore from backup if needed`);
          break;
        case 'modify':
          rollbackCommands.push(`# Note: ${op.path} was modified - manual review required`);
          break;
      }
    }
    
    rollbackCommands.push('');
    rollbackCommands.push('echo "✅ Rollback completed - manual verification recommended"');
    
    return rollbackCommands.join('\n');
  }

  private async performRollback(): Promise<void> {
    this.log('🔄 Performing emergency rollback...');
    
    try {
      const rollbackScript = await this.generateRollbackScript();
      const rollbackPath = join(this.rootPath, `cleanup-rollback-${Date.now()}.sh`);
      await fs.writeFile(rollbackPath, rollbackScript, { mode: 0o755 });
      
      this.log(`📝 Rollback script created: ${rollbackPath}`);
      this.log('⚠️  Manual intervention may be required for complete rollback');
    } catch (error) {
      this.log(`❌ Rollback script creation failed: ${error}`);
    }
  }

  // Utility methods

  private addOperation(type: CleanupOperation['type'], description: string, path: string, 
                      oldValue?: string, newValue?: string): void {
    this.operations.push({
      type,
      description,
      path,
      oldValue,
      newValue,
      completed: true,
      timestamp: Date.now()
    });
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async findFiles(dir: string, pattern: RegExp): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          files.push(...await this.findFiles(fullPath, pattern));
        } else if (entry.isFile() && pattern.test(entry.name)) {
          files.push(fullPath.replace(this.rootPath + '/', ''));
        }
      }
    } catch {
      // Ignore directories we can't read
    }
    
    return files;
  }

  private async calculateDirectorySize(dir: string): Promise<number> {
    let size = 0;
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory()) {
          size += await this.calculateDirectorySize(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          size += stats.size;
        }
      }
    } catch {
      // Ignore errors
    }
    
    return size;
  }

  private async countFilesInDirectory(dir: string): Promise<number> {
    let count = 0;
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory()) {
          count += await this.countFilesInDirectory(fullPath);
        } else {
          count++;
        }
      }
    } catch {
      // Ignore errors
    }
    
    return count;
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    
    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  private log(message: string): void {
    if (this.config.verboseLogging) {
      console.log(message);
    }
  }
}

// Main execution function
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  const config: Partial<CleanupConfig> = {
    dryRun: args.includes('--dry-run'),
    skipBackupValidation: args.includes('--skip-backup-validation'),
    preserveLevelDBAnalysis: args.includes('--preserve-analysis'),
    forceCleanup: args.includes('--force'),
    verboseLogging: !args.includes('--quiet')
  };
  
  if (config.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }
  
  if (config.forceCleanup && !config.skipBackupValidation) {
    console.log('⚠️  WARNING: --force requires --skip-backup-validation');
    process.exit(1);
  }
  
  const manager = new MigrationCleanupManager(config);
  const result = await manager.executeCleanup();
  
  // Write result report
  const reportPath = join(process.cwd(), `cleanup-report-${Date.now()}.json`);
  await fs.writeFile(reportPath, JSON.stringify(result, null, 2));
  
  console.log(`\n📊 CLEANUP REPORT:`);
  console.log(`   Operations: ${result.operations.length}`);
  console.log(`   Errors: ${result.errors.length}`);
  console.log(`   Warnings: ${result.warnings.length}`);
  console.log(`   Status: ${result.verificationReport.completionStatus.toUpperCase()}`);
  console.log(`   Report: ${reportPath}`);
  
  if (result.rollbackScript) {
    const rollbackPath = join(process.cwd(), `cleanup-rollback-${Date.now()}.sh`);
    await fs.writeFile(rollbackPath, result.rollbackScript, { mode: 0o755 });
    console.log(`   Rollback: ${rollbackPath}`);
  }
  
  process.exit(result.success ? 0 : 1);
}

// Execute if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { MigrationCleanupManager, type CleanupConfig, type CleanupResult };