import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { Message, EDIT_TOOL_NAME } from 'wave-agent-sdk';

test.describe('Diff Viewer User Reported Case', () => {
  test('should maintain correct line order for the user reported case', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // The specific case reported by the user
    const mockEditMessage: Message = {
      id: 'msg_user_reported_1',
      role: 'assistant' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'tool',
          name: EDIT_TOOL_NAME,
          parameters: JSON.stringify({
            file_path: '/home/liuyiqi/code/bin/scripts/i-wave-agent.sh',
            old_string: 'pkg_name="wave-agent-sdk-$(date +%s).tgz"\nmv ./packages/agent-sdk/wave-agent-sdk-*.tgz "$dir/$pkg_name"',
            new_string: 'rm -f "$dir"/wave-agent-sdk-*.tgz\npkg_name="wave-agent-sdk-$(date +%s).tgz"\nmv ./packages/agent-sdk/wave-agent-sdk-*.tgz "$dir/$pkg_name"'
          }),
          compactParams: 'scripts/i-wave-agent.sh',
          stage: 'end' as const,
          success: true,
          id: 'user_reported_case'
        }
      ]
    };

    await injector.updateMessages([mockEditMessage]);

    // Check that diff viewer is present
    await expect(webviewPage.locator('.diff-viewer-container')).toBeVisible();

    // Get all diff lines in order
    const diffLines = webviewPage.locator('.diff-line');
    const count = await diffLines.count();
    
    const lineTexts = [];
    for (let i = 0; i < count; i++) {
      const text = await diffLines.nth(i).innerText();
      // Clean up the text for comparison (remove extra whitespace/newlines from rendering)
      lineTexts.push(text.replace(/\s+/g, ' ').trim());
    }

    // Expected order based on the user's data:
    // 1. + rm -f "$dir"/wave-agent-sdk-*.tgz (Added line)
    // 2. pkg_name="wave-agent-sdk-$(date +%s).tgz" (Context line)
    // 3. mv ./packages/agent-sdk/wave-agent-sdk-*.tgz "$dir/$pkg_name" (Context line)
    
    expect(lineTexts[0]).toContain('+ rm -f');
    expect(lineTexts[1]).toContain('pkg_name=');
    expect(lineTexts[2]).toContain('mv');
    
    // Verify that the added line is indeed first
    expect(lineTexts[0]).toMatch(/^\+/);
    // Verify that the following lines are context lines (no prefix or space prefix)
    expect(lineTexts[1]).not.toMatch(/^\+/);
    expect(lineTexts[1]).not.toMatch(/^-/);
    expect(lineTexts[2]).not.toMatch(/^\+/);
    expect(lineTexts[2]).not.toMatch(/^-/);
  });
});
