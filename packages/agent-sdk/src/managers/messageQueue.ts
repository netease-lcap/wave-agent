export type QueueState = "idle" | "dispatching" | "running";

export interface QueuedMessage {
  id?: string;
  type?: "message" | "bang";
  content: string;
  images?: Array<{ path: string; mimeType: string }>;
  longTextMap?: Record<string, string>;
  editable?: boolean; // default true
}

export class MessageQueue {
  private queue: QueuedMessage[] = [];
  private nextId = 0;
  private _state: QueueState = "idle";
  onMessageEnqueued?: () => void;

  get state(): QueueState {
    return this._state;
  }

  transitionTo(newState: QueueState): boolean {
    const valid: Record<QueueState, QueueState[]> = {
      idle: ["dispatching"],
      dispatching: ["running", "idle"],
      running: ["idle"],
    };
    if (!valid[this._state].includes(newState)) return false;
    this._state = newState;
    return true;
  }

  enqueue(message: QueuedMessage): void {
    const msg: QueuedMessage = {
      ...message,
      id: message.id || `mq-${this.nextId++}`,
      editable: message.editable ?? true,
    };
    this.queue.push(msg);
    this.onMessageEnqueued?.();
  }

  dequeue(): QueuedMessage | null {
    return this.queue.shift() ?? null;
  }

  clear(): void {
    this.queue = [];
    this._state = "idle";
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

  removeById(id: string): boolean {
    const index = this.queue.findIndex((m) => m.id === id);
    if (index === -1) return false;
    this.queue.splice(index, 1);
    this.onMessageEnqueued?.();
    return true;
  }

  popLastEditable(): QueuedMessage | null {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].editable !== false) {
        return this.queue.splice(i, 1)[0] ?? null;
      }
    }
    return null;
  }

  popAllEditable(): QueuedMessage[] {
    const editable: QueuedMessage[] = [];
    const remaining: QueuedMessage[] = [];
    for (const msg of this.queue) {
      if (msg.editable !== false) {
        editable.push(msg);
      } else {
        remaining.push(msg);
      }
    }
    this.queue = remaining;
    return editable;
  }
}
