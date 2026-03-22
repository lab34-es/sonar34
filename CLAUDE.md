# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Sonar34 (`@lab34-es/sonar34`) — Enterprise Repository Intelligence for Bitbucket Cloud. It clones repos via partial git clones (metadata only), then lets you search and enrich them. Distributed as an npx-runnable package published to GitHub Packages.

## Commands

All commands run from the **repo root** unless noted.

```bash
# Development (starts backend on :3001 + Vite dev server concurrently)
npm run dev

# Build frontend only (outputs to frontend/dist/)
npm run build

# Run the app (serves built frontend + backend)
npm start

# Lint frontend
cd frontend && npm run lint

# Run backend tests (from repo root or backend/)
cd backend && npm test

# Run a single test file
cd backend && npx vitest run tests/settings.test.js

# Watch mode
cd backend && npm run test:watch
```

## Architecture

The project is an ES module monorepo with three parts:

**`bin/cli.js`** — Entry point for the CLI. Calls `startServer()` and opens the browser.

**`backend/`** — Express 5 + Socket.IO server on port 3001 (configurable via `PORT`).
- `server.js` — HTTP/WebSocket server, REST API routes, streaming search over Socket.IO
- `db.js` — SQLite (better-sqlite3) in WAL mode. `DB_PATH` env var controls location; defaults to `backend/massrepo.db`
- `queue.js` — Named job queues backed by SQLite via `@minnzen/sqliteq`. Queues: `search-jobs`, `sync-all`, `sync-one`, `enrich-activity`, `enrich-technologies`, `enrich-prs`, `enrich-security`, `enrich-dependencies`
- `syncWorker.js` — Processes `sync-all` (Bitbucket API discovery) and `sync-one` (git clone/pull) jobs
- `enrichWorker.js` — Processes enrichment jobs: commit activity sparklines, technology detection, open PR counts, npm security audits, dependency extraction
- `search.js` — Pure search logic: runs `git log` / `git grep` / etc. across cloned repos, used by both the REST handler and the Socket.IO streaming path
- `parsers.js` — Parses git log output, detects technologies from file markers, parses dependency files (requirements.txt, Pipfile, pom.xml, build.gradle)
- `settings.js` — Key/value settings persisted in the SQLite `settings` table; read lazily so admin UI changes apply immediately
- `io.js` — Socket.IO initialization shared between server and workers

**`frontend/`** — React 19 + Vite + MUI Joy UI.
- Vite dev server proxies `/api` and `/socket.io` to `http://localhost:3001`
- Routes: `/repos`, `/repos/*` (detail), `/search`, `/admin/jobs`, `/admin/settings`, `/commit/*`
- Uses Monaco Editor for commit diffs and TanStack Virtual for large lists

## Testing

Tests live in `backend/tests/` and use **Vitest**. Key constraints:

- Tests run **sequentially** (`fileParallelism: false`) because they share a SQLite DB
- `tests/setup.js` sets `DB_PATH` to a temp file before any module loads, so tests never touch `backend/massrepo.db`
- Test timeout is 15 seconds per test/hook

## Key env vars

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP server port |
| `DB_PATH` | `backend/massrepo.db` | SQLite database path |
| `REPOS_DIR` | (set via Settings UI) | Where cloned repos are stored |

Bitbucket credentials (`BITBUCKET_EMAIL`, `BITBUCKET_API_TOKEN`, `BITBUCKET_WORKSPACE`) and `REPOS_DIR` are stored in the SQLite `settings` table and managed through the Settings UI, not environment variables.
