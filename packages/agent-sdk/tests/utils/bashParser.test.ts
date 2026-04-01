import { describe, it, expect } from "vitest";
import {
  splitBashCommand,
  stripEnvVars,
  stripRedirections,
  hasWriteRedirections,
  hasHeredoc,
  isBashHeredocWrite,
  getSmartPrefix,
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
      expect(splitBashCommand("(echo foo) > out.txt")).toEqual([
        "(echo foo) > out.txt",
      ]);
      expect(
        splitBashCommand("VAR=val (echo foo && echo bar) > out.txt"),
      ).toEqual(["VAR=val (echo foo && echo bar) > out.txt"]);
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

  describe("hasWriteRedirections", () => {
    it("should detect simple write redirections", () => {
      expect(hasWriteRedirections("echo hi > file")).toBe(true);
      expect(hasWriteRedirections("echo hi >> file")).toBe(true);
      expect(hasWriteRedirections("ls > file")).toBe(true);
    });

    it("should detect write redirections with file descriptors", () => {
      expect(hasWriteRedirections("ls 2> file")).toBe(true);
      expect(hasWriteRedirections("ls &> file")).toBe(true);
      expect(hasWriteRedirections("ls >| file")).toBe(true);
    });

    it("should ignore file descriptor redirections", () => {
      expect(hasWriteRedirections("ls 2>&1")).toBe(false);
      expect(hasWriteRedirections("ls >&2")).toBe(false);
      expect(hasWriteRedirections("ls 1>&2")).toBe(false);
    });

    it("should NOT detect read redirections", () => {
      expect(hasWriteRedirections("cat < file")).toBe(false);
      expect(hasWriteRedirections("cat <<EOF")).toBe(false);
    });

    it("should NOT detect quoted or escaped redirections", () => {
      expect(hasWriteRedirections('echo "hi > file"')).toBe(false);
      expect(hasWriteRedirections("echo 'hi > file'")).toBe(false);
      expect(hasWriteRedirections("echo hi \\> file")).toBe(false);
    });

    it("should handle complex commands", () => {
      expect(hasWriteRedirections("ls && echo hi > file")).toBe(true);
      expect(hasWriteRedirections("ls > file && echo hi")).toBe(true);
    });

    it("should detect write redirections on subshells", () => {
      expect(hasWriteRedirections("(echo hi) > file")).toBe(true);
    });

    it("should ignore redirections to /dev/null", () => {
      expect(hasWriteRedirections("ls > /dev/null")).toBe(false);
      expect(hasWriteRedirections("ls 2> /dev/null")).toBe(false);
      expect(hasWriteRedirections("ls >> /dev/null")).toBe(false);
      expect(hasWriteRedirections("ls &> /dev/null")).toBe(false);
      expect(hasWriteRedirections("ls >| /dev/null")).toBe(false);
      expect(hasWriteRedirections("ls >/dev/null")).toBe(false);
      expect(hasWriteRedirections("ls 2>/dev/null")).toBe(false);
      expect(hasWriteRedirections('ls > "/dev/null"')).toBe(false);
      expect(hasWriteRedirections("ls > '/dev/null'")).toBe(false);
    });

    it("should still detect other write redirections when /dev/null is present", () => {
      expect(hasWriteRedirections("ls > /dev/null > file")).toBe(true);
      expect(hasWriteRedirections("ls > file 2> /dev/null")).toBe(true);
      expect(hasWriteRedirections("ls > /dev/null 2>&1")).toBe(false); // 2>&1 is now ignored
    });
  });

  describe("hasHeredoc", () => {
    it("should detect simple heredocs", () => {
      expect(hasHeredoc("cat <<EOF")).toBe(true);
      expect(hasHeredoc("cat <<-EOF")).toBe(true);
    });

    it("should NOT detect other redirections", () => {
      expect(hasHeredoc("cat < file")).toBe(false);
      expect(hasHeredoc("echo hi > file")).toBe(false);
    });

    it("should NOT detect quoted or escaped heredocs", () => {
      expect(hasHeredoc('echo "<<EOF"')).toBe(false);
      expect(hasHeredoc("echo '<<EOF'")).toBe(false);
      expect(hasHeredoc("echo \\<\\<EOF")).toBe(false);
    });
  });

  describe("isBashHeredocWrite", () => {
    it("should detect heredoc write operations", () => {
      expect(isBashHeredocWrite("cat <<EOF > file")).toBe(true);
      expect(isBashHeredocWrite("cat > file <<EOF")).toBe(true);
      expect(isBashHeredocWrite("cat <<EOF >> file")).toBe(true);
    });

    it("should NOT detect heredoc without write redirection", () => {
      expect(isBashHeredocWrite("cat <<EOF")).toBe(false);
    });

    it("should NOT detect write redirection without heredoc", () => {
      expect(isBashHeredocWrite("echo hi > file")).toBe(false);
    });
  });

  describe("getSmartPrefix", () => {
    it("should return null for destructive git branch commands", () => {
      expect(getSmartPrefix("git branch -d some-branch")).toBe(null);
      expect(getSmartPrefix("git branch -D some-branch")).toBe(null);
      expect(getSmartPrefix("git branch --delete some-branch")).toBe(null);
      expect(getSmartPrefix("git branch -d")).toBe(null);
    });

    it("should return 'git branch' for safe git branch commands", () => {
      expect(getSmartPrefix("git branch")).toBe("git branch");
      expect(getSmartPrefix("git branch --list")).toBe("git branch");
      expect(getSmartPrefix("git branch -a")).toBe("git branch");
      expect(getSmartPrefix("git branch -r")).toBe("git branch");
      expect(getSmartPrefix("git branch --show-current")).toBe("git branch");
    });

    it("should return correct prefix for other git commands", () => {
      expect(getSmartPrefix("git status")).toBe("git status");
      expect(getSmartPrefix("git diff")).toBe("git diff");
      expect(getSmartPrefix("git add .")).toBe("git add");
      expect(getSmartPrefix("git commit -m 'msg'")).toBe("git commit");
    });

    it("should handle -C flag in git by keeping it", () => {
      expect(getSmartPrefix("git -C some/path status")).toBe(
        "git -C some/path status",
      );
      expect(getSmartPrefix("git -C some/path branch -D some-branch")).toBe(
        null,
      );
    });

    it("should handle npm commands", () => {
      expect(getSmartPrefix("npm install lodash")).toBe("npm install");
      expect(getSmartPrefix("npm i lodash")).toBe("npm i");
      expect(getSmartPrefix("npm run build")).toBe("npm run build");
      expect(getSmartPrefix("npm test")).toBe("npm test");
    });

    it("should handle gcloud commands", () => {
      expect(
        getSmartPrefix("gcloud compute instances list --project my-project"),
      ).toBe("gcloud compute instances list");
    });

    it("should handle python commands", () => {
      expect(getSmartPrefix("python3 -m pip install requests")).toBe(
        "python3 -m pip install",
      );
      expect(getSmartPrefix("python3 -m venv .venv")).toBe("python3 -m venv");
    });

    it("should return null for dangerous commands", () => {
      expect(getSmartPrefix("rm -rf /")).toBe(null);
      expect(getSmartPrefix("bash script.sh")).toBe(null);
      expect(getSmartPrefix("sudo rm -rf /")).toBe(null);
    });

    it("should return null for heredoc writes", () => {
      expect(getSmartPrefix("cat <<EOF > file.txt")).toBe(null);
    });

    it("should stop at file paths and URLs", () => {
      expect(getSmartPrefix("git status file.txt")).toBe("git status");
      expect(getSmartPrefix("npm install ./pkg")).toBe("npm install");
    });

    it("should handle sudo correctly", () => {
      expect(getSmartPrefix("sudo apt update")).toBe(null); // apt is dangerous
      expect(getSmartPrefix("sudo npm install")).toBe("sudo npm install");
      expect(getSmartPrefix("sudo git status")).toBe("sudo git status");
    });
  });
});
