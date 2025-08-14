#!/usr/bin/env tsx

/**
 * Backup Integrity Verification Utility
 * 
 * Verifies the integrity and completeness of migration backups
 * Provides detailed analysis and recommendations
 * 
 * @author DevOps Specialist
 * @version 1.0.0
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';

interface VerificationReport {
  backupId: string;
  verificationTimestamp: string;
  status: 'PASSED' | 'FAILED' | 'WARNING';
  summary: {
    totalFilesExpected: number;
    totalFilesFound: number;
    totalSizeExpected: number;
    totalSizeActual: number;
    checksumsVerified: number;
    checksumFailures: number;
  };
  categories: Record<string, CategoryVerification>;
  issues: Issue[];
  recommendations: string[];
}

interface CategoryVerification {
  expected: boolean;
  found: boolean;
  filesExpected: number;
  filesFound: number;
  sizeExpected: number;
  sizeActual: number;
  checksumsPassed: number;
  checksumsFailed: number;
  issues: string[];
}

interface Issue {
  severity: 'ERROR' | 'WARNING' | 'INFO';
  category: string;
  description: string;
  affectedFiles?: string[];
}

class BackupIntegrityVerifier {
  private readonly projectRoot: string;
  private readonly backupId: string;
  private readonly backupRoot: string;
  private report: VerificationReport;

  constructor(backupId?: string) {
    this.projectRoot = process.cwd();
    
    // If no backup ID provided, find the most recent backup
    this.backupId = backupId || this.findLatestBackup();
    this.backupRoot = path.join(this.projectRoot, 'backups', this.backupId);
    
    this.report = {
      backupId: this.backupId,
      verificationTimestamp: new Date().toISOString(),
      status: 'PASSED',
      summary: {
        totalFilesExpected: 0,
        totalFilesFound: 0,
        totalSizeExpected: 0,
        totalSizeActual: 0,
        checksumsVerified: 0,
        checksumFailures: 0
      },
      categories: {},
      issues: [],
      recommendations: []
    };
  }

  /**
   * Execute comprehensive backup verification
   */
  async execute(): Promise<VerificationReport> {
    console.log('🔍 Starting Backup Integrity Verification');
    console.log(`📁 Backup ID: ${this.backupId}`);
    console.log(`📂 Backup Location: ${this.backupRoot}`);
    console.log('');

    try {
      // Verify backup exists
      await this.verifyBackupExists();
      
      // Load and verify manifest
      await this.verifyManifest();
      
      // Verify directory structure
      await this.verifyDirectoryStructure();
      
      // Verify file integrity
      await this.verifyFileIntegrity();
      
      // Verify checksums
      await this.verifyChecksums();
      
      // Verify restoration procedures
      await this.verifyRestorationProcedures();
      
      // Generate recommendations
      await this.generateRecommendations();
      
      // Determine overall status
      this.determineOverallStatus();
      
      // Display results
      await this.displayVerificationResults();
      
      // Save verification report
      await this.saveVerificationReport();
      
      return this.report;
      
    } catch (error) {
      this.addIssue('ERROR', 'system', `Verification failed: ${error}`);
      this.report.status = 'FAILED';
      console.error('❌ Verification Failed:', error);
      throw error;
    }
  }

  /**
   * Find the latest backup if none specified
   */
  private findLatestBackup(): string {
    const backupsDir = path.join(this.projectRoot, 'backups');
    
    try {
      const backups = fsSync.readdirSync(backupsDir)
        .filter((name: string) => name.startsWith('migration-'))
        .sort()
        .reverse();
      
      if (backups.length === 0) {
        throw new Error('No migration backups found');
      }
      
      return backups[0];
    } catch (error) {
      throw new Error(`Backups directory not accessible: ${error}`);
    }
  }

  /**
   * Verify backup directory exists and is accessible
   */
  private async verifyBackupExists(): Promise<void> {
    try {
      const stats = await fs.stat(this.backupRoot);
      if (!stats.isDirectory()) {
        throw new Error('Backup path exists but is not a directory');
      }
    } catch {
      throw new Error(`Backup directory not found: ${this.backupRoot}`);
    }
  }

  /**
   * Load and verify backup manifest
   */
  private async verifyManifest(): Promise<void> {
    const manifestPath = path.join(this.backupRoot, 'BACKUP_MANIFEST.json');
    
    try {
      const manifestContent = await fs.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(manifestContent);
      
      // Verify manifest structure
      const requiredFields = ['timestamp', 'backupId', 'version', 'totalFiles', 'totalSize', 'categories'];
      for (const field of requiredFields) {
        if (!(field in manifest)) {
          this.addIssue('ERROR', 'manifest', `Missing required field: ${field}`);
        }
      }
      
      // Verify backup ID matches
      if (manifest.backupId !== this.backupId) {
        this.addIssue('WARNING', 'manifest', `Manifest backup ID (${manifest.backupId}) doesn't match expected (${this.backupId})`);
      }
      
      // Load expected statistics
      this.report.summary.totalFilesExpected = manifest.totalFiles;
      this.report.summary.totalSizeExpected = manifest.totalSize;
      
      // Initialize category verifications
      for (const [categoryName, categoryData] of Object.entries(manifest.categories as Record<string, { files: number; sizeBytes: number }>)) {
        const typedCategoryData = categoryData as { files: number; sizeBytes: number };
        this.report.categories[categoryName] = {
          expected: true,
          found: false,
          filesExpected: typedCategoryData.files,
          filesFound: 0,
          sizeExpected: typedCategoryData.sizeBytes,
          sizeActual: 0,
          checksumsPassed: 0,
          checksumsFailed: 0,
          issues: []
        };
      }
      
    } catch (error) {
      this.addIssue('ERROR', 'manifest', `Failed to load manifest: ${error}`);
    }
  }

  /**
   * Verify backup directory structure
   */
  private async verifyDirectoryStructure(): Promise<void> {
    const expectedDirs = ['leveldb', 'legacy-json', 'unified-json', 'configs', 'scripts', 'docs', 'checksums'];
    
    for (const dir of expectedDirs) {
      const dirPath = path.join(this.backupRoot, dir);
      
      try {
        const stats = await fs.stat(dirPath);
        if (stats.isDirectory()) {
          if (this.report.categories[dir]) {
            this.report.categories[dir].found = true;
          }
        } else {
          this.addIssue('ERROR', dir, `Expected directory but found file: ${dir}`);
        }
      } catch {
        this.addIssue('ERROR', dir, `Required directory missing: ${dir}`);
        if (this.report.categories[dir]) {
          this.report.categories[dir].found = false;
        }
      }
    }
    
    // Verify critical files exist
    const criticalFiles = [
      'BACKUP_MANIFEST.json',
      'RESTORE_PROCEDURES.md',
      'EMERGENCY_ROLLBACK.sh',
      'checksums/SHA256SUMS'
    ];
    
    for (const file of criticalFiles) {
      const filePath = path.join(this.backupRoot, file);
      try {
        await fs.access(filePath);
      } catch {
        this.addIssue('ERROR', 'structure', `Critical file missing: ${file}`);
      }
    }
  }

  /**
   * Verify file integrity and collect statistics
   */
  private async verifyFileIntegrity(): Promise<void> {
    for (const [categoryName, category] of Object.entries(this.report.categories)) {
      if (!category.found) continue;
      
      const categoryPath = path.join(this.backupRoot, categoryName);
      
      try {
        const stats = await this.collectDirectoryStats(categoryPath);
        category.filesFound = stats.files;
        category.sizeActual = stats.sizeBytes;
        
        this.report.summary.totalFilesFound += stats.files;
        this.report.summary.totalSizeActual += stats.sizeBytes;
        
        // Check if files match expectations
        if (category.filesFound !== category.filesExpected) {
          const difference = category.filesFound - category.filesExpected;
          const severity = Math.abs(difference) > category.filesExpected * 0.1 ? 'ERROR' : 'WARNING';
          this.addIssue(severity, categoryName, 
            `File count mismatch: expected ${category.filesExpected}, found ${category.filesFound} (difference: ${difference > 0 ? '+' : ''}${difference})`);
        }
        
        // Check if size is reasonable (within 10% of expected)
        const sizeDeviation = Math.abs(category.sizeActual - category.sizeExpected) / category.sizeExpected;
        if (sizeDeviation > 0.1) {
          const severity = sizeDeviation > 0.25 ? 'ERROR' : 'WARNING';
          this.addIssue(severity, categoryName,
            `Size deviation: expected ${this.formatBytes(category.sizeExpected)}, actual ${this.formatBytes(category.sizeActual)} (${(sizeDeviation * 100).toFixed(1)}% difference)`);
        }
        
      } catch (error) {
        this.addIssue('ERROR', categoryName, `Failed to collect stats: ${error}`);
      }
    }
  }

  /**
   * Verify checksums for critical files
   */
  private async verifyChecksums(): Promise<void> {
    const checksumsFile = path.join(this.backupRoot, 'checksums', 'SHA256SUMS');
    
    try {
      const checksumsContent = await fs.readFile(checksumsFile, 'utf8');
      const checksums = new Map<string, string>();
      
      // Parse checksums file
      checksumsContent.split('\n').forEach(line => {
        const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
        if (match) {
          checksums.set(match[2], match[1]);
        }
      });
      
      // Verify a sample of files (10% or at least 5 files)
      const checksumEntries = Array.from(checksums.entries());
      const sampleSize = Math.max(5, Math.floor(checksumEntries.length * 0.1));
      const sampleFiles = checksumEntries.slice(0, sampleSize);
      
      console.log(`🔐 Verifying ${sampleSize} file checksums (${(sampleSize/checksumEntries.length*100).toFixed(1)}% sample)...`);
      
      for (const [relativePath, expectedChecksum] of sampleFiles) {
        const filePath = path.join(this.backupRoot, relativePath);
        
        try {
          const actualChecksum = await this.calculateFileChecksum(filePath);
          
          if (actualChecksum === expectedChecksum) {
            this.report.summary.checksumsVerified++;
          } else {
            this.report.summary.checksumFailures++;
            this.addIssue('ERROR', 'checksums', `Checksum mismatch: ${relativePath}`, [relativePath]);
          }
        } catch (error) {
          this.report.summary.checksumFailures++;
          this.addIssue('ERROR', 'checksums', `Failed to verify checksum for ${relativePath}: ${error}`, [relativePath]);
        }
      }
      
    } catch (error) {
      this.addIssue('ERROR', 'checksums', `Failed to load checksums file: ${error}`);
    }
  }

  /**
   * Verify restoration procedures and emergency scripts
   */
  private async verifyRestorationProcedures(): Promise<void> {
    // Check restore procedures
    const proceduresPath = path.join(this.backupRoot, 'RESTORE_PROCEDURES.md');
    try {
      const content = await fs.readFile(proceduresPath, 'utf8');
      
      // Verify content has essential sections
      const requiredSections = [
        'Emergency Rollback Procedures',
        'Full System Rollback',
        'Selective Restoration',
        'Integrity Verification'
      ];
      
      for (const section of requiredSections) {
        if (!content.includes(section)) {
          this.addIssue('WARNING', 'procedures', `Missing section in restore procedures: ${section}`);
        }
      }
      
      // Verify backup ID is mentioned in procedures
      if (!content.includes(this.backupId)) {
        this.addIssue('WARNING', 'procedures', 'Backup ID not found in restore procedures');
      }
      
    } catch (error) {
      this.addIssue('ERROR', 'procedures', `Failed to verify restore procedures: ${error}`);
    }
    
    // Check emergency rollback script
    const rollbackPath = path.join(this.backupRoot, 'EMERGENCY_ROLLBACK.sh');
    try {
      await fs.access(rollbackPath);
      
      // Verify script is executable
      const stats = await fs.stat(rollbackPath);
      if (!(stats.mode & parseInt('111', 8))) {
        this.addIssue('WARNING', 'procedures', 'Emergency rollback script is not executable');
      }
      
      // Verify script contains backup ID
      const content = await fs.readFile(rollbackPath, 'utf8');
      if (!content.includes(this.backupId)) {
        this.addIssue('WARNING', 'procedures', 'Backup ID not found in emergency rollback script');
      }
      
    } catch (error) {
      this.addIssue('ERROR', 'procedures', `Failed to verify emergency rollback script: ${error}`);
    }
  }

  /**
   * Generate recommendations based on verification results
   */
  private async generateRecommendations(): Promise<void> {
    // Check overall backup health
    if (this.report.summary.checksumFailures > 0) {
      this.report.recommendations.push('🚨 CRITICAL: Checksum failures detected. Backup integrity compromised. Recommend creating new backup immediately.');
    }
    
    if (this.report.summary.totalFilesFound < this.report.summary.totalFilesExpected * 0.95) {
      this.report.recommendations.push('⚠️  WARNING: Significant number of files missing. Verify backup process completion.');
    }
    
    // Category-specific recommendations
    if (!this.report.categories.leveldb?.found) {
      this.report.recommendations.push('🔴 CRITICAL: LevelDB backup missing. This is essential for system recovery.');
    }
    
    if (!this.report.categories.unifiedJson?.found) {
      this.report.recommendations.push('🟠 HIGH: Unified JSON backup missing. Migration rollback may be incomplete.');
    }
    
    if (this.report.summary.checksumsVerified > 0 && this.report.summary.checksumFailures === 0) {
      this.report.recommendations.push('✅ GOOD: Sample checksum verification passed. Backup integrity appears sound.');
    }
    
    // Operational recommendations
    if (this.getIssuesBySeverity('ERROR').length === 0 && this.getIssuesBySeverity('WARNING').length === 0) {
      this.report.recommendations.push('💚 EXCELLENT: Backup verification passed all checks. Safe to proceed with cleanup operations.');
    }
    
    if (this.report.summary.totalSizeActual > 0) {
      const compressionRatio = this.report.summary.totalSizeActual / (1024 * 1024 * 100); // Assume ~100MB original
      if (compressionRatio > 2) {
        this.report.recommendations.push('💡 OPTIMIZATION: Consider implementing backup compression to reduce storage requirements.');
      }
    }
  }

  /**
   * Determine overall verification status
   */
  private determineOverallStatus(): void {
    const errorCount = this.getIssuesBySeverity('ERROR').length;
    const warningCount = this.getIssuesBySeverity('WARNING').length;
    
    if (errorCount > 0 || this.report.summary.checksumFailures > 0) {
      this.report.status = 'FAILED';
    } else if (warningCount > 0) {
      this.report.status = 'WARNING';
    } else {
      this.report.status = 'PASSED';
    }
  }

  /**
   * Display verification results
   */
  private async displayVerificationResults(): Promise<void> {
    console.log('');
    console.log('📊 BACKUP VERIFICATION RESULTS');
    console.log('═'.repeat(60));
    console.log(`🆔 Backup ID: ${this.backupId}`);
    console.log(`📅 Verified: ${this.report.verificationTimestamp}`);
    console.log(`🎯 Status: ${this.getStatusEmoji()} ${this.report.status}`);
    console.log('');
    
    console.log('📈 SUMMARY STATISTICS');
    console.log('─'.repeat(60));
    console.log(`📁 Files Expected: ${this.report.summary.totalFilesExpected.toLocaleString()}`);
    console.log(`📁 Files Found: ${this.report.summary.totalFilesFound.toLocaleString()}`);
    console.log(`💾 Size Expected: ${this.formatBytes(this.report.summary.totalSizeExpected)}`);
    console.log(`💾 Size Actual: ${this.formatBytes(this.report.summary.totalSizeActual)}`);
    console.log(`🔐 Checksums Verified: ${this.report.summary.checksumsVerified}`);
    console.log(`❌ Checksum Failures: ${this.report.summary.checksumFailures}`);
    console.log('');
    
    console.log('📂 CATEGORY BREAKDOWN');
    console.log('─'.repeat(60));
    Object.entries(this.report.categories).forEach(([name, category]) => {
      const status = category.found ? '✅' : '❌';
      const fileMatch = category.filesFound === category.filesExpected ? '✅' : '⚠️';
      console.log(`${status} ${fileMatch} ${name.padEnd(15)} ${category.filesFound.toString().padStart(6)}/${category.filesExpected.toString().padEnd(6)} files  ${this.formatBytes(category.sizeActual).padStart(10)}`);
    });
    
    // Display issues
    const errors = this.getIssuesBySeverity('ERROR');
    const warnings = this.getIssuesBySeverity('WARNING');
    const infos = this.getIssuesBySeverity('INFO');
    
    if (errors.length > 0) {
      console.log('');
      console.log('🔴 ERRORS');
      console.log('─'.repeat(60));
      errors.forEach(issue => {
        console.log(`❌ [${issue.category}] ${issue.description}`);
      });
    }
    
    if (warnings.length > 0) {
      console.log('');
      console.log('🟠 WARNINGS');
      console.log('─'.repeat(60));
      warnings.forEach(issue => {
        console.log(`⚠️  [${issue.category}] ${issue.description}`);
      });
    }
    
    if (infos.length > 0) {
      console.log('');
      console.log('ℹ️  INFORMATION');
      console.log('─'.repeat(60));
      infos.forEach(issue => {
        console.log(`ℹ️  [${issue.category}] ${issue.description}`);
      });
    }
    
    // Display recommendations
    if (this.report.recommendations.length > 0) {
      console.log('');
      console.log('💡 RECOMMENDATIONS');
      console.log('─'.repeat(60));
      this.report.recommendations.forEach(rec => {
        console.log(`   ${rec}`);
      });
    }
  }

  /**
   * Save verification report to file
   */
  private async saveVerificationReport(): Promise<void> {
    const reportPath = path.join(this.backupRoot, 'VERIFICATION_REPORT.json');
    await fs.writeFile(reportPath, JSON.stringify(this.report, null, 2));
    
    console.log('');
    console.log(`📋 Verification report saved: ${reportPath}`);
  }

  /**
   * Helper methods
   */
  private addIssue(severity: Issue['severity'], category: string, description: string, affectedFiles?: string[]): void {
    this.report.issues.push({
      severity,
      category,
      description,
      affectedFiles
    });
    
    // Also add to category if it exists
    if (this.report.categories[category]) {
      this.report.categories[category].issues.push(description);
    }
  }

  private getIssuesBySeverity(severity: Issue['severity']): Issue[] {
    return this.report.issues.filter(issue => issue.severity === severity);
  }

  private getStatusEmoji(): string {
    switch (this.report.status) {
      case 'PASSED': return '✅';
      case 'WARNING': return '⚠️';
      case 'FAILED': return '❌';
      default: return '❓';
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  private async calculateFileChecksum(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const fileBuffer = await fs.readFile(filePath);
    hash.update(fileBuffer);
    return hash.digest('hex');
  }

  private async collectDirectoryStats(dirPath: string): Promise<{files: number, sizeBytes: number}> {
    let files = 0;
    let sizeBytes = 0;

    const items = await fs.readdir(dirPath);
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stats = await fs.stat(itemPath);
      
      if (stats.isDirectory()) {
        const subStats = await this.collectDirectoryStats(itemPath);
        files += subStats.files;
        sizeBytes += subStats.sizeBytes;
      } else {
        files++;
        sizeBytes += stats.size;
      }
    }

    return { files, sizeBytes };
  }
}

// Execute verification if called directly
if (require.main === module) {
  const backupId = process.argv[2]; // Optional backup ID argument
  const verifier = new BackupIntegrityVerifier(backupId);
  
  verifier.execute()
    .then((report) => {
      if (report.status === 'FAILED') {
        process.exit(1);
      } else if (report.status === 'WARNING') {
        process.exit(2);
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Verification execution failed:', error);
      process.exit(1);
    });
}

export { BackupIntegrityVerifier, VerificationReport };