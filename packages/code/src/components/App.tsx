import React from "react";
import { ChatInterface } from "./ChatInterface.js";
import { ChatProvider } from "../contexts/useChat.js";
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
      <ChatInterface />
    </ChatProvider>
  );
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
