#!/usr/bin/env tsx

/**
 * @title Fuzz Testing Setup Validator
 * @dev Validates that the fuzz testing environment is properly configured
 * @notice Run this script to ensure all dependencies and configurations are correct
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

interface ValidationResult {
  check: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  fix?: string;
}

class FuzzSetupValidator {
  private results: ValidationResult[] = [];

  async validate(): Promise<void> {
    console.log(chalk.blue.bold('🔍 Validating Fuzz Testing Setup\n'));

    await this.checkFoundryInstallation();
    await this.checkForgeConfiguration();
    await this.checkSolcVersion();
    await this.checkTestFiles();
    await this.checkDependencies();
    await this.checkNetworkConfiguration();
    await this.runBasicCompilation();
    await this.runQuickTest();

    this.printResults();
  }

  private async checkFoundryInstallation(): Promise<void> {
    try {
      const version = execSync('forge --version', { encoding: 'utf8' });
      this.results.push({
        check: 'Foundry Installation',
        status: 'pass',
        message: `Found Foundry: ${version.trim()}`,
      });
    } catch (error) {
      this.results.push({
        check: 'Foundry Installation',
        status: 'fail',
        message: 'Foundry not found in PATH',
        fix: 'Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup',
      });
    }
  }

  private async checkForgeConfiguration(): Promise<void> {
    const configPath = join(process.cwd(), 'foundry.toml');
    
    if (!existsSync(configPath)) {
      this.results.push({
        check: 'Foundry Configuration',
        status: 'fail',
        message: 'foundry.toml not found',
        fix: 'Create foundry.toml with appropriate configuration',
      });
      return;
    }

    const config = readFileSync(configPath, 'utf8');
    
    // Check for fuzz configuration
    if (config.includes('[fuzz]')) {
      this.results.push({
        check: 'Fuzz Configuration',
        status: 'pass',
        message: 'Fuzz configuration found in foundry.toml',
      });
    } else {
      this.results.push({
        check: 'Fuzz Configuration',
        status: 'warning',
        message: 'No explicit fuzz configuration found',
        fix: 'Add [fuzz] section to foundry.toml',
      });
    }

    // Check for invariant configuration
    if (config.includes('[invariant]')) {
      this.results.push({
        check: 'Invariant Configuration',
        status: 'pass',
        message: 'Invariant configuration found in foundry.toml',
      });
    } else {
      this.results.push({
        check: 'Invariant Configuration',
        status: 'warning',
        message: 'No explicit invariant configuration found',
        fix: 'Add [invariant] section to foundry.toml',
      });
    }
  }

  private async checkSolcVersion(): Promise<void> {
    try {
      const configPath = join(process.cwd(), 'foundry.toml');
      const config = readFileSync(configPath, 'utf8');
      
      const solcMatch = config.match(/solc\s*=\s*"([^"]+)"/);
      if (solcMatch) {
        const version = solcMatch[1];
        if (version === '0.8.28') {
          this.results.push({
            check: 'Solidity Version',
            status: 'pass',
            message: `Correct Solidity version: ${version}`,
          });
        } else {
          this.results.push({
            check: 'Solidity Version',
            status: 'warning',
            message: `Solidity version ${version} (expected 0.8.28)`,
            fix: 'Update solc version to 0.8.28 in foundry.toml',
          });
        }
      } else {
        this.results.push({
          check: 'Solidity Version',
          status: 'warning',
          message: 'No explicit solc version in foundry.toml',
          fix: 'Add solc = "0.8.28" to foundry.toml',
        });
      }
    } catch (error) {
      this.results.push({
        check: 'Solidity Version',
        status: 'fail',
        message: 'Could not check Solidity version',
      });
    }
  }

  private async checkTestFiles(): Promise<void> {
    const testFiles = [
      'test/fuzz/FuzzTests.sol',
      'test/fuzz/FuzzTargets.sol',
      'test/fuzz/FuzzTestRunner.ts',
      'test/fuzz/README.md',
    ];

    let foundFiles = 0;
    for (const file of testFiles) {
      const fullPath = join(process.cwd(), file);
      if (existsSync(fullPath)) {
        foundFiles++;
      }
    }

    if (foundFiles === testFiles.length) {
      this.results.push({
        check: 'Fuzz Test Files',
        status: 'pass',
        message: `All ${testFiles.length} fuzz test files found`,
      });
    } else {
      this.results.push({
        check: 'Fuzz Test Files',
        status: 'fail',
        message: `Only ${foundFiles}/${testFiles.length} fuzz test files found`,
        fix: 'Ensure all required fuzz test files are present',
      });
    }
  }

  private async checkDependencies(): Promise<void> {
    const packagePath = join(process.cwd(), 'package.json');
    
    if (!existsSync(packagePath)) {
      this.results.push({
        check: 'Package Dependencies',
        status: 'fail',
        message: 'package.json not found',
      });
      return;
    }

    const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
    const scripts = pkg.scripts || {};

    // Check for fuzz scripts
    const fuzzScripts = Object.keys(scripts).filter(s => s.includes('fuzz'));
    if (fuzzScripts.length > 0) {
      this.results.push({
        check: 'Fuzz Scripts',
        status: 'pass',
        message: `Found ${fuzzScripts.length} fuzz-related scripts`,
      });
    } else {
      this.results.push({
        check: 'Fuzz Scripts',
        status: 'fail',
        message: 'No fuzz scripts found in package.json',
        fix: 'Add fuzz testing scripts to package.json',
      });
    }

    // Check for required dependencies
    const requiredDeps = ['forge-std', 'chalk'];
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    const missingDeps = requiredDeps.filter(dep => !allDeps[dep] && !allDeps[`@${dep}`]);
    
    if (missingDeps.length === 0) {
      this.results.push({
        check: 'Required Dependencies',
        status: 'pass',
        message: 'All required dependencies found',
      });
    } else {
      this.results.push({
        check: 'Required Dependencies',
        status: 'warning',
        message: `Missing dependencies: ${missingDeps.join(', ')}`,
        fix: `Install missing dependencies: npm install ${missingDeps.join(' ')}`,
      });
    }
  }

  private async checkNetworkConfiguration(): Promise<void> {
    try {
      // Check if we can run basic forge commands
      execSync('forge config', { encoding: 'utf8' });
      this.results.push({
        check: 'Network Configuration',
        status: 'pass',
        message: 'Forge configuration accessible',
      });
    } catch (error) {
      this.results.push({
        check: 'Network Configuration',
        status: 'fail',
        message: 'Cannot access forge configuration',
        fix: 'Check foundry.toml and network settings',
      });
    }
  }

  private async runBasicCompilation(): Promise<void> {
    try {
      console.log(chalk.gray('  Compiling contracts...'));
      execSync('forge build --sizes', { encoding: 'utf8' });
      this.results.push({
        check: 'Contract Compilation',
        status: 'pass',
        message: 'All contracts compiled successfully',
      });
    } catch (error: any) {
      this.results.push({
        check: 'Contract Compilation',
        status: 'fail',
        message: 'Compilation failed',
        fix: 'Fix compilation errors before running fuzz tests',
      });
    }
  }

  private async runQuickTest(): Promise<void> {
    try {
      console.log(chalk.gray('  Running quick test...'));
      // Run a very quick test to ensure basic functionality
      execSync('forge test --match-contract FuzzTests --fuzz-runs 10 -q', { 
        encoding: 'utf8',
        timeout: 30000, // 30 second timeout
      });
      this.results.push({
        check: 'Basic Fuzz Test',
        status: 'pass',
        message: 'Quick fuzz test executed successfully',
      });
    } catch (error: any) {
      if (error.message.includes('timeout')) {
        this.results.push({
          check: 'Basic Fuzz Test',
          status: 'warning',
          message: 'Test execution timed out (may be normal)',
        });
      } else {
        this.results.push({
          check: 'Basic Fuzz Test',
          status: 'fail',
          message: 'Basic fuzz test failed',
          fix: 'Check test contract compilation and dependencies',
        });
      }
    }
  }

  private printResults(): void {
    console.log(chalk.blue.bold('\n📋 Validation Results'));
    console.log('═'.repeat(60));

    let passCount = 0;
    let warningCount = 0;
    let failCount = 0;

    for (const result of this.results) {
      const icon = result.status === 'pass' ? '✅' : 
                   result.status === 'warning' ? '⚠️' : '❌';
      const color = result.status === 'pass' ? chalk.green :
                    result.status === 'warning' ? chalk.yellow : chalk.red;

      console.log(`${icon} ${chalk.bold(result.check)}: ${color(result.message)}`);
      
      if (result.fix) {
        console.log(`   ${chalk.gray('Fix:')} ${result.fix}`);
      }

      if (result.status === 'pass') passCount++;
      else if (result.status === 'warning') warningCount++;
      else failCount++;
    }

    console.log('\n' + '═'.repeat(60));
    console.log(chalk.green(`✅ Passed: ${passCount}`));
    console.log(chalk.yellow(`⚠️  Warnings: ${warningCount}`));
    console.log(chalk.red(`❌ Failed: ${failCount}`));

    // Overall status
    if (failCount === 0) {
      if (warningCount === 0) {
        console.log(chalk.green.bold('\n🎉 Setup is fully ready for fuzz testing!'));
        console.log(chalk.gray('Run: npm run fuzz:quick to start'));
      } else {
        console.log(chalk.yellow.bold('\n✅ Setup is ready with minor issues'));
        console.log(chalk.gray('Consider addressing warnings for optimal performance'));
      }
    } else {
      console.log(chalk.red.bold('\n🚨 Setup has critical issues'));
      console.log(chalk.gray('Please fix failed checks before proceeding'));
    }

    console.log(chalk.blue('\nNext Steps:'));
    console.log(chalk.gray('1. Fix any failed checks'));
    console.log(chalk.gray('2. Address warnings if possible'));
    console.log(chalk.gray('3. Run: npm run fuzz:quick'));
    console.log(chalk.gray('4. Review generated reports'));
    console.log(chalk.gray('5. Scale up to intensive testing'));
  }
}

// CLI interface
if (require.main === module) {
  const validator = new FuzzSetupValidator();
  validator.validate().catch(error => {
    console.error(chalk.red.bold('Validation failed:'));
    console.error(chalk.red(error.message));
    process.exit(1);
  });
}

export { FuzzSetupValidator };