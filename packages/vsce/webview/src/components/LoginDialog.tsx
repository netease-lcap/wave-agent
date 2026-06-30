/**
 * LoginDialog - SSO authentication dialog
 *
 * Opened via the /login slash command. Shows SSO auth status
 * and provides login/logout controls.
 */

import React, { useState, useEffect, useRef } from 'react';
import { LoginDialogProps, VsCodeApi } from '../types';
import '../styles/ConfigurationDialog.css';

const LoginDialog: React.FC<LoginDialogProps & { vscode: VsCodeApi }> = ({
  configurationData,
  onClose,
  vscode
}) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authUser, setAuthUser] = useState<{ id: string; email?: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [serverUrlInput, setServerUrlInput] = useState('');
  const [serverUrlSaved, setServerUrlSaved] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Initialize serverUrl input from configuration
  useEffect(() => {
    setServerUrlInput(configurationData?.serverUrl || '');
    setServerUrlSaved(!!configurationData?.serverUrl);
  }, [configurationData?.serverUrl]);

  // Fetch auth status on mount
  useEffect(() => {
    vscode?.postMessage({ command: 'getAuthStatus' });
    setAuthMessage('');
  }, [vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case 'authStatusResponse':
          setIsAuthenticated(message.isAuthenticated || false);
          setAuthUser(message.user || null);
          break;
        case 'loginResponse':
          if (message.success) {
            setIsAuthenticated(true);
            setAuthUser(message.user || null);
            setAuthLoading(false);
            setAuthMessage('登录成功');
          } else {
            setAuthLoading(false);
            setAuthMessage(message.error || '登录失败');
          }
          break;
        case 'logoutResponse':
          setIsAuthenticated(false);
          setAuthUser(null);
          setAuthMessage('已登出');
          break;
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLogin = () => {
    setAuthLoading(true);
    setAuthMessage('');
    vscode?.postMessage({ command: 'login' });
  };

  const handleLogout = () => {
    vscode?.postMessage({ command: 'logout' });
  };

  const handleSaveServerUrl = () => {
    vscode?.postMessage({
      command: 'updateConfiguration',
      configurationData: {
        ...configurationData,
        serverUrl: serverUrlInput
      }
    });
    setServerUrlSaved(true);
  };

  // Click outside / Escape to close
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

  const serverUrl = serverUrlSaved ? serverUrlInput : (configurationData?.serverUrl || configurationData?.envServerUrl || '');

  return (
    <div className="configuration-dialog-overlay">
      <div ref={dialogRef} className="configuration-dialog">
        <div className="configuration-dialog-header">
          <h3>SSO 认证</h3>
        </div>

        <div className="configuration-form">
          <div className="configuration-fields-scroll-area">
            <div className="configuration-field">
              <label htmlFor="login-serverUrl">服务端链接:</label>
              <div className="login-serverUrl-row">
                <input
                  id="login-serverUrl"
                  type="url"
                  value={serverUrlInput}
                  onChange={(e) => { setServerUrlInput(e.target.value); setServerUrlSaved(false); }}
                  placeholder={configurationData?.envServerUrl || 'WAVE_SERVER_URL'}
                />
                <button
                  type="button"
                  id="login-save-serverUrl"
                  className="login-save-serverUrl-btn"
                  onClick={handleSaveServerUrl}
                  disabled={!serverUrlInput || serverUrlSaved}
                >
                  {serverUrlSaved ? '已保存' : '保存'}
                </button>
              </div>
            </div>

            <div className="configuration-field sso-auth-section">
              <label>认证状态:</label>
              {isAuthenticated ? (
                <div className="sso-authenticated">
                  <div className="sso-user-info">
                    {authUser?.email && <span className="sso-email">{authUser.email}</span>}
                    <span className="sso-user-id">ID: {authUser?.id}</span>
                  </div>
                  <button
                    type="button"
                    className="sso-logout-btn"
                    onClick={handleLogout}
                    disabled={authLoading}
                  >
                    登出
                  </button>
                </div>
              ) : (
                <div className="sso-not-authenticated">
                  <span className="status-info-value">未登录</span>
                  <button
                    type="button"
                    className="sso-login-btn"
                    onClick={handleLogin}
                    disabled={authLoading || !serverUrl}
                  >
                    {authLoading ? '登录中...' : 'SSO 登录'}
                  </button>
                </div>
              )}
              {authMessage && (
                <div className={`sso-message ${authMessage.includes('成功') ? 'success' : authMessage.includes('失败') ? 'error' : ''}`}>
                  {authMessage}
                </div>
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

export default LoginDialog;
