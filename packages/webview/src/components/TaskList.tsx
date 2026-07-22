import React from 'react';
import type { Task, TaskStatus } from '../types';
import '../styles/TaskList.css';

interface TaskListProps {
  tasks: Task[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const getStatusIcon = (status: TaskStatus) => {
  switch (status) {
    case 'completed':
      return <span className="codicon codicon-check task-status completed"></span>;
    case 'in_progress':
      return <span className="codicon codicon-loading task-status in_progress"></span>;
    case 'deleted':
      return <span className="codicon codicon-trash task-status deleted"></span>;
    case 'pending':
    default:
      return <span className="codicon codicon-circle-outline task-status pending"></span>;
  }
};

export const TaskList: React.FC<TaskListProps> = ({ tasks, isCollapsed, onToggleCollapse }) => {
  if (tasks.length === 0) {
    return null;
  }

  const total = tasks.filter((t) => t.status !== 'deleted').length;
  const completed = tasks.filter((t) => t.status === 'completed').length;

  return (
    <div className="task-list-inline" data-testid="task-list">
      <div
        className="task-list-plan-row"
        onClick={onToggleCollapse}
        title={isCollapsed ? '展开任务列表' : '折叠任务列表'}
      >
        <span className="task-list-progress">任务 {completed} / {total}</span>
        <span className={`codicon codicon-chevron-${isCollapsed ? 'right' : 'down'} task-list-chevron`}></span>
      </div>
      {!isCollapsed && (
        <div className="task-list-items">
          {tasks.map((task) => (
            <div key={task.id} className="task-row">
              {getStatusIcon(task.status)}
              <div className="task-content">
                <div className={`task-title ${task.status}`}>#{task.id} {task.subject}</div>
                {task.description && (
                  <div className="task-desc">{task.description}</div>
                )}
                {task.blockedBy && task.blockedBy.length > 0 && (
                  <div className="task-dep">依赖 {task.blockedBy.map((id) => `#${id}`).join('、')}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
