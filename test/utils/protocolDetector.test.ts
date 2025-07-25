import { expect } from "chai";
import { ethers } from "hardhat";
import { ProtocolDetector } from "../../scripts/utils/protocolDetector";
import { ChainConfig } from "../../hardhat.config";

describe("ProtocolDetector", () => {
  let detector: ProtocolDetector;

  beforeEach(() => {
    detector = new ProtocolDetector();
  });

  describe("detectSupportedProtocols", () => {
    it("should detect LayerZero when protocol is enabled", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { enabled: true }
        },
        layerZero: { endpoint: "0x1234567890123456789012345678901234567890" }
      } as ChainConfig;

      const result = detector.detectSupportedProtocols(chainConfig);
      
      expect(result.layerZero).to.be.true;
      expect(result.protocols).to.include("layerZero");
    });

    it("should detect multiple protocols", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { enabled: true },
          celer: { enabled: true },
          hyperlane: { enabled: true }
        }
      } as ChainConfig;

      const result = detector.detectSupportedProtocols(chainConfig);
      
      expect(result.protocols).to.have.lengthOf(3);
      expect(result.protocols).to.include.members(["layerZero", "celer", "hyperlane"]);
    });

    it("should fallback to endpoint detection for legacy configs", () => {
      const chainConfig: ChainConfig = {
        layerZero: { endpoint: "0x1234567890123456789012345678901234567890" },
        celer: { messageBus: "0x9876543210987654321098765432109876543210" }
      } as ChainConfig;

      const result = detector.detectSupportedProtocols(chainConfig);
      
      expect(result.layerZero).to.be.true;
      expect(result.celer).to.be.true;
      expect(result.protocols).to.have.lengthOf(2);
    });

    it("should ignore zero addresses", () => {
      const chainConfig: ChainConfig = {
        layerZero: { endpoint: ethers.ZeroAddress },
        celer: { messageBus: "0x9876543210987654321098765432109876543210" }
      } as ChainConfig;

      const result = detector.detectSupportedProtocols(chainConfig);
      
      expect(result.layerZero).to.be.false;
      expect(result.celer).to.be.true;
      expect(result.protocols).to.have.lengthOf(1);
    });

    it("should return empty protocols when none are supported", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { enabled: false },
          celer: { enabled: false }
        }
      } as ChainConfig;

      const result = detector.detectSupportedProtocols(chainConfig);
      
      expect(result.protocols).to.be.empty;
    });
  });

  describe("shouldDeployProtocol", () => {
    it("should return true for supported protocol", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { enabled: true }
        }
      } as ChainConfig;

      expect(detector.shouldDeployProtocol("layerZero", chainConfig)).to.be.true;
      expect(detector.shouldDeployProtocol("celer", chainConfig)).to.be.false;
    });

    it("should be case insensitive", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { enabled: true }
        }
      } as ChainConfig;

      expect(detector.shouldDeployProtocol("LayerZero", chainConfig)).to.be.true;
      expect(detector.shouldDeployProtocol("LAYERZERO", chainConfig)).to.be.true;
    });

    it("should return false for unknown protocol", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { enabled: true }
        }
      } as ChainConfig;

      expect(detector.shouldDeployProtocol("unknownProtocol", chainConfig)).to.be.false;
    });
  });

  describe("isMultiProtocolMode", () => {
    it("should return true when multiple protocols are supported", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { enabled: true },
          celer: { enabled: true }
        }
      } as ChainConfig;

      expect(detector.isMultiProtocolMode(chainConfig)).to.be.true;
    });

    it("should return false for single protocol", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { enabled: true }
        }
      } as ChainConfig;

      expect(detector.isMultiProtocolMode(chainConfig)).to.be.false;
    });

    it("should return false when no protocols are supported", () => {
      const chainConfig: ChainConfig = {
        protocols: {}
      } as ChainConfig;

      expect(detector.isMultiProtocolMode(chainConfig)).to.be.false;
    });
  });

  describe("getProtocolConfig", () => {
    it("should return protocol config with endpoint", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { 
            enabled: true,
            endpoint: "0x1234567890123456789012345678901234567890"
          }
        },
        layerZero: { endpoint: "0x9876543210987654321098765432109876543210" }
      } as ChainConfig;

      const config = detector.getProtocolConfig("layerZero", chainConfig);
      
      expect(config.enabled).to.be.true;
      expect(config.endpoint).to.equal("0x1234567890123456789012345678901234567890");
    });

    it("should fallback to chain config endpoint", () => {
      const chainConfig: ChainConfig = {
        layerZero: { endpoint: "0x9876543210987654321098765432109876543210" }
      } as ChainConfig;

      const config = detector.getProtocolConfig("layerZero", chainConfig);
      
      expect(config.enabled).to.be.true;
      expect(config.endpoint).to.equal("0x9876543210987654321098765432109876543210");
    });
  });

  describe("validateProtocolDeployment", () => {
    it("should throw if protocol is not enabled", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { enabled: false }
        }
      } as ChainConfig;

      expect(() => {
        detector.validateProtocolDeployment("layerZero", chainConfig);
      }).to.throw("Protocol layerZero is not enabled on this chain");
    });

    it("should throw if endpoint is zero address", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { 
            enabled: true,
            endpoint: ethers.ZeroAddress
          }
        }
      } as ChainConfig;

      expect(() => {
        detector.validateProtocolDeployment("layerZero", chainConfig);
      }).to.throw("Protocol layerZero endpoint is not configured for this chain");
    });

    it("should not throw for valid protocol", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { 
            enabled: true,
            endpoint: "0x1234567890123456789012345678901234567890"
          }
        }
      } as ChainConfig;

      expect(() => {
        detector.validateProtocolDeployment("layerZero", chainConfig);
      }).to.not.throw();
    });
  });

  describe("getProtocolSummary", () => {
    it("should return single protocol mode summary", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { enabled: true }
        }
      } as ChainConfig;

      const summary = detector.getProtocolSummary(chainConfig);
      expect(summary).to.equal("Single protocol mode: layerZero");
    });

    it("should return multi-protocol mode summary", () => {
      const chainConfig: ChainConfig = {
        protocols: {
          layerZero: { enabled: true },
          celer: { enabled: true },
          hyperlane: { enabled: true }
        }
      } as ChainConfig;

      const summary = detector.getProtocolSummary(chainConfig);
      expect(summary).to.equal("Multi-protocol mode: layerZero, celer, hyperlane");
    });

    it("should return no protocols message", () => {
      const chainConfig: ChainConfig = {
        protocols: {}
      } as ChainConfig;

      const summary = detector.getProtocolSummary(chainConfig);
      expect(summary).to.equal("No cross-chain protocols supported");
    });
  });
});