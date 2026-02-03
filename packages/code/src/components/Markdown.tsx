import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { marked, type Token, type Tokens } from "marked";
import { highlight } from "cli-highlight";

export interface MarkdownProps {
  children: string;
}

const unescapeHtml = (html: string) => {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
};

const InlineRenderer = ({ tokens }: { tokens: Token[] }) => {
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.type) {
          case "text": {
            const t = token as Tokens.Text;
            if (t.tokens) {
              return <InlineRenderer key={index} tokens={t.tokens} />;
            }
            return <Text key={index}>{unescapeHtml(t.text)}</Text>;
          }
          case "strong":
            return (
              <Text key={index} bold>
                {token.tokens ? (
                  <InlineRenderer tokens={token.tokens} />
                ) : (
                  unescapeHtml((token as Tokens.Strong).text)
                )}
              </Text>
            );
          case "em":
            return (
              <Text key={index} italic>
                {token.tokens ? (
                  <InlineRenderer tokens={token.tokens} />
                ) : (
                  unescapeHtml((token as Tokens.Em).text)
                )}
              </Text>
            );
          case "codespan":
            return (
              <Text key={index} color="yellow">
                {unescapeHtml((token as Tokens.Codespan).text)}
              </Text>
            );
          case "link": {
            const t = token as Tokens.Link;
            return (
              <Text key={index}>
                <Text color="blue" underline>
                  {t.tokens ? (
                    <InlineRenderer tokens={t.tokens} />
                  ) : (
                    unescapeHtml(t.text)
                  )}
                </Text>
                <Text color="gray"> ({t.href})</Text>
              </Text>
            );
          }
          case "br":
            return <Text key={index}>{"\n"}</Text>;
          case "del":
            return (
              <Text key={index} strikethrough>
                {token.tokens ? (
                  <InlineRenderer tokens={token.tokens} />
                ) : (
                  unescapeHtml((token as Tokens.Del).text)
                )}
              </Text>
            );
          default:
            return <Text key={index}>{token.raw}</Text>;
        }
      })}
    </>
  );
};

const TableRenderer = ({ token }: { token: Tokens.Table }) => {
  const { stdout } = useStdout();
  const terminalWidth = (stdout?.columns || 80) - 2;

  const columnWidths = useMemo(() => {
    const numCols = token.header.length;
    const minWidth = 5;
    const maxColWidth = 40;
    const widths = token.header.map((h) =>
      Math.min(maxColWidth, Math.max(minWidth, h.text.length)),
    );

    token.rows.forEach((row) => {
      row.forEach((cell, i) => {
        widths[i] = Math.min(
          maxColWidth,
          Math.max(widths[i] || minWidth, cell.text.length),
        );
      });
    });

    const paddedWidths = widths.map((w) => w + 2);
    const totalWidth = paddedWidths.reduce((a, b) => a + b, 0) + numCols + 1;

    if (totalWidth <= terminalWidth) {
      return paddedWidths;
    }

    // If table is too wide, scale down columns proportionally
    const availableWidth = terminalWidth - numCols - 1;
    const scaleFactor = availableWidth / (totalWidth - numCols - 1);
    return paddedWidths.map((w) =>
      Math.max(minWidth, Math.floor(w * scaleFactor)),
    );
  }, [token, terminalWidth]);

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      borderStyle="single"
      borderColor="gray"
      width={columnWidths.reduce((a, b) => a + b, 0) + token.header.length + 1}
    >
      {/* Header */}
      <Box
        flexDirection="row"
        borderStyle="single"
        borderBottom
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        borderColor="gray"
      >
        {token.header.map((cell, i) => (
          <Box
            key={i}
            width={columnWidths[i]}
            paddingX={1}
            borderStyle="single"
            borderLeft={i > 0}
            borderRight={false}
            borderTop={false}
            borderBottom={false}
            borderColor="gray"
          >
            <Text bold wrap="wrap">
              <InlineRenderer tokens={cell.tokens} />
            </Text>
          </Box>
        ))}
      </Box>
      {/* Rows */}
      {token.rows.map((row, rowIndex) => (
        <Box key={rowIndex} flexDirection="row">
          {row.map((cell, i) => (
            <Box
              key={i}
              width={columnWidths[i]}
              paddingX={1}
              borderStyle="single"
              borderLeft={i > 0}
              borderRight={false}
              borderTop={false}
              borderBottom={false}
              borderColor="gray"
            >
              <Text wrap="wrap">
                <InlineRenderer tokens={cell.tokens} />
              </Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
};

const BlockRenderer = ({ tokens }: { tokens: Token[] }) => {
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.type) {
          case "heading": {
            const t = token as Tokens.Heading;
            return (
              <Box key={index} marginBottom={1} flexDirection="column">
                <Text bold color="cyan">
                  {"#".repeat(t.depth)} <InlineRenderer tokens={t.tokens} />
                </Text>
              </Box>
            );
          }
          case "paragraph": {
            const t = token as Tokens.Paragraph;
            return (
              <Box
                key={index}
                marginBottom={1}
                flexDirection="row"
                flexWrap="wrap"
              >
                <InlineRenderer tokens={t.tokens} />
              </Box>
            );
          }
          case "code": {
            const t = token as Tokens.Code;
            if (t.lang !== undefined) {
              const raw = token.raw.endsWith("\n")
                ? token.raw.slice(0, -1)
                : token.raw;
              const lines = raw.split("\n");
              const opening = lines[0];
              const closing = lines[lines.length - 1];
              const content = lines.slice(1, -1).join("\n");
              const highlighted = content
                ? highlight(unescapeHtml(content), {
                    language: t.lang,
                    ignoreIllegals: true,
                  })
                : "";
              return (
                <Box
                  key={index}
                  flexDirection="column"
                  paddingX={1}
                  marginBottom={1}
                >
                  <Text color="gray">{opening}</Text>
                  {highlighted && <Text>{highlighted}</Text>}
                  <Text color="gray">{closing}</Text>
                </Box>
              );
            }
            return (
              <Box
                key={index}
                flexDirection="column"
                paddingX={1}
                marginBottom={1}
              >
                <Text>{unescapeHtml(t.text)}</Text>
              </Box>
            );
          }
          case "list": {
            const t = token as Tokens.List;
            return (
              <Box
                key={index}
                flexDirection="column"
                marginBottom={1}
                paddingLeft={2}
              >
                {t.items.map((item, i) => {
                  const start = t.start || 1;
                  return (
                    <Box key={i} flexDirection="row">
                      <Text color="gray">
                        {t.ordered ? `${start + i}. ` : "• "}
                      </Text>
                      <Box flexDirection="column" flexGrow={1}>
                        {item.tokens.map((itemToken, itemIndex) => {
                          if (itemToken.type === "text") {
                            const it = itemToken as Tokens.Text;
                            return (
                              <Box
                                key={itemIndex}
                                flexDirection="row"
                                flexWrap="wrap"
                              >
                                <InlineRenderer
                                  tokens={it.tokens || [itemToken]}
                                />
                              </Box>
                            );
                          }
                          return (
                            <BlockRenderer
                              key={itemIndex}
                              tokens={[itemToken]}
                            />
                          );
                        })}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            );
          }
          case "blockquote": {
            const t = token as Tokens.Blockquote;
            return (
              <Box
                key={index}
                flexDirection="column"
                paddingLeft={2}
                borderStyle="single"
                borderLeft
                borderRight={false}
                borderTop={false}
                borderBottom={false}
                borderColor="gray"
                marginBottom={1}
              >
                <BlockRenderer tokens={t.tokens} />
              </Box>
            );
          }
          case "hr":
            return (
              <Box key={index} marginBottom={1}>
                <Text color="gray">{"─".repeat(20)}</Text>
              </Box>
            );
          case "table":
            return <TableRenderer key={index} token={token as Tokens.Table} />;
          case "space":
            return null;
          default:
            return (
              <Box key={index} marginBottom={1}>
                <Text>{token.raw}</Text>
              </Box>
            );
        }
      })}
    </>
  );
};

// Markdown component using custom Ink-based renderer
export const Markdown = React.memo(({ children }: MarkdownProps) => {
  const tokens = useMemo(() => marked.lexer(children), [children]);

  return (
    <Box flexDirection="column">
      <BlockRenderer tokens={tokens} />
    </Box>
  );
});

// Add display name for debugging
Markdown.displayName = "Markdown";
