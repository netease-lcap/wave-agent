export type QueueState = "idle" | "dispatching" | "running";

export interface QueuedMessage {
  id?: string;
  type?: "message" | "bang" | "notification";
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

  /**
   * Clear user-facing items (messages, bang commands) but preserve pending
   * notifications so background task results are not lost on abort.
   */
  clear(): void {
    this.queue = this.queue.filter((m) => m.type === "notification");
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

  updateById(
    id: string,
    patch: {
      content?: string;
      images?: Array<{ path: string; mimeType: string }>;
      type?: "message" | "bang";
    },
  ): boolean {
    const m = this.queue.find((x) => x.id === id);
    if (!m) return false;
    if (patch.content !== undefined) m.content = patch.content;
    if (patch.images !== undefined) m.images = patch.images;
    if (patch.type !== undefined) m.type = patch.type;
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

  /**
   * Enqueue a background task notification (XML string). Notifications are
   * not user-editable and not surfaced in the queued-messages UI.
   */
  enqueueNotification(xml: string): void {
    this.queue.push({
      id: `mq-${this.nextId++}`,
      type: "notification",
      content: xml,
      editable: false,
    });
    this.onMessageEnqueued?.();
  }

  /** Whether any notification items are pending. */
  hasNotifications(): boolean {
    return this.queue.some((m) => m.type === "notification");
  }

  /**
   * Drain all notification items, returning their XML content. Non-notification
   * items (messages, bang commands) are preserved in the queue.
   */
  drainNotifications(): string[] {
    const notifications: string[] = [];
    const remaining: QueuedMessage[] = [];
    for (const msg of this.queue) {
      if (msg.type === "notification") {
        notifications.push(msg.content);
      } else {
        remaining.push(msg);
      }
    }
    this.queue = remaining;
    return notifications;
  }
}
