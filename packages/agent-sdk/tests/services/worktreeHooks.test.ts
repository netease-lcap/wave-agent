import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hasWorktreeCreateHook,
  hasWorktreeRemoveHook,
  executeWorktreeCreateHook,
  executeWorktreeRemoveHook,
} from "@/services/worktreeHooks.js";
import { executeCommand } from "@/services/hook.js";
import type { HookExecutionResult } from "@/types/hooks.js";

vi.mock("@/services/hook.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/hook.js")>();
  return {
    ...actual,
    executeCommand: vi.fn(),
  };
});

function result(
  overrides: Partial<HookExecutionResult> = {},
): HookExecutionResult {
  return {
    success: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    duration: 10,
    timedOut: false,
    ...overrides,
  };
}

const createConfig = (commands: string[]) => ({
  WorktreeCreate: [
    {
      hooks: commands.map((command) => ({ type: "command" as const, command })),
    },
  ],
});
const removeConfig = (commands: string[]) => ({
  WorktreeRemove: [
    {
      hooks: commands.map((command) => ({ type: "command" as const, command })),
    },
  ],
});

const baseContext = {
  projectDir: "/repo",
  sessionId: "session-1",
  transcriptPath: "/repo/.wave/sessions/session-1.jsonl",
  env: { FOO: "bar" },
};

describe("worktreeHooks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("hasWorktreeCreateHook / hasWorktreeRemoveHook", () => {
    it("returns false when configuration is undefined", () => {
      expect(hasWorktreeCreateHook(undefined)).toBe(false);
      expect(hasWorktreeRemoveHook(undefined)).toBe(false);
    });

    it("returns false when the event has no configured hooks", () => {
      expect(hasWorktreeCreateHook({})).toBe(false);
      expect(
        hasWorktreeRemoveHook({
          WorktreeCreate: [{ hooks: [{ type: "command", command: "x" }] }],
        }),
      ).toBe(false);
    });

    it("returns true when the event has configured hooks", () => {
      expect(hasWorktreeCreateHook(createConfig(["echo create"]))).toBe(true);
      expect(hasWorktreeRemoveHook(removeConfig(["echo remove"]))).toBe(true);
    });

    it("returns false when the event config exists but hooks array is empty", () => {
      expect(hasWorktreeCreateHook({ WorktreeCreate: [{ hooks: [] }] })).toBe(
        false,
      );
    });
  });

  describe("executeWorktreeCreateHook", () => {
    it("uses the first successful hook's stdout (trimmed) as the worktree path", async () => {
      vi.mocked(executeCommand)
        .mockResolvedValueOnce(result({ success: false, stderr: "boom" }))
        .mockResolvedValueOnce(
          result({ stdout: "  /repo/.wave/worktrees/feature\n" }),
        );

      const { worktreePath } = await executeWorktreeCreateHook(
        "feature",
        createConfig(["hook-a", "hook-b"]),
        baseContext,
      );

      expect(worktreePath).toBe("/repo/.wave/worktrees/feature");
      // Both hooks ran, in order
      expect(executeCommand).toHaveBeenNthCalledWith(
        1,
        "hook-a",
        expect.any(Object),
        undefined,
      );
      expect(executeCommand).toHaveBeenNthCalledWith(
        2,
        "hook-b",
        expect.any(Object),
        undefined,
      );
    });

    it("blocks creation when every hook fails", async () => {
      vi.mocked(executeCommand).mockResolvedValue(
        result({ success: false, stderr: "boom" }),
      );

      await expect(
        executeWorktreeCreateHook(
          "feature",
          createConfig(["hook-a"]),
          baseContext,
        ),
      ).rejects.toThrow("WorktreeCreate hook failed: hook-a: boom");
    });

    it("blocks creation when hooks succeed but emit no stdout", async () => {
      vi.mocked(executeCommand).mockResolvedValue(result({}));

      await expect(
        executeWorktreeCreateHook(
          "feature",
          createConfig(["hook-a"]),
          baseContext,
        ),
      ).rejects.toThrow("no successful output");
    });

    it("passes name, sessionId and projectDir through to the hook context", async () => {
      vi.mocked(executeCommand).mockResolvedValue(
        result({ stdout: "/repo/.wave/worktrees/feature" }),
      );

      await executeWorktreeCreateHook(
        "feature",
        createConfig(["hook-a"]),
        baseContext,
      );

      const [, context] = vi.mocked(executeCommand).mock.calls[0];
      expect(context).toMatchObject({
        event: "WorktreeCreate",
        projectDir: "/repo",
        sessionId: "session-1",
        transcriptPath: "/repo/.wave/sessions/session-1.jsonl",
        cwd: "/repo",
        env: { FOO: "bar" },
        name: "feature",
      });
    });

    it("substitutes plugin root and injects plugin env for plugin hooks", async () => {
      vi.mocked(executeCommand).mockResolvedValue(
        result({ stdout: "/repo/.wave/worktrees/feature" }),
      );

      await executeWorktreeCreateHook(
        "feature",
        {
          WorktreeCreate: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    "${WAVE_PLUGIN_ROOT}/create.sh ${CLAUDE_PLUGIN_ROOT}",
                  pluginRoot: "/plugins/my-plugin",
                },
              ],
            },
          ],
        },
        baseContext,
      );

      const [command, context] = vi.mocked(executeCommand).mock.calls[0];
      expect(command).toBe("/plugins/my-plugin/create.sh /plugins/my-plugin");
      expect(context).toMatchObject({
        env: {
          WAVE_PLUGIN_ROOT: "/plugins/my-plugin",
          CLAUDE_PLUGIN_ROOT: "/plugins/my-plugin",
        },
      });
    });

    it("applies the per-command timeout in seconds", async () => {
      vi.mocked(executeCommand).mockResolvedValue(
        result({ stdout: "/repo/.wave/worktrees/feature" }),
      );

      await executeWorktreeCreateHook(
        "feature",
        {
          WorktreeCreate: [
            {
              hooks: [{ type: "command", command: "hook-a", timeout: 5 }],
            },
          ],
        },
        baseContext,
      );

      expect(executeCommand).toHaveBeenCalledWith(
        "hook-a",
        expect.any(Object),
        { timeout: 5000 },
      );
    });

    it("skips async hooks for path resolution (fire-and-forget)", async () => {
      vi.mocked(executeCommand).mockResolvedValue(
        result({ stdout: "/repo/.wave/worktrees/feature" }),
      );

      const { worktreePath } = await executeWorktreeCreateHook(
        "feature",
        {
          WorktreeCreate: [
            {
              hooks: [
                { type: "command", command: "async-create", async: true },
                { type: "command", command: "sync-create" },
              ],
            },
          ],
        },
        baseContext,
      );

      // The async hook is launched fire-and-forget (never awaited); only the
      // sync hook's result contributes the worktree path.
      expect(executeCommand).toHaveBeenCalledTimes(2);
      expect(executeCommand).toHaveBeenLastCalledWith(
        "sync-create",
        expect.any(Object),
        undefined,
      );
      expect(worktreePath).toBe("/repo/.wave/worktrees/feature");
    });

    it("blocks creation when only async hooks are configured (no path)", async () => {
      vi.mocked(executeCommand).mockResolvedValue(result({}));

      await expect(
        executeWorktreeCreateHook(
          "feature",
          {
            WorktreeCreate: [
              {
                hooks: [
                  { type: "command", command: "async-create", async: true },
                ],
              },
            ],
          },
          baseContext,
        ),
      ).rejects.toThrow("no successful output");

      // The async hook was launched fire-and-forget but never awaited, so its
      // result never lands in the results array.
      expect(executeCommand).toHaveBeenCalledTimes(1);
      expect(executeCommand).toHaveBeenCalledWith(
        "async-create",
        expect.any(Object),
        undefined,
      );
    });
  });

  describe("executeWorktreeRemoveHook", () => {
    it("returns false when no WorktreeRemove hook is configured", async () => {
      const hookRan = await executeWorktreeRemoveHook(
        "/repo/.wave/worktrees/feature",
        undefined,
        baseContext,
      );

      expect(hookRan).toBe(false);
      expect(executeCommand).not.toHaveBeenCalled();
    });

    it("runs configured hooks and returns true", async () => {
      vi.mocked(executeCommand).mockResolvedValue(result({}));

      const hookRan = await executeWorktreeRemoveHook(
        "/repo/.wave/worktrees/feature",
        removeConfig(["cleanup-a"]),
        baseContext,
      );

      expect(hookRan).toBe(true);
      const [command, context] = vi.mocked(executeCommand).mock.calls[0];
      expect(command).toBe("cleanup-a");
      expect(context).toMatchObject({
        event: "WorktreeRemove",
        worktreePath: "/repo/.wave/worktrees/feature",
        projectDir: "/repo",
      });
    });

    it("logs failures but still returns true (non-blocking)", async () => {
      vi.mocked(executeCommand).mockResolvedValue(
        result({ success: false, stderr: "boom" }),
      );

      const hookRan = await executeWorktreeRemoveHook(
        "/repo/.wave/worktrees/feature",
        removeConfig(["cleanup-a"]),
        baseContext,
      );

      expect(hookRan).toBe(true);
    });
  });
});
