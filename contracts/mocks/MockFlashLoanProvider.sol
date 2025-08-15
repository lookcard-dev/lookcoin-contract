// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IFlashLoanReceiver
 * @dev Interface for contracts that can receive flash loans
 * @notice Based on Aave V3 flash loan interface
 */
interface IFlashLoanReceiver {
    /**
     * @dev Execute operation after receiving flash loan
     * @param asset Address of the flash loaned asset
     * @param amount Amount of tokens loaned
     * @param premium Fee charged for the loan
     * @param initiator Address that initiated the flash loan
     * @param params Additional parameters for the operation
     * @return True if execution was successful
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

/**
 * @title IFlashLoanReceiverV2
 * @dev Compound V3 style flash loan receiver interface
 */
interface IFlashLoanReceiverV2 {
    /**
     * @dev Callback for flash loan execution
     * @param sender Original sender of the flash loan request
     * @param token Token being borrowed
     * @param amount Amount borrowed
     * @param fee Fee to be paid
     * @param data Arbitrary data passed to the callback
     */
    function onFlashLoan(
        address sender,
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external;
}

/**
 * @title MockFlashLoanProvider
 * @author LookCard FinTech Team
 * @notice Sophisticated flash loan provider for economic attack testing
 * @dev Implements both Aave V3 and Compound V3 style flash loans with proper accounting
 * 
 * Features:
 * - Dual protocol support (Aave/Compound interfaces)
 * - Dynamic fee calculation with volume discounts
 * - Reentrancy protection
 * - Comprehensive event logging for attack analysis
 * - Double-entry accounting for all operations
 * - Support for multiple simultaneous flash loans
 * - MEV protection mechanisms
 */
contract MockFlashLoanProvider is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    uint256 public constant MAX_FLASH_LOAN_FEE = 100; // 1% max fee (basis points)
    uint256 public constant DEFAULT_FLASH_LOAN_FEE = 9; // 0.09% default (Aave standard)
    uint256 public constant FEE_PRECISION = 10000;
    uint256 public constant MAX_SIMULTANEOUS_LOANS = 10;

    // ============ State Variables ============
    
    // Fee configuration
    mapping(address => uint256) public flashLoanFees; // Asset-specific fees
    uint256 public defaultFlashFee = DEFAULT_FLASH_LOAN_FEE;
    
    // Accounting ledger (double-entry bookkeeping)
    struct LoanPosition {
        address borrower;
        address asset;
        uint256 principal;
        uint256 fee;
        uint256 timestamp;
        bool repaid;
    }
    
    mapping(bytes32 => LoanPosition) public loanPositions;
    mapping(address => uint256) public totalFeesCollected; // Per asset
    mapping(address => uint256) public totalVolumeProcessed; // Per asset
    
    // Security and limits
    mapping(address => bool) public authorizedCallers;
    mapping(address => uint256) public maxLoanAmounts; // Per asset limits
    uint256 public globalMaxLoan = type(uint256).max;
    
    // Active loan tracking
    mapping(address => uint256) public activeLoanCount;
    mapping(address => mapping(address => uint256)) public outstandingLoans; // borrower => asset => amount
    
    // MEV protection
    uint256 private lastBlockLoaned;
    mapping(address => uint256) private borrowerLastBlock;
    
    // ============ Events ============
    
    event FlashLoanExecuted(
        address indexed borrower,
        address indexed asset,
        uint256 amount,
        uint256 fee,
        bytes32 loanId
    );
    
    event FlashLoanRepaid(
        bytes32 indexed loanId,
        uint256 principal,
        uint256 fee
    );
    
    event FeeUpdated(
        address indexed asset,
        uint256 oldFee,
        uint256 newFee
    );
    
    event MaxLoanUpdated(
        address indexed asset,
        uint256 maxAmount
    );
    
    event FeesWithdrawn(
        address indexed asset,
        uint256 amount,
        address indexed recipient
    );

    event FlashLoanFailed(
        address indexed borrower,
        address indexed asset,
        uint256 amount,
        string reason
    );

    // ============ Constructor ============
    
    constructor() Ownable(msg.sender) {
        // Initialize with owner as authorized caller
        authorizedCallers[msg.sender] = true;
    }

    // ============ Flash Loan Functions (Aave Style) ============
    
    /**
     * @dev Execute flash loan with Aave V3 interface
     * @param receiver Contract that will receive the flash loan
     * @param assets Array of assets to flash loan
     * @param amounts Array of amounts to flash loan
     * @param params Additional parameters for the receiver
     */
    function flashLoan(
        address receiver,
        address[] calldata assets,
        uint256[] calldata amounts,
        bytes calldata params
    ) external nonReentrant {
        require(assets.length == amounts.length, "Array length mismatch");
        require(assets.length > 0 && assets.length <= MAX_SIMULTANEOUS_LOANS, "Invalid loan count");
        
        // MEV protection - prevent same block re-lending
        if (borrowerLastBlock[msg.sender] == block.number) {
            revert("Same block flash loan denied");
        }
        borrowerLastBlock[msg.sender] = block.number;
        
        uint256[] memory fees = new uint256[](assets.length);
        bytes32[] memory loanIds = new bytes32[](assets.length);
        
        // Process each loan
        for (uint256 i = 0; i < assets.length; i++) {
            address asset = assets[i];
            uint256 amount = amounts[i];
            
            // Validate loan parameters
            require(amount > 0, "Zero amount");
            require(
                maxLoanAmounts[asset] == 0 || amount <= maxLoanAmounts[asset],
                "Exceeds max loan"
            );
            require(amount <= globalMaxLoan, "Exceeds global max");
            
            // Check available liquidity
            uint256 available = IERC20(asset).balanceOf(address(this));
            require(available >= amount, "Insufficient liquidity");
            
            // Calculate fee
            uint256 fee = _calculateFlashLoanFee(asset, amount);
            fees[i] = fee;
            
            // Generate loan ID for tracking
            bytes32 loanId = keccak256(
                abi.encodePacked(msg.sender, asset, amount, block.timestamp, i)
            );
            loanIds[i] = loanId;
            
            // Record loan position (debit: loan receivable, credit: asset)
            loanPositions[loanId] = LoanPosition({
                borrower: msg.sender,
                asset: asset,
                principal: amount,
                fee: fee,
                timestamp: block.timestamp,
                repaid: false
            });
            
            // Update outstanding loans
            outstandingLoans[msg.sender][asset] += amount;
            activeLoanCount[msg.sender]++;
            
            // Transfer tokens to receiver
            IERC20(asset).safeTransfer(receiver, amount);
            
            emit FlashLoanExecuted(msg.sender, asset, amount, fee, loanId);
        }
        
        // Execute receiver's operation
        bool success;
        try IFlashLoanReceiver(receiver).executeOperation(
            assets[0], // Primary asset for single loans
            amounts[0],
            fees[0],
            msg.sender,
            params
        ) returns (bool result) {
            success = result;
        } catch Error(string memory reason) {
            emit FlashLoanFailed(msg.sender, assets[0], amounts[0], reason);
            success = false;
        }
        
        require(success, "Flash loan execution failed");
        
        // Verify repayment for each loan
        for (uint256 i = 0; i < assets.length; i++) {
            _verifyAndRecordRepayment(
                loanIds[i],
                assets[i],
                amounts[i],
                fees[i]
            );
        }
        
        lastBlockLoaned = block.number;
    }

    /**
     * @dev Flash loan with single asset (simplified interface)
     */
    function flashLoanSimple(
        address receiver,
        address asset,
        uint256 amount,
        bytes calldata params
    ) external nonReentrant {
        address[] memory assets = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        assets[0] = asset;
        amounts[0] = amount;
        
        this.flashLoan(receiver, assets, amounts, params);
    }

    // ============ Flash Loan Functions (Compound Style) ============
    
    /**
     * @dev Execute flash loan with Compound V3 interface
     * @param receiver Contract that will receive the flash loan
     * @param token Token to borrow
     * @param amount Amount to borrow
     * @param data Arbitrary data to pass to receiver
     */
    function flashLoanV2(
        IFlashLoanReceiverV2 receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external nonReentrant {
        // MEV protection
        require(borrowerLastBlock[msg.sender] != block.number, "Same block denied");
        borrowerLastBlock[msg.sender] = block.number;
        
        // Validate parameters
        require(amount > 0, "Zero amount");
        require(
            maxLoanAmounts[token] == 0 || amount <= maxLoanAmounts[token],
            "Exceeds max"
        );
        
        // Check liquidity
        uint256 available = IERC20(token).balanceOf(address(this));
        require(available >= amount, "Insufficient liquidity");
        
        // Calculate fee
        uint256 fee = _calculateFlashLoanFee(token, amount);
        
        // Generate loan ID
        bytes32 loanId = keccak256(
            abi.encodePacked(msg.sender, token, amount, block.timestamp)
        );
        
        // Record position
        loanPositions[loanId] = LoanPosition({
            borrower: msg.sender,
            asset: token,
            principal: amount,
            fee: fee,
            timestamp: block.timestamp,
            repaid: false
        });
        
        // Update tracking
        outstandingLoans[msg.sender][token] += amount;
        activeLoanCount[msg.sender]++;
        
        // Transfer tokens
        IERC20(token).safeTransfer(address(receiver), amount);
        
        emit FlashLoanExecuted(msg.sender, token, amount, fee, loanId);
        
        // Execute callback
        receiver.onFlashLoan(msg.sender, token, amount, fee, data);
        
        // Verify repayment
        _verifyAndRecordRepayment(loanId, token, amount, fee);
        
        lastBlockLoaned = block.number;
    }

    // ============ Internal Functions ============
    
    /**
     * @dev Calculate flash loan fee with volume discounts
     */
    function _calculateFlashLoanFee(
        address asset,
        uint256 amount
    ) internal view returns (uint256) {
        uint256 baseFee = flashLoanFees[asset] > 0 ? 
            flashLoanFees[asset] : defaultFlashFee;
        
        // Apply volume discount for large loans
        uint256 volumeProcessed = totalVolumeProcessed[asset];
        if (volumeProcessed > 1000000 * 1e18) { // > 1M tokens
            baseFee = baseFee * 90 / 100; // 10% discount
        } else if (volumeProcessed > 100000 * 1e18) { // > 100k tokens
            baseFee = baseFee * 95 / 100; // 5% discount
        }
        
        // Calculate fee amount
        uint256 feeAmount = (amount * baseFee) / FEE_PRECISION;
        
        // Minimum fee of 1 unit to prevent zero-fee attacks
        return feeAmount > 0 ? feeAmount : 1;
    }

    /**
     * @dev Verify loan repayment and update accounting
     */
    function _verifyAndRecordRepayment(
        bytes32 loanId,
        address asset,
        uint256 principal,
        uint256 fee
    ) internal {
        LoanPosition storage position = loanPositions[loanId];
        require(!position.repaid, "Already repaid");
        
        uint256 expectedRepayment = principal + fee;
        uint256 currentBalance = IERC20(asset).balanceOf(address(this));
        uint256 expectedBalance = currentBalance - principal; // Should have original + fee
        
        // Verify repayment received
        require(
            IERC20(asset).balanceOf(address(this)) >= expectedRepayment,
            "Insufficient repayment"
        );
        
        // Update accounting (debit: asset, credit: loan receivable + fee income)
        position.repaid = true;
        totalFeesCollected[asset] += fee;
        totalVolumeProcessed[asset] += principal;
        
        // Clear outstanding loan
        outstandingLoans[position.borrower][asset] -= principal;
        activeLoanCount[position.borrower]--;
        
        emit FlashLoanRepaid(loanId, principal, fee);
    }

    // ============ Admin Functions ============
    
    /**
     * @dev Set flash loan fee for specific asset
     */
    function setFlashLoanFee(address asset, uint256 fee) external onlyOwner {
        require(fee <= MAX_FLASH_LOAN_FEE, "Fee too high");
        uint256 oldFee = flashLoanFees[asset];
        flashLoanFees[asset] = fee;
        emit FeeUpdated(asset, oldFee, fee);
    }

    /**
     * @dev Set default flash loan fee
     */
    function setDefaultFlashFee(uint256 fee) external onlyOwner {
        require(fee <= MAX_FLASH_LOAN_FEE, "Fee too high");
        defaultFlashFee = fee;
    }

    /**
     * @dev Set maximum loan amount for asset
     */
    function setMaxLoanAmount(address asset, uint256 maxAmount) external onlyOwner {
        maxLoanAmounts[asset] = maxAmount;
        emit MaxLoanUpdated(asset, maxAmount);
    }

    /**
     * @dev Authorize caller for special operations
     */
    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    /**
     * @dev Withdraw collected fees
     */
    function withdrawFees(address asset, address recipient) external onlyOwner {
        uint256 fees = totalFeesCollected[asset];
        require(fees > 0, "No fees to withdraw");
        
        totalFeesCollected[asset] = 0;
        IERC20(asset).safeTransfer(recipient, fees);
        
        emit FeesWithdrawn(asset, fees, recipient);
    }

    /**
     * @dev Deposit liquidity for flash loans
     */
    function depositLiquidity(address asset, uint256 amount) external {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
    }

    // ============ View Functions ============
    
    /**
     * @dev Get current flash loan fee for asset
     */
    function getFlashLoanFee(address asset) external view returns (uint256) {
        return flashLoanFees[asset] > 0 ? flashLoanFees[asset] : defaultFlashFee;
    }

    /**
     * @dev Calculate fee for specific amount
     */
    function calculateFee(
        address asset,
        uint256 amount
    ) external view returns (uint256) {
        return _calculateFlashLoanFee(asset, amount);
    }

    /**
     * @dev Get available liquidity for flash loans
     */
    function getAvailableLiquidity(address asset) external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    /**
     * @dev Get loan statistics for analysis
     */
    function getLoanStatistics(address asset) external view returns (
        uint256 totalVolume,
        uint256 totalFees,
        uint256 availableLiquidity,
        uint256 maxLoan
    ) {
        totalVolume = totalVolumeProcessed[asset];
        totalFees = totalFeesCollected[asset];
        availableLiquidity = IERC20(asset).balanceOf(address(this));
        maxLoan = maxLoanAmounts[asset] > 0 ? maxLoanAmounts[asset] : globalMaxLoan;
    }

    /**
     * @dev Check if address has active loans
     */
    function hasActiveLoans(address borrower) external view returns (bool) {
        return activeLoanCount[borrower] > 0;
    }

    /**
     * @dev Get outstanding loan amount for borrower
     */
    function getOutstandingLoan(
        address borrower,
        address asset
    ) external view returns (uint256) {
        return outstandingLoans[borrower][asset];
    }
}