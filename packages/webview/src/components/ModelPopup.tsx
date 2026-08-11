import React, { useEffect, useRef, useState, useCallback } from 'react';
import '../styles/ModelPopup.css';

interface ModelPopupProps {
  isVisible: boolean;
  isLoading: boolean;
  models: string[];
  currentModel?: string;
  onSelect: (model: string) => void;
  onClose: () => void;
}

// /model picker: configured models listed above the input, navigable with
// ArrowUp/ArrowDown, Enter/click to pick, Esc to cancel. The current model is
// marked with a check icon and highlighted by default.
export const ModelPopup: React.FC<ModelPopupProps> = ({
  isVisible,
  isLoading,
  models,
  currentModel,
  onSelect,
  onClose
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const popupRef = useRef<HTMLDivElement>(null);

  // Default selection: the current model (first item as fallback).
  useEffect(() => {
    const currentIndex = models.indexOf(currentModel || '');
    setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
  }, [models, currentModel]);

  // Grab keyboard focus while open; the container owns the keydown handler.
  useEffect(() => {
    if (isVisible) popupRef.current?.focus();
  }, [isVisible]);

  // Handle clicks outside to close popup
  useEffect(() => {
    if (!isVisible) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVisible, onClose]);

  // Auto-scroll selected item into view when navigation happens
  useEffect(() => {
    if (!popupRef.current) return;
    const selectedItem = popupRef.current.querySelector('.model-popup-item.selected');
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!isVisible) return;

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        break;
      case 'ArrowDown':
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(models.length - 1, prev + 1));
        break;
      case 'Enter':
        event.preventDefault();
        if (models[selectedIndex]) {
          onSelect(models[selectedIndex]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
    }
  }, [isVisible, models, selectedIndex, onSelect, onClose]);

  if (!isVisible) return null;

  return (
    <div
      ref={popupRef}
      className="model-popup"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-testid="model-popup"
    >
      <div className="model-popup-header">选择模型</div>
      {isLoading ? (
        <div className="model-popup-loading">
          <span className="codicon codicon-loading codicon-modifier-spin"></span>
          正在加载...
        </div>
      ) : models.length === 0 ? (
        <div className="model-popup-empty">
          没有已配置的模型
        </div>
      ) : (
        <ul className="model-popup-list">
          {models.map((model, index) => (
            <li
              key={model}
              className={`model-popup-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => onSelect(model)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="model-popup-item-name">{model}</span>
              {model === currentModel && (
                <span className="codicon codicon-check model-popup-item-check" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ModelPopup;
