import React, { useEffect, useMemo, useRef, useCallback } from "react";
import { Box, Text } from "ink";
import { useInput, usePaste } from "ink";
import { AVAILABLE_COMMANDS } from "../constants/commands.js";
import { FileSelector } from "./FileSelector.js";
import { CommandSelector } from "./CommandSelector.js";
import { HistorySearch } from "./HistorySearch.js";
import { BackgroundTaskManager } from "./BackgroundTaskManager.js";
import { McpManager } from "./McpManager.js";
import { AgentsManager } from "./AgentsManager.js";
import { SkillsManager } from "./SkillsManager.js";
import { HooksManager } from "./HooksManager.js";
import { RewindCommand } from "./RewindCommand.js";
import { ResumeCommand } from "./ResumeCommand.js";
import { HelpView } from "./HelpView.js";
import { StatusCommand } from "./StatusCommand.js";
import { DiffManager } from "./DiffManager.js";
import { RemoteControlView } from "./RemoteControlView.js";
import { LoginCommand } from "./LoginCommand.js";
import { PluginManagerShell } from "./PluginManagerShell.js";
import { ModelSelector } from "./ModelSelector.js";
import { WorkflowManager } from "./WorkflowManager.js";
import { StatusLine } from "./StatusLine.js";
import { Notifications } from "./Notifications.js";
import { BtwDisplay } from "./BtwDisplay.js";
import { PlanView } from "./PlanView.js";
import { useInputManager } from "../hooks/useInputManager.js";
import { useChat } from "../contexts/useChat.js";

import type {
  McpServerStatus,
  SlashCommand,
  HookEventConfig,
} from "wave-agent-sdk";

export const INPUT_PLACEHOLDER_TEXT =
  "Type your message (use /help for more info)...";

export const INPUT_PLACEHOLDER_TEXT_PREFIX = INPUT_PLACEHOLDER_TEXT.substring(
  0,
  10,
);

export interface InputBoxProps {
  isLoading?: boolean;
  isCommandRunning?: boolean;
  isCompacting?: boolean;
  workdir?: string;
  sendMessage?: (
    message: string,
    images?: Array<{ path: string; mimeType: string }>,
    longTextMap?: Record<string, string>,
  ) => void;
  abortMessage?: () => void;
  // MCP related properties
  mcpServers?: McpServerStatus[];
  connectMcpServer?: (serverName: string) => Promise<boolean>;
  disconnectMcpServer?: (serverName: string) => Promise<boolean>;
  // Slash Command related properties
  slashCommands?: SlashCommand[];
  hasSlashCommand?: (commandId: string) => boolean;
  // Hooks related properties (for /hooks overlay)
  hooks?: Partial<
    Record<"user" | "project" | "plugin", Record<string, HookEventConfig[]>>
  >;
  // Token usage
  latestTotalTokens?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  // Login hint
  showLoginHint?: boolean;
}

export const InputBox: React.FC<InputBoxProps> = ({
  isLoading,
  isCommandRunning,
  isCompacting,
  sendMessage = () => {},
  abortMessage = () => {},
  mcpServers = [],
  connectMcpServer = async () => false,
  disconnectMcpServer = async () => false,
  slashCommands = [],
  hasSlashCommand = () => false,
  hooks = {},
  latestTotalTokens = 0,
  contextWindow = 200000,
  maxOutputTokens = 32000,
  showLoginHint = false,
}) => {
  const {
    permissionMode: chatPermissionMode,
    setPermissionMode: setChatPermissionMode,
    handleRewindSelect,
    resumeSession,
    backgroundCurrentTask,
    getRewindCheckpoints,
    sessionId,
    workingDirectory,
    workspaceRoot,
    messages,
    askBtw,
    clearMessages,
    compact,
    addDir,
    showContextBreakdown,
    renameSession,
    currentModel,
    configuredModels,
    setModel,
    reloadPlugins,
    notifyPluginChange,
    hint,
    recallQueuedMessage,
    queuedMessages,
    setIsBtwActive,
    agentDefinitions,
    skills,
    planView,
    setPlanView,
    handlePlanCommand,
    modFocusPaneId,
    modStatuses,
    modToasts,
  } = useChat();

  // Ref to hold setInputText so queue callbacks can access it before useInputManager returns
  const setInputTextRef = useRef<(text: string) => void>(() => {});

  const hasQueuedMessages = (queuedMessages?.length ?? 0) > 0;

  // Idle means no AI work in flight. Esc double-press clear only applies when
  // idle; while busy, Esc keeps its abort semantics.
  const isIdle = !(isLoading || isCommandRunning || isCompacting);

  const onRecallQueuedMessage = useCallback(() => {
    const msg = recallQueuedMessage();
    if (msg) {
      const prefix = msg.type === "bang" ? "!" : "";
      setInputTextRef.current(prefix + msg.content);
    }
  }, [recallQueuedMessage]);

  // Input manager with all input state and functionality (including images)
  const {
    inputText,
    cursorPosition,
    // File selector
    showFileSelector,
    filteredFiles,
    fileSearchQuery: searchQuery,
    isFileSearching,
    handleFileSelect,
    handleCancelFileSelect,
    // Command selector
    showCommandSelector,
    commandSearchQuery,
    handleCommandSelect,
    handleCommandInsert,
    handleCancelCommandSelect,
    handleHistorySearchSelect,
    handleCancelHistorySearch,
    // History search
    showHistorySearch,
    historySearchQuery,
    // Task/MCP Manager
    showBackgroundTaskManager,
    showMcpManager,
    showAgentsManager,
    showRewindManager,
    showResumeSelector,
    showHelp,
    showStatusCommand,
    showDiffManager,
    showRemoteControl,
    showLoginCommand,
    showPluginManager,
    showModelSelector,
    showWorkflowManager,
    showSkillsManager,
    showHooksManager,
    setShowBackgroundTaskManager,
    setShowMcpManager,
    setShowAgentsManager,
    setShowRewindManager,
    setShowResumeSelector,
    setShowHelp,
    setShowStatusCommand,
    setShowDiffManager,
    setShowRemoteControl,
    setShowLoginCommand,
    setShowPluginManager,
    setShowModelSelector,
    setShowWorkflowManager,
    setShowSkillsManager,
    setShowHooksManager,
    // Permission mode
    permissionMode,
    setPermissionMode,
    // BTW state
    btwState,
    // Esc double-press clear pending
    escClearPending,
    // Main handler
    handleInput,
    insertPastedText,
    // Manager ready state
    isManagerReady,
    // Direct state setters
    setInputText,
  } = useInputManager({
    onSendMessage: sendMessage,
    onAskBtw: askBtw,
    onClearMessages: clearMessages,
    onCompact: compact,
    onReloadPlugins: reloadPlugins,
    onAddDir: addDir,
    onContextCommand: showContextBreakdown,
    onRenameSession: renameSession,
    onHasSlashCommand: hasSlashCommand,
    onAbortMessage: abortMessage,
    onBackgroundCurrentTask: backgroundCurrentTask,
    onPermissionModeChange: setChatPermissionMode,
    onPlanCommand: handlePlanCommand,
    sessionId,
    workdir: workingDirectory,
    hasQueuedMessages,
    isIdle,
    onRecallQueuedMessage,
    subagentConfigurations: agentDefinitions,
  });

  // Keep setInputText ref updated for queue callbacks
  useEffect(() => {
    setInputTextRef.current = setInputText;
  }, [setInputText]);

  // Sync the btw overlay's visibility to ChatContext so siblings (TaskList)
  // can hide while the side-question is on display (aligned with Claude Code,
  // which suppresses the expanded task list while a local-jsx command shows).
  useEffect(() => {
    setIsBtwActive(btwState.question !== "" || btwState.answer !== undefined);
  }, [btwState.question, btwState.answer, setIsBtwActive]);

  // Sync permission mode from useChat to InputManager
  useEffect(() => {
    setPermissionMode(chatPermissionMode);
  }, [chatPermissionMode, setPermissionMode]);

  // These views have their own useInput handlers that handle escape and
  // navigation. While one is open it owns the keyboard: InputBox must skip its
  // own handling to avoid duplicate dispatches or state update conflicts.
  // 插件面板拿到键盘（`$.ui.open({ focus: true })`）时同理：`Esc`/`↑↓` 归面板。
  const overlayOwnsKeyboard = Boolean(
    modFocusPaneId ||
      planView ||
      showRewindManager ||
      showResumeSelector ||
      showHelp ||
      showStatusCommand ||
      showDiffManager ||
      showLoginCommand ||
      showPluginManager ||
      showModelSelector ||
      showBackgroundTaskManager ||
      showMcpManager ||
      showAgentsManager ||
      showWorkflowManager ||
      showSkillsManager ||
      showHooksManager ||
      showRemoteControl,
  );

  // Use the InputManager's unified input handler
  useInput(async (input, key) => {
    if (overlayOwnsKeyboard) {
      return;
    }
    await handleInput(input, key);
  });

  // ink enables bracketed paste mode (DECSET 2004) while this hook is active and
  // delivers the whole paste as one string here instead of through useInput, so
  // its newlines are inserted rather than submitted. Deactivating it while an
  // overlay owns the keyboard hands pasted text back to ink's `useInput`
  // fallback, where the overlay's own handler sees it — text-entry overlays
  // (login token, plugin source form, confirmation answer) additionally keep a
  // `usePaste` of their own, which gets the empty-key chunk directly.
  usePaste(
    (text) => {
      insertPastedText(text);
    },
    { isActive: !overlayOwnsKeyboard },
  );

  const handleRewindCancel = () => {
    if (setShowRewindManager) {
      setShowRewindManager(false);
    }
  };

  // 插件贴的状态行与一次性提示（docs/specs/ecosystem/plugin-mods.md「状态带、状态
  // 行与提示」）：状态持久可见、最多摆两条再收成 `+N`；提示复用既有 hint 槽位，
  // 且比宿主自己的提示优先（用户刚点了面板里的按钮，最该看到的是操作结果）。
  const modStatusLine = useMemo(() => {
    if (modStatuses.length === 0) return null;
    const shown = modStatuses
      .slice(0, 2)
      .map((line) => `${line.plugin}: ${line.text}`);
    const rest = modStatuses.length - shown.length;
    return rest > 0 ? `${shown.join("  ·  ")} +${rest}` : shown.join("  ·  ");
  }, [modStatuses]);

  const modToast =
    modToasts.length > 0 ? modToasts[modToasts.length - 1]! : null;

  const isPlaceholder = !inputText;
  const placeholderText = INPUT_PLACEHOLDER_TEXT;

  // 参数提示（spec commands/slash-commands.md「命令的作者能给出参数提示」）：
  // 命令插进输入框后，输入行末尾以暗色给出参数形状，用户一打参数就撤。判据与
  // 桌面端 / 插件端一致——输入内容 trim 后正好是 `/命令名`，且命令后面**已经有一段
  // 空白**（Tab 补全与弹窗插入都插 `/cmd `；CC 两端同样要求这个空白，提示才与命令
  // 之间留出间隔）。带参数则 find 不到、提示自然消失。
  // 与 CC CLI 的差别只在「必须恰好一个尾随空白」那半条（它 `useTypeahead` 里注明
  // 是向后兼容的历史包袱），这里放宽到任意空白，四个入口露出时机一致。
  const argumentHint = useMemo(() => {
    if (!/\s$/.test(inputText)) return null;
    const trimmed = inputText.trim();
    if (
      !trimmed.startsWith("/") ||
      // 光标不在末尾时不画：提示落在行尾，此时它与光标位置对不上，看着像命令
      // 内容的一部分。
      cursorPosition !== inputText.length
    ) {
      return null;
    }
    const name = trimmed.slice(1);
    return (
      [...AVAILABLE_COMMANDS, ...slashCommands].find(
        (command) => command.name === name,
      )?.argumentHint ?? null
    );
  }, [inputText, cursorPosition, slashCommands]);

  const isShellCommand =
    inputText?.startsWith("!") && !inputText.includes("\n");

  // handleCommandSelectorInsert is already memoized in useInputManager, no need to wrap again

  // Split text into three parts: before cursor, cursor position, after cursor
  const displayText = isPlaceholder ? placeholderText : inputText;
  const beforeCursor = displayText.substring(0, cursorPosition);
  const atCursor =
    cursorPosition < displayText.length ? displayText[cursorPosition] : " ";
  const afterCursor = displayText.substring(cursorPosition + 1);

  // Always show cursor, allow user to continue input during memory mode
  const shouldShowCursor = true;

  // Only show the Box after InputManager is created on first mount
  if (!isManagerReady) {
    return null;
  }

  const handleRewindSelectWithClose = async (index: number) => {
    if (setShowRewindManager) {
      setShowRewindManager(false);
    }
    await handleRewindSelect(index);
  };

  const handleResumeSelectWithClose = async (
    sessionId: string,
    resumeWorkdir?: string,
  ) => {
    setShowResumeSelector(false);
    // The switch replaces the whole conversation; a draft typed for the old
    // session would otherwise silently become the first message of the new one.
    setInputText("");
    await resumeSession(sessionId, resumeWorkdir);
  };

  const handleResumeCancel = () => {
    setShowResumeSelector(false);
  };

  return (
    <Box flexDirection="column">
      <BtwDisplay btwState={btwState} />
      {showFileSelector && (
        <FileSelector
          files={filteredFiles}
          searchQuery={searchQuery}
          isLoading={isFileSearching}
          onSelect={handleFileSelect}
          onCancel={handleCancelFileSelect}
        />
      )}

      {showCommandSelector && (
        <CommandSelector
          searchQuery={commandSearchQuery}
          onSelect={handleCommandSelect}
          onInsert={handleCommandInsert}
          onCancel={handleCancelCommandSelect}
          commands={slashCommands}
        />
      )}

      {showHistorySearch && (
        <HistorySearch
          searchQuery={historySearchQuery}
          onSelect={handleHistorySearchSelect}
          onCancel={handleCancelHistorySearch}
        />
      )}

      {showBackgroundTaskManager && (
        <BackgroundTaskManager
          onCancel={() => setShowBackgroundTaskManager(false)}
        />
      )}

      {showMcpManager && (
        <McpManager
          onCancel={() => setShowMcpManager(false)}
          servers={mcpServers}
          onConnectServer={connectMcpServer}
          onDisconnectServer={disconnectMcpServer}
        />
      )}

      {showAgentsManager && (
        <AgentsManager
          onCancel={() => setShowAgentsManager(false)}
          agentDefinitions={agentDefinitions}
        />
      )}

      {showSkillsManager && (
        <SkillsManager
          onCancel={() => setShowSkillsManager(false)}
          skills={skills}
        />
      )}

      {showHooksManager && (
        <HooksManager
          onCancel={() => setShowHooksManager(false)}
          hooks={hooks}
        />
      )}

      {showWorkflowManager && (
        <WorkflowManager onCancel={() => setShowWorkflowManager(false)} />
      )}

      {showRewindManager && (
        <RewindCommand
          onSelect={handleRewindSelectWithClose}
          onCancel={handleRewindCancel}
          getCheckpoints={getRewindCheckpoints}
        />
      )}

      {showResumeSelector && (
        <ResumeCommand
          workdir={workingDirectory}
          isBusy={!isIdle}
          onSelect={handleResumeSelectWithClose}
          onCancel={handleResumeCancel}
        />
      )}

      {showHelp && (
        <HelpView
          onCancel={() => setShowHelp(false)}
          commands={slashCommands}
        />
      )}

      {showStatusCommand && (
        <StatusCommand onCancel={() => setShowStatusCommand(false)} />
      )}

      {showDiffManager && (
        <DiffManager
          workspaceRoot={workspaceRoot || workingDirectory}
          messages={messages}
          onCancel={() => setShowDiffManager(false)}
        />
      )}

      {showRemoteControl && (
        <RemoteControlView onCancel={() => setShowRemoteControl(false)} />
      )}

      {showLoginCommand && (
        <LoginCommand onCancel={() => setShowLoginCommand(false)} />
      )}

      {showPluginManager && (
        <PluginManagerShell
          onCancel={() => setShowPluginManager(false)}
          onPluginChanged={notifyPluginChange}
        />
      )}

      {showModelSelector && (
        <ModelSelector
          onCancel={() => setShowModelSelector(false)}
          currentModel={currentModel}
          configuredModels={configuredModels}
          onSelectModel={setModel}
        />
      )}

      {planView && (
        <PlanView
          path={planView.path}
          content={planView.content}
          message={planView.message}
          onCancel={() => setPlanView(null)}
        />
      )}

      {btwState.question || btwState.answer
        ? null
        : planView
          ? null
          : showBackgroundTaskManager ||
            showMcpManager ||
            showAgentsManager ||
            showSkillsManager ||
            showHooksManager ||
            showRewindManager ||
            showResumeSelector ||
            showHelp ||
            showStatusCommand ||
            showDiffManager ||
            showLoginCommand ||
            showPluginManager ||
            showModelSelector ||
            showWorkflowManager ||
            showRemoteControl || (
              <Box flexDirection="column">
                {escClearPending && (
                  <Text color="gray">Press Esc again to clear input</Text>
                )}
                <Box
                  borderStyle="single"
                  borderColor="gray"
                  borderLeft={false}
                  borderRight={false}
                >
                  <Text color={isPlaceholder ? "gray" : "white"}>
                    {shouldShowCursor ? (
                      <>
                        {beforeCursor}
                        <Text backgroundColor="white" color="black">
                          {atCursor}
                        </Text>
                        {afterCursor}
                        {argumentHint && <Text dimColor>{argumentHint}</Text>}
                      </>
                    ) : (
                      displayText
                    )}
                  </Text>
                </Box>
                <Box justifyContent="space-between">
                  <StatusLine
                    permissionMode={permissionMode}
                    isShellCommand={isShellCommand}
                  />
                  <Notifications
                    latestTotalTokens={latestTotalTokens}
                    contextWindow={contextWindow}
                    maxOutputTokens={maxOutputTokens}
                    showLoginHint={showLoginHint}
                    hint={
                      modToast ? `${modToast.plugin}: ${modToast.text}` : hint
                    }
                    modStatus={modStatusLine}
                  />
                </Box>
              </Box>
            )}
    </Box>
  );
};
