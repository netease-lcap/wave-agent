import React, { useCallback, useEffect, useState } from 'react';
import { ChatApp } from './ChatApp';
import { WorkdirSelector } from './WorkdirSelector';
import { VsCodeApi, DesktopWorkdirState } from '../types';
import '../styles/DesktopApp.css';

interface DesktopAppProps {
  vscode: VsCodeApi;
}

/**
 * Root component for the desktop (Electron) host. Owns the workdir state
 * pushed by the main process and renders either the workdir selector (no
 * workdir yet / switching) or the shared ChatApp with a desktop sidebar.
 */
export const DesktopApp: React.FC<DesktopAppProps> = ({ vscode }) => {
  const [workdirState, setWorkdirState] = useState<DesktopWorkdirState | null>(null);
  const [selectingWorkdir, setSelectingWorkdir] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'desktopWorkdirState') {
        setWorkdirState({
          workdir: message.workdir,
          recentWorkdirs: message.recentWorkdirs ?? [],
        });
        if (message.workdir) {
          setSelectingWorkdir(false);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ command: 'desktopReady' });
    return () => window.removeEventListener('message', handleMessage);
  }, [vscode]);

  const handleSelect = useCallback(() => {
    vscode.postMessage({ command: 'desktopSelectWorkdir' });
  }, [vscode]);

  const handleSelectRecent = useCallback((path: string) => {
    vscode.postMessage({ command: 'desktopSelectRecentWorkdir', path });
  }, [vscode]);

  const handleRemoveRecent = useCallback((path: string) => {
    vscode.postMessage({ command: 'desktopRemoveRecentWorkdir', path });
  }, [vscode]);

  const handleUseTemp = useCallback(() => {
    vscode.postMessage({ command: 'desktopUseTempWorkdir' });
  }, [vscode]);

  const handleChangeWorkdir = useCallback(() => {
    setSelectingWorkdir(true);
  }, []);

  const handleCancelSelect = useCallback(() => {
    setSelectingWorkdir(false);
  }, []);

  // Waiting for the main process to answer `desktopReady`.
  if (workdirState === null) {
    return <div className="desktop-loading" data-testid="desktop-loading"></div>;
  }

  const { workdir, recentWorkdirs } = workdirState;

  if (!workdir) {
    return (
      <WorkdirSelector
        recentWorkdirs={recentWorkdirs}
        onSelect={handleSelect}
        onSelectRecent={handleSelectRecent}
        onRemoveRecent={handleRemoveRecent}
        onUseTemp={handleUseTemp}
      />
    );
  }

  return (
    <>
      <ChatApp
        vscode={vscode}
        host={{ type: 'desktop', workdir, onChangeWorkdir: handleChangeWorkdir }}
      />
      {selectingWorkdir && (
        <WorkdirSelector
          recentWorkdirs={recentWorkdirs}
          onSelect={handleSelect}
          onSelectRecent={handleSelectRecent}
          onRemoveRecent={handleRemoveRecent}
          onUseTemp={handleUseTemp}
          onCancel={handleCancelSelect}
        />
      )}
    </>
  );
};

export default DesktopApp;
