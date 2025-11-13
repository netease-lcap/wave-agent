import { useState, useCallback, useEffect, useRef } from "react";
import { FileItem } from "../components/FileSelector.js";
import { searchFiles as searchFilesUtil } from "../utils/fileSearch.js";

export const useFileSelector = () => {
  const [showFileSelector, setShowFileSelector] = useState(false);
  const [atPosition, setAtPosition] = useState(-1);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredFiles, setFilteredFiles] = useState<FileItem[]>([]);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Use utility function for file searching
  const searchFiles = useCallback(async (query: string) => {
    try {
      const fileItems = await searchFilesUtil(query);
      setFilteredFiles(fileItems);
    } catch (error) {
      console.error("File search error:", error);
      setFilteredFiles([]);
    }
  }, []);

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
