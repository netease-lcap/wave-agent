import { describe, it, expect } from "vitest";
import {
  splitBashCommand,
  stripEnvVars,
  stripRedirections,
} from "../../src/utils/bashParser.js";

describe("bashParser", () => {
  describe("splitBashCommand", () => {
    it("should split simple commands", () => {
      expect(splitBashCommand("ls && cd ..")).toEqual(["ls", "cd .."]);
      expect(splitBashCommand("ls ; cd ..")).toEqual(["ls", "cd .."]);
      expect(splitBashCommand("ls | grep foo")).toEqual(["ls", "grep foo"]);
      expect(splitBashCommand("ls || echo fail")).toEqual(["ls", "echo fail"]);
      expect(splitBashCommand("ls & cd ..")).toEqual(["ls", "cd .."]);
    });

    it("should handle quotes", () => {
      expect(splitBashCommand('echo "&&" && ls')).toEqual(['echo "&&"', "ls"]);
      expect(splitBashCommand("echo '||' || ls")).toEqual(["echo '||'", "ls"]);
      expect(splitBashCommand('echo ";" ; ls')).toEqual(['echo ";"', "ls"]);
    });

    it("should handle escaped characters", () => {
      expect(splitBashCommand("echo \\&& && ls")).toEqual(["echo \\&&", "ls"]);
    });

    it("should handle nested subshells recursively", () => {
      expect(splitBashCommand("(cd /tmp && ls) && pwd")).toEqual([
        "cd /tmp",
        "ls",
        "pwd",
      ]);
      expect(splitBashCommand("((cmd1 | cmd2) && cmd3)")).toEqual([
        "cmd1",
        "cmd2",
        "cmd3",
      ]);
      expect(splitBashCommand("(cd /tmp && (ls | grep foo))")).toEqual([
        "cd /tmp",
        "ls",
        "grep foo",
      ]);
    });

    it("should handle subshells with redirections and env vars", () => {
      expect(splitBashCommand("(echo foo) > out.txt")).toEqual(["echo foo"]);
      expect(
        splitBashCommand("VAR=val (echo foo && echo bar) > out.txt"),
      ).toEqual(["echo foo", "echo bar"]);
    });

    it("should handle complex combinations", () => {
      expect(
        splitBashCommand("ls | grep foo && echo done || echo failed"),
      ).toEqual(["ls", "grep foo", "echo done", "echo failed"]);
    });
  });

  describe("stripEnvVars", () => {
    it("should strip single env var", () => {
      expect(stripEnvVars("NODE_ENV=production node app.js")).toBe(
        "node app.js",
      );
    });

    it("should strip multiple env vars", () => {
      expect(stripEnvVars("VAR1=val1 VAR2=val2 cmd arg")).toBe("cmd arg");
    });

    it("should handle quoted values", () => {
      expect(stripEnvVars('VAR="val with spaces" cmd')).toBe("cmd");
      expect(stripEnvVars("VAR='val with spaces' cmd")).toBe("cmd");
    });

    it("should not strip if not at the beginning", () => {
      expect(stripEnvVars("echo VAR=val")).toBe("echo VAR=val");
    });
  });

  describe("stripRedirections", () => {
    it("should strip simple redirections", () => {
      expect(stripRedirections('echo "hello" > out.txt')).toBe('echo "hello"');
      expect(stripRedirections("cat < in.txt")).toBe("cat");
      expect(stripRedirections("ls >> out.txt")).toBe("ls");
    });

    it("should strip redirections with file descriptors", () => {
      expect(stripRedirections("ls 2> err.txt")).toBe("ls");
      expect(stripRedirections("ls 2>> err.txt")).toBe("ls");
      expect(stripRedirections("ls &> out.txt")).toBe("ls");
      expect(stripRedirections("ls >& out.txt")).toBe("ls");
    });

    it("should handle redirections in the middle", () => {
      expect(stripRedirections("grep foo > out.txt bar")).toBe("grep foo bar");
    });

    it("should handle quoted redirections (should NOT strip)", () => {
      expect(stripRedirections('echo "> out.txt"')).toBe('echo "> out.txt"');
    });

    it("should handle redirections with subshells", () => {
      expect(stripRedirections('(echo "hello") > out.txt')).toBe(
        '(echo "hello")',
      );
    });

    it("should handle complex redirections", () => {
      expect(stripRedirections("ls 2>&1")).toBe("ls");
      expect(stripRedirections("ls &>out.txt")).toBe("ls");
      expect(stripRedirections("ls >out.txt 2>&1")).toBe("ls");
      expect(stripRedirections("ls >>out.txt")).toBe("ls");
      expect(stripRedirections("ls >| out.txt")).toBe("ls");
      expect(stripRedirections("ls 3>&2")).toBe("ls");
      expect(stripRedirections("cat <&0")).toBe("cat");
      expect(stripRedirections("exec 3<>file")).toBe("exec");
    });

    it("should handle spaces correctly", () => {
      expect(stripRedirections('echo  "a  b"')).toBe('echo "a  b"');
      expect(stripRedirections("ls    -l")).toBe("ls -l");
      expect(stripRedirections("ls > out.txt  -l")).toBe("ls -l");
    });
  });
});
