import { useState, useCallback, useMemo } from "react";
import { useFiles } from "../contexts/useFiles";
import { scoreAndSortFiles } from "../utils/fileScoring";

export const useFileSelector = () => {
  const [showFileSelector, setShowFileSelector] = useState(false);
  const [atPosition, setAtPosition] = useState(-1);
  const [searchQuery, setSearchQuery] = useState("");

  const { flatFiles } = useFiles();

  // 使用智能评分算法过滤和排序文件列表
  const filteredFiles = useMemo(() => {
    if (!searchQuery) {
      return flatFiles;
    }

    const scoredFiles = scoreAndSortFiles(searchQuery, flatFiles);
    // 只返回有匹配分数的文件
    return scoredFiles
      .filter((item) => item.score > 0)
      .map((item) => item.file);
  }, [flatFiles, searchQuery]);

  const activateFileSelector = useCallback((position: number) => {
    setShowFileSelector(true);
    setAtPosition(position);
    setSearchQuery("");
  }, []);

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
