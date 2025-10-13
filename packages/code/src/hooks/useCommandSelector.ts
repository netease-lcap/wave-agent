import { useState, useCallback } from "react";

export interface UseCommandSelectorParams {
  onShowBashManager?: () => void;
  onShowMcpManager?: () => void;
  executeSlashCommand?: (commandId: string) => Promise<boolean>; // 执行命令函数
  hasSlashCommand?: (commandId: string) => boolean; // 检查命令是否存在函数
}

export const useCommandSelector = ({
  onShowBashManager,
  onShowMcpManager,
  executeSlashCommand,
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

  const handleCommandSelect = useCallback(
    (command: string, inputText: string, cursorPosition: number) => {
      if (slashPosition >= 0) {
        // 替换 / 和搜索查询为选中的命令并执行
        const beforeSlash = inputText.substring(0, slashPosition);
        const afterQuery = inputText.substring(cursorPosition);
        const newInput = beforeSlash + afterQuery;
        const newCursorPosition = beforeSlash.length;

        // 异步执行命令，但不等待结果
        (async () => {
          // 先检查是否是agent命令
          let commandExecuted = false;
          if (
            executeSlashCommand &&
            hasSlashCommand &&
            hasSlashCommand(command)
          ) {
            commandExecuted = await executeSlashCommand(command);
          }

          // 如果不是agent命令或执行失败，检查本地命令
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
      executeSlashCommand,
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
    handleCancelCommandSelect,
    updateCommandSearchQuery,
    checkForSlashDeletion,
    slashPosition,
  };
};
