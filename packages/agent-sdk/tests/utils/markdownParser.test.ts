import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  parseMarkdownFile,
  parseBashCommands,
  replaceBashCommandsWithOutput,
  type BashCommandResult,
} from "../../src/utils/markdownParser.js";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("markdownParser", () => {
  describe("parseFrontmatter", () => {
    it("should parse simple frontmatter", () => {
      const content = "---\ntitle: Test\n---\nBody content";
      const result = parseFrontmatter(content);
      expect(result.frontmatter).toEqual({ title: "Test" });
      expect(result.content).toBe("Body content");
    });

    it("should parse frontmatter with lists", () => {
      const content = "---\nallowed-tools:\n  - tool1\n  - tool2\n---\nBody";
      const result = parseFrontmatter(content);
      expect(result.frontmatter).toEqual({
        "allowed-tools": ["tool1", "tool2"],
      });
    });

    it("should handle quoted values in frontmatter", () => {
      const content =
        "---\ntitle: 'Single Quoted'\ndescription: \"Double Quoted\"\n---\nBody";
      const result = parseFrontmatter(content);
      expect(result.frontmatter).toEqual({
        title: "Single Quoted",
        description: "Double Quoted",
      });
    });

    it("should handle list items with quotes", () => {
      const content = "---\nitems:\n  - 'item1'\n  - \"item2\"\n---\nBody";
      const result = parseFrontmatter(content);
      expect(result.frontmatter).toEqual({
        items: ["item1", "item2"],
      });
    });

    it("should return content as-is if no frontmatter", () => {
      const content = "Just content";
      const result = parseFrontmatter(content);
      expect(result.frontmatter).toBeUndefined();
      expect(result.content).toBe(content);
    });

    it("should handle empty lines and comments in frontmatter", () => {
      const content = "---\ntitle: Test\n\n# Comment\nkey: value\n---\nBody";
      const result = parseFrontmatter(content);
      expect(result.frontmatter).toEqual({ title: "Test", key: "value" });
    });

    it("should handle CRLF line endings", () => {
      const content = "---\r\ntitle: Test\r\n---\r\nBody content";
      const result = parseFrontmatter(content);
      expect(result.frontmatter).toEqual({ title: "Test" });
      expect(result.content).toBe("Body content");
    });
  });

  describe("parseMarkdownFile", () => {
    it("should read and parse a markdown file", () => {
      const filePath = join(tmpdir(), `test-${Date.now()}.md`);
      const content =
        "---\ndescription: Test Description\nmodel: gpt-4\nallowed-tools: t1, t2\n---\n# Title\nContent";
      writeFileSync(filePath, content);

      try {
        const result = parseMarkdownFile(filePath);
        expect(result.content).toBe("# Title\nContent");
        expect(result.config).toEqual({
          description: "Test Description",
          model: "gpt-4",
          allowedTools: ["t1", "t2"],
        });
      } finally {
        unlinkSync(filePath);
      }
    });

    it("should handle allowed-tools as a list", () => {
      const filePath = join(tmpdir(), `test-list-${Date.now()}.md`);
      const content = "---\nallowed-tools:\n  - t1\n  - t2\n---\nContent";
      writeFileSync(filePath, content);

      try {
        const result = parseMarkdownFile(filePath);
        expect(result.config?.allowedTools).toEqual(["t1", "t2"]);
      } finally {
        unlinkSync(filePath);
      }
    });

    it("should throw error if file cannot be read", () => {
      expect(() => parseMarkdownFile("/non/existent/file.md")).toThrow(
        "Failed to parse markdown file",
      );
    });
  });

  describe("Bash Commands", () => {
    it("should parse bash commands", () => {
      const content = "Run this: !`ls -la` and then !`pwd`";
      const result = parseBashCommands(content);
      expect(result.commands).toEqual(["ls -la", "pwd"]);
    });

    it("should replace bash commands with output", () => {
      const content = "Result: !`ls` and !`pwd`";
      const results = [
        { command: "ls", output: "file1.txt", exitCode: 0 },
        { command: "pwd", output: "/home", exitCode: 0 },
      ];
      const processed = replaceBashCommandsWithOutput(content, results);
      expect(processed).toContain("```\n$ ls\nfile1.txt\n```");
      expect(processed).toContain("```\n$ pwd\n/home\n```");
    });

    it("should leave placeholder if no result available", () => {
      const content = "Result: !`ls`";
      const results: BashCommandResult[] = [];
      const processed = replaceBashCommandsWithOutput(content, results);
      expect(processed).toBe(content);
    });
  });
});
