import { describe, it, expect } from "vitest";
import db from "../db.js";

describe("database", () => {
  describe("schema", () => {
    it("has search_jobs table", () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='search_jobs'").all();
      expect(tables).toHaveLength(1);
    });

    it("has settings table", () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").all();
      expect(tables).toHaveLength(1);
    });

    it("has sync_jobs table", () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_jobs'").all();
      expect(tables).toHaveLength(1);
    });

    it("has repositories table", () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='repositories'").all();
      expect(tables).toHaveLength(1);
    });

    it("has enrichment_jobs table", () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='enrichment_jobs'").all();
      expect(tables).toHaveLength(1);
    });

    it("has security table", () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='security'").all();
      expect(tables).toHaveLength(1);
    });

    it("has dependencies table", () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dependencies'").all();
      expect(tables).toHaveLength(1);
    });

    it("has recent_searches table", () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='recent_searches'").all();
      expect(tables).toHaveLength(1);
    });

    it("has favourite_searches table", () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='favourite_searches'").all();
      expect(tables).toHaveLength(1);
    });
  });

  describe("repositories table columns", () => {
    it("has enrichment columns", () => {
      const info = db.prepare("PRAGMA table_info(repositories)").all();
      const colNames = info.map((c) => c.name);
      expect(colNames).toContain("activity");
      expect(colNames).toContain("technologies");
      expect(colNames).toContain("open_prs");
      expect(colNames).toContain("default_branch");
      expect(colNames).toContain("security_scanned_branch");
      expect(colNames).toContain("dependencies_scanned_branch");
    });
  });

  describe("security table columns", () => {
    it("has url column", () => {
      const info = db.prepare("PRAGMA table_info(security)").all();
      const colNames = info.map((c) => c.name);
      expect(colNames).toContain("url");
    });
  });

  describe("indexes", () => {
    it("has idx_sync_jobs_parent index", () => {
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sync_jobs_parent'").all();
      expect(idx).toHaveLength(1);
    });

    it("has idx_enrichment_jobs_type_status index", () => {
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_enrichment_jobs_type_status'").all();
      expect(idx).toHaveLength(1);
    });

    it("has idx_security_repo index", () => {
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_security_repo'").all();
      expect(idx).toHaveLength(1);
    });

    it("has idx_dependencies_name index", () => {
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_dependencies_name'").all();
      expect(idx).toHaveLength(1);
    });

    it("has idx_recent_searches_created index", () => {
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_recent_searches_created'").all();
      expect(idx).toHaveLength(1);
    });

    it("has idx_favourite_searches_created index", () => {
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_favourite_searches_created'").all();
      expect(idx).toHaveLength(1);
    });
  });

  describe("WAL mode", () => {
    it("is using WAL journal mode", () => {
      const result = db.pragma("journal_mode");
      expect(result[0].journal_mode).toBe("wal");
    });
  });

  describe("CRUD operations", () => {
    it("can insert and read from search_jobs", () => {
      db.prepare("INSERT INTO search_jobs (id, command, pattern) VALUES (?, ?, ?)").run("test-1", "author", "john");
      const row = db.prepare("SELECT * FROM search_jobs WHERE id = ?").get("test-1");
      expect(row).toBeTruthy();
      expect(row.command).toBe("author");
      expect(row.pattern).toBe("john");
      expect(row.status).toBe("pending");
      // Clean up
      db.prepare("DELETE FROM search_jobs WHERE id = ?").run("test-1");
    });

    it("can insert and read from repositories", () => {
      db.prepare("INSERT INTO repositories (name, path) VALUES (?, ?)").run("ws/test-repo", "/tmp/repos/ws/test-repo");
      const row = db.prepare("SELECT * FROM repositories WHERE name = ?").get("ws/test-repo");
      expect(row).toBeTruthy();
      expect(row.path).toBe("/tmp/repos/ws/test-repo");
      // Clean up
      db.prepare("DELETE FROM repositories WHERE name = ?").run("ws/test-repo");
    });

    it("can insert and read from security with foreign key", () => {
      db.prepare("INSERT INTO repositories (name, path) VALUES (?, ?)").run("ws/sec-repo", "/tmp/repos/ws/sec-repo");
      db.prepare("INSERT INTO security (repo_name, dependency, severity) VALUES (?, ?, ?)").run("ws/sec-repo", "lodash", "high");
      const rows = db.prepare("SELECT * FROM security WHERE repo_name = ?").all("ws/sec-repo");
      expect(rows).toHaveLength(1);
      expect(rows[0].dependency).toBe("lodash");
      expect(rows[0].severity).toBe("high");
      // Clean up
      db.prepare("DELETE FROM security WHERE repo_name = ?").run("ws/sec-repo");
      db.prepare("DELETE FROM repositories WHERE name = ?").run("ws/sec-repo");
    });

    it("can insert and read from dependencies", () => {
      db.prepare("INSERT INTO repositories (name, path) VALUES (?, ?)").run("ws/dep-repo", "/tmp/repos/ws/dep-repo");
      db.prepare("INSERT INTO dependencies (name, dependency, version) VALUES (?, ?, ?)").run("ws/dep-repo", "express", "^5.0.0");
      const rows = db.prepare("SELECT * FROM dependencies WHERE name = ?").all("ws/dep-repo");
      expect(rows).toHaveLength(1);
      expect(rows[0].dependency).toBe("express");
      // Clean up
      db.prepare("DELETE FROM dependencies WHERE name = ?").run("ws/dep-repo");
      db.prepare("DELETE FROM repositories WHERE name = ?").run("ws/dep-repo");
    });
  });
});
