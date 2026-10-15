/**
 * The entrypoint vocabulary (docs/specs/enterprise/opentelemetry.md「宿主入口标识」):
 * a closed table, because the value becomes an attribute value — a typo must not
 * mint a series of its own.
 */

import { describe, it, expect } from "vitest";
import {
  HOST_ENTRYPOINTS,
  normalizeEntrypoint,
} from "@/constants/telemetry.js";

describe("normalizeEntrypoint", () => {
  it("should accept every declared entrypoint", () => {
    for (const entrypoint of HOST_ENTRYPOINTS) {
      expect(normalizeEntrypoint(entrypoint)).toBe(entrypoint);
    }
  });

  it("should treat an undeclared entrypoint as absent", () => {
    expect(normalizeEntrypoint(undefined)).toBeUndefined();
  });

  it("should drop a value outside the table instead of exporting it", () => {
    expect(normalizeEntrypoint("terminal")).toBeUndefined();
    // Case matters: `CLI` is not `cli`, and two series for one host is exactly
    // what the table exists to prevent.
    expect(normalizeEntrypoint("CLI")).toBeUndefined();
    expect(normalizeEntrypoint("")).toBeUndefined();
  });

  it("should ignore a value that is not a string at all", () => {
    expect(normalizeEntrypoint(1)).toBeUndefined();
    expect(normalizeEntrypoint({ entrypoint: "cli" })).toBeUndefined();
  });
});
