import { describe, it, expect } from "vitest";
import {
  describePluginSource,
  isGitUrl,
  parsePluginSource,
} from "../../src/utils/pluginSource.js";

describe("pluginSource", () => {
  describe("isGitUrl", () => {
    it("should recognize the four Git URL prefixes", () => {
      expect(isGitUrl("http://example.com/a.git")).toBe(true);
      expect(isGitUrl("https://example.com/a.git")).toBe(true);
      expect(isGitUrl("git@github.com:a/b.git")).toBe(true);
      expect(isGitUrl("ssh://git@example.com/a.git")).toBe(true);
    });

    it("should treat relative marketplace paths as local", () => {
      expect(isGitUrl("plugins/foo")).toBe(false);
      expect(isGitUrl("./foo")).toBe(false);
    });
  });

  describe("parsePluginSource - string form", () => {
    it("should parse a plain Git URL", () => {
      expect(parsePluginSource("https://github.com/a/b.git")).toEqual({
        kind: "git",
        url: "https://github.com/a/b.git",
      });
    });

    it("should split the #ref suffix off a Git URL", () => {
      expect(parsePluginSource("https://github.com/a/b.git#v1.2.0")).toEqual({
        kind: "git",
        url: "https://github.com/a/b.git",
        ref: "v1.2.0",
      });
    });

    it("should drop the ref when the fragment is empty", () => {
      expect(parsePluginSource("https://github.com/a/b.git#")).toEqual({
        kind: "git",
        url: "https://github.com/a/b.git",
        ref: undefined,
      });
    });

    it("should parse a relative path as a local source", () => {
      expect(parsePluginSource("plugins/foo")).toEqual({
        kind: "local",
        path: "plugins/foo",
      });
    });

    it("should return undefined for empty or whitespace-only strings", () => {
      // 空 source 是坏条目，只让该条目失败，不拖垮整个市场清单（A-021）
      expect(parsePluginSource("")).toBeUndefined();
      expect(parsePluginSource("   ")).toBeUndefined();
    });
  });

  describe("parsePluginSource - object form", () => {
    it("should parse {source:'url'} as a whole-repo Git source", () => {
      expect(
        parsePluginSource({ source: "url", url: "https://github.com/a/b.git" }),
      ).toEqual({ kind: "git", url: "https://github.com/a/b.git" });
    });

    it("should parse {source:'git-subdir'} with its path", () => {
      expect(
        parsePluginSource({
          source: "git-subdir",
          url: "https://github.com/a/b.git",
          path: "plugins/foo",
        }),
      ).toEqual({
        kind: "git",
        url: "https://github.com/a/b.git",
        subdir: "plugins/foo",
      });
    });

    it("should carry ref and sha through", () => {
      expect(
        parsePluginSource({
          source: "git-subdir",
          url: "https://github.com/a/b.git",
          path: "plugins/foo",
          ref: "main",
          sha: "abc123",
        }),
      ).toEqual({
        kind: "git",
        url: "https://github.com/a/b.git",
        ref: "main",
        sha: "abc123",
        subdir: "plugins/foo",
      });
    });

    it("should require a path for git-subdir", () => {
      expect(
        parsePluginSource({
          source: "git-subdir",
          url: "https://github.com/a/b.git",
        }),
      ).toBeUndefined();
      expect(
        parsePluginSource({
          source: "git-subdir",
          url: "https://github.com/a/b.git",
          path: "   ",
        }),
      ).toBeUndefined();
    });

    it("should require a non-empty url", () => {
      expect(parsePluginSource({ source: "url" })).toBeUndefined();
      expect(parsePluginSource({ source: "url", url: "" })).toBeUndefined();
    });

    it("should reject unknown source declarations", () => {
      expect(
        parsePluginSource({ source: "npm", url: "https://example.com/a" }),
      ).toBeUndefined();
    });

    it("should return undefined for non-string non-object values", () => {
      expect(parsePluginSource(42)).toBeUndefined();
      expect(parsePluginSource(null)).toBeUndefined();
      expect(parsePluginSource(undefined)).toBeUndefined();
    });
  });

  describe("describePluginSource", () => {
    it("should render strings as quoted JSON", () => {
      expect(describePluginSource("plugins/foo")).toBe('"plugins/foo"');
    });

    it("should render objects as JSON", () => {
      expect(describePluginSource({ source: "npm" })).toBe('{"source":"npm"}');
    });

    it("should truncate long JSON so error messages stay readable", () => {
      const described = describePluginSource({
        source: "npm",
        url: "x".repeat(500),
      });
      expect(described).toHaveLength(201);
      expect(described.endsWith("…")).toBe(true);
    });
  });
});
