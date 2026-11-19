import { describe, expect, it } from "vitest";
import type { ParsedCommandElement } from "../../../src/utils/powershellStructure/types.js";
import {
  extractPathArguments,
  isReadOnlyCmdlet,
} from "../../../src/tools/powershellTool/readOnly.js";

function leaf(name: string, args: string[] = []): ParsedCommandElement {
  return {
    name,
    nameType: "unknown",
    elementType: "CommandAst",
    args,
    text: [name, ...args].join(" "),
  };
}

describe("isReadOnlyCmdlet", () => {
  it("should accept the read cmdlets", () => {
    expect(isReadOnlyCmdlet("Get-ChildItem")).toBe(true);
    expect(isReadOnlyCmdlet("Get-Content")).toBe(true);
    expect(isReadOnlyCmdlet("Test-Path")).toBe(true);
    expect(isReadOnlyCmdlet("Select-String")).toBe(true);
  });

  it("should accept them through their aliases", () => {
    expect(isReadOnlyCmdlet("ls")).toBe(true);
    expect(isReadOnlyCmdlet("cat")).toBe(true);
    expect(isReadOnlyCmdlet("pwd")).toBe(true);
    expect(isReadOnlyCmdlet("sls")).toBe(true);
  });

  it("should accept a module-qualified name", () => {
    expect(
      isReadOnlyCmdlet("Microsoft.PowerShell.Management\\Get-ChildItem"),
    ).toBe(true);
  });

  it("should reject anything that writes, spawns or executes", () => {
    expect(isReadOnlyCmdlet("Set-Content")).toBe(false);
    expect(isReadOnlyCmdlet("Out-File")).toBe(false);
    expect(isReadOnlyCmdlet("Remove-Item")).toBe(false);
    expect(isReadOnlyCmdlet("Start-Process")).toBe(false);
    expect(isReadOnlyCmdlet("Invoke-Expression")).toBe(false);
  });

  it("should reject cmdlets whose arguments are code", () => {
    // `ForEach-Object { Remove-Item x }` reads nothing worth trusting.
    expect(isReadOnlyCmdlet("ForEach-Object")).toBe(false);
    expect(isReadOnlyCmdlet("Invoke-Item")).toBe(false);
  });

  it("should reject an application however it is spelled", () => {
    expect(isReadOnlyCmdlet(".\\script.ps1")).toBe(false);
    expect(isReadOnlyCmdlet("C:\\tools\\x.exe")).toBe(false);
    expect(isReadOnlyCmdlet("git")).toBe(false);
  });

  it("should not resolve an ambiguous alias into a read-only cmdlet", () => {
    // `sort` and `sc` are deliberately absent from COMMON_ALIASES: one edition
    // runs the cmdlet, the other runs the .exe.
    expect(isReadOnlyCmdlet("sort")).toBe(false);
    expect(isReadOnlyCmdlet("sc")).toBe(false);
  });
});

describe("extractPathArguments", () => {
  it("should take the positional arguments of a path-taking cmdlet", () => {
    expect(extractPathArguments(leaf("Get-Content", ["./a.txt"]))).toEqual([
      "./a.txt",
    ]);
    expect(extractPathArguments(leaf("Get-ChildItem", ["src", "lib"]))).toEqual(
      ["src", "lib"],
    );
  });

  it("should take the bound value of -Path and -LiteralPath", () => {
    expect(
      extractPathArguments(leaf("Get-Content", ["-Path", "a.txt"])),
    ).toEqual(["a.txt"]);
    expect(
      extractPathArguments(leaf("Get-Item", ["-LiteralPath:C:\\x"])),
    ).toEqual(["C:\\x"]);
  });

  it("should not treat Select-String's pattern as a path", () => {
    expect(
      extractPathArguments(leaf("Select-String", ["TODO", "src/a.ts"])),
    ).toEqual(["src/a.ts"]);
  });

  it("should ignore flags", () => {
    expect(
      extractPathArguments(leaf("Get-ChildItem", ["-Recurse", "src"])),
    ).toEqual(["src"]);
  });

  it("should return nothing for a cmdlet that takes no paths", () => {
    expect(extractPathArguments(leaf("Get-Date"))).toEqual([]);
    expect(extractPathArguments(leaf("Get-Process", ["pwsh"]))).toEqual([]);
  });
});
