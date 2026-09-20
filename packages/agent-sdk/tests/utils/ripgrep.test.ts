import { describe, it, expect, vi, beforeEach } from "vitest";

const { createRequireMock } = vi.hoisted(() => ({
  createRequireMock: vi.fn(),
}));

vi.mock("node:module", () => ({
  createRequire: createRequireMock,
}));

/** A require() that fails the way a missing platform package does. */
function missingPlatformPackage(): never {
  throw new Error(
    "Could not find @vscode/ripgrep-darwin-arm64. " +
      "Ensure optionalDependencies are installed for this platform (darwin-arm64).",
  );
}

describe("rgPath", () => {
  beforeEach(() => {
    vi.resetModules();
    createRequireMock.mockReset();
  });

  it("stays undefined instead of throwing when the platform binary is missing", async () => {
    // Hosts that bundle the SDK barrel (desktop main process, IDE extension
    // host) ship no @vscode/ripgrep-<platform> package and never run grep
    // in-process — resolving at import time used to take the whole process
    // down before a window could even appear.
    createRequireMock.mockReturnValue(missingPlatformPackage);

    const { rgPath } = await import("../../src/utils/ripgrep.js");

    expect(rgPath).toBeUndefined();
  });

  it("exposes the binary path resolved from @vscode/ripgrep", async () => {
    createRequireMock.mockReturnValue(() => ({ rgPath: "/mock/rg" }));

    const { rgPath } = await import("../../src/utils/ripgrep.js");

    expect(rgPath).toBe("/mock/rg");
  });
});
