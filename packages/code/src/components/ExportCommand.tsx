import React, { useMemo, useState } from "react";
import { Box, Text, useInput, usePaste } from "ink";
import type { Key } from "ink";
import type { TranscriptExportStats } from "wave-agent-sdk";

/**
 * `/export` 的选择浮层：与 Claude Code 的 `ExportDialog` 同一套流程——
 * 先选「复制到剪贴板」还是「存成文件」，选了存文件才进文件名输入，
 * 文件名这一步 `Esc` 退回选项而不是整个关掉。
 *
 * 正文已经由调用方渲染好（`renderTranscriptPlainText`），这里只管把用户的选择
 * 交给 `onCopy` / `onSave`；成功失败的话术也归调用方（它往会话里追一条消息，
 * 与 `/rename`、`/context` 同一个落点）。
 */
export interface ExportCommandProps {
  /** 预填的文件名：`<timestamp>-<首条输入>.txt`，与 CC 的默认名同构。 */
  defaultFilename: string;
  /** 浮层顶部那行摘要用的统计（CC 没有这行，见 spec 的对齐说明）。 */
  stats: TranscriptExportStats;
  onCopy: () => Promise<void>;
  onSave: (filename: string) => Promise<void>;
  onCancel: () => void;
}

type Step = "select" | "file";

export const EXPORT_OPTIONS = [
  {
    label: "Copy to clipboard",
    description: "Copy the conversation to your system clipboard",
  },
  {
    label: "Save to file",
    description: "Save the conversation to a file in the current directory",
  },
] as const;

export const ExportCommand: React.FC<ExportCommandProps> = ({
  defaultFilename,
  stats,
  onCopy,
  onSave,
  onCancel,
}) => {
  const [step, setStep] = useState<Step>("select");
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Filename + cursor live in one state object: several keystrokes can land in
  // the same React batch (a fast typist, a paste, or the backspace test), and
  // two independent `useState`s would let each of them read a stale cursor and
  // edit the wrong character.
  const [name, setName] = useState({
    value: defaultFilename,
    // 光标停在末尾起步（CC 的 `TextInput` 也是 `cursorOffset = defaultFilename.length`）。
    cursor: defaultFilename.length,
  });

  const summary = useMemo(() => {
    const parts = [`${stats.messages} messages`];
    if (stats.toolCalls > 0) parts.push(`${stats.toolCalls} tool calls`);
    if (stats.images > 0) parts.push(`${stats.images} images`);
    return parts.join(" · ");
  }, [stats]);

  const submitFile = () => {
    const trimmed = name.value.trim();
    // 空文件名没什么可写的；与 CC 一样只让 `Enter` 在非空时提交。
    if (!trimmed) return;
    void onSave(trimmed);
  };

  const handleSelect = () => {
    if (selectedIndex === 0) {
      void onCopy();
      return;
    }
    setStep("file");
  };

  const insertText = (text: string) => {
    setName((current) => ({
      value:
        current.value.slice(0, current.cursor) +
        text +
        current.value.slice(current.cursor),
      cursor: current.cursor + text.length,
    }));
  };

  const handleFilenameKey = (input: string, key: Key) => {
    if (key.escape) {
      // 回到选项那一步，而不是关掉浮层（CC 的 `handleGoBack`）。
      setStep("select");
      return;
    }
    if (key.return) {
      submitFile();
      return;
    }
    if (key.leftArrow) {
      setName((current) => ({
        ...current,
        cursor: Math.max(0, current.cursor - 1),
      }));
      return;
    }
    if (key.rightArrow) {
      setName((current) => ({
        ...current,
        cursor: Math.min(current.value.length, current.cursor + 1),
      }));
      return;
    }
    if (key.backspace || key.delete) {
      setName((current) => {
        if (current.cursor === 0) return current;
        return {
          value:
            current.value.slice(0, current.cursor - 1) +
            current.value.slice(current.cursor),
          cursor: current.cursor - 1,
        };
      });
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    insertText(input);
  };

  useInput((input, key) => {
    if (step === "file") {
      handleFilenameKey(input, key);
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((value) => Math.max(0, value - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((value) =>
        Math.min(EXPORT_OPTIONS.length - 1, value + 1),
      );
      return;
    }
    if (key.return) {
      handleSelect();
    }
  });

  // 粘贴进来的文件名是一整串、没有按键标志，直接插在光标处。
  usePaste((text) => {
    if (step !== "file") return;
    const pasted = text.replace(/[\r\n]+/g, "");
    if (!pasted) return;
    insertText(pasted);
  });

  const beforeCursor = name.value.slice(0, name.cursor);
  const atCursor = name.value.slice(name.cursor, name.cursor + 1);
  const afterCursor = name.value.slice(name.cursor + 1);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      borderLeft={false}
      borderRight={false}
      borderBottom={false}
      paddingTop={1}
    >
      <Box>
        <Text bold color="cyan">
          Export Conversation
        </Text>
      </Box>
      <Text dimColor>{summary}</Text>

      {step === "select" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>Select export method:</Text>
          {EXPORT_OPTIONS.map((option, index) => (
            <Box key={option.label} marginTop={index === 0 ? 1 : 0}>
              <Box width={22}>
                <Text
                  color={index === selectedIndex ? "black" : "white"}
                  backgroundColor={index === selectedIndex ? "cyan" : undefined}
                >
                  {index === selectedIndex ? "▶ " : "  "}
                  {option.label}
                </Text>
              </Box>
              <Text dimColor>{option.description}</Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text dimColor>
              ↑/↓ to select · Enter to confirm · Esc to cancel
            </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text>Enter filename:</Text>
          <Box marginTop={1}>
            <Text color="cyan">{"> "}</Text>
            <Text color="white">
              {beforeCursor}
              {atCursor ? (
                <Text backgroundColor="white" color="black">
                  {atCursor}
                </Text>
              ) : (
                <Text backgroundColor="white" color="black">
                  {" "}
                </Text>
              )}
              {afterCursor}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Enter to save · Esc to go back</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
