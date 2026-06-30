/**
 * ModelDialog - Model selection dialog
 *
 * Opened via the /model slash command. Shows dropdown selects for model and fast model,
 * populated with configured models from the SDK.
 */

import React, { useState, useEffect, useRef } from 'react';
import { ModelDialogProps, VsCodeApi } from '../types';
import '../styles/ConfigurationDialog.css';

const ModelDialog: React.FC<ModelDialogProps & { vscode: VsCodeApi }> = ({
  configurationData,
  configuredModels,
  onSave,
  onClose,
}) => {
  const [model, setModel] = useState('');
  const [fastModel, setFastModel] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setModel(configurationData?.model || '');
    setFastModel(configurationData?.fastModel || '');
  }, [configurationData]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    onSave({ model, fastModel });
  };

  return (
    <div className="configuration-dialog-overlay">
      <div ref={dialogRef} className="configuration-dialog">
        <div className="configuration-dialog-header">
          <h3>模型设置</h3>
        </div>

        <form onSubmit={handleSubmit} className="configuration-form">
          <div className="configuration-fields-scroll-area">
            {configuredModels.length > 0 ? (
              <>
                <div className="configuration-field">
                  <label htmlFor="model-select">Model:</label>
                  <select
                    id="model-select"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    autoFocus
                  >
                    {configuredModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                <div className="configuration-field">
                  <label htmlFor="fast-model-select">Fast Model:</label>
                  <select
                    id="fast-model-select"
                    value={fastModel}
                    onChange={(e) => setFastModel(e.target.value)}
                  >
                    {configuredModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div className="model-empty-hint">
                没有可用的模型，请检查配置。
              </div>
            )}
          </div>

          <div className="configuration-actions">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="configuration-cancel-btn"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving || configuredModels.length === 0}
              className="configuration-save-btn"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModelDialog;
