import { useChat } from "../contexts/useChat.js";

export const useTasks = () => {
  const { tasks } = useChat();
  return tasks;
};
