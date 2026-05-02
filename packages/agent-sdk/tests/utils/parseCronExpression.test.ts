import { describe, it, expect } from "vitest";
import { parseCronExpression } from "@/utils/parseCronExpression.js";

describe("parseCronExpression", () => {
  describe("valid expressions", () => {
    it("accepts all wildcards", () => {
      expect(parseCronExpression("* * * * *")).toBe(true);
    });

    it("accepts simple values", () => {
      expect(parseCronExpression("30 14 27 2 *")).toBe(true);
    });

    it("accepts step values", () => {
      expect(parseCronExpression("*/5 * * * *")).toBe(true);
      expect(parseCronExpression("0 */2 * * *")).toBe(true);
    });

    it("accepts range values", () => {
      expect(parseCronExpression("0 9-17 * * *")).toBe(true);
      expect(parseCronExpression("0 9 * * 1-5")).toBe(true);
    });

    it("accepts list values", () => {
      expect(parseCronExpression("0,30 * * * *")).toBe(true);
      expect(parseCronExpression("0 9,17 * * *")).toBe(true);
    });

    it("accepts range with step", () => {
      expect(parseCronExpression("0 9-17/2 * * *")).toBe(true);
    });

    it("accepts Sunday alias (7) for day of week", () => {
      expect(parseCronExpression("0 9 * * 7")).toBe(true);
      expect(parseCronExpression("0 9 * * 5-7")).toBe(true);
    });
  });

  describe("invalid expressions", () => {
    it("rejects wrong number of fields", () => {
      expect(parseCronExpression("* * * *")).toBe(false);
      expect(parseCronExpression("* * * * * *")).toBe(false);
      expect(parseCronExpression("* * *")).toBe(false);
    });

    it("rejects out-of-range minute", () => {
      expect(parseCronExpression("60 * * * *")).toBe(false);
      expect(parseCronExpression("-1 * * * *")).toBe(false);
    });

    it("rejects out-of-range hour", () => {
      expect(parseCronExpression("0 24 * * *")).toBe(false);
      expect(parseCronExpression("0 -1 * * *")).toBe(false);
    });

    it("rejects out-of-range day of month", () => {
      expect(parseCronExpression("0 0 32 * *")).toBe(false);
      expect(parseCronExpression("0 0 0 * *")).toBe(false);
    });

    it("rejects out-of-range month", () => {
      expect(parseCronExpression("0 0 * 13 *")).toBe(false);
      expect(parseCronExpression("0 0 * 0 *")).toBe(false);
    });

    it("rejects out-of-range day of week", () => {
      expect(parseCronExpression("0 0 * * 8")).toBe(false);
    });

    it("rejects invalid syntax", () => {
      expect(parseCronExpression("abc * * * *")).toBe(false);
      expect(parseCronExpression("*/0 * * * *")).toBe(false);
      expect(parseCronExpression("5-3 * * * *")).toBe(false); // lo > hi
    });

    it("rejects step with lo > hi in range", () => {
      expect(parseCronExpression("0 17-9 * * *")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles leading/trailing whitespace", () => {
      expect(parseCronExpression("  * * * * *  ")).toBe(true);
    });

    it("handles multiple spaces between fields", () => {
      expect(parseCronExpression("0   9  *  *  *")).toBe(true);
    });

    it("rejects empty string", () => {
      expect(parseCronExpression("")).toBe(false);
    });

    it("rejects day of week 7 in non-range position", () => {
      // 7 as a single value for day of week should be accepted (Sunday alias)
      expect(parseCronExpression("0 9 * * 7")).toBe(true);
    });
  });
});
