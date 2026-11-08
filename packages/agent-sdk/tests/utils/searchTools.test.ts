import { describe, it, expect, vi, beforeEach } from "vitest";
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
  getSearchTools,
  resetSearchTools,
  resolveSearchTools,
} from "../../src/utils/searchTools.js";

/**
 * A require() that loads [loaded], optionally reporting [dirs] as its candidate
 * node_modules. Omitting [dirs] leaves the on-disk gate out of the picture,
 * which is what `isPackageOnDisk` does for a require it cannot ask.
 */
function fakeRequire(loaded?: unknown, dirs?: string[]) {
  const state = { calls: 0 };
  const requireFn = (() => {
    state.calls += 1;
    return loaded;
  }) as unknown as NodeRequire;
  if (dirs) {
    (requireFn as unknown as { resolve: { paths: () => string[] } }).resolve = {
      paths: () => dirs,
    };
  }
  return { requireFn, calls: () => state.calls };
}

describe("resolveSearchTools", () => {
  it("returns the paths the package resolves for this process", () => {
    const { requireFn } = fakeRequire({
      resolveSearchTools: () => ({
        ugrep: "/pkg/bin/ugrep",
        bfs: "/pkg/bin/bfs",
      }),
    });

    expect(resolveSearchTools(requireFn)).toEqual({
      ugrep: "/pkg/bin/ugrep",
      bfs: "/pkg/bin/bfs",
    });
  });

  it("treats the package's null (no build for this platform) as unavailable", () => {
    const { requireFn } = fakeRequire({ resolveSearchTools: () => null });

    expect(resolveSearchTools(requireFn)).toBeUndefined();
  });

  it("returns undefined when the package has no resolver", () => {
    const { requireFn } = fakeRequire({});

    expect(resolveSearchTools(requireFn)).toBeUndefined();
  });

  it("returns undefined instead of throwing when the package fails to load", () => {
    const throwing = (() => {
      throw new Error("broken install");
    }) as unknown as NodeRequire;

    expect(resolveSearchTools(throwing)).toBeUndefined();
  });

  it("does not require the package when no candidate node_modules holds it", () => {
    // `isPackageOnDisk` exists because probing an absent package with require
    // makes Node cache the miss for the rest of the process — the installer's
    // post-download verify then fails even though the files are on disk.
    const { requireFn, calls } = fakeRequire(
      { resolveSearchTools: () => ({ ugrep: "/cli/ugrep" }) },
      [path.join(os.tmpdir(), "wave-search-tools-absent")],
    );

    expect(resolveSearchTools(requireFn)).toBeUndefined();
    expect(calls()).toBe(0);
  });

  it("requires through the injected function once the directory exists", () => {
    const root = path.join(
      os.tmpdir(),
      `wave-search-tools-gate-${process.pid}`,
    );
    const nodeModules = path.join(root, "node_modules");
    fs.mkdirSync(path.join(nodeModules, "wave-search-tools"), {
      recursive: true,
    });

    const { requireFn, calls } = fakeRequire(
      { resolveSearchTools: () => ({ ugrep: "/cli/ugrep" }) },
      [nodeModules],
    );

    try {
      expect(resolveSearchTools(requireFn)).toEqual({ ugrep: "/cli/ugrep" });
      expect(calls()).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("getSearchTools", () => {
  beforeEach(() => {
    createRequireMock.mockReset();
    resetSearchTools();
  });

  it("re-resolves after resetSearchTools (the installer's post-install hook)", () => {
    createRequireMock.mockReturnValue(() => {
      throw new Error("missing");
    });
    expect(getSearchTools()).toBeUndefined();

    createRequireMock.mockReturnValue(() => ({
      resolveSearchTools: () => ({ ugrep: "/late/ugrep" }),
    }));
    expect(getSearchTools()).toBeUndefined(); // memoised failure

    resetSearchTools();
    expect(getSearchTools()).toEqual({ ugrep: "/late/ugrep" });
  });

  it("memoises a successful resolution", () => {
    createRequireMock.mockReturnValue(() => ({
      resolveSearchTools: () => ({ bfs: "/pkg/bfs" }),
    }));

    expect(getSearchTools()).toEqual({ bfs: "/pkg/bfs" });
    const created = createRequireMock.mock.calls.length;
    expect(getSearchTools()).toEqual({ bfs: "/pkg/bfs" });
    expect(createRequireMock.mock.calls.length).toBe(created);
  });
});
