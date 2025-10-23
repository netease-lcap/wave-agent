import { useState, useCallback, useEffect, useRef } from "react";
import { glob } from "glob";
import { getGlobIgnorePatterns } from "wave-agent-sdk";
import * as fs from "fs";
import * as path from "path";
import { FileItem } from "../components/FileSelector.js";

export const useFileSelector = () => {
  const [showFileSelector, setShowFileSelector] = useState(false);
  const [atPosition, setAtPosition] = useState(-1);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredFiles, setFilteredFiles] = useState<FileItem[]>([]);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Check if path is a directory
  const isDirectory = useCallback((filePath: string): boolean => {
    try {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(process.cwd(), filePath);
      return fs.statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  }, []);

  // Convert string paths to FileItem objects
  const convertToFileItems = useCallback(
    (paths: string[]): FileItem[] => {
      return paths.map((filePath) => ({
        path: filePath,
        type: isDirectory(filePath) ? "directory" : "file",
      }));
    },
    [isDirectory],
  );
  // Use glob to search files and directories
  const searchFiles = useCallback(
    async (query: string) => {
      try {
        let files: string[] = [];
        let directories: string[] = [];

        const globOptions = {
          ignore: getGlobIgnorePatterns(process.cwd()),
          maxDepth: 10,
          nocase: true, // Case insensitive
          dot: true, // Include hidden files and directories
          cwd: process.cwd(), // Specify search root directory
        };

        if (!query.trim()) {
          // When query is empty, show some common file types and directories
          const commonPatterns = [
            "**/*.ts",
            "**/*.tsx",
            "**/*.js",
            "**/*.jsx",
            "**/*.json",
          ];

          // Search files
          const filePromises = commonPatterns.map((pattern) =>
            glob(pattern, { ...globOptions, nodir: true }),
          );

          // Search directories (only search first level to avoid too many results)
          const dirPromises = [glob("*/", { ...globOptions, maxDepth: 1 })];

          const fileResults = await Promise.all(filePromises);
          const dirResults = await Promise.all(dirPromises);

          files = fileResults.flat();
          directories = dirResults.flat().map((dir) => {
            // glob returns string type paths, remove trailing slash
            return String(dir).replace(/\/$/, "");
          });
        } else {
          // Build multiple glob patterns to support more flexible search
          const filePatterns = [
            // Match files with filenames containing query
            `**/*${query}*`,
            // Match files with query in path (match directory names)
            `**/${query}*/**/*`,
          ];

          const dirPatterns = [
            // Match directory names containing query
            `**/*${query}*/`,
            // Match directories containing query in path
            `**/${query}*/`,
          ];

          // Search files
          const filePromises = filePatterns.map((pattern) =>
            glob(pattern, { ...globOptions, nodir: true }),
          );

          // Search directories
          const dirPromises = dirPatterns.map((pattern) =>
            glob(pattern, { ...globOptions, nodir: false }),
          );

          const fileResults = await Promise.all(filePromises);
          const dirResults = await Promise.all(dirPromises);

          files = fileResults.flat();
          directories = dirResults.flat().map((dir) => {
            // glob returns string type paths, remove trailing slash
            return String(dir).replace(/\/$/, "");
          });
        }

        // Deduplicate and merge files and directories
        const uniqueFiles = Array.from(new Set(files));
        const uniqueDirectories = Array.from(new Set(directories));
        const allPaths = [...uniqueDirectories, ...uniqueFiles]; // Directories first

        // Limit to maximum 10 results and convert to FileItem
        const fileItems = convertToFileItems(allPaths.slice(0, 10));
        setFilteredFiles(fileItems);
      } catch (error) {
        console.error("Glob search error:", error);
        setFilteredFiles([]);
      }
    },
    [convertToFileItems],
  );

  // Debounced search
  const debouncedSearchFiles = useCallback(
    (query: string) => {
      // Clear previous timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Set new timer, support environment variable configuration
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

  // Trigger debounced search when search query changes
  useEffect(() => {
    debouncedSearchFiles(searchQuery);

    // Cleanup function: clear timer when component unmounts
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
      // Immediately trigger search to display initial file list, without waiting for debounce
      searchFiles("");
    },
    [searchFiles],
  );

  const handleFileSelect = useCallback(
    (filePath: string, inputText: string, cursorPosition: number) => {
      if (atPosition >= 0) {
        // Replace @ and search query with selected file path, remove @ symbol
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
