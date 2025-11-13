import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  MockedFunction,
} from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "../../src/components/InputBox.js";
import { waitForText, waitForTextToDisappear } from "../helpers/waitHelpers.js";
import { searchFiles, type FileItem } from "../../src/utils/fileSearch.js";

// Mock the file search utility
vi.mock("../../src/utils/fileSearch.js", () => ({
  searchFiles: vi.fn(),
}));

describe("InputBox File Selector", () => {
  let originalCwd: string;
  let searchFilesMock: MockedFunction<typeof searchFiles>;

  beforeAll(async () => {
    // Save original working directory
    originalCwd = process.cwd();
    searchFilesMock = vi.mocked(searchFiles);
  });

  afterAll(() => {
    // Restore original working directory
    process.chdir(originalCwd);
  });

  // Helper function to setup search results for specific test cases
  const setupSearchMock = (mockResults: FileItem[]) => {
    searchFilesMock.mockClear(); // Clear previous calls
    searchFilesMock.mockResolvedValue(mockResults);
  };

  it("should trigger file selector when @ is typed", async () => {
    // Setup mock to return test files when @ is typed (empty query)
    setupSearchMock([
      { path: "src", type: "directory" },
      { path: "src/index.ts", type: "file" },
      { path: "src/components/App.tsx", type: "file" },
      { path: "src/cli.tsx", type: "file" },
      { path: "package.json", type: "file" },
    ]);

    const { stdin, lastFrame } = render(<InputBox />);

    // Input @ symbol
    stdin.write("@");

    // Allow React to process the state updates
    await waitForText(lastFrame, "Select File");

    // Verify file selector appears with mocked files
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain("src/index.ts");
    expect(lastFrame()).toContain("src/cli.tsx");
    // Verify at least some files are displayed
    expect(lastFrame()).toMatch(/File \d+ of \d+/);

    // Verify the search function was called with empty query
    expect(searchFilesMock).toHaveBeenCalledWith("");
  });

  it("should filter files when typing after @", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // First input @ to trigger file selector
    stdin.write("@");
    await waitForText(lastFrame, "Select File");

    // Setup mock for "src" query - should return only src-related files
    setupSearchMock([
      { path: "src", type: "directory" },
      { path: "src/index.ts", type: "file" },
      { path: "src/components/App.tsx", type: "file" },
      { path: "src/cli.tsx", type: "file" },
    ]);

    // Then input filter condition (search for files containing "src")
    stdin.write("src");
    await waitForText(lastFrame, 'filtering: "src"');

    // Verify file selector displays filtered results
    const output = lastFrame();
    expect(output).toContain('filtering: "src"');
    expect(output).toContain("src/index.ts");
    // package.json should be filtered out - but we need to check the new mock results
    // Since we mocked new results, we just verify the search was called
    expect(searchFilesMock).toHaveBeenCalledWith("src");
  });

  it("should filter files with more specific query", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // First input @ to trigger file selector
    stdin.write("@");
    await waitForText(lastFrame, "Select File");

    // Setup mock for "tsx" query - put cli.tsx first since it will be selected
    setupSearchMock([
      { path: "src/cli.tsx", type: "file" },
      { path: "src/components/App.tsx", type: "file" },
    ]);

    // Then input more specific filter condition
    stdin.write("tsx");

    await waitForText(lastFrame, 'filtering: "tsx"');

    // Verify only matching files are displayed
    const output = lastFrame();
    expect(output).toContain("Select File");
    expect(output).toContain('filtering: "tsx"');
    expect(output).toContain("src/cli.tsx");

    // Verify the search function was called with the query
    expect(searchFilesMock).toHaveBeenCalledWith("tsx");
  });

  it("should show no files message when no matches found", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // First input @ to trigger file selector
    stdin.write("@");
    await waitForText(lastFrame, "Select File");

    // Setup mock for "nonexistent" query - should return empty results
    setupSearchMock([]);

    // Then input non-existent file filter condition
    stdin.write("nonexistent");

    await waitForText(lastFrame, 'No files found for "nonexistent"');

    // Verify no matching files message is displayed
    expect(lastFrame()).toContain('No files found for "nonexistent"');
    expect(lastFrame()).toContain("Press Escape to cancel");

    // Verify the search function was called with the query
    expect(searchFilesMock).toHaveBeenCalledWith("nonexistent");
  });

  it("should close file selector when escape is pressed", async () => {
    // Setup mock for @ trigger
    setupSearchMock([{ path: "src", type: "directory" }]);

    const { stdin, lastFrame } = render(<InputBox />);

    // Input @ to trigger file selector
    stdin.write("@");
    await waitForText(lastFrame, "Select File");

    // Press Escape key
    stdin.write("\u001B"); // ESC key

    await waitForTextToDisappear(lastFrame, "Select File");

    // Verify file selector disappears
    expect(lastFrame()).not.toContain("Select File");
    expect(lastFrame()).toContain("@");
  });

  it("should close file selector when @ is deleted", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // First input @ to trigger file selector
    stdin.write("@");
    await waitForText(lastFrame, "Select File");

    // Delete @ character
    stdin.write("\u007F"); // Backspace

    await waitForTextToDisappear(lastFrame, "Select File");

    // Verify file selector disappears
    expect(lastFrame()).not.toContain("Select File");
  });

  it("should select file and replace @ query when Enter is pressed", async () => {
    // Setup mock with only files (directories first, then files)
    setupSearchMock([
      { path: "test.ts", type: "file" },
      { path: "app.tsx", type: "file" },
    ]);

    const { stdin, lastFrame } = render(<InputBox />);

    // Input @ to trigger file selector
    stdin.write("@");

    // Wait for files to appear
    await waitForText(lastFrame, "📄 test.ts");

    // Verify file selector displays the first file
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain("📄 test.ts");

    // Press Enter to select first file
    stdin.write("\r"); // Enter key

    await waitForTextToDisappear(lastFrame, "Select File");

    // Verify file selector disappears, text is replaced
    expect(lastFrame()).not.toContain("Select File");
    expect(lastFrame()).toContain("test.ts");
  });

  it("should navigate files with arrow keys in file selector", async () => {
    // Setup mock for @ trigger
    setupSearchMock([
      { path: "src", type: "directory" },
      { path: "src/index.ts", type: "file" },
      { path: "src/components/App.tsx", type: "file" },
      { path: "src/cli.tsx", type: "file" },
      { path: "package.json", type: "file" },
    ]);

    const { stdin, lastFrame } = render(<InputBox />);

    // Input @ to trigger file selector
    stdin.write("@");
    await waitForText(lastFrame, "📁 src");

    // Verify first item is shown (directories are shown first, so it should be src directory)
    expect(lastFrame()).toContain("📁 src");

    // Press down arrow key to move selection
    stdin.write("\u001B[B"); // Down arrow

    await waitForText(lastFrame, "📄 src/index.ts");

    // Verify file selector shows files (we can't easily test selection highlighting in ink)
    expect(lastFrame()).toContain("📄 src/index.ts");
    expect(lastFrame()).toContain("📁 src");

    // Press up arrow key
    stdin.write("\u001B[A"); // Up arrow

    await waitForText(lastFrame, "📁 src");

    // Verify file selector still shows both files and directories
    expect(lastFrame()).toContain("📁 src");
    expect(lastFrame()).toContain("📄 src/index.ts");
  });

  it("should handle complex input with @ in the middle", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Setup mock for when @ triggers the selector
    setupSearchMock([
      { path: "main.tsx", type: "file" },
      { path: "app.tsx", type: "file" },
    ]);

    // Input some text first
    stdin.write("Check this file ");
    await waitForText(lastFrame, "Check this file ");

    // Then add @ to trigger file selector
    stdin.write("@");

    await waitForText(lastFrame, "Select File");

    // Then add the search term
    stdin.write("tsx");
    await waitForText(lastFrame, 'filtering: "tsx"');

    // Select file
    stdin.write("\r"); // Enter

    await waitForTextToDisappear(lastFrame, "Select File");

    // Verify complete text - the @ and text after should be replaced with just the file path
    expect(lastFrame()).toContain("main.tsx");
    expect(lastFrame()).not.toContain("Select File");
  });
});
