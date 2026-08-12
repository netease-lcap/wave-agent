import { describe, it, expect } from "vitest";
import * as pty from "node-pty";

/**
 * Platform smoke test: node-pty must actually load its native binary and
 * spawn a shell in the current environment. Runs in the normal desktop
 * suite (blocking CI). No mocks — this is the end-to-end proof that the
 * terminal panel's backend works on whatever platform executes it.
 */
describe("node-pty platform smoke test", () => {
  it("spawns a shell and relays echo output through the PTY", async () => {
    const isWin = process.platform === "win32";
    const term = pty.spawn(
      isWin ? "cmd.exe" : "/bin/sh",
      isWin ? ["/c", "echo", "wave-pty-ok"] : ["-c", "echo wave-pty-ok"],
      {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env,
      },
    );
    try {
      let output = "";
      term.onData((data) => {
        output += data;
      });
      const exitCode = await new Promise<number>((resolve) => {
        term.onExit(({ exitCode: code }) => resolve(code));
      });
      expect(output).toContain("wave-pty-ok");
      expect(exitCode).toBe(0);
    } finally {
      term.kill();
    }
  }, 20000);
});
