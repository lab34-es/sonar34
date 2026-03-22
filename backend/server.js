import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import fs from "node:fs";

import db from "./db.js";
import { searchQueue, getQueue, listQueueNames, enrichActivityQueue, enrichTechnologiesQueue, enrichPrsQueue, enrichSecurityQueue, enrichDependenciesQueue } from "./queue.js";
import { startWorker, stopWorker } from "./searchWorker.js";
import { startSyncWorkers, stopSyncWorkers } from "./syncWorker.js";
import { startEnrichWorkers, stopEnrichWorkers } from "./enrichWorker.js";
import { runSearch, runSearchStreaming, discoverRepos, VALID_COMMANDS } from "./search.js";
import { initIO } from "./io.js";
import { getAllSettings, updateSettings, getSetting } from "./settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;

// Initialize Socket.IO
const io = initIO(httpServer);

// ---------------------------------------------------------------------------
// Socket.IO: Streaming search
// ---------------------------------------------------------------------------
io.on("connection", (socket) => {
  socket.on("search:start", async (params) => {
    const { command, pattern, repo, allCommits, dateFrom, dateTo } = params || {};

    if (!command || !VALID_COMMANDS.has(command)) {
      return socket.emit("search:error", {
        error: `Invalid or missing "command". Must be one of: ${[...VALID_COMMANDS].join(", ")}`,
      });
    }
    if (!pattern) {
      return socket.emit("search:error", { error: 'Missing required "pattern" parameter.' });
    }

    try {
      const repoFilters = repo
        ? repo.split(",").map((r) => r.trim()).filter(Boolean)
        : [];

      const repos = await discoverRepos(repoFilters);
      const total = repos.length;

      socket.emit("search:started", { total });

      await runSearchStreaming(command, repos, pattern, !!allCommits, { dateFrom, dateTo }, {
        onProgress(searched, total, repoName) {
          socket.emit("search:progress", { searched, total, repoName });
        },
        onResults(results) {
          socket.emit("search:results", results);
        },
      });

      // Save to recent searches (statements defined further below, hoisted by module init)
      try {
        db.prepare(`INSERT INTO recent_searches (term, search_pattern, repos_filter) VALUES (?, ?, ?)`).run(command, pattern, repo || null);
        db.prepare(`DELETE FROM recent_searches WHERE id NOT IN (SELECT id FROM recent_searches ORDER BY created_at DESC LIMIT 50)`).run();
      } catch (e) {
        console.error("Failed to save recent search:", e);
      }

      socket.emit("search:done");
    } catch (err) {
      console.error("Streaming search error:", err);
      socket.emit("search:error", { error: err.message });
    }
  });
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const insertJob = db.prepare(`
  INSERT INTO search_jobs (id, command, pattern, repo_filter, all_commits, status)
  VALUES (?, ?, ?, ?, ?, 'pending')
`);

const getJob = db.prepare(`SELECT * FROM search_jobs WHERE id = ?`);

const listJobs = db.prepare(`
  SELECT id, command, pattern, repo_filter, all_commits, status, error, created_at, updated_at
  FROM search_jobs ORDER BY created_at DESC LIMIT ?
`);

// ---------------------------------------------------------------------------
// Synchronous search (original behaviour, kept for backwards-compat)
// ---------------------------------------------------------------------------

app.get("/api/search", async (req, res) => {
  try {
    const { command, pattern, repo, allCommits } = req.query;

    if (!command || !VALID_COMMANDS.has(command)) {
      return res.status(400).json({
        error: `Invalid or missing "command". Must be one of: ${[...VALID_COMMANDS].join(", ")}`,
      });
    }
    if (!pattern) {
      return res.status(400).json({ error: 'Missing required "pattern" parameter.' });
    }

    const repoFilters = repo
      ? repo.split(",").map((r) => r.trim()).filter(Boolean)
      : [];

    const repos = await discoverRepos(repoFilters);
    const results = await runSearch(command, repos, pattern, allCommits === "true");

    res.json(results);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Async search via queue
// ---------------------------------------------------------------------------

/** POST /api/search/jobs — enqueue a search job, returns immediately. */
app.post("/api/search/jobs", (req, res) => {
  try {
    const { command, pattern, repo, allCommits } = req.body;

    if (!command || !VALID_COMMANDS.has(command)) {
      return res.status(400).json({
        error: `Invalid or missing "command". Must be one of: ${[...VALID_COMMANDS].join(", ")}`,
      });
    }
    if (!pattern) {
      return res.status(400).json({ error: 'Missing required "pattern" field.' });
    }

    const repoFilters = repo
      ? repo.split(",").map((r) => r.trim()).filter(Boolean)
      : [];

    const jobId = crypto.randomUUID();

    // Persist the job row
    insertJob.run(jobId, command, pattern, repo || null, allCommits ? 1 : 0);

    // Enqueue into sqliteq so the worker picks it up
    searchQueue.send({
      jobId,
      command,
      pattern,
      repoFilters,
      allCommits: !!allCommits,
    });

    res.status(202).json({ jobId, status: "pending" });
  } catch (err) {
    console.error("Enqueue error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/** GET /api/search/jobs/:id — poll for a job's result. */
app.get("/api/search/jobs/:id", (req, res) => {
  const row = getJob.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Job not found" });

  const out = {
    id: row.id,
    command: row.command,
    pattern: row.pattern,
    repoFilter: row.repo_filter,
    allCommits: !!row.all_commits,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.status === "done") out.result = JSON.parse(row.result);
  if (row.status === "failed") out.error = row.error;

  res.json(out);
});

/** GET /api/search/jobs — list recent jobs. */
app.get("/api/search/jobs", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  res.json(listJobs.all(limit));
});

// ---------------------------------------------------------------------------
// Generic queue endpoints
// ---------------------------------------------------------------------------

/** GET /api/queues — list registered queue names */
app.get("/api/queues", (_req, res) => {
  res.json(listQueueNames());
});

/** POST /api/queues/:name/send — send a message to any queue */
app.post("/api/queues/:name/send", (req, res) => {
  try {
    const q = getQueue(req.params.name);
    const { body, delay, priority } = req.body;
    if (body === undefined) {
      return res.status(400).json({ error: "Missing required 'body' field." });
    }
    const id = q.send(body, { delay, priority });
    res.status(202).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/queues/:name/send-batch — send multiple messages at once */
app.post("/api/queues/:name/send-batch", (req, res) => {
  try {
    const q = getQueue(req.params.name);
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "'messages' must be an array of { body, delay?, priority? }." });
    }
    const ids = q.sendBatch(
      messages.map((m) => ({ body: m.body, options: { delay: m.delay, priority: m.priority } }))
    );
    res.status(202).json({ ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/queues/:name/receive — claim the next message */
app.post("/api/queues/:name/receive", (req, res) => {
  const q = getQueue(req.params.name);
  const msg = q.receive();
  if (!msg) return res.status(204).end();
  res.json(msg);
});

/** DELETE /api/queues/:name/:msgId — acknowledge (delete) a message */
app.delete("/api/queues/:name/:msgId", (req, res) => {
  const q = getQueue(req.params.name);
  const received = parseInt(req.query.received, 10);
  if (Number.isNaN(received)) {
    return res.status(400).json({ error: "'received' query param is required (integer)." });
  }
  const ok = q.delete(req.params.msgId, received);
  res.json({ deleted: ok });
});

/** GET /api/queues/:name/size — total messages in the queue */
app.get("/api/queues/:name/size", (req, res) => {
  const q = getQueue(req.params.name);
  res.json({ size: q.size() });
});

/** GET /api/queues/:name/dead-letters — inspect dead-lettered messages */
app.get("/api/queues/:name/dead-letters", (req, res) => {
  const q = getQueue(req.params.name);
  res.json(q.deadLetters());
});

/** POST /api/queues/:name/purge — delete all messages */
app.post("/api/queues/:name/purge", (req, res) => {
  const q = getQueue(req.params.name);
  const removed = q.purge();
  res.json({ removed });
});

// ---------------------------------------------------------------------------
// Admin: Sync jobs
// ---------------------------------------------------------------------------

const insertSyncJob = db.prepare(`
  INSERT INTO sync_jobs (id, type, parent_id, repo_name, status)
  VALUES (?, ?, ?, ?, 'pending')
`);

const listSyncJobs = db.prepare(`
  SELECT id, type, parent_id, repo_name, status, progress, error, created_at, updated_at
  FROM sync_jobs ORDER BY created_at DESC LIMIT ?
`);

const getSyncJob = db.prepare(`SELECT * FROM sync_jobs WHERE id = ?`);

const listChildSyncJobs = db.prepare(`
  SELECT id, type, parent_id, repo_name, status, progress, error, created_at, updated_at
  FROM sync_jobs WHERE parent_id = ? ORDER BY created_at ASC
`);

const countChildStatuses = db.prepare(`
  SELECT status, COUNT(*) as count FROM sync_jobs WHERE parent_id = ? GROUP BY status
`);

/** POST /api/admin/sync-all — trigger a full sync of all repos */
app.post("/api/admin/sync-all", (req, res) => {
  try {
    const jobId = crypto.randomUUID();
    insertSyncJob.run(jobId, "sync-all", null, null);

    const syncAllQ = getQueue("sync-all");
    syncAllQ.send({ jobId });

    const row = getSyncJob.get(jobId);
    io.emit("sync-job:update", row);

    res.status(202).json({ jobId, status: "pending" });
  } catch (err) {
    console.error("Sync-all enqueue error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/** GET /api/admin/jobs — list sync jobs (parent + children) */
app.get("/api/admin/jobs", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const parentOnly = req.query.parentOnly === "true";

  if (parentOnly) {
    const rows = db.prepare(`
      SELECT id, type, parent_id, repo_name, status, progress, error, created_at, updated_at
      FROM sync_jobs WHERE type = 'sync-all' ORDER BY created_at DESC LIMIT ?
    `).all(limit);

    // Attach child status counts
    const result = rows.map((row) => {
      const statuses = countChildStatuses.all(row.id);
      const children = {};
      for (const s of statuses) children[s.status] = s.count;
      return { ...row, children };
    });

    return res.json(result);
  }

  res.json(listSyncJobs.all(limit));
});

/** GET /api/admin/jobs/:id — get a single sync job with children */
app.get("/api/admin/jobs/:id", (req, res) => {
  const row = getSyncJob.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Job not found" });

  const children = listChildSyncJobs.all(row.id);
  res.json({ ...row, children });
});

/** GET /api/admin/all-jobs — unified paginated jobs across all queues */
app.get("/api/admin/all-jobs", (req, res) => {
  const queue = req.query.queue || "sync_jobs";
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

  const ALLOWED_TABLES = ["sync_jobs", "search_jobs", "enrichment_jobs"];
  if (!ALLOWED_TABLES.includes(queue)) {
    return res.status(400).json({
      error: `Invalid "queue". Must be one of: ${ALLOWED_TABLES.join(", ")}`,
    });
  }

  try {
    const total = db.prepare(`SELECT COUNT(*) as count FROM ${queue}`).get().count;
    const rows = db.prepare(`
      SELECT * FROM ${queue} ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.json({ rows, total, offset, limit });
  } catch (err) {
    console.error("all-jobs query error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/** GET /api/admin/settings — get all configurable settings */
app.get("/api/admin/settings", (_req, res) => {
  res.json(getAllSettings());
});

/** PUT /api/admin/settings — update settings */
app.put("/api/admin/settings", (req, res) => {
  try {
    const settings = req.body;
    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ error: "Body must be an object of { key: value } pairs." });
    }
    updateSettings(settings);
    res.json(getAllSettings());
  } catch (err) {
    console.error("Settings update error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Admin: Repositories
// ---------------------------------------------------------------------------

const listRepos = db.prepare(`
  SELECT
    r.name, r.path, r.last_seen_at, r.activity, r.technologies, r.open_prs, r.default_branch,
    r.security_scanned_branch, r.dependencies_scanned_branch,
    (SELECT json_group_object(severity, cnt) FROM (
      SELECT severity, COUNT(*) as cnt FROM security WHERE repo_name = r.name GROUP BY severity
    )) AS security,
    (SELECT COUNT(*) FROM dependencies WHERE name = r.name) AS dependencies_count
  FROM repositories r ORDER BY r.name ASC
`);

/** GET /api/admin/repos — return repos from DB (populated by sync-all job) */
app.get("/api/admin/repos", (req, res) => {
  try {
    res.json(listRepos.all());
  } catch (err) {
    console.error("Repo listing error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Admin: Single repository detail + sub-resources
// ---------------------------------------------------------------------------

const getRepo = db.prepare(`
  SELECT
    r.name, r.path, r.last_seen_at, r.activity, r.technologies, r.open_prs, r.default_branch,
    r.security_scanned_branch, r.dependencies_scanned_branch,
    (SELECT json_group_object(severity, cnt) FROM (
      SELECT severity, COUNT(*) as cnt FROM security WHERE repo_name = r.name GROUP BY severity
    )) AS security,
    (SELECT COUNT(*) FROM dependencies WHERE name = r.name) AS dependencies_count
  FROM repositories r WHERE r.name = ?
`);

const getRepoSecurityRows = db.prepare(`
  SELECT id, dependency, version, issue, severity, url, created_at
  FROM security WHERE repo_name = ? ORDER BY
    CASE severity
      WHEN 'critical' THEN 0
      WHEN 'high' THEN 1
      WHEN 'moderate' THEN 2
      WHEN 'low' THEN 3
      WHEN 'info' THEN 4
      ELSE 5
    END, dependency ASC
`);

function gitExecServer(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      }
    );
  });
}

// Helper: build "workspace/slug" from route params
function repoFullName(req) {
  return `${req.params.workspace}/${req.params.slug}`;
}

// GET /api/admin/repos/:workspace/:slug — single repository detail
app.get("/api/admin/repos/:workspace/:slug", (req, res) => {
  try {
    const row = getRepo.get(repoFullName(req));
    if (!row) return res.status(404).json({ error: "Repository not found" });
    res.json(row);
  } catch (err) {
    console.error("Repo detail error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// GET /api/admin/repos/:workspace/:slug/security — security findings for a repo
app.get("/api/admin/repos/:workspace/:slug/security", (req, res) => {
  try {
    res.json(getRepoSecurityRows.all(repoFullName(req)));
  } catch (err) {
    console.error("Repo security error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// GET /api/admin/repos/:workspace/:slug/dependencies — dependencies for a repo
const getRepoDependencyRows = db.prepare(`
  SELECT id, dependency, version, created_at
  FROM dependencies WHERE name = ? ORDER BY dependency ASC
`);

app.get("/api/admin/repos/:workspace/:slug/dependencies", (req, res) => {
  try {
    res.json(getRepoDependencyRows.all(repoFullName(req)));
  } catch (err) {
    console.error("Repo dependencies error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// GET /api/admin/repos/:workspace/:slug/branches — branches from local git clone
app.get("/api/admin/repos/:workspace/:slug/branches", async (req, res) => {
  try {
    const row = getRepo.get(repoFullName(req));
    if (!row) return res.status(404).json({ error: "Repository not found" });

    const repoPath = row.path;
    const stdout = await gitExecServer(
      ["branch", "-a", "--format=%(refname:short)\t%(committerdate:iso-strict)\t%(authorname)"],
      repoPath
    );

    const branches = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, date, author] = line.split("\t");
        return { name, lastCommitDate: date || null, author: author || null };
      });

    res.json(branches);
  } catch (err) {
    console.error("Repo branches error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// GET /api/admin/repos/:workspace/:slug/commits — commit log from local git clone
app.get("/api/admin/repos/:workspace/:slug/commits", async (req, res) => {
  try {
    const row = getRepo.get(repoFullName(req));
    if (!row) return res.status(404).json({ error: "Repository not found" });

    const repoPath = row.path;
    const { since, until, branch, author, limit: qLimit } = req.query;
    const maxCommits = Math.min(parseInt(qLimit, 10) || 500, 3000);

    // Unit separator (ASCII 0x1F) — safe delimiter unlikely to appear in messages
    const SEP = "\x1f";

    // --shortstat emits a single summary line after each commit header with
    // insertions/deletions totals. Much faster than --numstat which computes
    // per-file diffs.
    const args = [
      "log", "--all", `--max-count=${maxCommits}`,
      `--format=COMMIT${SEP}%H${SEP}%an${SEP}%ad${SEP}%s${SEP}%D`,
      "--date=iso-strict",
      "--shortstat",
    ];

    if (since) args.push(`--since=${since}`);
    if (until) args.push(`--until=${until}`);
    if (author) args.push(`--author=${author}`);

    if (branch) {
      const allIdx = args.indexOf("--all");
      if (allIdx !== -1) args.splice(allIdx, 1);
      args.push(branch);
    }

    let stdout = "";
    try {
      stdout = await gitExecServer(args, repoPath);
    } catch {
      stdout = "";
    }

    // Build Bitbucket commit URL: https://bitbucket.org/<workspace>/<slug>/commits/<sha>
    const { workspace, slug } = req.params;
    const bbBase = `https://bitbucket.org/${workspace}/${slug}/commits`;

    const commits = [];
    let current = null;
    // Matches shortstat lines like " 3 files changed, 45 insertions(+), 12 deletions(-)"
    const shortstatRe = /(\d+)\s+insertion|(\d+)\s+deletion/g;
    for (const line of stdout.split("\n")) {
      if (line.startsWith(`COMMIT${SEP}`)) {
        if (current) commits.push(current);
        const parts = line.split(SEP);
        const sha = parts[1] || "";
        current = {
          sha,
          author: parts[2] || "",
          date: parts[3] || "",
          message: parts[4] || "",
          refs: parts[5] || "",
          additions: 0,
          deletions: 0,
          url: sha ? `${bbBase}/${sha}` : null,
        };
      } else if (current && line.trim()) {
        // shortstat: " 3 files changed, 45 insertions(+), 12 deletions(-)"
        let m;
        shortstatRe.lastIndex = 0;
        while ((m = shortstatRe.exec(line)) !== null) {
          if (m[1] != null) current.additions = parseInt(m[1], 10);
          if (m[2] != null) current.deletions = parseInt(m[2], 10);
        }
      }
    }
    if (current) commits.push(current);

    res.json(commits);
  } catch (err) {
    console.error("Repo commits error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Admin: Commit diff (via Bitbucket API)
// ---------------------------------------------------------------------------

// GET /api/admin/repos/:workspace/:slug/commits/:sha/diff
// Fetches commit metadata + raw unified diff from Bitbucket, then parses it
// into per-file chunks so the frontend can render them in Monaco DiffEditor.
app.get("/api/admin/repos/:workspace/:slug/commits/:sha/diff", async (req, res) => {
  try {
    const bb = buildBitbucketAuth();
    if (!bb) return res.status(500).json({ error: "Bitbucket credentials not configured." });

    const row = getRepo.get(repoFullName(req));
    if (!row) return res.status(404).json({ error: "Repository not found" });

    const { workspace, slug, sha } = req.params;
    // Basic validation – only hex chars allowed
    if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) {
      return res.status(400).json({ error: "Invalid commit SHA" });
    }

    // 1) Fetch commit metadata from Bitbucket
    //    GET /2.0/repositories/{workspace}/{repo_slug}/commit/{commit}
    let meta = {};
    try {
      const commitUrl = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/commit/${sha}`;
      const commitRes = await fetch(commitUrl, {
        headers: { Authorization: bb.auth, Accept: "application/json" },
      });
      if (commitRes.ok) {
        const data = await commitRes.json();
        const rawAuthor = data.author?.raw || "";
        // Parse "Name <email>" format
        const authorMatch = rawAuthor.match(/^(.+?)\s*<(.+?)>$/);
        meta = {
          sha: data.hash || sha,
          authorName: authorMatch ? authorMatch[1].trim() : data.author?.user?.display_name || rawAuthor,
          authorEmail: authorMatch ? authorMatch[2].trim() : "",
          date: data.date || "",
          subject: data.message?.split("\n")[0] || "",
          body: data.message?.split("\n").slice(1).join("\n").trim() || "",
        };
      }
    } catch {
      // ignore metadata errors — we can still show the diff
    }

    // 2) Fetch diffstat from Bitbucket (paginated JSON with per-file stats)
    //    GET /2.0/repositories/{workspace}/{repo_slug}/diffstat/{spec}
    //    When spec is a single commit, Bitbucket diffs against the first parent.
    const diffstatMap = new Map(); // newPath -> { status, linesAdded, linesRemoved }
    try {
      let dsUrl = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/diffstat/${sha}?pagelen=500`;
      while (dsUrl) {
        const dsRes = await fetch(dsUrl, {
          headers: { Authorization: bb.auth, Accept: "application/json" },
        });
        if (!dsRes.ok) break;
        const dsData = await dsRes.json();
        for (const v of dsData.values || []) {
          const newPath = v.new?.path || v.old?.path || "";
          diffstatMap.set(newPath, {
            status: v.status || "modified",
            linesAdded: v.lines_added || 0,
            linesRemoved: v.lines_removed || 0,
            oldPath: v.old?.path || "",
            newPath: v.new?.path || "",
          });
        }
        dsUrl = dsData.next || null;
      }
    } catch {
      // diffstat is optional — the raw diff will still work
    }

    // 3) Fetch the raw unified diff from Bitbucket
    //    GET /2.0/repositories/{workspace}/{repo_slug}/diff/{spec}
    const diffUrl = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/diff/${sha}?context=3`;
    const diffRes = await fetch(diffUrl, {
      headers: { Authorization: bb.auth },
    });

    if (!diffRes.ok) {
      const status = diffRes.status;
      if (status === 404) return res.status(404).json({ error: "Commit not found on Bitbucket" });
      return res.status(status).json({ error: `Bitbucket diff API error: HTTP ${status}` });
    }

    const diffOut = await diffRes.text();

    // 4) Parse the raw diff into per-file chunks (same parser as before)
    const files = [];
    let currentFile = null;
    let inHeader = true;

    for (const line of diffOut.split("\n")) {
      if (line.startsWith("diff --git ")) {
        if (currentFile) files.push(currentFile);
        // Extract file paths from "diff --git a/<path> b/<path>"
        const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        const oldPath = match ? match[1] : "";
        const newPath = match ? match[2] : "";
        // Try to get status from diffstat, fall back to detecting from diff headers
        const stat = diffstatMap.get(newPath) || diffstatMap.get(oldPath);
        currentFile = {
          oldPath,
          newPath,
          status: stat?.status || "modified",
          hunks: [],
          raw: line + "\n",
        };
        inHeader = true;
      } else if (currentFile) {
        currentFile.raw += line + "\n";
        if (inHeader) {
          if (line.startsWith("new file mode")) currentFile.status = "added";
          else if (line.startsWith("deleted file mode")) currentFile.status = "deleted";
          else if (line.startsWith("rename ")) currentFile.status = "renamed";
          else if (line.startsWith("@@")) {
            inHeader = false;
            currentFile.hunks.push({ header: line, lines: [] });
          }
        } else {
          if (line.startsWith("@@")) {
            currentFile.hunks.push({ header: line, lines: [] });
          } else if (currentFile.hunks.length > 0) {
            const hunk = currentFile.hunks[currentFile.hunks.length - 1];
            hunk.lines.push(line);
          }
        }
      }
    }
    if (currentFile) files.push(currentFile);

    res.json({ meta, files });
  } catch (err) {
    console.error("Commit diff error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Admin: Explore – Bitbucket source browsing (directory listing + file content)
// ---------------------------------------------------------------------------

function buildBitbucketAuth() {
  const email = getSetting("BITBUCKET_EMAIL");
  const apiToken = getSetting("BITBUCKET_API_TOKEN");
  const workspace = getSetting("BITBUCKET_WORKSPACE");
  if (!email || !apiToken || !workspace) return null;
  return {
    auth: "Basic " + Buffer.from(`${email}:${apiToken}`).toString("base64"),
    workspace,
  };
}

// GET /api/admin/repos/:workspace/:slug/src — directory listing via Bitbucket API
app.get("/api/admin/repos/:workspace/:slug/src", async (req, res) => {
  try {
    const bb = buildBitbucketAuth();
    if (!bb) return res.status(500).json({ error: "Bitbucket credentials not configured." });

    const row = getRepo.get(repoFullName(req));
    if (!row) return res.status(404).json({ error: "Repository not found" });

    const repoSlug = req.params.slug;
    const refParam = req.query.ref || "HEAD";
    const pathParam = req.query.path || "";

    // Build Bitbucket API URL: /2.0/repositories/{workspace}/{slug}/src/{ref}/{path}
    // Note: ref must NOT be encodeURIComponent-encoded because branch names with "/"
    // (e.g. "feature/foo") need their slashes preserved in the URL path.
    const encodedRef = refParam.split("/").map(encodeURIComponent).join("/");
    let url = `https://api.bitbucket.org/2.0/repositories/${bb.workspace}/${repoSlug}/src/${encodedRef}/${pathParam}?pagelen=100`;

    const allValues = [];
    // Paginate through all pages to get full directory listing
    while (url) {
      const bbRes = await fetch(url, {
        headers: { Authorization: bb.auth, Accept: "application/json" },
      });

      if (!bbRes.ok) {
        const status = bbRes.status;
        if (status === 404) return res.status(404).json({ error: "Path not found" });
        return res.status(status).json({ error: `Bitbucket API error: HTTP ${status}` });
      }

      const data = await bbRes.json();
      for (const entry of data.values || []) {
        allValues.push({
          path: entry.path || "",
          type: entry.type === "commit_directory" ? "dir" : "file",
          size: entry.size || 0,
        });
      }
      url = data.next || null;
    }

    // Sort: directories first, then alphabetically
    allValues.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    res.json(allValues);
  } catch (err) {
    console.error("Explore src error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// GET /api/admin/repos/:workspace/:slug/file — file content via Bitbucket API
app.get("/api/admin/repos/:workspace/:slug/file", async (req, res) => {
  try {
    const bb = buildBitbucketAuth();
    if (!bb) return res.status(500).json({ error: "Bitbucket credentials not configured." });

    const row = getRepo.get(repoFullName(req));
    if (!row) return res.status(404).json({ error: "Repository not found" });

    const repoSlug = req.params.slug;
    const refParam = req.query.ref || "HEAD";
    const filePath = req.query.path;

    if (!filePath) return res.status(400).json({ error: "Missing required 'path' query parameter." });

    // Encode each segment of the ref individually to preserve "/" in branch names like "feature/foo"
    const encodedRef = refParam.split("/").map(encodeURIComponent).join("/");
    const url = `https://api.bitbucket.org/2.0/repositories/${bb.workspace}/${repoSlug}/src/${encodedRef}/${filePath}`;

    const bbRes = await fetch(url, {
      headers: { Authorization: bb.auth },
    });

    if (!bbRes.ok) {
      const status = bbRes.status;
      if (status === 404) return res.status(404).json({ error: "File not found" });
      return res.status(status).json({ error: `Bitbucket API error: HTTP ${status}` });
    }

    // Check content length — reject files > 512 KB
    const contentLength = parseInt(bbRes.headers.get("content-length") || "0", 10);
    if (contentLength > 512 * 1024) {
      return res.status(413).json({ error: "File too large to display", size: contentLength });
    }

    const content = await bbRes.text();

    // Double-check size after reading (content-length may not always be present)
    if (content.length > 512 * 1024) {
      return res.status(413).json({ error: "File too large to display", size: content.length });
    }

    res.type("text/plain").send(content);
  } catch (err) {
    console.error("Explore file error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Admin: Enrichment
// ---------------------------------------------------------------------------

const ENRICH_QUEUES = {
  activity: enrichActivityQueue,
  technologies: enrichTechnologiesQueue,
  prs: enrichPrsQueue,
  security: enrichSecurityQueue,
  dependencies: enrichDependenciesQueue,
};

const insertEnrichJob = db.prepare(`
  INSERT INTO enrichment_jobs (id, type, repo_name, status)
  VALUES (?, ?, ?, 'pending')
`);

const insertEnrichBatch = db.transaction((jobs) => {
  for (const j of jobs) {
    insertEnrichJob.run(j.id, j.type, j.repoName);
  }
});

/** POST /api/admin/enrich — trigger enrichment for a set of repos */
app.post("/api/admin/enrich", (req, res) => {
  try {
    const { type, repoNames, branch } = req.body;

    if (!type || !ENRICH_QUEUES[type]) {
      return res.status(400).json({
        error: `Invalid "type". Must be one of: ${Object.keys(ENRICH_QUEUES).join(", ")}`,
      });
    }
    if (!Array.isArray(repoNames) || repoNames.length === 0) {
      return res.status(400).json({ error: '"repoNames" must be a non-empty array of repository names.' });
    }

    const queue = ENRICH_QUEUES[type];

    const jobs = repoNames.map((name) => ({
      id: crypto.randomUUID(),
      type,
      repoName: name,
    }));

    // Persist all job rows in a single transaction
    insertEnrichBatch(jobs);

    // Enqueue messages
    for (const j of jobs) {
      queue.send({ jobId: j.id, repoName: j.repoName, branch: branch || 'default' });
    }

    res.status(202).json({ count: jobs.length });
  } catch (err) {
    console.error("Enrich enqueue error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Recent searches
// ---------------------------------------------------------------------------

const insertRecentSearch = db.prepare(`
  INSERT INTO recent_searches (term, search_pattern, repos_filter)
  VALUES (?, ?, ?)
`);

const listRecentSearches = db.prepare(`
  SELECT id, term, search_pattern, repos_filter, created_at
  FROM recent_searches ORDER BY created_at DESC LIMIT ?
`);

const deleteOldRecentSearches = db.prepare(`
  DELETE FROM recent_searches WHERE id NOT IN (
    SELECT id FROM recent_searches ORDER BY created_at DESC LIMIT 50
  )
`);

/** GET /api/search/recent — list recent searches */
app.get("/api/search/recent", (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    res.json(listRecentSearches.all(limit));
  } catch (err) {
    console.error("Recent searches error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Favourite searches
// ---------------------------------------------------------------------------

const insertFavouriteSearch = db.prepare(`
  INSERT INTO favourite_searches (term, search_pattern, repos_filter)
  VALUES (?, ?, ?)
`);

const listFavouriteSearches = db.prepare(`
  SELECT id, term, search_pattern, repos_filter, created_at
  FROM favourite_searches ORDER BY created_at DESC
`);

const deleteFavouriteSearch = db.prepare(`
  DELETE FROM favourite_searches WHERE id = ?
`);

const findFavouriteSearch = db.prepare(`
  SELECT id FROM favourite_searches
  WHERE term = ? AND search_pattern = ? AND COALESCE(repos_filter, '') = COALESCE(?, '')
`);

/** GET /api/search/favourites — list all favourite searches */
app.get("/api/search/favourites", (_req, res) => {
  try {
    res.json(listFavouriteSearches.all());
  } catch (err) {
    console.error("Favourite searches error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/** POST /api/search/favourites — add a favourite search */
app.post("/api/search/favourites", (req, res) => {
  try {
    const { term, search_pattern, repos_filter } = req.body;
    if (!term || !search_pattern) {
      return res.status(400).json({ error: "Missing required fields: term, search_pattern" });
    }

    // Check for duplicates
    const existing = findFavouriteSearch.get(term, search_pattern, repos_filter || "");
    if (existing) {
      return res.status(409).json({ error: "This search is already saved as a favourite", id: existing.id });
    }

    const result = insertFavouriteSearch.run(term, search_pattern, repos_filter || null);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    console.error("Add favourite error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/** DELETE /api/search/favourites/:id — remove a favourite search */
app.delete("/api/search/favourites/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    const result = deleteFavouriteSearch.run(id);
    if (result.changes === 0) return res.status(404).json({ error: "Favourite not found" });
    res.json({ deleted: true });
  } catch (err) {
    console.error("Delete favourite error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Static file serving for pre-built frontend SPA
// ---------------------------------------------------------------------------

const distDir = path.resolve(__dirname, "..", "frontend", "dist");

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));

  // SPA fallback — all non-API routes serve index.html
  app.get("/{*splat}", (req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

// ---------------------------------------------------------------------------
// Start – clean up stale jobs from previous runs, then start workers
// ---------------------------------------------------------------------------

export function startServer() {
  return new Promise((resolve) => {
    // Delete all job rows so nothing is left over from a previous session
    db.exec(`DELETE FROM search_jobs`);
    db.exec(`DELETE FROM sync_jobs`);
    db.exec(`DELETE FROM enrichment_jobs`);

    // Purge every queue so no stale messages are re-processed
    for (const name of listQueueNames()) {
      getQueue(name).purge();
    }

    console.log("Cleared all jobs and queue messages.");

    startWorker();
    startSyncWorkers();
    startEnrichWorkers();

    httpServer.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      resolve({ port: PORT });
    });

    // Graceful shutdown
    process.on("SIGINT", async () => {
      console.log("\nShutting down...");
      await stopWorker();
      await stopSyncWorkers();
      await stopEnrichWorkers();
      httpServer.close(() => {
        db.close();
        process.exit(0);
      });
    });

    process.on("SIGTERM", async () => {
      await stopWorker();
      await stopSyncWorkers();
      await stopEnrichWorkers();
      httpServer.close(() => {
        db.close();
        process.exit(0);
      });
    });
  });
}

// If this file is executed directly (not imported), start the server immediately.
// This preserves backward compatibility with `node backend/server.js`.
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  startServer();
}
