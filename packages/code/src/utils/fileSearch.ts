import { searchFilesRipgrep, FileItem } from "wave-agent-sdk";

/**
 * Search files and directories using ripgrep
 * This is a wrapper around the SDK's searchFilesRipgrep function
 */
export const searchFiles = async (
  query: string,
  options?: {
    maxResults?: number;
    workingDirectory?: string;
    ignoreCase?: boolean;
  },
): Promise<FileItem[]> => {
  return searchFilesRipgrep(query, options);
};

// Re-export FileItem interface for backward compatibility
export type { FileItem };
