import { useCallback, useRef, useEffect } from "react";
import { useInput, Key } from "ink";
import { useChat } from "../contexts/useChat";
import { logger } from "@/utils/logger";

interface KeyboardHandlerProps {
  inputText: string;
  setInputText: (text: string) => void;
  cursorPosition: number;
  setCursorPosition: (position: number) => void;
  moveCursorLeft: () => void;
  moveCursorRight: () => void;
  moveCursorToStart: () => void;
  moveCursorToEnd: () => void;
  deleteCharAtCursor: () => void;
  insertTextAtCursor: (text: string) => void;
  clearInput: () => void;
  resetHistoryNavigation: () => void;
  navigateHistory: (
    direction: "up" | "down",
    inputText: string,
    activateBashMode?: () => void,
  ) => { newInput: string; newCursorPosition: number };
  handlePasteImage: () => Promise<boolean>;
  attachedImages: Array<{ id: number; path: string; mimeType: string }>;
  clearImages: () => void;

  // File selector
  showFileSelector: boolean;
  activateFileSelector: (position: number) => void;
  handleFileSelect: (
    filePath: string,
    inputText: string,
    cursorPosition: number,
  ) => { newInput: string; newCursorPosition: number };
  handleCancelFileSelect: () => void;
  updateSearchQuery: (query: string) => void;
  checkForAtDeletion: (cursorPosition: number) => boolean;
  atPosition: number;

  // Command selector
  showCommandSelector: boolean;
  activateCommandSelector: (position: number) => void;
  handleCommandSelect: (
    command: string,
    inputText: string,
    cursorPosition: number,
  ) => { newInput: string; newCursorPosition: number };
  handleCommandGenerated: (
    generatedCommand: string,
    activateBashMode?: () => void,
  ) => {
    newInput: string;
    newCursorPosition: number;
  };
  handleCancelCommandSelect: () => void;
  updateCommandSearchQuery: (query: string) => void;
  checkForSlashDeletion: (cursorPosition: number) => boolean;
  slashPosition: number;

  // Bash history selector
  showBashHistorySelector: boolean;
  activateBashHistorySelector: (position: number) => void;
  handleBashHistorySelect: (
    command: string,
    inputText: string,
    cursorPosition: number,
  ) => { newInput: string; newCursorPosition: number };
  handleCancelBashHistorySelect: () => void;
  updateBashHistorySearchQuery: (query: string) => void;
  checkForExclamationDeletion: (cursorPosition: number) => boolean;
  exclamationPosition: number;

  // Memory type selector
  showMemoryTypeSelector: boolean;
  activateMemoryTypeSelector: (message: string) => void;
  handleMemoryTypeSelect: (type: "project" | "user") => void;
}

export const useInputKeyboardHandler = (props: KeyboardHandlerProps) => {
  const {
    inputText,
    setInputText,
    cursorPosition,
    setCursorPosition,
    moveCursorLeft,
    moveCursorRight,
    moveCursorToStart,
    moveCursorToEnd,
    deleteCharAtCursor,
    insertTextAtCursor,
    clearInput,
    resetHistoryNavigation,
    navigateHistory,
    handlePasteImage,
    attachedImages,
    clearImages,
    showFileSelector,
    activateFileSelector,
    handleFileSelect,
    handleCancelFileSelect,
    updateSearchQuery,
    checkForAtDeletion,
    atPosition,
    showCommandSelector,
    activateCommandSelector,
    handleCommandSelect,
    handleCommandGenerated,
    handleCancelCommandSelect,
    updateCommandSearchQuery,
    checkForSlashDeletion,
    slashPosition,
    showBashHistorySelector,
    activateBashHistorySelector,
    handleBashHistorySelect,
    handleCancelBashHistorySelect,
    updateBashHistorySearchQuery,
    checkForExclamationDeletion,
    exclamationPosition,
    showMemoryTypeSelector,
    activateMemoryTypeSelector,
    handleMemoryTypeSelect,
  } = props;

  const { isCommandRunning, isLoading, sendMessage, abortMessage, saveMemory } =
    useChat();

  // Debounce for paste operations
  const pasteDebounceRef = useRef<{
    timer: NodeJS.Timeout | null;
    buffer: string;
    initialCursorPosition: number;
    isPasting: boolean;
  }>({
    timer: null,
    buffer: "",
    initialCursorPosition: 0,
    isPasting: false,
  });

  // 长文本压缩管理
  const longTextCounterRef = useRef<number>(0);
  const longTextMapRef = useRef<Map<string, string>>(new Map());

  const generateCompressedText = (originalText: string): string => {
    longTextCounterRef.current += 1;
    const compressedLabel = `[长文本#${longTextCounterRef.current}]`;
    longTextMapRef.current.set(compressedLabel, originalText);
    return compressedLabel;
  };

  const expandLongTextPlaceholders = (text: string): string => {
    let expandedText = text;
    const longTextRegex = /\[长文本#(\d+)\]/g;
    const matches = [...text.matchAll(longTextRegex)];

    for (const match of matches) {
      const placeholder = match[0];
      const originalText = longTextMapRef.current.get(placeholder);
      if (originalText) {
        expandedText = expandedText.replace(placeholder, originalText);
      }
    }

    return expandedText;
  };

  // Cleanup on unmount
  useEffect(() => {
    const currentDebounceRef = pasteDebounceRef.current;
    return () => {
      if (currentDebounceRef.timer) {
        clearTimeout(currentDebounceRef.timer);
      }
    };
  }, []);

  const handleSelectorInput = useCallback(
    (input: string, key: Key) => {
      if (key.backspace || key.delete) {
        if (cursorPosition > 0) {
          const newInput =
            inputText.substring(0, cursorPosition - 1) +
            inputText.substring(cursorPosition);
          setInputText(newInput);
          setCursorPosition(cursorPosition - 1);

          // 更新搜索查询
          if (atPosition >= 0) {
            const queryStart = atPosition + 1;
            const queryEnd = cursorPosition - 1;
            if (queryEnd <= atPosition) {
              // 删除了 @ 符号，关闭文件选择器
              handleCancelFileSelect();
            } else {
              const newQuery = newInput.substring(queryStart, queryEnd);
              updateSearchQuery(newQuery);
            }
          } else if (slashPosition >= 0) {
            const queryStart = slashPosition + 1;
            const queryEnd = cursorPosition - 1;
            if (queryEnd <= slashPosition) {
              // 删除了 / 符号，关闭命令选择器
              handleCancelCommandSelect();
            } else {
              const newQuery = newInput.substring(queryStart, queryEnd);
              updateCommandSearchQuery(newQuery);
            }
          } else if (exclamationPosition >= 0) {
            const queryStart = exclamationPosition + 1;
            const queryEnd = cursorPosition - 1;
            if (queryEnd <= exclamationPosition) {
              // 删除了 ! 符号，关闭bash历史选择器
              handleCancelBashHistorySelect();
            } else {
              const newQuery = newInput.substring(queryStart, queryEnd);
              updateBashHistorySearchQuery(newQuery);
            }
          }
        }
        return;
      }

      // 箭头键应该被选择器组件处理，不需要在这里过滤
      if (key.upArrow || key.downArrow) {
        // 让选择器组件处理箭头键导航
        return;
      }

      if (
        input &&
        !key.ctrl &&
        !("alt" in key && key.alt) &&
        !key.meta &&
        !key.return &&
        !key.escape &&
        !key.leftArrow &&
        !key.rightArrow &&
        !("home" in key && key.home) &&
        !("end" in key && key.end)
      ) {
        // 处理字符输入用于搜索
        const char = input;
        const newInput =
          inputText.substring(0, cursorPosition) +
          char +
          inputText.substring(cursorPosition);
        setInputText(newInput);
        setCursorPosition(cursorPosition + input.length);

        // 更新搜索查询
        if (atPosition >= 0) {
          const queryStart = atPosition + 1;
          const queryEnd = cursorPosition + input.length;
          const newQuery = newInput.substring(queryStart, queryEnd);
          updateSearchQuery(newQuery);
        } else if (slashPosition >= 0) {
          const queryStart = slashPosition + 1;
          const queryEnd = cursorPosition + input.length;
          const newQuery = newInput.substring(queryStart, queryEnd);
          updateCommandSearchQuery(newQuery);
        } else if (exclamationPosition >= 0) {
          const queryStart = exclamationPosition + 1;
          const queryEnd = cursorPosition + input.length;
          const newQuery = newInput.substring(queryStart, queryEnd);
          updateBashHistorySearchQuery(newQuery);
        }
      }
    },
    [
      inputText,
      cursorPosition,
      setInputText,
      setCursorPosition,
      atPosition,
      slashPosition,
      exclamationPosition,
      handleCancelFileSelect,
      handleCancelCommandSelect,
      handleCancelBashHistorySelect,
      updateSearchQuery,
      updateCommandSearchQuery,
      updateBashHistorySearchQuery,
    ],
  );

  const handleNormalInput = useCallback(
    (input: string, key: Key) => {
      if (key.return) {
        // 在 loading 或命令运行期间阻止提交
        if (isLoading || isCommandRunning) {
          return;
        }

        if (inputText.trim()) {
          // 检查是否是记忆消息（以#开头且只有一行）
          const trimmedInput = inputText.trim();
          if (trimmedInput.startsWith("#") && !trimmedInput.includes("\n")) {
            // 激活记忆类型选择器
            activateMemoryTypeSelector(trimmedInput);
            return;
          }

          // 提取图片信息
          const imageRegex = /\[Image #(\d+)\]/g;
          const matches = [...inputText.matchAll(imageRegex)];
          const referencedImages = matches
            .map((match) => {
              const imageId = parseInt(match[1], 10);
              return attachedImages.find((img) => img.id === imageId);
            })
            .filter(
              (img): img is { id: number; path: string; mimeType: string } =>
                img !== undefined,
            )
            .map((img) => ({ path: img.path, mimeType: img.mimeType }));

          // 移除图片占位符，展开长文本占位符，发送消息
          let cleanContent = inputText.replace(imageRegex, "").trim();
          cleanContent = expandLongTextPlaceholders(cleanContent);

          // 检查是否是 bash 命令（以!开头且只有一行）
          const isBashCommand =
            cleanContent.startsWith("!") && !cleanContent.includes("\n");

          sendMessage(
            cleanContent,
            referencedImages.length > 0 ? referencedImages : undefined,
            {
              isBashCommand,
            },
          );
          clearInput();
          clearImages();
          resetHistoryNavigation();

          // 清理长文本映射
          longTextMapRef.current.clear();
        }
        return;
      }

      if (key.escape) {
        if (showFileSelector) {
          handleCancelFileSelect();
        } else if (showCommandSelector) {
          handleCancelCommandSelect();
        } else if (showBashHistorySelector) {
          handleCancelBashHistorySelect();
        }
        return;
      }

      if (key.backspace || key.delete) {
        if (cursorPosition > 0) {
          deleteCharAtCursor();
          resetHistoryNavigation();

          // Check if we deleted any special characters
          const newCursorPosition = cursorPosition - 1;
          checkForAtDeletion(newCursorPosition);
          checkForSlashDeletion(newCursorPosition);
          checkForExclamationDeletion(newCursorPosition);
        }
        return;
      }

      if (key.leftArrow) {
        moveCursorLeft();
        return;
      }

      if (key.rightArrow) {
        moveCursorRight();
        return;
      }

      if (("home" in key && key.home) || (key.ctrl && input === "a")) {
        moveCursorToStart();
        return;
      }

      if (("end" in key && key.end) || (key.ctrl && input === "e")) {
        moveCursorToEnd();
        return;
      }

      // 处理 Ctrl+V 粘贴图片
      if (key.ctrl && input === "v") {
        handlePasteImage().catch((error) => {
          console.warn("Failed to handle paste image:", error);
        });
        return;
      }

      // 处理上下键进行历史导航（仅在没有选择器激活时）
      if (
        key.upArrow &&
        !showFileSelector &&
        !showCommandSelector &&
        !showBashHistorySelector
      ) {
        const { newInput, newCursorPosition } = navigateHistory(
          "up",
          inputText,
        );
        setInputText(newInput);
        setCursorPosition(newCursorPosition);
        return;
      }

      if (
        key.downArrow &&
        !showFileSelector &&
        !showCommandSelector &&
        !showBashHistorySelector
      ) {
        const { newInput, newCursorPosition } = navigateHistory(
          "down",
          inputText,
        );
        setInputText(newInput);
        setCursorPosition(newCursorPosition);
        return;
      }

      // 处理打字输入
      if (
        input &&
        !key.ctrl &&
        !("alt" in key && key.alt) &&
        !key.meta &&
        !key.return &&
        !key.escape &&
        !key.backspace &&
        !key.delete &&
        !key.leftArrow &&
        !key.rightArrow &&
        !("home" in key && key.home) &&
        !("end" in key && key.end)
      ) {
        const inputString = input;

        // 检测是否为粘贴操作（输入包含多个字符或换行符）
        const isPasteOperation =
          inputString.length > 1 ||
          inputString.includes("\n") ||
          inputString.includes("\r");

        if (isPasteOperation) {
          logger.debug("[InputBox] 🔍 检测到粘贴操作:", {
            inputLength: inputString.length,
            input:
              inputString.substring(0, 50) +
              (inputString.length > 50 ? "..." : ""),
            hasNewlines:
              inputString.includes("\n") || inputString.includes("\r"),
          });

          // 开始或继续粘贴操作的debounce处理
          if (!pasteDebounceRef.current.isPasting) {
            // 开始新的粘贴操作
            logger.debug(
              "[InputBox] 🚀 开始新的粘贴操作 - 初始化debounce缓冲区",
            );
            pasteDebounceRef.current.isPasting = true;
            pasteDebounceRef.current.buffer = inputString;
            pasteDebounceRef.current.initialCursorPosition = cursorPosition;
          } else {
            // 继续粘贴操作，将新输入添加到缓冲区
            logger.debug("[InputBox] 📝 合并粘贴内容到缓冲区:", {
              previousBufferLength: pasteDebounceRef.current.buffer.length,
              newInputLength: inputString.length,
              newTotalLength:
                pasteDebounceRef.current.buffer.length + inputString.length,
            });
            pasteDebounceRef.current.buffer += inputString;
          }

          // 清除之前的定时器
          if (pasteDebounceRef.current.timer) {
            logger.debug(
              "[InputBox] ⏰ 清除之前的debounce定时器，重新设置30毫秒延迟",
            );
            clearTimeout(pasteDebounceRef.current.timer);
          }

          // 设置新的30毫秒定时器
          pasteDebounceRef.current.timer = setTimeout(() => {
            logger.debug("[InputBox] ✅ Debounce完成 - 处理合并后的粘贴内容:", {
              finalBufferLength: pasteDebounceRef.current.buffer.length,
              content:
                pasteDebounceRef.current.buffer.substring(0, 100) +
                (pasteDebounceRef.current.buffer.length > 100 ? "..." : ""),
            });

            // 处理缓冲区中的所有粘贴内容
            let processedInput = pasteDebounceRef.current.buffer.replace(
              /\r/g,
              "\n",
            );

            // 检查是否需要长文本压缩（超过200字符）
            if (processedInput.length > 200) {
              const originalText = processedInput;
              const compressedLabel = generateCompressedText(originalText);
              logger.info(
                "[InputBox] 📦 长文本压缩: originalLength:",
                originalText.length,
                "compressedLabel:",
                compressedLabel,
                "preview:",
                originalText.substring(0, 50) + "...",
              );
              processedInput = compressedLabel;
            }

            insertTextAtCursor(processedInput);
            resetHistoryNavigation();

            // 重置粘贴状态
            pasteDebounceRef.current.isPasting = false;
            pasteDebounceRef.current.buffer = "";
            pasteDebounceRef.current.timer = null;

            logger.debug("[InputBox] 🎯 粘贴debounce处理完成，状态已重置");
          }, 30);
        } else {
          // 处理单字符输入
          let char = inputString;

          // 检查是否为中文叹号，如果是且在开头位置，则转换为英文叹号
          if (char === "！" && cursorPosition === 0) {
            char = "!";
          }

          insertTextAtCursor(char);
          resetHistoryNavigation();

          // 检查特殊字符并设置相应的选择器
          if (char === "@") {
            activateFileSelector(cursorPosition);
          } else if (char === "/") {
            activateCommandSelector(cursorPosition);
          } else if (char === "!" && cursorPosition === 0) {
            // ! 必须在第一个字符才能唤起 bash selector
            activateBashHistorySelector(cursorPosition);
          } else if (char === "#" && cursorPosition === 0) {
            // # 在开头位置，将被发送时自动检测为记忆消息
            logger.debug("[InputBox] 📝 记忆消息检测，输入以 # 开头");
          } else if (showFileSelector && atPosition >= 0) {
            // 更新搜索查询
            const queryStart = atPosition + 1;
            const queryEnd = cursorPosition + char.length;
            const newQuery = inputText.substring(queryStart, queryEnd);
            updateSearchQuery(newQuery);
          } else if (showCommandSelector && slashPosition >= 0) {
            // 更新命令搜索查询
            const queryStart = slashPosition + 1;
            const queryEnd = cursorPosition + char.length;
            const newQuery = inputText.substring(queryStart, queryEnd);
            updateCommandSearchQuery(newQuery);
          } else if (showBashHistorySelector && exclamationPosition >= 0) {
            // 更新bash历史搜索查询
            const queryStart = exclamationPosition + 1;
            const queryEnd = cursorPosition + char.length;
            const newQuery = inputText.substring(queryStart, queryEnd);
            updateBashHistorySearchQuery(newQuery);
          }
        }
      }
    },
    [
      inputText,
      cursorPosition,
      sendMessage,
      clearInput,
      resetHistoryNavigation,
      showFileSelector,
      showCommandSelector,
      showBashHistorySelector,
      handleCancelFileSelect,
      handleCancelCommandSelect,
      handleCancelBashHistorySelect,
      deleteCharAtCursor,
      checkForAtDeletion,
      checkForSlashDeletion,
      checkForExclamationDeletion,
      moveCursorLeft,
      moveCursorRight,
      moveCursorToStart,
      moveCursorToEnd,
      navigateHistory,
      setInputText,
      setCursorPosition,
      insertTextAtCursor,
      activateFileSelector,
      activateCommandSelector,
      activateBashHistorySelector,
      atPosition,
      slashPosition,
      exclamationPosition,
      updateSearchQuery,
      updateCommandSearchQuery,
      updateBashHistorySearchQuery,
      attachedImages,
      clearImages,
      handlePasteImage,
      activateMemoryTypeSelector,
      isLoading,
      isCommandRunning,
    ],
  );

  useInput((input, key) => {
    // 处理中断请求 - 使用 Esc 键中断AI请求或命令
    if (key.escape && (isLoading || isCommandRunning)) {
      // 统一中断AI消息生成和命令执行
      if (typeof abortMessage === "function") {
        abortMessage();
      }
      return;
    }

    // 在 loading 或命令运行期间，除了 Esc 键以外，其他输入操作继续正常处理
    // 但会在 handleNormalInput 中阻止回车提交

    if (
      showFileSelector ||
      showCommandSelector ||
      showBashHistorySelector ||
      showMemoryTypeSelector
    ) {
      if (showMemoryTypeSelector) {
        // 记忆类型选择器不需要处理输入，由组件自己处理
        return;
      }
      handleSelectorInput(input, key);
    } else {
      handleNormalInput(input, key);
    }
  });

  return {
    handleFileSelect: useCallback(
      (filePath: string) => {
        const { newInput, newCursorPosition } = handleFileSelect(
          filePath,
          inputText,
          cursorPosition,
        );
        setInputText(newInput);
        setCursorPosition(newCursorPosition);
      },
      [
        handleFileSelect,
        inputText,
        cursorPosition,
        setInputText,
        setCursorPosition,
      ],
    ),

    handleCommandSelect: useCallback(
      (command: string) => {
        const { newInput, newCursorPosition } = handleCommandSelect(
          command,
          inputText,
          cursorPosition,
        );
        setInputText(newInput);
        setCursorPosition(newCursorPosition);
      },
      [
        handleCommandSelect,
        inputText,
        cursorPosition,
        setInputText,
        setCursorPosition,
      ],
    ),

    handleCommandGenerated: useCallback(
      (generatedCommand: string) => {
        const { newInput, newCursorPosition } =
          handleCommandGenerated(generatedCommand);
        setInputText(newInput);
        setCursorPosition(newCursorPosition);
      },
      [handleCommandGenerated, setInputText, setCursorPosition],
    ),

    handleBashHistorySelect: useCallback(
      (command: string) => {
        const { newInput, newCursorPosition } = handleBashHistorySelect(
          command,
          inputText,
          cursorPosition,
        );
        setInputText(newInput);
        setCursorPosition(newCursorPosition);
      },
      [
        handleBashHistorySelect,
        inputText,
        cursorPosition,
        setInputText,
        setCursorPosition,
      ],
    ),

    handleMemoryTypeSelect: useCallback(
      async (type: "project" | "user") => {
        const currentMessage = inputText.trim();
        if (currentMessage.startsWith("#")) {
          await saveMemory(currentMessage, type);
        }
        // 调用来自useMemoryTypeSelector的处理函数来关闭选择器
        handleMemoryTypeSelect(type);
        // 清空输入框
        clearInput();
      },
      [inputText, saveMemory, handleMemoryTypeSelect, clearInput],
    ),
  };
};
