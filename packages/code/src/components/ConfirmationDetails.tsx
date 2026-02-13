import React, { useLayoutEffect, useRef, useState } from "react";
import { Box, Text, useStdout, measureElement, Static } from "ink";
import {
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  MULTI_EDIT_TOOL_NAME,
  DELETE_FILE_TOOL_NAME,
  WRITE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
} from "wave-agent-sdk";
import { DiffDisplay } from "./DiffDisplay.js";
import { PlanDisplay } from "./PlanDisplay.js";

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
    case MULTI_EDIT_TOOL_NAME:
      return `Edit multiple sections in: ${toolInput.file_path || "unknown file"}`;
    case DELETE_FILE_TOOL_NAME:
      return `Delete file: ${toolInput.target_file || "unknown file"}`;
    case WRITE_TOOL_NAME:
      return `Write to file: ${toolInput.file_path || "unknown file"}`;
    case EXIT_PLAN_MODE_TOOL_NAME:
      return "Review and approve the plan";
    case ASK_USER_QUESTION_TOOL_NAME:
      return "Answer questions to clarify intent";
    default:
      return "Execute operation";
  }
};

export interface ConfirmationDetailsProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  isExpanded?: boolean;
  onHeightMeasured?: (height: number) => void;
}

export const ConfirmationDetails: React.FC<ConfirmationDetailsProps> = ({
  toolName,
  toolInput,
  isExpanded = false,
  onHeightMeasured,
}) => {
  const { stdout } = useStdout();
  const [isStatic, setIsStatic] = useState(false);
  const boxRef = useRef(null);

  useLayoutEffect(() => {
    if (boxRef.current) {
      const { height } = measureElement(boxRef.current);
      const terminalHeight = stdout?.rows || 24;
      if (height > terminalHeight - 10) {
        setIsStatic(true);
      }
      onHeightMeasured?.(height);
    }
  }, [stdout?.rows, onHeightMeasured]);

  const content = (
    <Box
      ref={boxRef}
      flexDirection="column"
      borderStyle="single"
      borderColor="yellow"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingTop={1}
    >
      <Text color="yellow" bold>
        Tool: {toolName}
      </Text>
      <Text color="yellow">{getActionDescription(toolName, toolInput)}</Text>

      <DiffDisplay toolName={toolName} parameters={JSON.stringify(toolInput)} />

      {toolName !== ASK_USER_QUESTION_TOOL_NAME &&
        toolName === EXIT_PLAN_MODE_TOOL_NAME &&
        !!toolInput?.plan_content && (
          <PlanDisplay
            plan={toolInput.plan_content as string}
            isExpanded={isExpanded}
          />
        )}
    </Box>
  );

  if (isStatic) {
    return <Static items={[1]}>{() => content}</Static>;
  }

  return content;
};

ConfirmationDetails.displayName = "ConfirmationDetails";
