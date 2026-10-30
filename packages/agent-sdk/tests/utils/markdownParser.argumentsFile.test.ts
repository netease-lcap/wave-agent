import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, statSync } from "fs";
import {
  ARGUMENTS_FILE_TOKEN,
  prepareInjectedCommands,
} from "../../src/utils/markdownParser.js";

/**
 * spec `ecosystem/agent-skills`「注入命令的参数不经 shell 传递」: the raw
 * argument string reaches an injected command as a file, so `>`, `&&`, quotes
 * and newlines in it never become shell syntax.
 */
describe("prepareInjectedCommands", () => {
  const leftovers: string[] = [];

  afterEach(() => {
    for (const path of leftovers.splice(0)) {
      rmSync(path, { force: true });
    }
  });

  it("leaves commands untouched when nothing asks for the arguments file", () => {
    const prepared = prepareInjectedCommands("Run !`gh pr view`", [
      "gh pr view",
    ]);

    expect(prepared.commands).toEqual(["gh pr view"]);
    expect(prepared.warning).toBeUndefined();
    // A no-op cleanup, so callers can run it from a `finally` unconditionally.
    expect(() => prepared.cleanup()).not.toThrow();
  });

  it("hands the arguments over verbatim, as a path inside the command", () => {
    const rawArgs = 'a > b && "c" `d` $(e)\nsecond line';
    const prepared = prepareInjectedCommands(
      `Args are at !\`${ARGUMENTS_FILE_TOKEN}\``,
      [ARGUMENTS_FILE_TOKEN],
      rawArgs,
    );
    leftovers.push(prepared.commands[0]);

    expect(prepared.commands[0]).not.toContain(ARGUMENTS_FILE_TOKEN);
    expect(readFileSync(prepared.commands[0], "utf-8")).toBe(rawArgs);
  });

  it("creates the file even when no arguments were passed", () => {
    const prepared = prepareInjectedCommands(
      `!\`cat ${ARGUMENTS_FILE_TOKEN}\``,
      [`cat ${ARGUMENTS_FILE_TOKEN}`],
      "",
    );
    const filePath = prepared.commands[0].replace("cat ", "");
    leftovers.push(filePath);

    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe("");
  });

  it("creates the file readable only by its owner", () => {
    const prepared = prepareInjectedCommands(
      `!\`${ARGUMENTS_FILE_TOKEN}\``,
      [ARGUMENTS_FILE_TOKEN],
      "secret-ish prompt text",
    );
    const filePath = prepared.commands[0];
    leftovers.push(filePath);

    if (process.platform !== "win32") {
      expect(statSync(filePath).mode & 0o777).toBe(0o600);
    }
  });

  it("resolves every occurrence in every command of one invocation", () => {
    const prepared = prepareInjectedCommands(
      `!\`a ${ARGUMENTS_FILE_TOKEN}\` !\`b ${ARGUMENTS_FILE_TOKEN} ${ARGUMENTS_FILE_TOKEN}\``,
      [
        `a ${ARGUMENTS_FILE_TOKEN}`,
        `b ${ARGUMENTS_FILE_TOKEN} ${ARGUMENTS_FILE_TOKEN}`,
      ],
      "x",
    );
    const filePath = prepared.commands[0].replace("a ", "");
    leftovers.push(filePath);

    expect(prepared.commands[0]).toBe(`a ${filePath}`);
    expect(prepared.commands[1]).toBe(`b ${filePath} ${filePath}`);
  });

  it("deletes the file on cleanup so nothing outlives the invocation", () => {
    const prepared = prepareInjectedCommands(
      `!\`${ARGUMENTS_FILE_TOKEN}\``,
      [ARGUMENTS_FILE_TOKEN],
      "x",
    );
    const filePath = prepared.commands[0];

    prepared.cleanup();

    expect(existsSync(filePath)).toBe(false);
    // Idempotent: a second cleanup (e.g. a rejected command plus a `finally`)
    // must not throw.
    expect(() => prepared.cleanup()).not.toThrow();
  });

  it("warns instead of substituting when the token sits in the prose", () => {
    const content = `Read ${ARGUMENTS_FILE_TOKEN} yourself.`;
    const prepared = prepareInjectedCommands(content, ["gh pr view"], "x");

    expect(prepared.commands).toEqual(["gh pr view"]);
    expect(prepared.warning).toContain(ARGUMENTS_FILE_TOKEN);
    expect(prepared.warning).toContain("only works inside an injected command");
  });
});
