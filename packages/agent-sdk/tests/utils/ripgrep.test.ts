import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const { createRequireMock } = vi.hoisted(() => ({
  createRequireMock: vi.fn(),
}));

vi.mock("node:module", () => ({
  createRequire: createRequireMock,
}));

import {
  getRgPath,
  resetRipgrep,
  resolveRipgrep,
} from "../../src/utils/ripgrep.js";

/** A require() that fails the way a missing platform package does. */
function missingPlatformPackage(): never {
  throw new Error(
    "Could not find @vscode/ripgrep-darwin-arm64. " +
      "Ensure optionalDependencies are installed for this platform (darwin-arm64).",
  );
}

describe("ripgrep path resolution", () => {
  beforeEach(() => {
    createRequireMock.mockReset();
    resetRipgrep();
  });

  it("stays undefined instead of throwing when the platform binary is missing", () => {
    // Hosts that bundle the SDK barrel (desktop main process, IDE extension
    // host) ship no @vscode/ripgrep-<platform> package and never run grep
    // in-process — resolving eagerly used to take the whole process down before
    // a window could even appear.
    createRequireMock.mockReturnValue(missingPlatformPackage);

    expect(getRgPath()).toBeUndefined();
  });

  it("exposes the binary path resolved from @vscode/ripgrep", () => {
    createRequireMock.mockReturnValue(() => ({ rgPath: "/mock/rg" }));

    expect(getRgPath()).toBe("/mock/rg");
  });

  it("picks up a binary installed after the module was evaluated", () => {
    // The CLI installs this dependency itself, after its own module graph has
    // been evaluated (see runtimeDeps.ts), then calls resetRipgrep. Freezing the
    // value at evaluation time would report "grep is missing" forever.
    createRequireMock.mockReturnValue(missingPlatformPackage);
    expect(getRgPath()).toBeUndefined();

    createRequireMock.mockReturnValue(() => ({ rgPath: "/mock/rg" }));
    expect(getRgPath()).toBeUndefined(); // memoised failure — not re-resolved

    resetRipgrep();
    expect(getRgPath()).toBe("/mock/rg");
  });

  it("ignores a module that resolves to something other than a path", () => {
    createRequireMock.mockReturnValue(() => ({ rgPath: 42 }));

    expect(getRgPath()).toBeUndefined();
  });
});

describe("resolveRipgrep", () => {
  it("resolves through an injected require (the installer's verify base)", () => {
    expect(
      resolveRipgrep((() => ({ rgPath: "/cli/rg" })) as unknown as NodeRequire),
    ).toBe("/cli/rg");
  });

  it("returns undefined when the injected require throws", () => {
    expect(
      resolveRipgrep((() => {
        throw new Error("nope");
      }) as unknown as NodeRequire),
    ).toBeUndefined();
  });
});

/**
 * The installer checks availability *before* it downloads, and on Node 24 a
 * `require` for a package that is not there yet poisons the process: the copy
 * the installer lands a moment later stays unresolvable, so a successful install
 * reported "ripgrep is not available" for the whole run. The check therefore has
 * to come from the filesystem — the resolver must not reach `require` for a
 * package that is not on disk.
 */
describe("resolveRipgrep availability gate", () => {
  const gateRoot = path.join(os.tmpdir(), `wave-ripgrep-gate-${process.pid}`);
  const emptyNodeModules = path.join(gateRoot, "empty", "node_modules");
  const populatedNodeModules = path.join(gateRoot, "populated", "node_modules");

  /** A require() whose candidate node_modules dirs are exactly [dirs]. */
  function fakeRequire(dirs: string[]) {
    const state = { calls: 0 };
    const requireFn = (() => {
      state.calls += 1;
      return { rgPath: "/cli/rg" };
    }) as unknown as NodeRequire;
    (requireFn as unknown as { resolve: { paths: () => string[] } }).resolve = {
      paths: () => dirs,
    };
    return { requireFn, calls: () => state.calls };
  }

  afterAll(() => {
    fs.rmSync(gateRoot, { recursive: true, force: true });
  });

  it("does not require the wrapper when no candidate node_modules has it", () => {
    const { requireFn, calls } = fakeRequire([emptyNodeModules]);

    expect(resolveRipgrep(requireFn)).toBeUndefined();
    expect(calls()).toBe(0);
  });

  it("requires the wrapper when a candidate node_modules has it", () => {
    fs.mkdirSync(path.join(populatedNodeModules, "@vscode", "ripgrep"), {
      recursive: true,
    });
    const { requireFn, calls } = fakeRequire([populatedNodeModules]);

    expect(resolveRipgrep(requireFn)).toBe("/cli/rg");
    expect(calls()).toBe(1);
  });
});
