import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "massrepo.db");

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read/write performance
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");

// ---------------------------------------------------------------------------
// Application tables (beyond what sqliteq creates automatically)
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS search_jobs (
    id          TEXT PRIMARY KEY,
    command     TEXT NOT NULL,
    pattern     TEXT NOT NULL,
    repo_filter TEXT,
    all_commits INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'pending',
    result      TEXT,
    error       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ---------------------------------------------------------------------------
// Settings table – user-configurable key/value pairs
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ---------------------------------------------------------------------------
// Sync jobs table – tracks sync-all and sync-one jobs
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS sync_jobs (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,           -- 'sync-all' or 'sync-one'
    parent_id   TEXT,                    -- for sync-one: the sync-all job id
    repo_name   TEXT,                    -- for sync-one: the repository full_name
    status      TEXT NOT NULL DEFAULT 'pending',
    progress    TEXT,                    -- JSON: { cloned, skipped, failed, total }
    error       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_sync_jobs_parent ON sync_jobs(parent_id)
`);

// ---------------------------------------------------------------------------
// Repositories table – persistent catalog of discovered repos
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS repositories (
    name         TEXT PRIMARY KEY,
    path         TEXT NOT NULL,
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Add enrichment columns to repositories (idempotent)
for (const col of ["activity TEXT", "technologies TEXT", "open_prs TEXT", "default_branch TEXT", "security_scanned_branch TEXT", "dependencies_scanned_branch TEXT"]) {
  try { db.exec(`ALTER TABLE repositories ADD COLUMN ${col}`); } catch { /* already exists */ }
}

// ---------------------------------------------------------------------------
// Enrichment jobs table – tracks per-repo enrichment tasks
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS enrichment_jobs (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,           -- 'activity', 'technologies', 'prs'
    repo_name   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    error       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_type_status ON enrichment_jobs(type, status)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_sync_jobs_type_status ON sync_jobs(type, status)
`);

// ---------------------------------------------------------------------------
// Security table – per-repo vulnerability findings from npm audit
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS security (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_name    TEXT NOT NULL,
    dependency   TEXT NOT NULL,
    version      TEXT,
    issue        TEXT,
    severity     TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (repo_name) REFERENCES repositories(name) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_security_repo ON security(repo_name)
`);

// Add url column to security table (idempotent)
try { db.exec(`ALTER TABLE security ADD COLUMN url TEXT`); } catch { /* already exists */ }

// ---------------------------------------------------------------------------
// Dependencies table – per-repo dependency list from package.json
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS dependencies (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    dependency   TEXT NOT NULL,
    version      TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (name) REFERENCES repositories(name) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_dependencies_name ON dependencies(name)
`);

// ---------------------------------------------------------------------------
// Recent searches — auto-saved every time a search is executed
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS recent_searches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    term         TEXT NOT NULL,
    search_pattern TEXT NOT NULL,
    repos_filter TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_recent_searches_created ON recent_searches(created_at DESC)
`);

// ---------------------------------------------------------------------------
// Favourite searches — user-saved searches with star icon
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS favourite_searches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    term         TEXT NOT NULL,
    search_pattern TEXT NOT NULL,
    repos_filter TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_favourite_searches_created ON favourite_searches(created_at DESC)
`);

console.log(`SQLite database opened at ${DB_PATH}`);

export default db;
