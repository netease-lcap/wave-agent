import React, { useEffect, useRef } from 'react';
import { FileSuggestionDropdownProps, FileItem } from '../types';
import '../styles/FileSuggestionDropdown.css';

/**
 * FileSuggestionDropdown - A dropdown component for file suggestions
 *
 * This component displays a list of file suggestions when the user types @ in the message input.
 * It supports keyboard navigation and file icons using VS Code's codicon font.
 */
export const FileSuggestionDropdown: React.FC<FileSuggestionDropdownProps> = ({
  suggestions,
  isVisible,
  selectedIndex,
  onSelect,
  onClose,
  position,
  filterText,
  isLoading = false
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Handle clicks outside dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isVisible, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (dropdownRef.current && selectedIndex >= -1) {
      const hasUploadOption = !filterText;
      let actualIndex = selectedIndex;
      if (hasUploadOption) {
        actualIndex = selectedIndex + 1;
      }
      
      if (actualIndex >= 0 && actualIndex < dropdownRef.current.children.length) {
        const selectedElement = dropdownRef.current.children[actualIndex] as HTMLElement;
        if (selectedElement) {
          selectedElement.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth'
          });
        }
      }
    }
  }, [selectedIndex, filterText]);

  if (!isVisible) {
    return null;
  }

  /**
   * Highlights matching text in the file name based on filter text
   */
  const highlightMatch = (text: string, filter: string): React.ReactNode => {
    if (!filter) return text;

    const lowerText = text.toLowerCase();
    const lowerFilter = filter.toLowerCase();
    const index = lowerText.indexOf(lowerFilter);

    if (index === -1) return text;

    return (
      <>
        {text.slice(0, index)}
        <span className="suggestion-highlight">
          {text.slice(index, index + filter.length)}
        </span>
        {text.slice(index + filter.length)}
      </>
    );
  };

  /**
   * Truncates long file paths for display
   */
  const truncatePath = (path: string, maxLength: number = 50): string => {
    if (path.length <= maxLength) return path;
    return '...' + path.slice(path.length - maxLength + 3);
  };

  return (
    <div
      ref={dropdownRef}
      className="file-suggestion-dropdown"
      style={{
        position: 'absolute',
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      {/* Show upload option only when there's no filter text */}
      {!filterText && (
        <div
          key="upload-option"
          className={`suggestion-item upload-option ${selectedIndex === -1 ? 'selected' : ''}`}
          onClick={() => onSelect({
            path: '__upload__',
            relativePath: '__upload__',
            name: '上传本地文件',
            extension: '',
            icon: 'codicon-cloud-upload',
            isDirectory: false,
            isUploadOption: true
          })}
        >
          <span className="suggestion-icon codicon codicon-cloud-upload"></span>
          <div className="suggestion-content">
            <div className="suggestion-name">上传本地文件</div>
            <div className="suggestion-path">选择本地文件上传到临时目录</div>
          </div>
        </div>
      )}
      
      {suggestions.map((file: FileItem, index: number) => (
        <div
          key={file.path}
          className={`suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
          onClick={() => onSelect(file)}
          onMouseEnter={() => {
            // Optional: Update selected index on hover
            // This would need to be handled by parent component
          }}
        >
          <span className={`suggestion-icon codicon ${file.icon}`}></span>
          <div className="suggestion-content">
            <div className="suggestion-name">
              {highlightMatch(file.name, filterText)}
            </div>
            <div className="suggestion-path">
              {truncatePath(file.relativePath)}
            </div>
          </div>
        </div>
      ))}
      {isLoading && suggestions.length === 0 && (
        <div className="suggestion-item suggestion-empty">
          <span className="codicon codicon-loading"></span>
          <div className="suggestion-content">
            <div className="suggestion-name">正在搜索文件...</div>
            <div className="suggestion-path">请稍等</div>
          </div>
        </div>
      )}
      {!isLoading && suggestions.length === 0 && filterText && (
        <div className="suggestion-item suggestion-empty">
          <span className="codicon codicon-search"></span>
          <div className="suggestion-content">
            <div className="suggestion-name">未找到匹配的文件</div>
            <div className="suggestion-path">尝试修改搜索关键词</div>
          </div>
        </div>
      )}
      {!isLoading && suggestions.length === 0 && !filterText && (
        <div className="suggestion-item suggestion-empty">
          <span className="codicon codicon-folder"></span>
          <div className="suggestion-content">
            <div className="suggestion-name">开始输入文件名</div>
            <div className="suggestion-path">输入文件名或路径进行搜索</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileSuggestionDropdown;