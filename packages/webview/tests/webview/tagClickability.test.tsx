import { renderChatApp, sendCommand, fireEvent } from "./test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

/** 发送过的 webview→host 消息（按命令过滤）。 */
const sentCommands = (vscode: { postMessage: unknown }) =>
  (vscode.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => c[0] as { command: string; path?: string },
  );

/** 会让宿主动手打开图片的命令：就地弹层的那条路径不该发出任何一条。 */
const hostOpeningCommands = (vscode: { postMessage: unknown }) =>
  sentCommands(vscode).filter(
    (m) => m.command === "previewImage" || m.command === "openFile",
  );

describe("Tag Clickability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.waveHostType;
    delete window.waveRemotePage;
    // 弹层是直接挂到 document.body 的原生节点，unmount 不会带走它。
    document
      .querySelectorAll(".image-preview-modal")
      .forEach((node) => node.remove());
  });

  it("should not have clickable class for regular file and directory tags in messages", () => {
    renderChatApp();

    const messages = [
      {
        id: "msg1",
        role: "user" as const,
        timestamp: "2024-01-01T00:00:00.000Z",
        blocks: [
          {
            type: "text" as const,
            content:
              "Check this file [@file:/workspace/src/main.ts] and this directory [@file:/workspace/src/].",
          },
        ],
      },
    ];

    sendCommand("updateMessages", { messages });

    const userMessage = document.querySelector(".message.user");
    expect(userMessage).toBeInTheDocument();

    const contextTags = userMessage!.querySelectorAll(".context-tag");
    expect(contextTags.length).toBe(2);

    // File tag should not be clickable
    const fileTag = Array.from(contextTags).find((tag) =>
      tag.textContent?.includes("main.ts"),
    );
    expect(fileTag).toBeDefined();
    expect(fileTag!.className).not.toMatch(/clickable/);

    // Directory tag should not be clickable
    const dirTag = Array.from(contextTags).find((tag) =>
      tag.textContent?.includes("src"),
    );
    expect(dirTag).toBeDefined();
    expect(dirTag!.className).not.toMatch(/clickable/);
  });

  it("renders an @-mentioned image as a plain file tag, without a preview", () => {
    // @ 选中的图片就是普通文件引用（spec ui/file-selector.md 场景 1/6）：
    // 不带 is-image、不可点，点了也不向宿主要预览。
    const { vscode } = renderChatApp();

    const messages = [
      {
        id: "msg2",
        role: "user" as const,
        timestamp: "2024-01-01T00:00:00.000Z",
        blocks: [
          {
            type: "text" as const,
            content: "Check this image [@file:/workspace/images/logo.png].",
          },
        ],
      },
    ];

    sendCommand("updateMessages", { messages });

    const userMessage = document.querySelector(".message.user");
    expect(userMessage).toBeInTheDocument();

    const imageTag = userMessage!.querySelector(".context-tag");
    expect(imageTag).toBeInTheDocument();
    expect(imageTag!.className).not.toMatch(/is-image/);
    expect(imageTag!.className).not.toMatch(/clickable/);

    fireEvent.click(imageTag!);
    expect(hostOpeningCommands(vscode)).toEqual([]);
  });

  it("should have clickable class for code selection tags in messages", () => {
    renderChatApp();

    const messages = [
      {
        id: "msg3",
        role: "user" as const,
        timestamp: "2024-01-01T00:00:00.000Z",
        blocks: [
          {
            type: "text" as const,
            content:
              "Check this selection [Selection: /workspace/src/main.ts|main.ts#10-20].",
          },
        ],
      },
    ];

    sendCommand("updateMessages", { messages });

    const userMessage = document.querySelector(".message.user");
    expect(userMessage).toBeInTheDocument();

    const selectionTag = Array.from(
      userMessage!.querySelectorAll(".context-tag"),
    ).find((tag) => tag.textContent?.includes("main.ts#10-20"));
    expect(selectionTag).toBeDefined();
    expect(selectionTag!.className).toMatch(/clickable/);
  });

  it("should have clickable class for inline image tags (pasted images)", () => {
    renderChatApp();

    const messages = [
      {
        id: "msg4",
        role: "user" as const,
        timestamp: "2024-01-01T00:00:00.000Z",
        blocks: [
          {
            type: "text" as const,
            content: "Check this pasted image [image1].",
          },
          {
            type: "image" as const,
            imageUrls: [
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            ],
          },
        ],
      },
    ];

    sendCommand("updateMessages", { messages });

    const userMessage = document.querySelector(".message.user");
    expect(userMessage).toBeInTheDocument();

    const inlineImageTag = userMessage!.querySelector(".context-tag.is-image");
    expect(inlineImageTag).toBeInTheDocument();
    expect(inlineImageTag!.className).toMatch(/clickable/);
  });

  /**
   * 已发送图片的标签点开时该找谁要字节（spec ui/image-pasting.md「已发送图片的
   * 标签点开就能看」）：判据是**值里有没有字节**（这些标签都来自 `[imageN]`，
   * 用户用 `@` 选的文件引用是普通标签，不可点，见上面的用例）。
   *
   * - 粘贴图：字节留在块里（`imageUrls` 是 data URL），CLI 只是另把同一份字节落盘
   *   并把路径记进 `imagePaths` 喂模型 ⇒ 三端都就地弹层，不打扰宿主；
   * - 值本身是路径（前台 CLI 粘贴、改造前的老消息）⇒ 交给宿主打开。
   */
  const PASTED_IMAGE_DATA_URL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  /** 宿主那台机器上的临时文件，只喂 `[Image source: <path>]`。 */
  const PASTED_IMAGE_FILE_PATH = "/tmp/wave-image-1700000000-abc123.png";
  /** 值本身是路径的图片标签（前台 CLI 粘贴 / 改造前的老消息）。 */
  const REFERENCED_IMAGE_PATH = "/workspace/images/logo.png";

  const renderSentImageTag = (imageUrls: string[], imagePaths?: string[]) => {
    const { vscode } = renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        {
          id: "msg-sent-image",
          role: "user" as const,
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [
            { type: "text" as const, content: "看这张图 [image1]" },
            { type: "image" as const, imageUrls, imagePaths },
          ],
        },
      ],
    });
    const tag = document.querySelector(
      ".message.user .context-tag.is-image",
    ) as HTMLElement;
    return { vscode, tag };
  };

  it("previews a pasted image in place without asking the host", () => {
    const { vscode, tag } = renderSentImageTag(
      [PASTED_IMAGE_DATA_URL],
      [PASTED_IMAGE_FILE_PATH],
    );
    expect(tag.className).toMatch(/clickable/);

    fireEvent.click(tag);

    const modal = document.querySelector(".image-preview-modal");
    expect(modal).toBeInTheDocument();
    expect(modal?.querySelector("img")?.getAttribute("src")).toBe(
      PASTED_IMAGE_DATA_URL,
    );
    expect(hostOpeningCommands(vscode)).toEqual([]);
  });

  it("previews a pasted image in place on the desktop host too", () => {
    window.waveHostType = "desktop";
    const { vscode, tag } = renderSentImageTag(
      [PASTED_IMAGE_DATA_URL],
      [PASTED_IMAGE_FILE_PATH],
    );

    fireEvent.click(tag);

    expect(document.querySelector(".image-preview-modal")).toBeInTheDocument();
    expect(hostOpeningCommands(vscode)).toEqual([]);
  });

  it("hands a path-valued image tag to the host on the IDE hosts", () => {
    const { vscode, tag } = renderSentImageTag([REFERENCED_IMAGE_PATH]);

    fireEvent.click(tag);

    // 值里没有字节：交给宿主的图片预览命令，绝不在页面里加载那个路径（SSH
    // 会话里页面手里的路径是本机的，远端文件加载不出来）
    expect(document.querySelector(".image-preview-modal")).toBeNull();
    expect(sentCommands(vscode)).toContainEqual({
      command: "previewImage",
      path: REFERENCED_IMAGE_PATH,
    });
  });

  it("opens a path-valued image tag through the file panel on the desktop host", () => {
    window.waveHostType = "desktop";
    const { vscode, tag } = renderSentImageTag([REFERENCED_IMAGE_PATH]);

    fireEvent.click(tag);

    expect(document.querySelector(".image-preview-modal")).toBeNull();
    const openFileMsg = sentCommands(vscode).find(
      (m) => m.command === "openFile",
    );
    expect(openFileMsg?.path).toBe(REFERENCED_IMAGE_PATH);
  });

  it("leaves a sent image tag unclickable on the remote Web page", () => {
    // 远控 Web 页读不到这台电脑上的文件，而且发往中继的帧把粘贴图字节剥成了空串
    // （spec ui/remote-control.md 场景 10）：不给「看着能点、点了没反应」的入口
    // （场景 23/24）。未发送的草稿图不受影响，那些字节就在浏览器里。
    window.waveRemotePage = true;
    const { vscode, tag } = renderSentImageTag([""]);
    expect(tag).toBeInTheDocument();
    expect(tag.className).not.toMatch(/clickable/);

    fireEvent.click(tag);
    expect(hostOpeningCommands(vscode)).toEqual([]);
  });
});
