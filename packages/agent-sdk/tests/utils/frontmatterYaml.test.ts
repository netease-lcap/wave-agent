import { describe, it, expect } from "vitest";
import {
  parseFrontmatterYaml,
  splitFrontmatter,
} from "../../src/utils/frontmatterYaml.js";

/**
 * Skills, subagents, custom slash commands, memory rules and memory files all
 * read frontmatter through this parser — the behaviour below is what each of
 * them relies on (spec ecosystem/agent-skills 场景 2/3, multi-agent/subagent
 * 场景 6, ui/slash-commands 场景 3, core/memory-management 场景 4/13).
 */
describe("splitFrontmatter", () => {
  it("returns the yaml block and the body", () => {
    const { yaml, body } = splitFrontmatter("---\ntitle: Test\n---\nBody");

    expect(yaml).toBe("title: Test");
    expect(body).toBe("Body");
  });

  it("reports no yaml when the file starts with content", () => {
    const { yaml, body } = splitFrontmatter("Just content");

    expect(yaml).toBeNull();
    expect(body).toBe("Just content");
  });

  it("handles CRLF endings and a closed block with no body", () => {
    expect(splitFrontmatter("---\r\ntitle: Test\r\n---\r\nBody")).toEqual({
      yaml: "title: Test",
      body: "Body",
    });
    expect(splitFrontmatter("---\ntitle: Test\n---")).toEqual({
      yaml: "title: Test",
      body: "",
    });
  });
});

describe("parseFrontmatterYaml", () => {
  it("parses inline values, stripping quotes", () => {
    expect(
      parseFrontmatterYaml("name: 'single'\ndescription: \"double\""),
    ).toEqual({ name: "single", description: "double" });
  });

  it("parses a block list", () => {
    expect(parseFrontmatterYaml("tools:\n  - Read\n  - Bash")).toEqual({
      tools: ["Read", "Bash"],
    });
  });

  it("folds `>-` into one paragraph and keeps a blank line as a break", () => {
    const yaml = [
      "description: >-",
      "  第一行",
      "  第二行",
      "",
      "  第三行",
      "model: fast",
    ].join("\n");

    expect(parseFrontmatterYaml(yaml)).toEqual({
      description: "第一行 第二行\n第三行",
      model: "fast",
    });
  });

  it("keeps line breaks for a `|` block scalar", () => {
    const yaml = ["description: |-", "  第一行", "  第二行"].join("\n");

    expect(parseFrontmatterYaml(yaml)).toEqual({
      description: "第一行\n第二行",
    });
  });

  it("never turns a block scalar continuation into a key", () => {
    const yaml = [
      "description: >-",
      "  See https://example.com:8080/docs for details",
      "  and the notes below",
      "allowed-tools: Read",
    ].join("\n");

    expect(parseFrontmatterYaml(yaml)).toEqual({
      description:
        "See https://example.com:8080/docs for details and the notes below",
      "allowed-tools": "Read",
    });
  });

  it("folds a plain multi-line scalar written without an indicator", () => {
    const yaml = ["description:", "  第一行", "  第二行"].join("\n");

    expect(parseFrontmatterYaml(yaml)).toEqual({
      description: "第一行 第二行",
    });
  });

  it("ignores blank lines and comments", () => {
    expect(
      parseFrontmatterYaml("title: Test\n\n# Comment\nkey: value"),
    ).toEqual({ title: "Test", key: "value" });
  });
});

/**
 * The parser is the `yaml` package now (a skill's `hooks` nests, which the old
 * hand-rolled subset could not express), but the contract the five artifacts
 * read is unchanged: scalars come back as strings. A block that is not valid
 * YAML comes back empty, exactly as in Claude Code, which skips a skill whose
 * frontmatter fails to parse rather than loading it with whatever it could read.
 */
describe("parseFrontmatterYaml on the yaml package", () => {
  it("keeps a mapping → list → mapping tree (a skill's hooks)", () => {
    const yaml = [
      "name: demo",
      "hooks:",
      "  PostToolUse:",
      "    - matcher: Bash",
      "      hooks:",
      "        - type: command",
      "          command: node src/collect.mjs",
      "          timeout: 30",
      "          once: true",
    ].join("\n");

    expect(parseFrontmatterYaml(yaml)).toEqual({
      name: "demo",
      hooks: {
        PostToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: "node src/collect.mjs",
                // Strings even here: the hook parser converts them back, and
                // every other artifact compares against "true" / parseInts them.
                timeout: "30",
                once: "true",
              },
            ],
          },
        ],
      },
    });
  });

  it("reads flow style, which the previous subset reader could not", () => {
    expect(
      parseFrontmatterYaml(
        "tools: [Read, Bash]\nhooks: {Stop: [{hooks: [{type: command, command: lint}]}]}",
      ),
    ).toEqual({
      tools: ["Read", "Bash"],
      hooks: { Stop: [{ hooks: [{ type: "command", command: "lint" }] }] },
    });
  });

  it("turns every scalar into a string and an empty value into an empty string", () => {
    const yaml = [
      "disable-model-invocation: true",
      "user-invocable: false",
      "timeout: 30",
      "ratio: 1.5",
      'quoted-number: "30"',
      "empty:",
      "explicit-null: null",
      "updated: 2024-01-02",
    ].join("\n");

    expect(parseFrontmatterYaml(yaml)).toEqual({
      "disable-model-invocation": "true",
      "user-invocable": "false",
      timeout: "30",
      ratio: "1.5",
      "quoted-number": "30",
      empty: "",
      "explicit-null": "",
      // No timestamp resolution: the core schema leaves the date as written.
      updated: "2024-01-02",
    });
  });

  it("leaves chomping to the parser: a literal block keeps its breaks and its clip", () => {
    expect(parseFrontmatterYaml("description: |\n  第一行\n  第二行")).toEqual({
      description: "第一行\n第二行\n",
    });
  });

  it("returns {} for a block that is not valid YAML", () => {
    // An unquoted ": " inside a plain scalar, an unterminated flow sequence, a
    // duplicate key — the parser rejects each of them, and the whole block goes
    // with it. Reading such a block partially would load the artifact with some
    // fields and not others; Claude Code drops the artifact instead, and so do we.
    expect(parseFrontmatterYaml("description: Use this when: foo")).toEqual({});
    expect(parseFrontmatterYaml("name: demo\na: [1")).toEqual({});
    expect(() => parseFrontmatterYaml("name: a\nname: b")).not.toThrow();
    expect(parseFrontmatterYaml("name: a\nname: b")).toEqual({});
  });

  it("returns {} for an empty block", () => {
    expect(parseFrontmatterYaml("")).toEqual({});
  });
});
