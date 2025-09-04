import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "@/components/InputBox";
import { resetMocks } from "../helpers/contextMock";
import * as gitUtils from "@/utils/gitUtils";
import * as aiService from "@/services/aiService";

// Mock git utils and AI service
vi.mock("@/utils/gitUtils", () => ({
  getGitDiff: vi.fn(),
}));

vi.mock("@/services/aiService", () => ({
  generateCommitMessage: vi.fn(),
}));

// 使用 vi.hoisted 来确保 mock 在静态导入之前被设置
await vi.hoisted(async () => {
  const { setupMocks } = await import("../helpers/contextMock");
  setupMocks();
});

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Git Commit Command", () => {
  // 在每个测试前重置 mock 状态
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  it("should activate bash mode when git-commit command generates bash command", async () => {
    // Mock git diff return
    const mockDiff = `diff --git a/src/test.ts b/src/test.ts
new file mode 100644
index 0000000..123abc4
--- /dev/null
+++ b/src/test.ts
@@ -0,0 +1,3 @@
+function test() {
+  console.log("test");
+}`;

    vi.mocked(gitUtils.getGitDiff).mockResolvedValue(mockDiff);
    vi.mocked(aiService.generateCommitMessage).mockResolvedValue(
      "feat: add test function",
    );

    const { stdin, lastFrame } = render(<InputBox />);

    // Open command selector with /
    stdin.write("/");
    await delay(10);

    let output = lastFrame();
    expect(output).toContain("Command Selector");
    expect(output).toContain("git-commit");

    // Navigate to git-commit command and select it
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await delay(10);

    // Press Enter to select git-commit command
    stdin.write("\r");
    await delay(100); // Wait for async command generation

    output = lastFrame();

    // Should show bash mode after git commit command is generated
    expect(output).toContain("💻 Bash Mode");
    expect(output).toContain("Execute bash command (remove ! to exit)");

    // Should contain the generated git command
    expect(output).toContain(
      '!git add . && git commit -m "feat: add test function"',
    );

    // Verify git diff was called
    expect(gitUtils.getGitDiff).toHaveBeenCalledWith(expect.any(String));

    // Verify commit message generation was called
    expect(aiService.generateCommitMessage).toHaveBeenCalledWith({
      diff: mockDiff,
    });
  });

  it("should not activate bash mode for non-git commands", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Open command selector with /
    stdin.write("/");
    await delay(10);

    let output = lastFrame();
    expect(output).toContain("Command Selector");

    // Select clean command (which doesn't generate bash commands)
    // Clean is the first command (index 0), so no navigation needed
    await delay(10);

    // Press Enter to select clean command
    stdin.write("\r");
    await delay(10);

    output = lastFrame();

    // Should not show bash mode
    expect(output).not.toContain("💻 Bash Mode");
    expect(output).not.toContain("Execute bash command");
  });

  it("should handle git diff errors gracefully", async () => {
    // Mock git diff to throw error
    vi.mocked(gitUtils.getGitDiff).mockRejectedValue(
      new Error("Git diff failed"),
    );

    const { stdin, lastFrame } = render(<InputBox />);

    // Open command selector with /
    stdin.write("/");
    await delay(10);

    // Navigate to and select git-commit command
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await delay(10);

    // Press Enter to select git-commit command
    stdin.write("\r");
    await delay(100); // Wait for async error handling

    const output = lastFrame();

    // Should show error message
    expect(output).toContain("❌ Error");
    expect(output).toContain("Git diff failed");

    // Should not activate bash mode on error
    expect(output).not.toContain("💻 Bash Mode");

    // Verify git diff was called
    expect(gitUtils.getGitDiff).toHaveBeenCalledWith(expect.any(String));

    // Verify commit message generation was not called due to error
    expect(aiService.generateCommitMessage).not.toHaveBeenCalled();
  });

  it("should handle empty git diff", async () => {
    // Mock empty git diff
    vi.mocked(gitUtils.getGitDiff).mockResolvedValue("");

    const { stdin, lastFrame } = render(<InputBox />);

    // Open command selector with /
    stdin.write("/");
    await delay(10);

    // Navigate to and select git-commit command
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await delay(10);

    // Press Enter to select git-commit command
    stdin.write("\r");
    await delay(100);

    const output = lastFrame();

    // Should show warning for no changes
    expect(output).toContain("⚠️");
    expect(output).toContain("No changes detected");

    // Should not activate bash mode when no changes
    expect(output).not.toContain("💻 Bash Mode");

    // Verify git diff was called
    expect(gitUtils.getGitDiff).toHaveBeenCalledWith(expect.any(String));

    // Verify commit message generation was not called due to no changes
    expect(aiService.generateCommitMessage).not.toHaveBeenCalled();
  });

  it("should handle AI service errors gracefully", async () => {
    // Mock git diff return
    const mockDiff = `diff --git a/src/test.ts b/src/test.ts
new file mode 100644
index 0000000..123abc4
--- /dev/null
+++ b/src/test.ts
@@ -0,0 +1,3 @@
+function test() {
+  console.log("test");
+}`;

    vi.mocked(gitUtils.getGitDiff).mockResolvedValue(mockDiff);
    vi.mocked(aiService.generateCommitMessage).mockRejectedValue(
      new Error("AI service error"),
    );

    const { stdin, lastFrame } = render(<InputBox />);

    // Open command selector with /
    stdin.write("/");
    await delay(10);

    // Navigate to and select git-commit command
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await delay(10);

    // Press Enter to select git-commit command
    stdin.write("\r");
    await delay(100);

    const output = lastFrame();

    // Should show error message
    expect(output).toContain("❌ Error");
    expect(output).toContain("AI service error");

    // Should not activate bash mode on AI error
    expect(output).not.toContain("💻 Bash Mode");

    // Verify both services were called
    expect(gitUtils.getGitDiff).toHaveBeenCalledWith(expect.any(String));
    expect(aiService.generateCommitMessage).toHaveBeenCalledWith({
      diff: mockDiff,
    });
  });

  it("should show generating status during command generation", async () => {
    // Mock git diff return with a delay
    const mockDiff = "mock diff content";
    vi.mocked(gitUtils.getGitDiff).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockDiff), 50)),
    );
    vi.mocked(aiService.generateCommitMessage).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve("feat: test commit"), 50),
        ),
    );

    const { stdin, lastFrame } = render(<InputBox />);

    // Open command selector with /
    stdin.write("/");
    await delay(10);

    // Navigate to git-commit (it should be the second item, index 1)
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await delay(10);

    // Press Enter to select git-commit command
    stdin.write("\r");
    await delay(30); // Wait a bit but not for full completion

    const output = lastFrame();

    // Should show generating status
    expect(output).toContain("generating...");

    // Wait for completion
    await delay(150);

    const finalOutput = lastFrame();

    // Should show bash mode after generation completes
    expect(finalOutput).toContain("💻 Bash Mode");
  });

  it("should escape quotes in commit message properly", async () => {
    // Mock git diff return
    const mockDiff = "mock diff content";
    const commitMessageWithQuotes = 'feat: add "test" function with quotes';

    vi.mocked(gitUtils.getGitDiff).mockResolvedValue(mockDiff);
    vi.mocked(aiService.generateCommitMessage).mockResolvedValue(
      commitMessageWithQuotes,
    );

    const { stdin, lastFrame } = render(<InputBox />);

    // Open command selector with /
    stdin.write("/");
    await delay(10);

    // Navigate to git-commit (it should be the second item, index 1)
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await delay(10);

    // Press Enter to select git-commit command
    stdin.write("\r");
    await delay(100);

    const output = lastFrame();

    // Should show bash mode with properly escaped quotes
    expect(output).toContain("💻 Bash Mode");
    expect(output).toContain(
      '!git add . && git commit -m "feat: add \\"test\\" function with quotes"',
    );
  });
});
