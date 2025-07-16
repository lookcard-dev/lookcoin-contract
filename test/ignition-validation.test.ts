import { expect } from "chai";
import {
  validateAddress,
  validateNonZeroAddress,
  parseCommaSeparatedAddresses,
  validateParseEther,
  validateRemoteModules,
  validateBridgeRegistrations,
  createParameterError
} from "../ignition/utils/parameterValidation";

describe("Ignition Parameter Validation", () => {
  describe("Address Validation", () => {
    it("should validate correct addresses", () => {
      const addr = "0x1234567890123456789012345678901234567890";
      expect(validateAddress(addr, "test")).to.equal(addr);
    });

    it("should reject invalid addresses", () => {
      expect(() => validateAddress("0x123", "test")).to.throw("Parameter 'test' validation failed");
      expect(() => validateAddress("not-an-address", "test")).to.throw();
    });

    it("should reject zero address when non-zero required", () => {
      const zeroAddr = "0x0000000000000000000000000000000000000000";
      expect(() => validateNonZeroAddress(zeroAddr, "test")).to.throw("non-zero address");
    });
  });

  describe("Array Parameter Parsing", () => {
    it("should parse comma-separated addresses", () => {
      const input = "0x1234567890123456789012345678901234567890,0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
      const result = parseCommaSeparatedAddresses(input, "test");
      expect(result).to.have.lengthOf(2);
      expect(result[0]).to.equal("0x1234567890123456789012345678901234567890");
      expect(result[1]).to.equal("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    });

    it("should handle empty string", () => {
      const result = parseCommaSeparatedAddresses("", "test");
      expect(result).to.have.lengthOf(0);
    });

    it("should reject invalid addresses in array", () => {
      const input = "0x1234567890123456789012345678901234567890,invalid-address";
      expect(() => parseCommaSeparatedAddresses(input, "test")).to.throw();
    });
  });

  describe("BigInt Validation", () => {
    it("should parse ether values correctly", () => {
      const result = validateParseEther("100", "test");
      expect(result.toString()).to.equal("100000000000000000000");
    });

    it("should handle decimal values", () => {
      const result = validateParseEther("1.5", "test");
      expect(result.toString()).to.equal("1500000000000000000");
    });

    it("should reject invalid numeric strings", () => {
      expect(() => validateParseEther("not-a-number", "test")).to.throw();
      expect(() => validateParseEther("", "test")).to.throw();
    });
  });

  describe("Remote Modules Validation", () => {
    it("should parse and validate remote modules JSON", () => {
      const input = '{"10":"0x1234567890123456789012345678901234567890","8453":"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"}';
      const result = validateRemoteModules(input, "test", 56);
      expect(result["10"]).to.equal("0x1234567890123456789012345678901234567890");
      expect(result["8453"]).to.equal("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    });

    it("should reject same chain ID as current", () => {
      const input = '{"56":"0x1234567890123456789012345678901234567890"}';
      expect(() => validateRemoteModules(input, "test", 56)).to.throw("different from current chain ID");
    });

    it("should reject invalid addresses in remote modules", () => {
      const input = '{"10":"invalid-address"}';
      expect(() => validateRemoteModules(input, "test", 56)).to.throw();
    });
  });

  describe("Bridge Registrations Validation", () => {
    it("should parse and validate bridge registrations", () => {
      const input = '{"8453":"0x1234567890123456789012345678901234567890","10":"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"}';
      const result = validateBridgeRegistrations(input, "test");
      expect(result["8453"]).to.equal("0x1234567890123456789012345678901234567890");
      expect(result["10"]).to.equal("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    });

    it("should reject zero addresses", () => {
      const input = '{"8453":"0x0000000000000000000000000000000000000000"}';
      expect(() => validateBridgeRegistrations(input, "test")).to.throw("non-zero address");
    });
  });
});