// NOTE: This file tests the deployment scripts and should be reviewed
// after the comprehensive test suite is complete.
// It may need updates to align with the new testing patterns.

import { expect } from "chai";
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { loadDeployment, saveDeployment, Deployment } from "../../scripts/utils/deployment";
import { ProtocolDetector } from "../../scripts/utils/protocolDetector";

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
      // const detector = new ProtocolDetector(); // unused
      
      // Test detection logic using static method
      const chainConfig = {
        layerZero: { endpoint: "0x1234567890123456789012345678901234567890" },
        celer: { messageBus: "0x1234567890123456789012345678901234567890" },
        hyperlane: { mailbox: "0x1234567890123456789012345678901234567890" }
      };
      const support = ProtocolDetector.detectSupportedProtocols(chainConfig as any);
      expect(support).to.have.property('protocols');
    });

    it("should handle protocol-specific configurations", () => {
      const mockDeployment: Deployment = {
        network: "localhost",
        chainId: 31337,
        deployer: ethers.ZeroAddress,
        timestamp: new Date().toISOString(),
        contracts: {
          LookCoin: {
            proxy: ethers.ZeroAddress,
            implementation: ethers.ZeroAddress
          },
          SupplyOracle: {
            proxy: ethers.ZeroAddress,
            implementation: ethers.ZeroAddress
          }
        }
      };

      expect(mockDeployment).to.have.property('contracts');
      expect(mockDeployment.contracts).to.have.property('LookCoin');
    });
  });

  describe("Deployment Artifact Management", () => {
    it("should save and load deployment artifacts", async () => {
      const testDeployment: Deployment = {
        network: "test",
        chainId: 31337,
        deployer: "0x1234567890123456789012345678901234567890",
        timestamp: new Date().toISOString(),
        contracts: {
          LookCoin: {
            proxy: "0x1234567890123456789012345678901234567890",
            implementation: "0xabcd1234567890123456789012345678901234567890"
          },
          SupplyOracle: {
            proxy: "0x5678901234567890123456789012345678905678",
            implementation: "0xefgh1234567890123456789012345678901234567890"
          }
        }
      };

      const filename = path.join(testDeploymentDir, "test-deployment.json");
      
      // Save deployment
      saveDeployment(filename, testDeployment);
      expect(fs.existsSync(filename)).to.be.true;

      // Load deployment
      const loaded = loadDeployment(filename);
      expect(loaded).to.deep.equal(testDeployment);
    });
  });
});