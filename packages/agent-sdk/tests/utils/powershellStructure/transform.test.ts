import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  classifyCommandName,
  ensureArray,
  mapElementType,
  mapStatementType,
  stripModulePrefix,
  transformCommandAst,
  transformRawOutput,
  transformRedirection,
  transformStatement,
} from "../../../src/utils/powershellStructure/transform.js";
import type {
  ParsedPowerShellCommand,
  RawParsedOutput,
} from "../../../src/utils/powershellStructure/types.js";

/**
 * Real output, captured by running the actual parse script through
 * Windows PowerShell 5.1 (`5.1.26100.9818`) on 2026-11-18 and feeding the
 * result through `transformRawOutput`. Regenerate deliberately, not
 * automatically: these are fixtures, not snapshots — a diff means "the parser
 * or the shell changed", and that is a question to answer, not to accept.
 *
 * Each entry holds both layers, so the file pins the wire format *and* what we
 * make of it:
 *   raw    — the JSON the PowerShell script printed (the real .NET AST)
 *   parsed — `transformRawOutput(raw, command)`
 */
interface Fixture {
  id: string;
  command: string;
  raw: RawParsedOutput;
  parsed: ParsedPowerShellCommand;
}

const FIXTURES: Fixture[] = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/parseFixtures.json", import.meta.url)),
    "utf8",
  ),
) as Fixture[];

function fixture(id: string): Fixture {
  const found = FIXTURES.find((entry) => entry.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
}

/** Command names of every statement, in statement order. */
function statementCommands(parsed: ParsedPowerShellCommand): string[] {
  return parsed.statements.flatMap((statement) =>
    statement.commands.map((command) => command.name),
  );
}

/** Every command nested inside a statement, in source order. */
function nestedCommands(parsed: ParsedPowerShellCommand): string[] {
  return parsed.statements.flatMap(
    (statement) =>
      statement.nestedCommands?.map((command) => command.name) ?? [],
  );
}

describe("real parse fixtures", () => {
  it("has one fixture per captured command", () => {
    expect(FIXTURES.length).toBe(40);
    expect(new Set(FIXTURES.map((entry) => entry.id)).size).toBe(
      FIXTURES.length,
    );
  });

  it.each(FIXTURES.map((entry) => [entry.id, entry] as const))(
    "reproduces %s from its recorded AST",
    (_id, entry) => {
      const parsed = transformRawOutput(entry.raw, entry.command);

      expect(parsed).toEqual(entry.parsed);
      // Ours, not the echoed copy, so the two can never disagree.
      expect(parsed.originalCommand).toBe(entry.command);
    },
  );
});

describe("statements", () => {
  it("keeps a pipeline's elements as its commands", () => {
    const parsed = fixture("pipeline-scriptblock").parsed;

    expect(statementCommands(parsed)).toEqual([
      "Get-Process",
      "Where-Object",
      "Select-Object",
    ]);
    expect(nestedCommands(parsed)).toEqual([]);
  });

  it("puts control-flow bodies in nestedCommands, not commands", () => {
    // The security-relevant point: `if` is not a pipeline, so its body is not
    // in `commands`. A caller that only reads `commands` sees nothing here.
    const parsed = fixture("if-body").parsed;

    expect(parsed.statements[0].statementType).toBe("IfStatementAst");
    expect(statementCommands(parsed)).toEqual([]);
    expect(nestedCommands(parsed)).toEqual([
      "Test-Path",
      "Remove-Item",
      "Write-Output",
    ]);
  });

  it("collects a function body and its call site", () => {
    const parsed = fixture("function-def").parsed;

    expect(
      parsed.statements.map((statement) => statement.statementType),
    ).toEqual(["FunctionDefinitionAst", "PipelineAst"]);
    expect(nestedCommands(parsed)).toEqual(["Remove-Item"]);
    expect(statementCommands(parsed)).toEqual(["f"]);
  });

  it("appends the param block when it hides a command", () => {
    // `param($Path = (Remove-Item /)) Get-Process` — without this statement the
    // only visible command is `Get-Process`.
    const parsed = fixture("param-default").parsed;

    expect(statementCommands(parsed)).toEqual(["Get-Process"]);
    const paramBlock = parsed.statements.find(
      (statement) => statement.statementType === "ParamBlockAst",
    );
    expect(paramBlock?.nestedCommands?.map((command) => command.name)).toEqual([
      "Remove-Item",
    ]);
    expect(paramBlock?.securityPatterns).toEqual({ hasSubExpressions: true });
  });

  it("keeps a `;` chain as two statements", () => {
    const parsed = fixture("semicolon-chain").parsed;

    expect(statementCommands(parsed)).toEqual(["cd", "dir"]);
  });

  it("reports a valid parse with zero statements, which is not a safe verdict", () => {
    // `using` and `#Requires` produce no statements at all. P3c must treat
    // "zero statements" as "do not auto-allow", the way bash treats zero leaves.
    for (const id of ["using-namespace", "requires", "empty"]) {
      const parsed = fixture(id).parsed;
      expect(parsed.valid).toBe(true);
      expect(parsed.statements).toEqual([]);
    }
  });

  it("keeps the recovered AST of a syntax error, but flags it invalid", () => {
    // Windows PowerShell 5.1 has no `&&`. The parser recovers both commands,
    // so `valid` — not the command list — is what a caller must gate on.
    const parsed = fixture("syntax-error-andand").parsed;

    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toEqual([
      {
        message: expect.stringContaining("&&"),
        errorId: "InvalidEndOfLine",
      },
    ]);
    expect(statementCommands(parsed)).toEqual(["Get-ChildItem", "Remove-Item"]);
  });

  it("flags an unterminated string", () => {
    const parsed = fixture("syntax-error-unclosed").parsed;

    expect(parsed.valid).toBe(false);
    expect(parsed.errors).toHaveLength(1);
  });
});

describe("command elements", () => {
  it("classifies a cmdlet, an application and an alias", () => {
    expect(
      fixture("get-childitem").parsed.statements[0].commands[0],
    ).toMatchObject({ name: "Get-ChildItem", nameType: "cmdlet" });
    expect(
      fixture("cmd-exit-code").parsed.statements[0].commands[0],
    ).toMatchObject({ name: "cmd", nameType: "unknown" });
    expect(
      fixture("stop-parsing").parsed.statements[0].commands[0],
    ).toMatchObject({ name: "cmd.exe", nameType: "application" });
  });

  it("strips the module qualifier but not a path", () => {
    const parsed = fixture("module-qualified").parsed;

    expect(parsed.statements[0].commands[0].name).toBe("Get-ChildItem");
    expect(parsed.statements[0].commands[0].nameType).toBe("cmdlet");
  });

  it("keeps arguments as written, with flags", () => {
    const parsed = fixture("remove-root").parsed;

    expect(parsed.statements[0].commands[0].args).toEqual([
      "-Recurse",
      "-Force",
      "C:\\",
    ]);
  });

  it("marks each element's kind", () => {
    const parsed = fixture("alias-percent").parsed;
    const [ls, percent] = parsed.statements[0].commands;

    expect(ls.elementTypes).toEqual(["StringConstant"]);
    expect(percent.elementTypes).toEqual(["StringConstant", "ScriptBlock"]);
    // `%` is an alias for Where-Object, which only the runtime can resolve.
    expect(percent.nameType).toBe("unknown");
  });

  it("uses a string literal's evaluated value for arguments", () => {
    // `'single'` keeps its content; the quotes are syntax.
    const parsed = fixture("splatting").parsed;

    expect(parsed.statements[1].commands[0].args).toEqual(["@args"]);
  });

  it("gives a bare expression no command name", () => {
    const parsed = fixture("member-invocation").parsed;
    const [command] = parsed.statements[0].commands;

    expect(command.name).toBe("");
    expect(command.elementType).toBe("CommandExpressionAst");
    expect(parsed.statements[0].securityPatterns).toEqual({
      hasMemberInvocations: true,
    });
  });
});

describe("redirections", () => {
  it("keeps the operator and target of a file redirection", () => {
    const parsed = fixture("redirect-out").parsed;

    expect(parsed.statements[0].redirections).toEqual([
      { operator: ">", target: "out.txt", isMerging: false },
    ]);
  });

  it("keeps the append bit and the stream", () => {
    const parsed = fixture("redirect-append-error").parsed;

    expect(parsed.statements[0].redirections).toEqual([
      { operator: "2>>", target: "err.txt", isMerging: false },
    ]);
  });

  it("keeps both a stream merge and the file it feeds", () => {
    const parsed = fixture("redirect-merge-and-file").parsed;

    expect(parsed.statements[0].redirections).toEqual(
      expect.arrayContaining([
        { operator: ">", target: "file.txt", isMerging: false },
        { operator: "2>&1", target: "", isMerging: true },
      ]),
    );
    expect(parsed.statements[0].redirections).toHaveLength(2);
  });

  it("unquotes an expandable target and keeps the variable", () => {
    const parsed = fixture("expandable-redirect-target").parsed;

    expect(parsed.statements[0].redirections[0].target).toBe(
      "$env:TEMP\\out.txt",
    );
    expect(parsed.variables.map((variable) => variable.path)).toContain(
      "env:TEMP",
    );
  });

  it("maps every stream and append combination", () => {
    const redirection = (
      fromStream: string,
      append: boolean,
    ): ReturnType<typeof transformRedirection> =>
      transformRedirection({
        type: "FileRedirectionAst",
        append,
        fromStream,
        locationText: '"x"',
      });

    expect(redirection("Output", false)).toEqual({
      operator: ">",
      target: "x",
      isMerging: false,
    });
    expect(redirection("Output", true)?.operator).toBe(">>");
    expect(redirection("Error", false)?.operator).toBe("2>");
    expect(redirection("Error", true)?.operator).toBe("2>>");
    expect(redirection("All", false)?.operator).toBe("*>");
    expect(redirection("All", true)?.operator).toBe("*>>");
  });

  it("maps a stream merge, which has no target", () => {
    expect(
      transformRedirection({
        type: "MergingRedirectionAst",
        fromStream: "Error",
      }),
    ).toEqual({ operator: "2>&1", target: "", isMerging: true });
  });

  it("ignores a redirection node it does not know", () => {
    expect(transformRedirection({ type: "SomethingElseAst" })).toBeUndefined();
  });
});

describe("variables", () => {
  it("reports a splat as splatted", () => {
    const { variables } = fixture("splatting").parsed;

    expect(variables).toEqual([
      { path: "args", isSplatted: false },
      { path: "args", isSplatted: true },
    ]);
  });

  it("keeps the scope prefix", () => {
    expect(
      fixture("colon-bound-param").parsed.variables.map((v) => v.path),
    ).toEqual(["env:TEMP"]);
  });
});

describe("--%", () => {
  it("is detected and the rest of the line passes through verbatim", () => {
    const parsed = fixture("stop-parsing").parsed;

    expect(parsed.hasStopParsing).toBe(true);
    expect(parsed.statements[0].commands[0].args).toEqual([
      "--%",
      "/c echo one two",
    ]);
  });

  it("is not claimed for a command without it", () => {
    expect(fixture("get-childitem").parsed.hasStopParsing).toBe(false);
  });
});

describe("ensureArray", () => {
  it("unwraps PowerShell 5.1's single-element arrays", () => {
    expect(ensureArray({ a: 1 })).toEqual([{ a: 1 }]);
    expect(ensureArray([{ a: 1 }])).toEqual([{ a: 1 }]);
  });

  it("turns a missing value into an empty list", () => {
    expect(ensureArray(undefined)).toEqual([]);
    expect(ensureArray(null)).toEqual([]);
  });
});

describe("name and type mapping", () => {
  it("maps every statement name it knows", () => {
    for (const name of [
      "PipelineAst",
      "PipelineChainAst",
      "AssignmentStatementAst",
      "IfStatementAst",
      "ForStatementAst",
      "ForEachStatementAst",
      "WhileStatementAst",
      "DoWhileStatementAst",
      "DoUntilStatementAst",
      "SwitchStatementAst",
      "TryStatementAst",
      "TrapStatementAst",
      "FunctionDefinitionAst",
      "DataStatementAst",
    ]) {
      expect(mapStatementType(name)).toBe(name);
    }
  });

  it("refuses to guess an unknown statement", () => {
    expect(mapStatementType("SomethingNewAst")).toBe("UnknownStatementAst");
  });

  it("maps pipeline element names", () => {
    expect(mapElementType("CommandAst")).toBe("CommandAst");
    expect(mapElementType("CommandExpressionAst")).toBe("CommandExpressionAst");
    expect(mapElementType("ParenExpressionAst")).toBe("ParenExpressionAst");
  });

  it("classifies a name by its shape only", () => {
    expect(classifyCommandName("Get-ChildItem")).toBe("cmdlet");
    expect(classifyCommandName("cd")).toBe("unknown");
    expect(classifyCommandName("%")).toBe("unknown");
    // A bare name with an extension is an executable, not an alias to resolve.
    expect(classifyCommandName("build.ps1")).toBe("application");
    expect(classifyCommandName("./build.ps1")).toBe("application");
    expect(classifyCommandName("C:\\Windows\\System32\\cmd.exe")).toBe(
      "application",
    );
  });

  it("strips only a module qualifier", () => {
    expect(
      stripModulePrefix("Microsoft.PowerShell.Management\\Get-ChildItem"),
    ).toBe("Get-ChildItem");
    expect(stripModulePrefix(".\\build.ps1")).toBe(".\\build.ps1");
    expect(stripModulePrefix("C:\\Windows\\System32\\cmd.exe")).toBe(
      "C:\\Windows\\System32\\cmd.exe",
    );
    expect(stripModulePrefix("Get-ChildItem")).toBe("Get-ChildItem");
  });
});

describe("transformStatement", () => {
  it("does not duplicate a redirection the command already carries", () => {
    // The script reports redirections both per command and per statement.
    const statement = transformStatement({
      type: "PipelineAst",
      text: "Get-Item x > out.txt",
      elements: [
        {
          type: "CommandAst",
          text: "Get-Item x > out.txt",
          commandElements: [
            {
              type: "StringConstantExpressionAst",
              text: "Get-Item",
              value: "Get-Item",
            },
            { type: "StringConstantExpressionAst", text: "x", value: "x" },
          ],
          redirections: [
            {
              type: "FileRedirectionAst",
              append: false,
              fromStream: "Output",
              locationText: "out.txt",
            },
          ],
        },
      ],
      redirections: [
        {
          type: "FileRedirectionAst",
          append: false,
          fromStream: "Output",
          locationText: "out.txt",
        },
      ],
    });

    expect(statement.redirections).toEqual([
      { operator: ">", target: "out.txt", isMerging: false },
    ]);
  });

  it("leaves commands empty for a statement type that is not a pipeline", () => {
    const statement = transformStatement({
      type: "IfStatementAst",
      text: "if ($true) { Get-Item x }",
      nestedCommands: [
        {
          type: "CommandAst",
          text: "Get-Item x",
          commandElements: [
            {
              type: "StringConstantExpressionAst",
              text: "Get-Item",
              value: "Get-Item",
            },
            { type: "StringConstantExpressionAst", text: "x", value: "x" },
          ],
        },
      ],
    });

    expect(statement.commands).toEqual([]);
    expect(statement.nestedCommands?.map((command) => command.name)).toEqual([
      "Get-Item",
    ]);
  });

  it("copes with a single command element arriving as an object", () => {
    const command = transformCommandAst({
      type: "CommandAst",
      text: "Get-Date",
      commandElements: {
        type: "StringConstantExpressionAst",
        text: "Get-Date",
        value: "Get-Date",
      },
    } as unknown as Parameters<typeof transformCommandAst>[0]);

    expect(command.name).toBe("Get-Date");
    expect(command.args).toEqual([]);
  });
});

describe("transformRawOutput", () => {
  it("normalises an unwrapped single statement", () => {
    const parsed = transformRawOutput(
      {
        valid: true,
        errors: [],
        statements: {
          type: "PipelineAst",
          text: "Get-Date",
          elements: [
            {
              type: "CommandAst",
              text: "Get-Date",
              commandElements: {
                type: "StringConstantExpressionAst",
                text: "Get-Date",
                value: "Get-Date",
              },
            },
          ],
        },
        variables: { path: "x", isSplatted: false },
        hasStopParsing: false,
        originalCommand: "Get-Date",
      } as unknown as RawParsedOutput,
      "Get-Date",
    );

    expect(parsed.statements).toHaveLength(1);
    expect(parsed.statements[0].commands[0].name).toBe("Get-Date");
    expect(parsed.variables).toEqual([{ path: "x", isSplatted: false }]);
  });

  it("trusts only `true`, never a truthy value", () => {
    const parsed = transformRawOutput(
      {
        valid: "yes",
        hasStopParsing: 1,
      } as unknown as RawParsedOutput,
      "Get-Date",
    );

    expect(parsed.valid).toBe(false);
    expect(parsed.hasStopParsing).toBe(false);
  });
});
