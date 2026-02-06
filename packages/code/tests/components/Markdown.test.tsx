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

  it("should render empty fenced code blocks", () => {
    const code = "```ts\n```";
    const { lastFrame } = render(<Markdown>{code}</Markdown>);
    const output = lastFrame();
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

describe("Markdown Component - Headings", () => {
  it("should render all heading depths with correct number of #", () => {
    const markdown = [
      "# Heading 1",
      "## Heading 2",
      "### Heading 3",
      "#### Heading 4",
      "##### Heading 5",
      "###### Heading 6",
    ].join("\n\n");

    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame();

    expect(output).toContain("# Heading 1");
    expect(output).toContain("## Heading 2");
    expect(output).toContain("### Heading 3");
    expect(output).toContain("#### Heading 4");
    expect(output).toContain("##### Heading 5");
    expect(output).toContain("###### Heading 6");

    // Headings should be cyan
    expect(output).toContain(chalk.cyan("# Heading 1"));
    expect(output).toContain(chalk.cyan("###### Heading 6"));
  });
});

describe("Markdown Component - Paragraphs and Inline Styles", () => {
  it("should render paragraphs", () => {
    const markdown = "This is a paragraph.\n\nThis is another paragraph.";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame();

    expect(output).toContain("This is a paragraph.");
    expect(output).toContain("This is another paragraph.");
  });

  it("should render strong text", () => {
    const markdown = "**bold text**";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame();

    expect(output).toContain("bold text");
  });

  it("should render em text", () => {
    const markdown = "*italic text*";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame();

    expect(output).toContain("italic text");
  });

  it("should render codespan text in yellow", () => {
    const markdown = "`const x = 1`";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame();

    expect(output).toContain("const x = 1");
    expect(output).toContain(chalk.yellow("const x = 1"));
  });

  it("should render strikethrough text", () => {
    const markdown = "~~strikethrough text~~";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame();

    expect(output).toContain("strikethrough text");
  });

  it("should render combined inline styles", () => {
    const markdown = "**bold and *italic* and `code`**";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame() || "";

    const cleanOutput = output
      .replace(new RegExp("\\x" + "1B\\[[0-9;]*m", "g"), "")
      .replace(/\s+/g, " ")
      .trim();
    expect(cleanOutput).toContain("bold and italic and code");
    expect(output).toContain(chalk.yellow("code"));
  });
});

describe("Markdown Component - Lists", () => {
  it("should render unordered lists", () => {
    const markdown = "- Item 1\n- Item 2\n  - Nested Item";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame() || "";

    const cleanOutput = output.replace(
      new RegExp("\\x" + "1B\\[[0-9;]*m", "g"),
      "",
    );
    expect(cleanOutput).toContain("• Item 1");
    expect(cleanOutput).toContain("• Item 2");
    expect(cleanOutput).toContain("• Nested Item");
  });

  it("should render ordered lists", () => {
    const markdown = "1. First\n2. Second";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame() || "";

    const cleanOutput = output.replace(
      new RegExp("\\x" + "1B\\[[0-9;]*m", "g"),
      "",
    );
    expect(cleanOutput).toContain("1. First");
    expect(cleanOutput).toContain("2. Second");
  });

  it("should render nested mixed lists", () => {
    const markdown = "1. First\n   - Sub item\n2. Second";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame() || "";

    const cleanOutput = output.replace(
      new RegExp("\\x" + "1B\\[[0-9;]*m", "g"),
      "",
    );
    expect(cleanOutput).toContain("1. First");
    expect(cleanOutput).toContain("• Sub item");
    expect(cleanOutput).toContain("2. Second");
  });
});

describe("Markdown Component - Blockquotes and HR", () => {
  it("should render blockquotes", () => {
    const markdown = "> This is a blockquote";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame() || "";

    const cleanOutput = output
      .replace(new RegExp("\\x" + "1B\\[[0-9;]*m", "g"), "")
      .replace(/\s+/g, " ")
      .trim();
    expect(cleanOutput).toContain("This is a blockquote");
  });

  it("should render horizontal rules", () => {
    const markdown = "---";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame() || "";

    expect(output).toContain("─".repeat(20));
  });
});

describe("Markdown Component - Tables", () => {
  it("should render simple tables", () => {
    const markdown = "| H1 | H2 |\n| --- | --- |\n| C1 | C2 |";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame() || "";

    const cleanOutput = output
      .replace(new RegExp("\\x" + "1B\\[[0-9;]*m", "g"), "")
      .replace(/\s+/g, "");
    expect(cleanOutput).toContain("H1");
    expect(cleanOutput).toContain("H2");
    expect(cleanOutput).toContain("C1");
    expect(cleanOutput).toContain("C2");
  });

  it("should handle table scaling", () => {
    // Create a very wide table
    const markdown = `| ${"A".repeat(50)} | ${"B".repeat(50)} | ${"C".repeat(50)} |`;
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame();

    // It should still render something
    expect(output).toBeTruthy();
  });
});

describe("Markdown Component - HTML Unescaping", () => {
  it("should unescape HTML entities", () => {
    const markdown = "&lt;div&gt; &amp; &quot;quote&quot; &apos;single&apos;";
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame();

    expect(output).toContain("<div> & \"quote\" 'single'");
  });
});

describe("Markdown Component - Complex Nested Structures", () => {
  it("should render complex nested structures", () => {
    const markdown = `
# Main Title
> Blockquote with **bold** and \`code\`
> - List item 1
> - List item 2
    `.trim();
    const { lastFrame } = render(<Markdown>{markdown}</Markdown>);
    const output = lastFrame() || "";

    expect(output).toContain("# Main Title");
    const cleanOutput = output
      .replace(new RegExp("\\x" + "1B\\[[0-9;]*m", "g"), "")
      .replace(/\s+/g, " ")
      .trim();
    expect(cleanOutput).toContain("Blockquote with bold and code");
    expect(cleanOutput).toContain("• List item 1");
    expect(cleanOutput).toContain("• List item 2");
  });
});
