/**
 * Skill hooks wiring, end to end on a real file system.
 *
 * Covers docs/specs/automation/skill-hooks.md's "测试验证需求": a skill's
 * `hooks` are registered when (and only when) the skill is invoked, they stay
 * active for the rest of the session without doubling on a second invocation,
 * they die with the skill, and a skill that blows the per-source budget
 * registers nothing **and** loses its `allowed-tools`.
 *
 * Everything here is real: a real `SKILL.md` under `.wave/skills`, and a real
 * hook script that writes what it received to `evidence.jsonl` next to
 * itself. `executeCommand` is not mocked — `TEST_HOOK_EXECUTION` opts out of
 * its NODE_ENV=test short-circuit, the same escape hatch
 * `hook-real-execution.integration.test.ts` uses.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { SkillManager } from "../../src/managers/skillManager.js";
import { HookManager } from "../../src/managers/hookManager.js";
import { Container } from "../../src/utils/container.js";
import { BASH_TOOL_NAME } from "../../src/constants/tools.js";
import { longFormTempDir } from "../helpers/tempDir.js";

process.env.TEST_HOOK_EXECUTION = "true";

/** What the hook script appends per execution. */
interface EvidenceRecord {
  /** Directory the script itself lives in, i.e. the skill directory. */
  dir: string;
  /** `process.argv[1]`: what the substituted command actually resolved to. */
  script: string;
  cwd: string;
  skillDirEnv: string | null;
  input: {
    hook_event_name?: string;
    tool_name?: string;
    tool_input?: unknown;
    [key: string]: unknown;
  } | null;
}

/**
 * The hook script: drain stdin and append it (plus the paths it was reached
 * by) to `evidence.jsonl` beside itself.
 */
const COLLECT_SCRIPT = `import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const chunks = [];
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = chunks.join("");
const here = dirname(fileURLToPath(import.meta.url));

appendFileSync(
  join(here, "evidence.jsonl"),
  JSON.stringify({
    dir: here,
    script: process.argv[1],
    cwd: process.cwd(),
    skillDirEnv: process.env.WAVE_SKILL_DIR ?? null,
    input: raw.length > 0 ? JSON.parse(raw) : null,
  }) + "\\n",
);
`;

describe("Skill hooks (spec automation/skill-hooks.md)", () => {
  let root: string;
  let workdir: string;
  let skillsRoot: string;
  let skillDir: string;
  let container: Container;
  let hookManager: HookManager;
  let skillManager: SkillManager | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(longFormTempDir(), "wave-skill-hooks-"));
    workdir = path.join(root, "work");
    skillsRoot = path.join(workdir, ".wave", "skills");
    skillDir = path.join(skillsRoot, "demo");
    fs.mkdirSync(skillDir, { recursive: true });
    // Point the three personal roots at empty dirs of our own: the real ones
    // are the user's, and a same-named skill there would shadow the fixture.
    for (const dir of ["personal", "claude", "agents"]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }

    container = new Container();
    hookManager = new HookManager(container, workdir);
    container.register("HookManager", hookManager);
  });

  afterEach(async () => {
    if (skillManager) {
      await skillManager.destroy();
      skillManager = undefined;
    }
    removeDirWithRetry(root);
  });

  /** Boot a SkillManager over the fixture workdir (the skill must exist first). */
  async function initialize(): Promise<SkillManager> {
    skillManager = new SkillManager(container, {
      workdir,
      personalSkillsPath: path.join(root, "personal"),
      personalClaudeSkillsPath: path.join(root, "claude"),
      personalAgentsSkillsPath: path.join(root, "agents"),
    });
    await skillManager.initialize();
    return skillManager;
  }

  function writeSkill(dir: string, frontmatter: string[]): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\n${frontmatter.join("\n")}\n---\n\nDemo body.\n`,
    );
  }

  /** The `demo` skill plus the collect script that its hook points at. */
  function writeDemoSkill(): void {
    writeSkill(skillDir, [
      "name: demo",
      "description: Collects evidence through its own PostToolUse hook",
      "hooks:",
      "  PostToolUse:",
      "    - matcher: Bash",
      "      hooks:",
      "        - type: command",
      "          command: node ${WAVE_SKILL_DIR}/collect.mjs",
    ]);
    fs.writeFileSync(path.join(skillDir, "collect.mjs"), COLLECT_SCRIPT);
  }

  function readEvidence(dir: string): EvidenceRecord[] {
    const file = path.join(dir, "evidence.jsonl");
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as EvidenceRecord);
  }

  /** One matching tool call, as the agent loop would fire it. */
  async function firePostToolUse(): Promise<void> {
    await hookManager.executeHooks("PostToolUse", {
      event: "PostToolUse",
      projectDir: workdir,
      sessionRoot: workdir,
      sessionId: "session-1",
      timestamp: new Date(),
      toolName: BASH_TOOL_NAME,
      toolInput: { command: "echo evidence" },
      toolResponse: { stdout: "evidence" },
      toolUseId: "toolu_1",
      durationMs: 5,
    });
  }

  it("registers the skill's hooks on invocation, and the real script receives the PostToolUse payload (场景 1)", async () => {
    writeDemoSkill();
    const manager = await initialize();

    // Nothing is registered before the skill is invoked (场景 2 comes next).
    expect(hookManager.getSkillHooks()).toEqual({});

    const result = await manager.executeSkill({ skill_name: "demo" });
    expect(result.content).toContain("Demo body.");
    expect(hookManager.getSkillHooks().PostToolUse).toHaveLength(1);
    expect(hookManager.getRegisteredSkillRoots()).toEqual([skillDir]);

    await firePostToolUse();

    const evidence = readEvidence(skillDir);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.input?.hook_event_name).toBe("PostToolUse");
    expect(evidence[0]!.input?.tool_name).toBe(BASH_TOOL_NAME);
    expect(evidence[0]!.input?.tool_input).toEqual({
      command: "echo evidence",
    });
  });

  it("runs nothing while the skill has never been invoked (场景 2)", async () => {
    writeDemoSkill();
    const manager = await initialize();

    // Reading the body is not invoking it: `prepareSkill` renders text only.
    const prepared = await manager.prepareSkill({ skill_name: "demo" });
    expect(prepared.content).toContain("Demo body.");

    await firePostToolUse();

    expect(hookManager.getSkillHooks()).toEqual({});
    expect(fs.existsSync(path.join(skillDir, "evidence.jsonl"))).toBe(false);
  });

  it("stays active for later turns and registers once when the skill is invoked twice (故事②场景 1-2)", async () => {
    writeDemoSkill();
    const manager = await initialize();

    await manager.executeSkill({ skill_name: "demo" });
    await manager.executeSkill({ skill_name: "demo" });

    // One registration for the root, one command in it — not two of either.
    const configs = hookManager.getSkillHooks().PostToolUse;
    expect(configs).toHaveLength(1);
    expect(configs?.[0]?.hooks).toHaveLength(1);

    await firePostToolUse();
    // Exactly one execution per matching call: the double invocation did not
    // double the hook.
    expect(readEvidence(skillDir)).toHaveLength(1);

    // A later round of the same session is still covered (session-scoped, not
    // turn-scoped).
    await firePostToolUse();
    expect(readEvidence(skillDir)).toHaveLength(2);
  });

  it("registers nothing, drops allowed-tools and tells the model when the hooks exceed the per-source budget (故事④)", async () => {
    const bulkyDir = path.join(skillsRoot, "bulky");
    const frontmatter = [
      "name: bulky",
      "description: Declares more hooks than one skill may register",
      "allowed-tools:",
      '  - "Bash(echo *)"',
      "hooks:",
      "  PostToolUse:",
      "    - matcher: Bash",
      "      hooks:",
    ];
    for (let index = 0; index < 1025; index++) {
      frontmatter.push(
        "        - type: command",
        `          command: "exit 0 # ${index}"`,
      );
    }
    writeSkill(bulkyDir, frontmatter);
    const manager = await initialize();

    const result = await manager.executeSkill({ skill_name: "bulky" });

    expect(hookManager.getSkillHooks()).toEqual({});
    expect(hookManager.getRegisteredSkillRoots()).toEqual([]);
    // `undefined` is what makes `skillTool` skip re-applying the list.
    expect(result.allowedTools).toBeUndefined();
    expect(result.content).toContain("hooks were not registered");
    // The volume the model is told about is the declared one.
    expect(result.content).toContain(
      "The skill declares 1025 hooks (4 matcher characters)",
    );
  });

  it("unregisters the skill's hooks when the skill is deleted (场景·删除)", async () => {
    writeDemoSkill();
    const manager = await initialize();
    await manager.executeSkill({ skill_name: "demo" });
    expect(hookManager.getRegisteredSkillRoots()).toEqual([skillDir]);

    expect(await manager.deleteSkill("demo")).toBe(true);

    expect(hookManager.getRegisteredSkillRoots()).toEqual([]);
    expect(hookManager.getSkillHooks()).toEqual({});

    await firePostToolUse();
    expect(readEvidence(skillDir)).toHaveLength(0);
  });

  it("resolves ${WAVE_SKILL_DIR} to the skill's absolute directory before the script runs (场景 3)", async () => {
    writeDemoSkill();
    const manager = await initialize();
    await manager.executeSkill({ skill_name: "demo" });
    await firePostToolUse();

    const evidence = readEvidence(skillDir);
    expect(evidence).toHaveLength(1);
    // The command was rewritten at parse time: node received an absolute path
    // to this skill's own script, not a literal ${WAVE_SKILL_DIR} token.
    expect(path.isAbsolute(evidence[0]!.script)).toBe(true);
    expect(evidence[0]!.script).toBe(path.join(skillDir, "collect.mjs"));
    expect(evidence[0]!.dir).toBe(skillDir);
    // The registration stamps the same directory as the hook's env.
    expect(evidence[0]!.skillDirEnv).toBe(skillDir);
  });

  it("rebuilds a live registration on hot reload and drops it when the reshape removes the hooks (边界·技能热更新)", async () => {
    writeDemoSkill();
    const manager = await initialize();
    await manager.executeSkill({ skill_name: "demo" });

    // Reshape on disk into a different command; the rescan must replace the
    // registration rather than keep the old one and add a second.
    writeSkill(skillDir, [
      "name: demo",
      "description: Collects evidence through its own PostToolUse hook",
      "hooks:",
      "  PostToolUse:",
      "    - matcher: Bash",
      "      hooks:",
      "        - type: command",
      "          command: node ${WAVE_SKILL_DIR}/collect.mjs --reshaped",
    ]);
    await manager.initialize();

    const reshaped = hookManager.getSkillHooks().PostToolUse;
    expect(reshaped).toHaveLength(1);
    expect(reshaped?.[0]?.hooks).toHaveLength(1);
    expect(reshaped?.[0]?.hooks?.[0]?.command).toContain("--reshaped");

    // And a skill reshaped into one without hooks leaves nothing behind.
    writeSkill(skillDir, [
      "name: demo",
      "description: Collects evidence through its own PostToolUse hook",
    ]);
    await manager.initialize();

    expect(hookManager.getRegisteredSkillRoots()).toEqual([]);
    expect(hookManager.getSkillHooks()).toEqual({});
  });
});

/**
 * Windows keeps the directory handle for a moment after the hook process
 * exits, so a plain recursive rm can race it (EBUSY/EPERM); `maxRetries`
 * makes `rmSync` wait it out instead of failing the suite in teardown.
 */
function removeDirWithRetry(dir: string): void {
  fs.rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 50,
    retryDelay: 100,
  });
}
