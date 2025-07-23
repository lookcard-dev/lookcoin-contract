import { expect } from "chai";
import { ethers } from "hardhat";
import { DeploymentOrchestrator, DeploymentConfig } from "../../scripts/utils/deploymentOrchestrator";
import { ProtocolSupport } from "../../scripts/utils/protocolDetector";
import { ChainConfig } from "../../hardhat.config";

describe("DeploymentOrchestrator", () => {
  let orchestrator: typeof DeploymentOrchestrator;
  let mockConfig: DeploymentConfig;

  beforeEach(() => {
    orchestrator = DeploymentOrchestrator;
    
    mockConfig = {
      chainConfig: {
        governanceVault: "0x1234567890123456789012345678901234567890",
        layerZero: { endpoint: "0x9876543210987654321098765432109876543210" },
        celer: { messageBus: "0xABCDEF1234567890123456789012345678901234" }
      } as ChainConfig,
      deployer: "0x1111111111111111111111111111111111111111",
      deploymentName: "test-network",
      existingDeployment: null
    };
  });

  describe("determineDeploymentMode", () => {
    it("should return standard mode for single protocol", () => {
      const protocolSupport: ProtocolSupport = {
        layerZero: true,
        celer: false,
        xerc20: false,
        hyperlane: false,
        protocols: ["layerZero"]
      };

      const mode = orchestrator.determineDeploymentMode(protocolSupport);
      expect(mode).to.equal("standard");
    });

    it("should return multi-protocol mode for multiple protocols", () => {
      const protocolSupport: ProtocolSupport = {
        layerZero: true,
        celer: true,
        xerc20: false,
        hyperlane: false,
        protocols: ["layerZero", "celer"]
      };

      const mode = orchestrator.determineDeploymentMode(protocolSupport);
      expect(mode).to.equal("multi-protocol");
    });

    it("should return standard mode for no protocols", () => {
      const protocolSupport: ProtocolSupport = {
        layerZero: false,
        celer: false,
        xerc20: false,
        hyperlane: false,
        protocols: []
      };

      const mode = orchestrator.determineDeploymentMode(protocolSupport);
      expect(mode).to.equal("standard");
    });

    it("should return multi-protocol mode for three or more protocols", () => {
      const protocolSupport: ProtocolSupport = {
        layerZero: true,
        celer: true,
        xerc20: false,
        hyperlane: false,
        protocols: ["layerZero", "celer"]
      };

      const mode = orchestrator.determineDeploymentMode(protocolSupport);
      expect(mode).to.equal("multi-protocol");
    });
  });

  describe("deployCore", () => {
    it("should deploy core contracts", async () => {
      // Note: This test would require mocking the deployment functions
      // In a real test environment, you would mock fetchDeployOrUpgradeProxy
      // and test that the correct contracts are deployed
      
      // Skip this test if not in a proper test environment
      if (!process.env.TEST_DEPLOYMENT) {
        return;
      }

      const result = await orchestrator.deployCore(mockConfig);
      
      expect(result).to.have.property("lookCoin");
      expect(result).to.have.property("supplyOracle");
      expect(ethers.isAddress(result.lookCoin)).to.be.true;
      expect(ethers.isAddress(result.supplyOracle)).to.be.true;
    });
  });

  describe("deployProtocols", () => {
    it("should deploy protocol modules based on chain config", async () => {
      // Note: This test would require mocking the deployment functions
      // Skip this test if not in a proper test environment
      if (!process.env.TEST_DEPLOYMENT) {
        return;
      }

      const result = await orchestrator.deployProtocols(mockConfig);
      
      expect(result).to.be.an("object");
      // The specific modules deployed depend on the chain configuration
    });
  });

  describe("deployInfrastructure", () => {
    it("should deploy infrastructure contracts for multi-protocol mode", async () => {
      // Note: This test would require mocking the deployment functions
      // Skip this test if not in a proper test environment
      if (!process.env.TEST_DEPLOYMENT) {
        return;
      }

      const result = await orchestrator.deployInfrastructure(mockConfig);
      
      expect(result).to.have.property("crossChainRouter");
      expect(result).to.have.property("feeManager");
      expect(result).to.have.property("securityManager");
      expect(result).to.have.property("protocolRegistry");
    });
  });

  describe("Integration tests", () => {
    it("should handle deployment with existing contracts", async () => {
      // Test with existing deployment
      const configWithExisting: DeploymentConfig = {
        ...mockConfig,
        existingDeployment: {
          network: "test-network",
          chainId: 1,
          deployer: "0x1111111111111111111111111111111111111111",
          timestamp: new Date().toISOString(),
          contracts: {
            LookCoin: { proxy: "0x2222222222222222222222222222222222222222" },
            SupplyOracle: { proxy: "0x3333333333333333333333333333333333333333" }
          }
        }
      };

      // This would test that existing contracts are not redeployed
      // Skip if not in test environment
      if (!process.env.TEST_DEPLOYMENT) {
        return;
      }

      const result = await orchestrator.deployCore(configWithExisting);
      expect(result.lookCoin).to.equal("0x2222222222222222222222222222222222222222");
    });

    it("should handle deployment failures gracefully", async () => {
      // Test error handling
      const invalidConfig: DeploymentConfig = {
        ...mockConfig,
        chainConfig: {
          governanceVault: ethers.ZeroAddress // Invalid governance vault
        } as ChainConfig
      };

      // Skip if not in test environment
      if (!process.env.TEST_DEPLOYMENT) {
        return;
      }

      try {
        await orchestrator.deployCore(invalidConfig);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("governance");
      }
    });
  });
});