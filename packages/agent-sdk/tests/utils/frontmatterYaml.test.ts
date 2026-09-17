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
