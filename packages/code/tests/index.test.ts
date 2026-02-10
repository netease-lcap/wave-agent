import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import yargs from "yargs";
import { main } from "../src/index.js";
import * as cli from "../src/cli.js";
import * as pluginManagerCli from "../src/plugin-manager-cli.js";
import * as printCli from "../src/print-cli.js";
import * as sessionSelectorCli from "../src/session-selector-cli.js";

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
vi.mock("../src/plugin-manager-cli.js");
vi.mock("../src/print-cli.js");
vi.mock("../src/session-selector-cli.js");

describe("main", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset process.argv before each test
    process.argv = ["node", "index.js"];
  });

  it("should start the main CLI with default settings if no arguments are provided", async () => {
    await main();
    expect(cli.startCli).toHaveBeenCalledWith({
      restoreSessionId: undefined,
      continueLastSession: undefined,
      bypassPermissions: false,
      pluginDirs: undefined,
    });
  });

  it("should start the main CLI with --restore argument", async () => {
    process.argv = ["node", "index.js", "--restore", "session123"];
    await main();
    expect(cli.startCli).toHaveBeenCalledWith({
      restoreSessionId: "session123",
      continueLastSession: undefined,
      bypassPermissions: false,
      pluginDirs: undefined,
    });
  });

  it("should start the main CLI with -r argument", async () => {
    process.argv = ["node", "index.js", "-r", "session456"];
    await main();
    expect(cli.startCli).toHaveBeenCalledWith({
      restoreSessionId: "session456",
      continueLastSession: undefined,
      bypassPermissions: false,
      pluginDirs: undefined,
    });
  });

  it("should start the main CLI with --continue argument", async () => {
    process.argv = ["node", "index.js", "--continue"];
    await main();
    expect(cli.startCli).toHaveBeenCalledWith({
      restoreSessionId: undefined,
      continueLastSession: true,
      bypassPermissions: false,
      pluginDirs: undefined,
    });
  });

  it("should start the main CLI with -c argument", async () => {
    process.argv = ["node", "index.js", "-c"];
    await main();
    expect(cli.startCli).toHaveBeenCalledWith({
      restoreSessionId: undefined,
      continueLastSession: true,
      bypassPermissions: false,
      pluginDirs: undefined,
    });
  });

  it("should start the print CLI with --print argument", async () => {
    process.argv = ["node", "index.js", "--print", "Hello World"];
    await main();
    expect(printCli.startPrintCli).toHaveBeenCalledWith({
      restoreSessionId: undefined,
      continueLastSession: undefined,
      message: "Hello World",
      showStats: undefined,
      bypassPermissions: false,
      pluginDirs: undefined,
    });
  });

  it("should start the print CLI with -p argument", async () => {
    process.argv = ["node", "index.js", "-p", "Test Message"];
    await main();
    expect(printCli.startPrintCli).toHaveBeenCalledWith({
      restoreSessionId: undefined,
      continueLastSession: undefined,
      message: "Test Message",
      showStats: undefined,
      bypassPermissions: false,
      pluginDirs: undefined,
    });
  });

  it("should start the print CLI with --print and --show-stats", async () => {
    process.argv = ["node", "index.js", "--print", "Stats", "--show-stats"];
    await main();
    expect(printCli.startPrintCli).toHaveBeenCalledWith({
      restoreSessionId: undefined,
      continueLastSession: undefined,
      message: "Stats",
      showStats: true,
      bypassPermissions: false,
      pluginDirs: undefined,
    });
  });

  it("should start the print CLI with -p and --show-stats", async () => {
    process.argv = ["node", "index.js", "-p", "Stats", "--show-stats"];
    await main();
    expect(printCli.startPrintCli).toHaveBeenCalledWith({
      restoreSessionId: undefined,
      continueLastSession: undefined,
      message: "Stats",
      showStats: true,
      bypassPermissions: false,
      pluginDirs: undefined,
    });
  });

  it("should handle --dangerously-skip-permissions argument", async () => {
    process.argv = ["node", "index.js", "--dangerously-skip-permissions"];
    await main();
    expect(cli.startCli).toHaveBeenCalledWith({
      restoreSessionId: undefined,
      continueLastSession: undefined,
      bypassPermissions: true,
      pluginDirs: undefined,
    });
  });

  it("should handle --plugin-dir argument", async () => {
    process.argv = ["node", "index.js", "--plugin-dir", "/tmp/plugins"];
    await main();
    expect(cli.startCli).toHaveBeenCalledWith({
      restoreSessionId: undefined,
      continueLastSession: undefined,
      bypassPermissions: false,
      pluginDirs: ["/tmp/plugins"],
    });
  });

  it("should handle multiple --plugin-dir arguments", async () => {
    process.argv = [
      "node",
      "index.js",
      "--plugin-dir",
      "/tmp/plugins1",
      "--plugin-dir",
      "/tmp/plugins2",
    ];
    await main();
    expect(cli.startCli).toHaveBeenCalledWith({
      restoreSessionId: undefined,
      continueLastSession: undefined,
      bypassPermissions: false,
      pluginDirs: ["/tmp/plugins1", "/tmp/plugins2"],
    });
  });

  describe("plugin commands", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(function () {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("should start plugin manager UI if 'plugin ui' command is given", async () => {
      process.argv = ["node", "index.js", "plugin", "ui"];
      vi.mocked(pluginManagerCli.startPluginManagerCli).mockResolvedValue(
        false,
      );
      await main();
      expect(pluginManagerCli.startPluginManagerCli).toHaveBeenCalled();
    });

    it("should exit process if plugin manager UI returns true", async () => {
      process.argv = ["node", "index.js", "plugin", "ui"];
      vi.mocked(pluginManagerCli.startPluginManagerCli).mockResolvedValue(true);
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(function () {
        throw new Error("process.exit was called");
      });
      await expect(main()).rejects.toThrow("process.exit was called");
      expect(exitSpy).toHaveBeenCalledWith(0);
      exitSpy.mockRestore();
    });

    it("should not exit process if plugin manager UI returns false", async () => {
      process.argv = ["node", "index.js", "plugin", "ui"];
      vi.mocked(pluginManagerCli.startPluginManagerCli).mockResolvedValue(
        false,
      );
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(function () {
        throw new Error("process.exit was called");
      });
      await main();
      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });

    it("should call addMarketplaceCommand for 'plugin marketplace add' command", async () => {
      process.argv = [
        "node",
        "index.js",
        "plugin",
        "marketplace",
        "add",
        "test/repo",
      ];
      const { addMarketplaceCommand } = await import(
        "../src/commands/plugin/marketplace.js"
      );
      vi.mocked(addMarketplaceCommand).mockResolvedValue(undefined);
      await main();
      expect(addMarketplaceCommand).toHaveBeenCalledWith(
        expect.objectContaining({ input: "test/repo" }),
      );
    });

    it("should call updateMarketplaceCommand for 'plugin marketplace update' command", async () => {
      process.argv = [
        "node",
        "index.js",
        "plugin",
        "marketplace",
        "update",
        "my-marketplace",
      ];
      const { updateMarketplaceCommand } = await import(
        "../src/commands/plugin/marketplace.js"
      );
      vi.mocked(updateMarketplaceCommand).mockResolvedValue(undefined);
      await main();
      expect(updateMarketplaceCommand).toHaveBeenCalledWith(
        expect.objectContaining({ name: "my-marketplace" }),
      );
    });

    it("should call listMarketplacesCommand for 'plugin marketplace list' command", async () => {
      process.argv = ["node", "index.js", "plugin", "marketplace", "list"];
      const { listMarketplacesCommand } = await import(
        "../src/commands/plugin/marketplace.js"
      );
      vi.mocked(listMarketplacesCommand).mockResolvedValue(undefined);
      await main();
      expect(listMarketplacesCommand).toHaveBeenCalled();
    });

    it("should call installPluginCommand for 'plugin install' command", async () => {
      process.argv = [
        "node",
        "index.js",
        "plugin",
        "install",
        "my-plugin@my-marketplace",
        "--scope",
        "user",
      ];
      const { installPluginCommand } = await import(
        "../src/commands/plugin/install.js"
      );
      vi.mocked(installPluginCommand).mockResolvedValue(undefined);
      await main();
      expect(installPluginCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          plugin: "my-plugin@my-marketplace",
          scope: "user",
        }),
      );
    });

    it("should call listPluginsCommand for 'plugin list' command", async () => {
      process.argv = ["node", "index.js", "plugin", "list"];
      const { listPluginsCommand } = await import(
        "../src/commands/plugin/list.js"
      );
      vi.mocked(listPluginsCommand).mockResolvedValue(undefined);
      await main();
      expect(listPluginsCommand).toHaveBeenCalled();
    });

    it("should call uninstallPluginCommand for 'plugin uninstall' command", async () => {
      process.argv = [
        "node",
        "index.js",
        "plugin",
        "uninstall",
        "my-plugin@my-marketplace",
      ];
      const { uninstallPluginCommand } = await import(
        "../src/commands/plugin/uninstall.js"
      );
      vi.mocked(uninstallPluginCommand).mockResolvedValue(undefined);
      await main();
      expect(uninstallPluginCommand).toHaveBeenCalledWith(
        expect.objectContaining({ plugin: "my-plugin@my-marketplace" }),
      );
    });

    it("should call updatePluginCommand for 'plugin update' command", async () => {
      process.argv = [
        "node",
        "index.js",
        "plugin",
        "update",
        "my-plugin@my-marketplace",
      ];
      const { updatePluginCommand } = await import(
        "../src/commands/plugin/update.js"
      );
      vi.mocked(updatePluginCommand).mockResolvedValue(undefined);
      await main();
      expect(updatePluginCommand).toHaveBeenCalledWith(
        expect.objectContaining({ plugin: "my-plugin@my-marketplace" }),
      );
    });
  });

  describe("session restoration", () => {
    it("should start session selector CLI if --restore is provided without an ID", async () => {
      process.argv = ["node", "index.js", "--restore"];
      vi.mocked(sessionSelectorCli.startSessionSelectorCli).mockResolvedValue(
        "selected-session-id",
      );
      await main();
      expect(sessionSelectorCli.startSessionSelectorCli).toHaveBeenCalled();
      expect(cli.startCli).toHaveBeenCalledWith({
        restoreSessionId: "selected-session-id",
        bypassPermissions: false,
        pluginDirs: undefined,
      });
    });

    it("should not start CLI if session selector returns null", async () => {
      process.argv = ["node", "index.js", "--restore"];
      vi.mocked(sessionSelectorCli.startSessionSelectorCli).mockResolvedValue(
        null,
      );
      await main();
      expect(sessionSelectorCli.startSessionSelectorCli).toHaveBeenCalled();
      expect(cli.startCli).not.toHaveBeenCalled();
    });
  });

  it("should catch and log errors from main function", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(function () {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(function () {
      throw new Error("process.exit was called");
    });

    // Simulate an error during yargs parsing or command execution
    vi.mocked(yargs).mockImplementationOnce(() => {
      throw new Error("Yargs parsing error");
    });

    // We need to mock the part where main() is called in index.ts
    // But main() itself is what we are testing.
    // The catch block is inside the if (import.meta.url === ...) block which we can't easily trigger.
    // Wait, the test is calling main() directly.
    // Let's look at src/index.ts again.

    /*
    export async function main() {
      try {
        const argv = await yargs(hideBin(process.argv))...parseAsync();
        ...
      } catch (error) {
        console.error("Failed to start WAVE Code:", error);
        process.exit(1);
      }
    }
    */
    // Ah, I see. I should check if src/index.ts has a try-catch inside main.

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
