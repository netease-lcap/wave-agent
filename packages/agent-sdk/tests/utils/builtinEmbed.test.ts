import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "path";

vi.mock("os", () => ({
  tmpdir: () => "/tmp",
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock("../../src/builtin/index.js", () => ({
  BUILTIN_CONTENT: {
    "skills/loop/SKILL.md": "loop content",
    "subagents/bash.md": "bash content",
    "plugins/sdd/plugin.json": "plugin content",
  },
}));

import * as fs from "fs";
import { getBuiltinCacheKey } from "../../src/utils/builtinEmbed.js";

// ensureBuiltinMaterialized memoizes per module instance, so each test that
// exercises materialization runs on a fresh module.
async function freshMaterializer(): Promise<
  typeof import("../../src/utils/builtinEmbed.js")
> {
  vi.resetModules();
  return await import("../../src/utils/builtinEmbed.js");
}

describe("builtinEmbed", () => {
  const expectedDir = join("/tmp", "wave-builtin", getBuiltinCacheKey());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes a deterministic content-hash key", () => {
    expect(getBuiltinCacheKey()).toMatch(/^[0-9a-f]{16}$/);
    expect(getBuiltinCacheKey()).toBe(getBuiltinCacheKey());
  });

  it("materializes builtin content under tmpdir/wave-builtin/<hash>", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { ensureBuiltinMaterialized } = await freshMaterializer();

    const dir = ensureBuiltinMaterialized();

    expect(dir).toBe(expectedDir);
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expectedDir,
      expect.objectContaining({ recursive: true, mode: 0o700 }),
    );
    for (const rel of [
      "skills/loop/SKILL.md",
      "subagents/bash.md",
      "plugins/sdd/plugin.json",
    ]) {
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        join(expectedDir, rel),
        expect.any(String),
      );
    }
    // Nested dirs are created before their files.
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      join(expectedDir, "skills/loop"),
      expect.any(Object),
    );
  });

  it("writes the completion marker last", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { ensureBuiltinMaterialized } = await freshMaterializer();

    ensureBuiltinMaterialized();

    const markerIndex = vi.mocked(fs.writeFileSync).mock.calls.length - 1;
    expect(vi.mocked(fs.writeFileSync).mock.calls[markerIndex][0]).toBe(
      join(expectedDir, ".wave-builtin-complete"),
    );
  });

  it("memoizes: a second call does not rewrite", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const { ensureBuiltinMaterialized } = await freshMaterializer();

    ensureBuiltinMaterialized();
    const firstWriteCount = vi.mocked(fs.writeFileSync).mock.calls.length;

    ensureBuiltinMaterialized();

    expect(vi.mocked(fs.writeFileSync).mock.calls.length).toBe(firstWriteCount);
  });

  it("skips writing when the marker already exists", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === join(expectedDir, ".wave-builtin-complete");
    });
    const { ensureBuiltinMaterialized } = await freshMaterializer();

    expect(ensureBuiltinMaterialized()).toBe(expectedDir);
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
