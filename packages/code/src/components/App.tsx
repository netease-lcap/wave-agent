import React, { useState, useEffect, useRef, useCallback } from "react";
import { useStdout, useInput } from "ink";
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

const AppWithProviders: React.FC<AppWithProvidersProps> = ({
  bypassPermissions,
  permissionMode,
  pluginDirs,
  tools,
  worktreeSession,
  workdir,
  version,
  model,
  onExit,
}) => {
  const [isExiting, setIsExiting] = useState(false);
  const [worktreeStatus, setWorktreeStatus] = useState<{
    hasUncommittedChanges: boolean;
    hasNewCommits: boolean;
  } | null>(null);

  const handleSignal = useCallback(async () => {
    if (worktreeSession) {
      const cwd = workdir || worktreeSession.path;
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
    } else {
      onExit(false);
    }
  }, [worktreeSession, workdir, onExit]);

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

  if (isExiting && worktreeSession && worktreeStatus) {
    return (
      <WorktreeExitPrompt
        name={worktreeSession.name}
        path={worktreeSession.path}
        hasUncommittedChanges={worktreeStatus.hasUncommittedChanges}
        hasNewCommits={worktreeStatus.hasNewCommits}
        onKeep={() => onExit(false)}
        onRemove={() => onExit(true)}
        onCancel={() => setIsExiting(false)}
      />
    );
  }

  return (
    <ChatProvider
      bypassPermissions={bypassPermissions}
      permissionMode={permissionMode}
      pluginDirs={pluginDirs}
      tools={tools}
      workdir={workdir}
      worktreeSession={worktreeSession}
      version={version}
      model={model}
    >
      <ChatInterfaceWithRemount />
    </ChatProvider>
  );
};

const ChatInterfaceWithRemount: React.FC = () => {
  const { stdout } = useStdout();
  const { isExpanded, rewindId, wasLastDetailsTooTall, sessionId } = useChat();

  const [remountKey, setRemountKey] = useState(
    String(isExpanded) + rewindId + wasLastDetailsTooTall,
  );

  const prevSessionId = useRef(sessionId);

  useEffect(() => {
    const newKey =
      String(isExpanded) +
      rewindId +
      wasLastDetailsTooTall +
      (prevSessionId.current && sessionId && prevSessionId.current !== sessionId
        ? sessionId
        : "");

    if (newKey !== remountKey) {
      const timeout = setTimeout(() => {
        stdout?.write("\u001b[2J\u001b[0;0H", (err?: Error | null) => {
          if (err) {
            console.error("Failed to clear terminal:", err);
          }
          setRemountKey(newKey);
        });
      }, 100);

      return () => clearTimeout(timeout);
    }

    if (sessionId) {
      prevSessionId.current = sessionId;
    }
  }, [
    isExpanded,
    rewindId,
    wasLastDetailsTooTall,
    sessionId,
    remountKey,
    stdout,
  ]);

  return <ChatInterface key={remountKey} />;
};

export const App: React.FC<AppProps> = ({
  restoreSessionId,
  continueLastSession,
  bypassPermissions,
  permissionMode,
  pluginDirs,
  tools,
  worktreeSession,
  workdir,
  version,
  model,
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
        worktreeSession={worktreeSession}
        workdir={workdir}
        version={version}
        model={model}
        onExit={onExit}
      />
    </AppProvider>
  );
};
