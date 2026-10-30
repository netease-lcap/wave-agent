import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "fs";
import { SkillManager } from "../../src/managers/skillManager.js";
import { Container } from "../../src/utils/container.js";
import type { Skill } from "../../src/types/index.js";
import { executeBashCommands } from "../../src/utils/markdownParser.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock executeBashCommands to avoid actual execution
vi.mock("../../src/utils/markdownParser.js", async () => {
  const actual = await vi.importActual("../../src/utils/markdownParser.js");
  return {
    ...actual,
    executeBashCommands: vi.fn().mockResolvedValue([
      {
        command: "pwd",
        output: "/test/workdir",
        exitCode: 0,
      },
    ]),
  };
});

vi.mock("fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn(),
}));

describe("SkillManager with Arguments and Bash", () => {
  let skillManager: SkillManager;
  let container: Container;

  beforeEach(async () => {
    vi.clearAllMocks();
    container = new Container();
    skillManager = new SkillManager(container, {
      workdir: "/test/workdir",
    });
    await skillManager.initialize();
  });

  it("should substitute arguments in skill content", async () => {
    const mockSkill: Skill = {
      name: "test-skill",
      description: "A test skill",
      type: "personal",
      skillPath: "/path/to/skill",
      content: "---\nname: test-skill\n---\nHello $1! All: $ARGUMENTS",
      frontmatter: { name: "test-skill", description: "A test skill" },
      isValid: true,
      errors: [],
    };

    skillManager.registerPluginSkills("test-plugin", [mockSkill]);

    const result = await skillManager.executeSkill({
      skill_name: "test-plugin:test-skill",
      args: "World 'and friends'",
    });

    expect(result.content).toContain("Hello World! All: World 'and friends'");
  });

  it("should execute bash commands in skill content", async () => {
    const mockSkill: Skill = {
      name: "bash-skill",
      description: "A bash skill",
      type: "personal",
      skillPath: "/path/to/skill",
      content: "---\nname: bash-skill\n---\nCurrent dir: !`pwd`",
      frontmatter: { name: "bash-skill", description: "A bash skill" },
      isValid: true,
      errors: [],
    };

    skillManager.registerPluginSkills("test-plugin", [mockSkill]);

    const result = await skillManager.executeSkill({
      skill_name: "test-plugin:bash-skill",
    });

    expect(result.content).toContain("Current dir: /test/workdir");
  });

  it("should handle both arguments and bash commands", async () => {
    const mockSkill: Skill = {
      name: "mixed-skill",
      description: "A mixed skill",
      type: "personal",
      skillPath: "/path/to/skill",
      content: "---\nname: mixed-skill\n---\nHello $1! Dir: !`pwd`",
      frontmatter: { name: "mixed-skill", description: "A mixed skill" },
      isValid: true,
      errors: [],
    };

    skillManager.registerPluginSkills("test-plugin", [mockSkill]);

    const result = await skillManager.executeSkill({
      skill_name: "test-plugin:mixed-skill",
      args: "User",
    });

    expect(result.content).toContain("Hello User! Dir: /test/workdir");
  });

  // spec `ecosystem/agent-skills`「注入命令的参数不经 shell 传递」: the arguments
  // reach the script as a file, so `>`, `&&`, backticks and newlines in them
  // never become shell syntax.
  it("hands the raw arguments to a bash command as a file", async () => {
    const rawArgs = 'a > b && "c" `d`\nsecond line';
    let seen: { command: string; content: string } | undefined;
    vi.mocked(executeBashCommands).mockImplementationOnce(
      async (commands: string[]) => {
        seen = {
          command: commands[0],
          content: readFileSync(commands[0], "utf-8"),
        };
        return [{ command: commands[0], output: "ok", exitCode: 0 }];
      },
    );

    const mockSkill: Skill = {
      name: "args-skill",
      description: "A skill reading its arguments from a file",
      type: "personal",
      skillPath: "/path/to/skill",
      content: "---\nname: args-skill\n---\nArgs: !`${WAVE_ARGUMENTS_FILE}`",
      frontmatter: { name: "args-skill", description: "A skill" },
      isValid: true,
      errors: [],
    };

    skillManager.registerPluginSkills("test-plugin", [mockSkill]);

    const result = await skillManager.executeSkill({
      skill_name: "test-plugin:args-skill",
      args: rawArgs,
    });

    expect(seen?.content).toBe(rawArgs);
    // Deleted as soon as the injected command ran.
    expect(existsSync(seen?.command as string)).toBe(false);
    expect(result.content).toContain("Args: ok");
  });
});
