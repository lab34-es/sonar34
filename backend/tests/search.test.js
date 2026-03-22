import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { setSetting } from "../settings.js";
import { VALID_COMMANDS, discoverRepos, runSearch, runSearchStreaming } from "../search.js";

// ---------------------------------------------------------------------------
// Create a temporary git repository structure for integration tests.
// Layout:
//   tmpDir/
//     ws/
//       repo-a/           (a git repo with commits)
//         .git/
//         hello.txt
//       repo-b/           (a git repo with commits)
//         .git/
//         world.txt
//       not-a-repo/       (directory without .git)
//         README.md
// ---------------------------------------------------------------------------

let tmpDir;
let repoADir;
let repoBDir;

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    timeout: 10_000,
    env: { ...process.env, GIT_AUTHOR_NAME: "Test Author", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test Author", GIT_COMMITTER_EMAIL: "test@example.com" },
  }).toString();
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "massrepo-search-test-"));

  // Point REPOS_DIR at our temp directory
  setSetting("REPOS_DIR", tmpDir);

  // repo-a
  repoADir = path.join(tmpDir, "ws", "repo-a");
  fs.mkdirSync(repoADir, { recursive: true });
  git(["init"], repoADir);
  git(["checkout", "-b", "main"], repoADir);
  fs.writeFileSync(path.join(repoADir, "hello.txt"), "Hello World\nfoo bar\n");
  git(["add", "."], repoADir);
  git(["commit", "-m", "Initial commit by John Doe"], repoADir);

  fs.writeFileSync(path.join(repoADir, "utils.js"), "function add(a, b) { return a + b; }\n");
  git(["add", "."], repoADir);
  git(["commit", "-m", "Add utility function"], repoADir);

  // repo-b
  repoBDir = path.join(tmpDir, "ws", "repo-b");
  fs.mkdirSync(repoBDir, { recursive: true });
  git(["init"], repoBDir);
  git(["checkout", "-b", "main"], repoBDir);
  fs.writeFileSync(path.join(repoBDir, "world.txt"), "Hello Universe\n");
  git(["add", "."], repoBDir);
  git(["commit", "-m", "First commit"], repoBDir);

  // not-a-repo (no .git)
  const notARepo = path.join(tmpDir, "ws", "not-a-repo");
  fs.mkdirSync(notARepo, { recursive: true });
  fs.writeFileSync(path.join(notARepo, "README.md"), "Not a repo\n");
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// ---------------------------------------------------------------------------
// VALID_COMMANDS
// ---------------------------------------------------------------------------

describe("VALID_COMMANDS", () => {
  it("is a Set", () => {
    expect(VALID_COMMANDS).toBeInstanceOf(Set);
  });

  it("contains exactly the four expected commands", () => {
    expect([...VALID_COMMANDS].sort()).toEqual(["author", "content", "filepath", "message"]);
  });

  it("rejects unknown commands", () => {
    expect(VALID_COMMANDS.has("unknown")).toBe(false);
    expect(VALID_COMMANDS.has("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// discoverRepos
// ---------------------------------------------------------------------------

describe("discoverRepos", () => {
  it("discovers git repos and ignores non-repo directories", async () => {
    const repos = await discoverRepos();
    const names = repos.map((r) => r.name).sort();
    expect(names).toContain(path.join("ws", "repo-a"));
    expect(names).toContain(path.join("ws", "repo-b"));
    expect(names).not.toContain(path.join("ws", "not-a-repo"));
  });

  it("returns abs and name properties", async () => {
    const repos = await discoverRepos();
    for (const repo of repos) {
      expect(repo).toHaveProperty("abs");
      expect(repo).toHaveProperty("name");
      expect(path.isAbsolute(repo.abs)).toBe(true);
    }
  });

  it("filters repos by name", async () => {
    const repos = await discoverRepos(["repo-a"]);
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toContain("repo-a");
  });

  it("returns empty array when filter matches nothing", async () => {
    const repos = await discoverRepos(["nonexistent-xyz"]);
    expect(repos).toEqual([]);
  });

  it("supports multiple filters", async () => {
    const repos = await discoverRepos(["repo-a", "repo-b"]);
    expect(repos).toHaveLength(2);
  });

  it("handles empty filter array (returns all repos)", async () => {
    const repos = await discoverRepos([]);
    expect(repos.length).toBeGreaterThanOrEqual(2);
  });

  it("handles null/undefined filter (returns all repos)", async () => {
    const reposNull = await discoverRepos(null);
    const reposUndefined = await discoverRepos(undefined);
    expect(reposNull.length).toBeGreaterThanOrEqual(2);
    expect(reposUndefined.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// runSearch
// ---------------------------------------------------------------------------

describe("runSearch", () => {
  it("throws on unknown command", async () => {
    const repos = await discoverRepos();
    await expect(runSearch("invalid", repos, "test", false)).rejects.toThrow("Unknown command");
  });

  describe("author search", () => {
    it("finds commits by author name", async () => {
      const repos = await discoverRepos();
      const results = await runSearch("author", repos, "Test Author", false);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.authorName).toBe("Test Author");
      }
    });

    it("returns empty for non-matching author", async () => {
      const repos = await discoverRepos();
      const results = await runSearch("author", repos, "Nobody Here", false);
      expect(results).toEqual([]);
    });
  });

  describe("message search", () => {
    it("finds commits by message pattern", async () => {
      const repos = await discoverRepos();
      const results = await runSearch("message", repos, "Initial commit", false);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.subject.includes("Initial commit"))).toBe(true);
    });

    it("returns empty for non-matching message", async () => {
      const repos = await discoverRepos();
      const results = await runSearch("message", repos, "zzzNonExistentMessage", false);
      expect(results).toEqual([]);
    });
  });

  describe("filepath search", () => {
    it("finds files by path pattern (HEAD)", async () => {
      const repos = await discoverRepos();
      const results = await runSearch("filepath", repos, "hello\\.txt", false);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].filepath).toBe("hello.txt");
      expect(results[0].scope).toBe("HEAD");
    });

    it("finds files by path pattern (all commits)", async () => {
      const repos = await discoverRepos();
      const results = await runSearch("filepath", repos, "utils\\.js", true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].scope).toBe("all-commits");
    });

    it("returns empty for non-matching filepath", async () => {
      const repos = await discoverRepos();
      const results = await runSearch("filepath", repos, "nonexistent_file_xyz", false);
      expect(results).toEqual([]);
    });
  });

  describe("content search", () => {
    it("finds content matches in HEAD", async () => {
      const repos = await discoverRepos();
      const results = await runSearch("content", repos, "Hello World", false);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty("file");
      expect(results[0]).toHaveProperty("line");
      expect(results[0]).toHaveProperty("content");
      expect(results[0].scope).toBe("HEAD");
    });

    it("finds content matches in all commits", async () => {
      const repos = await discoverRepos();
      const results = await runSearch("content", repos, "Hello", true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].scope).toBe("all-commits");
    });

    it("returns empty for non-matching content", async () => {
      const repos = await discoverRepos();
      const results = await runSearch("content", repos, "zzCompletelyAbsentContent", false);
      expect(results).toEqual([]);
    });
  });

  it("scopes search to filtered repos", async () => {
    const repos = await discoverRepos(["repo-a"]);
    const results = await runSearch("author", repos, "Test Author", false);
    for (const r of results) {
      expect(r.repo).toContain("repo-a");
    }
  });
});

// ---------------------------------------------------------------------------
// runSearchStreaming
// ---------------------------------------------------------------------------

describe("runSearchStreaming", () => {
  it("calls onProgress and onResults callbacks", async () => {
    const repos = await discoverRepos();
    const progressCalls = [];
    const resultsBatches = [];

    await runSearchStreaming(
      "author",
      repos,
      "Test Author",
      false,
      {},
      {
        onProgress(searched, total, repoName) {
          progressCalls.push({ searched, total, repoName });
        },
        onResults(results) {
          resultsBatches.push(results);
        },
      }
    );

    // onProgress should be called once per repo
    expect(progressCalls).toHaveLength(repos.length);
    // searched should increase monotonically
    for (let i = 0; i < progressCalls.length; i++) {
      expect(progressCalls[i].searched).toBe(i + 1);
      expect(progressCalls[i].total).toBe(repos.length);
    }
    // At least some results should have been found
    expect(resultsBatches.length).toBeGreaterThan(0);
  });

  it("does not call onResults when no matches are found", async () => {
    const repos = await discoverRepos();
    const resultsBatches = [];

    await runSearchStreaming(
      "author",
      repos,
      "Nobody At All",
      false,
      {},
      {
        onProgress() {},
        onResults(results) {
          resultsBatches.push(results);
        },
      }
    );

    expect(resultsBatches).toHaveLength(0);
  });

  it("works with date filters", async () => {
    const repos = await discoverRepos();
    const progressCalls = [];

    await runSearchStreaming(
      "author",
      repos,
      "Test Author",
      false,
      { dateFrom: "2000-01-01", dateTo: "2099-12-31" },
      {
        onProgress(searched, total, repoName) {
          progressCalls.push({ searched, total, repoName });
        },
        onResults() {},
      }
    );

    expect(progressCalls).toHaveLength(repos.length);
  });

  it("supports all command types", async () => {
    const repos = await discoverRepos(["repo-a"]);

    for (const command of ["author", "message", "filepath", "content"]) {
      const pattern = command === "author" ? "Test" : command === "message" ? "commit" : command === "filepath" ? "hello" : "Hello";
      const progressCalls = [];

      await runSearchStreaming(
        command,
        repos,
        pattern,
        false,
        {},
        {
          onProgress(searched) {
            progressCalls.push(searched);
          },
          onResults() {},
        }
      );

      expect(progressCalls).toHaveLength(repos.length);
    }
  });
});
