import { describe, it, expect } from "vitest";
import { cronToHuman } from "@/utils/cronToHuman.js";

describe("cronToHuman", () => {
  describe("every N minutes", () => {
    it("returns 'Every minute' for */1 * * * *", () => {
      expect(cronToHuman("*/1 * * * *")).toBe("Every minute");
    });

    it("returns 'Every 5 minutes' for */5 * * * *", () => {
      expect(cronToHuman("*/5 * * * *")).toBe("Every 5 minutes");
    });

    it("returns 'Every 30 minutes' for */30 * * * *", () => {
      expect(cronToHuman("*/30 * * * *")).toBe("Every 30 minutes");
    });
  });

  describe("every hour", () => {
    it("returns 'Every hour' for 0 * * * *", () => {
      expect(cronToHuman("0 * * * *")).toBe("Every hour");
    });

    it("returns 'Every hour at :15' for 15 * * * *", () => {
      expect(cronToHuman("15 * * * *")).toBe("Every hour at :15");
    });
  });

  describe("every N hours", () => {
    it("returns 'Every 2 hours' for 0 */2 * * *", () => {
      expect(cronToHuman("0 */2 * * *")).toBe("Every 2 hours");
    });

    it("returns 'Every 4 hours at :30' for 30 */4 * * *", () => {
      expect(cronToHuman("30 */4 * * *")).toBe("Every 4 hours at :30");
    });

    it("returns 'Every hour at :30' for 30 */1 * * *", () => {
      expect(cronToHuman("30 */1 * * *")).toBe("Every hour at :30");
    });
  });

  describe("daily at specific time", () => {
    it("returns 'Every day at 9:00 AM' for 0 9 * * *", () => {
      expect(cronToHuman("0 9 * * *")).toBe("Every day at 9:00 AM");
    });

    it("returns 'Every day at 2:30 PM' for 30 14 * * *", () => {
      expect(cronToHuman("30 14 * * *")).toBe("Every day at 2:30 PM");
    });

    it("returns 'Every day at 12:00 AM' for 0 0 * * *", () => {
      expect(cronToHuman("0 0 * * *")).toBe("Every day at 12:00 AM");
    });
  });

  describe("specific day of week", () => {
    it("returns 'Every Monday at 9:00 AM' for 0 9 * * 1", () => {
      expect(cronToHuman("0 9 * * 1")).toBe("Every Monday at 9:00 AM");
    });

    it("returns 'Every Sunday at 9:00 AM' for 0 9 * * 0", () => {
      expect(cronToHuman("0 9 * * 0")).toBe("Every Sunday at 9:00 AM");
    });

    it("normalizes 7 as Sunday for 0 9 * * 7", () => {
      expect(cronToHuman("0 9 * * 7")).toBe("Every Sunday at 9:00 AM");
    });
  });

  describe("weekdays", () => {
    it("returns 'Weekdays at 9:00 AM' for 0 9 * * 1-5", () => {
      expect(cronToHuman("0 9 * * 1-5")).toBe("Weekdays at 9:00 AM");
    });

    it("returns 'Weekdays at 2:30 PM' for 30 14 * * 1-5", () => {
      expect(cronToHuman("30 14 * * 1-5")).toBe("Weekdays at 2:30 PM");
    });
  });

  describe("fallback to raw cron", () => {
    it("returns raw cron for complex expressions", () => {
      expect(cronToHuman("0 9,17 * * *")).toBe("0 9,17 * * *");
    });

    it("returns raw cron for malformed input", () => {
      expect(cronToHuman("invalid")).toBe("invalid");
    });

    it("returns raw cron for partial fields", () => {
      expect(cronToHuman("0 9")).toBe("0 9");
    });

    it("returns raw cron for non-numeric minute/hour", () => {
      expect(cronToHuman("abc def * * *")).toBe("abc def * * *");
    });
  });
});
