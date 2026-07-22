import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, act, sendCommand } from './test-utils';

const tasks = [
  { id: '1', subject: '分析现有架构', description: '审查实现', status: 'completed', blocks: [], blockedBy: [], metadata: {} },
  { id: '2', subject: '实现乐观锁', description: '引入版本号控制', status: 'in_progress', activeForm: '编写中间件', blocks: ['3'], blockedBy: [], metadata: {} },
  { id: '3', subject: '编写集成测试', description: '覆盖并发场景', status: 'pending', blocks: [], blockedBy: ['2'], metadata: {} }
];

const assistantWith = (blocks: unknown[], id = 'msg_assistant') => ({
  id,
  role: 'assistant' as const,
  timestamp: '2025-01-01T00:00:00.000Z',
  blocks
});

const completeBlock = () => ({
  type: 'tool',
  name: 'TaskUpdate',
  stage: 'end',
  parameters: JSON.stringify({ taskId: '1', status: 'completed' }),
  result: 'Updated task #1'
});

describe('Task list card in message stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the task list card at a TaskUpdate(completed) block and shows progress n / N', async () => {
    renderChatApp();

    act(() => {
      sendCommand('updateTasks', { tasks });
      sendCommand('updateMessages', { messages: [assistantWith([completeBlock()])] });
    });

    await waitFor(() => {
      expect(screen.getByTestId('task-list')).toBeInTheDocument();
    });
    // 1 completed of 3 total (none deleted)
    expect(screen.getByTestId('task-list')).toHaveTextContent('任务 1 / 3');
    expect(screen.getByTestId('task-list')).toHaveTextContent('#2 实现乐观锁');
    expect(screen.getByTestId('task-list')).toHaveTextContent('依赖 #2');
  });

  it('does not render the card for non-completed task tool blocks', async () => {
    renderChatApp();

    act(() => {
      sendCommand('updateTasks', { tasks });
      sendCommand('updateMessages', {
        messages: [assistantWith([
          { type: 'tool', name: 'TaskCreate', stage: 'end', parameters: JSON.stringify({ subject: 'x', description: 'y' }) },
          { type: 'tool', name: 'TaskUpdate', stage: 'end', parameters: JSON.stringify({ taskId: '2', status: 'in_progress' }) }
        ])]
      });
    });

    // No card, and the hidden task tool blocks produce no visible tool header
    await waitFor(() => {
      expect(screen.getByTestId('messages-container')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
    expect(document.querySelector('.tool-block')).not.toBeInTheDocument();
  });

  it('renders the card only at the globally-last completed block', async () => {
    renderChatApp();

    act(() => {
      sendCommand('updateTasks', { tasks });
      sendCommand('updateMessages', {
        messages: [
          assistantWith([completeBlock()], 'msg_a'),
          assistantWith([completeBlock()], 'msg_b')
        ]
      });
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('task-list').length).toBe(1);
    });
  });
});

describe('collapse via updateTasks', () => {
  it('collapses when isTaskListCollapsed:true', async () => {
    renderChatApp();
    act(() => {
      sendCommand('updateTasks', { tasks });
      sendCommand('updateMessages', { messages: [assistantWith([completeBlock()])] });
    });
    await waitFor(() => expect(screen.getByTestId('task-list')).toBeInTheDocument());
    expect(document.querySelector('.task-list-items')).toBeInTheDocument();
    act(() => {
      sendCommand('updateTasks', { tasks, isTaskListCollapsed: true });
    });
    await waitFor(() => {
      expect(document.querySelector('.task-list-chevron')?.classList.contains('codicon-chevron-right')).toBe(true);
    });
    expect(document.querySelector('.task-list-items')).not.toBeInTheDocument();
  });
});
