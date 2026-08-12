/**
 * ConfigDialog - Settings dialog for AI configuration
 *
 * Opened via the /config slash command. Contains two tabs:
 * - Global settings (language)
 * - Direct connection settings (API Key, Base URL, Agent Model, Fast Model)
 */

import React, { useState, useEffect, useRef } from "react";
import { ConfigDialogProps, ConfigurationData, VsCodeApi } from "../types";
import { InfoIcon, CloseIcon } from "./HeaderIcons";
import "../styles/ConfigurationDialog.css";

type ConfigTab = "global" | "model" | "project";

const ConfigDialog: React.FC<ConfigDialogProps & { vscode: VsCodeApi }> = ({
  configurationData,
  isLoading,
  error,
  onSave,
  onCancel,
  projectSettings,
  onLoadProjectSettings,
  onToggleBuiltinPlugin,
}) => {
  const [formData, setFormData] = useState<ConfigurationData>({
    language: "Chinese",
  });
  const [activeTab, setActiveTab] = useState<ConfigTab>("global");
  // Pending state while a builtin-plugin toggle round-trips; prevents a
  // double-flip before the refreshed projectSettings arrives.
  const [toggling, setToggling] = useState(false);

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
      if (
        dialogRef.current &&
        !dialogRef.current.contains(event.target as Node)
      ) {
        onCancel();
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    // Defer registration to the next tick so the click that opened this dialog
    // (still bubbling to document) doesn't immediately trigger the outside-close.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    document.addEventListener("keydown", handleEscapeKey);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [onCancel]);

  // Lazy-load project settings when the 项目设置 tab is activated (and re-fetch
  // on each entry so external edits to .wave/settings.json are picked up).
  useEffect(() => {
    if (activeTab === "project") {
      onLoadProjectSettings?.();
    }
  }, [activeTab, onLoadProjectSettings]);

  // Clear the pending-toggle state once the refreshed projectSettings arrives.
  useEffect(() => {
    if (projectSettings) {
      setToggling(false);
    }
  }, [projectSettings]);

  const handleInputChange = (field: keyof ConfigurationData, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
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
        className="configuration-dialog config-dialog"
        data-testid="config-dialog"
      >
        <div className="configuration-dialog-header config-dialog-header">
          <h3>设置</h3>
          <button
            type="button"
            className="configuration-close-btn"
            aria-label="关闭"
            onClick={onCancel}
          >
            <CloseIcon className="configuration-close-icon" />
          </button>
        </div>

        <div className="config-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "global"}
            className={`config-tab${activeTab === "global" ? " active" : ""}`}
            onClick={() => setActiveTab("global")}
          >
            全局设置
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "model"}
            className={`config-tab${activeTab === "model" ? " active" : ""}`}
            onClick={() => setActiveTab("model")}
          >
            直连设置
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "project"}
            className={`config-tab${activeTab === "project" ? " active" : ""}`}
            onClick={() => setActiveTab("project")}
          >
            项目设置
          </button>
        </div>

        <form onSubmit={handleSubmit} className="configuration-form">
          <div className="configuration-fields-scroll-area">
            {activeTab === "global" && (
              <div className="configuration-field">
                <label htmlFor="language">语言 (Language)</label>
                <select
                  id="language"
                  value={formData.language}
                  onChange={(e) =>
                    handleInputChange("language", e.target.value)
                  }
                  disabled={isLoading}
                  className="configuration-select"
                >
                  <option value="Chinese">中文</option>
                  <option value="English">英文</option>
                </select>
              </div>
            )}

            {activeTab === "model" && (
              <>
                <div className="config-model-hint">
                  <InfoIcon className="config-model-hint-icon" />
                  <span>
                    保存后，优先使用此配置，无需登录即可正常使用插件。
                  </span>
                </div>

                <div className="configuration-field">
                  <label htmlFor="apiKey">API Key</label>
                  <input
                    id="apiKey"
                    type="text"
                    value={formData.apiKey || ""}
                    onChange={(e) =>
                      handleInputChange("apiKey", e.target.value)
                    }
                    disabled={isLoading}
                    placeholder="请输入 API Key"
                  />
                </div>

                <div className="configuration-field">
                  <label htmlFor="baseURL">Base URL</label>
                  <input
                    id="baseURL"
                    type="text"
                    value={formData.baseURL || ""}
                    onChange={(e) =>
                      handleInputChange("baseURL", e.target.value)
                    }
                    disabled={isLoading}
                    placeholder="请输入 Base URL"
                  />
                </div>

                <div className="configuration-field">
                  <label htmlFor="model">Agent Model</label>
                  <input
                    id="model"
                    type="text"
                    value={formData.model || ""}
                    onChange={(e) => handleInputChange("model", e.target.value)}
                    disabled={isLoading}
                    placeholder="请输入 Agent Model"
                  />
                </div>

                <div className="configuration-field">
                  <label htmlFor="fastModel">Fast Model</label>
                  <input
                    id="fastModel"
                    type="text"
                    value={formData.fastModel || ""}
                    onChange={(e) =>
                      handleInputChange("fastModel", e.target.value)
                    }
                    disabled={isLoading}
                    placeholder="请输入 Fast Model"
                  />
                </div>
              </>
            )}

            {activeTab === "project" && (
              <div className="configuration-field config-project-field">
                <div className="config-project-row">
                  <span className="config-project-title">SDD</span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      data-testid="sdd-toggle"
                      checked={
                        projectSettings?.enabledPlugins?.["sdd@builtin"] ===
                        true
                      }
                      disabled={toggling || !projectSettings}
                      onChange={() => {
                        const current =
                          projectSettings?.enabledPlugins?.["sdd@builtin"] ===
                          true;
                        setToggling(true);
                        onToggleBuiltinPlugin?.("sdd@builtin", !current);
                      }}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
                <div className="config-project-desc">
                  规格驱动开发（SDD）插件：自动创建或更新功能规格说明
                </div>
                <div className="config-model-hint config-project-hint">
                  <InfoIcon className="config-model-hint-icon" />
                  <span>切换后自动生效。</span>
                </div>
              </div>
            )}

            {error && <div className="configuration-error">{error}</div>}
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
            {activeTab !== "project" && (
              <button
                type="submit"
                disabled={isLoading}
                className="configuration-save-btn"
              >
                {isLoading ? "保存中..." : "保存"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default ConfigDialog;
