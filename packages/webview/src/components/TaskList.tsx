import React from 'react';
import type { Task, TaskStatus } from '../types';
import '../styles/TaskList.css';

interface TaskListProps {
  tasks: Task[];
  isVisible: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const getStatusIcon = (status: TaskStatus) => {
  switch (status) {
    case 'completed':
      return <span className="codicon codicon-check task-status-icon completed"></span>;
    case 'in_progress':
      return <span className="codicon codicon-loading task-status-icon in_progress"></span>;
    case 'pending':
      return <span className="codicon codicon-circle-outline task-status-icon pending"></span>;
    case 'deleted':
      return <span className="codicon codicon-trash task-status-icon deleted"></span>;
    default:
      return <span className="codicon codicon-question task-status-icon"></span>;
  }
};

export const TaskList: React.FC<TaskListProps> = ({ tasks, isVisible, isCollapsed, onToggleCollapse }) => {
  if (!isVisible || tasks.length === 0) {
    return null;
  }

  return (
    <div className={`task-list-container ${isCollapsed ? 'collapsed' : ''}`} data-testid="task-list">
      <div className="task-list-header" onClick={onToggleCollapse} title={isCollapsed ? "展开任务列表" : "折叠任务列表"}>
        <div className="task-list-title">
          <span className={`codicon codicon-chevron-${isCollapsed ? 'right' : 'down'}`}></span>
          任务列表
        </div>
        <div className="task-count">
          {tasks.length} 个任务
        </div>
      </div>
      {!isCollapsed && (
        <div className="task-items">
          {tasks.map((task) => (
            <div key={task.id} className={`task-item ${task.status}`}>
              <div className="task-item-main">
                {getStatusIcon(task.status)}
                <div className="task-subject">
                  #{task.id} {task.subject}
                  {task.status === 'in_progress' && task.activeForm && (
                    <span className="task-active-form">({task.activeForm})</span>
                  )}
                </div>
              </div>
              {(task.description || (task.blockedBy && task.blockedBy.length > 0)) && (
                <div className="task-details">
                  {task.description && (
                    <div className="task-description">{task.description}</div>
                  )}
                  {task.blockedBy && task.blockedBy.length > 0 && (
                    <div className="task-blocked-by">
                      <span className="codicon codicon-lock"></span>
                      等待: {task.blockedBy.map(id => `#${id}`).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
