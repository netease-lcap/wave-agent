import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockVscode,
  render,
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendHostMessage,
  fixtures,
  fireInput,
} from "./test-utils";
import RemoteControlDialog from "../../src/components/RemoteControlDialog";

async function typeAndSend(text: string) {
  const input = screen.getByTestId("message-input");
  input.textContent = text;
  await fireInput(input);
  fireEvent.keyDown(input, { key: "Enter" });
}

/** Open the dialog via `/remote-control` and return the mount request it sent. */
async function openDialog() {
  const { vscode } = renderChatApp();
  await act(async () => {
    await typeAndSend("/remote-control");
  });
  await waitFor(() => {
    expect(screen.getByTestId("remote-control-dialog")).toBeInTheDocument();
  });
  const sent = vscode.postMessage.mock.calls
    .map((call) => call[0] as { command?: string; requestId?: string })
    .filter((message) => message.command === "remoteControl");
  expect(sent.length).toBeGreaterThan(0);
  return { vscode, mountRequest: sent[sent.length - 1] };
}

const reply = (requestId: string, overrides = {}) =>
  fixtures.remoteControlResponse(requestId, overrides);

describe("远程控制弹窗（/remote-control）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens on the local slash command and immediately asks the host for status", async () => {
    const { mountRequest } = await openDialog();
    expect(mountRequest.requestId).toEqual(expect.any(String));
    expect(screen.getByTestId("remote-control-dialog")).toHaveTextContent(
      "未开启",
    );
  });

  it("renders the state and page address from the host's reply", async () => {
    const { mountRequest } = await openDialog();

    await act(async () => {
      sendHostMessage(reply(mountRequest.requestId as string));
    });

    const dialog = screen.getByTestId("remote-control-dialog");
    expect(dialog).toHaveTextContent("已连接");
    expect(dialog).toHaveTextContent("https://relay.example/remote/?host=h1");
  });

  it("draws a scannable QR of the page address the CLI resolved", async () => {
    const { mountRequest } = await openDialog();

    await act(async () => {
      sendHostMessage(reply(mountRequest.requestId as string));
    });

    const qr = screen.getByTestId("remote-control-qr");
    expect(qr.querySelector("svg")).toBeTruthy();
    // The phone is the scanning side: what it opens is the page, not the relay
    // socket this machine holds.
    expect(screen.getByTestId("remote-control-dialog")).toHaveTextContent(
      "https://relay.example/remote/?host=h1",
    );
  });

  it("draws no QR when the reply carried no page address (never invents one)", async () => {
    const { mountRequest } = await openDialog();

    await act(async () => {
      sendHostMessage(
        reply(mountRequest.requestId as string, {
          snapshot: { state: "online" },
        }),
      );
    });

    expect(screen.queryByTestId("remote-control-qr")).toBeNull();
    expect(screen.getByTestId("remote-control-dialog")).toHaveTextContent(
      "已连接",
    );
  });

  it("the phone page cannot open it at all (the entry is not rendered there)", async () => {
    // 远程控制页本身就是在被手机控制的那一端，页面上再开「手机接管本机会话」是
    // 自我指涉：弹窗里的连接/断开都发不出去（shim 不认 remoteControl）。所以页面上
    // 这个入口不渲染（spec ui/remote-control.md 场景 24），敲命令也不会弹窗。
    window.waveRemotePage = true;
    try {
      const { vscode } = renderChatApp();
      await act(async () => {
        await typeAndSend("/remote-control");
      });

      expect(screen.queryByTestId("remote-control-dialog")).toBeNull();
      expect(
        vscode.postMessage.mock.calls.filter(
          (call) =>
            (call[0] as { command?: string }).command === "remoteControl",
        ),
      ).toHaveLength(0);
    } finally {
      delete window.waveRemotePage;
    }
  });

  it("draws no QR on the phone page itself (it is the scanning side)", async () => {
    // 上面那条已经让页面进不到这个弹窗；这条直接挂载弹窗，钉住「即便挂上了也不画
    // 二维码」——页面就是二维码指向的那一端，画它没有意义，地址本身照旧可读。
    window.waveRemotePage = true;
    try {
      const vscode = createMockVscode();
      render(<RemoteControlDialog onClose={vi.fn()} vscode={vscode} />);
      const mountCalls = vscode.postMessage.mock.calls
        .map((call) => call[0] as { command?: string; requestId?: string })
        .filter((message) => message.command === "remoteControl");
      const mountRequest = mountCalls[mountCalls.length - 1]
        .requestId as string;

      await act(async () => {
        sendHostMessage(reply(mountRequest));
      });

      expect(screen.queryByTestId("remote-control-qr")).toBeNull();
      // The address is still readable there — only the QR is pointless.
      expect(screen.getByTestId("remote-control-dialog")).toHaveTextContent(
        "https://relay.example/remote/?host=h1",
      );
    } finally {
      delete window.waveRemotePage;
    }
  });

  it("drops a reply whose requestId is not the newest one in flight", async () => {
    const { mountRequest } = await openDialog();
    await act(async () => {
      sendHostMessage(reply(mountRequest.requestId as string));
    });
    expect(screen.getByTestId("remote-control-dialog")).toHaveTextContent(
      "已连接",
    );

    // A one-second-old poll answering late must not undo the link the user is
    // looking at (same channel, older requestId).
    await act(async () => {
      sendHostMessage(
        reply("remote-control-stale", {
          snapshot: { state: "off" },
        }),
      );
    });
    expect(screen.getByTestId("remote-control-dialog")).toHaveTextContent(
      "已连接",
    );
  });

  it("shows the host's RPC failure verbatim (the switch is off) instead of a fake state", async () => {
    const { mountRequest } = await openDialog();

    await act(async () => {
      sendHostMessage(
        reply(mountRequest.requestId as string, {
          snapshot: undefined,
          error:
            "Remote control is not enabled on this process (set enableRemoteControl: true).",
        }),
      );
    });

    const dialog = screen.getByTestId("remote-control-dialog");
    expect(dialog).toHaveTextContent("无法读取状态");
    expect(dialog).toHaveTextContent("enableRemoteControl");
    // Nothing is connected, so the primary action stays "开启".
    expect(dialog).toHaveTextContent("开启远程控制");
  });

  it("asks the host to disconnect from the connected state", async () => {
    const { vscode, mountRequest } = await openDialog();
    await act(async () => {
      sendHostMessage(reply(mountRequest.requestId as string));
    });

    const disconnect = screen.getByRole("button", { name: "断开" });
    await act(async () => {
      fireEvent.click(disconnect);
    });

    const actions = vscode.postMessage.mock.calls
      .map((call) => call[0] as { command?: string; action?: string })
      .filter((message) => message.command === "remoteControl")
      .map((message) => message.action);
    expect(actions).toContain("disconnect");
  });
});
