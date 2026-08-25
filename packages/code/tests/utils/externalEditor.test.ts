import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getExternalEditor,
  openInExternalEditor,
  registerInkInstance,
} from "../../src/utils/externalEditor.js";

const mockSpawn = vi.hoisted(() => vi.fn());
const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: mockSpawn,
    spawnSync: mockSpawnSync,
  };
});

describe("externalEditor", () => {
  const originalEnv = { ...process.env };

  const mockChildProcess = () => ({
    on: vi.fn(),
    unref: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VISUAL;
    delete process.env.EDITOR;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("getExternalEditor", () => {
    it("should return $VISUAL when set", () => {
      process.env.VISUAL = "vim";
      expect(getExternalEditor()).toBe("vim");
    });

    it("should fall back to $EDITOR when $VISUAL is unset", () => {
      process.env.EDITOR = "nano";
      expect(getExternalEditor()).toBe("nano");
    });

    it("should return undefined when neither is set", () => {
      expect(getExternalEditor()).toBeUndefined();
    });
  });

  describe("openInExternalEditor", () => {
    it("should return an error when no editor is configured", async () => {
      const result = await openInExternalEditor("/tmp/plan.md");
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining("No external editor found"),
      });
    });

    it("should return an error for an invalid editor config", async () => {
      process.env.EDITOR = " ";
      const result = await openInExternalEditor("/tmp/plan.md");
      expect(result.ok).toBe(false);
    });

    it("should spawn a GUI editor detached and return ok", async () => {
      process.env.EDITOR = "code";
      mockSpawn.mockReturnValue(mockChildProcess());

      const result = await openInExternalEditor("/tmp/plan.md");

      expect(result).toEqual({ ok: true });
      expect(mockSpawn).toHaveBeenCalledWith(
        "code",
        ["/tmp/plan.md"],
        expect.objectContaining({ detached: true, stdio: "ignore" }),
      );
    });

    it("should handle GUI editor paths with arguments", async () => {
      process.env.EDITOR = "/usr/bin/subl -n";
      mockSpawn.mockReturnValue(mockChildProcess());

      const result = await openInExternalEditor("/tmp/plan.md");

      expect(result).toEqual({ ok: true });
      expect(mockSpawn).toHaveBeenCalledWith(
        "/usr/bin/subl",
        ["-n", "/tmp/plan.md"],
        expect.any(Object),
      );
    });

    it("should run a terminal editor through suspendTerminal when an ink instance is registered", async () => {
      process.env.EDITOR = "vim";
      mockSpawnSync.mockReturnValue({ error: undefined });
      const suspendTerminal = vi.fn((callback: () => void) =>
        Promise.resolve(callback()),
      );
      registerInkInstance({ suspendTerminal });

      const result = await openInExternalEditor("/tmp/plan.md");

      expect(result).toEqual({ ok: true });
      expect(suspendTerminal).toHaveBeenCalledTimes(1);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        "vim",
        ["/tmp/plan.md"],
        expect.objectContaining({ stdio: "inherit" }),
      );
    });

    it("should run a terminal editor directly when no ink instance is registered", async () => {
      process.env.EDITOR = "vim";
      registerInkInstance(null);
      mockSpawnSync.mockReturnValue({ error: undefined });

      const result = await openInExternalEditor("/tmp/plan.md");

      expect(result).toEqual({ ok: true });
      expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    });

    it("should return an error when the terminal editor fails to spawn", async () => {
      process.env.EDITOR = "vim";
      registerInkInstance(null);
      mockSpawnSync.mockReturnValue({ error: new Error("ENOENT") });

      const result = await openInExternalEditor("/tmp/plan.md");

      expect(result).toEqual({
        ok: false,
        error: "ENOENT",
      });
    });
  });
});
