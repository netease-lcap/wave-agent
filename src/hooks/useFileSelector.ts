import { useState, useCallback, useEffect, useRef } from "react";
import { glob } from "glob";
import { getGlobIgnorePatterns } from "../utils/fileFilter";

export const useFileSelector = () => {
  const [showFileSelector, setShowFileSelector] = useState(false);
  const [atPosition, setAtPosition] = useState(-1);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredFiles, setFilteredFiles] = useState<string[]>([]);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 使用 glob 搜索文件
  const searchFiles = useCallback(async (query: string) => {
    try {
      let files: string[] = [];

      if (!query.trim()) {
        // 当查询为空时，显示一些常见的文件类型
        const commonPatterns = [
          "**/*.ts",
          "**/*.tsx",
          "**/*.js",
          "**/*.jsx",
          "**/*.json",
        ];
        const promises = commonPatterns.map((pattern) =>
          glob(pattern, {
            ignore: getGlobIgnorePatterns(),
            nodir: true,
            maxDepth: 10,
            nocase: true, // 不区分大小写
          }),
        );

        const results = await Promise.all(promises);
        files = results.flat();
      } else {
        // 构建 glob 模式，支持通配符搜索
        const pattern = `**/*${query}*`;
        files = await glob(pattern, {
          ignore: getGlobIgnorePatterns(),
          nodir: true, // 只返回文件，不返回目录
          maxDepth: 10, // 限制搜索深度
          nocase: true, // 不区分大小写
        });
      }

      // 去重并限制最多显示 10 条结果
      const uniqueFiles = Array.from(new Set(files));
      setFilteredFiles(uniqueFiles.slice(0, 10));
    } catch (error) {
      console.error("Glob search error:", error);
      setFilteredFiles([]);
    }
  }, []);

  // 防抖搜索
  const debouncedSearchFiles = useCallback(
    (query: string) => {
      // 清除之前的定时器
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // 设置新的定时器，支持环境变量配置
      const debounceDelay = parseInt(
        process.env.FILE_SELECTOR_DEBOUNCE_MS || "300",
        10,
      );
      debounceTimerRef.current = setTimeout(() => {
        searchFiles(query);
      }, debounceDelay);
    },
    [searchFiles],
  );

  // 当搜索查询改变时触发防抖搜索
  useEffect(() => {
    debouncedSearchFiles(searchQuery);

    // 清理函数：组件卸载时清除定时器
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchQuery, debouncedSearchFiles]);

  const activateFileSelector = useCallback(
    (position: number) => {
      setShowFileSelector(true);
      setAtPosition(position);
      setSearchQuery("");
      // 立即触发搜索以显示初始文件列表，而不是等待防抖
      searchFiles("");
    },
    [searchFiles],
  );

  const handleFileSelect = useCallback(
    (filePath: string, inputText: string, cursorPosition: number) => {
      if (atPosition >= 0) {
        // 替换 @ 和搜索查询为选中的文件路径，移除 @ 符号
        const beforeAt = inputText.substring(0, atPosition);
        const afterQuery = inputText.substring(cursorPosition);
        const newInput = beforeAt + `${filePath} ` + afterQuery;
        const newCursorPosition = beforeAt.length + filePath.length + 1;

        setShowFileSelector(false);
        setAtPosition(-1);
        setSearchQuery("");
        setFilteredFiles([]);

        return { newInput, newCursorPosition };
      }
      return { newInput: inputText, newCursorPosition: cursorPosition };
    },
    [atPosition],
  );

  const handleCancelFileSelect = useCallback(() => {
    setShowFileSelector(false);
    setAtPosition(-1);
    setSearchQuery("");
    setFilteredFiles([]);
  }, []);

  const updateSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const checkForAtDeletion = useCallback(
    (cursorPosition: number) => {
      if (showFileSelector && cursorPosition <= atPosition) {
        handleCancelFileSelect();
        return true;
      }
      return false;
    },
    [showFileSelector, atPosition, handleCancelFileSelect],
  );

  return {
    showFileSelector,
    filteredFiles,
    searchQuery,
    activateFileSelector,
    handleFileSelect,
    handleCancelFileSelect,
    updateSearchQuery,
    checkForAtDeletion,
    atPosition,
  };
};
