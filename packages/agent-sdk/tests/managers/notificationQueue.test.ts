import { describe, it, expect, vi } from "vitest";
import { NotificationQueue } from "../../src/managers/notificationQueue.js";

describe("NotificationQueue", () => {
  it("should start empty", () => {
    const queue = new NotificationQueue();
    expect(queue.hasPending()).toBe(false);
    expect(queue.dequeueAll()).toEqual([]);
  });

  it("should enqueue and dequeue notifications", () => {
    const queue = new NotificationQueue();
    queue.enqueue("notification-1");
    queue.enqueue("notification-2");

    expect(queue.hasPending()).toBe(true);
    const items = queue.dequeueAll();
    expect(items).toEqual(["notification-1", "notification-2"]);
    expect(queue.hasPending()).toBe(false);
  });

  it("should call onNotificationsEnqueued callback when enqueuing", () => {
    const queue = new NotificationQueue();
    const callback = vi.fn();
    queue.onNotificationsEnqueued = callback;

    queue.enqueue("test-notification");
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
