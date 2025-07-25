# LookCoin Contract Addresses

This document contains the deployed contract addresses for LookCoin across all networks. Only proxy addresses are listed for upgradeable contracts.

## Mainnet Contracts

### BSC Mainnet (Chain ID: 56)

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

### Planned Mainnet Deployments
- Base Mainnet
- Optimism Mainnet  
- Oasis Sapphire Mainnet
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

### Planned Testnet Deployments
- Base Sepolia
- Optimism Sepolia
- Oasis Sapphire Testnet
- Akashic Testnet

## Contract Details

### LookCoin
- **Type**: ERC20 token with LayerZero OFT V2
- **Upgrade Pattern**: UUPS Proxy
- **Features**: Native cross-chain transfers, EIP-2612 permit

### CelerIMModule  
- **Type**: Celer Inter-chain Messaging bridge
- **Upgrade Pattern**: UUPS Proxy
- **Features**: Burn-and-mint cross-chain transfers

### SupplyOracle
- **Type**: Cross-chain supply monitoring
- **Upgrade Pattern**: UUPS Proxy
- **Features**: 15-minute reconciliation cycles

## Notes

- All addresses shown are proxy contract addresses
- Implementation addresses are managed internally via UUPS pattern
- Contracts are verified on respective block explorers
- For ABIs and implementation details, see deployment artifacts in `/deployments` directory