import { useState, useCallback, useEffect, useRef } from "react";
import { glob } from "glob";
import { getGlobIgnorePatterns } from "../utils/fileFilter";
import * as fs from "fs";
import * as path from "path";
import { FileItem } from "../components/FileSelector";

export const useFileSelector = (workdir?: string) => {
  const [showFileSelector, setShowFileSelector] = useState(false);
  const [atPosition, setAtPosition] = useState(-1);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredFiles, setFilteredFiles] = useState<FileItem[]>([]);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 检查路径是否为目录
  const isDirectory = useCallback(
    (filePath: string): boolean => {
      try {
        const fullPath = workdir ? path.join(workdir, filePath) : filePath;
        return fs.statSync(fullPath).isDirectory();
      } catch {
        return false;
      }
    },
    [workdir],
  );

  // 将字符串路径转换为 FileItem 对象
  const convertToFileItems = useCallback(
    (paths: string[]): FileItem[] => {
      return paths.map((filePath) => ({
        path: filePath,
        type: isDirectory(filePath) ? "directory" : "file",
      }));
    },
    [isDirectory],
  );
  // 使用 glob 搜索文件和目录
  const searchFiles = useCallback(
    async (query: string) => {
      try {
        let files: string[] = [];
        let directories: string[] = [];

        const globOptions = {
          ignore: getGlobIgnorePatterns(),
          maxDepth: 10,
          nocase: true, // 不区分大小写
          cwd: workdir, // 指定搜索的根目录
        };

        if (!query.trim()) {
          // 当查询为空时，显示一些常见的文件类型和目录
          const commonPatterns = [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx",
            "**/*.json",
          ];

          // 搜索文件
          const filePromises = commonPatterns.map((pattern) =>
            glob(pattern, { ...globOptions, nodir: true }),
          );

          // 搜索目录（只搜索一级目录避免过多结果）
          const dirPromises = [glob("*/", { ...globOptions, maxDepth: 1 })];

          const fileResults = await Promise.all(filePromises);
          const dirResults = await Promise.all(dirPromises);

          files = fileResults.flat();
          directories = dirResults.flat().map((dir) => {
            // glob 返回字符串类型的路径，移除末尾的斜杠
            return String(dir).replace(/\/$/, "");
          });
        } else {
          // 构建多个 glob 模式来支持更灵活的搜索
          const filePatterns = [
            // 匹配文件名包含查询词的文件
            `**/*${query}*`,
            // 匹配路径中包含查询词的文件（匹配目录名）
            `**/${query}*/**/*`,
          ];

          const dirPatterns = [
            // 匹配目录名包含查询词的目录
            `**/*${query}*/`,
            // 匹配路径中包含查询词的目录
            `**/${query}*/`,
          ];

          // 搜索文件
          const filePromises = filePatterns.map((pattern) =>
            glob(pattern, { ...globOptions, nodir: true }),
          );

          // 搜索目录
          const dirPromises = dirPatterns.map((pattern) =>
            glob(pattern, { ...globOptions, nodir: false }),
          );

          const fileResults = await Promise.all(filePromises);
          const dirResults = await Promise.all(dirPromises);

          files = fileResults.flat();
          directories = dirResults.flat().map((dir) => {
            // glob 返回字符串类型的路径，移除末尾的斜杠
            return String(dir).replace(/\/$/, "");
          });
        }

        // 去重并合并文件和目录
        const uniqueFiles = Array.from(new Set(files));
        const uniqueDirectories = Array.from(new Set(directories));
        const allPaths = [...uniqueDirectories, ...uniqueFiles]; // 目录优先显示

        // 限制最多显示 10 条结果并转换为 FileItem
        const fileItems = convertToFileItems(allPaths.slice(0, 10));
        setFilteredFiles(fileItems);
      } catch (error) {
        console.error("Glob search error:", error);
        setFilteredFiles([]);
      }
    },
    [workdir, convertToFileItems],
  );

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
