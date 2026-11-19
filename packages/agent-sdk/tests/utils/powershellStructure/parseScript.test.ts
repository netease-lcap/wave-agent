import { describe, it, expect } from "vitest";
import {
  FIXED_ARGV_OVERHEAD,
  MAX_PARSE_COMMAND_BYTES,
  PARSE_SCRIPT_BODY,
  WINDOWS_ARGV_CAP,
  buildParseScript,
  encodeCommandForScript,
  toUtf16LeBase64,
} from "../../../src/utils/powershellStructure/parseScript.js";

/** Pull the command back out of the script the way the body reads it. */
function decodeScript(script: string): string {
  const match = script.match(/^\$EncodedCommand = '([^']*)'\n/);
  if (!match) throw new Error("script does not start with $EncodedCommand");
  return Buffer.from(match[1], "base64").toString("utf8");
}

describe("toUtf16LeBase64", () => {
  it("is base64 of UTF-16LE, which is what -EncodedCommand takes", () => {
    const text = "Get-ChildItem | Where-Object { $_ }";

    const encoded = toUtf16LeBase64(text);
    const bytes = Buffer.from(encoded, "base64");

    expect(bytes.toString("utf16le")).toBe(text);
    // Two bytes per char: the reason the argv budget is 8/3 of the script size.
    expect(bytes.length).toBe(text.length * 2);
  });

  it("round-trips non-ASCII", () => {
    const text = "Get-ChildItem '中文目录'";

    expect(
      Buffer.from(toUtf16LeBase64(text), "base64").toString("utf16le"),
    ).toBe(text);
  });
});

describe("encodeCommandForScript", () => {
  it("is base64 of the UTF-8 bytes, so CJK costs 3 bytes per char", () => {
    expect(Buffer.byteLength("中文", "utf8")).toBe(6);
    expect(encodeCommandForScript("中文")).toBe(
      Buffer.from("中文", "utf8").toString("base64"),
    );
  });
});

describe("buildParseScript", () => {
  it("binds the command, then runs the body", () => {
    const script = buildParseScript("Get-Process");

    expect(script.startsWith("$EncodedCommand = '")).toBe(true);
    expect(script.endsWith(PARSE_SCRIPT_BODY)).toBe(true);
    expect(decodeScript(script)).toBe("Get-Process");
  });

  it("keeps quoting, `$`, backticks and newlines out of the argv entirely", () => {
    // Every one of these would need escaping in a `-Command` string.
    const command =
      "Get-Item 'a b'; $x = \"$(Get-Date)\"; `\nRemove-Item @args";

    const script = buildParseScript(command);

    expect(decodeScript(script)).toBe(command);
    // The raw text never appears: only its base64 does.
    expect(script).not.toContain("Remove-Item");
  });

  it("round-trips a non-ASCII command", () => {
    const command = "Write-Output '标记 “&&” 无效'";

    expect(decodeScript(buildParseScript(command))).toBe(command);
  });

  it("survives the maximum-size command without blowing the argv cap", () => {
    // The worst case the budget admits, in both byte profiles: ASCII (1 byte
    // per char in the command, 1 UTF-16LE char in the script) and CJK (3 bytes
    // per char in the command, still 1 char in the script).
    const commands = [
      "a".repeat(MAX_PARSE_COMMAND_BYTES),
      "中".repeat(Math.floor(MAX_PARSE_COMMAND_BYTES / 3)),
    ];

    for (const command of commands) {
      const argv = toUtf16LeBase64(buildParseScript(command));
      expect(argv.length + FIXED_ARGV_OVERHEAD).toBeLessThanOrEqual(
        WINDOWS_ARGV_CAP,
      );
    }
  });

  it("is not much smaller than the budget claims", () => {
    // Guards the derivation, not the exact number: if the body doubles, the
    // accepted command size must shrink rather than silently fail at spawn.
    expect(MAX_PARSE_COMMAND_BYTES).toBeGreaterThan(3000);
    expect(MAX_PARSE_COMMAND_BYTES).toBeLessThan(WINDOWS_ARGV_CAP);
  });
});

describe("PARSE_SCRIPT_BODY", () => {
  it("parses with the real PowerShell parser", () => {
    expect(PARSE_SCRIPT_BODY).toContain(
      "[System.Management.Automation.Language.Parser]::ParseInput(",
    );
  });

  it("starts with the UTF-8 output switch that keeps errors readable", () => {
    // Windows PowerShell 5.1 writes redirected output in the OEM codepage;
    // GBK trail bytes can be `\` or `"`, which would corrupt the JSON.
    expect(PARSE_SCRIPT_BODY.split("\n")[0]).toBe(
      "try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }",
    );
  });

  it("does not use `using`, which -EncodedCommand rejects mid-script", () => {
    // `buildParseScript` puts `$EncodedCommand = '…'` in front, so a `using`
    // statement here fails with UsingMustBeAtStartOfScript.
    expect(PARSE_SCRIPT_BODY).not.toMatch(/^using /m);
  });

  it("does not collect fields wave has no use for", () => {
    // Deliberately smaller than Claude Code's body: no type literals, no
    // `using` flag, no `#Requires` flag. Every unused field would cost argv
    // budget on the command itself.
    expect(PARSE_SCRIPT_BODY).not.toContain("typeLiterals");
    expect(PARSE_SCRIPT_BODY).not.toContain("hasUsingStatements");
    expect(PARSE_SCRIPT_BODY).not.toContain("hasScriptRequirements");
  });

  it("emits the JSON contract the transform reads", () => {
    for (const key of [
      "valid",
      "errors",
      "statements",
      "variables",
      "hasStopParsing",
      "originalCommand",
    ]) {
      expect(PARSE_SCRIPT_BODY).toContain(key);
    }
    expect(PARSE_SCRIPT_BODY).toContain("ConvertTo-Json -Depth 10 -Compress");
  });
});
