import React from 'react';
import { ChatInterface } from './ChatInterface';
import { FileProvider } from '../contexts/useFiles';
import { ChatProvider } from '../contexts/useChat';
import { AppProvider, useAppConfig } from '../contexts/useAppConfig';

interface AppProps {
  workdir: string;
  ignore?: string[];
}

const AppWithProviders: React.FC = () => {
  const { workdir, ignore } = useAppConfig();

  return (
    <FileProvider workdir={workdir} ignore={ignore}>
      <ChatProvider>
        <ChatInterface />
      </ChatProvider>
    </FileProvider>
  );
};

export const App: React.FC<AppProps> = ({ workdir, ignore }) => {
  return (
    <AppProvider workdir={workdir} ignore={ignore}>
      <AppWithProviders />
    </AppProvider>
  );
};
