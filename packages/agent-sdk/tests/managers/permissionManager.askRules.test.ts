import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { Container } from "../../src/utils/container.js";
import type { ConfigurationService } from "../../src/services/configurationService.js";
import type {
  PermissionCallback,
  PermissionDecision,
  PermissionMode,
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

const WORKDIR = path.resolve("/fake/project");
/** Not covered by DEFAULT_ALLOWED_RULES, so only the sandbox gate can allow it. */
const COMMAND = "./scripts/deploy.sh --check";

function createManager(options: {
  autoAllowBashIfSandboxed?: boolean;
  deniedRules?: string[];
  askRules?: string[];
  allowedRules?: string[];
}): PermissionManager {
  const container = new Container();
  container.register("CurrentWorkdir", WORKDIR);
  const configurationService = {
    getCurrentConfiguration: () => ({
      sandbox: {
        autoAllowBashIfSandboxed: options.autoAllowBashIfSandboxed ?? false,
      },
    }),
  } as unknown as ConfigurationService;
  container.register("ConfigurationService", configurationService);
  return new PermissionManager(container, {
    askRules: options.askRules,
    deniedRules: options.deniedRules,
    allowedRules: options.allowedRules,
  });
}

const allowOnce = () =>
  vi.fn().mockResolvedValue({ behavior: "allow" } as PermissionDecision);

function ask(
  manager: PermissionManager,
  options: {
    mode?: PermissionMode;
    callback?: ReturnType<typeof allowOnce>;
    toolName?: string;
    toolInput?: Record<string, unknown>;
  } = {},
) {
  return manager.checkPermission(
    manager.createContext(
      options.toolName ?? "Artifact",
      options.mode ?? "default",
      options.callback as unknown as PermissionCallback | undefined,
      options.toolInput ?? { file_path: "/fake/project/report.html" },
    ),
  );
}

describe("PermissionManager — permissions.ask rules", () => {
  it("asks even when an allow rule covers the call", async () => {
    const manager = createManager({
      askRules: ["Artifact"],
      allowedRules: ["Artifact"],
    });
    const callback = allowOnce();

    await ask(manager, { callback });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("asks in bypassPermissions mode", async () => {
    const manager = createManager({ askRules: ["Artifact"] });
    const callback = allowOnce();

    await ask(manager, { mode: "bypassPermissions", callback });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("asks in acceptEdits mode for an edit it would have auto-accepted", async () => {
    const manager = createManager({ askRules: ["Write"] });
    const callback = allowOnce();

    await ask(manager, {
      mode: "acceptEdits",
      callback,
      toolName: "Write",
      toolInput: {
        file_path: path.join(WORKDIR, "src", "app.ts"),
        content: "x",
      },
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("asks in dontAsk mode instead of auto-denying", async () => {
    const manager = createManager({ askRules: ["Artifact"] });
    const callback = allowOnce();

    const decision = await ask(manager, { mode: "dontAsk", callback });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(decision.behavior).toBe("allow");
  });

  it("never offers to persist the answer", async () => {
    const manager = createManager({ askRules: ["Artifact"] });
    const context = manager.createContext(
      "Artifact",
      "bypassPermissions",
      allowOnce() as unknown as PermissionCallback,
      { file_path: path.join(WORKDIR, "report.html") },
    );

    await manager.checkPermission(context);

    expect(context.hidePersistentOption).toBe(true);
  });

  it("loses to a deny rule on the same call", async () => {
    const manager = createManager({
      askRules: ["Artifact"],
      deniedRules: ["Artifact"],
    });
    const callback = allowOnce();

    const decision = await ask(manager, { callback });

    expect(callback).not.toHaveBeenCalled();
    expect(decision.behavior).toBe("deny");
  });

  it("asks for a command inside a chain when the rule names the command", async () => {
    const manager = createManager({ askRules: ["Bash(git push*)"] });
    const callback = allowOnce();

    await ask(manager, {
      toolName: BASH_TOOL_NAME,
      callback,
      toolInput: {
        command: "cd repo && git push origin main",
        workdir: WORKDIR,
      },
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("gives way to the sandbox shortcut for a whole-tool rule", async () => {
    const manager = createManager({
      askRules: [BASH_TOOL_NAME],
      autoAllowBashIfSandboxed: true,
    });
    const callback = allowOnce();

    const decision = await ask(manager, {
      toolName: BASH_TOOL_NAME,
      callback,
      toolInput: { command: COMMAND, workdir: WORKDIR, sandboxed: true },
    });

    expect(callback).not.toHaveBeenCalled();
    expect(decision.behavior).toBe("allow");
  });

  it("keeps asking for a command-named rule even when the command is sandboxed", async () => {
    const manager = createManager({
      askRules: ["Bash(./scripts/deploy.sh*)"],
      autoAllowBashIfSandboxed: true,
    });
    const callback = allowOnce();

    await ask(manager, {
      toolName: BASH_TOOL_NAME,
      callback,
      toolInput: { command: COMMAND, workdir: WORKDIR, sandboxed: true },
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("PermissionManager — checkRuleBasedPermissions", () => {
  it("reports an ask verdict without asking anybody", async () => {
    const manager = createManager({ askRules: ["Artifact"] });
    const callback = allowOnce();
    const context = manager.createContext(
      "Artifact",
      "bypassPermissions",
      callback as unknown as PermissionCallback,
      { file_path: path.join(WORKDIR, "report.html") },
    );

    const verdict = manager.checkRuleBasedPermissions(context);

    expect(verdict?.decision).toBe("ask");
    expect(verdict?.reason).toBe("Artifact");
    expect(callback).not.toHaveBeenCalled();
  });

  it("reports a deny verdict", () => {
    const manager = createManager({ deniedRules: ["Artifact"] });
    const context = manager.createContext("Artifact", "default", undefined, {
      file_path: path.join(WORKDIR, "report.html"),
    });

    expect(manager.checkRuleBasedPermissions(context)?.decision).toBe("deny");
  });

  it("returns null when no rule objects", () => {
    const manager = createManager({ askRules: ["Bash(git push*)"] });
    const context = manager.createContext("Artifact", "default", undefined, {
      file_path: path.join(WORKDIR, "report.html"),
    });

    expect(manager.checkRuleBasedPermissions(context)).toBeNull();
  });
});
