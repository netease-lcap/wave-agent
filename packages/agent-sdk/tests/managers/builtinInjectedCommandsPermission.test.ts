import { describe, it, expect, vi, beforeEach } from "vitest";
import { BUILTIN_CONTENT } from "../../src/builtin/index.js";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { Container } from "../../src/utils/container.js";
import { BASH_TOOL_NAME } from "../../src/constants/tools.js";
import {
  parseFrontmatterYaml,
  splitFrontmatter,
} from "../../src/utils/frontmatterYaml.js";
import { parseBashCommands } from "../../src/utils/markdownParser.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const WORKDIR = "/home/user/project";

/**
 * Injected commands (`!`cmd``) in a skill run before the model is involved, so
 * the only thing that can authorize them is the skill's own `allowed-tools`
 * (plus the built-in defaults). A built-in skill that injects a command it does
 * not declare does not degrade — the whole invocation aborts with a permission
 * error, because there is no tool call to attach an interactive prompt to.
 * That is why this is a test over the shipped content rather than a review.
 */
describe("built-in skills: injected commands pass their own allowed-tools", () => {
  let permissionManager: PermissionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const container = new Container();
    container.register("Workdir", WORKDIR);
    permissionManager = new PermissionManager(container);
  });

  const skillFiles = Object.entries(BUILTIN_CONTENT).filter(([path]) =>
    path.endsWith("/SKILL.md"),
  );

  it.each(skillFiles)("%s", async (_path, content) => {
    const { yaml } = splitFrontmatter(content);
    expect(yaml).not.toBeNull();
    const frontmatter = parseFrontmatterYaml(yaml as string);
    expect(frontmatter.name).toBeTruthy();

    const allowedTools = String(frontmatter["allowed-tools"] ?? "")
      .split(",")
      .map((rule) => rule.trim())
      .filter(Boolean);
    permissionManager.addTemporaryRules(allowedTools);

    const { commands } = parseBashCommands(content);
    if (commands.length === 0) return;

    for (const command of commands) {
      const decision = await permissionManager.checkPermission(
        permissionManager.createContext(BASH_TOOL_NAME, "default", undefined, {
          command,
          workdir: WORKDIR,
        }),
      );
      expect(
        decision.behavior,
        `skill ${frontmatter.name} injects a command its allowed-tools do not cover: ${command}`,
      ).toBe("allow");
    }
  });
});
