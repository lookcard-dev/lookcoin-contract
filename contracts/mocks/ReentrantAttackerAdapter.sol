// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./MockReentrantAttacker.sol";

/**
 * @title ReentrantAttackerAdapter
 * @dev Adapter to trigger reentrancy attacks when MockVulnerableToken calls hooks
 * Now triggers the attacker's receive function instead of non-existent hook methods
 */
contract ReentrantAttackerAdapter {
    MockReentrantAttacker public immutable attacker;
    
    constructor(address payable _attacker) {
        attacker = MockReentrantAttacker(_attacker);
    }
    
    // Implement IMintBurnHook interface for MockVulnerableToken
    function onBeforeMint(address /* operator */, address to, uint256 amount) external {
        // Trigger reentrancy by sending ETH to attacker's receive function
        if (address(this).balance > 0) {
            (bool success,) = payable(address(attacker)).call{value: 1 wei}("");
            // Don't revert if call fails to avoid breaking the test flow
        }
    }
    
    function onAfterMint(address /* operator */, address /* to */, uint256 /* amount */) external {
        // No action needed for after hooks in this test scenario
    }
    
    function onBeforeBurn(address /* operator */, address /* from */, uint256 /* amount */) external {
        // Trigger reentrancy by calling attacker's fallback function
        (bool success,) = address(attacker).call(abi.encodeWithSignature("triggerFallback()"));
        // Don't revert if call fails to avoid breaking the test flow
    }
    
    function onAfterBurn(address /* operator */, address /* from */, uint256 /* amount */) external {
        // No action needed for after hooks in this test scenario
    }
    
    // Allow this contract to receive ETH so it can forward to attacker
    receive() external payable {}
}