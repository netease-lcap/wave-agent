import React from "react";
import { render } from "../helpers/inkHarness.js";
import { describe, it, expect } from "vitest";
import { Notifications } from "../../src/components/Notifications.js";

describe("Notifications Component", () => {
  it("should not show the context readout when no tokens consumed", () => {
    const { lastFrame } = render(<Notifications latestTotalTokens={0} />);

    expect(lastFrame()).not.toContain("auto-compact");
  });

  // 方向是**剩余**、分母是自动压缩阈值（167,000），与 Claude Code 的 CLI 同句：
  // 40000 / 167000 ⇒ 还剩 76%。写成 "24% context" 会被读成「窗口用了 24%」。
  it("should show how much is left until auto-compact", () => {
    const { lastFrame } = render(
      <Notifications latestTotalTokens={40000} contextWindow={200000} />,
    );

    expect(lastFrame()).toContain("76% until auto-compact");
    expect(lastFrame()).not.toContain("% context");
  });

  // CC 的边界：剩余归零时不再报数字，直接说「下一轮就压缩」。
  it("should say auto-compact next once the threshold is reached", () => {
    const { lastFrame } = render(
      <Notifications latestTotalTokens={500000} contextWindow={200000} />,
    );

    expect(lastFrame()).toContain("auto-compact next");
    expect(lastFrame()).not.toContain("% until auto-compact");
  });

  // 窗口未知时无处可算（remainingPercentOf 返回 0，但那是「到阈值了」的语义），
  // 所以这一格整块不渲染，而不是误报 auto-compact next。
  it("should hide the readout when the context window is unknown", () => {
    const { lastFrame } = render(
      <Notifications latestTotalTokens={40000} contextWindow={0} />,
    );

    expect(lastFrame()).not.toContain("auto-compact");
  });

  it("should show login hint when showLoginHint is true", () => {
    const { lastFrame } = render(<Notifications showLoginHint={true} />);

    expect(lastFrame()).toContain("Type /login to authenticate");
  });

  it("should not show login hint by default", () => {
    const { lastFrame } = render(<Notifications />);

    expect(lastFrame()).not.toContain("Type /login to authenticate");
  });

  // 一次性提示（docs/specs/ecosystem/plugin.md「插件变更提示」）：同一格还会承载
  // 私有化未授权文案，两种来源共用；不设置时不出现。
  it("should show the plugin hint when one is set", () => {
    const { lastFrame } = render(
      <Notifications hint="插件已变更。运行 /reload-plugins 使其生效。" />,
    );

    expect(lastFrame()).toContain(
      "插件已变更。运行 /reload-plugins 使其生效。",
    );
  });

  it("should not show any plugin hint by default", () => {
    const { lastFrame } = render(<Notifications />);

    expect(lastFrame()).not.toContain("reload-plugins");
  });
});
