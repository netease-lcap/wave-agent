import { useState, useCallback } from "react";

export interface UseCommandSelectorParams {
  onShowBashManager?: () => void;
  onShowMcpManager?: () => void;
  sendMessage?: (content: string) => Promise<void>; // Use sendMessage instead of executeSlashCommand
  hasSlashCommand?: (commandId: string) => boolean; // Function to check if command exists
}

export const useCommandSelector = ({
  onShowBashManager,
  onShowMcpManager,
  sendMessage,
  hasSlashCommand,
}: UseCommandSelectorParams) => {
  const [showCommandSelector, setShowCommandSelector] = useState(false);
  const [slashPosition, setSlashPosition] = useState(-1);
  const [commandSearchQuery, setCommandSearchQuery] = useState("");

  const activateCommandSelector = useCallback((position: number) => {
    setShowCommandSelector(true);
    setSlashPosition(position);
    setCommandSearchQuery("");
  }, []);

  const handleCommandInsert = useCallback(
    (command: string, inputText: string, cursorPosition: number) => {
      if (slashPosition >= 0) {
        // Replace content from / to current cursor position with /command_name + space
        const beforeSlash = inputText.substring(0, slashPosition);
        const afterQuery = inputText.substring(cursorPosition);
        const newInput = beforeSlash + `/${command} ` + afterQuery;
        const newCursorPosition = beforeSlash.length + command.length + 2; // +2 for "/" and " "

        setShowCommandSelector(false);
        setSlashPosition(-1);
        setCommandSearchQuery("");

        return { newInput, newCursorPosition };
      }
      return { newInput: inputText, newCursorPosition: cursorPosition };
    },
    [slashPosition],
  );

  const handleCommandSelect = useCallback(
    (command: string, inputText: string, cursorPosition: number) => {
      if (slashPosition >= 0) {
        // Replace command part, keep other content
        const beforeSlash = inputText.substring(0, slashPosition);
        const afterQuery = inputText.substring(cursorPosition);
        const newInput = beforeSlash + afterQuery;
        const newCursorPosition = beforeSlash.length;

        // Execute command asynchronously
        (async () => {
          // First check if it's an agent command
          let commandExecuted = false;
          if (sendMessage && hasSlashCommand && hasSlashCommand(command)) {
            // Execute complete command (replace partial input with complete command name)
            const fullCommand = `/${command}`;
            try {
              await sendMessage(fullCommand);
              commandExecuted = true;
            } catch (error) {
              console.error("Failed to execute slash command:", error);
            }
          }

          // If not an agent command or execution failed, check local commands
          if (!commandExecuted) {
            if (command === "bashes" && onShowBashManager) {
              onShowBashManager();
              commandExecuted = true;
            } else if (command === "mcp" && onShowMcpManager) {
              onShowMcpManager();
              commandExecuted = true;
            }
          }
        })();

        setShowCommandSelector(false);
        setSlashPosition(-1);
        setCommandSearchQuery("");

        return { newInput, newCursorPosition };
      }
      return { newInput: inputText, newCursorPosition: cursorPosition };
    },
    [
      slashPosition,
      onShowBashManager,
      onShowMcpManager,
      sendMessage,
      hasSlashCommand,
    ],
  );

  const handleCancelCommandSelect = useCallback(() => {
    setShowCommandSelector(false);
    setSlashPosition(-1);
    setCommandSearchQuery("");
  }, []);

  const updateCommandSearchQuery = useCallback((query: string) => {
    setCommandSearchQuery(query);
  }, []);

  const checkForSlashDeletion = useCallback(
    (cursorPosition: number) => {
      if (showCommandSelector && cursorPosition <= slashPosition) {
        handleCancelCommandSelect();
        return true;
      }
      return false;
    },
    [showCommandSelector, slashPosition, handleCancelCommandSelect],
  );

  return {
    showCommandSelector,
    commandSearchQuery,
    activateCommandSelector,
    handleCommandSelect,
    handleCommandInsert,
    handleCancelCommandSelect,
    updateCommandSearchQuery,
    checkForSlashDeletion,
    slashPosition,
  };
};
