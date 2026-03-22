/**
 * syncWorker.js
 *
 * Background processors for:
 *   - "sync-all"  : Discover all repos from Bitbucket API, create sync-one sub-jobs
 *   - "sync-one"  : Clone or pull a single repository
 */
import { Processor } from "@minnzen/sqliteq";
import { execFile } from "node:child_process";
import { readdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import db from "./db.js";
import { syncAllQueue, syncOneQueue } from "./queue.js";
import { getIO } from "./io.js";

import { getSetting } from "./settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PAGE_SIZE = 100;
const API_BASE = "https://api.bitbucket.org/2.0";

// Read config lazily via getSetting() so admin UI changes take effect
function getConfig() {
  return {
    reposDir: path.resolve(getSetting("REPOS_DIR")),
    email: getSetting("BITBUCKET_EMAIL"),
    apiToken: getSetting("BITBUCKET_API_TOKEN"),
    workspace: getSetting("BITBUCKET_WORKSPACE"),
    maxRepos: parseInt(getSetting("MAX_REPOS_TO_FETCH"), 10) || 5000,
  };
}

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const markRunning = db.prepare(`
  UPDATE sync_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?
`);

const markDone = db.prepare(`
  UPDATE sync_jobs SET status = 'done', updated_at = datetime('now') WHERE id = ?
`);

const markFailed = db.prepare(`
  UPDATE sync_jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?
`);

const updateProgress = db.prepare(`
  UPDATE sync_jobs SET progress = ?, updated_at = datetime('now') WHERE id = ?
`);

const insertSyncJob = db.prepare(`
  INSERT INTO sync_jobs (id, type, parent_id, repo_name, status)
  VALUES (?, ?, ?, ?, 'pending')
`);

const getChildJobs = db.prepare(`
  SELECT id, type, repo_name, status, error, created_at, updated_at
  FROM sync_jobs WHERE parent_id = ?
`);

const upsertRepo = db.prepare(`
  INSERT INTO repositories (name, path, default_branch, last_seen_at)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(name) DO UPDATE SET
    path = excluded.path,
    default_branch = excluded.default_branch,
    last_seen_at = datetime('now')
`);

// ---------------------------------------------------------------------------
// Emit helper
// ---------------------------------------------------------------------------

function emitJobUpdate(job) {
  const io = getIO();
  if (io) io.emit("sync-job:update", job);
}

function getJobRow(id) {
  return db.prepare(`SELECT * FROM sync_jobs WHERE id = ?`).get(id);
}

// ---------------------------------------------------------------------------
// Bitbucket API helpers
// ---------------------------------------------------------------------------

function buildAuthHeader(email, apiToken) {
  return "Basic " + Buffer.from(`${email}:${apiToken}`).toString("base64");
}

async function fetchBitbucketRepos() {
  const cfg = getConfig();

  console.log("[sync-all] fetching repos from Bitbucket workspace=%s maxRepos=%d", cfg.workspace, cfg.maxRepos);

  if (!cfg.email || !cfg.apiToken || !cfg.workspace) {
    throw new Error(
      "Missing Bitbucket credentials. Configure them in Admin > Settings."
    );
  }

  const authHeader = buildAuthHeader(cfg.email, cfg.apiToken);
  let url = `${API_BASE}/repositories/${cfg.workspace}?pagelen=${PAGE_SIZE}`;
  const repos = [];
  let page = 1;

  while (url && url !== "null") {
    console.log("[sync-all] fetching page %d (%d repos so far)", page, repos.length);

    const res = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Bitbucket API error: HTTP ${res.status} on page ${page}`);
    }

    const data = await res.json();
    const pageRepos = data.values || [];
    console.log("[sync-all] page %d returned %d repos", page, pageRepos.length);

    for (const repo of pageRepos) {
      const sshUrl = repo.links?.clone?.find((c) => c.name === "ssh")?.href;
      const httpsUrl = repo.links?.clone?.find((c) => c.name === "https")?.href;
      repos.push({
        full_name: repo.full_name,
        clone_url: sshUrl || httpsUrl || null,
        default_branch: repo.mainbranch?.name || null,
      });
    }

    if (repos.length >= cfg.maxRepos) {
      console.log("[sync-all] reached maxRepos limit (%d), stopping pagination", cfg.maxRepos);
      repos.length = cfg.maxRepos;
      break;
    }

    url = data.next || null;
    page++;
  }

  console.log("[sync-all] discovery complete: %d repos found across %d pages", repos.length, page);
  return repos;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function gitExec(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

async function dirExists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// sync-all handler
// ---------------------------------------------------------------------------

async function handleSyncAll(msg) {
  const { jobId } = msg.body;
  const t0 = Date.now();

  console.log("[sync-all] job %s started", jobId);

  markRunning.run(jobId);
  emitJobUpdate(getJobRow(jobId));

  try {
    // Phase 1: Discover repos from Bitbucket API
    console.log("[sync-all] job %s phase 1: discovering repos from Bitbucket API", jobId);
    const repos = await fetchBitbucketRepos();
    console.log("[sync-all] job %s phase 1 complete: %d repos discovered in %ds", jobId, repos.length, ((Date.now() - t0) / 1000).toFixed(1));

    updateProgress.run(
      JSON.stringify({ total: repos.length, queued: 0 }),
      jobId
    );
    emitJobUpdate(getJobRow(jobId));

    // Phase 2: Create sync-one sub-jobs (repos are upserted into DB by each sync-one job)
    console.log("[sync-all] job %s phase 2: creating sync-one sub-jobs", jobId);
    let skipped = 0;

    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      if (!repo.clone_url) {
        console.log("[sync-all] job %s skipping repo %s (no clone URL)", jobId, repo.full_name);
        skipped++;
        continue;
      }

      const subJobId = crypto.randomUUID();

      insertSyncJob.run(subJobId, "sync-one", jobId, repo.full_name);

      syncOneQueue.send({
        jobId: subJobId,
        parentId: jobId,
        fullName: repo.full_name,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch,
      });

      emitJobUpdate(getJobRow(subJobId));

      if ((i + 1) % 50 === 0) {
        console.log("[sync-all] job %s enqueued %d/%d sub-jobs", jobId, i + 1, repos.length);
        updateProgress.run(
          JSON.stringify({ total: repos.length, queued: i + 1 }),
          jobId
        );
        emitJobUpdate(getJobRow(jobId));
      }
    }

    updateProgress.run(
      JSON.stringify({ total: repos.length, queued: repos.length }),
      jobId
    );
    markDone.run(jobId);
    emitJobUpdate(getJobRow(jobId));

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log("[sync-all] job %s completed: %d sub-jobs enqueued, %d skipped, took %ss", jobId, repos.length - skipped, skipped, elapsed);
  } catch (err) {
    console.error("[sync-all] job %s failed: %s", jobId, err.message);
    markFailed.run(err.message, jobId);
    emitJobUpdate(getJobRow(jobId));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// sync-one handler
// ---------------------------------------------------------------------------

async function handleSyncOne(msg) {
  const { jobId, parentId, fullName, cloneUrl, defaultBranch } = msg.body;
  const t0 = Date.now();

  console.log("[sync-one] job %s started repo=%s parent=%s", jobId, fullName, parentId);

  markRunning.run(jobId);
  emitJobUpdate(getJobRow(jobId));

  try {
    const cfg = getConfig();
    const targetDir = path.join(cfg.reposDir, fullName);
    const gitDir = path.join(targetDir, ".git");

    if (await dirExists(gitDir)) {
      // Already cloned -- pull latest
      console.log("[sync-one] job %s repo=%s exists, fetching updates", jobId, fullName);
      try {
        await gitExec(["fetch", "--all"], targetDir);
        updateProgress.run(JSON.stringify({ action: "fetched" }), jobId);
        console.log("[sync-one] job %s repo=%s fetched in %dms", jobId, fullName, Date.now() - t0);
      } catch (fetchErr) {
        // Fetch might fail on partial clones; that's ok
        console.log("[sync-one] job %s repo=%s fetch failed (skipped): %s", jobId, fullName, fetchErr.message);
        updateProgress.run(JSON.stringify({ action: "skipped" }), jobId);
      }
    } else {
      // Clone with partial clone (same as clone-all.sh)
      console.log("[sync-one] job %s repo=%s cloning (partial, no-checkout)", jobId, fullName);
      const { mkdirSync } = await import("node:fs");
      mkdirSync(path.dirname(targetDir), { recursive: true });

      await gitExec(
        ["clone", "--filter=blob:none", "--no-checkout", cloneUrl, targetDir],
        path.dirname(targetDir)
      );
      updateProgress.run(JSON.stringify({ action: "cloned" }), jobId);
      console.log("[sync-one] job %s repo=%s cloned in %dms", jobId, fullName, Date.now() - t0);
    }

    // Upsert the repository into the database after successful clone/fetch
    upsertRepo.run(fullName, targetDir, defaultBranch || null);
    console.log("[sync-one] job %s repo=%s upserted into DB", jobId, fullName);

    markDone.run(jobId);
    emitJobUpdate(getJobRow(jobId));
    console.log("[sync-one] job %s repo=%s done (%dms)", jobId, fullName, Date.now() - t0);
  } catch (err) {
    console.error("[sync-one] job %s repo=%s failed: %s", jobId, fullName, err.message);
    markFailed.run(err.message, jobId);
    emitJobUpdate(getJobRow(jobId));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Processors
// ---------------------------------------------------------------------------

export const syncAllProcessor = new Processor(syncAllQueue, {
  handler: handleSyncAll,
  pollInterval: 500,
  concurrency: 1, // only one sync-all at a time
  onError(err, ctx) {
    console.error("[syncWorker:sync-all] error:", err, ctx);
  },
});

export const syncOneProcessor = new Processor(syncOneQueue, {
  handler: handleSyncOne,
  pollInterval: 200,
  concurrency: 10, // clone up to 10 repos in parallel
  onError(err, ctx) {
    console.error("[syncWorker:sync-one] error:", err, ctx);
  },
});

export function startSyncWorkers() {
  syncAllProcessor.start();
  syncOneProcessor.start();
  console.log("[syncWorker] started (sync-all concurrency=1, sync-one concurrency=10)");
}

export async function stopSyncWorkers() {
  await syncAllProcessor.stop();
  await syncOneProcessor.stop();
  console.log("[syncWorker] stopped");
}
