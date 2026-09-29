import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Stands in for the module graph: `createRequire` hands back a fake require so
 * the test can count when (and how often) the codec is actually resolved. This
 * is what makes the laziness assertion below real — the module under test is
 * imported at the top of this file, so an eager require during evaluation would
 * already have bumped the counters.
 */
const probe = vi.hoisted(() => ({
  fakeSharp: Object.assign((input: unknown) => ({ input }), {
    versions: { vips: "8.15.0" },
  }),
  createRequireCalls: 0,
  requireCalls: 0,
  fail: false,
}));

vi.mock("node:module", () => ({
  createRequire: (...args: unknown[]) => {
    void args;
    probe.createRequireCalls += 1;
    return (id: string) => {
      probe.requireCalls += 1;
      if (probe.fail) throw new Error(`Cannot find module '${id}'`);
      return probe.fakeSharp;
    };
  },
}));

import {
  getImageProcessor,
  resetImageProcessor,
  resolveSharp,
} from "../../src/utils/imageProcessor.js";

afterEach(() => {
  resetImageProcessor();
  probe.createRequireCalls = 0;
  probe.requireCalls = 0;
  probe.fail = false;
});

const fakeSharp = probe.fakeSharp as unknown as ReturnType<
  typeof getImageProcessor
>;

describe("resolveSharp", () => {
  it("returns the factory when sharp loads with a libvips version", () => {
    const requireFn = (() => probe.fakeSharp) as unknown as NodeRequire;
    expect(resolveSharp(requireFn)).toBe(probe.fakeSharp);
  });

  it("returns undefined instead of throwing when the module is absent", () => {
    const requireFn = (() => {
      throw new Error("Cannot find module 'sharp'");
    }) as unknown as NodeRequire;
    expect(resolveSharp(requireFn)).toBeUndefined();
  });

  it("returns undefined when sharp is not callable", () => {
    const requireFn = (() => ({
      versions: { vips: "8.15.0" },
    })) as unknown as NodeRequire;
    expect(resolveSharp(requireFn)).toBeUndefined();
  });

  it("returns undefined when the native side did not load", () => {
    const noVersions = (() => () => ({})) as unknown as NodeRequire;
    expect(resolveSharp(noVersions)).toBeUndefined();
    const emptyVersions = (() =>
      Object.assign(() => ({}), {
        versions: {},
      })) as unknown as NodeRequire;
    expect(resolveSharp(emptyVersions)).toBeUndefined();
  });
});

/**
 * The installer checks availability *before* it downloads, and on Node 24 a
 * `require` for a package that is not there yet poisons the process: the copy the
 * installer lands a moment later stays unresolvable. sharp is the row that runs
 * first, so its install is the one that creates the `node_modules` a later row
 * probes against. The check therefore has to come from the filesystem — the
 * resolver must not reach `require` for a package that is not on disk.
 */
describe("resolveSharp availability gate", () => {
  const gateRoot = path.join(os.tmpdir(), `wave-sharp-gate-${process.pid}`);
  const emptyNodeModules = path.join(gateRoot, "empty", "node_modules");
  const populatedNodeModules = path.join(gateRoot, "populated", "node_modules");

  /** A require() whose candidate node_modules dirs are exactly [dirs]. */
  function fakeRequire(dirs: string[]) {
    const state = { calls: 0 };
    const requireFn = (() => {
      state.calls += 1;
      return probe.fakeSharp;
    }) as unknown as NodeRequire;
    (requireFn as unknown as { resolve: { paths: () => string[] } }).resolve = {
      paths: () => dirs,
    };
    return { requireFn, calls: () => state.calls };
  }

  afterAll(() => {
    fs.rmSync(gateRoot, { recursive: true, force: true });
  });

  it("does not require sharp when no candidate node_modules has it", () => {
    const { requireFn, calls } = fakeRequire([emptyNodeModules]);

    expect(resolveSharp(requireFn)).toBeUndefined();
    expect(calls()).toBe(0);
  });

  it("requires sharp when a candidate node_modules has it", () => {
    fs.mkdirSync(path.join(populatedNodeModules, "sharp"), { recursive: true });
    const { requireFn, calls } = fakeRequire([populatedNodeModules]);

    expect(resolveSharp(requireFn)).toBe(probe.fakeSharp);
    expect(calls()).toBe(1);
  });
});

describe("getImageProcessor", () => {
  it("resolves sharp on first use, not while the module is evaluated", () => {
    expect(probe.createRequireCalls).toBe(0);
    expect(probe.requireCalls).toBe(0);

    const processor = getImageProcessor();
    expect(processor).toBe(fakeSharp);
    expect(probe.createRequireCalls).toBe(1);
    expect(probe.requireCalls).toBe(1);
  });

  it("resolves once for the whole process", () => {
    expect(getImageProcessor()).toBe(fakeSharp);
    expect(getImageProcessor()).toBe(fakeSharp);
    expect(probe.requireCalls).toBe(1);
  });

  it("memoises failure and re-resolves only after a reset", () => {
    probe.fail = true;

    expect(getImageProcessor()).toBeUndefined();
    expect(getImageProcessor()).toBeUndefined();
    expect(probe.requireCalls).toBe(1);

    // The installer drops sharp on disk mid-process and asks for a re-resolve.
    resetImageProcessor();
    expect(getImageProcessor()).toBeUndefined();
    expect(probe.requireCalls).toBe(2);

    // Once sharp is usable again, the process picks it up.
    probe.fail = false;
    resetImageProcessor();
    expect(getImageProcessor()).toBe(fakeSharp);
  });
});
