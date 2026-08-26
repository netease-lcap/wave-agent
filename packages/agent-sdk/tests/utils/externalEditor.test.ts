import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getExternalEditor,
  openInExternalEditor,
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
  const originalPlatform = process.platform;

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
    Object.defineProperty(process, "platform", { value: originalPlatform });
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
    it("should fall back to the platform default opener when no editor is configured", async () => {
      mockSpawn.mockReturnValue(mockChildProcess());
      Object.defineProperty(process, "platform", { value: "win32" });

      const result = await openInExternalEditor("/tmp/plan.md");

      expect(result).toEqual({ ok: true });
      // On win32 the default opener is `cmd /c start "" <file>`.
      expect(mockSpawn).toHaveBeenCalledWith(
        "cmd",
        ["/c", "start", "", "/tmp/plan.md"],
        expect.objectContaining({ detached: true, stdio: "ignore" }),
      );
    });

    it("should use xdg-open on non-win32 platforms as the default opener", async () => {
      mockSpawn.mockReturnValue(mockChildProcess());
      Object.defineProperty(process, "platform", { value: "linux" });

      const result = await openInExternalEditor("/tmp/plan.md");

      expect(result).toEqual({ ok: true });
      expect(mockSpawn).toHaveBeenCalledWith(
        "xdg-open",
        ["/tmp/plan.md"],
        expect.objectContaining({ detached: true, stdio: "ignore" }),
      );
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

    it("should run a terminal editor synchronously and return ok", async () => {
      process.env.EDITOR = "vim";
      mockSpawnSync.mockReturnValue({ error: undefined });

      const result = await openInExternalEditor("/tmp/plan.md");

      expect(result).toEqual({ ok: true });
      expect(mockSpawnSync).toHaveBeenCalledWith(
        "vim",
        ["/tmp/plan.md"],
        expect.objectContaining({ stdio: "inherit" }),
      );
    });

    it("should return an error when the terminal editor fails to spawn", async () => {
      process.env.EDITOR = "vim";
      mockSpawnSync.mockReturnValue({ error: new Error("ENOENT") });

      const result = await openInExternalEditor("/tmp/plan.md");

      expect(result).toEqual({
        ok: false,
        error: "ENOENT",
      });
    });
  });
});
