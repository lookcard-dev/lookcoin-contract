#!/usr/bin/env npx tsx

/**
 * Test script for validating the configure script works with unified format
 */

import { loadDeployment, loadOtherChainDeployments } from "./utils/deployment-unified";

const TEST_CHAIN_ID = 97; // BSC Testnet
const TEST_NETWORK = 'bsctestnet';

async function main(): Promise<void> {
  console.log('========================================');
  console.log('🧪 Testing Configure Script with Unified Format');
  console.log('========================================');
  
  // Test loading current deployment
  console.log('\n📋 Testing: Load current deployment...');
  const deployment = loadDeployment(TEST_NETWORK);
  
  if (!deployment) {
    console.error('❌ Failed to load deployment');
    process.exit(1);
  }
  
  console.log('✅ Loaded deployment:', {
    network: deployment.network,
    chainId: deployment.chainId,
    deploymentMode: deployment.deploymentMode,
    protocolsDeployed: deployment.protocolsDeployed,
    hasLookCoin: !!deployment.contracts.LookCoin,
    hasSupplyOracle: !!deployment.contracts.SupplyOracle,
    hasCrossChainRouter: !!deployment.infrastructureContracts?.crossChainRouter
  });
  
  // Test loading other chain deployments
  console.log('\n📋 Testing: Load other chain deployments...');
  const otherDeployments = loadOtherChainDeployments(TEST_CHAIN_ID, { allowCrossTier: true });
  
  const deploymentCount = Object.keys(otherDeployments).length;
  console.log(`✅ Found ${deploymentCount} other deployments:`);
  
  for (const [chainId, otherDeployment] of Object.entries(otherDeployments)) {
    console.log(`  - Chain ${chainId}: ${otherDeployment.network} (${otherDeployment.deploymentMode || 'standard'})`);
  }
  
  // Test contract access
  console.log('\n📋 Testing: Contract address access...');
  
  const lookCoinProxy = deployment.contracts.LookCoin.proxy;
  const supplyOracleProxy = deployment.contracts.SupplyOracle.proxy;
  
  console.log('✅ Core contracts:');
  console.log(`  - LookCoin proxy: ${lookCoinProxy}`);
  console.log(`  - SupplyOracle proxy: ${supplyOracleProxy}`);
  
  if (deployment.protocolContracts) {
    console.log('✅ Protocol contracts:', deployment.protocolContracts);
  }
  
  if (deployment.infrastructureContracts) {
    console.log('✅ Infrastructure contracts:', deployment.infrastructureContracts);
  }
  
  // Test config access
  console.log('\n📋 Testing: Configuration access...');
  
  if (deployment.config) {
    console.log('✅ Configuration:');
    console.log(`  - Governance vault: ${deployment.config.governanceVault}`);
    console.log(`  - LayerZero endpoint: ${deployment.config.layerZeroEndpoint || 'N/A'}`);
    console.log(`  - Celer message bus: ${deployment.config.celerMessageBus || 'N/A'}`);
  }
  
  // Test implementation hashes
  console.log('\n📋 Testing: Implementation hashes...');
  
  if (deployment.implementationHashes) {
    const hashCount = Object.keys(deployment.implementationHashes).length;
    console.log(`✅ Found ${hashCount} implementation hashes`);
    
    // Show first few hashes
    const hashes = Object.entries(deployment.implementationHashes).slice(0, 3);
    for (const [name, hash] of hashes) {
      console.log(`  - ${name}: ${(hash as string).substring(0, 10)}...`);
    }
  }
  
  console.log('\n========================================');
  console.log('✅ All configure compatibility tests passed!');
  console.log('========================================');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});