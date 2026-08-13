/**
 * Persistence for MCP tool-returned images.
 *
 * MCP tools can return image content blocks as in-memory base64. When the
 * agent's model does not support vision, the image is written to a temp file
 * so convertMessagesForAPI can attach `[Image source: <path>]` metadata and
 * the main model can delegate recognition to the vision subagent (which reads
 * the path with the Read tool). Vision-capable models keep the inline base64
 * and never write to disk.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { logger } from "./globalLogger.js";

const MCP_IMAGES_DIR = path.join(os.tmpdir(), "wave-mcp-images");

/** Map MCP mimeType to a file extension. Unknown types fall back to .png. */
const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
  "image/x-icon": ".ico",
  "image/tiff": ".tiff",
};

export interface PersistedToolImage {
  data: string; // Base64 encoded image data
  mediaType?: string; // Media type of the image
  path?: string; // Temp file path, set when the image was persisted
}

/**
 * Persist base64 images to temp files under /tmp/wave-mcp-images/.
 * Uses the OS tmpdir for simplicity and automatic OS cleanup (same convention
 * as /tmp/wave-tool-results/). Returns each image unchanged (no path) when the
 * write fails, so the caller degrades to the placeholder-only behavior.
 */
export function persistToolImages(
  images: Array<{ data: string; mediaType?: string }>,
): PersistedToolImage[] {
  return images.map((image) => {
    try {
      fs.mkdirSync(MCP_IMAGES_DIR, { recursive: true });
      // Strip a data: URL prefix if present (MCP spec carries raw base64, but
      // be defensive about dataURL-formatted data).
      let data = image.data;
      if (data.startsWith("data:")) {
        const commaIndex = data.indexOf(",");
        data = commaIndex >= 0 ? data.slice(commaIndex + 1) : data;
      }
      const ext = MIME_TO_EXT[image.mediaType || ""] || ".png";
      const id = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const filePath = path.join(MCP_IMAGES_DIR, `mcp-image_${id}${ext}`);
      fs.writeFileSync(filePath, Buffer.from(data, "base64"));
      return { ...image, path: filePath };
    } catch (error) {
      logger?.error("Failed to persist MCP tool image:", error);
      return image;
    }
  });
}
