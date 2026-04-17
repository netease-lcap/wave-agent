import { describe, it, expect, vi } from "vitest";
import { MessageQueue } from "../../src/managers/messageQueue.js";

describe("MessageQueue", () => {
  describe("removeAt", () => {
    it("should remove a message at a valid index", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "msg1" });
      queue.enqueue({ content: "msg2" });
      queue.enqueue({ content: "msg3" });

      const result = queue.removeAt(1);

      expect(result).toBe(true);
      expect(queue.getQueue()).toHaveLength(2);
      expect(queue.getQueue()[0].content).toBe("msg1");
      expect(queue.getQueue()[1].content).toBe("msg3");
    });

    it("should return false for negative index", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "msg1" });

      const result = queue.removeAt(-1);

      expect(result).toBe(false);
      expect(queue.getQueue()).toHaveLength(1);
    });

    it("should return false for index >= length", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "msg1" });

      const result = queue.removeAt(1);

      expect(result).toBe(false);
      expect(queue.getQueue()).toHaveLength(1);
    });

    it("should call onMessageEnqueued callback after removal", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "msg1" });
      queue.enqueue({ content: "msg2" });

      const callback = vi.fn();
      queue.onMessageEnqueued = callback;

      queue.removeAt(0);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should handle removal from single-element queue", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "only" });

      const result = queue.removeAt(0);

      expect(result).toBe(true);
      expect(queue.getQueue()).toHaveLength(0);
    });

    it("should return correct state after removal", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a" });
      queue.enqueue({ content: "b" });
      queue.enqueue({ content: "c" });
      queue.enqueue({ content: "d" });

      queue.removeAt(2);

      const remaining = queue.getQueue();
      expect(remaining.map((m: { content: string }) => m.content)).toEqual([
        "a",
        "b",
        "d",
      ]);
    });
  });
});
