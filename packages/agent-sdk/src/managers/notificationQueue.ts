export class NotificationQueue {
  private queue: string[] = [];
  onNotificationsEnqueued?: () => void;

  enqueue(notification: string): void {
    this.queue.push(notification);
    this.onNotificationsEnqueued?.();
  }

  dequeueAll(): string[] {
    const items = [...this.queue];
    this.queue = [];
    return items;
  }

  hasPending(): boolean {
    return this.queue.length > 0;
  }
}
