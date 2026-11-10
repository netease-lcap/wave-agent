import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillManager } from "../../src/managers/skillManager.js";
import { Container } from "../../src/utils/container.js";
import { readdir, stat } from "fs/promises";
import * as path from "path";
import { parseSkillFile } from "../../src/utils/skillParser.js";

vi.mock("fs/promises");
vi.mock("../../src/utils/skillParser.js", async () => {
  const actual = await vi.importActual("../../src/utils/skillParser.js");
  return {
    ...actual,
    parseSkillFile: vi.fn(),
  };
});

describe("SkillManager Symlink Support", () => {
  let skillManager: SkillManager;
  let container: Container;

  beforeEach(() => {
    vi.clearAllMocks();
    container = new Container();
    skillManager = new SkillManager(container, {
      workdir: "/test/workdir",
      personalSkillsPath: "/test/personal/skills",
    });
  });

  it("should discover skills in symlinked directories", async () => {
    // Mock readdir to return a directory and a symlink
    vi.mocked(readdir).mockImplementation(async (path) => {
      if (path === "/test/personal/skills") {
        return [
          {
            name: "real-dir",
            isDirectory: () => true,
            isSymbolicLink: () => false,
          },
          {
            name: "symlink-dir",
            isDirectory: () => false,
            isSymbolicLink: () => true,
          },
          {
            name: "broken-symlink",
            isDirectory: () => false,
            isSymbolicLink: () => true,
          },
          {
            name: "file-symlink",
            isDirectory: () => false,
            isSymbolicLink: () => true,
          },
        ] as unknown as Awaited<ReturnType<typeof readdir>>;
      }
      return [] as unknown as Awaited<ReturnType<typeof readdir>>;
    });

    // Mock stat to handle symlinks and SKILL.md checks
    vi.mocked(stat).mockImplementation(async (path) => {
      const p = path.toString();
      if (p === "/test/personal/skills/symlink-dir") {
        return { isDirectory: () => true } as unknown as Awaited<
          ReturnType<typeof stat>
        >;
      }
      if (p === "/test/personal/skills/file-symlink") {
        return { isDirectory: () => false } as unknown as Awaited<
          ReturnType<typeof stat>
        >;
      }
      if (p === "/test/personal/skills/broken-symlink") {
        throw new Error("ENOENT");
      }
      if (p.endsWith("SKILL.md")) {
        return { isFile: () => true } as unknown as Awaited<
          ReturnType<typeof stat>
        >;
      }
      return { isDirectory: () => true } as unknown as Awaited<
        ReturnType<typeof stat>
      >;
    });

    vi.mocked(parseSkillFile).mockImplementation((path) => {
      const name = path.includes("real-dir") ? "real-skill" : "symlink-skill";
      return {
        isValid: true,
        skillMetadata: {
          name,
          description: "desc",
          type: "personal",
          skillPath: path.replace("/SKILL.md", ""),
        },
        content: "content",
        frontmatter: {},
        validationErrors: [],
      } as unknown as ReturnType<typeof parseSkillFile>;
    });

    await skillManager.initialize();

    const skills = skillManager.getAvailableSkills();
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name);
    expect(names).toContain("real-skill");
    expect(names).toContain("symlink-skill");

    // Verify that broken-symlink and file-symlink were ignored
    expect(names).not.toContain("broken-symlink");
    expect(names).not.toContain("file-symlink");
  });

  it("should skip dot-prefixed entries (installer staging directories)", async () => {
    vi.mocked(readdir).mockImplementation(async (path) => {
      if (path === "/test/personal/skills") {
        return [
          {
            name: "real-skill",
            isDirectory: () => true,
            isSymbolicLink: () => false,
          },
          // What an installer unpacks into before renaming it into place.
          {
            name: ".real-skill.install-4f1c9a",
            isDirectory: () => true,
            isSymbolicLink: () => false,
          },
        ] as unknown as Awaited<ReturnType<typeof readdir>>;
      }
      return [] as unknown as Awaited<ReturnType<typeof readdir>>;
    });

    vi.mocked(stat).mockImplementation(
      async () =>
        ({ isFile: () => true, isDirectory: () => true }) as unknown as Awaited<
          ReturnType<typeof stat>
        >,
    );

    vi.mocked(parseSkillFile).mockImplementation(
      () =>
        ({
          isValid: true,
          skillMetadata: {
            name: "real-skill",
            description: "desc",
            type: "personal",
            skillPath: "/test/personal/skills/real-skill",
          },
          content: "content",
          frontmatter: {},
          validationErrors: [],
        }) as unknown as ReturnType<typeof parseSkillFile>,
    );

    await skillManager.initialize();

    expect(skillManager.getAvailableSkills().map((s) => s.name)).toEqual([
      "real-skill",
    ]);
    // The staging directory is not even probed for a half-written SKILL.md.
    expect(vi.mocked(parseSkillFile).mock.calls.map(([p]) => p)).not.toContain(
      path.join(
        "/test/personal/skills",
        ".real-skill.install-4f1c9a",
        "SKILL.md",
      ),
    );
  });
});
