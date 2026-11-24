import { describe, it, expect, beforeEach, vi } from "vitest";
import { HookManager } from "../../src/managers/hookManager.js";
import { Container } from "../../src/utils/container.js";
import { HookMatcher } from "../../src/utils/hookMatcher.js";
import * as hookService from "../../src/services/hook.js";
import {
  HOOK_SOURCE_LIMITS,
  type HookCommand,
  type HookEventConfig,
  type PartialHookConfiguration,
} from "../../src/types/hooks.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the hook services
vi.mock("../../src/services/hook.js", async () => {
  const actual = (await vi.importActual(
    "../../src/services/hook.js",
  )) as Record<string, unknown>;
  return {
    ...actual,
    executeCommand: vi.fn(),
    isCommandSafe: vi.fn().mockReturnValue(true),
  };
});
const mockExecuteCommand = vi.mocked(hookService.executeCommand);

/** A single hook command declaration, as a skill's frontmatter would write it. */
function hookConfig(
  command: string,
  extra: Partial<HookCommand> = {},
): HookEventConfig {
  return {
    hooks: [{ type: "command", command, ...extra }],
  };
}

const SKILL_ROOT = "/skills/demo";

describe("HookManager skill hooks", () => {
  let manager: HookManager;

  const context = {
    event: "UserPromptSubmit" as const,
    projectDir: "/test/workdir",
    timestamp: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new HookManager(
      new Container(),
      "/test/workdir",
      new HookMatcher(),
    );
    mockExecuteCommand.mockResolvedValue({
      success: true,
      duration: 10,
      timedOut: false,
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  });

  describe("registerSkillHooks", () => {
    it("registers a skill's hooks with their source stamped on each command", () => {
      const outcome = manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [hookConfig("echo skill")],
      });

      expect(outcome).toEqual({
        registered: true,
        hookCount: 1,
        matcherChars: 0,
      });
      expect(manager.hasHooks("UserPromptSubmit")).toBe(true);

      const hook = manager.getSkillHooks().UserPromptSubmit?.[0]?.hooks?.[0];
      expect(hook?.command).toBe("echo skill");
      expect(hook?.skillRoot).toBe(SKILL_ROOT);
      expect(hook?.skillName).toBe("demo");
    });

    it("replaces (does not double) a re-registration of the same skill root", () => {
      const hooks: PartialHookConfiguration = {
        UserPromptSubmit: [hookConfig("echo skill")],
      };
      manager.registerSkillHooks(SKILL_ROOT, "demo", hooks);
      manager.registerSkillHooks(SKILL_ROOT, "demo", hooks);

      // One config for the event in the merged view, not two, and the hook
      // still runs exactly once.
      expect(manager.getConfiguration()?.UserPromptSubmit).toHaveLength(1);
      expect(
        manager.getConfiguration()?.UserPromptSubmit?.[0]?.hooks,
      ).toHaveLength(1);
    });

    it("skips an unknown event name but keeps the rest", () => {
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        NotAnEvent: [hookConfig("echo bogus")],
        UserPromptSubmit: [hookConfig("echo skill")],
      } as unknown as PartialHookConfiguration);

      expect(manager.getSkillHooks().UserPromptSubmit).toHaveLength(1);
      const merged = manager.getConfiguration();
      expect(merged && "NotAnEvent" in merged).toBe(false);
    });

    it("keeps identical hooks from two skills as two separate sources", () => {
      manager.registerSkillHooks("/skills/a", "a", {
        UserPromptSubmit: [hookConfig("echo skill")],
      });
      manager.registerSkillHooks("/skills/b", "b", {
        UserPromptSubmit: [hookConfig("echo skill")],
      });

      // Two distinct sources: both stay (no cross-source de-duplication).
      expect(manager.getConfiguration()?.UserPromptSubmit).toHaveLength(2);
    });
  });

  describe("duplicate hooks inside one source", () => {
    it("keeps one copy when a skill lists the same hook twice", async () => {
      // Spec 故事③场景 2: one source listing a hook twice means it once. Claude
      // Code collapses it the same way (its session registry replaces an equal
      // entry in the same matcher bucket instead of appending).
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: "echo twice" },
              { type: "command", command: "echo twice" },
            ],
          },
        ],
      });

      expect(
        manager.getConfiguration()?.UserPromptSubmit?.[0]?.hooks,
      ).toHaveLength(1);

      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    });

    it("collapses the duplicate across two configs of the same source", async () => {
      // The same command split into two entries — as an author editing the file
      // leaves it — is still one hook.
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [hookConfig("echo twice"), hookConfig("echo twice")],
      });

      expect(manager.getConfiguration()?.UserPromptSubmit).toHaveLength(1);

      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    });

    it("keeps both copies under different matchers", () => {
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        PostToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo x" }] },
          { matcher: "Write", hooks: [{ type: "command", command: "echo x" }] },
        ],
      });

      expect(manager.getConfiguration()?.PostToolUse).toHaveLength(2);
    });

    it("keeps both copies when only one of them is `once`", () => {
      // Same text, different run mode: not the same registration.
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [
          hookConfig("echo x"),
          hookConfig("echo x", { once: true }),
        ],
      });

      expect(manager.getConfiguration()?.UserPromptSubmit).toHaveLength(2);
    });

    it("keeps a settings copy and a skill copy of the same hook apart", async () => {
      manager.loadConfigurationFromWaveConfig({
        hooks: { UserPromptSubmit: [hookConfig("echo same")] },
      });
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [hookConfig("echo same")],
      });

      expect(manager.getConfiguration()?.UserPromptSubmit).toHaveLength(2);

      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
    });
  });

  describe("unregisterSkillHooks", () => {
    it("removes the skill's hooks from the merged configuration", () => {
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [hookConfig("echo skill")],
      });
      manager.loadConfigurationFromWaveConfig({
        hooks: { UserPromptSubmit: [hookConfig("echo settings")] },
      });

      expect(manager.unregisterSkillHooks(SKILL_ROOT)).toBe(true);
      expect(manager.getSkillHooks()).toEqual({});
      expect(manager.getConfiguration()?.UserPromptSubmit).toHaveLength(1);
      expect(
        manager.getConfiguration()?.UserPromptSubmit?.[0]?.hooks?.[0]?.command,
      ).toBe("echo settings");
      // Already gone: nothing more to remove.
      expect(manager.unregisterSkillHooks(SKILL_ROOT)).toBe(false);
    });
  });

  describe("per-source budget", () => {
    function withHookCount(count: number): PartialHookConfiguration {
      return {
        UserPromptSubmit: [
          {
            hooks: Array.from({ length: count }, (_, index) => ({
              type: "command" as const,
              command: `echo ${index}`,
            })),
          },
        ],
      };
    }

    it("registers exactly maxHooks commands", () => {
      const outcome = manager.registerSkillHooks(
        SKILL_ROOT,
        "demo",
        withHookCount(HOOK_SOURCE_LIMITS.maxHooks),
      );

      expect(outcome).toEqual({
        registered: true,
        hookCount: HOOK_SOURCE_LIMITS.maxHooks,
        matcherChars: 0,
      });
      expect(manager.hasHooks("UserPromptSubmit")).toBe(true);
    });

    it("registers nothing one command over maxHooks", () => {
      const outcome = manager.registerSkillHooks(
        SKILL_ROOT,
        "demo",
        withHookCount(HOOK_SOURCE_LIMITS.maxHooks + 1),
      );

      expect(outcome).toEqual({
        registered: false,
        hookCount: HOOK_SOURCE_LIMITS.maxHooks + 1,
        matcherChars: 0,
      });
      expect(manager.hasHooks("UserPromptSubmit")).toBe(false);
      expect(manager.getSkillHooks()).toEqual({});
    });

    it("registers exactly maxMatcherChars of matcher", () => {
      const outcome = manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [
          {
            matcher: "a".repeat(HOOK_SOURCE_LIMITS.maxMatcherChars),
            hooks: [{ type: "command", command: "echo skill" }],
          },
        ],
      });

      expect(outcome).toEqual({
        registered: true,
        hookCount: 1,
        matcherChars: HOOK_SOURCE_LIMITS.maxMatcherChars,
      });
      expect(manager.hasHooks("UserPromptSubmit")).toBe(true);
    });

    it("registers nothing one character over maxMatcherChars", () => {
      const outcome = manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [
          {
            matcher: "a".repeat(HOOK_SOURCE_LIMITS.maxMatcherChars + 1),
            hooks: [{ type: "command", command: "echo skill" }],
          },
        ],
      });

      expect(outcome).toEqual({
        registered: false,
        hookCount: 1,
        matcherChars: HOOK_SOURCE_LIMITS.maxMatcherChars + 1,
      });
      expect(manager.hasHooks("UserPromptSubmit")).toBe(false);
    });

    it("drops an earlier registration when a later version is over budget", () => {
      manager.registerSkillHooks(SKILL_ROOT, "demo", withHookCount(1));
      expect(manager.hasHooks("UserPromptSubmit")).toBe(true);

      // Reshaped on disk into something too big: the older, smaller set must
      // not survive it.
      const outcome = manager.registerSkillHooks(
        SKILL_ROOT,
        "demo",
        withHookCount(HOOK_SOURCE_LIMITS.maxHooks + 1),
      );

      expect(outcome.registered).toBe(false);
      expect(manager.hasHooks("UserPromptSubmit")).toBe(false);
      expect(manager.getConfiguration()).toBeUndefined();
    });
  });

  describe("source ordering and cross-source hooks", () => {
    it("keeps settings before skill and executes both identical hooks", async () => {
      manager.loadConfigurationFromWaveConfig({
        hooks: { UserPromptSubmit: [hookConfig("echo same")] },
      });
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [hookConfig("echo same")],
      });

      const configs = manager.getConfiguration()?.UserPromptSubmit ?? [];
      expect(configs).toHaveLength(2);
      // No cross-source de-duplication: the same text stays two configs.
      expect(configs[0].hooks[0].command).toBe("echo same");
      expect(configs[1].hooks[0].command).toBe("echo same");

      const results = await manager.executeHooks("UserPromptSubmit", context);
      expect(results).toHaveLength(2);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(2);

      const sources = configs.map((config) => ({
        pluginRoot: config.hooks[0].pluginRoot,
        skillRoot: config.hooks[0].skillRoot,
      }));
      expect(sources).toEqual([
        { pluginRoot: undefined, skillRoot: undefined },
        { pluginRoot: undefined, skillRoot: SKILL_ROOT },
      ]);
    });

    it("runs settings hooks before skill hooks", async () => {
      manager.loadConfigurationFromWaveConfig({
        hooks: { UserPromptSubmit: [hookConfig("echo settings")] },
      });
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [hookConfig("echo skill")],
      });

      await manager.executeHooks("UserPromptSubmit", context);

      expect(mockExecuteCommand).toHaveBeenNthCalledWith(
        1,
        "echo settings",
        expect.anything(),
        undefined,
      );
      expect(mockExecuteCommand).toHaveBeenNthCalledWith(
        2,
        "echo skill",
        expect.anything(),
        undefined,
      );
    });
  });

  describe("skill directory env and placeholder substitution", () => {
    it("substitutes ${WAVE_SKILL_DIR} and exports it to the hook process", async () => {
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [hookConfig("${WAVE_SKILL_DIR}/scripts/hook.sh")],
      });

      await manager.executeHooks("UserPromptSubmit", context);

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "/skills/demo/scripts/hook.sh",
        expect.objectContaining({
          env: expect.objectContaining({
            WAVE_SKILL_DIR: SKILL_ROOT,
            CLAUDE_SKILL_DIR: SKILL_ROOT,
          }),
        }),
        undefined,
      );
    });

    it("leaves the placeholder untouched for a non-skill hook", async () => {
      manager.loadConfiguration({
        UserPromptSubmit: [hookConfig("${WAVE_SKILL_DIR}/scripts/hook.sh")],
      });

      await manager.executeHooks("UserPromptSubmit", context);

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "${WAVE_SKILL_DIR}/scripts/hook.sh",
        context,
        undefined,
      );
    });
  });

  describe("once", () => {
    it("retires a successful once hook but keeps the rest of its config", async () => {
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [
          {
            hooks: [
              { type: "command", command: "echo once", once: true },
              { type: "command", command: "echo always" },
            ],
          },
        ],
      });

      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(2);

      // The once command is out of its source; the sibling is untouched.
      const remaining =
        manager.getSkillHooks().UserPromptSubmit?.[0]?.hooks ?? [];
      expect(remaining.map((hook) => hook.command)).toEqual(["echo always"]);

      mockExecuteCommand.mockClear();
      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "echo always",
        expect.anything(),
        undefined,
      );
    });

    it("keeps a once hook whose execution failed", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: false,
        duration: 10,
        timedOut: false,
        exitCode: 1,
        stdout: "",
        stderr: "boom",
      });
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [hookConfig("echo once", { once: true })],
      });

      await manager.executeHooks("UserPromptSubmit", context);
      expect(manager.hasHooks("UserPromptSubmit")).toBe(true);

      mockExecuteCommand.mockClear();
      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    });

    it("keeps a once hook that timed out", async () => {
      mockExecuteCommand.mockResolvedValue({
        success: false,
        duration: 10000,
        timedOut: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [hookConfig("echo once", { once: true })],
      });

      await manager.executeHooks("UserPromptSubmit", context);
      expect(manager.hasHooks("UserPromptSubmit")).toBe(true);
    });

    it("does not revive a once hook when the skill is re-registered", async () => {
      // Every rescan re-parses SKILL.md, so the same `once: true` command comes
      // back as a brand-new object. Retirement only removed it from the previous
      // registration, and a real session proved that is not enough: a hook that
      // writes a file into its own skill directory triggers a rescan, and the
      // hook fired a second time (spec 边界情况 says once per session).
      const frontmatter = () => ({
        UserPromptSubmit: [hookConfig("echo once", { once: true })],
      });

      manager.registerSkillHooks(SKILL_ROOT, "demo", frontmatter());
      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);

      mockExecuteCommand.mockClear();
      manager.registerSkillHooks(SKILL_ROOT, "demo", frontmatter());
      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it("runs a once hook again once its command text is edited", async () => {
      // The fingerprint carries the command, so "already ran" does not outlive
      // an edit: the author changed what the hook does, and the new command has
      // not run yet.
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [hookConfig("echo v1", { once: true })],
      });
      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);

      mockExecuteCommand.mockClear();
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [hookConfig("echo v2", { once: true })],
      });
      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "echo v2",
        expect.anything(),
        undefined,
      );
    });

    it("does not revive a settings once hook when the config is reloaded", async () => {
      // Same funnel, different reload: `loadConfigurationFromWaveConfig`
      // replaces the object wholesale on every settings change.
      const settings = () => ({
        hooks: { UserPromptSubmit: [hookConfig("echo once", { once: true })] },
      });

      manager.loadConfigurationFromWaveConfig(settings());
      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);

      mockExecuteCommand.mockClear();
      manager.loadConfigurationFromWaveConfig(settings());
      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it("keeps two sources' identical once hooks independent", async () => {
      // 故事③场景 1: the same hook text in settings and in a skill is two
      // commands. Retiring the skill's copy must not silence the settings one.
      manager.loadConfigurationFromWaveConfig({
        hooks: { UserPromptSubmit: [hookConfig("echo same")] },
      });
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [hookConfig("echo same", { once: true })],
      });

      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(2);

      mockExecuteCommand.mockClear();
      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "echo same",
        expect.anything(),
        undefined,
      );
    });

    it("retires a once hook from the plugin source too", async () => {
      manager.registerPluginHooks("/my/plugin", {
        UserPromptSubmit: [hookConfig("echo once", { once: true })],
      });

      await manager.executeHooks("UserPromptSubmit", context);
      expect(manager.getPluginHooks()).toEqual({});
      expect(manager.getConfiguration()).toBeUndefined();

      mockExecuteCommand.mockClear();
      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it("only retires the source that owns the executed command", async () => {
      // Identical command text on both sides; only the skill's is `once`. The
      // reference lookup must not take the settings copy with it.
      manager.loadConfigurationFromWaveConfig({
        hooks: { UserPromptSubmit: [hookConfig("echo same")] },
      });
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [hookConfig("echo same", { once: true })],
      });

      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(2);

      expect(manager.getSkillHooks()).toEqual({});
      expect(manager.getConfiguration()?.UserPromptSubmit).toHaveLength(1);

      mockExecuteCommand.mockClear();
      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
    });

    it("does not retire a once hook that runs asynchronously", async () => {
      manager.registerSkillHooks(SKILL_ROOT, "demo", {
        UserPromptSubmit: [
          hookConfig("echo once", { once: true, async: true }),
        ],
      });

      // Async hooks are not awaited and never enter the results, so there is no
      // synchronous success to retire them on.
      await manager.executeHooks("UserPromptSubmit", context);
      expect(mockExecuteCommand).toHaveBeenCalledTimes(1);
      expect(manager.hasHooks("UserPromptSubmit")).toBe(true);
    });
  });
});

describe("HookManager hook source label", () => {
  const context = {
    event: "SessionEnd" as const,
    projectDir: "/test/workdir",
    timestamp: new Date(),
  };

  function failingManager() {
    const manager = new HookManager(
      new Container(),
      "/test/workdir",
      new HookMatcher(),
    );
    mockExecuteCommand.mockResolvedValue({
      success: false,
      duration: 1,
      timedOut: false,
      exitCode: 1,
      stdout: "",
      stderr: "boom",
    });
    return manager;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tags a skill hook's result with skill:<name>", async () => {
    const manager = failingManager();
    manager.registerSkillHooks(SKILL_ROOT, "demo", {
      SessionEnd: [hookConfig("exit 1")],
    });

    const results = await manager.executeHooks("SessionEnd", context);

    expect(results[0].source).toBe("skill:demo");
  });

  it("leaves the source undefined for a settings hook", async () => {
    const manager = failingManager();
    manager.loadConfigurationFromWaveConfig({
      hooks: { SessionEnd: [hookConfig("exit 1")] },
    } as never);

    const results = await manager.executeHooks("SessionEnd", context);

    expect(results[0].source).toBeUndefined();
  });

  it("prefixes the user-facing notice with the source, and only there", async () => {
    const manager = failingManager();
    manager.registerSkillHooks(SKILL_ROOT, "demo", {
      SessionEnd: [hookConfig("exit 1")],
    });
    const results = await manager.executeHooks("SessionEnd", context);
    const messageManager = {
      addNoticeBlock: vi.fn(),
      addUserMessage: vi.fn(),
      getSessionId: () => "s1",
      getTranscriptPath: () => undefined,
    };

    manager.processHookResults("SessionEnd", results, messageManager as never);

    expect(messageManager.addNoticeBlock).toHaveBeenCalledWith(
      "[skill:demo] boom",
      "error",
    );
  });
});
