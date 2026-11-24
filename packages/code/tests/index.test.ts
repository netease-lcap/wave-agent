import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import yargs from "yargs";
import { main } from "../src/index.js";
import * as cli from "../src/cli.js";
import * as printCli from "../src/print-cli.js";
import * as sessionSelectorCli from "../src/session-selector-cli.js";
import * as marketplaceCommands from "../src/commands/plugin/marketplace.js";
import * as installCommands from "../src/commands/plugin/install.js";
import * as listCommands from "../src/commands/plugin/list.js";
import * as uninstallCommands from "../src/commands/plugin/uninstall.js";
import * as updateCommands from "../src/commands/plugin/update.js";
import path from "path";

// Mock external modules
vi.mock("yargs", async () => {
  const actual = await vi.importActual("yargs");
  const mockYargs = vi.fn().mockImplementation(function (...args: unknown[]) {
    const instance = (
      actual as unknown as { default: (...args: unknown[]) => unknown }
    ).default(...args);
    const typedInstance = instance as {
      option: () => void;
      command: () => void;
      version: () => void;
      alias: () => void;
      example: () => void;
      help: () => void;
      recommendCommands: () => void;
      strict: () => void;
      parseAsync: () => void;
    };
    vi.spyOn(typedInstance, "option");
    vi.spyOn(typedInstance, "command");
    vi.spyOn(typedInstance, "version");
    vi.spyOn(typedInstance, "alias");
    vi.spyOn(typedInstance, "example");
    vi.spyOn(typedInstance, "help");
    vi.spyOn(typedInstance, "recommendCommands");
    vi.spyOn(typedInstance, "strict");
    vi.spyOn(typedInstance, "parseAsync");
    return instance;
  }) as unknown as (...args: unknown[]) => unknown;
  return {
    default: mockYargs,
  };
});
vi.mock("yargs/helpers", async () => {
  const actual = await vi.importActual("yargs/helpers");
  return {
    ...(actual as Record<string, unknown>),
  };
});
vi.mock("../src/commands/plugin/marketplace.js");
vi.mock("../src/commands/plugin/install.js");
vi.mock("../src/commands/plugin/list.js");
vi.mock("../src/commands/plugin/uninstall.js");
vi.mock("../src/commands/plugin/update.js");
vi.mock("../src/cli.js");
vi.mock("../src/print-cli.js");
vi.mock("../src/session-selector-cli.js");
// sessionExistsAnywhere backs the `wave --restore <id>` pre-flight check in
// index.ts; a truthy result lets the CLI proceed to startCli. It is a pure
// yes/no predicate — nothing reads the transcript for it.
vi.mock("wave-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wave-agent-sdk")>();
  return {
    ...actual,
    sessionExistsAnywhere: vi.fn().mockResolvedValue(true),
  };
});
vi.mock("../src/utils/worktree.js", () => ({
  createWorktree: vi.fn().mockImplementation((name, cwd) => ({
    name,
    path: path.join(cwd, "..", `${path.basename(cwd)}.worktrees`, name),
    branch: `worktree-${name}`,
    repoRoot: cwd,
    hasUncommittedChanges: false,
    hasNewCommits: false,
  })),
  removeWorktree: vi.fn(),
  listWorktrees: vi.fn().mockResolvedValue([]),
}));

// index.ts 只是把 argv 搬进 startCli / startPrintCli，所以每个 flag 只钉它自己
// 那一个字段，公共字段由 objectContaining 放过 —— 加一个 CLI flag 不该让整张表全红。
const COMMON_OPTIONS = {
  bypassPermissions: false,
  pluginDirs: undefined,
  tools: undefined,
  worktreeSession: undefined,
  workdir: process.cwd(),
  originalCwd: process.cwd(),
  version: expect.any(String),
};

const cliOptions = () => vi.mocked(cli.startCli).mock.calls.at(-1)?.[0];

describe("main", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset process.argv before each test
    process.argv = ["node", "index.js"];
  });

  it.each([
    { name: "无参数", argv: [] as string[], flags: {} },
    {
      name: "--restore <id>",
      argv: ["--restore", "session123"],
      flags: { restoreSessionId: "session123" },
    },
    {
      name: "-r <id>",
      argv: ["-r", "session456"],
      flags: { restoreSessionId: "session456" },
    },
    {
      name: "--continue",
      argv: ["--continue"],
      flags: { continueLastSession: true },
    },
    { name: "-c", argv: ["-c"], flags: { continueLastSession: true } },
    {
      name: "--dangerously-skip-permissions",
      argv: ["--dangerously-skip-permissions"],
      flags: { bypassPermissions: true },
    },
    {
      name: "--tools",
      argv: ["--tools", "Bash,Read"],
      flags: { tools: ["Bash", "Read"] },
    },
  ])("$name 进入交互 CLI", async ({ argv, flags }) => {
    process.argv = ["node", "index.js", ...argv];
    await main();
    expect(cli.startCli).toHaveBeenCalledWith(
      expect.objectContaining({ ...COMMON_OPTIONS, ...flags }),
    );
    expect(printCli.startPrintCli).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "--print <message>",
      argv: ["--print", "Hello World"],
      flags: { message: "Hello World" },
    },
    {
      name: "-p <message> --show-stats",
      argv: ["-p", "Stats", "--show-stats"],
      flags: { message: "Stats", showStats: true },
    },
    {
      name: "-p <message> --output-format stream-json",
      argv: ["-p", "Review", "--output-format", "stream-json"],
      flags: { message: "Review", outputFormat: "stream-json" },
    },
  ])("$name 进入 print CLI", async ({ argv, flags }) => {
    process.argv = ["node", "index.js", ...argv];
    await main();
    expect(printCli.startPrintCli).toHaveBeenCalledWith(
      expect.objectContaining({
        ...COMMON_OPTIONS,
        outputFormat: "text",
        showStats: undefined,
        ...flags,
      }),
    );
    expect(cli.startCli).not.toHaveBeenCalled();
  });

  it("拒绝 print 模式之外的 --output-format", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(function () {});
    // Throwing mirrors a real exit: main() stops where the flag was rejected
    // instead of falling through to startCli.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(function () {
      throw new Error("process.exit was called");
    });

    process.argv = ["node", "index.js", "--output-format", "json"];
    await expect(main()).rejects.toThrow("process.exit was called");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "--output-format json requires print mode (-p).",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(cli.startCli).not.toHaveBeenCalled();
    expect(printCli.startPrintCli).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("显式的 --output-format text 在 print 模式外仍然放行", async () => {
    process.argv = ["node", "index.js", "--output-format", "text"];
    await main();
    expect(cli.startCli).toHaveBeenCalled();
  });

  it("把每个 --plugin-dir 解析成绝对路径后全部传下去", async () => {
    process.argv = [
      "node",
      "index.js",
      "--plugin-dir",
      "/tmp/plugins1",
      "--plugin-dir",
      "./my-plugins",
    ];
    await main();
    expect(cliOptions()?.pluginDirs).toEqual([
      path.resolve("/tmp/plugins1"),
      path.resolve(process.cwd(), "./my-plugins"),
    ]);
  });

  it("以 --worktree 建会话：chdir 进新目录，workdir 跟着换", async () => {
    process.argv = ["node", "index.js", "--worktree", "test-worktree"];
    const chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});
    await main();
    expect(cliOptions()).toEqual(
      expect.objectContaining({
        worktreeSession: expect.objectContaining({ name: "test-worktree" }),
        workdir: expect.stringContaining("test-worktree"),
      }),
    );
    expect(chdirSpy).toHaveBeenCalledWith(
      expect.stringContaining("test-worktree"),
    );
    chdirSpy.mockRestore();
  });

  describe("plugin 子命令", () => {
    // yargs 的自有输出（usage / 命令错误）走 console.error，静音掉免得污染日志
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(function () {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it.each([
      {
        name: "plugin marketplace add",
        argv: ["plugin", "marketplace", "add", "test/repo"],
        cmd: marketplaceCommands.addMarketplaceCommand,
        expected: { input: "test/repo" },
      },
      {
        name: "plugin marketplace update",
        argv: ["plugin", "marketplace", "update", "my-marketplace"],
        cmd: marketplaceCommands.updateMarketplaceCommand,
        expected: { name: "my-marketplace" },
      },
      {
        name: "plugin marketplace list",
        argv: ["plugin", "marketplace", "list"],
        cmd: marketplaceCommands.listMarketplacesCommand,
        expected: undefined,
      },
      {
        name: "plugin install",
        argv: [
          "plugin",
          "install",
          "my-plugin@my-marketplace",
          "--scope",
          "user",
        ],
        cmd: installCommands.installPluginCommand,
        expected: { plugin: "my-plugin@my-marketplace", scope: "user" },
      },
      {
        name: "plugin list",
        argv: ["plugin", "list"],
        cmd: listCommands.listPluginsCommand,
        expected: undefined,
      },
      {
        name: "plugin uninstall",
        argv: ["plugin", "uninstall", "my-plugin@my-marketplace"],
        cmd: uninstallCommands.uninstallPluginCommand,
        expected: { plugin: "my-plugin@my-marketplace" },
      },
      {
        name: "plugin update",
        argv: ["plugin", "update", "my-plugin@my-marketplace"],
        cmd: updateCommands.updatePluginCommand,
        expected: { plugin: "my-plugin@my-marketplace" },
      },
    ])("$name 被路由到对应命令", async ({ argv, cmd, expected }) => {
      process.argv = ["node", "index.js", ...argv];
      await main();
      if (expected) {
        expect(cmd).toHaveBeenCalledWith(expect.objectContaining(expected));
      } else {
        // list 类命令不带参数
        expect(cmd).toHaveBeenCalled();
      }
    });
  });

  describe("session restoration", () => {
    it("--restore 不带 ID 时先开选择器，再用选中的会话", async () => {
      process.argv = ["node", "index.js", "--restore"];
      vi.mocked(sessionSelectorCli.startSessionSelectorCli).mockResolvedValue({
        sessionId: "selected-session-id",
      });
      await main();
      expect(sessionSelectorCli.startSessionSelectorCli).toHaveBeenCalledWith({
        workdir: process.cwd(),
        worktreePaths: [],
      });
      expect(cliOptions()).toEqual(
        expect.objectContaining({ restoreSessionId: "selected-session-id" }),
      );
    });

    it("选中兄弟 worktree 里的会话时先 chdir 过去", async () => {
      process.argv = ["node", "index.js", "--restore"];
      const worktreePath = path.join(process.cwd(), "..", "repo-wt");
      vi.mocked(sessionSelectorCli.startSessionSelectorCli).mockResolvedValue({
        sessionId: "wt-session-id",
        resumeWorkdir: worktreePath,
      });
      const chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});
      await main();
      expect(chdirSpy).toHaveBeenCalledWith(worktreePath);
      expect(cliOptions()).toEqual(
        expect.objectContaining({
          restoreSessionId: "wt-session-id",
          workdir: worktreePath,
        }),
      );
      chdirSpy.mockRestore();
    });

    it("选择器返回 null 时不启动 CLI", async () => {
      process.argv = ["node", "index.js", "--restore"];
      vi.mocked(sessionSelectorCli.startSessionSelectorCli).mockResolvedValue(
        null,
      );
      await main();
      expect(cli.startCli).not.toHaveBeenCalled();
    });
  });

  it("启动失败时报错并以 1 退出", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(function () {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(function () {
      throw new Error("process.exit was called");
    });

    vi.mocked(yargs).mockImplementationOnce(() => {
      throw new Error("Yargs parsing error");
    });

    await expect(main()).rejects.toThrow("process.exit was called");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to start WAVE Code:",
      expect.any(Error),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
