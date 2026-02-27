import React, { useState, useEffect, useRef } from "react";
import { useStdout } from "ink";
import { ChatInterface } from "./ChatInterface.js";
import { ChatProvider, useChat } from "../contexts/useChat.js";
import { AppProvider } from "../contexts/useAppConfig.js";
import { type WorktreeSession, removeWorktree } from "../utils/worktree.js";
import { WorktreeExitPrompt } from "./WorktreeExitPrompt.js";
import {
  hasUncommittedChanges,
  hasNewCommits,
  getDefaultRemoteBranch,
} from "wave-agent-sdk";

interface AppProps {
  restoreSessionId?: string;
  continueLastSession?: boolean;
  bypassPermissions?: boolean;
  pluginDirs?: string[];
  tools?: string[];
  worktreeSession?: WorktreeSession;
  onExit: () => void;
}

const AppWithProviders: React.FC<{
  bypassPermissions?: boolean;
  pluginDirs?: string[];
  tools?: string[];
  worktreeSession?: WorktreeSession;
  onExit: () => void;
}> = ({ bypassPermissions, pluginDirs, tools, worktreeSession, onExit }) => {
  const [isExiting, setIsExiting] = useState(false);
  const [worktreeStatus, setWorktreeStatus] = useState<{
    hasUncommittedChanges: boolean;
    hasNewCommits: boolean;
  } | null>(null);

  useEffect(() => {
    const handleSignal = async () => {
      if (worktreeSession) {
        const cwd = process.cwd();
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
          removeWorktree(worktreeSession, cwd);
          onExit();
        }
      } else {
        onExit();
      }
    };

    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);

    return () => {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
    };
  }, [worktreeSession, onExit]);

  if (isExiting && worktreeSession && worktreeStatus) {
    return (
      <WorktreeExitPrompt
        name={worktreeSession.name}
        path={worktreeSession.path}
        hasUncommittedChanges={worktreeStatus.hasUncommittedChanges}
        hasNewCommits={worktreeStatus.hasNewCommits}
        onKeep={() => onExit()}
        onRemove={() => {
          removeWorktree(worktreeSession, process.cwd());
          onExit();
        }}
        onCancel={() => setIsExiting(false)}
      />
    );
  }

  return (
    <ChatProvider
      bypassPermissions={bypassPermissions}
      pluginDirs={pluginDirs}
      tools={tools}
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
  pluginDirs,
  tools,
  worktreeSession,
  onExit,
}) => {
  return (
    <AppProvider
      restoreSessionId={restoreSessionId}
      continueLastSession={continueLastSession}
    >
      <AppWithProviders
        bypassPermissions={bypassPermissions}
        pluginDirs={pluginDirs}
        tools={tools}
        worktreeSession={worktreeSession}
        onExit={onExit}
      />
    </AppProvider>
  );
};
