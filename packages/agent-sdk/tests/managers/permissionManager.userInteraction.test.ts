import { describe, it, expect, vi } from "vitest";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { Container } from "../../src/utils/container.js";
import type {
  PermissionCallback,
  PermissionDecision,
  PermissionMode,
} from "../../src/types/permissions.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const QUESTIONS = [
  {
    question: "What would you like to do?",
    header: "Job",
    options: [{ label: "Scan codebase" }, { label: "Scan changes" }],
  },
];

function createManager(): PermissionManager {
  return new PermissionManager(new Container(), {});
}

function ask(
  manager: PermissionManager,
  options: {
    mode?: PermissionMode;
    callback?: (() => Promise<PermissionDecision>) | undefined;
    toolName?: string;
    toolInput?: Record<string, unknown>;
  } = {},
) {
  const {
    mode = "default",
    callback,
    toolName = "AskUserQuestion",
    toolInput = { questions: QUESTIONS },
  } = options;
  return manager.checkPermission(
    manager.createContext(
      toolName,
      mode,
      callback as unknown as PermissionCallback | undefined,
      toolInput,
    ),
  );
}

describe("USER_INTERACTION_REQUIRED_TOOLS gate", () => {
  it("does not let an allow rule approve AskUserQuestion (skill allowed-tools case)", async () => {
    const manager = createManager();
    // Exactly what a skill's `allowed-tools` registers when it lists
    // AskUserQuestion — the shape security-audit ships.
    manager.addTemporaryRules(["AskUserQuestion"]);

    const callback = vi.fn().mockResolvedValue({
      behavior: "allow" as const,
      message: JSON.stringify({
        "What would you like to do?": "Scan codebase",
      }),
    });

    const decision = await ask(manager, { callback });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(decision.behavior).toBe("allow");
    expect(decision.message).toBe(
      JSON.stringify({ "What would you like to do?": "Scan codebase" }),
    );
  });

  it("denies instead of silently allowing when no callback exists", async () => {
    const manager = createManager();
    manager.addTemporaryRules(["AskUserQuestion"]);

    const decision = await ask(manager);

    expect(decision.behavior).toBe("deny");
    expect(decision.message).toContain("No permission callback configured");
  });

  it("still honors a deny rule", async () => {
    const manager = new PermissionManager(new Container(), {
      deniedRules: ["AskUserQuestion"],
    });
    const callback = vi.fn().mockResolvedValue({ behavior: "allow" as const });

    const decision = await ask(manager, { callback });

    expect(callback).not.toHaveBeenCalled();
    expect(decision.behavior).toBe("deny");
    expect(decision.message).toContain("explicitly denied");
  });

  it("still asks in bypassPermissions mode", async () => {
    const manager = createManager();
    const callback = vi.fn().mockResolvedValue({ behavior: "allow" as const });

    const decision = await ask(manager, {
      mode: "bypassPermissions",
      callback,
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(decision.behavior).toBe("allow");
  });

  it("still asks in dontAsk mode (the gate precedes the mode transformations)", async () => {
    const manager = createManager();
    const callback = vi.fn().mockResolvedValue({ behavior: "allow" as const });

    await ask(manager, { mode: "dontAsk", callback });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("applies to ExitPlanMode as well", async () => {
    const manager = createManager();
    manager.addTemporaryRules(["ExitPlanMode"]);
    const callback = vi.fn().mockResolvedValue({ behavior: "allow" as const });

    await ask(manager, {
      toolName: "ExitPlanMode",
      toolInput: {},
      callback,
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("leaves rule-based auto-allow for other tools untouched", async () => {
    const manager = createManager();
    manager.addTemporaryRules(["Bash(cp -a*)"]);
    const callback = vi.fn().mockResolvedValue({ behavior: "allow" as const });

    const decision = await ask(manager, {
      toolName: "Bash",
      toolInput: { command: "cp -a src dist" },
      callback,
    });

    expect(callback).not.toHaveBeenCalled();
    expect(decision.behavior).toBe("allow");
  });
});
