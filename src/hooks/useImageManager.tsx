import { useState, useCallback } from 'react';

export interface AttachedImage {
  id: number;
  path: string;
  mimeType: string;
}

export const useImageManager = () => {
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [imageIdCounter, setImageIdCounter] = useState(1);

  const addImage = useCallback(
    (imagePath: string, mimeType: string) => {
      const newImage: AttachedImage = {
        id: imageIdCounter,
        path: imagePath,
        mimeType,
      };
      setAttachedImages((prev) => [...prev, newImage]);
      setImageIdCounter((prev) => prev + 1);
      return newImage;
    },
    [imageIdCounter],
  );

  const removeImage = useCallback((imageId: number) => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== imageId));
  }, []);

  const clearImages = useCallback(() => {
    setAttachedImages([]);
  }, []);

  return {
    attachedImages,
    addImage,
    removeImage,
    clearImages,
  };
};
