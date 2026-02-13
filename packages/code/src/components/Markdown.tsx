import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { Renderer, marked } from "marked";
import chalk from "chalk";

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

class AnsiRenderer extends Renderer {
  override code(code: string, lang: string | undefined): string {
    const prefix = lang ? `\`\`\`${lang}` : "```";
    const suffix = "```";
    return `\n${chalk.gray(prefix)}\n${code}\n${chalk.gray(suffix)}\n`;
  }

  override blockquote(quote: string): string {
    return (
      "\n" +
      quote
        .trim()
        .split("\n")
        .map((line) => chalk.gray("> ") + line)
        .join("\n") +
      "\n"
    );
  }

  override heading(text: string, level: number): string {
    const hashes = "#".repeat(level);
    return `\n${chalk.cyan(`${hashes} ${text}`)}\n`;
  }

  override hr(): string {
    return `\n${chalk.gray("─".repeat(20))}\n`;
  }

  override list(body: string, ordered: boolean, start: number): string {
    const lines = body.trim().split("\n");
    const formattedLines = lines.map((line, i) => {
      if (line.trim() === "") return "";
      const prefix = ordered ? chalk.gray(`${start + i}. `) : chalk.gray("• ");
      return prefix + line;
    });
    return `\n${formattedLines.filter((l) => l !== "").join("\n")}\n`;
  }

  override listitem(text: string): string {
    return text + "\n";
  }

  override checkbox(checked: boolean): string {
    return checked ? chalk.green("[x] ") : chalk.gray("[ ] ");
  }

  override paragraph(text: string): string {
    return `\n${text}\n`;
  }

  override table(header: string, body: string): string {
    return `\n${header}${body}\n`;
  }

  override tablerow(content: string): string {
    return content + "\n";
  }

  override tablecell(
    content: string,
    flags: { header: boolean; align: "center" | "left" | "right" | null },
  ): string {
    const text = flags.header ? chalk.bold(content) : content;
    return text + " | ";
  }

  override strong(text: string): string {
    return chalk.bold(text);
  }

  override em(text: string): string {
    return chalk.italic(text);
  }

  override codespan(text: string): string {
    return chalk.yellow(text);
  }

  override br(): string {
    return "\n";
  }

  override del(text: string): string {
    return chalk.strikethrough(text);
  }

  override link(
    href: string,
    title: string | null | undefined,
    text: string,
  ): string {
    const linkText = chalk.blue.underline(text);
    const hrefText = chalk.gray(`(${href})`);
    return `${linkText} ${hrefText}`;
  }

  override image(
    href: string,
    title: string | null | undefined,
    text: string,
  ): string {
    return chalk.gray(`![${text}](${href})`);
  }

  override text(text: string): string {
    return unescapeHtml(text);
  }
}

const renderer = new AnsiRenderer();

// Markdown component using custom ANSI renderer
export const Markdown = React.memo(({ children }: MarkdownProps) => {
  const ansiContent = useMemo(() => {
    return marked.parse(children, {
      renderer,
      gfm: true,
      breaks: true,
    }) as string;
  }, [children]);

  return (
    <Box flexDirection="column">
      <Text>{ansiContent.trim()}</Text>
    </Box>
  );
});

// Add display name for debugging
Markdown.displayName = "Markdown";
