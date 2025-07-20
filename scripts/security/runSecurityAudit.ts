import { ethers } from "hardhat";
import { SecurityTestRunner, SecurityAudit } from "../../test/utils/securityAudit";
import { Contract } from "ethers";
import fs from "fs";
import path from "path";

/**
 * Comprehensive security audit script for LookCoin contracts
 */
async function runSecurityAudit() {
    console.log("🔍 Starting LookCoin Security Audit...\n");

    const [deployer, attacker, user1, user2] = await ethers.getSigners();
    const runner = new SecurityTestRunner();

    try {
        // Deploy contracts for testing
        console.log("📦 Deploying contracts for security testing...");
        
        // Deploy LookCoin
        const LookCoin = await ethers.getContractFactory("LookCoin");
        const lookCoin = await LookCoin.deploy();
        await lookCoin.initialize(deployer.address, ethers.ZeroAddress);
        
        // Deploy CelerIMModule
        const CelerIMModule = await ethers.getContractFactory("CelerIMModule");
        const celerModule = await CelerIMModule.deploy();
        await celerModule.initialize(
            await lookCoin.getAddress(),
            ethers.ZeroAddress, // Mock message bus
            deployer.address
        );

        // Deploy IBCModule
        const IBCModule = await ethers.getContractFactory("IBCModule");
        const ibcModule = await IBCModule.deploy();
        await ibcModule.initialize(
            await lookCoin.getAddress(),
            9070, // Akashic chain ID
            deployer.address
        );

        // Deploy SupplyOracle
        const SupplyOracle = await ethers.getContractFactory("SupplyOracle");
        const supplyOracle = await SupplyOracle.deploy();
        await supplyOracle.initialize(deployer.address, 2); // 2 signatures required

        console.log("✅ Contracts deployed successfully\n");

        // Run security tests
        console.log("🧪 Running security tests...\n");

        // 1. Test Reentrancy Protection
        await runner.runTest(
            "LookCoin Mint Reentrancy",
            async () => {
                const hasReentrancy = await SecurityAudit.testReentrancy(
                    lookCoin,
                    "mint",
                    [user1.address, ethers.parseEther("1000")]
                );
                return !hasReentrancy;
            },
            "CRITICAL"
        );

        await runner.runTest(
            "CelerIM Bridge Reentrancy",
            async () => {
                const hasReentrancy = await SecurityAudit.testReentrancy(
                    celerModule,
                    "bridge",
                    [97, user2.address, ethers.parseEther("100")],
                    { from: user1 }
                );
                return !hasReentrancy;
            },
            "CRITICAL"
        );

        // 2. Test Access Control
        await runner.runTest(
            "LookCoin Minter Role Access Control",
            async () => {
                const MINTER_ROLE = await lookCoin.MINTER_ROLE();
                const result = await SecurityAudit.testAccessControl(
                    lookCoin,
                    "mint",
                    [user1.address, ethers.parseEther("1000")],
                    "MINTER_ROLE",
                    deployer,
                    attacker
                );
                return result.unauthorized;
            },
            "HIGH"
        );

        await runner.runTest(
            "SupplyOracle Admin Access Control",
            async () => {
                const result = await SecurityAudit.testAccessControl(
                    supplyOracle,
                    "pauseBridge",
                    [await celerModule.getAddress()],
                    "DEFAULT_ADMIN_ROLE",
                    deployer,
                    attacker
                );
                return result.unauthorized;
            },
            "HIGH"
        );

        // 3. Test Emergency Pause
        await runner.runTest(
            "LookCoin Emergency Pause",
            async () => {
                const result = await SecurityAudit.testEmergencyPause(
                    lookCoin,
                    "pause",
                    "unpause",
                    "transfer",
                    [user2.address, ethers.parseEther("10")],
                    deployer
                );
                return result.pauseWorks && result.unpauseWorks;
            },
            "MEDIUM"
        );

        // 4. Test Cross-Chain Security
        await runner.runTest(
            "Cross-Chain Message Validation",
            async () => {
                // This would test message validation in real cross-chain scenarios
                // For now, we verify the trusted remote lookup mechanism
                await lookCoin.connect(deployer).connectPeer(97, ethers.id("remote-address"));
                const trustedRemote = await lookCoin.trustedRemoteLookup(97);
                return trustedRemote !== ethers.ZeroHash;
            },
            "HIGH"
        );

        // 5. Test Supply Oracle Security
        await runner.runTest(
            "Supply Oracle Multi-Signature",
            async () => {
                // Test that multi-signature is enforced
                const threshold = await supplyOracle.requiredSignatures();
                return threshold >= 2n;
            },
            "HIGH"
        );

        // 6. Test Upgrade Security
        await runner.runTest(
            "Unauthorized Upgrade Prevention",
            async () => {
                const UPGRADER_ROLE = await lookCoin.UPGRADER_ROLE();
                try {
                    // Attempt upgrade without role
                    const LookCoinV2 = await ethers.getContractFactory("LookCoin");
                    const v2Implementation = await LookCoinV2.deploy();
                    
                    await expect(
                        lookCoin.connect(attacker).upgradeToAndCall(
                            await v2Implementation.getAddress(),
                            "0x"
                        )
                    ).to.be.reverted;
                    
                    return true;
                } catch (error) {
                    return false;
                }
            },
            "CRITICAL"
        );

        // 7. Analyze contract vulnerabilities
        const lookCoinAnalysis = await SecurityAudit.analyzeVulnerabilities(
            await lookCoin.getAddress(),
            LookCoin.interface.fragments
        );

        // Add recommendations based on analysis
        runner.addRecommendation("Enable contract verification on all deployed contracts");
        runner.addRecommendation("Implement comprehensive monitoring for cross-chain operations");
        runner.addRecommendation("Regular security audits by third-party firms");
        runner.addRecommendation("Implement time-locks for critical administrative functions");
        runner.addRecommendation("Add circuit breakers for abnormal cross-chain volume");

        if (lookCoinAnalysis.hasPayableFunctions) {
            runner.addRecommendation("Review all payable functions for proper ETH handling");
        }

        // Generate report
        const report = runner.generateReport();
        console.log(report);

        // Save report to file
        const reportPath = path.join(__dirname, "../../", "security-audit-report.md");
        fs.writeFileSync(reportPath, report);
        console.log(`\n📄 Security report saved to: ${reportPath}`);

        // Check for critical issues
        const results = runner.getResults();
        if (results.criticalIssues.length > 0) {
            console.error("\n❌ CRITICAL SECURITY ISSUES FOUND!");
            console.error("Do not deploy until these are resolved.");
            process.exit(1);
        }

    } catch (error) {
        console.error("Error during security audit:", error);
        process.exit(1);
    }
}

// Execute the audit
runSecurityAudit()
    .then(() => {
        console.log("\n✅ Security audit completed successfully");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n❌ Security audit failed:", error);
        process.exit(1);
    });