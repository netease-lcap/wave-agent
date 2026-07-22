import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, act, sendCommand } from './test-utils';

const tasks = [
  { id: '1', subject: '分析现有架构', description: '审查实现', status: 'completed', blocks: [], blockedBy: [], metadata: {} },
  { id: '2', subject: '实现乐观锁', description: '引入版本号控制', status: 'in_progress', activeForm: '编写中间件', blocks: ['3'], blockedBy: [], metadata: {} },
  { id: '3', subject: '编写集成测试', description: '覆盖并发场景', status: 'pending', blocks: [], blockedBy: ['2'], metadata: {} }
];

describe('Task list card pinned above input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the task list card above the input when tasks arrive and shows progress n / N', async () => {
    renderChatApp();

    act(() => {
      sendCommand('updateTasks', { tasks });
    });

    await waitFor(() => {
      expect(screen.getByTestId('task-list')).toBeInTheDocument();
    });
    // Title shows total count; stats show per-status counts
    expect(screen.getByTestId('task-list')).toHaveTextContent('任务列表 (3)');
    expect(screen.getByTestId('task-list')).toHaveTextContent('已完成 1');
    expect(screen.getByTestId('task-list')).toHaveTextContent('进行中 1');
    expect(screen.getByTestId('task-list')).toHaveTextContent('待执行 1');
    expect(screen.getByTestId('task-list')).toHaveTextContent('#2 实现乐观锁');
    expect(screen.getByTestId('task-list')).toHaveTextContent('依赖 #2');
  });

  it('does not render the card when there are no tasks', async () => {
    renderChatApp();
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
  });
});

describe('collapse via updateTasks', () => {
  it('collapses when isTaskListCollapsed:true', async () => {
    renderChatApp();
    act(() => {
      sendCommand('updateTasks', { tasks });
    });
    await waitFor(() => expect(screen.getByTestId('task-list')).toBeInTheDocument());
    expect(document.querySelector('.task-list-items')).toBeInTheDocument();
    expect(document.querySelector('.task-list-chevron')?.classList.contains('expanded')).toBe(true);
    act(() => {
      sendCommand('updateTasks', { tasks, isTaskListCollapsed: true });
    });
    await waitFor(() => {
      expect(document.querySelector('.task-list-chevron')?.classList.contains('expanded')).toBe(false);
    });
    expect(document.querySelector('.task-list-items')).not.toBeInTheDocument();
  });
});
