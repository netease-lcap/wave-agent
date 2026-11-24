import { describe, it, expect } from "vitest";
import {
  renderSendUserFileResultData,
  type SendUserFileAttachmentData,
} from "../../../src/tools/resultData/sendUserFile.js";

function attachment(
  overrides: Partial<SendUserFileAttachmentData> = {},
): SendUserFileAttachmentData {
  return {
    path: "/fake/project/report.md",
    size: 1024,
    isImage: false,
    name: "report.md",
    kind: "text",
    ...overrides,
  };
}

describe("SendUserFile 的 data → 文本", () => {
  it("照 CC 那一档：一句回执 + 卡片位置提示，不逐条列路径", () => {
    const text = renderSendUserFileResultData({ attachments: [attachment()] });
    expect(text.split("\n")[0]).toBe("1 file delivered to user.");
    expect(text).toContain(
      "Each file shows as a card whose position relative to your text depends on the app the user is reading in, so refer to a file by its name, never as above or below.",
    );
    // CC 的路径行只出现在 file_uuid / project_path 两个上传档，我方没有那一层。
    expect(text).not.toContain("/fake/project/report.md");
  });

  it("多个文件用复数", () => {
    const text = renderSendUserFileResultData({
      attachments: [
        attachment(),
        attachment({
          path: "/fake/project/shot.png",
          name: "shot.png",
          kind: "image",
          isImage: true,
        }),
      ],
    });
    expect(text.split("\n")[0]).toBe("2 files delivered to user.");
  });

  it("caption 只出现时给一行", () => {
    expect(
      renderSendUserFileResultData({
        attachments: [attachment()],
        caption: "the finished report",
      }),
    ).toContain("Caption: the finished report");
    expect(
      renderSendUserFileResultData({ attachments: [attachment()] }),
    ).not.toContain("Caption:");
  });

  it("交付了可执行文件时说明它不会被打开", () => {
    const text = renderSendUserFileResultData({
      attachments: [
        attachment({
          path: "/fake/project/setup.exe",
          name: "setup.exe",
          kind: "other",
        }),
      ],
    });
    expect(text).toContain("Executables are shown but never opened.");
  });
});
