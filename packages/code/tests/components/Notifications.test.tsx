import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { Notifications } from "../../src/components/Notifications.js";

describe("Notifications Component", () => {
  it("should not show context percentage when no tokens consumed", () => {
    const { lastFrame } = render(<Notifications latestTotalTokens={0} />);

    expect(lastFrame()).not.toContain("% context");
  });

  it("should show context percentage when tokens are consumed", () => {
    const { lastFrame } = render(
      <Notifications latestTotalTokens={40000} maxInputTokens={200000} />,
    );

    expect(lastFrame()).toContain("20% context");
  });

  it("should cap context percentage at 100", () => {
    const { lastFrame } = render(
      <Notifications latestTotalTokens={500000} maxInputTokens={200000} />,
    );

    expect(lastFrame()).toContain("100% context");
  });

  it("should show login hint when showLoginHint is true", () => {
    const { lastFrame } = render(<Notifications showLoginHint={true} />);

    expect(lastFrame()).toContain("Type /login to authenticate");
  });

  it("should not show login hint by default", () => {
    const { lastFrame } = render(<Notifications />);

    expect(lastFrame()).not.toContain("Type /login to authenticate");
  });

  // 插件变更提示（docs/specs/ecosystem/plugin.md「插件变更提示」）：一次性中性
  // 提示，由宿主设置；不设置时不出现。
  it("should show the plugin hint when one is set", () => {
    const { lastFrame } = render(
      <Notifications pluginHint="插件已变更。运行 /reload-plugins 使其生效。" />,
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
