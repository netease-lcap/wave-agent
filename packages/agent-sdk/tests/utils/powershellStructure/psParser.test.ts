import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileAsyncHidden } from "../../../src/utils/execFileHidden.js";
import { getPowerShellPath } from "../../../src/utils/shell/powershellDetection.js";
import {
  DEFAULT_PARSE_TIMEOUT_MS,
  MAX_PARSE_COMMAND_BYTES,
  PARSE_CACHE_SIZE,
  getPowerShellParserCacheSize,
  parsePowerShellCommand,
  resetPowerShellParserCache,
} from "../../../src/utils/powershellStructure/psParser.js";

vi.mock("../../../src/utils/execFileHidden.js", () => ({
  execFileAsyncHidden: vi.fn(),
}));

vi.mock("../../../src/utils/shell/powershellDetection.js", () => ({
  getPowerShellPath: vi.fn(),
}));

const PWSH = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";

/** A well-formed parse script response for `Get-Date`. */
const VALID_OUTPUT = JSON.stringify({
  valid: true,
  errors: [],
  statements: [
    {
      type: "PipelineAst",
      text: "Get-Date",
      elements: [
        {
          type: "CommandAst",
          text: "Get-Date",
          commandElements: [
            {
              type: "StringConstantExpressionAst",
              text: "Get-Date",
              value: "Get-Date",
            },
          ],
        },
      ],
    },
  ],
  variables: [],
  hasStopParsing: false,
  originalCommand: "Get-Date",
});

const resolves = (stdout: string) =>
  ({ stdout, stderr: "" }) as unknown as Awaited<
    ReturnType<typeof execFileAsyncHidden>
  >;

/** node's own timeout rejection, as observed on Windows. */
const TIMEOUT = Object.assign(new Error("Command failed: killed"), {
  killed: true,
  signal: "SIGTERM" as const,
  code: null,
});
const EXIT_ONE = Object.assign(new Error("Command failed: exit 1"), {
  code: 1 as const,
  killed: false,
  signal: null,
  stderr: "boom",
});

function mockCalls(): unknown[][] {
  return vi.mocked(execFileAsyncHidden).mock.calls as unknown[][];
}

/** The command the parser asked PowerShell to parse, decoded from the argv. */
function parsedCommandFromCall(index: number): string {
  const args = mockCalls()[index][1] as string[];
  const script = Buffer.from(args[4], "base64").toString("utf16le");
  const match = script.match(/^\$EncodedCommand = '([^']*)'\n/);
  return Buffer.from(match?.[1] ?? "", "base64").toString("utf8");
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPowerShellParserCache();
  vi.mocked(getPowerShellPath).mockReturnValue(PWSH);
  vi.mocked(execFileAsyncHidden).mockResolvedValue(resolves(VALID_OUTPUT));
});

describe("parsePowerShellCommand", () => {
  it("spawns the resolved shell with -EncodedCommand", async () => {
    const result = await parsePowerShellCommand("Get-Date");

    expect(result.valid).toBe(true);
    expect(result.statements[0].commands[0].name).toBe("Get-Date");

    const [file, args, options] = mockCalls()[0] as [
      string,
      string[],
      { timeout: number },
    ];
    expect(file).toBe(PWSH);
    expect(args.slice(0, 4)).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-NoLogo",
      "-EncodedCommand",
    ]);
    expect(options.timeout).toBe(DEFAULT_PARSE_TIMEOUT_MS);
    // The command never appears as an argument, only as base64 inside the
    // encoded script.
    expect(args.join(" ")).not.toContain("Get-Date");
    expect(parsedCommandFromCall(0)).toBe("Get-Date");
  });

  it("answers a repeated command from the cache", async () => {
    const first = await parsePowerShellCommand("Get-Date");
    const second = await parsePowerShellCommand("Get-Date");

    expect(execFileAsyncHidden).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("parses each distinct command once", async () => {
    await parsePowerShellCommand("Get-Date");
    await parsePowerShellCommand("Get-Process");

    expect(execFileAsyncHidden).toHaveBeenCalledTimes(2);
  });

  it("retries a timeout once and keeps the second answer", async () => {
    vi.mocked(execFileAsyncHidden)
      .mockRejectedValueOnce(TIMEOUT)
      .mockResolvedValueOnce(resolves(VALID_OUTPUT));

    const result = await parsePowerShellCommand("Get-Date");

    expect(execFileAsyncHidden).toHaveBeenCalledTimes(2);
    expect(result.valid).toBe(true);
  });

  it("gives up after a second timeout", async () => {
    vi.mocked(execFileAsyncHidden).mockRejectedValue(TIMEOUT);

    const result = await parsePowerShellCommand("Get-Date");

    expect(execFileAsyncHidden).toHaveBeenCalledTimes(2);
    expect(result.valid).toBe(false);
    expect(result.errors[0].errorId).toBe("PwshTimeout");
    expect(result.statements).toEqual([]);
  });

  it("does not retry a failure that would repeat", async () => {
    vi.mocked(execFileAsyncHidden).mockRejectedValue(EXIT_ONE);

    const result = await parsePowerShellCommand("Get-Date");

    expect(execFileAsyncHidden).toHaveBeenCalledTimes(1);
    expect(result.errors[0].errorId).toBe("PwshError");
    expect(result.errors[0].message).toContain("boom");
  });

  it("reports a spawn failure as such", async () => {
    vi.mocked(execFileAsyncHidden).mockRejectedValue(
      Object.assign(new Error("spawn EACCES"), { code: "EACCES" }),
    );

    const result = await parsePowerShellCommand("Get-Date");

    expect(result.errors[0].errorId).toBe("PwshSpawnError");
  });

  it("treats empty output as a failure, not as an empty command", async () => {
    vi.mocked(execFileAsyncHidden).mockResolvedValue(resolves("   \n"));

    const result = await parsePowerShellCommand("Get-Date");

    expect(result.valid).toBe(false);
    expect(result.errors[0].errorId).toBe("EmptyOutput");
  });

  it("treats unparsable output as a failure", async () => {
    vi.mocked(execFileAsyncHidden).mockResolvedValue(
      resolves("PowerShell says no"),
    );

    const result = await parsePowerShellCommand("Get-Date");

    expect(result.errors[0].errorId).toBe("InvalidJson");
  });

  it("survives a rejection that is not shaped like an error", async () => {
    vi.mocked(execFileAsyncHidden).mockRejectedValue({});

    const result = await parsePowerShellCommand("Get-Date");

    expect(result.valid).toBe(false);
    expect(result.errors[0].errorId).toBe("PwshError");
  });

  it("rejects an empty command without spawning", async () => {
    const result = await parsePowerShellCommand("   ");

    expect(result.errors[0].errorId).toBe("NoInput");
    expect(execFileAsyncHidden).not.toHaveBeenCalled();
  });

  it("rejects a command longer than the argv budget without spawning", async () => {
    const result = await parsePowerShellCommand(
      "a".repeat(MAX_PARSE_COMMAND_BYTES + 1),
    );

    expect(result.errors[0].errorId).toBe("CommandTooLong");
    expect(execFileAsyncHidden).not.toHaveBeenCalled();
  });

  it("counts length in UTF-8 bytes, so CJK costs three each", async () => {
    // One third the characters, still over the budget.
    const cjk = "中".repeat(Math.floor(MAX_PARSE_COMMAND_BYTES / 3) + 1);

    const result = await parsePowerShellCommand(cjk);

    expect(result.errors[0].errorId).toBe("CommandTooLong");
    expect(execFileAsyncHidden).not.toHaveBeenCalled();
  });

  it("accepts a command exactly at the budget", async () => {
    const result = await parsePowerShellCommand(
      "a".repeat(MAX_PARSE_COMMAND_BYTES),
    );

    expect(result.valid).toBe(true);
    expect(execFileAsyncHidden).toHaveBeenCalledTimes(1);
  });

  it("reports a missing PowerShell instead of spawning", async () => {
    vi.mocked(getPowerShellPath).mockReturnValue(undefined);

    const result = await parsePowerShellCommand("Get-Date");

    expect(result.errors[0].errorId).toBe("NoPowerShell");
    expect(execFileAsyncHidden).not.toHaveBeenCalled();
  });
});

describe("parse cache", () => {
  it("evicts a transport failure so the next call can try again", async () => {
    vi.mocked(execFileAsyncHidden).mockRejectedValue(TIMEOUT);
    await parsePowerShellCommand("Get-Date");
    expect(getPowerShellParserCacheSize()).toBe(0);

    vi.mocked(execFileAsyncHidden).mockResolvedValue(resolves(VALID_OUTPUT));
    const retried = await parsePowerShellCommand("Get-Date");

    expect(retried.valid).toBe(true);
  });

  it("keeps a successful parse", async () => {
    await parsePowerShellCommand("Get-Date");

    expect(getPowerShellParserCacheSize()).toBe(1);
  });

  it("keeps a syntax error, which is a fact about the command", async () => {
    vi.mocked(execFileAsyncHidden).mockResolvedValue(
      resolves(
        JSON.stringify({
          valid: false,
          errors: [{ message: "bad", errorId: "InvalidEndOfLine" }],
          statements: [],
          variables: [],
          hasStopParsing: false,
          originalCommand: "Get-Date &&",
        }),
      ),
    );

    await parsePowerShellCommand("Get-Date &&");
    expect(getPowerShellParserCacheSize()).toBe(1);

    await parsePowerShellCommand("Get-Date &&");
    expect(execFileAsyncHidden).toHaveBeenCalledTimes(1);
  });

  it("stays bounded and drops the least recently used entry", async () => {
    // One entry over the bound: the first command must survive because it was
    // read again just before.
    for (let index = 0; index < PARSE_CACHE_SIZE; index++) {
      await parsePowerShellCommand(`Get-Date -Year ${index}`);
    }
    await parsePowerShellCommand("Get-Date -Year 0");
    await parsePowerShellCommand("Get-Date -Year extra");

    expect(getPowerShellParserCacheSize()).toBe(PARSE_CACHE_SIZE);

    const callsSoFar = vi.mocked(execFileAsyncHidden).mock.calls.length;
    await parsePowerShellCommand("Get-Date -Year 0");
    expect(execFileAsyncHidden).toHaveBeenCalledTimes(callsSoFar);

    // `-Year 1` was the least recently used one after the touch above.
    await parsePowerShellCommand("Get-Date -Year 1");
    expect(execFileAsyncHidden).toHaveBeenCalledTimes(callsSoFar + 1);
  });
});
