import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Skill } from "../../src/types/index.js";
import { SkillManager } from "../../src/managers/skillManager.js";
import { Container } from "../../src/utils/container.js";
import { readdir } from "fs/promises";
import * as path from "path";
import { parseSkillFile } from "../../src/utils/skillParser.js";
import { findNestedSkillRoots } from "../../src/utils/nestedSkills.js";
import { FileWatcherService } from "../../src/services/fileWatcher.js";

vi.mock("../../src/utils/configPaths.js", async () => {
  const actual = await vi.importActual("../../src/utils/configPaths.js");
  return {
    ...actual,
    // Not run through `path.resolve`: the factory cannot see module-level
    // bindings, and this value is only ever compared against itself.
    getBuiltinSkillsDir: vi.fn().mockReturnValue("/builtin-skills"),
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

// The ancestor walk has its own suite; here the point is what the manager does
// with the roots it is handed.
vi.mock("../../src/utils/nestedSkills.js", () => ({
  findNestedSkillRoots: vi.fn(),
}));

vi.mock("../../src/services/fileWatcher.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/services/fileWatcher.js")
  >("../../src/services/fileWatcher.js");
  return { ...actual, FileWatcherService: vi.fn() };
});

vi.mock("../../src/utils/skillParser.js", async () => {
  const actual = await vi.importActual("../../src/utils/skillParser.js");
  return {
    ...actual,
    parseSkillFile: vi.fn(),
    formatSkillError: vi.fn(),
  };
});

const WORKDIR = path.resolve("/repo");
/** Must match the value the `configPaths` double returns. */
const BUILTIN_ROOT = "/builtin-skills";
const OUTER_ROOT = path.join(WORKDIR, "packages", ".wave", "skills");
const INNER_ROOT = path.join(WORKDIR, "packages", "api", ".wave", "skills");

/** Directory listing per skills root; absent roots read as empty. */
const listing = new Map<string, string[]>();

function givenSkills(root: string, ...names: string[]): void {
  listing.set(root, names);
}

function mockFs(): void {
  vi.mocked(readdir).mockImplementation(async (target) => {
    const names = listing.get(String(target)) ?? [];
    return names.map((name) => ({
      name,
      isDirectory: () => true,
    })) as unknown as Awaited<ReturnType<typeof readdir>>;
  });
}

function mockParser(): void {
  vi.mocked(parseSkillFile).mockImplementation((skillFilePath: string) => {
    const skillDir = path.dirname(skillFilePath);
    const name = path.basename(skillDir);
    return {
      isValid: true,
      skillMetadata: {
        name,
        description: `${name} description`,
        type: "project",
        skillPath: skillDir,
      },
      content: `body of ${name}`,
      frontmatter: { name },
      validationErrors: [],
    } as unknown as ReturnType<typeof parseSkillFile>;
  });
}

/** The root the manager is told to walk for `filePaths`. */
function givenNestedRoots(...roots: string[]): void {
  vi.mocked(findNestedSkillRoots).mockResolvedValue(roots);
}

async function createManager(options: { watch?: boolean } = {}) {
  const container = new Container();
  const manager = new SkillManager(container, {
    workdir: WORKDIR,
    watch: options.watch ?? false,
  });
  await manager.initialize();
  return manager;
}

function names(manager: SkillManager): string[] {
  return manager
    .getAvailableSkills()
    .map((skill) => skill.name)
    .sort();
}

describe("SkillManager subtree skills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listing.clear();
    mockFs();
    mockParser();
    vi.mocked(findNestedSkillRoots).mockResolvedValue([]);
  });

  it("loads what a subtree root holds and reports the set as changed", async () => {
    givenSkills(INNER_ROOT, "api-deploy");
    givenNestedRoots(INNER_ROOT);
    const manager = await createManager();
    expect(names(manager)).toEqual([]);

    const changed = await manager.discoverNestedSkills([
      path.join(WORKDIR, "packages", "api", "src", "a.ts"),
    ]);

    expect(changed).toBe(true);
    expect(names(manager)).toEqual(["api-deploy"]);
    // Loadable, not merely listed: the listing is a directory, the body is what
    // the tool call needs.
    expect((await manager.loadSkill("api-deploy"))?.content).toBe(
      "body of api-deploy",
    );
  });

  it("does nothing before initialization", async () => {
    givenSkills(INNER_ROOT, "api-deploy");
    givenNestedRoots(INNER_ROOT);
    const manager = new SkillManager(new Container(), { workdir: WORKDIR });

    const changed = await manager.discoverNestedSkills([
      path.join(WORKDIR, "a.ts"),
    ]);

    expect(changed).toBe(false);
    expect(findNestedSkillRoots).not.toHaveBeenCalled();
  });

  it("does nothing when no file operation was recorded", async () => {
    const manager = await createManager();

    expect(await manager.discoverNestedSkills([])).toBe(false);
    expect(findNestedSkillRoots).not.toHaveBeenCalled();
  });

  it("scans a root once, however many file operations reach it", async () => {
    givenSkills(INNER_ROOT, "api-deploy");
    givenNestedRoots(INNER_ROOT);
    const manager = await createManager();

    await manager.discoverNestedSkills([path.join(WORKDIR, "a.ts")]);
    vi.mocked(readdir).mockClear();
    const changed = await manager.discoverNestedSkills([
      path.join(WORKDIR, "b.ts"),
    ]);

    expect(changed).toBe(false);
    // Re-scanning an already-known root costs a directory walk per Read with
    // nothing to show for it.
    expect(readdir).not.toHaveBeenCalledWith(INNER_ROOT, expect.anything());
  });

  it("emits a refresh only when the visible set actually changed", async () => {
    givenSkills(INNER_ROOT, "api-deploy");
    givenNestedRoots(INNER_ROOT);
    const manager = await createManager();
    const refreshed = vi.fn();
    manager.on("refreshed", refreshed);

    await manager.discoverNestedSkills([path.join(WORKDIR, "a.ts")]);
    const afterFirst = refreshed.mock.calls.length;
    await manager.discoverNestedSkills([path.join(WORKDIR, "b.ts")]);

    // Slash commands re-register on this event; a no-op discovery must not churn
    // them.
    expect(afterFirst).toBe(1);
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it("lets a deeper root override a same-named skill from a shallower one", async () => {
    givenSkills(OUTER_ROOT, "deploy");
    givenSkills(INNER_ROOT, "deploy");
    givenNestedRoots(OUTER_ROOT, INNER_ROOT);
    const manager = await createManager();

    await manager.discoverNestedSkills([path.join(WORKDIR, "a.ts")]);

    // The more specific context wins: the walk hands roots over outermost first
    // for exactly this reason.
    expect(manager.getSkillMetadata("deploy")?.skillPath).toBe(
      path.join(INNER_ROOT, "deploy"),
    );
  });

  it("lets a subtree skill override a same-named project skill", async () => {
    const projectRoot = path.join(WORKDIR, ".wave", "skills");
    givenSkills(projectRoot, "deploy");
    givenSkills(INNER_ROOT, "deploy");
    givenNestedRoots(INNER_ROOT);
    const manager = await createManager();
    expect(manager.getSkillMetadata("deploy")?.skillPath).toBe(
      path.join(projectRoot, "deploy"),
    );

    await manager.discoverNestedSkills([path.join(WORKDIR, "a.ts")]);

    expect(manager.getSkillMetadata("deploy")?.skillPath).toBe(
      path.join(INNER_ROOT, "deploy"),
    );
  });

  it("never lets a subtree skill shadow a builtin one", async () => {
    givenSkills(BUILTIN_ROOT, "plan");
    givenSkills(INNER_ROOT, "plan");
    givenNestedRoots(INNER_ROOT);
    const manager = await createManager();
    const builtinPath = manager.getSkillMetadata("plan")?.skillPath;

    const changed = await manager.discoverNestedSkills([
      path.join(WORKDIR, "a.ts"),
    ]);

    // A directory on disk must not quietly replace a product skill the model was
    // told about by name.
    expect(manager.getSkillMetadata("plan")?.skillPath).toBe(builtinPath);
    expect(manager.getSkillMetadata("plan")?.type).toBe("builtin");
    // Nothing was added, so nothing changed and no refresh is announced.
    expect(changed).toBe(false);
  });

  it("keeps subtree skills when a later full rescan rebuilds the caches", async () => {
    givenSkills(INNER_ROOT, "api-deploy");
    givenNestedRoots(INNER_ROOT);
    const manager = await createManager();
    await manager.discoverNestedSkills([path.join(WORKDIR, "a.ts")]);

    // A watcher-driven rescan rediscovers only the eager roots; subtree roots
    // come from file operations and exist nowhere on disk the scan walks.
    await manager.reloadFeatureGatedSkills();

    expect(names(manager)).toEqual(["api-deploy"]);
    expect((await manager.loadSkill("api-deploy"))?.content).toBe(
      "body of api-deploy",
    );
  });

  it("watches a root it discovered, so a skill added there shows up on its own", async () => {
    const watchFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(FileWatcherService).mockImplementation(function () {
      return {
        watchFile,
        cleanup: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };
    } as unknown as typeof FileWatcherService);
    givenNestedRoots(INNER_ROOT);
    const manager = await createManager({ watch: true });

    await manager.discoverNestedSkills([path.join(WORKDIR, "a.ts")]);

    // An empty root can gain a skill later; without a watcher it would need
    // another file operation in that subtree to be noticed.
    expect(watchFile).toHaveBeenCalledWith(INNER_ROOT, expect.any(Function));
  });

  it("keeps going when one file operation cannot be probed", async () => {
    givenSkills(INNER_ROOT, "api-deploy");
    vi.mocked(findNestedSkillRoots)
      .mockRejectedValueOnce(new Error("EACCES"))
      .mockResolvedValueOnce([INNER_ROOT]);
    const manager = await createManager();

    const changed = await manager.discoverNestedSkills([
      path.join(WORKDIR, "blocked", "a.ts"),
      path.join(WORKDIR, "packages", "api", "b.ts"),
    ]);

    expect(changed).toBe(true);
    expect(names(manager)).toEqual(["api-deploy"]);
  });

  it("returns the loaded skills as full skill objects on the event", async () => {
    givenSkills(INNER_ROOT, "api-deploy");
    givenNestedRoots(INNER_ROOT);
    const manager = await createManager();
    const seen: Skill[][] = [];
    manager.on("refreshed", (skills: Skill[]) => {
      seen.push(skills);
    });

    await manager.discoverNestedSkills([path.join(WORKDIR, "a.ts")]);

    expect(seen).toHaveLength(1);
    expect(seen[0].map((skill) => skill.name)).toContain("api-deploy");
  });
});
