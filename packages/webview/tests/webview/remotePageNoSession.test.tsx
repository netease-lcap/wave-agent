/**
 * 远控 Web 页「电脑侧一条会话都没有」时的对话页（spec remote/remote-web.md
 * 「手机端的会话列表与删除」场景 12、「Web 端也能发起新会话」场景 2）。
 *
 * 手机把最后一条会话删掉之后，页面手里既没有 `sessionId`、也没有任何 workdir
 * （跑 `destroy` 后机器的注册表是空的）。此时消息列表为空，UI 会走到「空态」那一
 * 支——但这里并不是一条可用的新对话：机器侧 `requireSession` 会以
 * `sessionId is required for this request` 拒掉任何 `sendMessage`，而规格又明确不
 * 允许「不选目录直接创建」。所以空态必须把发送入口置灰并说明原因，而不是摆出一份
 * 看起来能用、发出去才报红的输入区。
 *
 * 反证同样重要：同一条快照在别的宿主上（插件端 / 桌面）输入区照旧可用——守卫只属于
 * 远控页。
 */
import { afterEach, describe, expect, it } from "vitest";
import { fixtures } from "wave-webview-fixtures";
import { act, renderChatApp, screen, sendHostMessage } from "./test-utils";

const SESSION = {
  id: "session-1",
  sessionType: "main" as const,
  workdir: "/repo/app",
  firstMessage: "给登录页加个校验",
  createdAt: new Date("2026-10-14T08:00:00Z"),
  lastActiveAt: new Date("2026-10-14T09:00:00Z"),
  latestTotalTokens: 100,
};

/** 推一份「机器上一条会话都没有」的快照（= 删光之后 `pullSnapshot` 的形状）。 */
function openWithoutSession(remote: boolean) {
  if (remote) window.waveRemotePage = true;
  const rendered = renderChatApp();
  act(() => {
    sendHostMessage(
      fixtures.setInitialState({
        sessions: [],
        session: undefined,
        messages: [],
      }),
    );
  });
  return rendered;
}

afterEach(() => {
  delete window.waveRemotePage;
});

describe("remote page with no session left", () => {
  it("disables the composer and says why", () => {
    openWithoutSession(true);

    const input = screen.getByTestId("message-input");
    expect(input).toHaveAttribute("contenteditable", "false");
    expect(input.getAttribute("data-placeholder")).toBe(
      "请先新建对话并选择工作目录",
    );
    // 发送 / 附件 / 快捷指令 / 权限模式跟着同一套 disabled 语义一起置灰。
    expect(screen.getByTestId("send-btn")).toBeDisabled();
    expect(screen.getByLabelText("添加")).toBeDisabled();
    expect(screen.getByLabelText("快捷指令")).toBeDisabled();
    expect(screen.getByLabelText("权限模式")).toBeDisabled();
  });

  it("hides the quick-start templates (they would only fill a dead input)", () => {
    openWithoutSession(true);

    expect(screen.queryByTestId("quick-start")).toBeNull();
  });

  it("keeps the composer usable once a session exists", () => {
    window.waveRemotePage = true;
    renderChatApp();
    act(() => {
      sendHostMessage(
        fixtures.setInitialState({
          sessions: [SESSION],
          session: SESSION,
          messages: [],
        }),
      );
    });

    const input = screen.getByTestId("message-input");
    expect(input).toHaveAttribute("contenteditable", "true");
    expect(input.getAttribute("data-placeholder")).not.toBe(
      "请先新建对话并选择工作目录",
    );
    expect(screen.getByTestId("quick-start")).toBeInTheDocument();
  });

  it("does not gate other hosts: the same empty snapshot stays editable", () => {
    openWithoutSession(false);

    const input = screen.getByTestId("message-input");
    expect(input).toHaveAttribute("contenteditable", "true");
    expect(screen.getByTestId("quick-start")).toBeInTheDocument();
  });
});
