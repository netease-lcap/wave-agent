import { useChat } from "../contexts/useChat.js";

export const useTasks = () => {
  const { sessionTasks } = useChat();
  return sessionTasks;
};
