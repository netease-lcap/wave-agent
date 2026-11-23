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

  it.each<PermissionMode>([
    "default",
    "acceptEdits",
    "plan",
    "bypassPermissions",
  ])("asks in %s mode", async (mode) => {
    const manager = createManager({});
    const callback = allowOnce();

    await check(manager, "rm -rf ../..", {
      mode,
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

  it("leaves a bare shell probe alone under bypassPermissions", async () => {
    // A subagent in a bypass session ran `command -v bash` and got a card:
    // `command` is peeled as a wrapper, and the shell left behind has no script
    // of its own, so there is no deletion here to ask about.
    const manager = createManager({});
    const callback = allowOnce();

    const result = await check(manager, "command -v bash", {
      mode: "bypassPermissions",
      callback: callback as unknown as PermissionCallback,
    });

    expect(callback).not.toHaveBeenCalled();
    expect(result.behavior).toBe("allow");
  });
});

describe("deletions the check cannot read", () => {
  // The fail-closed half: a deletion this check cannot place is not "probably
  // fine", it is "nobody has looked", and the answer to that is a person. That
  // has to hold above every branch that could otherwise approve the call —
  // allow rules, acceptEdits and bypassPermissions included.
  const unreadable: Array<[string, string]> = [
    ["a command line the parser rejects", "rm -rf ../.. <<EOF\nx\nEOF"],
    ["a command line that is plain unbalanced", 'rm -rf ../.. "unclosed'],
    ["another shell's own command line", "powershell -NoProfile -Command x"],
    ["targets that arrive on stdin", "ls | xargs rm -rf"],
    ["a command that only mirrors", "robocopy build ../.. /MIR"],
  ];

  it.each(unreadable)(
    "asks about %s even with an allow rule and bypassPermissions",
    async (_label, command) => {
      const manager = createManager({ allowedRules: ["Bash(rm:*)"] });
      const callback = allowOnce();

      await check(manager, command, {
        mode: "bypassPermissions",
        callback: callback as unknown as PermissionCallback,
      });

      expect(callback).toHaveBeenCalledTimes(1);
    },
  );

  it("says what could not be checked and that no rule covers it", async () => {
    const manager = createManager({});
    let shown: ToolPermissionContext | undefined;
    const callback = vi.fn(async (context: ToolPermissionContext) => {
      shown = context;
      return { behavior: "allow" } as PermissionDecision;
    });

    await check(manager, "powershell -NoProfile -Command x", { callback });

    expect(shown?.hidePersistentOption).toBe(true);
    expect(shown?.warning).toContain("cannot be checked");
    expect(shown?.warning).toContain("cannot be covered");
  });

  it("denies in dontAsk mode instead of asking", async () => {
    const manager = createManager({});
    const callback = allowOnce();

    const result = await check(manager, "ls | xargs rm -rf", {
      mode: "dontAsk",
      callback: callback as unknown as PermissionCallback,
    });

    expect(callback).not.toHaveBeenCalled();
    expect(result.behavior).toBe("deny");
  });

  it.runIf(process.platform === "win32")(
    "asks about a Windows path Git Bash may read differently",
    async () => {
      const manager = createManager({ allowedRules: ["Bash(rm:*)"] });
      const callback = allowOnce();

      await check(manager, "rm -rf E:\\code\\myrepo", {
        mode: "bypassPermissions",
        callback: callback as unknown as PermissionCallback,
      });

      expect(callback).toHaveBeenCalledTimes(1);
    },
  );
});
