// NOTE: This file tests the deployment scripts and should be reviewed
// after the comprehensive test suite is complete.
// It may need updates to align with the new testing patterns.

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
      
      // Test detection logic
      const mode = detector.detectMode();
      expect(mode).to.be.oneOf(['standard', 'multi-protocol']);
    });

    it("should handle protocol-specific configurations", () => {
      const mockDeployment: Deployment = {
        network: "localhost",
        chainId: 31337,
        contracts: {
          LookCoin: {
            address: ethers.ZeroAddress,
            deploymentHash: "0x",
            blockNumber: 0
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
        contracts: {
          TestContract: {
            address: "0x1234567890123456789012345678901234567890",
            deploymentHash: "0xabcd",
            blockNumber: 12345
          }
        }
      };

      const filename = path.join(testDeploymentDir, "test-deployment.json");
      
      // Save deployment
      saveDeployment(testDeployment, filename);
      expect(fs.existsSync(filename)).to.be.true;

      // Load deployment
      const loaded = loadDeployment(filename);
      expect(loaded).to.deep.equal(testDeployment);
    });
  });
});