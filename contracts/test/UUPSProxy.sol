// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title UUPSProxy
 * @dev ERC1967 proxy for UUPS upgradeable contracts
 */
contract UUPSProxy is ERC1967Proxy {
    constructor(address _logic, bytes memory _data) ERC1967Proxy(_logic, _data) {}
}