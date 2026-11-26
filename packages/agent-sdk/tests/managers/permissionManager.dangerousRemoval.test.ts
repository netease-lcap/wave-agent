import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { Container } from "../../src/utils/container.js";
import type { ConfigurationService } from "../../src/services/configurationService.js";
import type {
  PermissionCallback,
  PermissionDecision,
  PermissionMode,
  ToolPermissionContext,
} from "../../src/types/permissions.js";
import { BASH_TOOL_NAME } from "../../src/constants/tools.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const WORKDIR = path.resolve("/fake/project/repo/sub");
const PARENT = path.dirname(WORKDIR);

function createManager(options: {
  allowedRules?: string[];
  additionalDirectories?: string[];
  configuredPermissionMode?: PermissionMode;
}): PermissionManager {
  const container = new Container();
  container.register("CurrentWorkdir", WORKDIR);
  const configurationService = {
    getCurrentConfiguration: () => ({ sandbox: {} }),
  } as unknown as ConfigurationService;
  container.register("ConfigurationService", configurationService);
  return new PermissionManager(container, {
    allowedRules: options.allowedRules,
    additionalDirectories: options.additionalDirectories,
    configuredPermissionMode: options.configuredPermissionMode,
  });
}

const allowOnce = () =>
  vi.fn().mockResolvedValue({ behavior: "allow" } as PermissionDecision);

function check(
  manager: PermissionManager,
  command: string,
  options: {
    mode?: PermissionMode;
    callback?: PermissionCallback;
  } = {},
) {
  return manager.checkPermission(
    manager.createContext(
      BASH_TOOL_NAME,
      options.mode ?? "default",
      options.callback,
      { command, workdir: WORKDIR },
    ),
  );
}

describe("removing the session's own working directory", () => {
  it("asks even when an allow rule covers every rm", async () => {
    const manager = createManager({ allowedRules: ["Bash(rm:*)"] });
    const callback = allowOnce();

    const result = await check(manager, "rm -rf ../..", {
      callback: callback as unknown as PermissionCallback,
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(result.behavior).toBe("allow");
  });

  it.each<PermissionMode>(["default", "acceptEdits", "plan"])(
    "asks in %s mode",
    async (mode) => {
      const manager = createManager({});
      const callback = allowOnce();

      await check(manager, "rm -rf ../..", {
        mode,
        callback: callback as unknown as PermissionCallback,
      });

      expect(callback).toHaveBeenCalledTimes(1);
    },
  );

  it("is released by bypassPermissions, as Claude Code does", async () => {
    // Claude Code marks this check `waivableInBypass`: a mode whose promise is
    // "do not ask me" answers the card itself. Approving here would mean the
    // prompt came back in the one mode that exists to suppress it.
    const manager = createManager({});
    const callback = allowOnce();

    const result = await check(manager, "rm -rf ../..", {
      mode: "bypassPermissions",
      callback: callback as unknown as PermissionCallback,
    });

    expect(callback).not.toHaveBeenCalled();
    expect(result.behavior).toBe("allow");
  });

  it("is released in plan mode when the session was created with bypass", async () => {
    const manager = createManager({
      configuredPermissionMode: "bypassPermissions",
    });
    manager.captureBypassAuthorization();
    const callback = allowOnce();

    const result = await check(manager, "rm -rf ../..", {
      mode: "plan",
      callback: callback as unknown as PermissionCallback,
    });

    expect(callback).not.toHaveBeenCalled();
    expect(result.behavior).toBe("allow");
  });

  it("still asks in default mode for a session created with bypass", async () => {
    // The authorization is frozen for plan mode only; it is not a licence for
    // every later mode to skip the card.
    const manager = createManager({
      configuredPermissionMode: "bypassPermissions",
    });
    manager.captureBypassAuthorization();
    const callback = allowOnce();

    await check(manager, "rm -rf ../..", {
      mode: "default",
      callback: callback as unknown as PermissionCallback,
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("denies in dontAsk mode instead of asking", async () => {
    const manager = createManager({});
    const callback = allowOnce();

    const result = await check(manager, "rm -rf ../..", {
      mode: "dontAsk",
      callback: callback as unknown as PermissionCallback,
    });

    expect(callback).not.toHaveBeenCalled();
    expect(result.behavior).toBe("deny");
  });

  it("denies when nobody can answer, and says why", async () => {
    const manager = createManager({});

    const result = await check(manager, "rm -rf ../..");

    expect(result.behavior).toBe("deny");
    // The model reads only this message; without the reason it would treat the
    // denial as a transient glitch and reach for another tool.
    expect(result.message).toContain("working directory");
  });

  it("withdraws the persistence option and explains itself on the card", async () => {
    const manager = createManager({});
    let shown: ToolPermissionContext | undefined;
    const callback = vi.fn(async (context: ToolPermissionContext) => {
      shown = context;
      return { behavior: "allow" } as PermissionDecision;
    });

    await check(manager, "rm -rf ..", { callback });

    expect(shown?.hidePersistentOption).toBe(true);
    expect(shown?.warning).toContain(PARENT);
  });

  it("guards every additional directory too", async () => {
    const added = path.resolve("/fake/other");
    const manager = createManager({ additionalDirectories: [added] });
    const callback = allowOnce();

    await check(manager, `rm -rf ${added}`, {
      callback: callback as unknown as PermissionCallback,
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does not get in the way of an ordinary removal", async () => {
    const manager = createManager({});
    const callback = allowOnce();

    const result = await check(manager, "rm -rf node_modules", {
      mode: "bypassPermissions",
      callback: callback as unknown as PermissionCallback,
    });

    expect(callback).not.toHaveBeenCalled();
    expect(result.behavior).toBe("allow");
  });

  it("ignores a command that is not a shell command", async () => {
    const manager = createManager({});
    const callback = allowOnce();

    const result = await check(manager, "find . -delete", {
      mode: "bypassPermissions",
      callback: callback as unknown as PermissionCallback,
    });

    expect(callback).not.toHaveBeenCalled();
    expect(result.behavior).toBe("allow");
  });
});
