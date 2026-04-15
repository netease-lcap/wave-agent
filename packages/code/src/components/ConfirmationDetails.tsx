import React from "react";
import { Box, Text } from "ink";
import {
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
} from "wave-agent-sdk";
import { DiffDisplay } from "./DiffDisplay.js";
import { PlanDisplay } from "./PlanDisplay.js";
import { highlightToAnsi } from "../utils/highlightUtils.js";

// Helper function to generate descriptive action text
const getActionDescription = (
  toolName: string,
  toolInput?: Record<string, unknown>,
): string => {
  if (!toolInput) {
    return "Execute operation";
  }

  switch (toolName) {
    case BASH_TOOL_NAME:
      return `Execute command: ${toolInput.command || "unknown command"}`;
    case EDIT_TOOL_NAME:
      return `Edit file: ${toolInput.file_path || "unknown file"}`;
    case WRITE_TOOL_NAME:
      return `Write to file: ${toolInput.file_path || "unknown file"}`;
    case EXIT_PLAN_MODE_TOOL_NAME:
      return "Review and approve the plan";
    case ENTER_PLAN_MODE_TOOL_NAME:
      return "Enter plan mode for complex task planning";
    case ASK_USER_QUESTION_TOOL_NAME:
      return "Answer questions to clarify intent";
    default:
      return "Execute operation";
  }
};

export interface ConfirmationDetailsProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  planContent?: string;
  isExpanded?: boolean;
}

export const ConfirmationDetails: React.FC<ConfirmationDetailsProps> = ({
  toolName,
  toolInput,
  planContent,
  isExpanded = false,
}) => {
  const startLineNumber =
    (toolInput?.startLineNumber as number | undefined) ??
    (toolName === WRITE_TOOL_NAME ? 1 : undefined);

  const content = (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="yellow"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
    >
      <Text color="yellow" bold>
        Tool: {toolName}
      </Text>
      <Text color="yellow">{getActionDescription(toolName, toolInput)}</Text>

      <DiffDisplay
        toolName={toolName}
        parameters={JSON.stringify(toolInput)}
        startLineNumber={startLineNumber}
      />

      {toolName !== WRITE_TOOL_NAME &&
        toolName !== EDIT_TOOL_NAME &&
        toolName !== EXIT_PLAN_MODE_TOOL_NAME &&
        toolName !== ENTER_PLAN_MODE_TOOL_NAME &&
        toolName !== ASK_USER_QUESTION_TOOL_NAME &&
        toolName !== BASH_TOOL_NAME &&
        !!toolInput && (
          <Box paddingLeft={2} borderLeft borderColor="cyan">
            <Text>
              {highlightToAnsi(JSON.stringify(toolInput, null, 2), "json")}
            </Text>
          </Box>
        )}

      {toolName !== ASK_USER_QUESTION_TOOL_NAME &&
        toolName === EXIT_PLAN_MODE_TOOL_NAME &&
        !!planContent && (
          <PlanDisplay plan={planContent} isExpanded={isExpanded} />
        )}
    </Box>
  );

  return content;
};

ConfirmationDetails.displayName = "ConfirmationDetails";
