import { useState, useCallback } from "react";
import { readClipboardImage } from "wave-agent-sdk";

export interface AttachedImage {
  id: number;
  path: string;
  mimeType: string;
}

export const useImageManager = (insertTextAtCursor: (text: string) => void) => {
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

  const handlePasteImage = useCallback(async () => {
    try {
      const result = await readClipboardImage();

      if (result.success && result.imagePath && result.mimeType) {
        // 添加图片到管理器
        const attachedImage = addImage(result.imagePath, result.mimeType);

        // 在光标位置插入图片占位符
        insertTextAtCursor(`[Image #${attachedImage.id}]`);

        return true;
      }

      return false;
    } catch (error) {
      console.warn("Failed to paste image from clipboard:", error);
      return false;
    }
  }, [addImage, insertTextAtCursor]);

  return {
    attachedImages,
    addImage,
    removeImage,
    clearImages,
    handlePasteImage,
  };
};
