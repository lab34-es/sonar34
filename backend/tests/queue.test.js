import { describe, it, expect, beforeEach } from "vitest";
import { getQueue, listQueueNames, searchQueue, syncAllQueue, syncOneQueue } from "../queue.js";

describe("queue", () => {
  beforeEach(() => {
    // Purge all known queues
    for (const name of listQueueNames()) {
      getQueue(name).purge();
    }
  });

  describe("listQueueNames", () => {
    it("returns all predefined queue names", () => {
      const names = listQueueNames();
      expect(names).toContain("search-jobs");
      expect(names).toContain("sync-all");
      expect(names).toContain("sync-one");
      expect(names).toContain("enrich-activity");
      expect(names).toContain("enrich-technologies");
      expect(names).toContain("enrich-prs");
      expect(names).toContain("enrich-security");
      expect(names).toContain("enrich-dependencies");
    });

    it("returns 8 queues", () => {
      expect(listQueueNames()).toHaveLength(8);
    });
  });

  describe("getQueue", () => {
    it("returns existing queues by name", () => {
      const q = getQueue("search-jobs");
      expect(q).toBeTruthy();
      expect(q).toBe(searchQueue);
    });

    it("creates new queues for unknown names", () => {
      const q = getQueue("test-queue-new");
      expect(q).toBeTruthy();
      // Should now appear in the list
      expect(listQueueNames()).toContain("test-queue-new");
    });
  });

  describe("queue operations", () => {
    it("can send and check size", () => {
      const q = getQueue("search-jobs");
      expect(q.size()).toBe(0);

      q.send({ test: "message1" });
      q.send({ test: "message2" });
      expect(q.size()).toBe(2);
    });

    it("can send and receive a message", () => {
      const q = getQueue("search-jobs");
      q.send({ hello: "world" });

      const msg = q.receive();
      expect(msg).toBeTruthy();
      expect(msg.body).toEqual({ hello: "world" });
    });

    it("returns null when receiving from empty queue", () => {
      const q = getQueue("search-jobs");
      const msg = q.receive();
      expect(msg).toBeNull();
    });

    it("can purge a queue", () => {
      const q = getQueue("search-jobs");
      q.send({ a: 1 });
      q.send({ b: 2 });
      q.send({ c: 3 });
      expect(q.size()).toBe(3);

      const removed = q.purge();
      expect(removed).toBe(3);
      expect(q.size()).toBe(0);
    });

    it("can acknowledge (delete) a message", () => {
      const q = getQueue("search-jobs");
      q.send({ test: true });

      const msg = q.receive();
      expect(msg).toBeTruthy();

      const deleted = q.delete(msg.id, msg.received);
      expect(deleted).toBe(true);
    });
  });

  describe("queue edge cases", () => {
    it("handles queues with special characters in names", () => {
      const q = getQueue("test-special_chars.v2");
      expect(q).toBeTruthy();
      expect(listQueueNames()).toContain("test-special_chars.v2");
      q.send({ data: "test" });
      expect(q.size()).toBe(1);
      q.purge();
    });

    it("returns the same queue instance for the same name", () => {
      const q1 = getQueue("search-jobs");
      const q2 = getQueue("search-jobs");
      expect(q1).toBe(q2);
    });

    it("purge returns 0 on empty queue", () => {
      const q = getQueue("search-jobs");
      const removed = q.purge();
      expect(removed).toBe(0);
    });

    it("can send and receive multiple messages in FIFO order", () => {
      const q = getQueue("search-jobs");
      q.send({ order: 1 });
      q.send({ order: 2 });
      q.send({ order: 3 });

      const msg1 = q.receive();
      const msg2 = q.receive();
      const msg3 = q.receive();

      expect(msg1.body).toEqual({ order: 1 });
      expect(msg2.body).toEqual({ order: 2 });
      expect(msg3.body).toEqual({ order: 3 });

      // Clean up (delete/ack all messages)
      q.delete(msg1.id, msg1.received);
      q.delete(msg2.id, msg2.received);
      q.delete(msg3.id, msg3.received);
    });

    it("can send with various body types", () => {
      const q = getQueue("search-jobs");

      // String body
      q.send("simple-string");
      const msg1 = q.receive();
      expect(msg1.body).toBe("simple-string");
      q.delete(msg1.id, msg1.received);

      // Number body
      q.send(42);
      const msg2 = q.receive();
      expect(msg2.body).toBe(42);
      q.delete(msg2.id, msg2.received);

      // Nested object
      q.send({ nested: { deep: { value: true } } });
      const msg3 = q.receive();
      expect(msg3.body).toEqual({ nested: { deep: { value: true } } });
      q.delete(msg3.id, msg3.received);
    });

    it("size reflects current queue state correctly", () => {
      const q = getQueue("search-jobs");
      expect(q.size()).toBe(0);

      q.send({ a: 1 });
      expect(q.size()).toBe(1);

      q.send({ b: 2 });
      expect(q.size()).toBe(2);

      q.purge();
      expect(q.size()).toBe(0);
    });

    it("dead letters returns an array", () => {
      const q = getQueue("search-jobs");
      const dl = q.deadLetters();
      expect(Array.isArray(dl)).toBe(true);
    });
  });

  describe("named queue exports", () => {
    it("searchQueue is the search-jobs queue", () => {
      expect(searchQueue).toBe(getQueue("search-jobs"));
    });

    it("syncAllQueue is the sync-all queue", () => {
      expect(syncAllQueue).toBe(getQueue("sync-all"));
    });

    it("syncOneQueue is the sync-one queue", () => {
      expect(syncOneQueue).toBe(getQueue("sync-one"));
    });
  });
});
