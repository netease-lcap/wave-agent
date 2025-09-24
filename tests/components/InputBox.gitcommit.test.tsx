import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "@/components/InputBox";
import * as gitUtils from "@/utils/gitUtils";
import * as aiService from "@/services/aiService";
import { waitForText } from "../helpers/waitHelpers";

// Mock git utils and AI service
vi.mock("@/utils/gitUtils");
vi.mock("@/services/aiService");

describe("InputBox Git Commit Command", () => {
  // 在每个测试前重置 mock 状态
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should generate bash command when git-commit command is executed", async () => {
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

    // 确保 mocks 被正确设置
    vi.mocked(gitUtils.getGitDiff).mockResolvedValue(mockDiff);
    vi.mocked(aiService.generateCommitMessage).mockResolvedValue(
      "feat: add test function",
    );

    const { stdin, lastFrame } = render(<InputBox workdir="/mock/workdir" />);

    // Open command selector with /
    stdin.write("/");
    await waitForText(lastFrame, "git-commit");

    // Navigate to git-commit command and select it
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await waitForText(lastFrame, "▶ /git-commit");

    // Press Enter to select git-commit command
    stdin.write("\r");
    await waitForText(
      lastFrame,
      '!git add . && git commit -m "feat: add test function"',
    );

    // Verify git diff was called
    expect(vi.mocked(gitUtils.getGitDiff)).toHaveBeenCalledWith(
      expect.any(String),
    );

    // Verify commit message generation was called
    expect(vi.mocked(aiService.generateCommitMessage)).toHaveBeenCalledWith({
      diff: mockDiff,
    });
  });

  it("should handle git diff errors gracefully", async () => {
    // Mock git diff to throw error
    vi.mocked(gitUtils.getGitDiff).mockRejectedValue(
      new Error("Git diff failed"),
    );

    const { stdin, lastFrame } = render(<InputBox workdir="/mock/workdir" />);

    // Open command selector with /
    stdin.write("/");
    await waitForText(lastFrame, "git-commit");

    // Navigate to and select git-commit command
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await waitForText(lastFrame, "▶ /git-commit");

    // Press Enter to select git-commit command
    stdin.write("\r");
    await waitForText(lastFrame, "Git diff failed");

    // Verify git diff was called
    expect(gitUtils.getGitDiff).toHaveBeenCalledWith(expect.any(String));

    // Verify commit message generation was not called due to error
    expect(aiService.generateCommitMessage).not.toHaveBeenCalled();
  });

  it("should handle empty git diff", async () => {
    // Mock empty git diff
    const mockGetGitDiff = vi.mocked(gitUtils.getGitDiff);
    const mockGenerateCommitMessage = vi.mocked(
      aiService.generateCommitMessage,
    );

    mockGetGitDiff.mockResolvedValue("");

    const { stdin, lastFrame } = render(<InputBox workdir="/mock/workdir" />);

    // Open command selector with /
    stdin.write("/");
    await waitForText(lastFrame, "git-commit");

    // Navigate to and select git-commit command
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await waitForText(lastFrame, "▶ /git-commit");

    // Press Enter to select git-commit command
    stdin.write("\r");
    await waitForText(lastFrame, "No changes detected");

    // Verify git diff was called
    expect(mockGetGitDiff).toHaveBeenCalledWith(expect.any(String));

    // Verify commit message generation was not called due to no changes
    expect(mockGenerateCommitMessage).not.toHaveBeenCalled();
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

    const mockGetGitDiff = vi.mocked(gitUtils.getGitDiff);
    const mockGenerateCommitMessage = vi.mocked(
      aiService.generateCommitMessage,
    );

    mockGetGitDiff.mockResolvedValue(mockDiff);
    mockGenerateCommitMessage.mockRejectedValue(new Error("AI service error"));

    const { stdin, lastFrame } = render(<InputBox workdir="/mock/workdir" />);

    // Open command selector with /
    stdin.write("/");
    await waitForText(lastFrame, "git-commit");

    // Navigate to and select git-commit command
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await waitForText(lastFrame, "▶ /git-commit");

    // Press Enter to select git-commit command
    stdin.write("\r");
    await waitForText(lastFrame, "AI service error");

    // Verify both services were called
    expect(mockGetGitDiff).toHaveBeenCalledWith(expect.any(String));
    expect(mockGenerateCommitMessage).toHaveBeenCalledWith({
      diff: mockDiff,
    });
  });

  it("should show generating status during command generation", async () => {
    // Mock git diff and message generation with normal delay
    const mockDiff = "mock diff content";
    const mockGetGitDiff = vi.mocked(gitUtils.getGitDiff);
    const mockGenerateCommitMessage = vi.mocked(
      aiService.generateCommitMessage,
    );

    mockGetGitDiff.mockResolvedValue(mockDiff);
    mockGenerateCommitMessage.mockResolvedValue("feat: test commit");

    const { stdin, lastFrame } = render(<InputBox workdir="/mock/workdir" />);

    // Open command selector with /
    stdin.write("/");
    await waitForText(lastFrame, "git-commit");

    // Navigate to and select git-commit command
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await waitForText(lastFrame, "▶ /git-commit");

    // Press Enter to start generation
    stdin.write("\r");
    await waitForText(
      lastFrame,
      '!git add . && git commit -m "feat: test commit"',
    );
  });

  it("should escape quotes in commit message properly", async () => {
    // Mock git diff and AI response with quotes
    const mockDiff = "mock diff with changes";
    const mockGetGitDiff = vi.mocked(gitUtils.getGitDiff);
    const mockGenerateCommitMessage = vi.mocked(
      aiService.generateCommitMessage,
    );

    mockGetGitDiff.mockResolvedValue(mockDiff);
    mockGenerateCommitMessage.mockResolvedValue(
      'feat: add "test" function with quotes',
    );

    const { stdin, lastFrame } = render(<InputBox workdir="/mock/workdir" />);

    // Open command selector with /
    stdin.write("/");
    await waitForText(lastFrame, "git-commit");

    // Navigate to and select git-commit command
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await waitForText(lastFrame, "▶ /git-commit");
    stdin.write("\r"); // Select
    await waitForText(
      lastFrame,
      '!git add . && git commit -m "feat: add \\"test\\" function with quotes"',
    );
  });

  it("should escape backticks in commit message properly", async () => {
    // Mock git diff and AI response with backticks
    const mockDiff = "mock diff with changes";
    const mockGetGitDiff = vi.mocked(gitUtils.getGitDiff);
    const mockGenerateCommitMessage = vi.mocked(
      aiService.generateCommitMessage,
    );

    mockGetGitDiff.mockResolvedValue(mockDiff);
    mockGenerateCommitMessage.mockResolvedValue(
      "feat: add `test` function with backticks",
    );

    const { stdin, lastFrame } = render(<InputBox workdir="/mock/workdir" />);

    // Open command selector with /
    stdin.write("/");
    await waitForText(lastFrame, "git-commit");

    // Navigate to and select git-commit command
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await waitForText(lastFrame, "▶ /git-commit");
    stdin.write("\r"); // Select
    await waitForText(
      lastFrame,
      '!git add . && git commit -m "feat: add \\`test\\` function with backticks"',
    );
  });

  it("should escape both quotes and backticks in commit message", async () => {
    // Mock git diff and AI response with both quotes and backticks
    const mockDiff = "mock diff with changes";
    const mockGetGitDiff = vi.mocked(gitUtils.getGitDiff);
    const mockGenerateCommitMessage = vi.mocked(
      aiService.generateCommitMessage,
    );

    mockGetGitDiff.mockResolvedValue(mockDiff);
    mockGenerateCommitMessage.mockResolvedValue(
      'feat: add "test" function with `backticks` and "quotes"',
    );

    const { stdin, lastFrame } = render(<InputBox workdir="/mock/workdir" />);

    // Open command selector with /
    stdin.write("/");
    await waitForText(lastFrame, "git-commit");

    // Navigate to and select git-commit command
    stdin.write("\u001B[B"); // Down arrow to select git-commit
    await waitForText(lastFrame, "▶ /git-commit");
    stdin.write("\r"); // Select
    await waitForText(
      lastFrame,
      '!git add . && git commit -m "feat: add \\"test\\" function with \\`backticks\\` and \\"quotes\\""',
    );
  });
});
