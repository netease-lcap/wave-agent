import { describe, it, expect } from "vitest";
import { BUILTIN_CONTENT } from "../../src/builtin/index.js";

// Both skills are ported from Claude Code and are pure prompt content: the only
// way they can break is a missing file, a lost frontmatter, or a link into a
// reference that does not ship. Those are exactly what these assertions cover.
const SKILLS = [
  { dir: "skills/verify", name: "verify" },
  { dir: "skills/run", name: "run" },
  { dir: "skills/run-skill-generator", name: "run-skill-generator" },
];

// Both /run and /run-skill-generator ship this same batch: in Claude Code the
// generator registers `{ "template.md": TEMPLATE_MD, ...RUN_EXAMPLE_FILES }`.
const RUN_EXAMPLES = [
  "cli.md",
  "electron.md",
  "library.md",
  "playwright.md",
  "server.md",
  "tui.md",
];

describe("builtin verify / run-skill-generator", () => {
  it.each(SKILLS)("$dir ships a SKILL.md with frontmatter", ({ dir }) => {
    const content = BUILTIN_CONTENT[dir + "/SKILL.md"];
    expect(content).toBeTruthy();
    expect(content.startsWith("---\n")).toBe(true);
  });

  it.each(SKILLS)("$dir keeps the upstream name as its slash command", ({ dir, name }) => {
    const content = BUILTIN_CONTENT[dir + "/SKILL.md"];
    expect(content).toContain("\nname: " + name + "\n");
    expect(content).toContain("\ndescription: ");
  });

  it.each(SKILLS)("$dir only links references it ships", ({ dir }) => {
    const body = BUILTIN_CONTENT[dir + "/SKILL.md"];
    const refs = Array.from(
      body.matchAll(/\$\{WAVE_SKILL_DIR\}\/([\w./-]+\.md)/g),
    ).map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(
        BUILTIN_CONTENT[dir + "/" + ref],
        dir + " links " + ref + " but does not ship it",
      ).toBeTruthy();
    }
  });

  it.each(SKILLS)("$dir accepts user arguments", ({ dir }) => {
    const body = BUILTIN_CONTENT[dir + "/SKILL.md"];
    expect(body).toContain("## User Request");
    expect(body).toContain("$ARGUMENTS");
  });

  it("verify keeps the runtime-observation rules that make it verify", () => {
    const body = BUILTIN_CONTENT["skills/verify/SKILL.md"];
    // The three sentence-level constraints the port must not soften.
    expect(body).toContain("Verification is runtime observation.");
    expect(body).toContain("Don't run tests.");
    expect(body).toContain("When in doubt, FAIL.");
    // The project-side recipe must not be persisted under the built-in name: in
    // this repo a project skill with a built-in name takes the built-in over.
    expect(body).not.toContain(".wave/skills/verify/SKILL.md");
  });

  it("run and run-skill-generator ship the same examples", () => {
    for (const name of RUN_EXAMPLES) {
      const key = "examples/" + name;
      const fromRun = BUILTIN_CONTENT["skills/run/" + key];
      expect(fromRun, key).toBeTruthy();
      expect(fromRun).toBe(BUILTIN_CONTENT["skills/run-skill-generator/" + key]);
    }
  });

  it("the playwright example keeps CC's chromium-cli commands and names the substitute", () => {
    const body = BUILTIN_CONTENT["skills/run/examples/playwright.md"];
    // The command lines are CC's: they name a REPL that ships inside Claude Code.
    expect(body).toContain("chromium-cli --session app");
    // The note at the top is the only wave-side addition.
    expect(body).toContain("built into Claude Code, not wave");
  });

  it("run-skill-generator keeps its definition of done", () => {
    const body = BUILTIN_CONTENT["skills/run-skill-generator/SKILL.md"];
    expect(body).toContain("## Definition of done");
    expect(body).toContain("## Red flags");
    expect(body).not.toContain("chromium-cli");
  });
});
