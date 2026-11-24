import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  sendCommand,
  fireEvent,
  act,
  waitFor,
} from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";
import { SEND_USER_FILE_TOOL_NAME } from "wave-agent-sdk/constants";
import type { Message, ToolBlock } from "wave-agent-sdk/types";

type DeliveredEntry = { path: string; name: string; kind: string };

/**
 * A `SendUserFile` result as the tool actually emits it: the list lives in
 * `ToolBlock.data.attachments` (CC's `SendUserFile` outputSchema). The `result`
 * text is only what the model reads back, and `metadata` exists solely for
 * transcripts written before issue #3055 阶段 2.
 */
function deliveredMessage(files: DeliveredEntry[], caption?: string): Message {
  const message = MockDataGenerator.createAssistantMessageWithTool(
    "Here is the finished report.",
    SEND_USER_FILE_TOOL_NAME,
    '{"files":[]}',
    "1 file delivered to user.",
  );
  const block = message.blocks?.find(
    (candidate) => candidate.type === "tool",
  ) as ToolBlock;
  block.data = caption
    ? { attachments: files, caption }
    : { attachments: files };
  return message;
}

/** The click targets: one card per delivered file. */
function deliveredCards(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll(".delivered-file"),
  ) as HTMLElement[];
}

function sentCommands(vscode: unknown): Array<Record<string, unknown>> {
  const postMessage = (vscode as { postMessage: ReturnType<typeof vi.fn> })
    .postMessage;
  return postMessage.mock.calls.map((call) => call[0]);
}

/** Commands that would open/launch something — the whole point of this tool. */
const OPEN_COMMANDS = ["openFile", "previewImage", "desktopOpenFileExternal"];

function openCommands(vscode: unknown): Array<Record<string, unknown>> {
  return sentCommands(vscode).filter((message) =>
    OPEN_COMMANDS.includes(String(message.command)),
  );
}

describe("SendUserFile delivered paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders one clickable row per delivered file, plus the caption", async () => {
    const { vscode } = renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        deliveredMessage(
          [
            {
              path: "/home/user/project/report.md",
              name: "report.md",
              kind: "text",
            },
            {
              path: "/home/user/project/chart.png",
              name: "chart.png",
              kind: "image",
            },
          ],
          "cost breakdown by service",
        ),
      ],
    });

    const paths = await waitFor(() => {
      const found = deliveredCards();
      expect(found).toHaveLength(2);
      return found;
    });

    // Label is the base name (CC's delivered-file card shape); the absolute
    // path is what the tooltip and the click carry.
    expect(paths[0].textContent).toBe("report.md");
    expect(paths[1].textContent).toBe("chart.png");
    // One file-type icon per card, from the file-tree icon set.
    expect(paths[0].querySelector("[data-file-type-icon]")).not.toBeNull();
    expect(paths[0].getAttribute("title")).toBe("/home/user/project/report.md");
    expect(
      document.querySelector(".delivered-files-caption"),
    ).toHaveTextContent("cost breakdown by service");
    // Rendering never opens anything: only a click does.
    expect(openCommands(vscode)).toHaveLength(0);
  });

  it("opens a text file through the same channel as a text path in the message", async () => {
    const { vscode } = renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        deliveredMessage([
          {
            path: "/home/user/project/report.md",
            name: "report.md",
            kind: "text",
          },
        ]),
      ],
    });

    const path = await waitFor(() => {
      const found = deliveredCards();
      expect(found).toHaveLength(1);
      return found[0];
    });

    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(path);
    });

    const openFile = sentCommands(vscode).find(
      (message) => message.command === "openFile",
    );
    expect(openFile).toBeDefined();
    expect(openFile?.path).toBe("/home/user/project/report.md");
  });

  it("opens an image through the image preview channel on plugin hosts", async () => {
    const { vscode } = renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        deliveredMessage([
          {
            path: "/home/user/project/chart.png",
            name: "chart.png",
            kind: "image",
          },
        ]),
      ],
    });

    const path = await waitFor(() => {
      const found = deliveredCards();
      expect(found).toHaveLength(1);
      return found[0];
    });

    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(path);
    });

    const preview = sentCommands(vscode).find(
      (message) => message.command === "previewImage",
    );
    expect(preview).toBeDefined();
    expect(preview?.path).toBe("/home/user/project/chart.png");
  });

  it("hands PDFs and archives to the host's open chain on plugin hosts", async () => {
    const { vscode } = renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        deliveredMessage([
          {
            path: "/home/user/project/report.pdf",
            name: "report.pdf",
            kind: "other",
          },
        ]),
      ],
    });

    const path = await waitFor(() => {
      const found = deliveredCards();
      expect(found).toHaveLength(1);
      return found[0];
    });

    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(path);
    });

    const openFile = sentCommands(vscode).find(
      (message) => message.command === "openFile",
    );
    expect(openFile?.path).toBe("/home/user/project/report.pdf");
  });

  it("sends an executable down the host opener, where the refusal lives", async () => {
    const { vscode } = renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        deliveredMessage([
          {
            path: "/home/user/project/setup.exe",
            name: "setup.exe",
            kind: "other",
          },
        ]),
      ],
    });

    const path = await waitFor(() => {
      const found = deliveredCards();
      expect(found).toHaveLength(1);
      return found[0];
    });

    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(path);
    });

    // The page does not decide anything about executables: it asks the host to
    // open the file exactly like a PDF, and the host's blocklist is the refusal.
    const openFile = sentCommands(vscode).find(
      (message) => message.command === "openFile",
    );
    expect(openFile?.path).toBe("/home/user/project/setup.exe");
    expect(document.querySelector(".ide-context-preview-title")).toBeNull();
  });

  it("still renders a pre-阶段-2 transcript that only has metadata.files", async () => {
    const { vscode } = renderChatApp();
    const message = deliveredMessage([
      { path: "/home/user/project/report.md", name: "report.md", kind: "text" },
    ]);
    const block = message.blocks?.find(
      (candidate) => candidate.type === "tool",
    ) as ToolBlock;
    // 老转录：`data` 不存在，结构化列表在 `metadata.files` 里。
    block.data = undefined;
    block.metadata = {
      files: [
        {
          path: "/home/user/project/report.md",
          name: "report.md",
          kind: "text",
        },
      ],
    };
    sendCommand("updateMessages", { messages: [message] });

    const path = await waitFor(() => {
      const found = deliveredCards();
      expect(found).toHaveLength(1);
      return found[0];
    });

    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(path);
    });

    expect(
      sentCommands(vscode).find((message) => message.command === "openFile")
        ?.path,
    ).toBe("/home/user/project/report.md");
  });

  it("falls back to the classifier when the entry carries no kind", async () => {
    const { vscode } = renderChatApp();
    sendCommand("updateMessages", {
      messages: [
        deliveredMessage([
          // `kind` missing: the webview re-classifies instead of guessing.
          {
            path: "/home/user/project/report.md",
            name: "report.md",
          } as DeliveredEntry,
        ]),
      ],
    });

    const path = await waitFor(() => {
      const found = deliveredCards();
      expect(found).toHaveLength(1);
      return found[0];
    });

    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(path);
    });

    expect(
      sentCommands(vscode).find((message) => message.command === "openFile")
        ?.path,
    ).toBe("/home/user/project/report.md");
  });
});
