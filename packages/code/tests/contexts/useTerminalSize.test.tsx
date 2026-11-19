import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { Text } from "ink";
import { cleanup, render } from "../helpers/inkHarness.js";
import {
  TerminalSizeProvider,
  useTerminalSize,
} from "../../src/contexts/useTerminalSize.js";

const Probe: React.FC = () => {
  const { columns, rows } = useTerminalSize();
  return (
    <Text>
      {columns}x{rows}
    </Text>
  );
};

/** n 个各自读尺寸的兄弟：改之前它们各挂一个 `resize` 监听。 */
function probes(count: number) {
  return Array.from({ length: count }, (_, index) => <Probe key={index} />);
}

afterEach(cleanup);

describe("useTerminalSize（终端尺寸的唯一订阅点）", () => {
  it("provider 下挂多少个组件都只有一个 resize 监听", async () => {
    const { stdout, lastFrame, settle } = render(
      <TerminalSizeProvider>{probes(8)}</TerminalSizeProvider>,
    );
    await settle();

    // 8 个组件 + provider 自己 = 9 个读者，但 `stdout.on("resize")` 只有一处。
    expect(stdout.listenerCount("resize")).toBe(1);
    // 值确实是从 provider 流下来的（harness 的假终端是 100x24）。
    expect(lastFrame()).toContain("100x24");
  });

  it("没有 provider 时读 ink 手里那根流，且一个 resize 监听都不挂", async () => {
    const { stdout, lastFrame, settle } = render(<>{probes(8)}</>);
    await settle();

    expect(stdout.listenerCount("resize")).toBe(0);
    expect(lastFrame()).toContain("100x24");
  });
});
