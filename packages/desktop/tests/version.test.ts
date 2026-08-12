import { describe, it, expect } from "vitest";
import { parseVersion, compareVersions } from "../src/main/version";

describe("parseVersion", () => {
  it("parses a plain semver string", () => {
    expect(parseVersion("0.19.7")).toEqual({ major: 0, minor: 19, patch: 7 });
  });

  it("strips a leading v", () => {
    expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("ignores a pre-release suffix", () => {
    expect(parseVersion("0.3.1-alpha.0")).toEqual({
      major: 0,
      minor: 3,
      patch: 1,
    });
  });

  it("returns null for two-part versions", () => {
    expect(parseVersion("1.2")).toBeNull();
  });

  it("returns null for non-numeric parts", () => {
    expect(parseVersion("a.b.c")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseVersion("")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("compares major versions", () => {
    expect(
      compareVersions(
        { major: 1, minor: 0, patch: 0 },
        { major: 2, minor: 0, patch: 0 },
      ),
    ).toBe(-1);
    expect(
      compareVersions(
        { major: 2, minor: 0, patch: 0 },
        { major: 1, minor: 9, patch: 9 },
      ),
    ).toBe(1);
  });

  it("compares minor versions", () => {
    expect(
      compareVersions(
        { major: 0, minor: 19, patch: 0 },
        { major: 0, minor: 20, patch: 0 },
      ),
    ).toBe(-1);
  });

  it("compares patch versions", () => {
    expect(
      compareVersions(
        { major: 0, minor: 19, patch: 8 },
        { major: 0, minor: 19, patch: 7 },
      ),
    ).toBe(1);
  });

  it("returns 0 for equal versions", () => {
    expect(
      compareVersions(
        { major: 1, minor: 2, patch: 3 },
        { major: 1, minor: 2, patch: 3 },
      ),
    ).toBe(0);
  });
});
