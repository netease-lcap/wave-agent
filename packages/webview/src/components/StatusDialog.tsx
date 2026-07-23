/**
 * StatusDialog - Status info dialog
 *
 * Opened via the /status slash command. Shows read-only status:
 * version, session ID, working directory.
 */

import React, { useState, useEffect, useRef } from 'react';
import { StatusDialogProps } from '../types';
import '../styles/ConfigurationDialog.css';

const StatusDialog: React.FC<StatusDialogProps & { vscode: { postMessage: (msg: unknown) => void } }> = ({
  onClose,
  vscode
}) => {
  const [version, setVersion] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [workdir, setWorkdir] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    vscode?.postMessage({ command: 'getStatus' });
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
    // Defer registration to the next tick so the click that opened this dialog
    // (still bubbling to document) doesn't immediately trigger the outside-close.
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [onClose]);

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
            <div className="configuration-field">
              <label>版本:</label>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '13px',
                color: 'var(--vscode-descriptionForeground)',
                fontFamily: 'var(--vscode-editor-font-family, monospace)',
                wordBreak: 'break-all',
                padding: '4px 0'
              }}>
                <span>{version || '—'}</span>
                <button type="button" onClick={() => vscode?.postMessage({ command: 'checkForUpdates' })} className="configuration-cancel-btn" style={{ padding: '2px 8px' }}>
                  检查更新
                </button>
              </div>
            </div>
            <StatusRow label="Session ID" value={sessionId} />
            <StatusRow label="工作目录" value={workdir} />
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
