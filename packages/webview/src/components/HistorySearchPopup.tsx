import React, { useEffect, useRef, useState, useCallback } from 'react';
import '../styles/HistorySearchPopup.css';
import { HistoryItem, VsCodeApi } from '../types';

interface HistorySearchPopupProps {
  isVisible: boolean;
  onSelect: (prompt: string) => void;
  onClose: () => void;
  position: { top: number; left: number };
  vscode: VsCodeApi;
}

export const HistorySearchPopup: React.FC<HistorySearchPopupProps> = ({
  isVisible,
  onSelect,
  onClose,
  position,
  vscode
}) => {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Handle clicks outside to close popup
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isVisible, onClose]);

  // Focus input when popup opens
  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
      // Request initial history
      setIsLoading(true);
      vscode.postMessage({ command: 'requestHistory' });
    } else {
      setQuery('');
      setItems([]);
      setSelectedIndex(0);
    }
  }, [isVisible, vscode]);

  // Handle messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.command === 'historyResponse') {
        setItems(data.history || []);
        setSelectedIndex(0);
        setIsLoading(false);
      } else if (data.command === 'historyError') {
        console.error('History error:', data.error);
        setIsLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Auto-scroll selected item into view when navigation happens
  useEffect(() => {
    if (!popupRef.current) return;
    const selectedItem = popupRef.current.querySelector('.history-search-item.selected');
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Debounced search
  useEffect(() => {
    if (isVisible && query.trim()) {
      const timer = setTimeout(() => {
        setIsLoading(true);
        vscode.postMessage({ command: 'searchHistory', query });
      }, 300);
      return () => clearTimeout(timer);
    } else if (isVisible && !query.trim()) {
      setIsLoading(true);
      vscode.postMessage({ command: 'requestHistory' });
    }
  }, [query, isVisible, vscode]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!isVisible) return;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        break;
      case 'ArrowDown':
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(Math.min(items.length, 50) - 1, prev + 1));
        break;
      case 'Enter':
        event.preventDefault();
        if (items[selectedIndex]) {
          onSelect(items[selectedIndex].prompt);
        }
        break;
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
    }
  }, [isVisible, items, selectedIndex, onSelect, onClose]);

  if (!isVisible) return null;

  return (
    <div
      ref={popupRef}
      className="history-search-popup"
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        zIndex: 1000
      }}
      data-testid="history-search-popup"
    >
      <div className="history-search-header">
        <span className="codicon codicon-history"></span>
        <input
          ref={inputRef}
          type="text"
          className="history-search-input"
          placeholder="搜索历史记录..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div className="history-search-results">
        {isLoading ? (
          <div className="history-search-loading">
            <span className="codicon codicon-loading codicon-modifier-spin"></span>
            正在加载...
          </div>
        ) : items.length === 0 ? (
          <div className="history-search-empty">
            未找到匹配的历史记录
          </div>
        ) : (
          <ul className="history-search-list">
            {items.slice(0, 50).map((item, index) => (
              <li
                key={`${item.timestamp}-${index}`}
                className={`history-search-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => onSelect(item.prompt)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="history-item-prompt">{item.prompt}</div>
                <div className="history-item-time">
                  {new Date(item.timestamp).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default HistorySearchPopup;
