// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./XERC20.sol";
import "./interfaces/IXERC20Factory.sol";

contract XERC20Factory is IXERC20Factory {
    address public immutable xerc20Implementation;
    
    event XERC20Deployed(address indexed xerc20, string name, string symbol);
    
    constructor() {
        xerc20Implementation = address(new XERC20());
    }
    
    function deployXERC20(
        string memory name,
        string memory symbol,
        uint256 mintingLimit,
        uint256 burningLimit,
        address[] calldata bridges,
        uint256[] calldata mintingLimits,
        uint256[] calldata burningLimits
    ) external override returns (address) {
        require(
            bridges.length == mintingLimits.length && 
            bridges.length == burningLimits.length,
            "XERC20Factory: array length mismatch"
        );
        
        bytes memory initData = abi.encodeWithSelector(
            XERC20.initialize.selector,
            name,
            symbol,
            msg.sender
        );
        
        ERC1967Proxy proxy = new ERC1967Proxy(xerc20Implementation, initData);
        address xerc20 = address(proxy);
        
        // Set limits for bridges
        for (uint256 i = 0; i < bridges.length; i++) {
            XERC20(xerc20).setLimits(bridges[i], mintingLimits[i], burningLimits[i]);
        }
        
        emit XERC20Deployed(xerc20, name, symbol);
        return xerc20;
    }
}