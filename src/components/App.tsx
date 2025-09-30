import React from "react";
import { ChatInterface } from "./ChatInterface";
import { ChatProvider } from "../contexts/useChat";
import { AppProvider } from "../contexts/useAppConfig";
import type { SessionData } from "../services/session";

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
