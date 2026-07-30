import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderChatApp, screen, waitFor, act, sendCommand, fireEvent } from './test-utils';

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

describe('scroll updated task into view', () => {
  it('scrolls the status-changed task to center on updateTasks', async () => {
    const scrollIntoView = vi.fn();
    // jsdom doesn't implement Element.scrollIntoView
    window.Element.prototype.scrollIntoView = scrollIntoView;

    renderChatApp();
    act(() => {
      sendCommand('updateTasks', { tasks });
    });
    await waitFor(() => expect(screen.getByTestId('task-list')).toBeInTheDocument());
    // 初始渲染也算"新增"，会触发一次滚动
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'center', behavior: 'smooth' }),
    );
    scrollIntoView.mockClear();

    // task #3 从 pending → in_progress
    const updated = tasks.map((t) =>
      t.id === '3' ? { ...t, status: 'in_progress' as const } : t,
    );
    act(() => {
      sendCommand('updateTasks', { tasks: updated });
    });
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ block: 'center', behavior: 'smooth' }),
      );
    });
    // 滚动的是 #3 这一行
    const scrolledEl = (scrollIntoView.mock.instances[0] as Element) || document.querySelector('[data-task-id="3"]');
    expect(scrolledEl?.getAttribute('data-task-id')).toBe('3');
  });
});

describe('auto-hide when all tasks completed', () => {
  const mixed = [
    { id: '1', subject: '任务一', description: '', status: 'in_progress', blocks: [], blockedBy: [], metadata: {} },
    { id: '2', subject: '任务二', description: '', status: 'pending', blocks: [], blockedBy: [], metadata: {} },
  ];
  const allCompleted = [
    { id: '1', subject: '任务一', description: '', status: 'completed', blocks: [], blockedBy: [], metadata: {} },
    { id: '2', subject: '任务二', description: '', status: 'completed', blocks: [], blockedBy: [], metadata: {} },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides immediately when loaded with all tasks completed', async () => {
    renderChatApp();
    act(() => {
      sendCommand('updateTasks', { tasks: allCompleted });
    });
    // 加载即全部完成：立即隐藏，不经历 5 秒展示
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
  });

  it('stays visible 5s then hides when tasks complete during the session', async () => {
    renderChatApp();
    act(() => {
      sendCommand('updateTasks', { tasks: mixed });
    });
    expect(screen.getByTestId('task-list')).toBeInTheDocument();

    act(() => {
      sendCommand('updateTasks', { tasks: allCompleted });
    });
    // 任务在用户观看期间完成：保留 5 秒宽限
    expect(screen.getByTestId('task-list')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(screen.getByTestId('task-list')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
  });

  it('reappears when a new non-completed task arrives after auto-hide', async () => {
    renderChatApp();
    act(() => {
      sendCommand('updateTasks', { tasks: mixed });
    });
    act(() => {
      sendCommand('updateTasks', { tasks: allCompleted });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();

    const withPending = [
      ...allCompleted,
      { id: '3', subject: '任务三', description: '', status: 'pending' as const, blocks: [], blockedBy: [], metadata: {} },
    ];
    act(() => {
      sendCommand('updateTasks', { tasks: withPending });
    });
    expect(screen.getByTestId('task-list')).toBeInTheDocument();
  });

  it('stays hidden when switching to a session whose tasks are all completed', async () => {
    const { vscode } = renderChatApp();
    const sessions = [
      {
        id: 'session-a',
        sessionType: 'main',
        workdir: '/test/project',
        firstMessage: 'Session A',
        lastActiveAt: new Date('2023-12-01T10:00:00Z'),
        latestTotalTokens: 100
      },
      {
        id: 'session-b',
        sessionType: 'main',
        workdir: '/test/project',
        firstMessage: 'Session B',
        lastActiveAt: new Date('2023-12-01T11:00:00Z'),
        latestTotalTokens: 200
      }
    ];
    act(() => {
      sendCommand('updateSessions', { sessions });
      sendCommand('updateTasks', { tasks: mixed });
    });
    expect(screen.getByTestId('task-list')).toBeInTheDocument();

    // 选择历史会话：任务列表立即清空，并发起 restoreSession
    act(() => {
      fireEvent.click(screen.getByTestId('history-btn'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('session-list-item-session-b'));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'restoreSession', sessionId: 'session-b' })
    );
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();

    // 后端推送恢复会话的任务（全部完成）：保持隐藏，不闪现
    act(() => {
      sendCommand('updateTasks', { tasks: allCompleted });
    });
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
  });
});

describe('desktop session switch via setInitialState', () => {
  const mixed = [
    { id: '1', subject: '任务一', description: '', status: 'in_progress', blocks: [], blockedBy: [], metadata: {} },
    { id: '2', subject: '任务二', description: '', status: 'pending', blocks: [], blockedBy: [], metadata: {} },
  ];
  const allCompleted = [
    { id: '1', subject: '任务一', description: '', status: 'completed', blocks: [], blockedBy: [], metadata: {} },
    { id: '2', subject: '任务二', description: '', status: 'completed', blocks: [], blockedBy: [], metadata: {} },
  ];
  const makeSession = (id: string) => ({
    id,
    sessionType: 'main',
    workdir: '/test/project',
    firstMessage: `Session ${id}`,
    lastActiveAt: new Date('2023-12-01T10:00:00Z'),
    latestTotalTokens: 100
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays hidden when switching from a session with incomplete tasks to an all-completed one', async () => {
    renderChatApp();
    // 桌面端会话 A：存在未完成任务，任务列表可见
    act(() => {
      sendCommand('setInitialState', {
        messages: [],
        tasks: mixed,
        session: makeSession('session-a'),
        isAuthenticated: true
      });
    });
    expect(screen.getByTestId('task-list')).toBeInTheDocument();

    // 桌面端侧边栏切换到会话 B：宿主一次性推送 setInitialState（不经过清空任务）
    act(() => {
      sendCommand('setInitialState', {
        messages: [],
        tasks: allCompleted,
        session: makeSession('session-b'),
        isAuthenticated: true
      });
    });
    // 会话 B 任务全部完成：立即隐藏，不经历 5 秒展示
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
  });

  it('keeps the 5s grace when tasks complete within the same session', async () => {
    renderChatApp();
    act(() => {
      sendCommand('setInitialState', {
        messages: [],
        tasks: mixed,
        session: makeSession('session-a'),
        isAuthenticated: true
      });
    });
    expect(screen.getByTestId('task-list')).toBeInTheDocument();

    // 同一会话内任务完成（会话 id 不变）：保留 5 秒宽限
    act(() => {
      sendCommand('updateTasks', { tasks: allCompleted });
    });
    expect(screen.getByTestId('task-list')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByTestId('task-list')).not.toBeInTheDocument();
  });
});
