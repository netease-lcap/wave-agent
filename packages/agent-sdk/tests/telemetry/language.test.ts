import { describe, it, expect } from "vitest";
import { languageFromPath } from "../../src/telemetry/language.js";

describe("languageFromPath", () => {
  it("should name the language of a known extension", () => {
    expect(languageFromPath("/repo/src/app.ts")).toBe("typescript");
    expect(languageFromPath("/repo/main.go")).toBe("go");
    expect(languageFromPath("notes.md")).toBe("markdown");
  });

  it("should read the extension case-insensitively", () => {
    expect(languageFromPath("/repo/App.TSX")).toBe("typescript");
  });

  it("should read a Windows path the same way", () => {
    expect(languageFromPath("C:\\repo\\src\\app.cs")).toBe("csharp");
  });

  it("should use the last extension of a dotted name", () => {
    expect(languageFromPath("/repo/types.d.ts")).toBe("typescript");
  });

  it("should recognise files identified by name", () => {
    expect(languageFromPath("/repo/Dockerfile")).toBe("dockerfile");
    expect(languageFromPath("/repo/Makefile")).toBe("makefile");
  });

  it("should return nothing when the language cannot be named", () => {
    expect(languageFromPath(undefined)).toBeUndefined();
    expect(languageFromPath("")).toBeUndefined();
    expect(languageFromPath("/repo/LICENSE")).toBeUndefined();
    expect(languageFromPath("/repo/archive.unknownext")).toBeUndefined();
    expect(languageFromPath("/repo/trailing.")).toBeUndefined();
    // A dotfile is a name, not an extension.
    expect(languageFromPath("/repo/.gitignore")).toBeUndefined();
  });
});
