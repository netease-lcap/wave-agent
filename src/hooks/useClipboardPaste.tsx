import { useCallback } from 'react';
import { readClipboardImage } from '../utils/clipboard';
import type { AttachedImage } from './useImageManager';

export const useClipboardPaste = (
  addImage: (imagePath: string, mimeType: string) => AttachedImage,
  insertTextAtCursor: (text: string) => void,
) => {
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
      console.warn('Failed to paste image from clipboard:', error);
      return false;
    }
  }, [addImage, insertTextAtCursor]);

  return { handlePasteImage };
};
