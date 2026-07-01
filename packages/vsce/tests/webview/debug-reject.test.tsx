import { describe, it, expect } from 'vitest';
import { renderChatApp, act, sendCommand } from './test-utils';
import { EDIT_TOOL_NAME } from 'wave-agent-sdk';

describe('debug reject', () => {
  it('check DOM for Edit tool', async () => {
    const { vscode } = renderChatApp();
    vscode.postMessage.mockClear();

    await act(async () => {
      sendCommand('showConfirmation', {
        confirmationId: 'test_edit',
        toolName: EDIT_TOOL_NAME,
        confirmationType: '代码修改待确认',
        toolInput: { file_path: 'test.ts', old_string: 'old', new_string: 'new' }
      });
    });

    const rejectBtn = document.querySelector('.confirmation-btn-reject');
    console.log('rejectBtn:', rejectBtn ? rejectBtn.outerHTML : 'null');
    console.log('rejectBtn in doc:', rejectBtn ? 'YES' : 'NO');
    
    const dialog = document.querySelector('.confirmation-dialog');
    console.log('dialog innerHTML:', dialog?.innerHTML?.substring(0, 500));
    
    expect(true).toBe(true);
  });
});
