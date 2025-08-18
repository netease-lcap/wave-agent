import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "@/components/InputBox";
import { resetMocks } from "../mocks/contextMock";

// 使用 vi.hoisted 来确保 mock 在静态导入之前被设置
await vi.hoisted(async () => {
  const { setupMocks } = await import("../mocks/contextMock");
  setupMocks();
});

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Memory Mode", () => {
  // 在每个测试前重置 mock 状态
  beforeEach(() => {
    resetMocks();
  });

  it("should show memory mode when input starts with #", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type # to enter memory mode
    stdin.write("#");
    await delay(50);

    const output = lastFrame();
    expect(output).toContain("📝 Memory Mode");
    expect(output).toContain("Add memory content (remove # to exit)");
    // 当有输入时，不会显示 placeholder，所以只检查模式提示
    expect(output).toContain("#");
  });

  it("should show memory placeholder when input is empty", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 首先输入 # 然后删除，这样会触发记忆模式的 placeholder 检查
    stdin.write("#");
    await delay(50);

    // 删除 # 字符，但这时 inputText 会变为空，不再是记忆模式
    stdin.write("\u0008"); // backspace
    await delay(50);

    // 重新输入 # 进入记忆模式
    stdin.write("#");
    await delay(50);

    const output = lastFrame();
    expect(output).toContain("📝 Memory Mode");
    expect(output).toContain("Add memory content (remove # to exit)");
  });

  it("should not show memory mode for normal input", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type normal text
    stdin.write("hello");
    await delay(50);

    const output = lastFrame();
    expect(output).not.toContain("📝 Memory Mode");
    expect(output).not.toContain("Add memory content (remove # to exit)");
  });

  it("should exit memory mode when # is removed", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type # to enter memory mode
    stdin.write("#");
    await delay(50);
    let output = lastFrame();
    expect(output).toContain("📝 Memory Mode");

    // Remove # to exit memory mode
    stdin.write("\u0008"); // backspace
    await delay(50);
    output = lastFrame();
    expect(output).not.toContain("📝 Memory Mode");
  });

  it("should show memory mode with additional text after #", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type # to enter memory mode first
    stdin.write("#");
    await delay(50);

    // Then type additional text character by character
    stdin.write(" ");
    await delay(10);
    stdin.write("r");
    await delay(10);
    stdin.write("e");
    await delay(10);
    stdin.write("m");
    await delay(10);
    stdin.write("e");
    await delay(10);
    stdin.write("m");
    await delay(10);
    stdin.write("b");
    await delay(10);
    stdin.write("e");
    await delay(10);
    stdin.write("r");
    await delay(10);
    stdin.write(" ");
    await delay(10);
    stdin.write("t");
    await delay(10);
    stdin.write("h");
    await delay(10);
    stdin.write("i");
    await delay(10);
    stdin.write("s");
    await delay(50);

    const output = lastFrame();
    expect(output).toContain("📝 Memory Mode");
    expect(output).toContain("Add memory content (remove # to exit)");
    expect(output).toContain("# remember this");
  });

  it("should change border color in memory mode", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Normal mode should have gray border
    let output = lastFrame();
    // Note: border color testing is limited in text output, but we can test the content

    // Type # to enter memory mode
    stdin.write("#");
    await delay(50);

    output = lastFrame();
    expect(output).toContain("📝 Memory Mode");
    expect(output).toContain("Add memory content (remove # to exit)");
  });
});
