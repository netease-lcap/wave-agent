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
  fileManager: FileManager | null;
  syncFilesFromDisk: () => Promise<void>;
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
}

export const FileProvider: React.FC<FileProviderProps> = ({
  workdir,
  children,
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

    const fileManager = new FileManager(workdir, callbacks);
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
  }, [workdir]);

  // Update file manager when workdir changes
  useEffect(() => {
    if (fileManagerRef.current) {
      fileManagerRef.current.updateFileFilter(workdir);
    }
  }, [workdir]);

  const syncFilesFromDisk = useCallback(async () => {
    if (fileManagerRef.current) {
      await fileManagerRef.current.syncFilesFromDisk();
    }
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
        fileManager: fileManagerRef.current,
        syncFilesFromDisk,
        setFlatFiles: setFlatFilesWrapper,
      }}
    >
      {children}
    </FileContext.Provider>
  );
};
