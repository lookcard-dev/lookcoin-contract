#!/usr/bin/env tsx

/**
 * Enhanced Schema Validation Script
 * 
 * Validates enhanced deployment JSON files against the v2.0.0 schema
 * and provides detailed validation reports.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { 
  validateEnhancedDeployment, 
  generateValidationReport 
} from '../utils/enhanced-deployment-validation';
import { 
  isEnhancedDeployment 
} from '../types/enhanced-deployment';

interface ValidationOptions {
  file?: string;
  directory?: string;
  verbose?: boolean;
}

function parseArguments(): ValidationOptions {
  const args = process.argv.slice(2);
  const options: ValidationOptions = {
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--file':
      case '-f':
        options.file = args[++i];
        break;
      case '--directory':
      case '-d':
        options.directory = args[++i];
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
    }
  }

  // Default directory if none specified
  if (!options.file && !options.directory) {
    options.directory = join(__dirname, '../deployments');
  }

  return options;
}

function showHelp(): void {
  console.log(`
Enhanced Schema Validation Script

Usage:
  npm run validate:enhanced-schema [options]

Options:
  -f, --file <path>        Validate a specific enhanced deployment file
  -d, --directory <path>   Validate all enhanced-*.json files in directory
  -v, --verbose           Show detailed validation information
  -h, --help              Show this help message

Examples:
  npm run validate:enhanced-schema -f deployments/enhanced-bscmainnet.json
  npm run validate:enhanced-schema -d deployments -v
  npm run validate:enhanced-schema --verbose
`);
}

async function validateFile(filePath: string, verbose: boolean): Promise<boolean> {
  const fileName = filePath.split('/').pop() || filePath;
  
  if (!existsSync(filePath)) {
    console.error(`❌ File not found: ${fileName}`);
    return false;
  }

  try {
    console.log(`🔍 Validating ${fileName}...`);
    
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Type check
    if (!isEnhancedDeployment(data)) {
      console.error(`❌ ${fileName} is not a valid enhanced deployment`);
      if (verbose) {
        console.error('   Missing required fields or incorrect schema version');
      }
      return false;
    }

    // Comprehensive validation
    const validation = validateEnhancedDeployment(data);
    const report = generateValidationReport(data, validation);

    if (validation.isValid) {
      console.log(`✅ ${fileName} is valid`);
      if (verbose) {
        console.log(`   Network: ${data.network} (Chain ID: ${data.chainId})`);
        console.log(`   Mode: ${data.metadata.deploymentMode}`);
        console.log(`   Protocols: ${data.metadata.protocolsEnabled?.join(', ') || 'none'}`);
        console.log(`   Contracts: ${Object.keys(data.contracts.core).length + 
          (Object.keys(data.contracts.protocol || {}).length) + 
          (Object.keys(data.contracts.infrastructure || {}).length)} total`);
      }
      return true;
    } else {
      console.error(`❌ ${fileName} validation failed`);
      console.error(`   ${report.validation.errorCount} error(s), ${report.validation.warningCount} warning(s)`);
      
      if (verbose) {
        report.details.errors.forEach(error => {
          const symbol = error.severity === 'error' ? '   ❌' : '   ⚠️';
          console.error(`${symbol} ${error.message}`);
        });
      }
      return false;
    }
  } catch (error) {
    console.error(`❌ ${fileName} parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}

async function validateDirectory(dirPath: string, verbose: boolean): Promise<boolean> {
  if (!existsSync(dirPath)) {
    console.error(`❌ Directory not found: ${dirPath}`);
    return false;
  }

  const fs = await import('fs/promises');
  const files = await fs.readdir(dirPath);
  const enhancedFiles = files
    .filter(file => file.startsWith('enhanced-') && file.endsWith('.json'))
    .map(file => join(dirPath, file));

  if (enhancedFiles.length === 0) {
    console.warn(`⚠️  No enhanced-*.json files found in ${dirPath}`);
    return true; // Not an error, just no files to validate
  }

  console.log(`📁 Validating ${enhancedFiles.length} enhanced deployment file(s) in ${dirPath}`);
  
  let allValid = true;
  for (const file of enhancedFiles) {
    const isValid = await validateFile(file, verbose);
    allValid = allValid && isValid;
    if (verbose) console.log(); // Extra spacing in verbose mode
  }

  return allValid;
}

async function main(): Promise<void> {
  const options = parseArguments();
  
  console.log('🚀 Enhanced Deployment Schema Validator v2.0.0\n');

  let success = false;

  if (options.file) {
    success = await validateFile(options.file, options.verbose || false);
  } else if (options.directory) {
    success = await validateDirectory(options.directory, options.verbose || false);
  }

  if (success) {
    console.log('\n🎉 All validations passed!');
    process.exit(0);
  } else {
    console.log('\n💥 Validation failed!');
    process.exit(1);
  }
}

// Self-validation: Test the example enhanced deployment
async function runSelfTest(): Promise<void> {
  console.log('🧪 Running self-test with enhanced-bscmainnet.json...\n');
  
  const exampleFile = join(__dirname, '../deployments/enhanced-bscmainnet.json');
  const testPassed = await validateFile(exampleFile, true);
  
  if (testPassed) {
    console.log('\n✅ Self-test passed - Schema implementation is working correctly!');
  } else {
    console.log('\n❌ Self-test failed - Schema implementation needs review');
    process.exit(1);
  }
}

// Run self-test if called with --self-test argument
if (process.argv.includes('--self-test')) {
  runSelfTest().catch(console.error);
} else {
  main().catch(console.error);
}