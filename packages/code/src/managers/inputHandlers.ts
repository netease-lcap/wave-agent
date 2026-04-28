import { readClipboardImage } from "../utils/clipboard.js";
import { InputAction } from "./inputReducer.js";

export const handlePasteImage = async (
  dispatch: React.Dispatch<InputAction>,
): Promise<boolean> => {
  try {
    const result = await readClipboardImage();

    if (result.success && result.imagePath && result.mimeType) {
      dispatch({
        type: "ADD_IMAGE_AND_INSERT_PLACEHOLDER",
        payload: { path: result.imagePath, mimeType: result.mimeType },
      });
      return true;
    }

    return false;
  } catch (error) {
    console.warn("Failed to paste image from clipboard:", error);
    return false;
  }
};
