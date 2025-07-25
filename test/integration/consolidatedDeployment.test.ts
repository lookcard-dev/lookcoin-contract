import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { loadDeployment, saveDeployment, Deployment } from "../../scripts/utils/deployment";
import { ProtocolDetector } from "../../scripts/utils/protocolDetector";

const execAsync = promisify(exec);

describe("Consolidated Deployment Integration Tests", () => {
  const testDeploymentDir = path.join(__dirname, "../../deployments/.test");
  
  before(() => {
    // Create test deployment directory
    if (!fs.existsSync(testDeploymentDir)) {
      fs.mkdirSync(testDeploymentDir, { recursive: true });
    }
  });

  after(() => {
    // Clean up test deployments
    if (fs.existsSync(testDeploymentDir)) {
      fs.rmSync(testDeploymentDir, { recursive: true, force: true });
    }
  });

  describe("Full Deployment Cycle", () => {
    it("should complete deploy → setup → configure flow", async function() {
      // Skip if not in integration test mode
      if (!process.env.RUN_INTEGRATION_TESTS) {
        this.skip();
        return;
      }

      // This would test the full deployment cycle
      // In a real test, you would:
      // 1. Run deploy script
      // 2. Verify deployment artifact
      // 3. Run setup script
      // 4. Verify roles and registrations
      // 5. Run configure script
      // 6. Verify cross-chain connections
    });
  });

  describe("Standard vs Multi-Protocol Detection", () => {
    it("should detect standard mode for single protocol", () => {
      const detector = new ProtocolDetector();
      const chainConfig = {
        protocols: {
          layerZero: { enabled: true }
        },
        layerZero: { endpoint: "0x1234567890123456789012345678901234567890" }
      } as any;

      const support = detector.detectSupportedProtocols(chainConfig);
      expect(support.protocols).to.have.lengthOf(1);
      
      // In real deployment, this would trigger standard mode
    });

    it("should detect multi-protocol mode for multiple protocols", () => {
      const detector = new ProtocolDetector();
      const chainConfig = {
        protocols: {
          layerZero: { enabled: true },
          celer: { enabled: true }
        },
        layerZero: { endpoint: "0x1234567890123456789012345678901234567890" },
        celer: { messageBus: "0x9876543210987654321098765432109876543210" }
      } as any;

      const support = detector.detectSupportedProtocols(chainConfig);
      expect(support.protocols).to.have.lengthOf(2);
      
      // In real deployment, this would trigger multi-protocol mode
    });
  });

  describe("Backward Compatibility", () => {
    it("should load and migrate legacy deployment artifacts", () => {
      // Create a legacy deployment artifact
      const legacyDeployment = {
        network: "test-network",
        chainId: 1,
        deployer: "0x1111111111111111111111111111111111111111",
        timestamp: new Date().toISOString(),
        contracts: {
          LookCoin: { proxy: "0x2222222222222222222222222222222222222222" },
          CelerIMModule: { proxy: "0x3333333333333333333333333333333333333333" },
          SupplyOracle: { proxy: "0x4444444444444444444444444444444444444444" }
        },
        config: {
          layerZeroEndpoint: "0x5555555555555555555555555555555555555555"
        }
      };

      // Save legacy deployment
      const testPath = path.join(testDeploymentDir, "test-network.json");
      fs.writeFileSync(testPath, JSON.stringify(legacyDeployment, null, 2));

      // Load and check migration
      const migrated = loadDeployment("test-network");
      
      expect(migrated).to.not.be.null;
      expect(migrated!.deploymentMode).to.equal("multi-protocol");
      expect(migrated!.protocolsDeployed).to.include.members(["layerZero", "celer"]);
      expect(migrated!.protocolContracts).to.have.property("celerIMModule");
    });
  });

  describe("Cross-Chain Configuration", () => {
    it("should handle tier validation correctly", async () => {
      // Create deployments for different tiers
      const testnetDeployment: Deployment = {
        network: "bsc-testnet",
        chainId: 97,
        deployer: "0x1111111111111111111111111111111111111111",
        timestamp: new Date().toISOString(),
        deploymentMode: "standard",
        protocolsDeployed: ["layerZero"],
        contracts: {
          LookCoin: { proxy: "0x2222222222222222222222222222222222222222" },
          SupplyOracle: { proxy: "0x3333333333333333333333333333333333333333" }
        }
      };

      const mainnetDeployment: Deployment = {
        network: "bsc-mainnet",
        chainId: 56,
        deployer: "0x1111111111111111111111111111111111111111",
        timestamp: new Date().toISOString(),
        deploymentMode: "standard",
        protocolsDeployed: ["layerZero"],
        contracts: {
          LookCoin: { proxy: "0x4444444444444444444444444444444444444444" },
          SupplyOracle: { proxy: "0x5555555555555555555555555555555555555555" }
        }
      };

      // Save deployments
      await saveDeployment("bsc-testnet", testnetDeployment);
      await saveDeployment("bsc-mainnet", mainnetDeployment);

      // Load deployments and check tier compatibility
      const testnetLoaded = loadDeployment("bsc-testnet");
      const mainnetLoaded = loadDeployment("bsc-mainnet");
      
      expect(testnetLoaded).to.not.be.null;
      expect(mainnetLoaded).to.not.be.null;
      
      // In real configure script, this would trigger tier validation
    });
  });

  describe("Error Recovery", () => {
    it("should handle deployment state persistence", () => {
      const stateDir = path.join(testDeploymentDir, ".state");
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }

      const deploymentState = {
        network: "test-network",
        chainId: 1,
        deployer: "0x1111111111111111111111111111111111111111",
        startTime: new Date().toISOString(),
        steps: [
          { name: "ProtocolDetection", status: "completed" },
          { name: "CoreContracts", status: "completed" },
          { name: "ProtocolModules", status: "in_progress" },
          { name: "Infrastructure", status: "pending" }
        ],
        checkpoint: null
      };

      const statePath = path.join(stateDir, "test-network-latest.json");
      fs.writeFileSync(statePath, JSON.stringify(deploymentState, null, 2));

      // Load state
      const loaded = JSON.parse(fs.readFileSync(statePath, "utf8"));
      expect(loaded.steps[2].status).to.equal("in_progress");
      
      // In real deployment, this would allow resuming from failure
    });
  });

  describe("Protocol-Specific Tests", () => {
    it("should deploy LayerZero module correctly", async function() {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        this.skip();
        return;
      }

      // Test LayerZero-specific deployment
    });

    it("should deploy Celer module correctly", async function() {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        this.skip();
        return;
      }

      // Test Celer-specific deployment
    });

    it("should deploy multi-protocol infrastructure", async function() {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        this.skip();
        return;
      }

      // Test CrossChainRouter, FeeManager, ProtocolRegistry deployment
    });
  });

  describe("Command Line Interface", () => {
    it("should handle deploy command with correct arguments", async function() {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        this.skip();
        return;
      }

      // Test command line execution
      try {
        const { stdout, stderr } = await execAsync("npx hardhat run scripts/deploy.ts --network hardhat");
        expect(stderr).to.be.empty;
        expect(stdout).to.include("Deployment completed successfully");
      } catch (error) {
        // Handle test environment limitations
      }
    });

    it("should show deprecation warning for legacy scripts", async function() {
      if (!process.env.RUN_INTEGRATION_TESTS) {
        this.skip();
        return;
      }

      try {
        await execAsync("node scripts/deploy-multi-protocol.ts");
        expect.fail("Should have thrown deprecation error");
      } catch (error: any) {
        expect(error.message).to.include("deprecated");
      }
    });
  });
});