# Configuration Update Summary

This document summarizes the updates made to the documentation files to reflect the latest configuration from `hardhat.config.ts`.

## Key Configuration Changes

### 1. Network RPC URLs
- **Akashic Mainnet RPC**: Updated from `https://rpc.mainnet.akashic.land` to `https://rpc-mainnet.akashicrecords.io`

### 2. LayerZero Endpoints
All LayerZero endpoints have been updated to the V2 endpoints:
- **BSC Mainnet**: `0x1a44076050125825900e736c501f859c50fE728c` (was `0x3c2269811836af69497E5F486A85D7316753cf62`)
- **BSC Testnet**: `0x6EDCE65403992e310A62460808c4b910D972f10f`
- **Base Mainnet**: `0x1a44076050125825900e736c501f859c50fE728c`
- **Base Sepolia**: `0x6EDCE65403992e310A62460808c4b910D972f10f`
- **Optimism Mainnet**: `0x1a44076050125825900e736c501f859c50fE728c`
- **Optimism Sepolia**: `0x6EDCE65403992e310A62460808c4b910D972f10f`
- **Sapphire**: Not supported by LayerZero
- **Akashic**: Not supported by LayerZero

### 3. Celer MessageBus Addresses
- **BSC Mainnet**: `0x95714818fdd7a5454f73da9c777b3ee6ebaeea6b`
- **BSC Testnet**: `0xAd204986D6cB67A5Bc76a3CB8974823F43Cb9AAA`
- **Base**: Not supported by Celer
- **Optimism Mainnet**: `0x0D71D18126E03646eb09FEc929e2ae87b7CAE69d`
- **Optimism Sepolia**: Not supported on testnet
- **Sapphire**: `0x9Bb46D5100d2Db4608112026951c9C965b233f4D`
- **Sapphire Testnet**: `0x9Bb46D5100d2Db4608112026951c9C965b233f4D`
- **Akashic**: Not supported by Celer

### 4. DVN (Decentralized Verifier Network) Configuration
Added detailed DVN addresses for each network:
- **BSC**: LayerZero Labs, Google Cloud, Nethermind
- **Base**: LayerZero Labs, Google Cloud, Nethermind
- **Optimism**: LayerZero Labs, Google Cloud, Nethermind

### 5. Chain IDs
- **Oasis Sapphire**: Corrected chain ID from 23294 to 23295
- **Akashic**: Confirmed chain ID as 9070

### 6. Fee Structure Updates
Celer IM bridge fees updated:
- **Fee Percentage**: 0.1% (10 basis points) - was 0.5%
- **Minimum Fee**: 1 LOOK - was 10 LOOK
- **Maximum Fee**: 100 LOOK - was 1,000 LOOK

### 7. IBC Configuration
- **Chain ID**: 9070
- **Minimum Validators**: 21
- **Threshold**: 14 (2/3 majority)
- **Unbonding Period**: 14 days
- **Packet Timeout**: 1 hour
- **Channel ID**: channel-0
- **Port ID**: transfer

## Files Updated

1. **docs/DEPLOYMENT.md**
   - Updated RPC URLs
   - Updated LayerZero endpoints
   - Updated Celer MessageBus addresses
   - Added DVN configuration details
   - Updated IBC configuration details
   - Corrected chain IDs

2. **docs/TECHNICAL.md**
   - Updated Akashic chain ID in deployment matrix

3. **docs/CONFIGURATION.md**
   - Updated example code to use new LayerZero endpoint

4. **docs/USER_FLOW.md**
   - Updated LayerZero endpoint for BSC
   - Updated bridge fee structure (0.1% instead of 0.5%)
   - Updated fee examples with new calculations
   - Added clarification notes about bridge support per network

5. **docs/TESTCASE.md**
   - No updates needed (no hardcoded network configurations)

## Bridge Support Matrix

| Network | LayerZero | Celer IM | IBC |
|---------|-----------|----------|-----|
| BSC | ✓ | ✓ | ✗ |
| Base | ✓ | ✗ | ✗ |
| Optimism | ✓ | ✓ | ✗ |
| Sapphire | ✗ | ✓ | ✗ |
| Akashic | ✗ | ✗ | ✓ |

## Important Notes

1. Some networks marked with zero addresses (`0x0000...0000`) indicate that the bridge is not supported on that network.
2. DVN addresses are specific to each network and are used for LayerZero's decentralized verification.
3. The configuration is now centralized in `hardhat.config.ts` to maintain consistency across the project.