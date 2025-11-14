import React from "react";
import { Box, Text, useInput } from "ink";
import type { PermissionRequest } from "wave-agent-sdk";

export interface ConfirmDialogProps {
  /** The permission request to display */
  permissionRequest: PermissionRequest;
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when user allows the action */
  onAllow: () => void;
  /** Callback when user denies the action */
  onDeny: () => void;
  /** Optional callback when dialog is closed */
  onClose?: () => void;
  /** Optional custom title for the dialog */
  title?: string;
}

export function ConfirmDialog({
  permissionRequest,
  isOpen,
  onAllow,
  onDeny,
  onClose,
  title = "Permission Required"
}: ConfirmDialogProps) {
  // Handle keyboard input
  useInput((input, key) => {
    if (!isOpen) return;
    
    if (key.escape) {
      onClose?.();
    } else if (key.return) {
      if (key.shift) {
        onDeny();
      } else {
        onAllow();
      }
    } else if (input === 'y' || input === 'Y') {
      onAllow();
    } else if (input === 'n' || input === 'N') {
      onDeny();
    }
  });

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  // Format tool input for display
  const formatToolInput = (input?: Record<string, unknown>) => {
    if (!input || Object.keys(input).length === 0) {
      return "No parameters";
    }
    
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  };

  return (
    <Box
      borderStyle="double"
      borderColor="blue"
      paddingX={2}
      paddingY={1}
      flexDirection="column"
      width={80}
      marginY={1}
    >
      {/* Header */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        marginBottom={1}
      >
        <Box flexDirection="row" alignItems="center">
          <Text color="blue" bold>🔒 {title}</Text>
        </Box>
      </Box>

      {/* Content */}
      <Box flexDirection="column" paddingBottom={1}>
        {/* Tool Information */}
        <Box flexDirection="column" marginBottom={1}>
          <Text color="white" bold>Tool Request:</Text>
          <Text color="cyan">{permissionRequest.toolName}</Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          <Text color="white" bold>Reason:</Text>
          <Text color="white">{permissionRequest.reason}</Text>
        </Box>

        {permissionRequest.toolInput && Object.keys(permissionRequest.toolInput).length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color="white" bold>Tool Parameters:</Text>
            <Text color="gray">{formatToolInput(permissionRequest.toolInput)}</Text>
          </Box>
        )}

        {/* Request ID (for debugging) */}
        <Box marginTop={1} paddingTop={1}>
          <Text color="gray" dimColor>
            Request ID: {permissionRequest.id}
          </Text>
        </Box>
      </Box>

      {/* Actions */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        marginTop={1}
        paddingTop={1}
      >
        <Text color="red">❌ [N]o/Deny (Shift+Enter)</Text>
        <Text color="green">✅ [Y]es/Allow (Enter)</Text>
      </Box>

      {/* Keyboard shortcuts help */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Keys: Enter=Allow • Shift+Enter=Deny • Y=Allow • N=Deny • Esc=Close
        </Text>
      </Box>
    </Box>
  );
}

export default ConfirmDialog;