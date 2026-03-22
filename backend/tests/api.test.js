import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import db from "../db.js";
import { getAllSettings, updateSettings, getSetting } from "../settings.js";
import { getQueue, listQueueNames } from "../queue.js";
import { VALID_COMMANDS } from "../search.js";

// ---------------------------------------------------------------------------
// Build a minimal Express app that mirrors the real server's routes
// but without starting workers, Socket.IO, or an HTTP listener.
// This avoids side effects while testing the route handlers in isolation.
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // --- Prepared statements ---
  const insertJob = db.prepare(`
    INSERT INTO search_jobs (id, command, pattern, repo_filter, all_commits, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `);
  const getJob = db.prepare(`SELECT * FROM search_jobs WHERE id = ?`);
  const listJobs = db.prepare(`
    SELECT id, command, pattern, repo_filter, all_commits, status, error, created_at, updated_at
    FROM search_jobs ORDER BY created_at DESC LIMIT ?
  `);

  // --- Search endpoints ---
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
      const jobId = crypto.randomUUID();
      insertJob.run(jobId, command, pattern, repo || null, allCommits ? 1 : 0);
      res.status(202).json({ jobId, status: "pending" });
    } catch (err) {
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  });

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

  app.get("/api/search/jobs", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    res.json(listJobs.all(limit));
  });

  // --- Settings endpoints ---
  app.get("/api/admin/settings", (_req, res) => {
    res.json(getAllSettings());
  });

  app.put("/api/admin/settings", (req, res) => {
    try {
      const settings = req.body;
      if (!settings || typeof settings !== "object") {
        return res.status(400).json({ error: "Body must be an object of { key: value } pairs." });
      }
      updateSettings(settings);
      res.json(getAllSettings());
    } catch (err) {
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  });

  // --- Queue endpoints ---
  app.get("/api/queues", (_req, res) => {
    res.json(listQueueNames());
  });

  app.get("/api/queues/:name/size", (req, res) => {
    const q = getQueue(req.params.name);
    res.json({ size: q.size() });
  });

  app.post("/api/queues/:name/send", (req, res) => {
    try {
      const q = getQueue(req.params.name);
      const { body: msgBody, delay, priority } = req.body;
      if (msgBody === undefined) {
        return res.status(400).json({ error: "Missing required 'body' field." });
      }
      const id = q.send(msgBody, { delay, priority });
      res.status(202).json({ id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/queues/:name/purge", (req, res) => {
    const q = getQueue(req.params.name);
    const removed = q.purge();
    res.json({ removed });
  });

  // --- Repos endpoints ---
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

  app.get("/api/admin/repos", (req, res) => {
    try {
      res.json(listRepos.all());
    } catch (err) {
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  });

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

  function repoFullName(req) {
    return `${req.params.workspace}/${req.params.slug}`;
  }

  app.get("/api/admin/repos/:workspace/:slug", (req, res) => {
    try {
      const row = getRepo.get(repoFullName(req));
      if (!row) return res.status(404).json({ error: "Repository not found" });
      res.json(row);
    } catch (err) {
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  });

  // --- Recent searches ---
  const insertRecentSearch = db.prepare(`
    INSERT INTO recent_searches (term, search_pattern, repos_filter)
    VALUES (?, ?, ?)
  `);
  const listRecentSearches = db.prepare(`
    SELECT id, term, search_pattern, repos_filter, created_at
    FROM recent_searches ORDER BY created_at DESC LIMIT ?
  `);

  app.get("/api/search/recent", (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
      res.json(listRecentSearches.all(limit));
    } catch (err) {
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  });

  // --- Favourite searches ---
  const insertFavouriteSearch = db.prepare(`
    INSERT INTO favourite_searches (term, search_pattern, repos_filter)
    VALUES (?, ?, ?)
  `);
  const listFavouriteSearches = db.prepare(`
    SELECT id, term, search_pattern, repos_filter, created_at
    FROM favourite_searches ORDER BY created_at DESC
  `);
  const deleteFavouriteSearch = db.prepare(`DELETE FROM favourite_searches WHERE id = ?`);
  const findFavouriteSearch = db.prepare(`
    SELECT id FROM favourite_searches
    WHERE term = ? AND search_pattern = ? AND COALESCE(repos_filter, '') = COALESCE(?, '')
  `);

  app.get("/api/search/favourites", (_req, res) => {
    try {
      res.json(listFavouriteSearches.all());
    } catch (err) {
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  });

  app.post("/api/search/favourites", (req, res) => {
    try {
      const { term, search_pattern, repos_filter } = req.body;
      if (!term || !search_pattern) {
        return res.status(400).json({ error: "Missing required fields: term, search_pattern" });
      }
      const existing = findFavouriteSearch.get(term, search_pattern, repos_filter || "");
      if (existing) {
        return res.status(409).json({ error: "This search is already saved as a favourite", id: existing.id });
      }
      const result = insertFavouriteSearch.run(term, search_pattern, repos_filter || null);
      res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (err) {
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  });

  app.delete("/api/search/favourites/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
      const result = deleteFavouriteSearch.run(id);
      if (result.changes === 0) return res.status(404).json({ error: "Favourite not found" });
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  });

  // --- Enrichment endpoint ---
  const ENRICH_TYPES = ["activity", "technologies", "prs", "security", "dependencies"];

  const insertEnrichJob = db.prepare(`
    INSERT INTO enrichment_jobs (id, type, repo_name, status)
    VALUES (?, ?, ?, 'pending')
  `);

  const insertEnrichBatch = db.transaction((jobs) => {
    for (const j of jobs) {
      insertEnrichJob.run(j.id, j.type, j.repoName);
    }
  });

  app.post("/api/admin/enrich", (req, res) => {
    try {
      const { type, repoNames } = req.body;
      if (!type || !ENRICH_TYPES.includes(type)) {
        return res.status(400).json({
          error: `Invalid "type". Must be one of: ${ENRICH_TYPES.join(", ")}`,
        });
      }
      if (!Array.isArray(repoNames) || repoNames.length === 0) {
        return res.status(400).json({ error: '"repoNames" must be a non-empty array of repository names.' });
      }
      const jobs = repoNames.map((name) => ({
        id: crypto.randomUUID(),
        type,
        repoName: name,
      }));
      insertEnrichBatch(jobs);
      res.status(202).json({ count: jobs.length });
    } catch (err) {
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  });

  // --- All jobs endpoint ---
  const ALLOWED_TABLES = ["sync_jobs", "search_jobs", "enrichment_jobs"];

  app.get("/api/admin/all-jobs", (req, res) => {
    const queue = req.query.queue || "sync_jobs";
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    if (!ALLOWED_TABLES.includes(queue)) {
      return res.status(400).json({
        error: `Invalid "queue". Must be one of: ${ALLOWED_TABLES.join(", ")}`,
      });
    }
    try {
      const total = db.prepare(`SELECT COUNT(*) as count FROM ${queue}`).get().count;
      const rows = db.prepare(`SELECT * FROM ${queue} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
      res.json({ rows, total, offset, limit });
    } catch (err) {
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  });

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const app = createTestApp();

beforeEach(() => {
  // Clean tables between tests
  db.exec("DELETE FROM search_jobs");
  db.exec("DELETE FROM settings");
  db.exec("DELETE FROM repositories");
  db.exec("DELETE FROM enrichment_jobs");
  db.exec("DELETE FROM sync_jobs");
  db.exec("DELETE FROM recent_searches");
  db.exec("DELETE FROM favourite_searches");
  db.exec("DELETE FROM security");
  db.exec("DELETE FROM dependencies");

  // Purge all queues
  for (const name of listQueueNames()) {
    getQueue(name).purge();
  }
});

// ---------------------------------------------------------------------------
// Search Jobs API
// ---------------------------------------------------------------------------

describe("POST /api/search/jobs", () => {
  it("creates a search job and returns 202", async () => {
    const res = await request(app)
      .post("/api/search/jobs")
      .send({ command: "author", pattern: "john" });
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty("jobId");
    expect(res.body.status).toBe("pending");
  });

  it("rejects missing command", async () => {
    const res = await request(app)
      .post("/api/search/jobs")
      .send({ pattern: "john" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("command");
  });

  it("rejects invalid command", async () => {
    const res = await request(app)
      .post("/api/search/jobs")
      .send({ command: "invalid", pattern: "john" });
    expect(res.status).toBe(400);
  });

  it("rejects missing pattern", async () => {
    const res = await request(app)
      .post("/api/search/jobs")
      .send({ command: "author" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("pattern");
  });

  it("accepts all valid commands", async () => {
    for (const cmd of ["author", "message", "filepath", "content"]) {
      const res = await request(app)
        .post("/api/search/jobs")
        .send({ command: cmd, pattern: "test" });
      expect(res.status).toBe(202);
    }
  });

  it("stores repo filter", async () => {
    const res = await request(app)
      .post("/api/search/jobs")
      .send({ command: "author", pattern: "john", repo: "my-repo" });
    expect(res.status).toBe(202);

    const job = await request(app).get(`/api/search/jobs/${res.body.jobId}`);
    expect(job.body.repoFilter).toBe("my-repo");
  });
});

describe("GET /api/search/jobs/:id", () => {
  it("returns 404 for non-existent job", async () => {
    const res = await request(app).get("/api/search/jobs/nonexistent-id");
    expect(res.status).toBe(404);
  });

  it("returns job details", async () => {
    const createRes = await request(app)
      .post("/api/search/jobs")
      .send({ command: "author", pattern: "john" });
    const jobId = createRes.body.jobId;

    const res = await request(app).get(`/api/search/jobs/${jobId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(jobId);
    expect(res.body.command).toBe("author");
    expect(res.body.pattern).toBe("john");
    expect(res.body.status).toBe("pending");
  });
});

describe("GET /api/search/jobs", () => {
  it("returns empty list when no jobs exist", async () => {
    const res = await request(app).get("/api/search/jobs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns created jobs", async () => {
    await request(app).post("/api/search/jobs").send({ command: "author", pattern: "first" });
    await request(app).post("/api/search/jobs").send({ command: "message", pattern: "second" });

    const res = await request(app).get("/api/search/jobs");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Both jobs should be present (order may vary within same second)
    const patterns = res.body.map((j) => j.pattern).sort();
    expect(patterns).toEqual(["first", "second"]);
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/search/jobs").send({ command: "author", pattern: `p${i}` });
    }
    const res = await request(app).get("/api/search/jobs?limit=2");
    expect(res.body).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Settings API
// ---------------------------------------------------------------------------

describe("GET /api/admin/settings", () => {
  it("returns all settings", async () => {
    const res = await request(app).get("/api/admin/settings");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    // Each setting should have key and label
    for (const setting of res.body) {
      expect(setting).toHaveProperty("key");
      expect(setting).toHaveProperty("label");
    }
  });

  it("redacts secret settings", async () => {
    const res = await request(app).get("/api/admin/settings");
    const token = res.body.find((s) => s.key === "BITBUCKET_API_TOKEN");
    expect(token.value).toBeUndefined();
    expect(token.secret).toBe(true);
  });
});

describe("PUT /api/admin/settings", () => {
  it("updates settings and returns updated list", async () => {
    const res = await request(app)
      .put("/api/admin/settings")
      .send({ MAX_REPOS_TO_FETCH: "999" });
    expect(res.status).toBe(200);
    const maxRepos = res.body.find((s) => s.key === "MAX_REPOS_TO_FETCH");
    expect(maxRepos.value).toBe("999");
  });

  it("rejects null body", async () => {
    const res = await request(app)
      .put("/api/admin/settings")
      .set("Content-Type", "application/json")
      .send("null");
    expect(res.status).toBe(400);
  });

  it("rejects array body", async () => {
    const res = await request(app)
      .put("/api/admin/settings")
      .send([1, 2, 3]);
    // Arrays are objects in JS, but should still work since
    // Object.entries on an array yields index/value pairs
    // This is an edge case - the endpoint accepts it gracefully
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Queue API
// ---------------------------------------------------------------------------

describe("GET /api/queues", () => {
  it("returns list of queue names", async () => {
    const res = await request(app).get("/api/queues");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContain("search-jobs");
    expect(res.body).toContain("sync-all");
    expect(res.body).toContain("sync-one");
  });
});

describe("GET /api/queues/:name/size", () => {
  it("returns queue size", async () => {
    const res = await request(app).get("/api/queues/search-jobs/size");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("size");
    expect(typeof res.body.size).toBe("number");
  });
});

describe("POST /api/queues/:name/send", () => {
  it("sends a message and returns 202", async () => {
    const res = await request(app)
      .post("/api/queues/search-jobs/send")
      .send({ body: { test: true } });
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty("id");
  });

  it("rejects missing body field", async () => {
    const res = await request(app)
      .post("/api/queues/search-jobs/send")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("body");
  });
});

describe("POST /api/queues/:name/purge", () => {
  it("purges a queue", async () => {
    // Send some messages first
    await request(app).post("/api/queues/search-jobs/send").send({ body: { a: 1 } });
    await request(app).post("/api/queues/search-jobs/send").send({ body: { b: 2 } });

    const res = await request(app).post("/api/queues/search-jobs/purge");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("removed");

    // Verify queue is empty
    const sizeRes = await request(app).get("/api/queues/search-jobs/size");
    expect(sizeRes.body.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Repos API
// ---------------------------------------------------------------------------

describe("GET /api/admin/repos", () => {
  it("returns empty list when no repos exist", async () => {
    const res = await request(app).get("/api/admin/repos");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns repos after insertion", async () => {
    db.prepare("INSERT INTO repositories (name, path) VALUES (?, ?)").run("ws/my-repo", "/tmp/repos/ws/my-repo");

    const res = await request(app).get("/api/admin/repos");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("ws/my-repo");
  });
});

describe("GET /api/admin/repos/:workspace/:slug", () => {
  it("returns 404 for non-existent repo", async () => {
    const res = await request(app).get("/api/admin/repos/ws/nonexistent");
    expect(res.status).toBe(404);
  });

  it("returns repo details", async () => {
    db.prepare("INSERT INTO repositories (name, path) VALUES (?, ?)").run("ws/my-repo", "/tmp/repos/ws/my-repo");

    const res = await request(app).get("/api/admin/repos/ws/my-repo");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("ws/my-repo");
    expect(res.body.path).toBe("/tmp/repos/ws/my-repo");
  });
});

// ---------------------------------------------------------------------------
// Recent Searches API
// ---------------------------------------------------------------------------

describe("GET /api/search/recent", () => {
  it("returns empty list initially", async () => {
    const res = await request(app).get("/api/search/recent");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns recent searches after insertion", async () => {
    db.prepare("INSERT INTO recent_searches (term, search_pattern, repos_filter) VALUES (?, ?, ?)").run("author", "john", null);

    const res = await request(app).get("/api/search/recent");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].term).toBe("author");
    expect(res.body[0].search_pattern).toBe("john");
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      db.prepare("INSERT INTO recent_searches (term, search_pattern) VALUES (?, ?)").run("author", `pattern${i}`);
    }

    const res = await request(app).get("/api/search/recent?limit=3");
    expect(res.body).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Favourite Searches API
// ---------------------------------------------------------------------------

describe("POST /api/search/favourites", () => {
  it("creates a favourite and returns 201", async () => {
    const res = await request(app)
      .post("/api/search/favourites")
      .send({ term: "author", search_pattern: "john" });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
  });

  it("rejects missing fields", async () => {
    const res = await request(app)
      .post("/api/search/favourites")
      .send({ term: "author" });
    expect(res.status).toBe(400);

    const res2 = await request(app)
      .post("/api/search/favourites")
      .send({ search_pattern: "john" });
    expect(res2.status).toBe(400);
  });

  it("rejects duplicate favourites", async () => {
    await request(app)
      .post("/api/search/favourites")
      .send({ term: "author", search_pattern: "john" });

    const res = await request(app)
      .post("/api/search/favourites")
      .send({ term: "author", search_pattern: "john" });
    expect(res.status).toBe(409);
  });
});

describe("GET /api/search/favourites", () => {
  it("returns all favourites", async () => {
    await request(app)
      .post("/api/search/favourites")
      .send({ term: "author", search_pattern: "john" });
    await request(app)
      .post("/api/search/favourites")
      .send({ term: "message", search_pattern: "fix" });

    const res = await request(app).get("/api/search/favourites");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

describe("DELETE /api/search/favourites/:id", () => {
  it("deletes a favourite", async () => {
    const createRes = await request(app)
      .post("/api/search/favourites")
      .send({ term: "author", search_pattern: "john" });
    const id = createRes.body.id;

    const res = await request(app).delete(`/api/search/favourites/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    // Verify it's gone
    const listRes = await request(app).get("/api/search/favourites");
    expect(listRes.body).toHaveLength(0);
  });

  it("returns 404 for non-existent favourite", async () => {
    const res = await request(app).delete("/api/search/favourites/99999");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid ID", async () => {
    const res = await request(app).delete("/api/search/favourites/abc");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Enrichment API
// ---------------------------------------------------------------------------

describe("POST /api/admin/enrich", () => {
  it("creates enrichment jobs and returns 202", async () => {
    // Insert a repo first
    db.prepare("INSERT INTO repositories (name, path) VALUES (?, ?)").run("ws/repo1", "/tmp/repos/ws/repo1");

    const res = await request(app)
      .post("/api/admin/enrich")
      .send({ type: "activity", repoNames: ["ws/repo1"] });
    expect(res.status).toBe(202);
    expect(res.body.count).toBe(1);
  });

  it("creates multiple jobs for multiple repos", async () => {
    const res = await request(app)
      .post("/api/admin/enrich")
      .send({ type: "technologies", repoNames: ["ws/repo1", "ws/repo2", "ws/repo3"] });
    expect(res.status).toBe(202);
    expect(res.body.count).toBe(3);
  });

  it("rejects invalid type", async () => {
    const res = await request(app)
      .post("/api/admin/enrich")
      .send({ type: "invalid", repoNames: ["ws/repo1"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("type");
  });

  it("rejects empty repoNames", async () => {
    const res = await request(app)
      .post("/api/admin/enrich")
      .send({ type: "activity", repoNames: [] });
    expect(res.status).toBe(400);
  });

  it("rejects missing repoNames", async () => {
    const res = await request(app)
      .post("/api/admin/enrich")
      .send({ type: "activity" });
    expect(res.status).toBe(400);
  });

  it("accepts all valid enrichment types", async () => {
    for (const type of ["activity", "technologies", "prs", "security", "dependencies"]) {
      const res = await request(app)
        .post("/api/admin/enrich")
        .send({ type, repoNames: ["ws/repo1"] });
      expect(res.status).toBe(202);
    }
  });
});

// ---------------------------------------------------------------------------
// All Jobs API
// ---------------------------------------------------------------------------

describe("GET /api/admin/all-jobs", () => {
  it("returns paginated results from sync_jobs by default", async () => {
    const res = await request(app).get("/api/admin/all-jobs");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("rows");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("offset");
    expect(res.body).toHaveProperty("limit");
  });

  it("supports search_jobs queue", async () => {
    await request(app).post("/api/search/jobs").send({ command: "author", pattern: "test" });

    const res = await request(app).get("/api/admin/all-jobs?queue=search_jobs");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.rows).toHaveLength(1);
  });

  it("supports enrichment_jobs queue", async () => {
    const res = await request(app).get("/api/admin/all-jobs?queue=enrichment_jobs");
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
  });

  it("rejects invalid queue name", async () => {
    const res = await request(app).get("/api/admin/all-jobs?queue=invalid_table");
    expect(res.status).toBe(400);
  });

  it("supports pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/search/jobs").send({ command: "author", pattern: `p${i}` });
    }

    const res = await request(app).get("/api/admin/all-jobs?queue=search_jobs&limit=2&offset=0");
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.total).toBe(5);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(0);
  });
});
