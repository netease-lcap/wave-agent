import React, { useCallback, useEffect, useState } from 'react';
import { ChatApp } from './ChatApp';
import { VsCodeApi, DesktopWorkdirState, DesktopSessionGroup } from '../types';
import '../styles/DesktopApp.css';

interface DesktopAppProps {
  vscode: VsCodeApi;
}

/**
 * Root component for the desktop (Electron) host. Owns the workdir state pushed
 * by the main process and renders the shared ChatApp with a desktop sidebar.
 * The sidebar's workdir dropdown is the single entry point for selecting a
 * workdir — both on first launch (no workdir yet, header shows a placeholder)
 * and when switching (FR-005). No full-screen selector overlay.
 */
export const DesktopApp: React.FC<DesktopAppProps> = ({ vscode }) => {
  const [workdirState, setWorkdirState] = useState<DesktopWorkdirState | null>(null);
  const [sessionTree, setSessionTree] = useState<DesktopSessionGroup[]>([]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'desktopWorkdirState') {
        setWorkdirState({
          workdir: message.workdir,
          recentWorkdirs: message.recentWorkdirs ?? [],
        });
      } else if (message.command === 'desktopSessionTree') {
        setSessionTree(message.groups ?? []);
      }
    };
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ command: 'desktopReady' });
    return () => window.removeEventListener('message', handleMessage);
  }, [vscode]);

  const handleSelectWorkdir = useCallback(() => {
    vscode.postMessage({ command: 'desktopSelectWorkdir' });
  }, [vscode]);

  const handleSelectRecentWorkdir = useCallback((path: string) => {
    vscode.postMessage({ command: 'desktopSelectRecentWorkdir', path });
  }, [vscode]);

  const handleRemoveRecentWorkdir = useCallback((path: string) => {
    vscode.postMessage({ command: 'desktopRemoveRecentWorkdir', path });
  }, [vscode]);

  const handleSelectSession = useCallback((workdir: string, sessionId: string) => {
    vscode.postMessage({ command: 'desktopSelectSession', workdir, sessionId });
  }, [vscode]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    vscode.postMessage({ command: 'desktopDeleteSession', sessionId });
  }, [vscode]);

  // Waiting for the main process to answer `desktopReady`.
  if (workdirState === null) {
    return <div className="desktop-loading" data-testid="desktop-loading"></div>;
  }

  const { workdir, recentWorkdirs } = workdirState;

  return (
    <ChatApp
      vscode={vscode}
      host={{
        type: 'desktop',
        workdir,
        recentWorkdirs,
        onSelectWorkdir: handleSelectWorkdir,
        onSelectRecentWorkdir: handleSelectRecentWorkdir,
        onRemoveRecentWorkdir: handleRemoveRecentWorkdir,
        sessionTree,
        onSelectSession: handleSelectSession,
        onDeleteSession: handleDeleteSession,
      }}
    />
  );
};

export default DesktopApp;
