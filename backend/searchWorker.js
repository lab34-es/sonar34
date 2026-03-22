/**
 * searchWorker.js
 *
 * Background processor that consumes jobs from the "search-jobs" queue,
 * runs the actual git searches, and persists results into the search_jobs
 * table so the client can poll for them.
 */
import { Processor } from "@minnzen/sqliteq";
import db from "./db.js";
import { searchQueue } from "./queue.js";
import { runSearch, discoverRepos } from "./search.js";
import { getIO } from "./io.js";

// ---------------------------------------------------------------------------
// Prepared statements (created once, reused on every job)
// ---------------------------------------------------------------------------

const markRunning = db.prepare(`
  UPDATE search_jobs SET status = 'running', updated_at = datetime('now')
  WHERE id = ?
`);

const markDone = db.prepare(`
  UPDATE search_jobs SET status = 'done', result = ?, updated_at = datetime('now')
  WHERE id = ?
`);

const markFailed = db.prepare(`
  UPDATE search_jobs SET status = 'failed', error = ?, updated_at = datetime('now')
  WHERE id = ?
`);

const getSearchJob = db.prepare(`SELECT * FROM search_jobs WHERE id = ?`);

function emitSearchJobUpdate(jobId) {
  const io = getIO();
  if (io) {
    const row = getSearchJob.get(jobId);
    if (row) io.emit("search-job:update", row);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleSearchJob(msg) {
  const { jobId, command, pattern, repoFilters, allCommits } = msg.body;

  markRunning.run(jobId);
  emitSearchJobUpdate(jobId);

  try {
    const repos = await discoverRepos(repoFilters);
    const results = await runSearch(command, repos, pattern, allCommits);
    markDone.run(JSON.stringify(results), jobId);
    emitSearchJobUpdate(jobId);
  } catch (err) {
    markFailed.run(err.message, jobId);
    emitSearchJobUpdate(jobId);
    throw err; // rethrow so sqliteq can retry
  }
}

// ---------------------------------------------------------------------------
// Processor – starts polling immediately on import
// ---------------------------------------------------------------------------

export const searchProcessor = new Processor(searchQueue, {
  handler: handleSearchJob,
  pollInterval: 200,
  concurrency: 4, // process up to 4 search jobs in parallel
  onError(err, ctx) {
    console.error("[searchWorker] error:", err, ctx);
  },
});

export function startWorker() {
  searchProcessor.start();
  console.log("[searchWorker] started (concurrency=4, poll=200ms)");
}

export async function stopWorker() {
  await searchProcessor.stop();
  console.log("[searchWorker] stopped");
}
