import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdir, stat } from "fs/promises";
import * as path from "path";
import { SkillManager } from "../../src/managers/skillManager.js";
import { Container } from "../../src/utils/container.js";
import { FileWatcherService } from "../../src/services/fileWatcher.js";
import type { SkillManagerOptions } from "../../src/types/index.js";

// 内置技能目录是模块级常量，钉成假路径才能在一个「两档都关」的用例里证明
// 内置技能没被一起关掉（真实目录随安装位置变，断言数量会飘）。
vi.mock("../../src/utils/configPaths.js", async () => {
  const actual = await vi.importActual("../../src/utils/configPaths.js");
  return {
    ...actual,
    getBuiltinSkillsDir: vi.fn().mockReturnValue("/fake/builtin-skills"),
  };
});

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("fs/promises");

// 只替换 service 类，保留它拿到的忽略谓词（真函数，不是桩）。
vi.mock("../../src/services/fileWatcher.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/services/fileWatcher.js")
  >("../../src/services/fileWatcher.js");
  return { ...actual, FileWatcherService: vi.fn() };
});

vi.mock("../../src/utils/skillParser.js", async () => {
  const actual = await vi.importActual("../../src/utils/skillParser.js");
  return { ...actual, parseSkillFile: vi.fn() };
});

vi.mock("../../src/services/artifactAvailability.js", () => ({
  isArtifactEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock("../../src/utils/nestedSkills.js", () => ({
  findNestedSkillRoots: vi.fn(),
}));

import { parseSkillFile } from "../../src/utils/skillParser.js";
import { findNestedSkillRoots } from "../../src/utils/nestedSkills.js";

/**
 * `--skills-sources` 与 `--add-dir` 对技能发现的收窄（spec
 * ecosystem/agent-skills 用户故事「按来源限定本次会话加载哪些技能」）。
 *
 * 与 `skillManager.test.ts` 同一套做法：单元测试不碰真磁盘（`.wave/rules/testing.md`），
 * 把 fs 当成「根路径 → 子技能目录名」的映射，技能名由目录名派生。
 */
describe("SkillManager skill sources", () => {
  const WORKDIR = path.resolve("/fake/workdir");
  const HOME = path.resolve("/fake/home");
  const EXTRA = path.resolve("/fake/eval");
  // 与上面 getBuiltinSkillsDir 的 mock 返回值逐字一致（管理器直接把它交给
  // readdir，中间不再 join）。
  const BUILTIN = "/fake/builtin-skills";

  const USER_WAVE = path.join(HOME, ".wave", "skills");
  const USER_CLAUDE = path.join(HOME, ".claude", "skills");
  const USER_AGENTS = path.join(HOME, ".agents", "skills");

  let container: Container;
  let managers: SkillManager[];
  let mockFileWatcher: {
    watchFile: ReturnType<typeof vi.fn>;
    cleanup: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };

  function normalize(target: string): string {
    return target.replace(/\\/g, "/");
  }

  /** 把 fs 当成一组技能目录：根路径 → 子技能目录名。 */
  function mockDisk(dirs: Record<string, string[]>) {
    const disk = new Map(
      Object.entries(dirs).map(([root, children]) => [
        normalize(root),
        [...children],
      ]),
    );
    vi.mocked(readdir).mockImplementation(async (target) => {
      const children = disk.get(normalize(String(target)));
      if (!children) {
        return [] as unknown as Awaited<ReturnType<typeof readdir>>;
      }
      return children.map((name) => ({
        name,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      })) as unknown as Awaited<ReturnType<typeof readdir>>;
    });
    vi.mocked(stat).mockResolvedValue(
      {} as unknown as Awaited<ReturnType<typeof stat>>,
    );
  }

  async function initialize(
    options: Partial<SkillManagerOptions> = {},
  ): Promise<SkillManager> {
    const manager = new SkillManager(container, {
      workdir: WORKDIR,
      personalSkillsPath: USER_WAVE,
      personalClaudeSkillsPath: USER_CLAUDE,
      personalAgentsSkillsPath: USER_AGENTS,
      ...options,
    });
    managers.push(manager);
    await manager.initialize();
    return manager;
  }

  function names(manager: SkillManager): string[] {
    return manager.getAvailableSkills().map((skill) => skill.name);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    managers = [];

    mockFileWatcher = {
      watchFile: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockReturnThis(),
    };
    vi.mocked(FileWatcherService).mockImplementation(function () {
      return mockFileWatcher;
    } as unknown as typeof FileWatcherService);

    container = new Container();
    vi.mocked(findNestedSkillRoots).mockResolvedValue([]);

    // 技能名由所在目录名派生，与真实解析器一致到「一个目录一个技能」这层。
    vi.mocked(parseSkillFile).mockImplementation((filePath) => {
      const dir = normalize(path.dirname(String(filePath)));
      const name = path.basename(dir);
      return {
        isValid: true,
        skillMetadata: {
          name,
          description: `${name} description`,
          skillPath: dir,
        },
        content: `---\nname: ${name}\n---\ncontent`,
        frontmatter: { name },
        validationErrors: [],
        warnings: [],
      } as unknown as ReturnType<typeof parseSkillFile>;
    });

    mockDisk({
      [BUILTIN]: ["builtin-skill"],
      [USER_WAVE]: ["user-wave"],
      [USER_CLAUDE]: ["user-claude"],
      [USER_AGENTS]: ["user-agents"],
      [path.join(WORKDIR, ".wave", "skills")]: ["project-wave"],
      [path.join(WORKDIR, ".claude", "skills")]: ["project-claude"],
      [path.join(WORKDIR, ".agents", "skills")]: ["project-agents"],
      [path.join(EXTRA, ".wave", "skills")]: ["extra-skill"],
    });
  });

  afterEach(async () => {
    for (const manager of managers) {
      await manager.destroy();
    }
    managers = [];
  });

  it("没有 skillsSources 时用户级与项目级技能全都在（默认行为不变）", async () => {
    const manager = await initialize();

    expect(names(manager)).toEqual(
      expect.arrayContaining([
        "builtin-skill",
        "user-wave",
        "user-claude",
        "user-agents",
        "project-wave",
        "project-claude",
        "project-agents",
      ]),
    );
    expect(
      manager.getAvailableSkills().find((s) => s.name === "user-wave")?.type,
    ).toBe("personal");
    expect(
      manager.getAvailableSkills().find((s) => s.name === "project-wave")?.type,
    ).toBe("project");
    // 没有 additionalDirectories，就不该多扫任何目录
    expect(names(manager)).not.toContain("extra-skill");
  });

  it('skillsSources: ["project"] 时用户级三个目录一个都不加载，项目级仍在', async () => {
    const manager = await initialize({ skillsSources: ["project"] });

    const loaded = names(manager);
    expect(loaded).not.toContain("user-wave");
    expect(loaded).not.toContain("user-claude");
    expect(loaded).not.toContain("user-agents");
    expect(loaded).toEqual(
      expect.arrayContaining([
        "project-wave",
        "project-claude",
        "project-agents",
      ]),
    );
    // 内置技能不受这个开关控制
    expect(loaded).toContain("builtin-skill");
    expect(
      manager.getAvailableSkills().every((s) => s.type !== "personal"),
    ).toBe(true);
  });

  it("skillsSources: [] 时用户级与项目级都不加载，只剩内置技能", async () => {
    const manager = await initialize({ skillsSources: [] });

    // 假的内置目录，所以这里可以钉死「只剩它一个」
    expect(names(manager)).toEqual(["builtin-skill"]);
  });

  it("additionalDirectories 下的技能按项目级加载", async () => {
    const manager = await initialize({ additionalDirectories: [EXTRA] });

    expect(names(manager)).toContain("extra-skill");
    expect(
      manager.getAvailableSkills().find((s) => s.name === "extra-skill")?.type,
    ).toBe("project");
  });

  it('additionalDirectories + skillsSources: ["project"] 仍加载额外目录的技能', async () => {
    const manager = await initialize({
      skillsSources: ["project"],
      additionalDirectories: [EXTRA],
    });

    expect(names(manager)).toContain("extra-skill");
    expect(names(manager)).not.toContain("user-wave");
  });

  it("additionalDirectories + skillsSources: [] 不加载额外目录的技能", async () => {
    const manager = await initialize({
      skillsSources: [],
      additionalDirectories: [EXTRA],
    });

    expect(names(manager)).not.toContain("extra-skill");
    expect(names(manager)).toEqual(["builtin-skill"]);
  });

  it("关掉的来源不被监视，开着的来源与额外目录仍被监视", async () => {
    await initialize({
      watch: true,
      skillsSources: ["project"],
      additionalDirectories: [EXTRA],
    });

    const watchedPaths = mockFileWatcher.watchFile.mock.calls.map((call) =>
      normalize(String(call[0])),
    );

    expect(watchedPaths).not.toContain(normalize(USER_WAVE));
    expect(watchedPaths).not.toContain(normalize(USER_CLAUDE));
    expect(watchedPaths).not.toContain(normalize(USER_AGENTS));
    expect(watchedPaths).toContain(
      normalize(path.join(WORKDIR, ".wave", "skills")),
    );
    expect(watchedPaths).toContain(
      normalize(path.join(WORKDIR, ".claude", "skills")),
    );
    expect(watchedPaths).toContain(
      normalize(path.join(WORKDIR, ".agents", "skills")),
    );
    expect(watchedPaths).toContain(
      normalize(path.join(EXTRA, ".wave", "skills")),
    );
  });

  it("同名技能：项目工作目录的版本优先于 --add-dir 目录", async () => {
    // 与 Claude Code 的 project > additional 去重顺序一致。只在这个用例里
    // 覆写磁盘，免得 "dup" 混进其它用例的名单断言。
    mockDisk({
      [path.join(EXTRA, ".wave", "skills")]: ["dup"],
      [path.join(WORKDIR, ".wave", "skills")]: ["dup"],
    });

    const manager = await initialize({ additionalDirectories: [EXTRA] });
    const dup = manager
      .getAvailableSkills()
      .find((skill) => skill.name === "dup");

    expect(normalize(String(dup?.skillPath))).toBe(
      normalize(path.join(WORKDIR, ".wave", "skills", "dup")),
    );
  });

  it("project 档关掉时子目录技能连探测都不做", async () => {
    const manager = await initialize({ skillsSources: ["user"] });

    const changed = await manager.discoverNestedSkills([
      path.join(WORKDIR, "src", "a.ts"),
    ]);

    expect(changed).toBe(false);
    expect(findNestedSkillRoots).not.toHaveBeenCalled();
  });

  it("project 档开着时子目录技能照旧探测", async () => {
    const manager = await initialize({ skillsSources: ["project"] });

    await manager.discoverNestedSkills([path.join(WORKDIR, "src", "a.ts")]);

    expect(findNestedSkillRoots).toHaveBeenCalled();
  });
});
