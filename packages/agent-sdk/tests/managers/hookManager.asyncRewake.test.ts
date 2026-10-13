import { describe, it, expect, beforeEach, vi } from "vitest";
import { HookManager } from "../../src/managers/hookManager.js";
import { MessageQueue } from "../../src/managers/messageQueue.js";
import { Container } from "../../src/utils/container.js";
import type { HookMatcher } from "../../src/utils/hookMatcher.js";
import { executeCommand, isCommandSafe } from "../../src/services/hook.js";
import { logger } from "../../src/utils/globalLogger.js";
import { parseTaskNotificationXml } from "../../src/utils/notificationXml.js";
import type {
  HookExecutionContext,
  HookExecutionResult,
  WaveConfiguration,
} from "../../src/types/hooks.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/services/hook.js");

const mockExecuteCommand = vi.mocked(executeCommand);

/** The rewake path is all microtasks, so one macrotask turn drains it. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function result(overrides: Partial<HookExecutionResult>): HookExecutionResult {
  return {
    success: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    duration: 1,
    timedOut: false,
    ...overrides,
  };
}

describe("HookManager asyncRewake", () => {
  let container: Container;
  let messageQueue: MessageQueue;
  let manager: HookManager;

  const context: HookExecutionContext = {
    event: "PostToolUse",
    projectDir: "/test",
    timestamp: new Date(),
    toolName: "Edit",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    const mockMatcher = {
      matches: vi.fn().mockReturnValue(true),
      isValidPattern: vi.fn().mockReturnValue(true),
      getPatternType: vi.fn().mockReturnValue("exact"),
      getMatches: vi.fn().mockReturnValue([]),
      compile: vi.fn().mockReturnValue(() => true),
    } as unknown as HookMatcher;

    container = new Container();
    messageQueue = new MessageQueue();
    container.register("MessageQueue", messageQueue);

    vi.mocked(isCommandSafe).mockReturnValue(true);

    manager = new HookManager(container, "/test/workdir", mockMatcher);
    manager.loadConfigurationFromWaveConfig(rewakingHookConfig());
  });

  function rewakingHookConfig(): WaveConfiguration {
    return {
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit",
            hooks: [
              {
                type: "command",
                command: "rewaking-hook",
                asyncRewake: true,
              },
            ],
          },
        ],
      },
    };
  }

  it("wakes the model with stderr wrapped in a system reminder on exit code 2", async () => {
    mockExecuteCommand.mockResolvedValue(
      result({ exitCode: 2, stderr: "boom" }),
    );

    const results = await manager.executeHooks("PostToolUse", context);
    await flush();

    // The hook never blocks the caller: `asyncRewake` implies `async`.
    expect(results).toHaveLength(0);
    expect(messageQueue.hasNotifications()).toBe(true);

    const [xml] = messageQueue.drainNotifications();
    expect(xml).toContain("<task-type>hook</task-type>");
    expect(xml).toContain("<status>failed</status>");
    expect(xml).toContain(
      "<summary><system-reminder>\nboom\n</system-reminder></summary>",
    );

    // The queue only turns into a model turn if the XML parses — a malformed
    // payload would be dropped silently and the wake would never happen.
    const parsed = parseTaskNotificationXml(xml);
    expect(parsed).not.toBeNull();
    expect(parsed?.taskType).toBe("hook");
    expect(parsed?.summary).toBe("<system-reminder>\nboom\n</system-reminder>");
  });

  it("falls back to stdout when stderr is empty", async () => {
    mockExecuteCommand.mockResolvedValue(
      result({ exitCode: 2, stdout: "from stdout" }),
    );

    await manager.executeHooks("PostToolUse", context);
    await flush();

    const [xml] = messageQueue.drainNotifications();
    expect(xml).toContain("<system-reminder>\nfrom stdout\n</system-reminder>");
  });

  it("does not wake on exit code 0", async () => {
    mockExecuteCommand.mockResolvedValue(result({ exitCode: 0, stdout: "ok" }));

    await manager.executeHooks("PostToolUse", context);
    await flush();

    expect(messageQueue.hasNotifications()).toBe(false);
  });

  it("does not wake on a non-blocking error exit code", async () => {
    mockExecuteCommand.mockResolvedValue(
      result({ exitCode: 1, stderr: "warning" }),
    );

    await manager.executeHooks("PostToolUse", context);
    await flush();

    expect(messageQueue.hasNotifications()).toBe(false);
  });

  it("does not wake when the hook times out", async () => {
    mockExecuteCommand.mockResolvedValue(
      result({ exitCode: 2, stderr: "killed", timedOut: true }),
    );

    await manager.executeHooks("PostToolUse", context);
    await flush();

    expect(messageQueue.hasNotifications()).toBe(false);
  });

  it("does not wake when the hook cannot be spawned", async () => {
    mockExecuteCommand.mockRejectedValue(new Error("spawn ENOENT"));

    await manager.executeHooks("PostToolUse", context);
    await flush();

    expect(messageQueue.hasNotifications()).toBe(false);
    expect(logger?.error).toHaveBeenCalledWith(
      expect.stringContaining("failed: spawn ENOENT"),
    );
  });

  it("does not wake on exit code 2 without any output", async () => {
    mockExecuteCommand.mockResolvedValue(result({ exitCode: 2 }));

    await manager.executeHooks("PostToolUse", context);
    await flush();

    expect(messageQueue.hasNotifications()).toBe(false);
  });

  it("stays silent when no message queue is registered", async () => {
    const bare = new HookManager(new Container(), "/test/workdir");
    bare.loadConfigurationFromWaveConfig(rewakingHookConfig());
    mockExecuteCommand.mockResolvedValue(
      result({ exitCode: 2, stderr: "boom" }),
    );

    await expect(bare.executeHooks("PostToolUse", context)).resolves.toEqual(
      [],
    );
    await flush();
  });
});
