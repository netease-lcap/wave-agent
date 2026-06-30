/**
 * StatusDialog - Status info dialog
 *
 * Opened via the /status slash command. Shows read-only status:
 * version, session ID, working directory, server URL, model, fast model, auth status.
 */

import React, { useState, useEffect, useRef } from 'react';
import { StatusDialogProps } from '../types';
import '../styles/ConfigurationDialog.css';

const StatusDialog: React.FC<StatusDialogProps & { vscode: { postMessage: (msg: unknown) => void } }> = ({
  configurationData,
  onClose,
  vscode
}) => {
  const [version, setVersion] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [workdir, setWorkdir] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authUser, setAuthUser] = useState<{ id: string; email?: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    vscode?.postMessage({ command: 'getStatus' });
    vscode?.postMessage({ command: 'getAuthStatus' });
  }, [vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case 'statusResponse':
          setVersion(message.version || '');
          setSessionId(message.sessionId || '');
          setWorkdir(message.workdir || '');
          break;
        case 'authStatusResponse':
          setIsAuthenticated(message.isAuthenticated || false);
          setAuthUser(message.user || null);
          break;
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

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

  const serverUrl = configurationData?.serverUrl || configurationData?.envServerUrl;
  const baseURL = configurationData?.baseURL || configurationData?.envBaseUrl;
  const model = configurationData?.model || configurationData?.envModel;
  const fastModel = configurationData?.fastModel || configurationData?.envFastModel;

  const StatusRow = ({ label, value }: { label: string; value?: string }) => (
    <div className="configuration-field">
      <label>{label}:</label>
      <div style={{
        fontSize: '13px',
        color: 'var(--vscode-descriptionForeground)',
        fontFamily: 'var(--vscode-editor-font-family, monospace)',
        wordBreak: 'break-all',
        padding: '4px 0'
      }}>
        {value || '—'}
      </div>
    </div>
  );

  return (
    <div className="configuration-dialog-overlay">
      <div ref={dialogRef} className="configuration-dialog" style={{ height: 'auto', maxHeight: '500px' }}>
        <div className="configuration-dialog-header">
          <h3>状态信息</h3>
        </div>

        <div className="configuration-form">
          <div className="configuration-fields-scroll-area">
            <StatusRow label="版本" value={version} />
            <StatusRow label="Session ID" value={sessionId} />
            <StatusRow label="工作目录" value={workdir} />
            <StatusRow label="服务端链接" value={serverUrl} />
            <StatusRow label="Base URL" value={baseURL} />
            <StatusRow label="Model" value={model} />
            <StatusRow label="Fast Model" value={fastModel} />

            <div className="configuration-field sso-auth-section">
              <label>认证状态:</label>
              {isAuthenticated ? (
                <div className="sso-authenticated">
                  <div className="sso-user-info">
                    {authUser?.email && <span className="sso-email">{authUser.email}</span>}
                    <span className="sso-user-id">ID: {authUser?.id}</span>
                  </div>
                  <span style={{ color: 'var(--vscode-testing-iconPassed)', fontSize: '12px' }}>已登录</span>
                </div>
              ) : (
                <span style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '12px' }}>未登录 (使用 /login 进行 SSO 认证)</span>
              )}
            </div>
          </div>

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

export default StatusDialog;
