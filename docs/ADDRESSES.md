# LookCoin Contract Addresses

This document contains the deployed contract addresses for LookCoin across all networks. Only proxy addresses are listed for upgradeable contracts.

## Mainnet Contracts

### BSC Mainnet (Chain ID: 56) - Home Chain

#### Core Contracts
| Contract | Address |
|----------|---------|
| **LookCoin** | `0x7d919E3ac306BBA4e5c85E40fB665126586C992d` |
| **SupplyOracle** | `0xdD09527aBef51a5fdfb19bCceA495AE2E5eaF0B0` |

#### Protocol Modules
| Contract | Address |
|----------|---------|
| **LayerZeroModule** | `0xFc79aa2AeeAc6D08d7A39faf1dbEe5AC0e63DFc8` |
| **CelerIMModule** | `0x9177A126C719A943BdF05fbC1dC089DCa458cb9e` |

#### Infrastructure Contracts
| Contract | Address |
|----------|---------|
| **CrossChainRouter** | `0xDD6e927c534fcd541a7D6053eDe35De48aD38bbc` |
| **FeeManager** | `0xA30ec846115c20aeF89795D0fE6dab6C05e1AaDb` |
| **SecurityManager** | `0x7293dE1109A1F6255A4B2c1a545c9F5Cc9708A4d` |
| **ProtocolRegistry** | `0x7c255412E311Cf3fd40515b0CCE3270c7f5c9CCd` |

#### Deployment Details
- **Deployment Mode**: Multi-protocol
- **Protocols**: LayerZero, Celer IM
- **Deployer**: `0x6Fb9955AA9d3f77CB3281633FC6e57B249a26b21`
- **Initial Supply**: 20,000 LOOK (manually minted)
- **Max Supply**: 5,000,000,000 LOOK

### Oasis Sapphire Mainnet (Chain ID: 23295)

#### Core Contracts
| Contract | Address |
|----------|---------|
| **LookCoin** | `0xe71BEF0472C96c0D255Bd4ec40CB4A0618B53A2C` |
| **SupplyOracle** | `0x7Cb7AaA5C7098BaF3BE1E6649d64b1e236E98ca8` |

#### Protocol Modules
| Contract | Address |
|----------|---------|
| **CelerIMModule** | `0x12EbF0ca24831d0553C073289F13E1cc014B29fF` |

#### Deployment Details
- **Deployment Mode**: Standard
- **Protocols**: Celer IM only
- **Deployer**: `0x0beC539Fd761caE579802072d9eE7fde86ED05A3`

### Planned Mainnet Deployments
- Base Mainnet
- Optimism Mainnet  
- Akashic Mainnet

## Testnet Contracts

### BSC Testnet (Chain ID: 97)

#### Core Contracts
| Contract | Address |
|----------|---------|
| **LookCoin** | `0xB8B7604628F37D611e82D22609ACE0Ca01A14e2D` |
| **SupplyOracle** | `0xd6f310c307a6FF8163A94984163D541b66077004` |

#### Protocol Modules
| Contract | Address |
|----------|---------|
| **LayerZeroModule** | `0x69e6AF742E4a3E4d8494FDA6F181E263fB77f741` |
| **CelerIMModule** | `0x03E823BE92A2526083681075430b1fd6D486D046` |

#### Infrastructure Contracts
| Contract | Address |
|----------|---------|
| **CrossChainRouter** | `0x062e72413720Fd97310E7A787284b39af9d4Ea18` |
| **FeeManager** | `0x04001c7bE59A7e0F3F7b981eC4D0cbE59e56B0E1` |
| **SecurityManager** | `0x97D543565Ab7CC09bd6643bFeD38Db56894BBAb8` |
| **ProtocolRegistry** | `0x79b98fCecED2A468bB98FCB77c3b634af9C19978` |

### Base Sepolia (Chain ID: 84532)

#### Core Contracts
| Contract | Address |
|----------|---------|
| **LookCoin** | `0xF936F96de720753D01B27C8Bb4805bE9714D612e` |
| **SupplyOracle** | `0x959bC8859Af2adF2da6168cc1fB9F434fd573a4e` |

#### Protocol Modules
| Contract | Address |
|----------|---------|
| **LayerZeroModule** | `0xe71BEF0472C96c0D255Bd4ec40CB4A0618B53A2C` |

#### Deployment Details
- **Deployment Mode**: Standard
- **Protocols**: LayerZero only
- **Deployer**: `0x0beC539Fd761caE579802072d9eE7fde86ED05A3`

### Optimism Sepolia (Chain ID: 11155420)

#### Core Contracts
| Contract | Address |
|----------|---------|
| **LookCoin** | `0xF936F96de720753D01B27C8Bb4805bE9714D612e` |
| **SupplyOracle** | `0x959bC8859Af2adF2da6168cc1fB9F434fd573a4e` |

#### Protocol Modules
| Contract | Address |
|----------|---------|
| **LayerZeroModule** | `0xe71BEF0472C96c0D255Bd4ec40CB4A0618B53A2C` |

#### Deployment Details
- **Deployment Mode**: Standard
- **Protocols**: LayerZero only
- **Deployer**: `0x0beC539Fd761caE579802072d9eE7fde86ED05A3`

### Planned Testnet Deployments
- Oasis Sapphire Testnet
- Akashic Testnet

## Contract Details

### LookCoin
- **Type**: ERC20 token with LayerZero OFT V2
- **Upgrade Pattern**: UUPS Proxy
- **Features**: Native cross-chain transfers, EIP-2612 permit, burn-and-mint mechanism
- **Total Supply Cap**: 5 billion LOOK
- **Current Minted**: 20,000 LOOK on BSC (manually minted)

### CelerIMModule  
- **Type**: Celer Inter-chain Messaging bridge
- **Upgrade Pattern**: UUPS Proxy
- **Features**: Burn-and-mint cross-chain transfers
- **Fee Structure**: 0.5% (50 basis points), min 10 LOOK, max 1000 LOOK

### SupplyOracle
- **Type**: Cross-chain supply monitoring
- **Upgrade Pattern**: UUPS Proxy
- **Features**: 15-minute reconciliation cycles, multi-sig validation (3 signatures required)
- **Tolerance**: 1000 LOOK deviation threshold

### LayerZeroModule
- **Type**: Native to LookCoin contract (not separate)
- **Features**: Direct OFT V2 integration, dual-path support (sendFrom and bridgeToken)

### Infrastructure Contracts (BSC Only)
- **CrossChainRouter**: Unified interface for multi-protocol bridging
- **FeeManager**: Protocol-specific fee management
- **SecurityManager**: Security controls
- **ProtocolRegistry**: Protocol registration and metadata

## Network Status

### Deployed and Configured
- **BSC Mainnet**: ✅ (Home chain, multi-protocol)
- **BSC Testnet**: ✅ (Multi-protocol)
- **Base Sepolia**: ✅ (LayerZero only)
- **Optimism Sepolia**: ✅ (LayerZero only)
- **Oasis Sapphire Mainnet**: ✅ (Celer only)

### Cross-Chain Configuration
- BSC Testnet ↔ Base Sepolia ↔ Optimism Sepolia: ✅ Configured
- Sapphire Mainnet: Awaiting other mainnet deployments for configuration

## Notes

- All addresses shown are proxy contract addresses
- Implementation addresses are managed internally via UUPS pattern
- Contracts are verified on respective block explorers
- For ABIs and implementation details, see deployment artifacts in `/deployments` directory
- No tokens are minted during deployment - all minting is manual