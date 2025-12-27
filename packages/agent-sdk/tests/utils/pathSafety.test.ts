import { describe, it, expect, vi, beforeEach } from "vitest";
import { isPathInside } from "../../src/utils/pathSafety.js";
import fs from "node:fs";
import path from "node:path";

vi.mock("node:fs");

describe("pathSafety utils", () => {
  describe("isPathInside", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should return true if target is the same as parent", () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());
      expect(isPathInside("/a/b", "/a/b")).toBe(true);
    });

    it("should return true if target is a subdirectory of parent", () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());
      expect(isPathInside("/a/b/c", "/a/b")).toBe(true);
    });

    it("should return false if target is outside parent", () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());
      expect(isPathInside("/a/c", "/a/b")).toBe(false);
    });

    it("should return false if target is parent of parent", () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());
      expect(isPathInside("/a", "/a/b")).toBe(false);
    });

    it("should handle symlinks correctly", () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => {
        if (p === path.resolve("/link")) return "/a/b/c";
        return p.toString();
      });
      expect(isPathInside("/link", "/a/b")).toBe(true);
    });

    it("should return false if fs.realpathSync throws (path doesn't exist)", () => {
      vi.mocked(fs.realpathSync).mockImplementation(() => {
        throw new Error("File not found");
      });
      expect(isPathInside("/nonexistent", "/a/b")).toBe(false);
    });

    it("should handle relative paths", () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());
      // path.resolve will use current working directory for relative paths
      expect(isPathInside("child", ".")).toBe(true);
    });

    it("should return false for paths that look similar but are not inside", () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => p.toString());
      expect(isPathInside("/a/foobar", "/a/foo")).toBe(false);
    });
  });
});
