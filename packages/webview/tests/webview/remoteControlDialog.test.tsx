import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendHostMessage,
  fixtures,
  fireInput,
} from "./test-utils";

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

  it("renders the state and pairing code from the host's reply", async () => {
    const { mountRequest } = await openDialog();

    await act(async () => {
      sendHostMessage(reply(mountRequest.requestId as string));
    });

    const dialog = screen.getByTestId("remote-control-dialog");
    expect(dialog).toHaveTextContent("已连接");
    expect(dialog).toHaveTextContent("4821-9930");
  });

  it("draws a scannable QR of the pairing page the relay handed back", async () => {
    const { mountRequest } = await openDialog();

    await act(async () => {
      sendHostMessage(reply(mountRequest.requestId as string));
    });

    const qr = screen.getByTestId("remote-control-qr");
    expect(qr.querySelector("svg")).toBeTruthy();
    // The phone is the scanning side: what it opens is the pairing page, not the
    // relay socket this machine holds.
    expect(screen.getByTestId("remote-control-dialog")).toHaveTextContent(
      "https://relay.example/remote/pair?code=4821-9930",
    );
  });

  it("draws no QR when the reply carried no pairing page (never invents one)", async () => {
    const { mountRequest } = await openDialog();

    await act(async () => {
      sendHostMessage(
        reply(mountRequest.requestId as string, {
          snapshot: { state: "online", pairing: { code: "4821-9930" } },
        }),
      );
    });

    expect(screen.queryByTestId("remote-control-qr")).toBeNull();
    expect(screen.getByTestId("remote-control-dialog")).toHaveTextContent(
      "4821-9930",
    );
  });

  it("draws no QR on the phone page itself (it is the scanning side)", async () => {
    window.waveRemotePage = true;
    try {
      const { mountRequest } = await openDialog();

      await act(async () => {
        sendHostMessage(reply(mountRequest.requestId as string));
      });

      expect(screen.queryByTestId("remote-control-qr")).toBeNull();
      // The code is still readable there — only the QR is pointless.
      expect(screen.getByTestId("remote-control-dialog")).toHaveTextContent(
        "4821-9930",
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
