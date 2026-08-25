import React from "react";
import { Box, Text, useInput } from "ink";
import { PlanDisplay } from "./PlanDisplay.js";

export interface PlanViewProps {
  path?: string;
  content?: string;
  message?: string;
  onCancel: () => void;
}

/**
 * Overlay shown by the /plan command:
 * - With `message` only: a plain status line (e.g. "Enabled plan mode").
 * - With `path`/`content`: the current plan file contents, plus a hint that
 *   `/plan open` opens the file in the external editor.
 * Esc dismisses the overlay.
 */
export const PlanView: React.FC<PlanViewProps> = ({
  path,
  content,
  message,
  onCancel,
}) => {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  if (message !== undefined && content === undefined) {
    return (
      <Box
        flexDirection="column"
        paddingX={1}
        borderStyle="single"
        borderColor="cyan"
        borderLeft={false}
        borderRight={false}
      >
        <Text color="cyan">{message}</Text>
        <Text dimColor>Press Escape to continue</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      borderStyle="single"
      borderColor="cyan"
      borderLeft={false}
      borderRight={false}
    >
      <Text color="cyan" bold>
        Current Plan
      </Text>
      {path ? <Text dimColor>{path}</Text> : null}
      {content !== undefined && content !== "" ? (
        <PlanDisplay plan={content} />
      ) : (
        <Text>No plan written yet.</Text>
      )}
      <Text dimColor>
        /plan open opens this file in your editor • Press Escape to continue
      </Text>
    </Box>
  );
};
