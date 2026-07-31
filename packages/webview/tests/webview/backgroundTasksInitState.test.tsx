import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, act, sendCommand } from './test-utils';
import type { BackgroundTaskSummary } from '../../src/types';

const runningTask: BackgroundTaskSummary = {
  id: 'bg-1',
  type: 'shell',
  status: 'running',
  startTime: 1000,
  command: 'sleep 300',
  description: 'long-running build'
};

describe('Background tasks visibility across setInitialState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves running background tasks when the host re-pushes setInitialState (webview re-init / pane switch)', () => {
    // Repro: agent starts a background bash task; a mid-session setInitialState
    // (VSCE sidebar cold-start, desktop pane/session switch, rewind) re-pushes
    // state. The host includes backgroundTasks in the payload, so the running
    // task must stay visible in /tasks — not wiped to "暂无后台任务".
    renderChatApp();

    act(() => {
      sendCommand('setInitialState', {
        messages: [],
        backgroundTasks: [runningTask],
        isAuthenticated: true,
      });
    });

    act(() => {
      sendCommand('showDialog', { dialogType: 'tasks' });
    });

    const manager = screen.getByTestId('background-task-manager');
    expect(manager).toHaveTextContent('sleep 300');
    expect(manager).toHaveTextContent('running');
    expect(manager).not.toHaveTextContent('暂无后台任务');
  });

  it('shows background tasks pushed incrementally via updateBackgroundTasks (baseline)', () => {
    // Baseline: the incremental notification path (also used by stopTask)
    // populates the list and is unaffected by the setInitialState wiring.
    renderChatApp();

    act(() => {
      sendCommand('updateBackgroundTasks', { tasks: [runningTask] });
    });
    act(() => {
      sendCommand('showDialog', { dialogType: 'tasks' });
    });

    const manager = screen.getByTestId('background-task-manager');
    expect(manager).toHaveTextContent('sleep 300');
    expect(manager).not.toHaveTextContent('暂无后台任务');
  });
});
