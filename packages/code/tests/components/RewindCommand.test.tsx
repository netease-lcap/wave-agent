import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "../helpers/inkHarness.js";
import { RewindCommand } from "../../src/components/RewindCommand.js";
import { stripAnsiColors } from "wave-agent-sdk";
import type { RewindCheckpoint } from "wave-agent-sdk";

/**
 * 这一屏现在只负责**画**：检查点表（哪些能回滚、文本是什么、位置是几）由 SDK
 * 扫转录投影出来后传进来（`loadRewindCheckpoints`）。过滤、去重、位置计算那些
 * 语义归 SDK 的测试，这里只钉显示与选择。
 */
const checkpoint = (
  id: string,
  content: string,
  index: number,
): RewindCheckpoint => ({ id, content, index });

describe("RewindCommand Content", () => {
  it("shows the checkpoint text and its absolute index", async () => {
    const { lastFrame } = render(
      <RewindCommand
        getCheckpoints={vi
          .fn()
          .mockResolvedValue([checkpoint("u1", "Hello world", 0)])}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("Hello world");
      expect(output).toContain("[0]");
    });
  });

  it("shows a loading state until the checkpoints arrive", async () => {
    let resolve: (value: RewindCheckpoint[]) => void = () => {};
    const pending = new Promise<RewindCheckpoint[]>((r) => {
      resolve = r;
    });

    const { lastFrame } = render(
      <RewindCommand
        getCheckpoints={vi.fn().mockReturnValue(pending)}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(stripAnsiColors(lastFrame() || "")).toContain(
      "Loading rewind checkpoints",
    );

    resolve([checkpoint("u1", "later", 3)]);
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("later");
    });
  });

  it("keeps the latest checkpoint marked", async () => {
    const { lastFrame } = render(
      <RewindCommand
        getCheckpoints={vi
          .fn()
          .mockResolvedValue([
            checkpoint("u1", "first", 0),
            checkpoint("u2", "second", 2),
          ])}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("second");
      expect(output).toContain("(Latest)");
    });
  });

  it("passes the absolute index of the picked checkpoint to onSelect", async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(
      <RewindCommand
        getCheckpoints={vi
          .fn()
          .mockResolvedValue([
            checkpoint("u1", "first", 0),
            checkpoint("u2", "second", 5),
          ])}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />,
    );

    // 打开时停在最新一条（second）。上下移动的语义归 `rewindSelectorReducer`
    // 自己的测试，这里只钉「传出去的是完整线程里的位置，不是列表里的下标」。
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("second");
    });

    stdin.write("\r");

    await vi.waitFor(() => {
      // 5 而不是列表里的 1
      expect(onSelect).toHaveBeenCalledWith(5);
    });
  });
});
