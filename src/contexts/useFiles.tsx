import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { FileManager, FileManagerCallbacks } from "../services/fileManager";
import type { FileTreeNode } from "../types/common";

export interface FileContextType {
  flatFiles: FileTreeNode[];
  workdir: string;
  syncFilesFromDisk: () => Promise<void>;
  readFileFromMemory: (path: string) => string | null;
  writeFileToMemory: (path: string, content: string) => void;
  deleteFileFromMemory: (path: string) => void;
  createFileInMemory: (
    path: string,
    isDirectory: boolean,
    content?: string,
  ) => void;
  setFlatFiles: React.Dispatch<React.SetStateAction<FileTreeNode[]>>;
}

const FileContext = createContext<FileContextType | null>(null);

export const useFiles = () => {
  const context = useContext(FileContext);
  if (!context) {
    throw new Error("useFiles must be used within FileProvider");
  }
  return context;
};

export interface FileProviderProps {
  workdir: string;
  children: React.ReactNode;
  ignore?: string[];
}

export const FileProvider: React.FC<FileProviderProps> = ({
  workdir,
  children,
  ignore: ignorePatterns,
}) => {
  const [flatFiles, setFlatFiles] = useState<FileTreeNode[]>([]);
  const fileManagerRef = useRef<FileManager | null>(null);

  // Initialize file manager
  useEffect(() => {
    const callbacks: FileManagerCallbacks = {
      onFlatFilesChange: (files) => {
        setFlatFiles([...files]);
      },
    };

    const fileManager = new FileManager(workdir, callbacks, ignorePatterns);
    fileManagerRef.current = fileManager;

    // Initialize and start watching
    const initializeFileManager = async () => {
      try {
        await fileManager.initialize();
        fileManager.startWatching();
      } catch (error) {
        console.error("Failed to initialize file manager:", error);
      }
    };

    initializeFileManager();

    // Cleanup on unmount
    return () => {
      if (fileManagerRef.current) {
        fileManagerRef.current.cleanup();
      }
    };
  }, [workdir, ignorePatterns]);

  // Update file manager when workdir or ignore patterns change
  useEffect(() => {
    if (fileManagerRef.current) {
      fileManagerRef.current.updateFileFilter(workdir, ignorePatterns);
    }
  }, [workdir, ignorePatterns]);

  const syncFilesFromDisk = useCallback(async () => {
    if (fileManagerRef.current) {
      await fileManagerRef.current.syncFilesFromDisk();
    }
  }, []);

  const writeFileToMemory = useCallback((filePath: string, content: string) => {
    if (fileManagerRef.current) {
      fileManagerRef.current.writeFileToMemory(filePath, content);
    }
  }, []);

  const createFileInMemory = useCallback(
    (targetPath: string, isDirectory: boolean, content?: string) => {
      if (fileManagerRef.current) {
        fileManagerRef.current.createFileInMemory(
          targetPath,
          isDirectory,
          content,
        );
      }
    },
    [],
  );

  const deleteFileFromMemory = useCallback((filePath: string): void => {
    if (fileManagerRef.current) {
      fileManagerRef.current.deleteFileFromMemory(filePath);
    }
  }, []);

  const readFileFromMemory = useCallback((path: string): string | null => {
    if (fileManagerRef.current) {
      return fileManagerRef.current.readFileFromMemory(path);
    }
    return null;
  }, []);

  // Custom setFlatFiles that updates the file manager
  const setFlatFilesWrapper = useCallback(
    (files: FileTreeNode[] | ((prev: FileTreeNode[]) => FileTreeNode[])) => {
      if (fileManagerRef.current) {
        if (typeof files === "function") {
          const currentFiles = fileManagerRef.current.getFlatFiles();
          const newFiles = files(currentFiles);
          fileManagerRef.current.setFlatFiles(newFiles);
        } else {
          fileManagerRef.current.setFlatFiles(files);
        }
      }
    },
    [],
  );

  return (
    <FileContext.Provider
      value={{
        flatFiles,
        workdir,
        syncFilesFromDisk,
        readFileFromMemory,
        writeFileToMemory,
        deleteFileFromMemory,
        createFileInMemory,
        setFlatFiles: setFlatFilesWrapper,
      }}
    >
      {children}
    </FileContext.Provider>
  );
};
