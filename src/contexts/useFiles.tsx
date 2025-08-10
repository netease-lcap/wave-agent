import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { isBinary } from '../types/common';
import type { FileTreeNode } from '../types/common';
import * as fs from 'fs';
import * as path from 'path';
import chokidar, { FSWatcher } from 'chokidar';
import { createFileFilter } from '../utils/fileFilter';
import { flattenFiles } from '../utils/flattenFiles';
import { scanDirectory } from '../utils/scanDirectory';
import { mcpToolManager } from '../utils/mcpToolManager';
import { logger } from '../utils/logger';

export interface FileContextType {
  flatFiles: FileTreeNode[];
  workdir: string;
  syncFilesFromDisk: () => Promise<void>;
  readFileFromMemory: (path: string) => string | null;
  writeFileToMemory: (path: string, content: string) => void;
  deleteFileFromMemory: (path: string) => void;
  createFileInMemory: (path: string, isDirectory: boolean, content?: string) => void;
  setFlatFiles: React.Dispatch<React.SetStateAction<FileTreeNode[]>>;
}

const FileContext = createContext<FileContextType | null>(null);

export const useFiles = () => {
  const context = useContext(FileContext);
  if (!context) {
    throw new Error('useFiles must be used within FileProvider');
  }
  return context;
};

export interface FileProviderProps {
  workdir: string;
  children: React.ReactNode;
  ignore?: string[];
}

export const FileProvider: React.FC<FileProviderProps> = ({ workdir, children, ignore: ignorePatterns }) => {
  const [flatFiles, setFlatFiles] = useState<FileTreeNode[]>([]);
  const watcherRef = useRef<FSWatcher | null>(null);
  const fileFilterRef = useRef(createFileFilter(workdir, ignorePatterns));

  // Update file filter when workdir or ignore patterns change
  useEffect(() => {
    fileFilterRef.current = createFileFilter(workdir, ignorePatterns);
  }, [workdir, ignorePatterns]);

  const syncFilesFromDisk = useCallback(async () => {
    try {
      const fileTree = await scanDirectory(workdir, fileFilterRef.current);
      const flatFilesResult = flattenFiles(fileTree);
      setFlatFiles(flatFilesResult);
    } catch (error) {
      logger.error('Error syncing files from disk:', error);
      setFlatFiles([]);
    }
  }, [workdir]);

  // 写入文件内容到内存中的文件树（不会写入磁盘）
  const writeFileToMemory = useCallback((filePath: string, content: string) => {
    // 直接更新flatFiles中的对应文件
    setFlatFiles((prevFlatFiles) => {
      return prevFlatFiles.map((file) => (file.path === filePath ? { ...file, code: content } : file));
    });
  }, []);

  // 添加文件到树中
  const createFileInMemory = useCallback(
    (targetPath: string, isDirectory: boolean, content?: string) => {
      try {
        const fullPath = path.join(workdir, targetPath);

        // Check if should be ignored
        if (fileFilterRef.current.shouldIgnore(fullPath, isDirectory)) {
          return;
        }

        if (!isDirectory) {
          // 对于二进制文件，不设置内容，只添加文件节点
          const fileContent = isBinary(targetPath) ? '' : content || '';

          // 直接添加到flatFiles中
          setFlatFiles((prevFlatFiles) => {
            // 检查文件是否已存在，如果存在则更新，否则添加
            const existingIndex = prevFlatFiles.findIndex((f) => f.path === targetPath);
            if (existingIndex >= 0) {
              const newFlatFiles = [...prevFlatFiles];
              newFlatFiles[existingIndex] = {
                ...newFlatFiles[existingIndex],
                code: fileContent,
                isBinary: isBinary(targetPath),
              };
              return newFlatFiles;
            } else {
              return [
                ...prevFlatFiles,
                {
                  label: path.basename(targetPath),
                  path: targetPath,
                  code: fileContent,
                  children: [],
                  isBinary: isBinary(targetPath),
                },
              ];
            }
          });
        }
        // 目录不需要添加到flatFiles中
      } catch (error) {
        logger.error('Error adding file to tree:', error);
      }
    },
    [workdir],
  );

  // 从内存中的文件树删除文件（不会删除磁盘文件）
  const deleteFileFromMemory = useCallback((filePath: string): void => {
    // 直接从flatFiles中删除相关文件
    setFlatFiles((prevFlatFiles) => {
      return prevFlatFiles.filter((file) => !file.path.startsWith(filePath + '/') && file.path !== filePath);
    });
  }, []);

  // Setup initial file scan and MCP initialization
  useEffect(() => {
    const initializeAll = async () => {
      await syncFilesFromDisk();

      // Initialize MCP tools
      try {
        await mcpToolManager.initialize(workdir);
      } catch (error) {
        logger.warn('Failed to initialize MCP tools:', error instanceof Error ? error.name : 'Unknown error');
      }
    };

    initializeAll();
  }, [syncFilesFromDisk, workdir]);

  // Setup file watcher
  useEffect(() => {
    const watcher = chokidar.watch(workdir, {
      ignored: (filePath) => {
        return fileFilterRef.current.shouldIgnore(
          filePath,
          fs.existsSync(filePath) && fs.statSync(filePath).isDirectory(),
        );
      },
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    watcher
      .on('add', async (filePath) => {
        const relativePath = path.relative(workdir, filePath);
        logger.debug(`File ${relativePath} has been added`);

        try {
          if (isBinary(relativePath)) {
            // 对于二进制文件，不读取内容，只添加节点
            createFileInMemory(relativePath, false, '');
          } else {
            // 对于文本文件，读取内容
            const content = await fs.promises.readFile(filePath, 'utf-8');
            createFileInMemory(relativePath, false, content);
          }
        } catch (error) {
          logger.error('Error reading added file:', error);
        }
      })
      .on('change', async (filePath) => {
        const relativePath = path.relative(workdir, filePath);
        logger.debug(`File ${relativePath} has been changed`);

        try {
          if (isBinary(relativePath)) {
            // 对于二进制文件，不读取内容，只更新节点（但内容保持为空）
            writeFileToMemory(relativePath, '');
          } else {
            // 对于文本文件，读取内容
            const content = await fs.promises.readFile(filePath, 'utf-8');
            writeFileToMemory(relativePath, content);
          }
        } catch (error) {
          logger.error('Error reading changed file:', error);
        }
      })
      .on('unlink', (filePath) => {
        const relativePath = path.relative(workdir, filePath);
        logger.debug(`File ${relativePath} has been removed`);
        deleteFileFromMemory(relativePath);
      })
      .on('addDir', (dirPath) => {
        const relativePath = path.relative(workdir, dirPath);
        logger.debug(`Directory ${relativePath} has been added`);
        createFileInMemory(relativePath, true);
      })
      .on('unlinkDir', (dirPath) => {
        const relativePath = path.relative(workdir, dirPath);
        logger.debug(`Directory ${relativePath} has been removed`);
        deleteFileFromMemory(relativePath);
      })
      .on('error', (error) => {
        logger.error(`Watcher error: ${error}`);
      });

    watcherRef.current = watcher;

    return () => {
      if (watcherRef.current) {
        watcherRef.current.close();
        watcherRef.current = null;
      }
    };
  }, [workdir, createFileInMemory, writeFileToMemory, deleteFileFromMemory]);

  // Cleanup MCP connections when component unmounts
  useEffect(() => {
    return () => {
      mcpToolManager.disconnect().catch((error) => {
        logger.error('Error disconnecting MCP tools:', error);
      });
    };
  }, []);

  // 从内存中的文件树读取文件内容（不会访问磁盘）
  const readFileFromMemory = useCallback((path: string): string | null => {
    let result: string | null = null;

    setFlatFiles((currentFlatFiles) => {
      const file = currentFlatFiles.find((f) => f.path === path);
      result = file ? file.code : null;
      return currentFlatFiles;
    });

    return result;
  }, []);

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
        setFlatFiles,
      }}
    >
      {children}
    </FileContext.Provider>
  );
};
