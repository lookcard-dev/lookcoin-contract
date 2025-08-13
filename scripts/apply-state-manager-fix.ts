#!/usr/bin/env tsx
/**
 * Apply State Manager Fix
 * 
 * This script replaces the current UnifiedJSONStateManager with the fixed version
 * and updates all references to use it.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function applyFix() {
  console.log('🔧 Applying UnifiedJSONStateManager fixes...\n');

  const scriptsDir = path.join(__dirname, 'utils');
  const originalFile = path.join(scriptsDir, 'UnifiedJSONStateManager.ts');
  const fixedFile = path.join(scriptsDir, 'UnifiedJSONStateManager-fixed.ts');
  const backupFile = path.join(scriptsDir, 'UnifiedJSONStateManager-backup.ts');

  try {
    // 1. Create backup of original
    console.log('📋 Creating backup of original file...');
    const originalContent = await fs.readFile(originalFile, 'utf-8');
    await fs.writeFile(backupFile, originalContent);
    console.log('   ✅ Backup created: UnifiedJSONStateManager-backup.ts');

    // 2. Replace with fixed version
    console.log('\n🔄 Replacing with fixed version...');
    const fixedContent = await fs.readFile(fixedFile, 'utf-8');
    await fs.writeFile(originalFile, fixedContent);
    console.log('   ✅ Fixed version applied');

    // 3. Verify the changes
    console.log('\n🔍 Verifying changes...');
    const newContent = await fs.readFile(originalFile, 'utf-8');
    
    // Check for key fixes
    const checks = [
      {
        name: 'ExtendedContractInfo interface',
        pattern: /interface ExtendedContractInfo extends ContractInfo/,
        found: newContent.includes('interface ExtendedContractInfo extends ContractInfo')
      },
      {
        name: 'enrichContractInfo method',
        pattern: /private enrichContractInfo/,
        found: newContent.includes('private enrichContractInfo')
      },
      {
        name: 'Fixed updateContract method',
        pattern: /implementation: contract\.proxyAddress \? contract\.address : undefined/,
        found: newContent.includes('implementation: contract.proxyAddress ? contract.address : undefined')
      },
      {
        name: 'Extended data storage',
        pattern: /extended_\${contract\.contractName}/,
        found: newContent.includes('extended_${contract.contractName}')
      }
    ];

    let allChecksPass = true;
    for (const check of checks) {
      if (check.found) {
        console.log(`   ✅ ${check.name}`);
      } else {
        console.log(`   ❌ ${check.name} - NOT FOUND`);
        allChecksPass = false;
      }
    }

    if (allChecksPass) {
      console.log('\n✅ All fixes successfully applied!');
      console.log('\n📝 Next steps:');
      console.log('   1. Test deployment scripts to ensure compatibility');
      console.log('   2. Run: npm run deploy:bsc-testnet to test deployment');
      console.log('   3. Run: npm run setup:bsc-testnet to test setup');
      console.log('   4. Run: npm run configure:bsc-testnet to test configuration');
      
      console.log('\n💡 To revert changes if needed:');
      console.log('   cp scripts/utils/UnifiedJSONStateManager-backup.ts scripts/utils/UnifiedJSONStateManager.ts');
    } else {
      console.log('\n⚠️  Some fixes may not have been applied correctly');
      console.log('   Please review the file manually');
    }

  } catch (error) {
    console.error('\n❌ Error applying fix:', error);
    console.log('\n💡 To manually apply:');
    console.log('   1. cp scripts/utils/UnifiedJSONStateManager.ts scripts/utils/UnifiedJSONStateManager-backup.ts');
    console.log('   2. cp scripts/utils/UnifiedJSONStateManager-fixed.ts scripts/utils/UnifiedJSONStateManager.ts');
    process.exit(1);
  }
}

// Run the fix
applyFix().catch(console.error);