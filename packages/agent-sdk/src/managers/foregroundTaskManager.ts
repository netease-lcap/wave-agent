import { ForegroundTask, IForegroundTaskManager } from "../types/processes.js";

export class ForegroundTaskManager implements IForegroundTaskManager {
  private activeForegroundTasks: ForegroundTask[] = [];

  public registerForegroundTask(task: ForegroundTask): void {
    this.activeForegroundTasks.push(task);
  }

  public unregisterForegroundTask(id: string): void {
    this.activeForegroundTasks = this.activeForegroundTasks.filter(
      (t) => t.id !== id,
    );
  }

  public async backgroundCurrentTask(): Promise<void> {
    const tasks = [...this.activeForegroundTasks].reverse();
    this.activeForegroundTasks = [];
    for (const task of tasks) {
      await task.backgroundHandler();
    }
  }

  public hasActiveTasks(): boolean {
    return this.activeForegroundTasks.length > 0;
  }
}
