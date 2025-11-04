import { extname } from "path";

/**
 * List of binary document file extensions that should not be read as text
 */
export const BINARY_DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".rtf",
] as const;

/**
 * Check if a file is a binary document format based on its extension
 * @param filePath - The path to the file
 * @returns true if the file is a binary document format, false otherwise
 */
export function isBinaryDocument(filePath: string): boolean {
  const fileExtension = extname(filePath).toLowerCase();
  return (BINARY_DOCUMENT_EXTENSIONS as readonly string[]).includes(
    fileExtension,
  );
}

/**
 * Get a human-readable error message for unsupported binary document formats
 * @param filePath - The path to the file
 * @returns Error message string
 */
export function getBinaryDocumentError(filePath: string): string {
  const fileExtension = extname(filePath).toLowerCase();
  return `Reading binary document files with extension '${fileExtension}' is not supported. Supported formats include text files, code files, images, and Jupyter notebooks.`;
}
