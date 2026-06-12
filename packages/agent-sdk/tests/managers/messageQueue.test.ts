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

  describe("clear", () => {
    it("should clear all messages from queue", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "msg1" });
      queue.enqueue({ content: "msg2" });
      queue.enqueue({ content: "msg3" });

      queue.clear();

      expect(queue.getQueue()).toHaveLength(0);
      expect(queue.hasPending()).toBe(false);
    });

    it("should handle clearing an empty queue", () => {
      const queue = new MessageQueue();
      queue.clear();

      expect(queue.getQueue()).toHaveLength(0);
    });

    it("should allow enqueuing after clear", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "msg1" });
      queue.clear();
      queue.enqueue({ content: "msg2" });

      expect(queue.getQueue()).toHaveLength(1);
      expect(queue.getQueue()[0].content).toBe("msg2");
    });

    it("simulates race condition: dequeue after clear returns null", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "msg1" });
      queue.enqueue({ content: "msg2" });

      // Simulate abortMessage() race fix: clear first, then dequeue
      queue.clear();
      const dequeued = queue.dequeue();

      expect(dequeued).toBeNull();
      expect(queue.getQueue()).toHaveLength(0);
    });
  });

  describe("auto-assign id in enqueue", () => {
    it("should auto-assign id like mq-0, mq-1, etc.", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a" });
      queue.enqueue({ content: "b" });
      queue.enqueue({ content: "c" });

      const msgs = queue.getQueue();
      expect(msgs[0].id).toBe("mq-0");
      expect(msgs[1].id).toBe("mq-1");
      expect(msgs[2].id).toBe("mq-2");
    });

    it("should keep explicit id", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", id: "custom-1" });
      queue.enqueue({ content: "b" });

      const msgs = queue.getQueue();
      expect(msgs[0].id).toBe("custom-1");
      expect(msgs[1].id).toBe("mq-0");
    });

    it("should keep auto-increment counter independent of explicit ids", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", id: "custom-1" });
      queue.enqueue({ content: "b" });
      queue.enqueue({ content: "c", id: "custom-2" });
      queue.enqueue({ content: "d" });

      const msgs = queue.getQueue();
      expect(msgs[0].id).toBe("custom-1");
      expect(msgs[1].id).toBe("mq-0");
      expect(msgs[2].id).toBe("custom-2");
      expect(msgs[3].id).toBe("mq-1");
    });
  });

  describe("default editable in enqueue", () => {
    it("should default editable to true", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a" });

      expect(queue.getQueue()[0].editable).toBe(true);
    });

    it("should preserve explicit editable false", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", editable: false });

      expect(queue.getQueue()[0].editable).toBe(false);
    });

    it("should preserve explicit editable true", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", editable: true });

      expect(queue.getQueue()[0].editable).toBe(true);
    });
  });

  describe("popLastEditable", () => {
    it("should return the last editable message and remove it", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", editable: true });
      queue.enqueue({ content: "b", editable: false });
      queue.enqueue({ content: "c", editable: true });

      const result = queue.popLastEditable();

      expect(result?.content).toBe("c");
      expect(queue.getQueue()).toHaveLength(2);
      expect(queue.getQueue().map((m) => m.content)).toEqual(["a", "b"]);
    });

    it("should return null if no editable messages", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", editable: false });

      expect(queue.popLastEditable()).toBeNull();
      expect(queue.getQueue()).toHaveLength(1);
    });

    it("should return null on empty queue", () => {
      const queue = new MessageQueue();

      expect(queue.popLastEditable()).toBeNull();
    });

    it("should skip messages with editable: false", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", editable: false });
      queue.enqueue({ content: "b", editable: false });
      queue.enqueue({ content: "c", editable: true });

      const result = queue.popLastEditable();

      expect(result?.content).toBe("c");
      expect(queue.getQueue().map((m) => m.content)).toEqual(["a", "b"]);
    });

    it("should use default editable (true) when not specified", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a" });

      const result = queue.popLastEditable();

      expect(result?.content).toBe("a");
      expect(queue.getQueue()).toHaveLength(0);
    });
  });

  describe("popAllEditable", () => {
    it("should return all editable messages and remove them", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", editable: true });
      queue.enqueue({ content: "b", editable: false });
      queue.enqueue({ content: "c", editable: true });

      const result = queue.popAllEditable();

      expect(result.map((m) => m.content)).toEqual(["a", "c"]);
      expect(queue.getQueue().map((m) => m.content)).toEqual(["b"]);
    });

    it("should keep non-editable messages in queue", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", editable: false });
      queue.enqueue({ content: "b", editable: true });
      queue.enqueue({ content: "c", editable: false });

      queue.popAllEditable();

      expect(queue.getQueue().map((m) => m.content)).toEqual(["a", "c"]);
    });

    it("should return empty array if no editable messages", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", editable: false });

      expect(queue.popAllEditable()).toEqual([]);
      expect(queue.getQueue()).toHaveLength(1);
    });

    it("should return empty array for empty queue", () => {
      const queue = new MessageQueue();

      expect(queue.popAllEditable()).toEqual([]);
    });

    it("should preserve order of editable messages", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", editable: true });
      queue.enqueue({ content: "b", editable: true });
      queue.enqueue({ content: "c", editable: true });

      const result = queue.popAllEditable();

      expect(result.map((m) => m.content)).toEqual(["a", "b", "c"]);
    });
  });

  describe("removeById", () => {
    it("should remove a message by its id", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", id: "x1" });
      queue.enqueue({ content: "b", id: "x2" });

      const result = queue.removeById("x1");

      expect(result).toBe(true);
      expect(queue.getQueue()).toHaveLength(1);
      expect(queue.getQueue()[0].id).toBe("x2");
    });

    it("should return true if found and removed", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", id: "target" });

      expect(queue.removeById("target")).toBe(true);
    });

    it("should return false if not found", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", id: "x1" });

      expect(queue.removeById("nonexistent")).toBe(false);
      expect(queue.getQueue()).toHaveLength(1);
    });

    it("should call onMessageEnqueued callback after removal", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", id: "x1" });
      const callback = vi.fn();
      queue.onMessageEnqueued = callback;

      queue.removeById("x1");

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should not call onMessageEnqueued when id not found", () => {
      const queue = new MessageQueue();
      queue.enqueue({ content: "a", id: "x1" });
      const callback = vi.fn();
      queue.onMessageEnqueued = callback;

      queue.removeById("nonexistent");

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("state machine (transitionTo)", () => {
    it("should transition idle → dispatching", () => {
      const queue = new MessageQueue();
      expect(queue.state).toBe("idle");

      expect(queue.transitionTo("dispatching")).toBe(true);
      expect(queue.state).toBe("dispatching");
    });

    it("should reject idle → running", () => {
      const queue = new MessageQueue();

      expect(queue.transitionTo("running")).toBe(false);
      expect(queue.state).toBe("idle");
    });

    it("should reject idle → idle", () => {
      const queue = new MessageQueue();

      expect(queue.transitionTo("idle")).toBe(false);
      expect(queue.state).toBe("idle");
    });

    it("should transition dispatching → running", () => {
      const queue = new MessageQueue();
      queue.transitionTo("dispatching");

      expect(queue.transitionTo("running")).toBe(true);
      expect(queue.state).toBe("running");
    });

    it("should transition dispatching → idle", () => {
      const queue = new MessageQueue();
      queue.transitionTo("dispatching");

      expect(queue.transitionTo("idle")).toBe(true);
      expect(queue.state).toBe("idle");
    });

    it("should reject dispatching → dispatching", () => {
      const queue = new MessageQueue();
      queue.transitionTo("dispatching");

      expect(queue.transitionTo("dispatching")).toBe(false);
      expect(queue.state).toBe("dispatching");
    });

    it("should transition running → idle", () => {
      const queue = new MessageQueue();
      queue.transitionTo("dispatching");
      queue.transitionTo("running");

      expect(queue.transitionTo("idle")).toBe(true);
      expect(queue.state).toBe("idle");
    });

    it("should reject running → dispatching", () => {
      const queue = new MessageQueue();
      queue.transitionTo("dispatching");
      queue.transitionTo("running");

      expect(queue.transitionTo("dispatching")).toBe(false);
      expect(queue.state).toBe("running");
    });

    it("should reject running → running", () => {
      const queue = new MessageQueue();
      queue.transitionTo("dispatching");
      queue.transitionTo("running");

      expect(queue.transitionTo("running")).toBe(false);
      expect(queue.state).toBe("running");
    });

    it("should allow full lifecycle idle → dispatching → running → idle", () => {
      const queue = new MessageQueue();

      expect(queue.transitionTo("dispatching")).toBe(true);
      expect(queue.transitionTo("running")).toBe(true);
      expect(queue.transitionTo("idle")).toBe(true);
      expect(queue.state).toBe("idle");
    });
  });

  describe("clear resets state", () => {
    it("should set state back to idle after clear", () => {
      const queue = new MessageQueue();
      queue.transitionTo("dispatching");
      expect(queue.state).toBe("dispatching");

      queue.clear();

      expect(queue.state).toBe("idle");
    });

    it("should reset state from running", () => {
      const queue = new MessageQueue();
      queue.transitionTo("dispatching");
      queue.transitionTo("running");

      queue.clear();

      expect(queue.state).toBe("idle");
    });

    it("should remain idle when clearing from idle", () => {
      const queue = new MessageQueue();

      queue.clear();

      expect(queue.state).toBe("idle");
    });
  });
});
