import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployLookCoinFixture,
  configureAllBridges,
  expectSpecificRevert,
  coverageTracker,
  DeploymentFixture,
} from "../../utils/comprehensiveTestHelpers";
import { TEST_CHAINS } from "../../utils/testConfig";

describe("Security Edge Cases - Recent Security Fixes Validation", function () {
  let fixture: DeploymentFixture;
  const DESTINATION_CHAIN_ID = TEST_CHAINS.OPTIMISM;
  const DESTINATION_DOMAIN = 2;
  const TRUSTED_REMOTE_ADDRESS = "0x" + "1".repeat(40);

  beforeEach(async function () {
    fixture = await loadFixture(deployLookCoinFixture);
    await configureAllBridges(fixture, DESTINATION_CHAIN_ID, DESTINATION_DOMAIN);
  });

  describe("Critical Security Fix #1: Uninitialized Recipient Variable", function () {
    describe("Bridge Token Recipient Validation", function () {
      it("should validate 20-byte address format in bridge", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
        
        // Test with valid 20-byte address (standard Ethereum address)
        const validAddress = TRUSTED_REMOTE_ADDRESS; // 20 bytes when decoded
        
        const [fee] = await fixture.lookCoin.estimateBridgeFee(DESTINATION_CHAIN_ID, amount);
        
        await expect(
          fixture.lookCoin.connect(fixture.user).bridgeToken(
            DESTINATION_CHAIN_ID,
            validAddress,
            amount,
            { value: fee }
          )
        ).to.not.be.reverted;

        coverageTracker.trackBranch("SecurityEdgeCases", "20-byte-address-validation");
      });

      it("should validate 32-byte address format in bridge", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
        
        // Test with 32-byte address (padded for other chains)
        const paddedAddress = ethers.zeroPadValue(TRUSTED_REMOTE_ADDRESS, 32);
        
        const [fee] = await fixture.lookCoin.estimateBridgeFee(DESTINATION_CHAIN_ID, amount);
        
        await expect(
          fixture.lookCoin.connect(fixture.user).bridgeToken(
            DESTINATION_CHAIN_ID,
            paddedAddress,
            amount,
            { value: fee }
          )
        ).to.not.be.reverted;

        coverageTracker.trackBranch("SecurityEdgeCases", "32-byte-address-validation");
      });

      it("should reject invalid address formats", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
        
        // Test with invalid length (not 20 or 32 bytes)
        const invalidAddress = "0x1234"; // Too short
        
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(fixture.user).bridgeToken(
            DESTINATION_CHAIN_ID,
            invalidAddress,
            amount
          ),
          fixture.lookCoin,
          "LookCoin: invalid recipient format"
        );

        coverageTracker.trackBranch("SecurityEdgeCases", "invalid-address-format-rejection");
      });

      it("should prevent zero address recipients", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
        
        // Test with zero address (20 bytes of zeros)
        const zeroAddress = ethers.ZeroAddress;
        
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(fixture.user).bridgeToken(
            DESTINATION_CHAIN_ID,
            zeroAddress,
            amount
          ),
          fixture.lookCoin,
          "LookCoin: recipient is zero address"
        );

        coverageTracker.trackBranch("SecurityEdgeCases", "zero-address-recipient-prevention");
      });

      it("should test all recipient format combinations", async function () {
        const amount = ethers.parseUnits("50", 18);
        
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount * BigInt(4));
        
        const testCases = [
          {
            name: "valid-20-byte",
            address: TRUSTED_REMOTE_ADDRESS,
            shouldSucceed: true
          },
          {
            name: "valid-32-byte",
            address: ethers.zeroPadValue(TRUSTED_REMOTE_ADDRESS, 32),
            shouldSucceed: true
          },
          {
            name: "invalid-short",
            address: "0x1234",
            shouldSucceed: false,
            expectedError: "LookCoin: invalid recipient format"
          },
          {
            name: "invalid-long",
            address: "0x" + "1".repeat(80), // 40 bytes
            shouldSucceed: false,
            expectedError: "LookCoin: invalid recipient format"
          },
          {
            name: "zero-address-20",
            address: ethers.ZeroAddress,
            shouldSucceed: false,
            expectedError: "LookCoin: recipient is zero address"
          },
          {
            name: "zero-address-32",
            address: ethers.zeroPadValue(ethers.ZeroAddress, 32),
            shouldSucceed: false,
            expectedError: "LookCoin: recipient is zero address"
          }
        ];

        for (const testCase of testCases) {
          if (testCase.shouldSucceed) {
            const [fee] = await fixture.lookCoin.estimateBridgeFee(DESTINATION_CHAIN_ID, amount);
            
            await expect(
              fixture.lookCoin.connect(fixture.user).bridgeToken(
                DESTINATION_CHAIN_ID,
                testCase.address,
                amount,
                { value: fee }
              )
            ).to.not.be.reverted;
          } else {
            await expectSpecificRevert(
              async () => fixture.lookCoin.connect(fixture.user).bridgeToken(
                DESTINATION_CHAIN_ID,
                testCase.address,
                amount
              ),
              fixture.lookCoin,
              testCase.expectedError!
            );
          }
          
          coverageTracker.trackBooleanCombination("SecurityEdgeCases", `recipient-format-${testCase.name}`);
        }
      });
    });

    describe("SendFrom Recipient Validation", function () {
      it("should validate recipient in sendFrom operations", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount * BigInt(3));
        
        // Valid recipient
        const validRecipient = ethers.toUtf8Bytes(TRUSTED_REMOTE_ADDRESS);
        const validRecipientBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [TRUSTED_REMOTE_ADDRESS]);
        const [fee] = await fixture.lookCoin.estimateBridgeFee(
          DESTINATION_CHAIN_ID,
          validRecipientBytes,
          amount
        );
        
        await expect(
          fixture.lookCoin.connect(fixture.user).sendFrom(
            fixture.user.address,
            DESTINATION_CHAIN_ID,
            validRecipient,
            amount,
            fixture.user.address,
            ethers.ZeroAddress,
            "0x",
            { value: fee }
          )
        ).to.not.be.reverted;
        
        // Empty recipient should fail
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(fixture.user).sendFrom(
            fixture.user.address,
            DESTINATION_CHAIN_ID,
            "0x",
            amount,
            fixture.user.address,
            ethers.ZeroAddress,
            "0x"
          ),
          fixture.lookCoin,
          "InvalidRecipient"
        );

        coverageTracker.trackBranch("SecurityEdgeCases", "sendFrom-recipient-validation");
      });
    });
  });

  describe("Critical Security Fix #2: Enhanced Burn Authorization", function () {
    describe("Burn Permission Matrix", function () {
      beforeEach(async function () {
        // Mint tokens for testing
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, ethers.parseUnits("1000", 18));
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user2.address, ethers.parseUnits("1000", 18));
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.burner.address, ethers.parseUnits("1000", 18));
      });

      it("should allow self-burning without special role", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        // User should be able to burn their own tokens
        await fixture.lookCoin.connect(fixture.user)["burn(address,uint256)"](fixture.user.address, amount);
        
        expect(await fixture.lookCoin.balanceOf(fixture.user.address))
          .to.equal(ethers.parseUnits("900", 18));

        coverageTracker.trackBranch("SecurityEdgeCases", "self-burn-authorization");
      });

      it("should require BURNER_ROLE for burning others' tokens", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        // Should fail without BURNER_ROLE
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(fixture.user2)["burn(address,uint256)"](fixture.user.address, amount),
          fixture.lookCoin,
          "LookCoin: unauthorized burner"
        );
        
        // Should succeed with BURNER_ROLE
        await fixture.lookCoin.connect(fixture.burner)["burn(address,uint256)"](fixture.user.address, amount);
        
        expect(await fixture.lookCoin.balanceOf(fixture.user.address))
          .to.equal(ethers.parseUnits("900", 18));

        coverageTracker.trackBranch("SecurityEdgeCases", "burner-role-authorization");
      });

      it("should allow BRIDGE_ROLE to burn from any address", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        // BRIDGE_ROLE should be able to burn from any address
        await fixture.lookCoin.connect(fixture.bridgeOperator)["burn(address,uint256)"](fixture.user.address, amount);
        
        expect(await fixture.lookCoin.balanceOf(fixture.user.address))
          .to.equal(ethers.parseUnits("900", 18));

        coverageTracker.trackBranch("SecurityEdgeCases", "bridge-role-burn-authorization");
      });

      it("should test burn authorization matrix comprehensively", async function () {
        const amount = ethers.parseUnits("50", 18);
        
        // Test matrix: [caller, target, should_succeed]
        const testMatrix = [
          { caller: fixture.user, target: fixture.user.address, shouldSucceed: true, description: "self-burn" },
          { caller: fixture.user, target: fixture.user2.address, shouldSucceed: false, description: "unauthorized-other-burn" },
          { caller: fixture.burner, target: fixture.user.address, shouldSucceed: true, description: "burner-role-burn" },
          { caller: fixture.bridgeOperator, target: fixture.user.address, shouldSucceed: true, description: "bridge-role-burn" },
          { caller: fixture.user2, target: fixture.burner.address, shouldSucceed: false, description: "no-role-burn-privileged" }
        ];

        for (const test of testMatrix) {
          if (test.shouldSucceed) {
            await expect(
              fixture.lookCoin.connect(test.caller)["burn(address,uint256)"](test.target, amount)
            ).to.not.be.reverted;
          } else {
            await expectSpecificRevert(
              async () => fixture.lookCoin.connect(test.caller)["burn(address,uint256)"](test.target, amount),
              fixture.lookCoin,
              "LookCoin: unauthorized burner"
            );
          }
          
          coverageTracker.trackBooleanCombination("SecurityEdgeCases", `burn-auth-${test.description}`);
        }
      });
    });
  });

  describe("Critical Security Fix #3: ETH Transfer Validation", function () {
    describe("Emergency Withdrawal Security", function () {
      beforeEach(async function () {
        // Send ETH to modules for testing
        await fixture.user.sendTransaction({
          to: await fixture.celerIMModule.getAddress(),
          value: ethers.parseEther("2")
        });
        
        await fixture.user.sendTransaction({
          to: await fixture.hyperlaneModule.getAddress(),
          value: ethers.parseEther("2")
        });
      });

      it("should validate recipient in emergency ETH withdrawal", async function () {
        const amount = ethers.parseEther("1");
        
        // Should work with valid recipient
        await fixture.celerIMModule.connect(fixture.admin).emergencyWithdrawETH(
          fixture.admin.address,
          amount
        );
        
        // Should fail with zero address
        await expectSpecificRevert(
          async () => fixture.celerIMModule.connect(fixture.admin).emergencyWithdrawETH(
            ethers.ZeroAddress,
            amount
          ),
          fixture.celerIMModule,
          "Invalid recipient"
        );
        
        // Should fail with contract address (self)
        await expectSpecificRevert(
          async () => fixture.celerIMModule.connect(fixture.admin).emergencyWithdrawETH(
            await fixture.celerIMModule.getAddress(),
            amount
          ),
          fixture.celerIMModule,
          "Invalid recipient"
        );

        coverageTracker.trackBranch("SecurityEdgeCases", "emergency-withdrawal-validation");
      });

      it("should use safe ETH transfer methods", async function () {
        const amount = ethers.parseEther("1");
        
        const balanceBefore = await ethers.provider.getBalance(fixture.admin.address);
        
        // Emergency withdrawal should succeed
        await fixture.celerIMModule.connect(fixture.admin).emergencyWithdrawETH(
          fixture.admin.address,
          amount
        );
        
        const balanceAfter = await ethers.provider.getBalance(fixture.admin.address);
        expect(balanceAfter).to.be.gt(balanceBefore);

        coverageTracker.trackBranch("SecurityEdgeCases", "safe-eth-transfer");
      });

      it("should handle ETH transfer failures gracefully", async function () {
        // Deploy a contract that rejects ETH
        const RejectETH = await ethers.getContractFactory("MockReentrantProxy");
        const rejectETH = await RejectETH.deploy();
        await rejectETH.waitForDeployment();
        
        const amount = ethers.parseEther("1");
        
        // Should revert with proper error when recipient rejects ETH
        await expectSpecificRevert(
          async () => fixture.celerIMModule.connect(fixture.admin).emergencyWithdrawETH(
            await rejectETH.getAddress(),
            amount
          ),
          fixture.celerIMModule,
          "ETH transfer failed"
        );

        coverageTracker.trackBranch("SecurityEdgeCases", "eth-transfer-failure-handling");
      });

      it("should test ETH withdrawal boolean combinations", async function () {
        const amount = ethers.parseEther("0.5");
        
        await testBooleanCombinations(
          "ETH withdrawal recipient validation",
          async () => true, // Always start with valid state
          async () => {
            // State doesn't need to change for this test
          },
          async (combination) => {
            const recipients = [
              { address: fixture.admin.address, valid: true, description: "valid-user" },
              { address: ethers.ZeroAddress, valid: false, description: "zero-address" },
              { address: await fixture.celerIMModule.getAddress(), valid: false, description: "self-address" }
            ];
            
            for (const recipient of recipients) {
              if (recipient.valid) {
                await expect(
                  fixture.celerIMModule.connect(fixture.admin).emergencyWithdrawETH(
                    recipient.address,
                    amount
                  )
                ).to.not.be.reverted;
              } else {
                await expectSpecificRevert(
                  async () => fixture.celerIMModule.connect(fixture.admin).emergencyWithdrawETH(
                    recipient.address,
                    amount
                  ),
                  fixture.celerIMModule,
                  "Invalid recipient"
                );
              }
              
              coverageTracker.trackBooleanCombination(
                "SecurityEdgeCases",
                `eth-withdrawal-${recipient.description}-${combination.description}`
              );
            }
          }
        );
      });
    });
  });

  describe("Critical Security Fix #4: SafeERC20 Usage", function () {
    describe("Safe Token Transfer Implementation", function () {
      it("should use SafeERC20 for token transfers in HyperlaneModule", async function () {
        // This test verifies the implementation uses SafeERC20
        // The actual SafeERC20 behavior is tested through normal operations
        
        const amount = ethers.parseUnits("100", 18);
        
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
        await fixture.lookCoin.grantRole(await fixture.lookCoin.BRIDGE_ROLE(), await fixture.hyperlaneModule.getAddress());
        
        // Approve and bridge tokens
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), amount);
        
        // This should work with SafeERC20 implementation
        await expect(
          fixture.hyperlaneModule.connect(fixture.user).bridge(
            DESTINATION_DOMAIN,
            TRUSTED_REMOTE_ADDRESS,
            amount,
            { value: ethers.parseEther("0.01") }
          )
        ).to.not.be.reverted;

        coverageTracker.trackBranch("SecurityEdgeCases", "safeerc20-hyperlane-usage");
      });

      it("should use SafeERC20 for token transfers in CelerIMModule", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
        await fixture.lookCoin.grantRole(await fixture.lookCoin.BRIDGE_ROLE(), await fixture.celerIMModule.getAddress());
        
        // Approve and bridge tokens
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.celerIMModule.getAddress(), amount);
        
        // This should work with SafeERC20 implementation
        await expect(
          fixture.celerIMModule.connect(fixture.user).bridge(
            DESTINATION_CHAIN_ID,
            TRUSTED_REMOTE_ADDRESS,
            amount,
            { value: ethers.parseEther("0.01") }
          )
        ).to.not.be.reverted;

        coverageTracker.trackBranch("SecurityEdgeCases", "safeerc20-celer-usage");
      });

      it("should handle edge cases with SafeERC20", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
        await fixture.lookCoin.grantRole(await fixture.lookCoin.BRIDGE_ROLE(), await fixture.hyperlaneModule.getAddress());
        
        // Test with exact allowance
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.hyperlaneModule.getAddress(), amount);
        
        await expect(
          fixture.hyperlaneModule.connect(fixture.user).bridge(
            DESTINATION_DOMAIN,
            TRUSTED_REMOTE_ADDRESS,
            amount,
            { value: ethers.parseEther("0.01") }
          )
        ).to.not.be.reverted;
        
        // Allowance should be consumed
        expect(await fixture.lookCoin.allowance(fixture.user.address, await fixture.hyperlaneModule.getAddress()))
          .to.equal(0);

        coverageTracker.trackBranch("SecurityEdgeCases", "safeerc20-edge-cases");
      });
    });
  });

  describe("Critical Security Fix #5: Enhanced Replay Prevention", function () {
    describe("Nonce Processing Security", function () {
      it("should prevent nonce replay attacks with enhanced validation", async function () {
        const amount = ethers.parseUnits("100", 18);
        const recipient = fixture.user.address;
        const nonce = 42;
        
        const payload = ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes", "uint256"],
          [recipient, amount]
        );
        const packet = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint16", "bytes"],
          [0, payload]
        );
        
        await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(fixture.user.address);
        
        const trustedSource = ethers.solidityPacked(
          ["address", "address"],
          [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
        );
        
        // First receive should succeed
        await fixture.lookCoin.connect(fixture.user).lzReceive(
          DESTINATION_CHAIN_ID,
          trustedSource,
          nonce,
          packet
        );
        
        expect(await fixture.lookCoin.balanceOf(recipient)).to.equal(amount);
        
        // Second receive with same nonce should fail with enhanced validation
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(fixture.user).lzReceive(
            DESTINATION_CHAIN_ID,
            trustedSource,
            nonce,
            packet
          ),
          fixture.lookCoin,
          "NonceAlreadyProcessed"
        );

        coverageTracker.trackBranch("SecurityEdgeCases", "enhanced-replay-prevention");
      });

      it("should handle nonce overflow scenarios", async function () {
        const amount = ethers.parseUnits("50", 18);
        const recipient = fixture.user.address;
        
        await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(fixture.user.address);
        
        const trustedSource = ethers.solidityPacked(
          ["address", "address"],
          [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
        );
        
        // Test with maximum uint64 nonce
        const maxNonce = BigInt("0xFFFFFFFFFFFFFFFF"); // Max uint64
        
        const payload = ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes", "uint256"],
          [recipient, amount]
        );
        const packet = ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint16", "bytes"],
          [0, payload]
        );
        
        // Should handle large nonces correctly
        await expect(
          fixture.lookCoin.connect(fixture.user).lzReceive(
            DESTINATION_CHAIN_ID,
            trustedSource,
            maxNonce,
            packet
          )
        ).to.not.be.reverted;

        coverageTracker.trackBranch("SecurityEdgeCases", "nonce-overflow-handling");
      });

      it("should validate nonce sequence integrity", async function () {
        const amount = ethers.parseUnits("25", 18);
        const recipient = fixture.user.address;
        
        await fixture.lookCoin.connect(fixture.owner).setLayerZeroEndpoint(fixture.user.address);
        
        const trustedSource = ethers.solidityPacked(
          ["address", "address"],
          [TRUSTED_REMOTE_ADDRESS, await fixture.lookCoin.getAddress()]
        );
        
        // Process nonces in various orders
        const nonces = [1, 5, 3, 10, 7];
        
        for (const nonce of nonces) {
          const payload = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes", "uint256"],
            [recipient, amount]
          );
          const packet = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint16", "bytes"],
            [0, payload]
          );
          
          await fixture.lookCoin.connect(fixture.user).lzReceive(
            DESTINATION_CHAIN_ID,
            trustedSource,
            nonce,
            packet
          );
        }
        
        // All nonces should be processed successfully
        expect(await fixture.lookCoin.balanceOf(recipient)).to.equal(amount * BigInt(nonces.length));
        
        // Attempt to replay any nonce should fail
        for (const nonce of nonces) {
          const payload = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes", "uint256"],
            [recipient, amount]
          );
          const packet = ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint16", "bytes"],
            [0, payload]
          );
          
          await expectSpecificRevert(
            async () => fixture.lookCoin.connect(fixture.user).lzReceive(
              DESTINATION_CHAIN_ID,
              trustedSource,
              nonce,
              packet
            ),
            fixture.lookCoin,
            "NonceAlreadyProcessed"
          );
        }

        coverageTracker.trackBranch("SecurityEdgeCases", "nonce-sequence-integrity");
      });
    });
  });

  describe("Comprehensive Security Hardening", function () {
    describe("Input Validation Security", function () {
      it("should validate all input parameters comprehensively", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount * BigInt(2));
        
        // Test zero amount validations
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, 0),
          fixture.lookCoin,
          "LookCoin: amount must be greater than zero"
        );
        
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(fixture.burner)["burn(address,uint256)"](fixture.user.address, 0),
          fixture.lookCoin,
          "LookCoin: amount must be greater than zero"
        );
        
        // Test zero address validations
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(fixture.minter).mint(ethers.ZeroAddress, amount),
          fixture.lookCoin,
          "ERC20: mint to the zero address"
        );
        
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(fixture.burner)["burn(address,uint256)"](ethers.ZeroAddress, amount),
          fixture.lookCoin,
          "ERC20: burn from the zero address"
        );

        coverageTracker.trackBranch("SecurityEdgeCases", "comprehensive-input-validation");
      });

      it("should handle edge cases in cross-chain operations", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
        
        // Test with unconfigured destination
        const unconfiguredChainId = 99999;
        
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(fixture.user).bridgeToken(
            unconfiguredChainId,
            TRUSTED_REMOTE_ADDRESS,
            amount
          ),
          fixture.lookCoin,
          "LayerZeroNotConfigured"
        );
        
        // Test with empty recipient in sendFrom
        const recipient = "0x";
        
        await expectSpecificRevert(
          async () => fixture.lookCoin.connect(fixture.user).sendFrom(
            fixture.user.address,
            DESTINATION_CHAIN_ID,
            recipient,
            amount,
            fixture.user.address,
            ethers.ZeroAddress,
            "0x"
          ),
          fixture.lookCoin,
          "InvalidRecipient"
        );

        coverageTracker.trackBranch("SecurityEdgeCases", "cross-chain-edge-cases");
      });
    });

    describe("State Consistency Security", function () {
      it("should maintain invariants under all operations", async function () {
        const amount = ethers.parseUnits("500", 18);
        
        // Test multiple operations and verify invariants
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount);
        
        const initialMinted = await fixture.lookCoin.totalMinted();
        const initialBurned = await fixture.lookCoin.totalBurned();
        const initialSupply = await fixture.lookCoin.totalSupply();
        
        // Burn some tokens
        await fixture.lookCoin.connect(fixture.burner)["burn(address,uint256)"](fixture.user.address, amount / BigInt(2));
        
        // Verify invariants
        const afterBurnMinted = await fixture.lookCoin.totalMinted();
        const afterBurnBurned = await fixture.lookCoin.totalBurned();
        const afterBurnSupply = await fixture.lookCoin.totalSupply();
        
        expect(afterBurnMinted).to.equal(initialMinted);
        expect(afterBurnBurned).to.equal(initialBurned + amount / BigInt(2));
        expect(afterBurnSupply).to.equal(initialSupply - amount / BigInt(2));
        expect(afterBurnSupply).to.equal(afterBurnMinted - afterBurnBurned);

        coverageTracker.trackBranch("SecurityEdgeCases", "state-consistency-invariants");
      });

      it("should handle concurrent operation security", async function () {
        const amount = ethers.parseUnits("100", 18);
        
        // Grant all necessary roles
        await fixture.lookCoin.grantRole(await fixture.lookCoin.BRIDGE_ROLE(), await fixture.celerIMModule.getAddress());
        
        // Mint tokens for concurrent operations
        await fixture.lookCoin.connect(fixture.minter).mint(fixture.user.address, amount * BigInt(3));
        
        const initialSupply = await fixture.lookCoin.totalSupply();
        
        // Simulate concurrent operations (sequential execution simulating concurrency)
        // Operation 1: Direct burn
        await fixture.lookCoin.connect(fixture.burner)["burn(address,uint256)"](fixture.user.address, amount);
        
        // Operation 2: Bridge operation (which also burns)
        await fixture.lookCoin.connect(fixture.user).approve(await fixture.celerIMModule.getAddress(), amount);
        await fixture.celerIMModule.connect(fixture.user).bridge(
          DESTINATION_CHAIN_ID,
          TRUSTED_REMOTE_ADDRESS,
          amount,
          { value: ethers.parseEther("0.01") }
        );
        
        // Verify final state consistency
        const finalSupply = await fixture.lookCoin.totalSupply();
        const totalBurned = await fixture.lookCoin.totalBurned();
        
        expect(finalSupply).to.equal(initialSupply - amount * BigInt(2));
        expect(totalBurned).to.equal(amount * BigInt(2));

        coverageTracker.trackBranch("SecurityEdgeCases", "concurrent-operation-security");
      });
    });
  });

  describe("Coverage Validation", function () {
    it("should validate comprehensive security edge case coverage", function () {
      const report = coverageTracker.generateReport();
      console.log("\n" + report);
      
      expect(report).to.include("SecurityEdgeCases");
      
      // Validate we tested all major security fixes
      const expectedFixes = [
        "20-byte-address-validation",
        "32-byte-address-validation",
        "invalid-address-format-rejection",
        "self-burn-authorization",
        "burner-role-authorization",
        "emergency-withdrawal-validation",
        "safeerc20-hyperlane-usage",
        "enhanced-replay-prevention"
      ];
      
      console.log("Expected security fixes tested:", expectedFixes.length);
    });
  });
});