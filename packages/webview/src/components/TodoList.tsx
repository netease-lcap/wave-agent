import React from 'react';
import type { ToolBlock } from '../types';
import '../styles/TodoList.css';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface TodoListProps {
  toolBlock: ToolBlock;
}

export const TodoList: React.FC<TodoListProps> = ({ toolBlock }) => {
  // Only render content after the tool has finished
  if (toolBlock.stage !== 'end') {
    return null;
  }

  // Parse the todos from parameters
  let todos: TodoItem[] = [];
  try {
    if (toolBlock.parameters) {
      const params = JSON.parse(toolBlock.parameters);
      todos = params.todos || [];
    }
  } catch {
    // If parsing fails, return null
    return null;
  }

  if (todos.length === 0) {
    return null;
  }

  return (
    <div className="todo-list">
      {todos.map((todo, index) => (
        <div key={todo.id || index} className={`todo-item todo-${todo.status || 'pending'}`}>
          <span className="todo-status-icon">
            {todo.status === 'completed' ? '✓' : 
             todo.status === 'in_progress' ? '⏳' : 
             '○'}
          </span>
          <span className="todo-content">{todo.content || ''}</span>
        </div>
      ))}
    </div>
  );
};