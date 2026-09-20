import { afterEach, describe, expect, it, vi } from "vitest";

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
