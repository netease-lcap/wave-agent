import React from 'react';
import '../styles/DesktopApp.css';

export interface WorkdirSelectorProps {
  recentWorkdirs: string[];
  onSelect: () => void;
  onSelectRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
  onUseTemp: () => void;
  // Shown when the selector is opened as an overlay over an active chat
  // (workdir switch) — lets the user back out without choosing.
  onCancel?: () => void;
}

/**
 * Full-window workdir picker for the desktop host: shown on first launch when
 * no workdir is stored, and as an overlay when switching workdirs.
 */
export const WorkdirSelector: React.FC<WorkdirSelectorProps> = ({
  recentWorkdirs,
  onSelect,
  onSelectRecent,
  onRemoveRecent,
  onUseTemp,
  onCancel,
}) => {
  return (
    <div className="workdir-selector" data-testid="workdir-selector">
      <div className="workdir-selector-panel">
        <div className="workdir-selector-title">Wave 代码智聊</div>
        <div className="workdir-selector-subtitle">选择一个工作目录开始</div>
        <button
          className="workdir-selector-primary"
          onClick={onSelect}
          data-testid="workdir-selector-open"
        >
          <span className="codicon codicon-folder-opened"></span>
          选择工作目录
        </button>
        {recentWorkdirs.length > 0 && (
          <div className="workdir-selector-recent">
            <div className="workdir-selector-recent-label">最近打开</div>
            {recentWorkdirs.map((dir) => (
              <div
                key={dir}
                className="workdir-selector-recent-item"
                onClick={() => onSelectRecent(dir)}
                title={dir}
                data-testid="workdir-selector-recent-item"
              >
                <span className="codicon codicon-folder"></span>
                <span className="workdir-selector-recent-path">{dir}</span>
                <button
                  className="workdir-selector-recent-remove"
                  title="从列表移除"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveRecent(dir);
                  }}
                >
                  <span className="codicon codicon-close"></span>
                </button>
              </div>
            ))}
          </div>
        )}
        <button className="workdir-selector-temp" onClick={onUseTemp}>
          使用临时目录
        </button>
        {onCancel && (
          <button className="workdir-selector-cancel" onClick={onCancel}>
            取消
          </button>
        )}
      </div>
    </div>
  );
};

export default WorkdirSelector;
