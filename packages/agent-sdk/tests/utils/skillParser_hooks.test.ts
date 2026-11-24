/**
 * `SKILL.md` frontmatter `hooks` — the parsing layer only (spec
 * automation/skill-hooks 用户故事 1 + 场景 4): what reaches
 * `SkillMetadata.hooks`, what is dropped with a warning, and the promise that a
 * structurally broken `hooks` value never costs the author their skill — while a
 * syntactically broken block costs them every field but not the skill itself
 * (Claude Code's behaviour: name from the directory, description from the
 * body's first line, `hooks` / `allowed-tools` silently unapplied).
 *
 * Real files on disk on purpose: the job here is turning the author's YAML into
 * a table, so a mocked `readFileSync` would let a reader/validator mismatch pass
 * — the nested block, its block lists and its `timeout` / `async` scalars only
 * show up end to end.
 *
 * Registration, budget, lifetime and `once` live in the registration layer and
 * are asserted there, not here.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseSkillFile } from "../../src/utils/skillParser.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "wave-skill-hooks-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Write a SKILL.md whose frontmatter is `frontmatter`, return its path. */
function writeSkill(frontmatter: string): string {
  const dir = path.join(root, "demo");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "SKILL.md");
  fs.writeFileSync(
    filePath,
    `---\n${frontmatter}\n---\n\n# Demo\n\nBody of the skill.\n`,
    "utf-8",
  );
  return filePath;
}

const skillDir = (): string => path.join(root, "demo");

describe("skillParser hooks", () => {
  it("parses a PostToolUse hook with matcher, command and scalar fields", () => {
    const filePath = writeSkill(
      [
        "name: demo",
        "description: d",
        "hooks:",
        "  PostToolUse:",
        "    - matcher: Bash",
        "      hooks:",
        "        - type: command",
        "          command: node ${WAVE_SKILL_DIR}/log.mjs",
        "          timeout: 30",
        "          async: false",
      ].join("\n"),
    );

    const result = parseSkillFile(filePath);

    expect(result.isValid).toBe(true);
    expect(result.warnings).toEqual([]);
    const config = result.skillMetadata.hooks?.PostToolUse?.[0];
    expect(config?.matcher).toBe("Bash");
    expect(config?.hooks).toEqual([
      {
        type: "command",
        command: `node ${skillDir()}/log.mjs`,
        timeout: 30,
        async: false,
      },
    ]);
  });

  it("resolves ${WAVE_SKILL_DIR} to the skill directory, like allowed-tools", () => {
    const filePath = writeSkill(
      [
        "name: demo",
        "description: d",
        "hooks:",
        "  Stop:",
        "    - hooks:",
        "        - type: command",
        "          command: node ${WAVE_SKILL_DIR}/scripts/lint.mjs",
      ].join("\n"),
    );

    const result = parseSkillFile(filePath);

    // An absolute path, not a literal placeholder.
    expect(result.skillMetadata.hooks?.Stop?.[0]?.hooks[0]?.command).toBe(
      `node ${skillDir()}/scripts/lint.mjs`,
    );
  });

  it("warns and registers nothing when hooks is a string", () => {
    const result = parseSkillFile(
      writeSkill(
        ["name: demo", "description: d", "hooks: PostToolUse"].join("\n"),
      ),
    );

    expect(result.isValid).toBe(true);
    expect(result.skillMetadata.hooks).toBeUndefined();
    expect(result.warnings).toEqual([
      expect.stringContaining("hooks must be a table of hook events"),
    ]);
  });

  it("warns and registers nothing when hooks is a list", () => {
    const result = parseSkillFile(
      writeSkill(
        [
          "name: demo",
          "description: d",
          "hooks:",
          "  - PostToolUse",
          "  - Stop",
        ].join("\n"),
      ),
    );

    // The skill survives; only its hooks are gone (spec 场景 4).
    expect(result.isValid).toBe(true);
    expect(result.skillMetadata.hooks).toBeUndefined();
    expect(result.warnings).toEqual([
      expect.stringContaining("hooks must be a table of hook events"),
    ]);
  });

  it("drops an unknown event name with a warning", () => {
    const result = parseSkillFile(
      writeSkill(
        [
          "name: demo",
          "description: d",
          "hooks:",
          "  PreToolXX:",
          "    - matcher: Bash",
          "      hooks:",
          "        - type: command",
          "          command: node ${WAVE_SKILL_DIR}/log.mjs",
        ].join("\n"),
      ),
    );

    expect(result.isValid).toBe(true);
    expect(result.skillMetadata.hooks).toBeUndefined();
    expect(result.warnings).toEqual([
      expect.stringContaining('hooks event "PreToolXX"'),
    ]);
  });

  it("drops a command that has no `command` field", () => {
    const result = parseSkillFile(
      writeSkill(
        [
          "name: demo",
          "description: d",
          "hooks:",
          "  PostToolUse:",
          "    - matcher: Bash",
          "      hooks:",
          "        - type: command",
        ].join("\n"),
      ),
    );

    expect(result.isValid).toBe(true);
    expect(result.skillMetadata.hooks).toBeUndefined();
    expect(result.warnings).toEqual([
      expect.stringContaining("hooks.PostToolUse[0].hooks[0].command"),
    ]);
  });

  it("drops a command holding ${WAVE_PLUGIN_ROOT} outside a plugin and keeps the rest", () => {
    const result = parseSkillFile(
      writeSkill(
        [
          "name: demo",
          "description: d",
          "hooks:",
          "  PostToolUse:",
          "    - hooks:",
          "        - type: command",
          "          command: node ${WAVE_PLUGIN_ROOT}/bin/collect.mjs",
          "        - type: command",
          "          command: node ${WAVE_SKILL_DIR}/log.mjs",
        ].join("\n"),
      ),
    );

    expect(result.isValid).toBe(true);
    expect(
      result.skillMetadata.hooks?.PostToolUse?.[0]?.hooks.map((c) => c.command),
    ).toEqual([`node ${skillDir()}/log.mjs`]);
    expect(result.warnings).toEqual([
      expect.stringContaining(
        'hooks.PostToolUse[0].hooks[0] command "node ${WAVE_PLUGIN_ROOT}/bin/collect.mjs" keeps ${WAVE_PLUGIN_ROOT}',
      ),
    ]);
  });

  it("keeps duplicated commands as written — de-duplication is the registration layer's job", () => {
    const result = parseSkillFile(
      writeSkill(
        [
          "name: demo",
          "description: d",
          "hooks:",
          "  PostToolUse:",
          "    - matcher: Bash",
          "      hooks:",
          "        - type: command",
          "          command: node ${WAVE_SKILL_DIR}/log.mjs",
          "        - type: command",
          "          command: node ${WAVE_SKILL_DIR}/log.mjs",
        ].join("\n"),
      ),
    );

    const commands =
      result.skillMetadata.hooks?.PostToolUse?.[0]?.hooks.map(
        (c) => c.command,
      ) ?? [];
    expect(commands).toHaveLength(2);
    expect(commands).toEqual([
      `node ${skillDir()}/log.mjs`,
      `node ${skillDir()}/log.mjs`,
    ]);
  });

  it("reads an event whose list sits in the same column as the key", () => {
    const result = parseSkillFile(
      writeSkill(
        [
          "name: demo",
          "description: d",
          "hooks:",
          "  PostToolUse:",
          "  - matcher: Bash",
          "    hooks:",
          "      - type: command",
          "        command: node ${WAVE_SKILL_DIR}/log.mjs",
        ].join("\n"),
      ),
    );

    expect(
      result.skillMetadata.hooks?.PostToolUse?.[0]?.hooks[0]?.command,
    ).toBe(`node ${skillDir()}/log.mjs`);
    expect(result.warnings).toEqual([]);
  });

  it("leaves hooks unset for a skill that declares none", () => {
    const result = parseSkillFile(
      writeSkill(["name: demo", "description: d"].join("\n")),
    );

    expect(result.isValid).toBe(true);
    expect(result.skillMetadata.hooks).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });
  it("turns the stringified scalars back into the types HookCommand declares", () => {
    const result = parseSkillFile(
      writeSkill(
        [
          "name: demo",
          "description: d",
          "hooks:",
          "  PostToolUse:",
          "    - hooks:",
          "        - type: command",
          "          command: node ${WAVE_SKILL_DIR}/log.mjs",
          "          timeout: 30",
          "          async: true",
          "          asyncRewake: false",
          "          once: true",
        ].join("\n"),
      ),
    );

    // Everywhere else a frontmatter scalar is a string, so the parser has to
    // put `timeout` and the flags back into the types `HookCommand` declares —
    // otherwise `isValidHookEventConfig` would reject the hook and the author
    // would see it silently never run.
    expect(result.skillMetadata.hooks?.PostToolUse?.[0]?.hooks[0]).toEqual({
      type: "command",
      command: "node " + skillDir() + "/log.mjs",
      timeout: 30,
      async: true,
      asyncRewake: false,
      once: true,
    });
    expect(result.warnings).toEqual([]);
  });

  it("drops a command whose timeout does not convert, and keeps its siblings", () => {
    const result = parseSkillFile(
      writeSkill(
        [
          "name: demo",
          "description: d",
          "hooks:",
          "  Stop:",
          "    - hooks:",
          "        - type: command",
          "          command: echo bad",
          "          timeout: abc",
          "        - type: command",
          "          command: echo ok",
        ].join("\n"),
      ),
    );

    expect(result.isValid).toBe(true);
    expect(
      result.skillMetadata.hooks?.Stop?.[0]?.hooks.map((c) => c.command),
    ).toEqual(["echo ok"]);
    expect(result.warnings).toEqual([
      expect.stringContaining("hooks.Stop[0].hooks[0].timeout"),
    ]);
  });

  it("keeps only the whitelisted fields", () => {
    const result = parseSkillFile(
      writeSkill(
        [
          "name: demo",
          "description: d",
          "hooks:",
          "  Stop:",
          "    - matcher: Bash",
          "      note: not a hook field",
          "      hooks:",
          "        - type: command",
          "          command: echo hi",
          "          skillRoot: /elsewhere",
          "          pluginRoot: /elsewhere",
        ].join("\n"),
      ),
    );

    // `skillRoot` / `pluginRoot` are stamped by the registration layer and
    // decide what `${WAVE_SKILL_DIR}` resolves to at run time, so an author must
    // not be able to set them.
    expect(result.skillMetadata.hooks).toEqual({
      Stop: [
        { matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] },
      ],
    });
  });

  it("drops a configuration whose matcher is not a string", () => {
    const result = parseSkillFile(
      writeSkill(
        [
          "name: demo",
          "description: d",
          "hooks:",
          "  PostToolUse:",
          "    - matcher:",
          "        - Bash",
          "      hooks:",
          "        - type: command",
          "          command: echo hi",
        ].join("\n"),
      ),
    );

    expect(result.isValid).toBe(true);
    expect(result.skillMetadata.hooks).toBeUndefined();
    expect(result.warnings).toEqual([
      expect.stringContaining("hooks.PostToolUse[0].matcher must be a string"),
    ]);
  });

  it("resolves ${WAVE_PLUGIN_ROOT} for a skill that comes from a plugin", () => {
    const result = parseSkillFile(
      writeSkill(
        [
          "name: demo",
          "description: d",
          "hooks:",
          "  Stop:",
          "    - hooks:",
          "        - type: command",
          "          command: node ${WAVE_PLUGIN_ROOT}/bin/collect.mjs",
        ].join("\n"),
      ),
      { pluginRoot: "/plug/root" },
    );

    expect(result.skillMetadata.hooks?.Stop?.[0]?.hooks[0]?.command).toBe(
      "node /plug/root/bin/collect.mjs",
    );
    expect(result.warnings).toEqual([]);
  });

  it("keeps a skill whose frontmatter block is not valid YAML, with every field dropped", () => {
    // An unclosed flow list makes the parser throw, and a real parser is
    // all-or-nothing: the whole block comes back empty. What happens next is
    // Claude Code's behaviour (spec ecosystem/agent-skills) — the skill keeps
    // loading with the name taken from its directory and the description from
    // the body's first line, while `hooks`, `allowed-tools` and the model gates
    // simply stop applying. Dropping the skill instead would hide the mistyped
    // file from the very author who has to fix it.
    const dir = path.join(root, "broken-yaml");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "SKILL.md");
    fs.writeFileSync(
      filePath,
      [
        "---",
        "name: demo",
        "description: d",
        "hooks:",
        "  PostToolUse:",
        "    - hooks: [ {type: command, command: echo hi }",
        "---",
        "",
        "# Broken skill",
        "",
        "Body of the skill.",
        "",
      ].join("\n"),
    );

    const result = parseSkillFile(filePath);

    expect(result.isValid).toBe(true);
    expect(result.validationErrors).toEqual([]);
    expect(result.skillMetadata.name).toBe("broken-yaml");
    expect(result.skillMetadata.description).toBe("# Broken skill");
    expect(result.skillMetadata.hooks).toBeUndefined();
    expect(
      result.warnings.some((w) => w.includes("frontmatter failed to parse")),
    ).toBe(true);
  });

  it("rejects a skill whose broken frontmatter leaves no body line to describe it", () => {
    // Nothing left to fall back to: the block is gone and the body has no first
    // line, so there is no description and no name that means anything.
    const dir = path.join(root, "empty-body");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "SKILL.md");
    fs.writeFileSync(
      filePath,
      ["---", "name: demo", "hooks: [ unclosed", "---", ""].join("\n"),
    );

    const result = parseSkillFile(filePath);

    expect(result.isValid).toBe(false);
    expect(result.validationErrors).toEqual([
      expect.stringContaining("frontmatter failed to parse"),
    ]);
  });
});
