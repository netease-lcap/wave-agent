import React, { useReducer, useEffect, useCallback } from "react";
import { useInput } from "ink";
import { ChatInterface } from "./ChatInterface.js";
import { ChatProvider } from "../contexts/useChat.js";
import { AppProvider } from "../contexts/useAppConfig.js";
import { WorktreeExitPrompt } from "./WorktreeExitPrompt.js";
import {
  hasUncommittedChanges,
  hasNewCommits,
  getDefaultRemoteBranch,
} from "wave-agent-sdk";
import { BaseAppProps } from "../types.js";

interface AppState {
  isExiting: boolean;
  worktreeStatus: {
    hasUncommittedChanges: boolean;
    hasNewCommits: boolean;
  } | null;
}

type AppAction =
  | {
      type: "START_EXIT";
      worktreeStatus: {
        hasUncommittedChanges: boolean;
        hasNewCommits: boolean;
      };
    }
  | { type: "CANCEL_EXIT" };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "START_EXIT":
      return { isExiting: true, worktreeStatus: action.worktreeStatus };
    case "CANCEL_EXIT":
      return { isExiting: false, worktreeStatus: state.worktreeStatus };
    default:
      return state;
  }
}

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
  allowedTools,
  disallowedTools,
  worktreeSession,
  workdir,
  version,
  model,
  onExit,
}) => {
  const [state, dispatch] = useReducer(appReducer, {
    isExiting: false,
    worktreeStatus: null,
  });

  const handleSignal = useCallback(async () => {
    if (worktreeSession) {
      const cwd = workdir || worktreeSession.path;
      const baseBranch = getDefaultRemoteBranch(cwd);
      const hasChanges = hasUncommittedChanges(cwd);
      const hasCommits = hasNewCommits(cwd, baseBranch);

      if (hasChanges || hasCommits) {
        dispatch({
          type: "START_EXIT",
          worktreeStatus: {
            hasUncommittedChanges: hasChanges,
            hasNewCommits: hasCommits,
          },
        });
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

  if (state.isExiting && worktreeSession && state.worktreeStatus) {
    return (
      <WorktreeExitPrompt
        name={worktreeSession.name}
        path={worktreeSession.path}
        hasUncommittedChanges={state.worktreeStatus.hasUncommittedChanges}
        hasNewCommits={state.worktreeStatus.hasNewCommits}
        onKeep={() => onExit(false)}
        onRemove={() => onExit(true)}
        onCancel={() => dispatch({ type: "CANCEL_EXIT" })}
      />
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
        onExit={onExit}
      />
    </AppProvider>
  );
};
