/**
 * ConfigDialog - General settings dialog for AI configuration
 *
 * Opened via the /config slash command. Contains language configuration.
 */

import React, { useState, useEffect, useRef } from 'react';
import { ConfigDialogProps, ConfigurationData, VsCodeApi } from '../types';
import '../styles/ConfigurationDialog.css';

const ConfigDialog: React.FC<ConfigDialogProps & { vscode: VsCodeApi }> = ({
  configurationData,
  isLoading,
  error,
  onSave,
  onCancel,
}) => {
  const [formData, setFormData] = useState<ConfigurationData>({
    language: 'Chinese'
  });

  const dialogRef = useRef<HTMLDivElement>(null);

  // Update form data when configurationData prop changes
  useEffect(() => {
    if (configurationData) {
      setFormData(configurationData);
    }
  }, [configurationData]);

  // Handle clicking outside to close dialog
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        onCancel();
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [onCancel]);

  const handleInputChange = (field: keyof ConfigurationData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="configuration-dialog-overlay">
      <div
        ref={dialogRef}
        className="configuration-dialog"
      >
        <div className="configuration-dialog-header">
          <h3>配置设置</h3>
        </div>

        <form onSubmit={handleSubmit} className="configuration-form">
          <div className="configuration-fields-scroll-area">
            <div className="configuration-field">
              <label htmlFor="language">语言 (Language):</label>
              <select
                id="language"
                value={formData.language}
                onChange={(e) => handleInputChange('language', e.target.value)}
                disabled={isLoading}
                className="configuration-select"
              >
                <option value="Chinese">中文</option>
                <option value="English">英文</option>
              </select>
            </div>

            {error && (
              <div className="configuration-error">
                {error}
              </div>
            )}
          </div>

          <div className="configuration-actions">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="configuration-cancel-btn"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="configuration-save-btn"
            >
              {isLoading ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ConfigDialog;
