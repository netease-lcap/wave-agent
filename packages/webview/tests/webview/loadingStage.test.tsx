/**
 * 首次启动的进度文案（spec ui/stdio-transport.md「首次启动的进度文案」）在界面上的口径：
 * 文案落在加载态正下方，第一个阶段要持续满 300ms 才现身，现身后换字不重新计时，
 * 清空立即生效。
 *
 * 场景取自桌面端恢复一条历史会话：`isRestoring` 让扫光动画占据主体（LoadingLogo），
 * 进度文案就挂在它下面。
 *
 * 断言锚在 `data-testid="loading-stage"`（语义句柄）而不是样式类；文案本身取自宿主
 * 下发的那一行，webview 不拼装——所以这里喂的就是宿主会喂的字符串。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderChatApp,
  screen,
  act,
  sendHostMessage,
  fixtures,
} from "./test-utils";
import { STAGE_REVEAL_DELAY_MS } from "../../src/components/LoadingLogo";

const DOWNLOADING_RUNTIME = "正在下载 Node.js 运行时（约 50 MB）…";
const INSTALLING_RUNTIME = "正在安装 Node.js 运行时…";
const DOWNLOADING_TOOL_DEPS = "正在下载工具依赖（搜索与图片处理）…";

const stage = () => screen.queryByTestId("loading-stage");

/** 进入「正在恢复」状态：扫光动画 + 下方那行进度文案的位置。 */
function restoring() {
  act(() => {
    sendHostMessage(fixtures.setInitialState({ isRestoring: true }));
  });
}

describe("首次启动的进度文案", () => {
  // Each case's whole subject is a 300ms reveal threshold, so on real timers
  // they sleep through it. Freeze the clock and drive it explicitly: the
  // 299ms/300ms boundary becomes asserted instead of merely outrun.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setTimerTickMode("nextTimerAsync");
  });
  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
  });

  it("阶段持续不满 300ms 时不出现，超过阈值才现身", async () => {
    renderChatApp();
    restoring();
    expect(stage()).not.toBeInTheDocument();

    act(() => {
      sendHostMessage(fixtures.loadingStage(DOWNLOADING_RUNTIME));
    });
    // 同步渲染一帧之后立刻断言：阈值还没到，字不该闪出来（场景 4）。
    expect(stage()).not.toBeInTheDocument();

    // 差 1ms 到阈值仍在藏，跨过去才现身——边界来自组件自己的常量。
    await vi.advanceTimersByTimeAsync(STAGE_REVEAL_DELAY_MS - 1);
    expect(stage()).not.toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1);
    expect(stage()).toBeInTheDocument();
    expect(stage()).toHaveTextContent(DOWNLOADING_RUNTIME);
  });

  it("现身之后的下一个阶段立刻换字（不重新等 300ms）", async () => {
    renderChatApp();
    restoring();
    act(() => {
      sendHostMessage(fixtures.loadingStage(DOWNLOADING_RUNTIME));
    });
    await vi.waitFor(() => expect(stage()).toBeInTheDocument());

    act(() => {
      sendHostMessage(fixtures.loadingStage(INSTALLING_RUNTIME));
    });
    // 相邻两个慢阶段之间不该空白 300ms，否则用户看到的是「字闪断了」（场景 1）。
    expect(stage()).toHaveTextContent(INSTALLING_RUNTIME);
  });

  it("text 为 null 时立即清空文案（加载态可能还在）", async () => {
    renderChatApp();
    restoring();
    act(() => {
      sendHostMessage(fixtures.loadingStage(DOWNLOADING_TOOL_DEPS));
    });
    await vi.waitFor(() => expect(stage()).toBeInTheDocument());

    act(() => {
      sendHostMessage(fixtures.loadingStage(null));
    });
    // 工具依赖下载失败就是这条路径：只降级、不阻断启动，界面不能停在最后一步（场景 6）。
    expect(stage()).not.toBeInTheDocument();
  });
});
