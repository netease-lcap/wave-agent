import React from "react";
import { Tooltip } from "./Tooltip";
import "./ContextTag.css";

interface ContextTagProps {
  name: string;
  path: string;
  isImage?: boolean;
  onClick?: () => void;
}

export const ContextTag: React.FC<ContextTagProps> = ({
  name,
  path,
  isImage,
  onClick,
}) => {
  const isClickable = onClick !== undefined;

  const handlePreview = (e: React.MouseEvent) => {
    if (isClickable) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (isClickable) onClick();
    }
  };

  return (
    <Tooltip text={isClickable ? `点击查看 ${name}` : path} position="top">
      <span
        className={`context-tag ${isClickable ? "clickable" : ""} ${isImage ? "is-image" : ""}`}
        onClick={handlePreview}
        onKeyDown={isClickable ? handleKeyDown : undefined}
        aria-label={isClickable ? `点击查看 ${name}` : path}
        role={isClickable ? "button" : undefined}
        tabIndex={isClickable ? 0 : undefined}
        data-path={path}
      >
        <span className="tag-at">@</span>
        <span className="tag-name">{name}</span>
      </span>
    </Tooltip>
  );
};
