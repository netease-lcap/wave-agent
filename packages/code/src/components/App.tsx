import React, { useState, useEffect } from "react";
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
  const { isExpanded, rewindId, wasLastDetailsTooTall } = useChat();

  const [remountKey, setRemountKey] = useState(
    String(isExpanded) + rewindId + wasLastDetailsTooTall,
  );

  useEffect(() => {
    const newKey = String(isExpanded) + rewindId + wasLastDetailsTooTall;
    if (newKey !== remountKey) {
      stdout?.write("\u001b[2J\u001b[0;0H", (err?: Error | null) => {
        if (err) {
          console.error("Failed to clear terminal:", err);
        }
        setRemountKey(newKey);
      });
    }
  }, [isExpanded, rewindId, wasLastDetailsTooTall, remountKey, stdout]);

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
