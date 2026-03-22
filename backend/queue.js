import { Queue, Processor } from "@minnzen/sqliteq";
import db from "./db.js";

// ---------------------------------------------------------------------------
// Named queues
// ---------------------------------------------------------------------------

/** Queue for search jobs submitted by the API. */
export const searchQueue = new Queue(db, "search-jobs", {
  timeout: 120_000, // 2 min visibility – searches can be slow
  maxReceive: 3,    // dead-letter after 3 failed attempts
});

/** Queue for sync-all jobs (discover repos, then fan out). */
export const syncAllQueue = new Queue(db, "sync-all", {
  timeout: 600_000, // 10 min – discovery can be slow
  maxReceive: 3,
});

/** Queue for sync-one jobs (clone/pull a single repository). */
export const syncOneQueue = new Queue(db, "sync-one", {
  timeout: 300_000, // 5 min per repo
  maxReceive: 3,
});

/** Queue for enriching repos with commit-activity sparkline data. */
export const enrichActivityQueue = new Queue(db, "enrich-activity", {
  timeout: 60_000,  // 1 min per repo
  maxReceive: 3,
});

/** Queue for enriching repos with detected technologies. */
export const enrichTechnologiesQueue = new Queue(db, "enrich-technologies", {
  timeout: 60_000,
  maxReceive: 3,
});

/** Queue for enriching repos with open PR counts. */
export const enrichPrsQueue = new Queue(db, "enrich-prs", {
  timeout: 120_000, // 2 min – API calls can be slow
  maxReceive: 3,
});

/** Queue for enriching repos with npm audit security findings. */
export const enrichSecurityQueue = new Queue(db, "enrich-security", {
  timeout: 180_000, // 3 min – npm install + audit can be slow
  maxReceive: 3,
});

/** Queue for enriching repos with package.json dependencies. */
export const enrichDependenciesQueue = new Queue(db, "enrich-dependencies", {
  timeout: 60_000, // 1 min per repo
  maxReceive: 3,
});

// ---------------------------------------------------------------------------
// Helpers – generic queue management exposed via REST
// ---------------------------------------------------------------------------

/**
 * Return a map of every registered queue keyed by name so the API layer can
 * operate on arbitrary queues by name.
 */
const queues = new Map([
  ["search-jobs", searchQueue],
  ["sync-all", syncAllQueue],
  ["sync-one", syncOneQueue],
  ["enrich-activity", enrichActivityQueue],
  ["enrich-technologies", enrichTechnologiesQueue],
  ["enrich-prs", enrichPrsQueue],
  ["enrich-security", enrichSecurityQueue],
  ["enrich-dependencies", enrichDependenciesQueue],
]);

/**
 * Get or create a queue by name (lazily created on first access).
 * This allows callers to create ad-hoc queues via the REST API.
 */
export function getQueue(name) {
  if (queues.has(name)) return queues.get(name);
  const q = new Queue(db, name, { timeout: 30_000, maxReceive: 3 });
  queues.set(name, q);
  return q;
}

export function listQueueNames() {
  return [...queues.keys()];
}
