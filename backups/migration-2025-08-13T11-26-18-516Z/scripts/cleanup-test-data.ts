#!/usr/bin/env npx tsx

/**
 * Cleanup script to remove test data from unified deployment files
 */

import * as fs from "fs/promises";
import * as path from "path";

async function cleanupTestData(): Promise<void> {
  const unifiedPath = path.join(process.cwd(), 'deployments', 'unified', 'bsctestnet.unified.json');
  
  try {
    const content = await fs.readFile(unifiedPath, 'utf-8');
    const deployment = JSON.parse(content);
    
    // Remove TestContract from infrastructure
    if (deployment.contracts.infrastructure?.TestContract) {
      delete deployment.contracts.infrastructure.TestContract;
      console.log('✅ Removed TestContract from infrastructure');
    }
    
    // Remove TestContract from implementation hashes
    if (deployment.verification?.implementationHashes?.TestContract) {
      delete deployment.verification.implementationHashes.TestContract;
      console.log('✅ Removed TestContract from implementationHashes');
    }
    
    // Remove extended_TestContract
    if (deployment.extended_TestContract) {
      delete deployment.extended_TestContract;
      console.log('✅ Removed extended_TestContract');
    }
    
    // Clean up deployment history - remove TestContract entries
    if (deployment.operations?.deploymentHistory) {
      deployment.operations.deploymentHistory = deployment.operations.deploymentHistory.filter(
        (entry: any) => entry.contractName !== 'TestContract'
      );
      console.log('✅ Cleaned deployment history');
    }
    
    // Save the cleaned file
    await fs.writeFile(unifiedPath, JSON.stringify(deployment, null, 2));
    console.log('✅ Saved cleaned deployment file');
    
  } catch (error) {
    console.error('❌ Error cleaning test data:', error);
    process.exit(1);
  }
}

cleanupTestData().catch(console.error);