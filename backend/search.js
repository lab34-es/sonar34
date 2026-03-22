/**
 * search.js
 *
 * Pure search logic extracted from server.js so it can be reused by both
 * the synchronous API handler and the async queue worker.
 */
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSetting } from "./settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve REPOS_DIR lazily so admin UI changes take effect. */
function getReposDir() {
  return path.resolve(getSetting("REPOS_DIR"));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Promisified execFile with sane defaults. */
function git(args, cwd, { maxBuffer = 50 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer, timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 1 && stdout === "" && stderr === "") return resolve("");
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

/** Build git log date-range flags from optional dateFrom / dateTo strings (YYYY-MM-DD). */
function dateArgs(dateFrom, dateTo) {
  const args = [];
  if (dateFrom) args.push(`--after=${dateFrom}`);
  if (dateTo) args.push(`--before=${dateTo}T23:59:59`);
  return args;
}

/** Return the HEAD ref name (branch) or fall back to the commit hash. */
async function getHeadRef(repoPath) {
  try {
    const out = await git(["symbolic-ref", "--short", "HEAD"], repoPath);
    return out.trim();
  } catch {
    const out = await git(["rev-parse", "HEAD"], repoPath);
    return out.trim();
  }
}

// ---------------------------------------------------------------------------
// Repo discovery
// ---------------------------------------------------------------------------

function matchesFilter(relPath, filters) {
  if (!filters || filters.length === 0) return true;
  const lower = relPath.toLowerCase();
  return filters.some((f) => lower.includes(f.toLowerCase()));
}

export async function discoverRepos(filters) {
  const reposDir = getReposDir();
  const results = [];

  async function walk(dir, depth) {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const hasGit = entries.some(
      (e) => e.name === ".git" && (e.isDirectory() || e.isSymbolicLink())
    );
    if (hasGit) {
      const relPath = path.relative(reposDir, dir);
      if (matchesFilter(relPath, filters)) {
        results.push({ abs: dir, name: relPath });
      }
      return;
    }
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => walk(path.join(dir, e.name), depth + 1))
    );
  }

  await walk(reposDir, 0);
  return results;
}

// ---------------------------------------------------------------------------
// Search commands
// ---------------------------------------------------------------------------

function parseLogLines(repoName, stdout) {
  if (!stdout || !stdout.trim()) return [];
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commit, authorName, authorEmail, date, ...rest] = line.split("\t");
      return { repo: repoName, commit, authorName, authorEmail, date, subject: rest.join("\t") };
    });
}

async function searchAuthor(repos, pattern) {
  const all = await Promise.all(
    repos.map(async (repo) => {
      try {
        const out = await git(
          ["-C", repo.abs, "log", "--all", `--author=${pattern}`, "--format=%H%x09%an%x09%ae%x09%aI%x09%s"],
          repo.abs
        );
        return parseLogLines(repo.name, out);
      } catch { return []; }
    })
  );
  return all.flat();
}

async function searchMessage(repos, pattern) {
  const all = await Promise.all(
    repos.map(async (repo) => {
      try {
        const out = await git(
          ["-C", repo.abs, "log", "--all", `--grep=${pattern}`, "-i", "--format=%H%x09%an%x09%ae%x09%aI%x09%s"],
          repo.abs
        );
        return parseLogLines(repo.name, out);
      } catch { return []; }
    })
  );
  return all.flat();
}

async function searchFilepath(repos, pattern, allCommits) {
  const re = new RegExp(pattern, "i");
  const scope = allCommits ? "all-commits" : "HEAD";

  const all = await Promise.all(
    repos.map(async (repo) => {
      try {
        let files;
        if (allCommits) {
          const out = await git(
            ["-C", repo.abs, "log", "--all", "--pretty=format:", "--name-only", "--diff-filter=ACMRT"],
            repo.abs
          );
          files = [...new Set(out.split("\n").filter(Boolean))];
        } else {
          const head = await getHeadRef(repo.abs);
          const out = await git(
            ["-C", repo.abs, "ls-tree", "-r", "--name-only", head],
            repo.abs
          );
          files = out.split("\n").filter(Boolean);
        }
        return files
          .filter((f) => re.test(f))
          .map((filepath) => ({ repo: repo.name, filepath, scope }));
      } catch { return []; }
    })
  );
  return all.flat();
}

async function searchContentHead(repos, pattern) {
  const all = await Promise.all(
    repos.map(async (repo) => {
      try {
        const head = await getHeadRef(repo.abs);
        const out = await git(
          ["-C", repo.abs, "grep", "-n", "-i", pattern, head, "--"],
          repo.abs
        );
        if (!out || !out.trim()) return [];
        return out
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const firstColon = line.indexOf(":");
            const secondColon = line.indexOf(":", firstColon + 1);
            const thirdColon = line.indexOf(":", secondColon + 1);
            const file = line.substring(firstColon + 1, secondColon);
            const lineNum = line.substring(secondColon + 1, thirdColon);
            const content = line.substring(thirdColon + 1);
            return { repo: repo.name, file, line: lineNum, content, scope: "HEAD" };
          });
      } catch { return []; }
    })
  );
  return all.flat();
}

async function searchContentAllCommits(repos, pattern) {
  const all = await Promise.all(
    repos.map(async (repo) => {
      try {
        const out = await git(
          ["-C", repo.abs, "log", "--all", `-S${pattern}`, "--format=%H%x09%an%x09%aI%x09%s"],
          repo.abs
        );
        if (!out || !out.trim()) return [];

        const commits = out.trim().split("\n").filter(Boolean);

        const results = await Promise.all(
          commits.map(async (line) => {
            const [commit, author, date, ...rest] = line.split("\t");
            const subject = rest.join("\t");
            try {
              const filesOut = await git(
                ["-C", repo.abs, "diff-tree", "--no-commit-id", "-r", "--name-only", commit],
                repo.abs
              );
              const filesChanged = filesOut.trim().split("\n").filter(Boolean).join("|");
              return { repo: repo.name, commit, author, date, subject, filesChanged, scope: "all-commits" };
            } catch {
              return { repo: repo.name, commit, author, date, subject, filesChanged: "", scope: "all-commits" };
            }
          })
        );
        return results;
      } catch { return []; }
    })
  );
  return all.flat();
}

async function searchContent(repos, pattern, allCommits) {
  if (allCommits) return searchContentAllCommits(repos, pattern);
  return searchContentHead(repos, pattern);
}

// ---------------------------------------------------------------------------
// Per-repo search helpers (return results for a single repo)
// ---------------------------------------------------------------------------

async function searchAuthorOne(repo, pattern, { dateFrom, dateTo } = {}) {
  try {
    const out = await git(
      ["-C", repo.abs, "log", "--all", `--author=${pattern}`, ...dateArgs(dateFrom, dateTo), "--format=%H%x09%an%x09%ae%x09%aI%x09%s"],
      repo.abs
    );
    return parseLogLines(repo.name, out);
  } catch { return []; }
}

async function searchMessageOne(repo, pattern, { dateFrom, dateTo } = {}) {
  try {
    const out = await git(
      ["-C", repo.abs, "log", "--all", `--grep=${pattern}`, "-i", ...dateArgs(dateFrom, dateTo), "--format=%H%x09%an%x09%ae%x09%aI%x09%s"],
      repo.abs
    );
    return parseLogLines(repo.name, out);
  } catch { return []; }
}

async function searchFilepathOne(repo, pattern, allCommits, { dateFrom, dateTo } = {}) {
  const re = new RegExp(pattern, "i");
  const scope = allCommits ? "all-commits" : "HEAD";
  try {
    let files;
    if (allCommits) {
      const out = await git(
        ["-C", repo.abs, "log", "--all", ...dateArgs(dateFrom, dateTo), "--pretty=format:", "--name-only", "--diff-filter=ACMRT"],
        repo.abs
      );
      files = [...new Set(out.split("\n").filter(Boolean))];
    } else {
      const head = await getHeadRef(repo.abs);
      const out = await git(
        ["-C", repo.abs, "ls-tree", "-r", "--name-only", head],
        repo.abs
      );
      files = out.split("\n").filter(Boolean);
    }
    return files
      .filter((f) => re.test(f))
      .map((filepath) => ({ repo: repo.name, filepath, scope }));
  } catch { return []; }
}

async function searchContentHeadOne(repo, pattern, _dateOpts) {
  try {
    const head = await getHeadRef(repo.abs);
    const out = await git(
      ["-C", repo.abs, "grep", "-n", "-i", pattern, head, "--"],
      repo.abs
    );
    if (!out || !out.trim()) return [];
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const firstColon = line.indexOf(":");
        const secondColon = line.indexOf(":", firstColon + 1);
        const thirdColon = line.indexOf(":", secondColon + 1);
        const file = line.substring(firstColon + 1, secondColon);
        const lineNum = line.substring(secondColon + 1, thirdColon);
        const content = line.substring(thirdColon + 1);
        return { repo: repo.name, file, line: lineNum, content, scope: "HEAD" };
      });
  } catch { return []; }
}

async function searchContentAllCommitsOne(repo, pattern, { dateFrom, dateTo } = {}) {
  try {
    const out = await git(
      ["-C", repo.abs, "log", "--all", `-S${pattern}`, ...dateArgs(dateFrom, dateTo), "--format=%H%x09%an%x09%aI%x09%s"],
      repo.abs
    );
    if (!out || !out.trim()) return [];

    const commits = out.trim().split("\n").filter(Boolean);

    const results = await Promise.all(
      commits.map(async (line) => {
        const [commit, author, date, ...rest] = line.split("\t");
        const subject = rest.join("\t");
        try {
          const filesOut = await git(
            ["-C", repo.abs, "diff-tree", "--no-commit-id", "-r", "--name-only", commit],
            repo.abs
          );
          const filesChanged = filesOut.trim().split("\n").filter(Boolean).join("|");
          return { repo: repo.name, commit, author, date, subject, filesChanged, scope: "all-commits" };
        } catch {
          return { repo: repo.name, commit, author, date, subject, filesChanged: "", scope: "all-commits" };
        }
      })
    );
    return results;
  } catch { return []; }
}

function getSearchOneFunc(command, allCommits, dateOpts) {
  switch (command) {
    case "author":   return (repo, pattern) => searchAuthorOne(repo, pattern, dateOpts);
    case "message":  return (repo, pattern) => searchMessageOne(repo, pattern, dateOpts);
    case "filepath": return (repo, pattern) => searchFilepathOne(repo, pattern, allCommits, dateOpts);
    case "content":
      return allCommits
        ? (repo, pattern) => searchContentAllCommitsOne(repo, pattern, dateOpts)
        : (repo, pattern) => searchContentHeadOne(repo, pattern, dateOpts);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const VALID_COMMANDS = new Set(["author", "message", "filepath", "content"]);

export { VALID_COMMANDS };

export async function runSearch(command, repos, pattern, allCommits) {
  switch (command) {
    case "author":
      return searchAuthor(repos, pattern);
    case "message":
      return searchMessage(repos, pattern);
    case "filepath":
      return searchFilepath(repos, pattern, allCommits);
    case "content":
      return searchContent(repos, pattern, allCommits);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

/**
 * Streaming search: searches repos sequentially and calls back after each repo.
 *
 * @param {string}   command    - author | message | filepath | content
 * @param {Array}    repos      - list of { abs, name }
 * @param {string}   pattern    - search pattern
 * @param {boolean}  allCommits - search all commits vs HEAD
 * @param {object}   dateOpts
 * @param {string}   [dateOpts.dateFrom] - ISO date string (YYYY-MM-DD) for --after
 * @param {string}   [dateOpts.dateTo]   - ISO date string (YYYY-MM-DD) for --before
 * @param {object}   callbacks
 * @param {function} callbacks.onProgress - (searched, total, repoName) => void
 * @param {function} callbacks.onResults  - (results) => void  — results for one repo
 */
export async function runSearchStreaming(command, repos, pattern, allCommits, { dateFrom, dateTo } = {}, { onProgress, onResults }) {
  const searchOne = getSearchOneFunc(command, allCommits, { dateFrom, dateTo });
  const total = repos.length;
  const CONCURRENCY = 6;

  let searched = 0;

  // Process repos in batches for reasonable concurrency while still streaming
  for (let i = 0; i < total; i += CONCURRENCY) {
    const batch = repos.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (repo) => {
        const results = await searchOne(repo, pattern);
        return { repo, results };
      })
    );

    for (const { repo, results } of batchResults) {
      searched++;
      if (onProgress) onProgress(searched, total, repo.name);
      if (onResults && results.length > 0) onResults(results);
    }
  }
}
