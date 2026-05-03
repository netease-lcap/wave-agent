import React, { useState, useEffect, useCallback } from "react";
import { useInput } from "ink";
import { ChatInterface } from "./ChatInterface.js";
import { ChatProvider, useChat } from "../contexts/useChat.js";
import { AppProvider } from "../contexts/useAppConfig.js";
import { WorktreeExitPrompt } from "./WorktreeExitPrompt.js";
import {
  hasUncommittedChanges,
  hasNewCommits,
  getDefaultRemoteBranch,
} from "wave-agent-sdk";
import { BaseAppProps } from "../types.js";

interface AppProps extends BaseAppProps {
  restoreSessionId?: string;
  continueLastSession?: boolean;
  onExit: (shouldRemove: boolean) => void;
}

interface AppWithProvidersProps extends BaseAppProps {
  onExit: (shouldRemove: boolean) => void;
}

/** Wraps ChatInterface with worktree exit handling, using useChat() for hook access. */
const ChatWithExitPrompt: React.FC<{
  worktreeSession: NonNullable<BaseAppProps["worktreeSession"]>;
  onExit: (shouldRemove: boolean) => void;
}> = ({ worktreeSession, onExit }) => {
  const { triggerWorktreeRemoveHook } = useChat();
  const [isExiting, setIsExiting] = useState(false);
  const [worktreeStatus, setWorktreeStatus] = useState<{
    hasUncommittedChanges: boolean;
    hasNewCommits: boolean;
  } | null>(null);

  const handleSignal = useCallback(async () => {
    const cwd = worktreeSession.path;
    const baseBranch = getDefaultRemoteBranch(cwd);
    const hasChanges = hasUncommittedChanges(cwd);
    const hasCommits = hasNewCommits(cwd, baseBranch);

    if (hasChanges || hasCommits) {
      setWorktreeStatus({
        hasUncommittedChanges: hasChanges,
        hasNewCommits: hasCommits,
      });
      setIsExiting(true);
    } else {
      onExit(true);
    }
  }, [worktreeSession, onExit]);

  useInput((input, key) => {
    if (input === "c" && key.ctrl) {
      handleSignal();
    }
  });

  useEffect(() => {
    const onSigInt = () => handleSignal();
    const onSigTerm = () => handleSignal();

    process.on("SIGINT", onSigInt);
    process.on("SIGTERM", onSigTerm);

    return () => {
      process.off("SIGINT", onSigInt);
      process.off("SIGTERM", onSigTerm);
    };
  }, [handleSignal]);

  if (isExiting && worktreeStatus) {
    return (
      <WorktreeExitPrompt
        name={worktreeSession.name}
        path={worktreeSession.path}
        hasUncommittedChanges={worktreeStatus.hasUncommittedChanges}
        hasNewCommits={worktreeStatus.hasNewCommits}
        onKeep={() => onExit(false)}
        onRemove={async () => {
          await triggerWorktreeRemoveHook(worktreeSession.path);
          onExit(true);
        }}
        onCancel={() => setIsExiting(false)}
      />
    );
  }

  return <ChatInterface />;
};

const AppWithProviders: React.FC<AppWithProvidersProps> = ({
  bypassPermissions,
  permissionMode,
  pluginDirs,
  tools,
  allowedTools,
  disallowedTools,
  worktreeSession,
  workdir,
  version,
  model,
  mcpServers,
  onExit,
}) => {
  // Handle Ctrl-C for non-worktree sessions (immediate exit)
  // Ink runs terminal in raw mode, so Ctrl+C arrives as useInput event, not SIGINT
  useInput((input, key) => {
    if (!worktreeSession && input === "c" && key.ctrl) {
      onExit(false);
      return true;
    }
  });

  if (worktreeSession) {
    return (
      <ChatProvider
        bypassPermissions={bypassPermissions}
        permissionMode={permissionMode}
        pluginDirs={pluginDirs}
        tools={tools}
        allowedTools={allowedTools}
        disallowedTools={disallowedTools}
        workdir={workdir}
        worktreeSession={worktreeSession}
        version={version}
        model={model}
        mcpServers={mcpServers}
      >
        <ChatWithExitPrompt worktreeSession={worktreeSession} onExit={onExit} />
      </ChatProvider>
    );
  }

  return (
    <ChatProvider
      bypassPermissions={bypassPermissions}
      permissionMode={permissionMode}
      pluginDirs={pluginDirs}
      tools={tools}
      allowedTools={allowedTools}
      disallowedTools={disallowedTools}
      workdir={workdir}
      worktreeSession={worktreeSession}
      version={version}
      model={model}
      mcpServers={mcpServers}
    >
      <ChatInterface />
    </ChatProvider>
  );
};

export const App: React.FC<AppProps> = ({
  restoreSessionId,
  continueLastSession,
  bypassPermissions,
  permissionMode,
  pluginDirs,
  tools,
  allowedTools,
  disallowedTools,
  worktreeSession,
  workdir,
  version,
  model,
  mcpServers,
  onExit,
}) => {
  return (
    <AppProvider
      restoreSessionId={restoreSessionId}
      continueLastSession={continueLastSession}
    >
      <AppWithProviders
        bypassPermissions={bypassPermissions}
        permissionMode={permissionMode}
        pluginDirs={pluginDirs}
        tools={tools}
        allowedTools={allowedTools}
        disallowedTools={disallowedTools}
        worktreeSession={worktreeSession}
        workdir={workdir}
        version={version}
        model={model}
        mcpServers={mcpServers}
        onExit={onExit}
      />
    </AppProvider>
  );
};
