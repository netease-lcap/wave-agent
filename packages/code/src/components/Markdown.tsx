import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { marked, type Token, type Tokens } from "marked";

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
          case "link":
            return (
              <Text key={index} color="blue" underline>
                {token.tokens ? (
                  <InlineRenderer tokens={token.tokens} />
                ) : (
                  unescapeHtml((token as Tokens.Link).text)
                )}
              </Text>
            );
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
            return (
              <Box
                key={index}
                flexDirection="column"
                paddingX={1}
                borderStyle="round"
                borderColor="gray"
                marginBottom={1}
              >
                {t.lang && (
                  <Box>
                    <Text color="gray" italic>
                      {t.lang}
                    </Text>
                  </Box>
                )}
                <Text>{t.text}</Text>
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
