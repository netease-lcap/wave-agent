import { useState, useCallback } from "react";

export interface UseCommandSelectorParams {
  onShowBashManager?: () => void;
  onShowMcpManager?: () => void;
  executeSlashCommand?: (commandInput: string) => Promise<boolean>; // 执行命令函数（包含参数）
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

  const handleCommandInsert = useCallback(
    (command: string, inputText: string, cursorPosition: number) => {
      if (slashPosition >= 0) {
        // 替换从 / 开始到当前光标位置的内容为 /命令名 + 空格
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
        // 替换命令部分，保留其他内容
        const beforeSlash = inputText.substring(0, slashPosition);
        const afterQuery = inputText.substring(cursorPosition);
        const newInput = beforeSlash + afterQuery;
        const newCursorPosition = beforeSlash.length;

        // 异步执行命令
        (async () => {
          // 先检查是否是agent命令
          let commandExecuted = false;
          if (
            executeSlashCommand &&
            hasSlashCommand &&
            hasSlashCommand(command)
          ) {
            // 执行完整的命令（将部分输入替换为完整命令名）
            const fullCommand = `/${command}`;
            commandExecuted = await executeSlashCommand(fullCommand);
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
    handleCommandInsert,
    handleCancelCommandSelect,
    updateCommandSearchQuery,
    checkForSlashDeletion,
    slashPosition,
  };
};
