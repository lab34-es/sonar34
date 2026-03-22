import { describe, it, expect } from "vitest";
import { getIO } from "../io.js";

// ---------------------------------------------------------------------------
// io.js — Socket.IO singleton
// We only test getIO here. initIO requires an HTTP server which would be
// heavy for a unit test and is implicitly covered by Socket.IO integration.
// ---------------------------------------------------------------------------

describe("io", () => {
  describe("getIO", () => {
    it("returns null when initIO has not been called", () => {
      // In the test environment, initIO is never called, so getIO should
      // return null (or whatever the initial value is).
      const io = getIO();
      expect(io).toBeNull();
    });

    it("is a function", () => {
      expect(typeof getIO).toBe("function");
    });
  });
});
