import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderChatApp, screen, waitFor } from "./test-utils";

/** 1x1 transparent PNG — valid image (magic + IEND tail intact). */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Build a real paste event carrying the given files (the browser has both). */
function createImagePasteEvent(files: File[]): ClipboardEvent {
  const dataTransfer = new DataTransfer();
  files.forEach((file) => dataTransfer.items.add(file));
  return new ClipboardEvent("paste", {
    bubbles: true,
    cancelable: true,
    clipboardData: dataTransfer,
  });
}

function makeImageFile(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes as unknown as BlobPart], name, { type });
}

/** One paste event carrying all files, like a real clipboard paste. */
async function pasteIntoInput(files: File[]) {
  const messageInput = screen.getByTestId("message-input");
  messageInput.focus();
  await act(async () => {
    messageInput.dispatchEvent(createImagePasteEvent(files));
  });
  return messageInput;
}

function imageTags(input: HTMLElement): NodeListOf<Element> {
  return input.querySelectorAll('.context-tag-container[data-is-image="true"]');
}

function postedErrors(vscode: {
  postMessage: { mock: { calls: unknown[][] } };
}): string[] {
  return vscode.postMessage.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((m) => m.command === "showError")
    .map((m) => String(m.message));
}

describe("image paste validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops a zero-byte image and tells the user why", async () => {
    const { vscode } = renderChatApp();

    const input = await pasteIntoInput([
      makeImageFile(new Uint8Array(), "empty.png", "image/png"),
    ]);

    await waitFor(() => {
      expect(postedErrors(vscode)).toHaveLength(1);
    });

    expect(postedErrors(vscode)[0]).toContain("数据为空");
    expect(imageTags(input)).toHaveLength(0);
  });

  it("drops text bytes renamed to .png and tells the user why", async () => {
    const { vscode } = renderChatApp();
    const textBytes = new TextEncoder().encode(
      "this is not an image at all, just text",
    );

    const input = await pasteIntoInput([
      makeImageFile(textBytes, "fake.png", "image/png"),
    ]);

    await waitFor(() => {
      expect(postedErrors(vscode)).toHaveLength(1);
    });

    expect(postedErrors(vscode)[0]).toContain("数据不完整或不是有效图片");
    expect(imageTags(input)).toHaveLength(0);
  });

  it("rejects a corrupt PNG that the browser decoder cannot decode", async () => {
    // The reported 400 path: the PNG header/tail are intact but the pixel data
    // is garbage, so only the host decoder rejects it.
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("Invalid image")),
    );
    const { vscode } = renderChatApp();

    const input = await pasteIntoInput([
      makeImageFile(bytesFromBase64(TINY_PNG_BASE64), "bad.png", "image/png"),
    ]);

    await waitFor(() => {
      expect(postedErrors(vscode)).toHaveLength(1);
    });

    expect(postedErrors(vscode)[0]).toContain("数据不完整或不是有效图片");
    expect(imageTags(input)).toHaveLength(0);
  });

  it("rejects formats outside the whitelist (bmp / svg)", async () => {
    const { vscode } = renderChatApp();
    const bmpBytes = new Uint8Array([
      0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const svgBytes = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
    );

    const input = await pasteIntoInput([
      makeImageFile(bmpBytes, "a.bmp", "image/bmp"),
      makeImageFile(svgBytes, "a.svg", "image/svg+xml"),
    ]);

    await waitFor(() => {
      expect(postedErrors(vscode)).toHaveLength(1);
    });

    // One combined prompt for the rejected batch.
    expect(postedErrors(vscode)[0]).toContain(
      "只支持 PNG / JPEG / GIF / WebP 格式的图片",
    );
    expect(imageTags(input)).toHaveLength(0);
  });

  it("still accepts a valid PNG (no over-blocking)", async () => {
    const { vscode } = renderChatApp();

    const input = await pasteIntoInput([
      makeImageFile(bytesFromBase64(TINY_PNG_BASE64), "ok.png", "image/png"),
    ]);

    await waitFor(() => {
      expect(imageTags(input)).toHaveLength(1);
    });

    expect(postedErrors(vscode)).toHaveLength(0);
    expect(
      input.querySelector<HTMLElement>('[data-is-image="true"]')?.dataset.name,
    ).toBe("图片 1");
  });

  it("keeps valid images and reports the ones it dropped", async () => {
    const { vscode } = renderChatApp();

    const input = await pasteIntoInput([
      makeImageFile(bytesFromBase64(TINY_PNG_BASE64), "ok.png", "image/png"),
      makeImageFile(new Uint8Array(), "empty.png", "image/png"),
    ]);

    await waitFor(() => {
      expect(imageTags(input)).toHaveLength(1);
    });

    expect(postedErrors(vscode)).toHaveLength(1);
    expect(postedErrors(vscode)[0]).toContain("数据为空");
  });
});
