export interface QueuedMessage {
  type?: "message" | "bang";
  content: string;
  images?: Array<{ path: string; mimeType: string }>;
  longTextMap?: Record<string, string>;
}

export class MessageQueue {
  private queue: QueuedMessage[] = [];
  onMessageEnqueued?: () => void;

  enqueue(message: QueuedMessage): void {
    this.queue.push(message);
    this.onMessageEnqueued?.();
  }

  dequeue(): QueuedMessage | null {
    return this.queue.shift() ?? null;
  }

  clear(): void {
    this.queue = [];
  }

  hasPending(): boolean {
    return this.queue.length > 0;
  }

  getQueue(): QueuedMessage[] {
    return [...this.queue];
  }

  removeAt(index: number): boolean {
    if (index < 0 || index >= this.queue.length) {
      return false;
    }
    this.queue.splice(index, 1);
    this.onMessageEnqueued?.();
    return true;
  }
}
