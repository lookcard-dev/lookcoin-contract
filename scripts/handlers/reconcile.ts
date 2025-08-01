/**
 * AWS Lambda Handler for Supply Oracle Reconciliation
 * 
 * Triggered by EventBridge every 15 minutes to perform cross-chain supply reconciliation.
 * 
 * Environment Variables:
 * - ORACLE_PRIVATE_KEY: Private key of oracle operator (from AWS Secrets Manager)
 * - ORACLE_ID: Unique identifier for this oracle (1, 2, or 3)
 * - NETWORK: Target network (e.g., "bsc", "bsc-testnet")
 */

import { Handler } from 'aws-lambda';
import { performReconciliation } from '../reconcile';

export const handler: Handler = async (event) => {
  const oracleId = process.env.ORACLE_ID || '1';
  const network = process.env.NETWORK || 'bsc';
  
  console.log(`Oracle Lambda ${oracleId} starting on ${network}...`);
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    const privateKey = process.env.ORACLE_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('ORACLE_PRIVATE_KEY not configured');
    }
    
    process.env.HARDHAT_NETWORK = network;
    
    console.log(`Starting reconciliation for Oracle ${oracleId}...`);
    await performReconciliation(privateKey);
    
    console.log(`Oracle ${oracleId} reconciliation completed successfully`);
    
  } catch (error) {
    console.error('Reconciliation failed:', error);
    throw error;
  }
};