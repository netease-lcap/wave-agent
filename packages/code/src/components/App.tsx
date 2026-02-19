import React, { useState, useEffect, useRef } from "react";
import { useStdout } from "ink";
import { ChatInterface } from "./ChatInterface.js";
import { ChatProvider, useChat } from "../contexts/useChat.js";
import { AppProvider } from "../contexts/useAppConfig.js";

interface AppProps {
  restoreSessionId?: string;
  continueLastSession?: boolean;
  bypassPermissions?: boolean;
  pluginDirs?: string[];
}

const AppWithProviders: React.FC<{
  bypassPermissions?: boolean;
  pluginDirs?: string[];
}> = ({ bypassPermissions, pluginDirs }) => {
  return (
    <ChatProvider bypassPermissions={bypassPermissions} pluginDirs={pluginDirs}>
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
    let newKey = String(isExpanded) + rewindId + wasLastDetailsTooTall;

    const isSessionChanged =
      prevSessionId.current && sessionId && prevSessionId.current !== sessionId;

    if (isSessionChanged) {
      newKey += sessionId;
    }

    if (newKey !== remountKey) {
      stdout?.write("\u001b[2J\u001b[0;0H", (err?: Error | null) => {
        if (err) {
          console.error("Failed to clear terminal:", err);
        }
        setTimeout(() => {
          setRemountKey(newKey);
        }, 100);
      });
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
}) => {
  return (
    <AppProvider
      restoreSessionId={restoreSessionId}
      continueLastSession={continueLastSession}
    >
      <AppWithProviders
        bypassPermissions={bypassPermissions}
        pluginDirs={pluginDirs}
      />
    </AppProvider>
  );
};
