import { describe, it, expect } from "vitest";
import {
  isBinaryDocument,
  getBinaryDocumentError,
  BINARY_DOCUMENT_EXTENSIONS,
} from "../src/utils/fileFormat.js";

describe("fileFormat utilities", () => {
  describe("isBinaryDocument", () => {
    it("should return true for PDF files", () => {
      expect(isBinaryDocument("/path/to/document.pdf")).toBe(true);
      expect(isBinaryDocument("/path/to/document.PDF")).toBe(true);
    });

    it("should return true for Microsoft Office files", () => {
      expect(isBinaryDocument("/path/to/document.doc")).toBe(true);
      expect(isBinaryDocument("/path/to/document.docx")).toBe(true);
      expect(isBinaryDocument("/path/to/spreadsheet.xls")).toBe(true);
      expect(isBinaryDocument("/path/to/spreadsheet.xlsx")).toBe(true);
      expect(isBinaryDocument("/path/to/presentation.ppt")).toBe(true);
      expect(isBinaryDocument("/path/to/presentation.pptx")).toBe(true);
    });

    it("should return true for OpenDocument files", () => {
      expect(isBinaryDocument("/path/to/document.odt")).toBe(true);
      expect(isBinaryDocument("/path/to/spreadsheet.ods")).toBe(true);
      expect(isBinaryDocument("/path/to/presentation.odp")).toBe(true);
    });

    it("should return true for RTF files", () => {
      expect(isBinaryDocument("/path/to/document.rtf")).toBe(true);
    });

    it("should return false for text files", () => {
      expect(isBinaryDocument("/path/to/file.txt")).toBe(false);
      expect(isBinaryDocument("/path/to/file.js")).toBe(false);
      expect(isBinaryDocument("/path/to/file.ts")).toBe(false);
      expect(isBinaryDocument("/path/to/file.json")).toBe(false);
      expect(isBinaryDocument("/path/to/file.md")).toBe(false);
      expect(isBinaryDocument("/path/to/file.html")).toBe(false);
    });

    it("should return false for image files", () => {
      expect(isBinaryDocument("/path/to/image.png")).toBe(false);
      expect(isBinaryDocument("/path/to/image.jpg")).toBe(false);
      expect(isBinaryDocument("/path/to/image.gif")).toBe(false);
    });

    it("should return false for files without extensions", () => {
      expect(isBinaryDocument("/path/to/file")).toBe(false);
      expect(isBinaryDocument("/path/to/Dockerfile")).toBe(false);
    });
  });

  describe("getBinaryDocumentError", () => {
    it("should return appropriate error message for binary documents", () => {
      const error = getBinaryDocumentError("/path/to/document.pdf");
      expect(error).toContain(".pdf");
      expect(error).toContain("not supported");
      expect(error).toContain(
        "text files, code files, images, and Jupyter notebooks",
      );
    });

    it("should include the file extension in the error message", () => {
      expect(getBinaryDocumentError("/test.docx")).toContain(".docx");
      expect(getBinaryDocumentError("/test.xlsx")).toContain(".xlsx");
    });
  });

  describe("BINARY_DOCUMENT_EXTENSIONS", () => {
    it("should contain expected extensions", () => {
      expect(BINARY_DOCUMENT_EXTENSIONS).toContain(".pdf");
      expect(BINARY_DOCUMENT_EXTENSIONS).toContain(".doc");
      expect(BINARY_DOCUMENT_EXTENSIONS).toContain(".docx");
      expect(BINARY_DOCUMENT_EXTENSIONS).toContain(".xls");
      expect(BINARY_DOCUMENT_EXTENSIONS).toContain(".xlsx");
      expect(BINARY_DOCUMENT_EXTENSIONS).toContain(".ppt");
      expect(BINARY_DOCUMENT_EXTENSIONS).toContain(".pptx");
      expect(BINARY_DOCUMENT_EXTENSIONS).toContain(".odt");
      expect(BINARY_DOCUMENT_EXTENSIONS).toContain(".ods");
      expect(BINARY_DOCUMENT_EXTENSIONS).toContain(".odp");
      expect(BINARY_DOCUMENT_EXTENSIONS).toContain(".rtf");
    });
  });
});
