import { describe, it, expect, vi } from "vitest";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import type { ToolPermissionContext } from "../../src/types/permissions.js";
import { Container } from "../../src/utils/container.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createManager(): PermissionManager {
  const container = new Container();
  container.register("CurrentWorkdir", "/home/user/project");
  return new PermissionManager(container);
}

/**
 * `matchesRule` is private, but the whole point of these cases is the rule
 * evaluation itself: Workflow/Agent are not restricted tools, so
 * `checkPermission` returns `allow` for reasons unrelated to the rule.
 */
function matches(
  manager: PermissionManager,
  toolName: string,
  toolInput: Record<string, unknown>,
  rule: string,
): boolean {
  const context: ToolPermissionContext = {
    toolName,
    permissionMode: "default",
    toolInput,
  };
  return (
    manager as unknown as {
      matchesRule: (ctx: ToolPermissionContext, pattern: string) => boolean;
    }
  ).matchesRule(context, rule);
}

describe("matchesRule named-argument rules", () => {
  it("matches a namespaced Workflow call", () => {
    const manager = createManager();
    expect(
      matches(
        manager,
        "Workflow",
        { name: "my-plugin:scan" },
        "Workflow(my-plugin:scan)",
      ),
    ).toBe(true);
  });

  it("does not match a different workflow name", () => {
    const manager = createManager();
    expect(
      matches(
        manager,
        "Workflow",
        { name: "my-plugin:other" },
        "Workflow(my-plugin:scan)",
      ),
    ).toBe(false);
  });

  it("matches an Agent call by subagent_type", () => {
    const manager = createManager();
    expect(
      matches(
        manager,
        "Agent",
        { subagent_type: "Explore", description: "look", prompt: "find" },
        "Agent(Explore)",
      ),
    ).toBe(true);
  });

  it("does not match a different subagent_type", () => {
    const manager = createManager();
    expect(
      matches(
        manager,
        "Agent",
        {
          subagent_type: "general-purpose",
          description: "look",
          prompt: "find",
        },
        "Agent(Explore)",
      ),
    ).toBe(false);
  });

  it("supports a wildcard over workflow names", () => {
    const manager = createManager();
    expect(
      matches(
        manager,
        "Workflow",
        { name: "my-plugin:scan" },
        "Workflow(my-plugin:*)",
      ),
    ).toBe(true);
  });

  it("ignores the rule when the named argument is absent", () => {
    const manager = createManager();
    expect(
      matches(
        manager,
        "Workflow",
        { script: "export const meta = {}" },
        "Workflow(my-plugin:scan)",
      ),
    ).toBe(false);
  });

  it("still matches the bare tool name", () => {
    const manager = createManager();
    expect(matches(manager, "Workflow", { name: "x" }, "Workflow")).toBe(true);
  });

  describe("comma-separated names", () => {
    // The exact shape Claude Code's claude-security plugin ships: one rule
    // pre-authorizing every subagent it dispatches.
    const LIST_RULE =
      "Agent(claude-security:scan-inventory, claude-security:scan-researcher, claude-security:scan-verifier, claude-security:explore)";

    it("matches any name in the list", () => {
      const manager = createManager();
      for (const subagentType of [
        "claude-security:scan-inventory",
        "claude-security:scan-researcher",
        "claude-security:scan-verifier",
        "claude-security:explore",
      ]) {
        expect(
          matches(
            manager,
            "Agent",
            { subagent_type: subagentType, description: "d", prompt: "p" },
            LIST_RULE,
          ),
        ).toBe(true);
      }
    });

    it("does not match a name the list omits", () => {
      const manager = createManager();
      expect(
        matches(
          manager,
          "Agent",
          { subagent_type: "claude-security:patch-generator", prompt: "p" },
          LIST_RULE,
        ),
      ).toBe(false);
    });

    it("tolerates sloppy spacing", () => {
      const manager = createManager();
      expect(
        matches(
          manager,
          "Agent",
          { subagent_type: "b", prompt: "p" },
          "Agent( a ,b,  c )",
        ),
      ).toBe(true);
    });

    it("allows a glob inside the list", () => {
      const manager = createManager();
      expect(
        matches(
          manager,
          "Agent",
          { subagent_type: "claude-security:patch-verifier", prompt: "p" },
          "Agent(Explore, claude-security:patch-*)",
        ),
      ).toBe(true);
    });

    it("matches a comma-separated Workflow list", () => {
      const manager = createManager();
      expect(
        matches(
          manager,
          "Workflow",
          { name: "my-plugin:patch" },
          "Workflow(my-plugin:scan, my-plugin:patch)",
        ),
      ).toBe(true);
    });
  });
});
