import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeAll } from "vitest";
import { Markdown } from "../../src/components/Markdown.js";
import chalk from "chalk";

describe("Markdown Component - Code Blocks", () => {
  beforeAll(() => {
    process.env.FORCE_COLOR = "1";
    chalk.level = 1;
  });

  it("should render fenced code blocks with language and include backticks in gray", () => {
    const code = "```ts\nconst x = 1;\n```";
    const { lastFrame } = render(<Markdown>{code}</Markdown>);
    const output = lastFrame();

    // Check if backticks and language are present
    expect(output).toContain("```ts");
    expect(output).toContain("```");
    expect(output).toContain("const x = 1;");

    // Check for gray color (chalk.gray)
    // chalk.gray("```ts") should be in the output
    expect(output).toContain(chalk.gray("```ts"));
    expect(output).toContain(chalk.gray("```"));
  });

  it("should render fenced code blocks without language and include backticks in gray", () => {
    const code = "```\nconst x = 1;\n```";
    const { lastFrame } = render(<Markdown>{code}</Markdown>);
    const output = lastFrame();

    expect(output).toContain("```");
    expect(output).toContain("const x = 1;");

    // It should have two "```" in gray
    expect(output).toContain(chalk.gray("```"));
  });

  it("should render indented code blocks without backticks", () => {
    const code = "    const x = 1;";
    const { lastFrame } = render(<Markdown>{code}</Markdown>);
    const output = lastFrame();

    expect(output).toContain("const x = 1;");
    expect(output).not.toContain("```");
    // Indented code blocks should NOT be grayed out by default in the current implementation
    expect(output).not.toContain(chalk.gray("const x = 1;"));
  });

  it("should render multi-line fenced code blocks correctly", () => {
    const code = "```ts\nline 1\nline 2\n```";
    const { lastFrame } = render(<Markdown>{code}</Markdown>);
    const output = lastFrame();

    expect(output).toContain(chalk.gray("```ts"));
    expect(output).toContain("line 1\n line 2"); // Note the space from paddingX={1}
    expect(output).toContain(chalk.gray("```"));
  });

  it("should render fenced code blocks with tildes correctly", () => {
    const code = "~~~\nconst x = 1;\n~~~";
    const { lastFrame } = render(<Markdown>{code}</Markdown>);
    const output = lastFrame();

    expect(output).toContain(chalk.gray("~~~"));
    expect(output).toContain("const x = 1;");
  });
});

describe("Markdown Component - Links", () => {
  it("should render links with both text and URL", () => {
    const markdown = "[GitHub](https://github.com)";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame();

    expect(output).toContain("GitHub");
    expect(output).toContain("(https://github.com)");
  });
});
