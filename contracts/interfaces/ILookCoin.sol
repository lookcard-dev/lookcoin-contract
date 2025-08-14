// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ILookCoin
 * @dev Interface for LookCoin with minting capabilities
 */
interface ILookCoin is IERC20 {
  /**
   * @dev Mint tokens to address
   * @param to Address to mint tokens to
   * @param amount Amount to mint
   */
  function mint(address to, uint256 amount) external;

  /**
   * @dev Burn tokens from address
   * @param from Address to burn tokens from
   * @param amount Amount to burn
   */
  function burn(address from, uint256 amount) external;

  /**
   * @dev Returns the decimals places of the token
   * @return The number of decimals of the token
   */
  function decimals() external view returns (uint8);

  /**
   * @dev Bridge tokens to another chain
   * @param dstChainId Destination chain ID
   * @param toAddress Recipient address on destination chain (encoded as bytes)
   * @param amount Amount to transfer
   */
  function bridgeToken(
    uint16 dstChainId,
    bytes calldata toAddress,
    uint256 amount
  ) external payable;

  /**
   * @dev Estimate fees for cross-chain transfer
   * @param dstChainId Destination chain ID
   * @param toAddress Recipient address (encoded)
   * @param amount Amount to transfer
   * @return nativeFee Fee in native token
   * @return zroFee Fee in ZRO token
   */
  function estimateBridgeFee(
    uint16 dstChainId,
    bytes calldata toAddress,
    uint256 amount
  ) external view returns (uint nativeFee, uint zroFee);
}
