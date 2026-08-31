import * as vscode from "vscode";
import { ChatProvider } from "./chatProvider";
import { adoptLoginPathIntoEnv } from "./stdio/loginPath";
import { hostLog } from "./hostLog";

let chatProvider: ChatProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log("Wave AI 聊天扩展已激活！");

  // GUI-launched VS Code (Finder/launcher) has a bare system PATH without the
  // user's nvm/homebrew dirs; on Windows the Git Bash profile is never sourced.
  // Adopt the login-shell PATH BEFORE any binary resolution / stdio spawn so
  // `which wave/node/npm` and agent-spawned bash commands find user tools.
  // Synchronous probe (bounded by a 5s timeout), result cached per activation.
  adoptLoginPathIntoEnv();

  // Create a single ChatProvider instance for the extension lifecycle
  try {
    chatProvider = new ChatProvider(context);
  } catch (error) {
    // The extension host catches what escapes activate(), but record the
    // failure in vscode.log — the developer console is invisible to users.
    console.error("Wave AI 扩展初始化失败:", error);
    hostLog.error("[Wave] Extension activation failed:", error);
    throw error;
  }

  // Register sidebar command
  const openChatSidebarCommand = vscode.commands.registerCommand(
    "wave-code.openChatSidebar",
    async () => {
      await openChatWithProgress("sidebar");
    },
  );

  // Register new tab command (main shortcut)
  const openChatTabCommand = vscode.commands.registerCommand(
    "wave-code.openChatTab",
    async () => {
      await openChatWithProgress("tab");
    },
  );

  // Register new window command
  const openChatWindowCommand = vscode.commands.registerCommand(
    "wave-code.openChatWindow",
    async () => {
      await openChatWithProgress("window");
    },
  );

  // Register focus view command
  const focusViewCommand = vscode.commands.registerCommand(
    "wave-code.focusView",
    async () => {
      try {
        await chatProvider!.focusView();
      } catch (error) {
        console.error("聚焦视图时出错:", error);
        vscode.window.showErrorMessage("聚焦视图失败: " + error);
      }
    },
  );

  // Register open settings command (editor-area settings tab, spec 场景 10)
  const openSettingsCommand = vscode.commands.registerCommand(
    "wave-code.openSettings",
    async () => {
      try {
        await chatProvider!.openSettings();
      } catch (error) {
        console.error("打开设置时出错:", error);
        vscode.window.showErrorMessage("打开设置失败: " + error);
      }
    },
  );

  // Register add to wave command
  const addToWaveCommand = vscode.commands.registerCommand(
    "wave-code.addToWave",
    async () => {
      try {
        await chatProvider!.addToWave();
      } catch (error) {
        console.error("添加到 Wave 时出错:", error);
        vscode.window.showErrorMessage("添加到 Wave 失败: " + error);
      }
    },
  );

  async function openChatWithProgress(mode: "sidebar" | "tab" | "window") {
    try {
      // Show progress indicator while opening chat
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `正在打开 Wave AI 聊天(${mode === "sidebar" ? "侧边栏" : mode === "tab" ? "标签页" : "新窗口"})...`,
          cancellable: false,
        },
        async () => {
          await chatProvider!.createOrShowChatPanel(mode);
        },
      );
    } catch (error) {
      console.error("打开聊天时出错:", error);
      vscode.window.showErrorMessage("打开聊天失败: " + error);
    }
  }

  context.subscriptions.push(
    openChatSidebarCommand,
    openChatTabCommand,
    openChatWindowCommand,
    focusViewCommand,
    addToWaveCommand,
    openSettingsCommand,
  );

  console.log("Wave 聊天命令注册成功");
}

export async function deactivate() {
  console.log("Wave AI 聊天扩展正在停用");

  // Clean up the chat provider and its agent
  try {
    if (chatProvider) {
      await chatProvider.destroy();
      chatProvider = undefined;
    }
  } catch (error) {
    console.error("停用 Wave 扩展时出错:", error);
    hostLog.error("[Wave] Extension deactivation failed:", error);
  }

  console.log("Wave AI 聊天扩展已停用");
}
