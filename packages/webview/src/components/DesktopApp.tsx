import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChatApp, prunePanelGroupCache } from "./ChatApp";
import { DesktopChromeProvider } from "./DesktopChromeContext";
import {
  VsCodeApi,
  DesktopWorkdirState,
  DesktopSessionGroup,
  DesktopPane,
  OpenPaneOptions,
} from "../types";
import "../styles/DesktopApp.css";

interface DesktopAppProps {
  vscode: VsCodeApi;
}

/**
 * Root component for the desktop (Electron) host. Owns the workdir state pushed
 * by the main process and renders the shared ChatApp with a desktop sidebar.
 * The sidebar's workdir dropdown is the single entry point for selecting a
 * workdir — both on first launch (no workdir yet, header shows a placeholder)
 * and when switching (FR-005). No full-screen selector overlay.
 *
 * Also owns the split-pane layout (FR-032): the ordered pane list + which pane
 * is focused, both driven by the host-authoritative `desktopPanes` message.
 */
export const DesktopApp: React.FC<DesktopAppProps> = ({ vscode }) => {
  const [workdirState, setWorkdirState] = useState<DesktopWorkdirState | null>(
    null,
  );
  const [sessionTree, setSessionTree] = useState<DesktopSessionGroup[]>([]);
  const [panes, setPanes] = useState<DesktopPane[]>([]);
  const [rowHeights, setRowHeights] = useState<number[] | undefined>(undefined);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);
  // Latest panes/session tree for the panel-group prune below (the message
  // handler closes over refs, not state, so both messages see fresh values).
  const panesRef = useRef<DesktopPane[]>([]);
  const sessionTreeRef = useRef<DesktopSessionGroup[]>([]);

  useEffect(() => {
    // Panel groups are remembered per session: keep entries for live pane
    // buckets, pane-bound sessions, and sessions still in the sidebar tree —
    // a deleted session forgets its panel group here.
    const prunePanels = () => {
      const keep = new Set<string>();
      for (const p of panesRef.current) {
        keep.add(`new:${p.paneId}`);
        if (p.sessionId) keep.add(p.sessionId);
      }
      for (const g of sessionTreeRef.current) {
        for (const s of g.sessions) keep.add(s.sessionId);
      }
      prunePanelGroupCache(keep);
    };
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === "desktopWorkdirState") {
        setWorkdirState({
          workdir: message.workdir,
          recentWorkdirs: message.recentWorkdirs ?? [],
          host: message.host ?? "local",
          hosts: message.hosts ?? [],
        });
      } else if (message.command === "desktopSessionTree") {
        sessionTreeRef.current = message.groups ?? [];
        setSessionTree(sessionTreeRef.current);
        prunePanels();
      } else if (message.command === "desktopPanes") {
        const nextPanes: DesktopPane[] = message.panes ?? [];
        panesRef.current = nextPanes;
        setPanes(nextPanes);
        prunePanels();
        setRowHeights(message.rowHeights);
        setFocusedPaneId(message.focusedPaneId ?? null);
      }
    };
    window.addEventListener("message", handleMessage);
    vscode.postMessage({ command: "desktopReady" });
    return () => window.removeEventListener("message", handleMessage);
  }, [vscode]);

  const handleSelectWorkdir = useCallback(() => {
    vscode.postMessage({ command: "desktopSelectWorkdir" });
  }, [vscode]);

  const handleSelectRecentWorkdir = useCallback(
    (path: string, host?: string) => {
      vscode.postMessage({ command: "desktopSelectRecentWorkdir", path, host });
    },
    [vscode],
  );

  const handleRemoveRecentWorkdir = useCallback(
    (path: string, host?: string) => {
      vscode.postMessage({ command: "desktopRemoveRecentWorkdir", path, host });
    },
    [vscode],
  );

  const handleSelectHost = useCallback(
    (host: string) => {
      vscode.postMessage({ command: "desktopSelectHost", host });
    },
    [vscode],
  );

  const handleAddHost = useCallback(
    (connectionString: string) => {
      vscode.postMessage({ command: "desktopAddHost", connectionString });
    },
    [vscode],
  );

  const handleSelectRemotePath = useCallback(
    (path: string, host: string) => {
      vscode.postMessage({ command: "desktopSelectRemotePath", path, host });
    },
    [vscode],
  );

  const handleListRemoteDir = useCallback(
    (path: string, host: string, requestId: string) => {
      vscode.postMessage({
        command: "desktopListRemoteDir",
        path,
        host,
        requestId,
      });
    },
    [vscode],
  );

  const handleSelectSession = useCallback(
    (workdir: string, sessionId: string) => {
      vscode.postMessage({
        command: "desktopSelectSession",
        workdir,
        sessionId,
      });
    },
    [vscode],
  );

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      vscode.postMessage({ command: "desktopDeleteSession", sessionId });
    },
    [vscode],
  );

  const handleOpenPane = useCallback(
    (workdir: string, sessionId: string, opts?: OpenPaneOptions) => {
      vscode.postMessage({
        command: "desktopOpenPane",
        workdir,
        sessionId,
        ...opts,
      });
    },
    [vscode],
  );

  // Waiting for the main process to answer `desktopReady`.
  if (workdirState === null) {
    return (
      <div className="desktop-loading" data-testid="desktop-loading"></div>
    );
  }

  const { workdir, recentWorkdirs, host, hosts } = workdirState;

  return (
    // 窗口级 chrome 状态（sidebarCollapsed/fullScreen）单一权威：root、pane
    // 任何 ChatApp 实例与 DesktopShell/DesktopSidebar 同源读取（不再逐层
    // props 透传 / 各实例留本地副本）。见 DesktopChromeContext.tsx。
    <DesktopChromeProvider>
      <ChatApp
        vscode={vscode}
        host={{
          type: "desktop",
          host,
          hosts,
          workdir,
          recentWorkdirs,
          onSelectWorkdir: handleSelectWorkdir,
          onSelectRecentWorkdir: handleSelectRecentWorkdir,
          onRemoveRecentWorkdir: handleRemoveRecentWorkdir,
          onSelectHost: handleSelectHost,
          onAddHost: handleAddHost,
          onSelectRemotePath: handleSelectRemotePath,
          onListRemoteDir: handleListRemoteDir,
          sessionTree,
          onSelectSession: handleSelectSession,
          onDeleteSession: handleDeleteSession,
          onOpenPane: handleOpenPane,
          panes,
          rowHeights,
          focusedPaneId,
        }}
      />
    </DesktopChromeProvider>
  );
};

export default DesktopApp;
