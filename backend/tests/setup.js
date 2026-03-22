/**
 * Vitest setup file.
 * Sets DB_PATH to a temporary file so tests don't touch the real database.
 * This runs before any test file is imported, ensuring all modules that
 * import db.js get the test database.
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Create a unique temp DB path for this test run
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "massrepo-test-"));
const testDbPath = path.join(tmpDir, "test.db");

// Set before any module imports db.js
process.env.DB_PATH = testDbPath;

// Suppress console.log noise from module initialization
const origLog = console.log;
console.log = (...args) => {
  const msg = args[0];
  if (typeof msg === "string" && (
    msg.includes("SQLite database opened") ||
    msg.includes("[searchWorker]") ||
    msg.includes("[syncWorker]") ||
    msg.includes("[enrichWorker]")
  )) return;
  origLog(...args);
};

// Clean up temp DB after all tests
import { afterAll } from "vitest";

afterAll(() => {
  console.log = origLog;
  try {
    // Remove the temp directory and all files in it
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});
