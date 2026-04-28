import { describe, it, expect, afterEach } from "vitest";
import {
  parseFrontmatter,
  parseMarkdownFile,
  parseBashCommands,
  replaceBashCommandsWithOutput,
  truncateOutput,
  executeBashCommands,
  type BashCommandResult,
} from "../../src/utils/markdownParser.js";
import {
  writeFileSync,
  unlinkSync,
  readFileSync,
  existsSync,
  rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  SKILL_BASH_MAX_OUTPUT_CHARS,
  PREVIEW_SIZE_BYTES,
} from "../../src/constants/toolLimits.js";

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
    it("should parse inline bash commands", () => {
      const content = "Run this: !`ls -la` and then !`pwd`";
      const result = parseBashCommands(content);
      expect(result.commands).toEqual(["ls -la", "pwd"]);
    });

    it("should parse block bash commands", () => {
      const content = "Run this:\n```!\necho hello\n```\nDone";
      const result = parseBashCommands(content);
      expect(result.commands).toEqual(["echo hello"]);
    });

    it("should parse mixed block and inline commands", () => {
      const content =
        "Inline: !`echo foo`\n\n```!\necho bar\n```\nAnd: !`echo baz`";
      const result = parseBashCommands(content);
      expect(result.commands).toEqual(["echo bar", "echo foo", "echo baz"]);
    });

    it("should skip empty commands", () => {
      const content = "Empty: !`` and ```!\n\n```";
      const result = parseBashCommands(content);
      expect(result.commands).toEqual([]);
    });

    it("should skip whitespace-only commands", () => {
      const content = "Whitespace: !`   ` and ```!\n  \n```";
      const result = parseBashCommands(content);
      expect(result.commands).toEqual([]);
    });

    it("should return original content without modification", () => {
      const content = "Run this: !`ls -la`";
      const result = parseBashCommands(content);
      expect(result.processedContent).toBe(content);
    });

    it("should replace inline bash commands with output", () => {
      const content = "Result: !`ls` and !`pwd`";
      const results: BashCommandResult[] = [
        { command: "ls", output: "file1.txt", exitCode: 0 },
        { command: "pwd", output: "/home", exitCode: 0 },
      ];
      const processed = replaceBashCommandsWithOutput(content, results);
      expect(processed).toBe("Result: file1.txt and /home");
    });

    it("should replace block bash commands with output", () => {
      const content = "Result:\n```!\nls\n```\nDone";
      const results: BashCommandResult[] = [
        { command: "ls", output: "file1.txt", exitCode: 0 },
      ];
      const processed = replaceBashCommandsWithOutput(content, results);
      expect(processed).toBe("Result:\nfile1.txt\nDone");
    });

    it("should replace mixed block and inline commands in order", () => {
      const content = "A: !`cmd1`\n\n```!\ncmd2\n```\nB: !`cmd3`";
      const results: BashCommandResult[] = [
        { command: "cmd2", output: "out2", exitCode: 0 },
        { command: "cmd1", output: "out1", exitCode: 0 },
        { command: "cmd3", output: "out3", exitCode: 0 },
      ];
      const processed = replaceBashCommandsWithOutput(content, results);
      expect(processed).toBe("A: out1\n\nout2\nB: out3");
    });

    it("should leave placeholders if no results available", () => {
      const content = "Result: !`ls`";
      const results: BashCommandResult[] = [];
      const processed = replaceBashCommandsWithOutput(content, results);
      expect(processed).toBe("Result: ");
    });

    it("should safely replace output containing $$ and $& without corruption", () => {
      const content = "Result: !`echo test`";
      const results: BashCommandResult[] = [
        { command: "echo test", output: "price: $$50, match: $&", exitCode: 0 },
      ];
      const processed = replaceBashCommandsWithOutput(content, results);
      expect(processed).toBe("Result: price: $$50, match: $&");
    });

    it("should safely replace output containing $' without corruption", () => {
      const content = "Result: !`echo test`";
      const results: BashCommandResult[] = [
        { command: "echo test", output: "it's $'special'", exitCode: 0 },
      ];
      const processed = replaceBashCommandsWithOutput(content, results);
      expect(processed).toBe("Result: it's $'special'");
    });
  });

  describe("truncateOutput", () => {
    const tempDir = join(tmpdir(), "wave-skill-bash");

    afterEach(() => {
      // Clean up temp files
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should return output unchanged when within limit", () => {
      const output = "short output";
      const result = truncateOutput(output);
      expect(result).toBe("short output");
    });

    it("should truncate and save to file when output exceeds limit", () => {
      const output = "x".repeat(SKILL_BASH_MAX_OUTPUT_CHARS + 100);
      const result = truncateOutput(output);

      expect(result.length).toBeLessThan(output.length);
      expect(result).toContain("[Output truncated");
      expect(result).toContain("Full output saved to:");
      expect(result).toContain(`(${output.length} chars)`);

      // Extract file path and verify content
      const pathMatch = result.match(/saved to: (.+)\]/);
      expect(pathMatch).not.toBeNull();
      const filePath = pathMatch![1];
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, "utf-8")).toBe(output);
    });

    it("should include preview of truncated output", () => {
      const output = "x".repeat(SKILL_BASH_MAX_OUTPUT_CHARS + 100);
      const result = truncateOutput(output);

      expect(result).toContain(
        "x".repeat(Math.min(PREVIEW_SIZE_BYTES, output.length)),
      );
      expect(result).toContain("[Output truncated");
    });
  });

  describe("executeBashCommands", () => {
    it("should execute commands and capture stdout", async () => {
      const results = await executeBashCommands(["echo hello"], process.cwd());
      expect(results).toHaveLength(1);
      expect(results[0].command).toBe("echo hello");
      expect(results[0].output).toBe("hello");
      expect(results[0].exitCode).toBe(0);
    });

    it("should capture stderr and stdout together", async () => {
      const results = await executeBashCommands(
        ["echo stdout; echo stderr >&2"],
        process.cwd(),
      );
      expect(results[0].output).toContain("stdout");
      expect(results[0].output).toContain("stderr");
    });

    it("should capture error output from failed commands", async () => {
      const results = await executeBashCommands(["exit 1"], process.cwd());
      expect(results).toHaveLength(1);
      expect(results[0].exitCode).toBe(1);
    });

    it("should capture error output for nonexistent commands", async () => {
      const results = await executeBashCommands(
        ["nonexistent_command_xyz"],
        process.cwd(),
      );
      expect(results).toHaveLength(1);
      expect(results[0].exitCode).not.toBe(0);
    });

    it("should execute multiple commands in order", async () => {
      const results = await executeBashCommands(
        ["echo one", "echo two"],
        process.cwd(),
      );
      expect(results).toHaveLength(2);
      expect(results[0].output).toBe("one");
      expect(results[1].output).toBe("two");
    });
  });

  describe("performance gate", () => {
    it("should skip parsing when content has no bash patterns", () => {
      const content = "This is just regular markdown content with no commands.";
      const result = parseBashCommands(content);
      expect(result.commands).toEqual([]);
      expect(result.processedContent).toBe(content);
    });

    it("should detect inline pattern and parse", () => {
      const content = "Some text !`echo hi` more text";
      const result = parseBashCommands(content);
      expect(result.commands).toEqual(["echo hi"]);
    });

    it("should detect block pattern and parse", () => {
      const content = "Some text\n```!\necho hi\n```\nmore text";
      const result = parseBashCommands(content);
      expect(result.commands).toEqual(["echo hi"]);
    });
  });
});
