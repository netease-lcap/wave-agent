import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { Renderer, marked, type Tokens } from "marked";
import chalk from "chalk";
import { highlightToAnsi } from "../utils/highlightUtils.js";
import { renderMarkdownTable } from "../utils/markdownTable.js";

export interface MarkdownProps {
  children: string;
}

const unescapeHtml = (html: string) => {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
};

class AnsiRenderer extends Renderer<string> {
  constructor(private readonly columns: number) {
    super();
  }

  override code({ text, lang }: Tokens.Code): string {
    const prefix = lang ? `\`\`\`${lang}` : "```";
    const suffix = "```";
    const highlighted = highlightToAnsi(text, lang);
    return `\n${chalk.gray(prefix)}\n${highlighted}\n${chalk.gray(suffix)}\n`;
  }

  override blockquote({ tokens }: Tokens.Blockquote): string {
    const body = this.parser.parse(tokens);
    return (
      "\n" +
      body
        .trim()
        .split("\n")
        .map((line) => chalk.gray("> ") + line)
        .join("\n") +
      "\n"
    );
  }

  override heading({ tokens, depth }: Tokens.Heading): string {
    const text = this.parser.parseInline(tokens);
    const hashes = "#".repeat(depth);
    return `\n${chalk.cyan(`${hashes} ${text}`)}\n`;
  }

  override hr(): string {
    return `\n${chalk.gray("─".repeat(20))}\n`;
  }

  override list(token: Tokens.List): string {
    const body = token.items
      .map((item, i) => {
        const text = this.listitem(item);
        const prefix = token.ordered
          ? chalk.gray(`${(token.start || 1) + i}. `)
          : chalk.gray("• ");
        const lines = text.split("\n");
        const firstLine = prefix + lines[0];
        const restLines = lines
          .slice(1)
          .filter((line) => line.length > 0)
          .map((line) => "  " + line);
        return [firstLine, ...restLines].join("\n") + "\n";
      })
      .join("");
    return `\n${body}`;
  }

  override listitem(item: Tokens.ListItem): string {
    return `${this.parser.parse(item.tokens).trim()}\n`;
  }

  override checkbox({ checked }: Tokens.Checkbox): string {
    return checked ? chalk.green("[x] ") : chalk.gray("[ ] ");
  }

  override paragraph({ tokens }: Tokens.Paragraph): string {
    const text = this.parser.parseInline(tokens);
    return `\n${text}\n`;
  }

  override table(token: Tokens.Table): string {
    const table = renderMarkdownTable(token, this.columns, (tokens) =>
      this.parser.parseInline(tokens),
    );
    return `\n${table}\n`;
  }

  override strong({ tokens }: Tokens.Strong): string {
    const text = this.parser.parseInline(tokens);
    return chalk.bold(text);
  }

  override em({ tokens }: Tokens.Em): string {
    const text = this.parser.parseInline(tokens);
    return chalk.italic(text);
  }

  override codespan({ text }: Tokens.Codespan): string {
    return chalk.yellow(text);
  }

  override br(): string {
    return "\n";
  }

  override del({ tokens }: Tokens.Del): string {
    const text = this.parser.parseInline(tokens);
    return chalk.strikethrough(text);
  }

  override link({ href, tokens }: Tokens.Link): string {
    const text = this.parser.parseInline(tokens);
    const linkText = chalk.blue.underline(text);
    const hrefText = chalk.gray(`(${href})`);
    return `${linkText} ${hrefText}`;
  }

  override image({ href, tokens, text }: Tokens.Image): string {
    const alt = this.parser.parseInline(tokens) || text;
    return chalk.gray(`![${alt}](${href})`);
  }

  override text(token: Tokens.Text | Tokens.Escape): string {
    return "tokens" in token && token.tokens
      ? this.parser.parseInline(token.tokens)
      : unescapeHtml(token.text);
  }
}

const createRenderer = (columns: number) => new AnsiRenderer(columns);

// Markdown component using custom ANSI renderer
export const Markdown = React.memo(({ children }: MarkdownProps) => {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const ansiContent = useMemo(() => {
    return marked.parse(children, {
      renderer: createRenderer(columns),
      gfm: true,
      breaks: true,
    }) as string;
  }, [children, columns]);

  return (
    <Box flexDirection="column">
      <Text>{ansiContent.trim()}</Text>
    </Box>
  );
});

// Add display name for debugging
Markdown.displayName = "Markdown";
