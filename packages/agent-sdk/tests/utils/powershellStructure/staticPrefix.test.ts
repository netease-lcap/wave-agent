import { describe, expect, it } from "vitest";
import type {
  ParsedCommandElement,
  ParsedPowerShellCommand,
  PowerShellCommandElementType,
} from "../../../src/utils/powershellStructure/types.js";
import {
  collectCommands,
  splitCommandBoundaries,
  suggestPrefix,
  suggestRulePrefixes,
} from "../../../src/utils/powershellStructure/staticPrefix.js";

/** Flags are `Parameter`, everything else is a bare word. */
function elementTypeOf(word: string): PowerShellCommandElementType {
  return word.startsWith("-") ? "Parameter" : "StringConstant";
}

/** A `CommandAst` element as the parser would hand it over. */
function commandElement(
  name: string,
  args: string[] = [],
  elementTypes?: PowerShellCommandElementType[],
): ParsedCommandElement {
  return {
    name,
    nameType: "unknown",
    elementType: "CommandAst",
    args,
    text: [name, ...args].join(" "),
    elementTypes: elementTypes ?? [name, ...args].map(elementTypeOf),
  };
}

function parseResult(
  ...commands: ParsedCommandElement[]
): ParsedPowerShellCommand {
  return {
    valid: true,
    errors: [],
    statements: [
      {
        statementType: "PipelineAst",
        commands,
        redirections: [],
        text: commands.map((command) => command.text).join(" | "),
      },
    ],
    variables: [],
    hasStopParsing: false,
    originalCommand: commands.map((command) => command.text).join(" | "),
  };
}

describe("suggestPrefix", () => {
  it("should suggest the cmdlet name as written", () => {
    expect(suggestPrefix(commandElement("Get-Process"))).toBe("Get-Process");
    expect(suggestPrefix(commandElement("Get-ChildItem", ["-Path", "."]))).toBe(
      "Get-ChildItem",
    );
  });

  it("should suggest the canonical name for an alias", () => {
    // A persisted rule is matched later, and a canonical name cannot be
    // re-pointed by `Set-Alias ls rm` in between.
    expect(suggestPrefix(commandElement("ls"))).toBe("Get-ChildItem");
    expect(suggestPrefix(commandElement("gc", ["log.txt"]))).toBe(
      "Get-Content",
    );
  });

  it("should drop the module qualifier", () => {
    expect(
      suggestPrefix(
        commandElement("Microsoft.PowerShell.Management\\Get-ChildItem"),
      ),
    ).toBe("Get-ChildItem");
  });

  it("should refuse a rule for destructive or code-executing cmdlets", () => {
    expect(
      suggestPrefix(commandElement("Remove-Item", ["-Recurse", "."])),
    ).toBe(null);
    expect(suggestPrefix(commandElement("rm", ["-Recurse", "."]))).toBe(null);
    expect(suggestPrefix(commandElement("iex", ["$x"]))).toBe(null);
    expect(suggestPrefix(commandElement("ForEach-Object", ["{", "}"]))).toBe(
      null,
    );
  });

  it("should refuse a rule keyed on a path", () => {
    expect(suggestPrefix(commandElement(".\\build.ps1"))).toBe(null);
    expect(
      suggestPrefix(commandElement("C:\\Windows\\System32\\cmd.exe")),
    ).toBe(null);
  });

  it("should reuse the bash rule table for external programs", () => {
    expect(suggestPrefix(commandElement("git", ["status"]))).toBe("git status");
    expect(suggestPrefix(commandElement("npm", ["run", "test"]))).toBe(
      "npm run test",
    );
  });

  it("should refuse a rule the bash extractor refuses", () => {
    // Destructive git flags and no-rule programs: `getSmartPrefix` already
    // knows these; nothing PowerShell-specific is added on top.
    expect(suggestPrefix(commandElement("git", ["push", "--force"]))).toBe(
      null,
    );
    expect(suggestPrefix(commandElement("foo", ["bar"]))).toBe(null);
  });

  it("should refuse a rule with a dynamic name", () => {
    expect(
      suggestPrefix(commandElement("$cmd", ["status"], ["Variable"])),
    ).toBe(null);
  });

  it("should refuse a rule with a dynamic argument", () => {
    expect(
      suggestPrefix(
        commandElement("git", ["$ref"], ["StringConstant", "Variable"]),
      ),
    ).toBe(null);
    expect(
      suggestPrefix(
        commandElement(
          "npm",
          ["run", "test"],
          ["StringConstant", "StringConstant", "ExpandableString"],
        ),
      ),
    ).toBe(null);
  });

  it("should ignore an element that is not a command", () => {
    const element: ParsedCommandElement = {
      name: "",
      nameType: "unknown",
      elementType: "CommandExpressionAst",
      args: [],
      text: "$x",
    };
    expect(suggestPrefix(element)).toBe(null);
  });
});

describe("collectCommands", () => {
  it("should gather pipeline elements and nested commands", () => {
    const pipeline = commandElement("Test-Path", ["x"]);
    const nested = commandElement("Remove-Item", ["x"]);
    const parsed: ParsedPowerShellCommand = {
      valid: true,
      errors: [],
      statements: [
        {
          statementType: "IfStatementAst",
          commands: [pipeline],
          nestedCommands: [nested],
          redirections: [],
          text: "if (Test-Path x) { Remove-Item x }",
        },
      ],
      variables: [],
      hasStopParsing: false,
      originalCommand: "if (Test-Path x) { Remove-Item x }",
    };

    expect(collectCommands(parsed)).toEqual([pipeline, nested]);
  });

  it("should tolerate a statement without nested commands", () => {
    expect(
      collectCommands(parseResult(commandElement("Get-Location"))),
    ).toHaveLength(1);
  });
});

describe("suggestRulePrefixes", () => {
  it("should return one prefix per distinct command", () => {
    expect(
      suggestRulePrefixes(
        parseResult(
          commandElement("git", ["status"]),
          commandElement("Get-Process"),
        ),
      ),
    ).toEqual(["git status", "Get-Process"]);
  });

  it("should deduplicate case-insensitively, keeping the first spelling", () => {
    expect(
      suggestRulePrefixes(
        parseResult(
          commandElement("Get-Process"),
          commandElement("get-process"),
          commandElement("ls"),
          commandElement("dir"),
        ),
      ),
    ).toEqual(["Get-Process", "Get-ChildItem"]);
  });

  it("should not collapse siblings down to a shared root", () => {
    // `git add` + `git commit` share only `git`, and `PowerShell(git:*)` would
    // auto-allow `git push --force` forever.
    expect(
      suggestRulePrefixes(
        parseResult(
          commandElement("git", ["add"]),
          commandElement("git", ["commit"]),
        ),
      ),
    ).toEqual(["git add", "git commit"]);
  });

  it("should return nothing when the parse failed", () => {
    expect(
      suggestRulePrefixes({
        valid: false,
        errors: [{ message: "boom", errorId: "UnexpectedToken" }],
        statements: [],
        variables: [],
        hasStopParsing: false,
        originalCommand: "Get-ChildItem (",
      }),
    ).toEqual([]);
  });

  it("should skip commands with no honest prefix", () => {
    expect(
      suggestRulePrefixes(
        parseResult(
          commandElement("Remove-Item", ["x"]),
          commandElement("./x.ps1"),
        ),
      ),
    ).toEqual([]);
  });
});

describe("splitCommandBoundaries", () => {
  it("should split a pipeline", () => {
    expect(
      splitCommandBoundaries("Get-ChildItem | Select-Object Name"),
    ).toEqual(["Get-ChildItem", "Select-Object Name"]);
  });

  it("should split on semicolons, && and ||", () => {
    expect(splitCommandBoundaries("Get-Location; Get-Date")).toEqual([
      "Get-Location",
      "Get-Date",
    ]);
    expect(splitCommandBoundaries("git status && npm test")).toEqual([
      "git status",
      "npm test",
    ]);
    expect(splitCommandBoundaries("npm test || npm run build")).toEqual([
      "npm test",
      "npm run build",
    ]);
  });

  it("should split inside braces and parentheses", () => {
    expect(
      splitCommandBoundaries("if (Test-Path x) { Remove-Item x }"),
    ).toEqual(["if", "Test-Path x", "Remove-Item x"]);
  });

  it("should split on newlines", () => {
    expect(splitCommandBoundaries("Get-Location\r\nGet-Date")).toEqual([
      "Get-Location",
      "Get-Date",
    ]);
  });

  it("should fold a backtick line continuation into one command", () => {
    expect(
      splitCommandBoundaries("Get-ChildItem `\n  | Select-Object Name"),
    ).toEqual(["Get-ChildItem", "Select-Object Name"]);
  });

  it("should keep separators inside strings", () => {
    expect(splitCommandBoundaries('Write-Output "a|b;c"')).toEqual([
      'Write-Output "a|b;c"',
    ]);
    expect(splitCommandBoundaries("Write-Output 'a|b;c'")).toEqual([
      "Write-Output 'a|b;c'",
    ]);
  });

  it("should not let an escaped quote close a double-quoted string", () => {
    expect(splitCommandBoundaries('Write-Output "a`"b|c"')).toEqual([
      'Write-Output "a`"b|c"',
    ]);
  });

  it("should treat a bare & as the call operator, not a boundary", () => {
    expect(splitCommandBoundaries("& C:\\tools\\x.exe -v")).toEqual([
      "& C:\\tools\\x.exe -v",
    ]);
  });

  it("should return nothing for empty or separator-only input", () => {
    expect(splitCommandBoundaries("")).toEqual([]);
    expect(splitCommandBoundaries("  ; |  ")).toEqual([]);
  });
});
