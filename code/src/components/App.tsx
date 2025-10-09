import React from "react";
import { ChatInterface } from "./ChatInterface.js";
import { ChatProvider } from "../contexts/useChat.js";
import { AppProvider } from "../contexts/useAppConfig.js";
import type { SessionData } from "wave-agent-sdk";

interface AppProps {
  sessionToRestore?: SessionData | null;
}

const AppWithProviders: React.FC = () => {
  return (
    <ChatProvider>
      <ChatInterface />
    </ChatProvider>
  );
};

export const App: React.FC<AppProps> = ({ sessionToRestore }) => {
  return (
    <AppProvider sessionToRestore={sessionToRestore}>
      <AppWithProviders />
    </AppProvider>
  );
};
