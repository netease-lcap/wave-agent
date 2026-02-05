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

    it("should return true if target doesn't exist but its parent is inside", () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => {
        if (p.toString() === path.resolve("/a/b")) return "/a/b";
        if (p.toString() === path.resolve("/a/b/new"))
          throw new Error("ENOENT");
        return p.toString();
      });
      expect(isPathInside("/a/b/new", "/a/b")).toBe(true);
    });

    it("should return false if target doesn't exist and its parent is outside", () => {
      vi.mocked(fs.realpathSync).mockImplementation((p) => {
        if (p.toString() === path.resolve("/a/b")) return "/a/b";
        if (p.toString() === path.resolve("/a/c")) return "/a/c";
        if (p.toString() === path.resolve("/a/c/new"))
          throw new Error("ENOENT");
        return p.toString();
      });
      expect(isPathInside("/a/c/new", "/a/b")).toBe(false);
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

    it("should return false if an error occurs during resolution", () => {
      vi.mocked(fs.realpathSync).mockImplementation(() => {
        throw new Error("Unexpected error");
      });
      // Since getSafeRealPath is recursive, we need to be careful.
      // But if it throws at the root or something unexpected happens, it should return false.
      expect(isPathInside("/a/b", "/c/d")).toBe(false);
    });
  });
});
