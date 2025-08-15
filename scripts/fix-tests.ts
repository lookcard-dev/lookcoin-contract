#!/usr/bin/env tsx
/**
 * Script to apply test fixes across all test files
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDir = path.join(__dirname, '..', 'test');

// Patterns to fix in test files
const fixes = [
  {
    // Fix nonce generation
    pattern: /const nonce = Date\.now\(\)/g,
    replacement: 'const nonce = await testHooks.getValidNonce()'
  },
  {
    // Fix nonce generation with offset
    pattern: /const nonce = Date\.now\(\) \+ (\d+)/g,
    replacement: 'const nonce = await testHooks.getValidNonce()'
  },
  {
    // Fix timestamp-based nonces
    pattern: /const nonce = Math\.floor\(Date\.now\(\) \/ 1000\)/g,
    replacement: 'const nonce = await testHooks.getValidNonce()'
  },
  {
    // Add import for test initializer if missing
    pattern: /^(import .* from ['"]chai['"];?)$/m,
    replacement: '$1\nimport { testHooks, applyAllPatches } from "../setup/testInitializer";'
  },
  {
    // Fix generateLoadTestReport calls
    pattern: /this\.generateLoadTestReport/g,
    replacement: 'loadTestHelper.generateLoadTestReport'
  },
  {
    // Fix missing setFeeParameters
    pattern: /\.connect\([^)]+\)\.setFeeParameters/g,
    replacement: '.setFeeParameters'
  },
  {
    // Fix submitSupplyReport calls
    pattern: /\.submitSupplyReport\(/g,
    replacement: '.updateSupply('
  }
];

// Files to update
const testFiles = [
  'failover/InfrastructureFailureTests.test.ts',
  'unit/SupplyOracle.test.ts',
  'integration/EmergencyScenarios.test.ts',
  'integration/GovernanceFlow.test.ts',
  'unit/LookCoin.test.ts',
  'security/CrossChainStateSyncTests.test.ts',
  'unit/bridges/comprehensive/bridgeSecurity.test.ts'
];

function fixTestFile(filePath: string): boolean {
  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;
    
    // Apply fixes
    for (const fix of fixes) {
      const newContent = content.replace(fix.pattern, fix.replacement);
      if (newContent !== content) {
        content = newContent;
        modified = true;
      }
    }
    
    // Add beforeEach hook if missing
    if (!content.includes('testHooks.beforeEach') && content.includes('beforeEach')) {
      content = content.replace(
        /beforeEach\(async function\(\) \{/g,
        'beforeEach(async function() {\n    await testHooks.beforeEach.call(this);'
      );
      modified = true;
    }
    
    // Apply patches in fixture setup
    if (!content.includes('applyAllPatches') && content.includes('fixture =')) {
      content = content.replace(
        /(fixture = await [^;]+;)/g,
        '$1\n    applyAllPatches(fixture);'
      );
      modified = true;
    }
    
    if (modified) {
      fs.writeFileSync(filePath, content);
      console.log(`✅ Fixed: ${path.relative(testDir, filePath)}`);
      return true;
    } else {
      console.log(`⏭️  No changes needed: ${path.relative(testDir, filePath)}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error fixing ${filePath}:`, error);
    return false;
  }
}

// Main execution
async function main() {
  console.log('🔧 Applying test fixes...\n');
  
  let fixedCount = 0;
  let errorCount = 0;
  
  for (const testFile of testFiles) {
    const fullPath = path.join(testDir, testFile);
    if (fs.existsSync(fullPath)) {
      if (fixTestFile(fullPath)) {
        fixedCount++;
      }
    } else {
      console.log(`⚠️  File not found: ${testFile}`);
      errorCount++;
    }
  }
  
  console.log(`\n✨ Complete! Fixed ${fixedCount} files, ${errorCount} errors`);
}

main().catch(console.error);