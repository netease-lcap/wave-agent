import React from 'react';
import type { AttachedImagesProps } from '../types';
import '../styles/AttachedImages.css';

/**
 * Component for displaying attached images as icons with delete functionality
 */
export const AttachedImages: React.FC<AttachedImagesProps> = ({
  images,
  onRemove
}) => {
  if (images.length === 0) {
    return null;
  }

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getImageType = (mimeType: string): string => {
    switch (mimeType) {
      case 'image/png': return 'PNG';
      case 'image/jpeg': return 'JPG';
      case 'image/gif': return 'GIF';
      case 'image/webp': return 'WEBP';
      case 'image/svg+xml': return 'SVG';
      default: return 'IMG';
    }
  };

  return (
    <div className="attached-images">
      {images.map((image) => (
        <div key={image.id} className="image-item" title={`${image.filename || 'Image'} (${formatFileSize(image.size)})`}>
          <div className="image-icon">
            <span className="image-type">{getImageType(image.mimeType)}</span>
          </div>
          <div className="image-info">
            <span className="image-name">{image.filename || 'Image'}</span>
            <span className="image-size">{formatFileSize(image.size)}</span>
          </div>
          <button
            className="remove-image-btn"
            onClick={() => onRemove(image.id)}
            title="Remove image"
            type="button"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};