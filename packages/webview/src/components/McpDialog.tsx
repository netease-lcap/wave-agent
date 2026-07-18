/**
 * McpDialog - MCP server management dialog
 *
 * Opened via the /mcp slash command. Shows MCP server status
 * and provides connect/disconnect controls.
 */

import React, { useState, useEffect, useRef } from 'react';
import { McpDialogProps, McpServerStatus } from '../types';
import '../styles/ConfigurationDialog.css';

const McpDialog: React.FC<McpDialogProps & { vscode: { postMessage: (msg: unknown) => void } }> = ({
  onClose,
  vscode
}) => {
  const [mcpServers, setMcpServers] = useState<McpServerStatus[]>([]);
  const [mcpConnecting, setMcpConnecting] = useState<Record<string, boolean>>({});

  // Fetch MCP servers on mount
  useEffect(() => {
    vscode?.postMessage({ command: 'getMcpServers' });
  }, [vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case 'mcpServersResponse':
          setMcpServers(message.servers || []);
          setMcpConnecting({});
          break;
        case 'mcpServersUpdate':
          setMcpServers(message.servers || []);
          setMcpConnecting({});
          break;
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleConnectMcpServer = (serverName: string) => {
    setMcpConnecting(prev => ({ ...prev, [serverName]: true }));
    vscode?.postMessage({ command: 'connectMcpServer', serverName });
  };

  const handleDisconnectMcpServer = (serverName: string) => {
    setMcpConnecting(prev => ({ ...prev, [serverName]: true }));
    vscode?.postMessage({ command: 'disconnectMcpServer', serverName });
  };

  const dialogRef = useRef<HTMLDivElement>(null);

  // Handle clicking outside to close dialog
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [onClose]);

  return (
    <div className="configuration-dialog-overlay">
      <div
        ref={dialogRef}
        className="configuration-dialog"
      >
        <div className="configuration-dialog-header">
          <h3>MCP 服务器</h3>
        </div>

        <div className="mcp-container">
          {mcpServers.length === 0 ? (
            <div className="empty-state">
              <p>未配置 MCP 服务器</p>
              <p className="mcp-hint">在项目根目录创建 <code>.mcp.json</code> 文件来添加服务器</p>
            </div>
          ) : (
            <div className="mcp-server-list">
              {mcpServers.map(server => (
                <div key={server.name} className="mcp-server-item">
                  <div className="mcp-server-info">
                    <div className="mcp-server-header">
                      <span className={`mcp-status-icon mcp-status-${server.status}`} title={server.status}>
                        {server.status === 'connected' ? '●' : server.status === 'connecting' ? '⟳' : server.status === 'error' ? '✗' : '○'}
                      </span>
                      <span className="mcp-server-name">{server.name}</span>
                      {server.toolCount !== undefined && server.status === 'connected' && (
                        <span className="mcp-tool-count">{server.toolCount} tools</span>
                      )}
                    </div>
                    {server.error && (
                      <div className="mcp-server-error">{server.error}</div>
                    )}
                    {server.lastConnected && (
                      <div className="mcp-server-last-connected">最近连接: {new Date(server.lastConnected).toLocaleTimeString()}</div>
                    )}
                  </div>
                  <div className="mcp-server-actions">
                    {(server.status === 'disconnected' || server.status === 'error') && (
                      <button
                        className="mcp-connect-btn"
                        onClick={() => handleConnectMcpServer(server.name)}
                        disabled={mcpConnecting[server.name]}
                      >
                        {mcpConnecting[server.name] ? '连接中...' : '连接'}
                      </button>
                    )}
                    {server.status === 'connected' && (
                      <button
                        className="mcp-disconnect-btn"
                        onClick={() => handleDisconnectMcpServer(server.name)}
                        disabled={mcpConnecting[server.name]}
                      >
                        {mcpConnecting[server.name] ? '断开中...' : '断开'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="configuration-actions">
            <button
              type="button"
              onClick={onClose}
              className="configuration-cancel-btn"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default McpDialog;
