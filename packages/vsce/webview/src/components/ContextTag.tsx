import React from 'react';
import { Tooltip } from './Tooltip';
import './ContextTag.css';

interface ContextTagProps {
  name: string;
  path: string;
  isImage?: boolean;
  onClick?: () => void;
}

export const ContextTag: React.FC<ContextTagProps> = ({ name, path, isImage, onClick }) => {
  const isClickable = onClick !== undefined;

  const handlePreview = (e: React.MouseEvent) => {
    if (isClickable) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }
  };

  return (
    <Tooltip text={isClickable ? `点击查看 ${name}` : path} position="top">
      <span 
        className={`context-tag ${isClickable ? 'clickable' : ''} ${isImage ? 'is-image' : ''}`}
        onClick={handlePreview}
        aria-label={isClickable ? `点击查看 ${name}` : path}
        data-path={path}
      >
        <span className="tag-at">@</span>
        <span className="tag-name">{name}</span>
      </span>
    </Tooltip>
  );
};
