/**
 * enrichWorker.js
 *
 * Background processors for repository enrichment:
 *   - "enrich-activity"      : Count commits per day over the last 14 days
 *   - "enrich-technologies"  : Detect technologies via Bitbucket API root file listing
 *   - "enrich-prs"           : Count open PRs (new vs old) via Bitbucket API
 *   - "enrich-security"      : Run npm audit on Node.js repos via Bitbucket API package.json
 */
import { Processor } from "@minnzen/sqliteq";
import { execFile } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import db from "./db.js";
import {
  enrichActivityQueue,
  enrichTechnologiesQueue,
  enrichPrsQueue,
  enrichSecurityQueue,
  enrichDependenciesQueue,
} from "./queue.js";
import { getSetting } from "./settings.js";
import { getIO } from "./io.js";
import {
  TECH_MARKERS,
  DIR_MARKERS,
  PKG_DEP_MARKERS,
  parseRequirementsTxt,
  parsePipfilePackages,
  parsePomXml,
  parseBuildGradle,
} from "./parsers.js";

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const markRunning = db.prepare(`
  UPDATE enrichment_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?
`);

const markDone = db.prepare(`
  UPDATE enrichment_jobs SET status = 'done', updated_at = datetime('now') WHERE id = ?
`);

const markFailed = db.prepare(`
  UPDATE enrichment_jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?
`);

const updateRepoActivity = db.prepare(`
  UPDATE repositories SET activity = ? WHERE name = ?
`);

const updateRepoTechnologies = db.prepare(`
  UPDATE repositories SET technologies = ? WHERE name = ?
`);

const updateRepoPrs = db.prepare(`
  UPDATE repositories SET open_prs = ? WHERE name = ?
`);

const updateRepoSecurityScannedBranch = db.prepare(`
  UPDATE repositories SET security_scanned_branch = ? WHERE name = ?
`);

const updateRepoDependenciesScannedBranch = db.prepare(`
  UPDATE repositories SET dependencies_scanned_branch = ? WHERE name = ?
`);

const getRepoPath = db.prepare(`
  SELECT path FROM repositories WHERE name = ?
`);

const getRepoTechnologies = db.prepare(`
  SELECT technologies FROM repositories WHERE name = ?
`);

const getEnrichJob = db.prepare(`SELECT * FROM enrichment_jobs WHERE id = ?`);

const deleteRepoSecurity = db.prepare(`DELETE FROM security WHERE repo_name = ?`);

const insertSecurityRow = db.prepare(`
  INSERT INTO security (repo_name, dependency, version, issue, severity, url)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertSecurityBatch = db.transaction((repoName, findings) => {
  deleteRepoSecurity.run(repoName);
  for (const f of findings) {
    insertSecurityRow.run(repoName, f.dependency, f.version, f.issue, f.severity, f.url || null);
  }
});

const deleteRepoDependencies = db.prepare(`DELETE FROM dependencies WHERE name = ?`);

const insertDependencyRow = db.prepare(`
  INSERT INTO dependencies (name, dependency, version)
  VALUES (?, ?, ?)
`);

const insertDependenciesBatch = db.transaction((repoName, deps) => {
  deleteRepoDependencies.run(repoName);
  for (const d of deps) {
    insertDependencyRow.run(repoName, d.dependency, d.version);
  }
});

function emitEnrichJobUpdate(jobId) {
  const io = getIO();
  if (io) {
    const row = getEnrichJob.get(jobId);
    if (row) io.emit("enrichment-job:update", row);
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getConfig() {
  return {
    reposDir: path.resolve(getSetting("REPOS_DIR")),
    email: getSetting("BITBUCKET_EMAIL"),
    apiToken: getSetting("BITBUCKET_API_TOKEN"),
    workspace: getSetting("BITBUCKET_WORKSPACE"),
  };
}

function buildAuthHeader(email, apiToken) {
  return "Basic " + Buffer.from(`${email}:${apiToken}`).toString("base64");
}

// ---------------------------------------------------------------------------
// Git helper
// ---------------------------------------------------------------------------

function gitExec(args, cwd) {
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

// ---------------------------------------------------------------------------
// Activity handler – git log commit counts per day over last 14 days
// ---------------------------------------------------------------------------

async function handleActivity(msg) {
  const { jobId, repoName } = msg.body;
  console.log(`[enrichWorker:activity] START jobId=${jobId} repo=${repoName}`);
  markRunning.run(jobId);
  emitEnrichJobUpdate(jobId);

  try {
    const row = getRepoPath.get(repoName);
    if (!row) throw new Error(`Repository not found in DB: ${repoName}`);

    const repoPath = row.path;
    console.log(`[enrichWorker:activity] repo path resolved: ${repoPath}`);

    // Fetch all latest commits from all remotes / branches
    try {
      console.log(`[enrichWorker:activity] fetching all remotes for ${repoName}...`);
      await gitExec(["fetch", "--all"], repoPath);
      console.log(`[enrichWorker:activity] fetch complete for ${repoName}`);
    } catch (fetchErr) {
      // fetch can fail if remote is unreachable – continue with local data
      console.log(`[enrichWorker:activity] fetch failed for ${repoName} (continuing with local data): ${fetchErr.message}`);
    }

    // Build date range: 14 days ago to today
    const now = new Date();
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10)); // "YYYY-MM-DD"
    }

    const sinceDate = days[0];
    console.log(`[enrichWorker:activity] querying git log since ${sinceDate} for ${repoName}`);

    // Get commit dates
    let stdout = "";
    try {
      stdout = await gitExec(
        ["log", "--all", "--format=%ad", "--date=format:%Y-%m-%d", `--since=${sinceDate}`],
        repoPath
      );
    } catch {
      // git log can fail on empty repos or repos with no commits
      console.log(`[enrichWorker:activity] git log failed for ${repoName} (empty repo?), defaulting to empty`);
      stdout = "";
    }

    // Count commits per day
    const counts = new Map(days.map((d) => [d, 0]));
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && counts.has(trimmed)) {
        counts.set(trimmed, counts.get(trimmed) + 1);
      }
    }

    const activity = days.map((d) => counts.get(d));
    const totalCommits = activity.reduce((a, b) => a + b, 0);
    console.log(`[enrichWorker:activity] DONE jobId=${jobId} repo=${repoName} totalCommits=${totalCommits} activity=[${activity.join(",")}]`);
    updateRepoActivity.run(JSON.stringify(activity), repoName);
    markDone.run(jobId);
    emitEnrichJobUpdate(jobId);
  } catch (err) {
    console.error(`[enrichWorker:activity] FAILED jobId=${jobId} repo=${repoName} error=${err.message}`);
    markFailed.run(err.message, jobId);
    emitEnrichJobUpdate(jobId);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Technologies handler – Bitbucket API root file listing
// ---------------------------------------------------------------------------

// TECH_MARKERS, DIR_MARKERS, and PKG_DEP_MARKERS are imported from parsers.js

/**
 * Fetch and parse package.json from the repo root, returning detected
 * technologies based on its dependencies.
 */
async function detectFromPackageJson(authHeader, workspace, repoSlug) {
  console.log(`[enrichWorker:technologies] fetching package.json for ${repoSlug} to detect frameworks...`);
  const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/src/HEAD/package.json`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader, Accept: "application/json" },
    });
    if (!res.ok) {
      console.log(`[enrichWorker:technologies] package.json fetch returned HTTP ${res.status} for ${repoSlug}`);
      return [];
    }

    const pkg = await res.json();
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };

    const detected = [];
    for (const [dep, label] of Object.entries(PKG_DEP_MARKERS)) {
      if (allDeps[dep]) detected.push(label);
    }
    console.log(`[enrichWorker:technologies] package.json deps detected for ${repoSlug}: [${detected.join(", ")}]`);
    return detected;
  } catch (err) {
    console.log(`[enrichWorker:technologies] package.json fetch/parse error for ${repoSlug}: ${err.message}`);
    return [];
  }
}

async function handleTechnologies(msg) {
  const { jobId, repoName } = msg.body;
  console.log(`[enrichWorker:technologies] START jobId=${jobId} repo=${repoName}`);
  markRunning.run(jobId);
  emitEnrichJobUpdate(jobId);

  try {
    // Skip if technology detection was already performed for this repository
    const techRow = getRepoTechnologies.get(repoName);
    if (techRow && techRow.technologies !== null) {
      console.log(`[enrichWorker:technologies] SKIPPED jobId=${jobId} repo=${repoName} (already detected)`);
      markDone.run(jobId);
      emitEnrichJobUpdate(jobId);
      return;
    }

    const cfg = getConfig();

    if (!cfg.email || !cfg.apiToken || !cfg.workspace) {
      throw new Error("Missing Bitbucket credentials. Configure them in Admin > Settings.");
    }

    const authHeader = buildAuthHeader(cfg.email, cfg.apiToken);

    // repoName is like "workspace/repo-slug" – extract the repo slug part
    const repoSlug = repoName.includes("/") ? repoName.split("/").slice(1).join("/") : repoName;

    const url = `https://api.bitbucket.org/2.0/repositories/${cfg.workspace}/${repoSlug}/src/HEAD/?pagelen=100`;
    console.log(`[enrichWorker:technologies] fetching root file listing for ${repoSlug}...`);

    const res = await fetch(url, {
      headers: { Authorization: authHeader, Accept: "application/json" },
    });

    if (!res.ok) {
      // 404 might mean empty repo or no HEAD – treat as no technologies
      if (res.status === 404) {
        console.log(`[enrichWorker:technologies] repo ${repoSlug} returned 404 (empty repo?), setting technologies=[]`);
        updateRepoTechnologies.run(JSON.stringify([]), repoName);
        markDone.run(jobId);
        emitEnrichJobUpdate(jobId);
        return;
      }
      throw new Error(`Bitbucket API error: HTTP ${res.status}`);
    }

    const data = await res.json();
    const detected = new Set();
    let hasPackageJson = false;
    const entryCount = (data.values || []).length;
    console.log(`[enrichWorker:technologies] received ${entryCount} root entries for ${repoSlug}`);

    for (const entry of data.values || []) {
      const entryPath = entry.path || entry.name || "";
      const basename = entryPath.split("/").pop();
      const isDir = entry.type === "commit_directory";

      if (isDir) {
        // Directory-based markers
        if (DIR_MARKERS[basename]) {
          detected.add(DIR_MARKERS[basename]);
        }
      } else {
        // Filename-based markers
        if (TECH_MARKERS[basename]) {
          detected.add(TECH_MARKERS[basename]);
        }
        // Suffix-based: .csproj → C#
        if (basename.endsWith(".csproj")) {
          detected.add("C#");
        }
        // Prefix-based: .aider* → Aider
        if (basename.startsWith(".aider")) {
          detected.add("Aider");
        }
        // eslint config variants: .eslintrc, .eslintrc.js, eslint.config.js, etc.
        if (basename === ".eslintrc" || basename.startsWith(".eslintrc.") || basename.startsWith("eslint.config.")) {
          detected.add("ESLint");
        }
        // prettier config variants
        if (basename === ".prettierrc" || basename.startsWith(".prettierrc.") || basename === "prettier.config.js" || basename === "prettier.config.ts") {
          detected.add("Prettier");
        }
        // stylelint config variants
        if (basename === ".stylelintrc" || basename.startsWith(".stylelintrc.")) {
          detected.add("Stylelint");
        }
        // Docusaurus
        if (basename.startsWith("docusaurus.config.")) {
          detected.add("Docusaurus");
        }
        // TypeDoc
        if (basename === "typedoc.json" || basename.startsWith("typedoc.config.")) {
          detected.add("TypeDoc");
        }
        // *.tf files → Terraform
        if (basename.endsWith(".tf")) {
          detected.add("Terraform");
        }
        // Track package.json presence for follow-up fetch
        if (basename === "package.json") {
          hasPackageJson = true;
        }
      }
    }

    // If package.json exists, inspect its dependencies for framework detection
    if (hasPackageJson) {
      console.log(`[enrichWorker:technologies] package.json found for ${repoSlug}, inspecting dependencies...`);
      const pkgTechs = await detectFromPackageJson(authHeader, cfg.workspace, repoSlug);
      for (const t of pkgTechs) detected.add(t);
    }

    const techList = [...detected].sort();
    console.log(`[enrichWorker:technologies] DONE jobId=${jobId} repo=${repoName} technologies=[${techList.join(", ")}]`);
    updateRepoTechnologies.run(JSON.stringify(techList), repoName);
    markDone.run(jobId);
    emitEnrichJobUpdate(jobId);
  } catch (err) {
    console.error(`[enrichWorker:technologies] FAILED jobId=${jobId} repo=${repoName} error=${err.message}`);
    markFailed.run(err.message, jobId);
    emitEnrichJobUpdate(jobId);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// PRs handler – Bitbucket API open pull requests
// ---------------------------------------------------------------------------

async function handlePrs(msg) {
  const { jobId, repoName } = msg.body;
  console.log(`[enrichWorker:prs] START jobId=${jobId} repo=${repoName}`);
  markRunning.run(jobId);
  emitEnrichJobUpdate(jobId);

  try {
    const cfg = getConfig();

    if (!cfg.email || !cfg.apiToken || !cfg.workspace) {
      throw new Error("Missing Bitbucket credentials. Configure them in Admin > Settings.");
    }

    const authHeader = buildAuthHeader(cfg.email, cfg.apiToken);
    const repoSlug = repoName.includes("/") ? repoName.split("/").slice(1).join("/") : repoName;

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    let newCount = 0;
    let oldCount = 0;
    let pageNum = 0;
    let url = `https://api.bitbucket.org/2.0/repositories/${cfg.workspace}/${repoSlug}/pullrequests?state=OPEN&pagelen=50`;

    while (url && url !== "null") {
      pageNum++;
      console.log(`[enrichWorker:prs] fetching PRs page ${pageNum} for ${repoSlug}...`);
      const res = await fetch(url, {
        headers: { Authorization: authHeader, Accept: "application/json" },
      });

      if (!res.ok) {
        if (res.status === 404) {
          // Repo might not exist on BB or PRs disabled
          console.log(`[enrichWorker:prs] repo ${repoSlug} returned 404, setting PRs to {new:0, old:0}`);
          updateRepoPrs.run(JSON.stringify({ new: 0, old: 0 }), repoName);
          markDone.run(jobId);
          emitEnrichJobUpdate(jobId);
          return;
        }
        throw new Error(`Bitbucket API error: HTTP ${res.status}`);
      }

      const data = await res.json();
      const pageSize = (data.values || []).length;
      console.log(`[enrichWorker:prs] page ${pageNum} returned ${pageSize} PRs for ${repoSlug}`);

      for (const pr of data.values || []) {
        const createdAt = new Date(pr.created_on);
        if (createdAt >= fourteenDaysAgo) {
          newCount++;
        } else {
          oldCount++;
        }
      }

      url = data.next || null;
    }

    console.log(`[enrichWorker:prs] DONE jobId=${jobId} repo=${repoName} new=${newCount} old=${oldCount} pages=${pageNum}`);
    updateRepoPrs.run(JSON.stringify({ new: newCount, old: oldCount }), repoName);
    markDone.run(jobId);
    emitEnrichJobUpdate(jobId);
  } catch (err) {
    console.error(`[enrichWorker:prs] FAILED jobId=${jobId} repo=${repoName} error=${err.message}`);
    markFailed.run(err.message, jobId);
    emitEnrichJobUpdate(jobId);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Security handler – multi-language: npm audit, pip-audit, OWASP dependency-check
// ---------------------------------------------------------------------------

function execCmd(cmd, args, cwd, env) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 120_000, maxBuffer: 20 * 1024 * 1024, env }, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr });
    });
  });
}

/**
 * Fetch a single file from a Bitbucket repo. Returns the response body as text
 * if found, or null if not found / error.
 */
async function fetchRepoFile(authHeader, workspace, repoSlug, filePath, ref = 'HEAD') {
  const encodedRef = ref.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/src/${encodedRef}/${encodeURIComponent(filePath)}`;
  console.log(`[enrichWorker] fetchRepoFile ${repoSlug}/${filePath} (ref: ${ref})`);
  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader, Accept: "application/json" },
    });
    if (!res.ok) {
      console.log(`[enrichWorker] fetchRepoFile ${repoSlug}/${filePath} -> HTTP ${res.status} (not found)`);
      return null;
    }
    console.log(`[enrichWorker] fetchRepoFile ${repoSlug}/${filePath} -> OK`);
    return await res.text();
  } catch (err) {
    console.log(`[enrichWorker] fetchRepoFile ${repoSlug}/${filePath} -> error: ${err.message}`);
    return null;
  }
}

/**
 * Fetch the root-level directory listing from Bitbucket (default branch).
 * Returns a Set of root-level file/directory basenames.
 * This allows callers to check which files exist before fetching them
 * individually, avoiding unnecessary 404 requests.
 */
async function listRootFiles(authHeader, workspace, repoSlug, ref = 'HEAD') {
  const encodedRef = ref.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/src/${encodedRef}/?pagelen=100`;
  console.log(`[enrichWorker] listRootFiles for ${repoSlug} (ref: ${ref})...`);
  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader, Accept: "application/json" },
    });
    if (!res.ok) {
      console.log(`[enrichWorker] listRootFiles ${repoSlug} -> HTTP ${res.status}`);
      return new Set();
    }
    const data = await res.json();
    const names = new Set();
    for (const entry of data.values || []) {
      const entryPath = entry.path || entry.name || "";
      const basename = entryPath.split("/").pop();
      if (basename) names.add(basename);
    }
    console.log(`[enrichWorker] listRootFiles ${repoSlug} -> ${names.size} entries`);
    return names;
  } catch (err) {
    console.log(`[enrichWorker] listRootFiles ${repoSlug} -> error: ${err.message}`);
    return new Set();
  }
}

// ---- Branch resolution helper ----

/**
 * Resolve the Bitbucket API ref based on the branch selection choice.
 * - 'default' or falsy -> ref='HEAD' (Bitbucket resolves to default branch)
 * - 'last_committed' -> find the branch with the most recent commit from local git clone
 *
 * Returns { ref, branchName } where ref is for Bitbucket API URLs and branchName
 * is the human-readable branch name to store in the DB.
 */
async function resolveRef(repoName, branchChoice) {
  if (!branchChoice || branchChoice === 'default') {
    return { ref: 'HEAD', branchName: null };
  }

  if (branchChoice === 'last_committed') {
    const row = getRepoPath.get(repoName);
    if (!row || !row.path) {
      console.log(`[enrichWorker] resolveRef: no local clone for ${repoName}, falling back to HEAD`);
      return { ref: 'HEAD', branchName: null };
    }

    try {
      const stdout = await new Promise((resolve, reject) => {
        execFile(
          'git',
          ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/remotes/origin/'],
          { cwd: row.path, timeout: 10_000 },
          (err, out) => {
            if (err) return reject(err);
            resolve(out.trim());
          }
        );
      });

      // Find the first remote branch that isn't origin/HEAD
      const branches = stdout.split('\n').filter(Boolean);
      const lastBranch = branches.find((b) => b !== 'origin/HEAD');
      if (lastBranch) {
        const branchName = lastBranch.replace(/^origin\//, '');

        // Resolve to commit hash so Bitbucket API URLs work for branch names containing "/"
        const commitHash = await new Promise((resolve, reject) => {
          execFile(
            'git',
            ['rev-parse', lastBranch],
            { cwd: row.path, timeout: 10_000 },
            (err, out) => {
              if (err) return reject(err);
              resolve(out.trim());
            }
          );
        });

        console.log(`[enrichWorker] resolveRef: last committed branch for ${repoName} is "${branchName}" (${commitHash})`);
        return { ref: commitHash, branchName };
      }
    } catch (err) {
      console.log(`[enrichWorker] resolveRef: git error for ${repoName}: ${err.message}, falling back to HEAD`);
    }

    return { ref: 'HEAD', branchName: null };
  }

  // Unknown choice — treat as default
  return { ref: 'HEAD', branchName: null };
}

// ---- Node.js security: npm audit ----

async function auditNodeSecurity(authHeader, workspace, repoSlug, rootFiles, ref = 'HEAD') {
  console.log(`[enrichWorker:security:node] checking package.json for ${repoSlug}...`);
  if (!rootFiles.has("package.json")) {
    console.log(`[enrichWorker:security:node] no package.json in root listing for ${repoSlug}, skipping Node audit`);
    return [];
  }
  const pkgJson = await fetchRepoFile(authHeader, workspace, repoSlug, "package.json", ref);
  if (!pkgJson) {
    console.log(`[enrichWorker:security:node] no package.json for ${repoSlug}, skipping Node audit`);
    return [];
  }

  let tmpDir = null;
  try {
    // Also fetch package-lock.json if available (only if it exists in root listing)
    const pkgLockJson = rootFiles.has("package-lock.json")
      ? await fetchRepoFile(authHeader, workspace, repoSlug, "package-lock.json", ref)
      : null;

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `massrepo-sec-node-`));
    console.log(`[enrichWorker:security:node] temp dir created: ${tmpDir}`);
    await fs.writeFile(path.join(tmpDir, "package.json"), pkgJson, "utf8");

    if (pkgLockJson) {
      console.log(`[enrichWorker:security:node] using existing package-lock.json for ${repoSlug}`);
      await fs.writeFile(path.join(tmpDir, "package-lock.json"), pkgLockJson, "utf8");
    } else {
      console.log(`[enrichWorker:security:node] no package-lock.json, running npm install --package-lock-only for ${repoSlug}...`);
      const npmEnv = { ...process.env, npm_config_update_notifier: "false" };
      await execCmd("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit"], tmpDir, npmEnv);
      console.log(`[enrichWorker:security:node] npm install --package-lock-only complete for ${repoSlug}`);
    }

    console.log(`[enrichWorker:security:node] running npm audit --json for ${repoSlug}...`);
    const npmEnv = { ...process.env, npm_config_update_notifier: "false" };
    const { stdout: auditOut } = await execCmd("npm", ["audit", "--json"], tmpDir, npmEnv);

    let auditData;
    try {
      auditData = JSON.parse(auditOut);
    } catch {
      console.log(`[enrichWorker:security:node] failed to parse npm audit JSON for ${repoSlug}`);
      return [];
    }

    const findings = [];
    const vulnerabilities = auditData.vulnerabilities || {};

    for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
      const severity = vuln.severity || "unknown";
      const titles = new Set();
      let advisoryUrl = null;
      for (const via of vuln.via || []) {
        if (typeof via === "string") {
          titles.add(via);
        } else {
          if (via.title) titles.add(via.title);
          if (!advisoryUrl && via.url) advisoryUrl = via.url;
        }
      }
      const issue = [...titles].join("; ") || pkgName;
      const version = vuln.range || null;
      findings.push({ dependency: pkgName, version, issue, severity, url: advisoryUrl });
    }
    console.log(`[enrichWorker:security:node] ${repoSlug}: found ${findings.length} Node vulnerabilities`);
    return findings;
  } finally {
    if (tmpDir) fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- Python security: pip-audit ----

async function auditPythonSecurity(authHeader, workspace, repoSlug, rootFiles, ref = 'HEAD') {
  console.log(`[enrichWorker:security:python] checking requirements.txt/Pipfile for ${repoSlug}...`);
  const hasReqTxt = rootFiles.has("requirements.txt");
  const hasPipfile = rootFiles.has("Pipfile");

  if (!hasReqTxt && !hasPipfile) {
    console.log(`[enrichWorker:security:python] no Python dependency files in root listing for ${repoSlug}, skipping`);
    return [];
  }

  // Try requirements.txt first, then Pipfile
  const reqTxt = hasReqTxt ? await fetchRepoFile(authHeader, workspace, repoSlug, "requirements.txt", ref) : null;
  const pipfile = !reqTxt && hasPipfile ? await fetchRepoFile(authHeader, workspace, repoSlug, "Pipfile", ref) : null;

  if (!reqTxt && !pipfile) {
    console.log(`[enrichWorker:security:python] no Python dependency files for ${repoSlug}, skipping`);
    return [];
  }

  const pipAuditPath = getSetting("PIP_AUDIT_PATH") || "pip-audit";
  console.log(`[enrichWorker:security:python] using pip-audit at: ${pipAuditPath} (source: ${reqTxt ? "requirements.txt" : "Pipfile"})`);

  let tmpDir = null;
  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `massrepo-sec-python-`));
    console.log(`[enrichWorker:security:python] temp dir created: ${tmpDir}`);

    let auditArgs;
    if (reqTxt) {
      await fs.writeFile(path.join(tmpDir, "requirements.txt"), reqTxt, "utf8");
      auditArgs = ["--format", "json", "--requirement", path.join(tmpDir, "requirements.txt")];
    } else {
      // Convert Pipfile [packages] to a temporary requirements.txt for pip-audit
      const deps = parsePipfilePackages(pipfile);
      console.log(`[enrichWorker:security:python] parsed ${deps.length} deps from Pipfile for ${repoSlug}`);
      const reqContent = deps.map((d) => d.version && d.version !== "*" ? `${d.dependency}${d.version}` : d.dependency).join("\n");
      await fs.writeFile(path.join(tmpDir, "requirements.txt"), reqContent, "utf8");
      auditArgs = ["--format", "json", "--requirement", path.join(tmpDir, "requirements.txt")];
    }

    console.log(`[enrichWorker:security:python] running pip-audit for ${repoSlug}...`);
    const { stdout: auditOut, err } = await execCmd(pipAuditPath, auditArgs, tmpDir);

    // pip-audit exits non-zero when vulns found – we always parse stdout
    let auditData;
    try {
      auditData = JSON.parse(auditOut);
    } catch {
      console.log(`[enrichWorker:security:python] failed to parse pip-audit JSON for ${repoSlug}`);
      return [];
    }

    const findings = [];

    // pip-audit JSON format: { "dependencies": [ { "name", "version", "vulns": [ { "id", "description", "fix_versions", "aliases" } ] } ] }
    for (const dep of auditData.dependencies || auditData || []) {
      for (const vuln of dep.vulns || []) {
        findings.push({
          dependency: dep.name,
          version: dep.version || null,
          issue: vuln.description || vuln.id || "Unknown vulnerability",
          severity: mapPipAuditSeverity(vuln),
          url: vuln.id ? `https://osv.dev/vulnerability/${vuln.id}` : null,
        });
      }
    }
    console.log(`[enrichWorker:security:python] ${repoSlug}: found ${findings.length} Python vulnerabilities`);
    return findings;
  } finally {
    if (tmpDir) fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * pip-audit doesn't always include severity. Try to infer from the ID prefix
 * or default to "unknown".
 */
function mapPipAuditSeverity(vuln) {
  // pip-audit >=2.6 may include "fix_versions" but not always severity.
  // If aliases include a CVE or GHSA, we can't determine severity without
  // a secondary lookup, so default to "unknown".
  return "unknown";
}

// parsePipfilePackages is imported from parsers.js

// ---- Java security: OWASP dependency-check ----

async function auditJavaSecurity(authHeader, workspace, repoSlug, rootFiles, ref = 'HEAD') {
  const depCheckPath = getSetting("DEPENDENCY_CHECK_PATH");
  if (!depCheckPath) {
    console.log(`[enrichWorker:security:java] DEPENDENCY_CHECK_PATH not configured, skipping Java audit for ${repoSlug}`);
    return []; // Not configured – skip Java security
  }

  console.log(`[enrichWorker:security:java] checking pom.xml/build.gradle for ${repoSlug}...`);
  const hasPom = rootFiles.has("pom.xml");
  const hasGradle = rootFiles.has("build.gradle");

  if (!hasPom && !hasGradle) {
    console.log(`[enrichWorker:security:java] no Java build files in root listing for ${repoSlug}, skipping`);
    return [];
  }

  const pomXml = hasPom ? await fetchRepoFile(authHeader, workspace, repoSlug, "pom.xml", ref) : null;
  const buildGradle = !pomXml && hasGradle ? await fetchRepoFile(authHeader, workspace, repoSlug, "build.gradle", ref) : null;

  if (!pomXml && !buildGradle) {
    console.log(`[enrichWorker:security:java] no Java build files for ${repoSlug}, skipping`);
    return [];
  }

  let tmpDir = null;
  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `massrepo-sec-java-`));
    console.log(`[enrichWorker:security:java] temp dir created: ${tmpDir} (source: ${pomXml ? "pom.xml" : "build.gradle"})`);

    if (pomXml) {
      await fs.writeFile(path.join(tmpDir, "pom.xml"), pomXml, "utf8");
    }
    if (buildGradle) {
      await fs.writeFile(path.join(tmpDir, "build.gradle"), buildGradle, "utf8");
    }

    console.log(`[enrichWorker:security:java] running OWASP dependency-check for ${repoSlug}...`);
    const reportFile = path.join(tmpDir, "dependency-check-report.json");
    const { stdout, stderr, err } = await execCmd(
      depCheckPath,
      [
        "--project", repoSlug,
        "--scan", tmpDir,
        "--format", "JSON",
        "--out", tmpDir,
        "--noupdate",
      ],
      tmpDir
    );

    if (err) {
      console.log(`[enrichWorker:security:java] dependency-check exited with error for ${repoSlug}: ${err.message}`);
    }

    // Read the JSON report
    let reportJson;
    try {
      const reportContent = await fs.readFile(reportFile, "utf8");
      reportJson = JSON.parse(reportContent);
    } catch {
      console.log(`[enrichWorker:security:java] failed to read/parse dependency-check report for ${repoSlug}`);
      return [];
    }

    const findings = [];
    const dependencies = reportJson.dependencies || [];

    for (const dep of dependencies) {
      const depName = dep.fileName || dep.filePath || "unknown";
      for (const vuln of dep.vulnerabilities || []) {
        const severity = (vuln.severity || "unknown").toLowerCase();
        findings.push({
          dependency: depName,
          version: dep.version || null,
          issue: vuln.description || vuln.name || "Unknown vulnerability",
          severity,
          url: vuln.references && vuln.references[0] ? vuln.references[0].url : null,
        });
      }
    }
    console.log(`[enrichWorker:security:java] ${repoSlug}: found ${findings.length} Java vulnerabilities`);
    return findings;
  } finally {
    if (tmpDir) fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- Orchestrator: run all applicable language audits ----

async function handleSecurity(msg) {
  const { jobId, repoName, branch } = msg.body;
  console.log(`[enrichWorker:security] START jobId=${jobId} repo=${repoName} branch=${branch}`);
  markRunning.run(jobId);
  emitEnrichJobUpdate(jobId);

  try {
    const cfg = getConfig();

    if (!cfg.email || !cfg.apiToken || !cfg.workspace) {
      throw new Error("Missing Bitbucket credentials. Configure them in Admin > Settings.");
    }

    // Resolve the branch choice to a Bitbucket API ref
    const { ref, branchName } = await resolveRef(repoName, branch);
    console.log(`[enrichWorker:security] ${repoName} using ref "${ref}" (branch choice: ${branch})`);

    const authHeader = buildAuthHeader(cfg.email, cfg.apiToken);
    const repoSlug = repoName.includes("/") ? repoName.split("/").slice(1).join("/") : repoName;

    // Fetch root file listing once to avoid per-file 404 probing
    const rootFiles = await listRootFiles(authHeader, cfg.workspace, repoSlug, ref);

    console.log(`[enrichWorker:security] running Node/Python/Java audits in parallel for ${repoSlug}...`);
    // Run all language audits in parallel – each returns [] if not applicable
    const [nodeFindings, pythonFindings, javaFindings] = await Promise.all([
      auditNodeSecurity(authHeader, cfg.workspace, repoSlug, rootFiles, ref),
      auditPythonSecurity(authHeader, cfg.workspace, repoSlug, rootFiles, ref),
      auditJavaSecurity(authHeader, cfg.workspace, repoSlug, rootFiles, ref),
    ]);

    const allFindings = [...nodeFindings, ...pythonFindings, ...javaFindings];
    console.log(`[enrichWorker:security] audits complete for ${repoSlug}: node=${nodeFindings.length} python=${pythonFindings.length} java=${javaFindings.length} total=${allFindings.length}`);

    // Persist findings (delete old + insert new in one transaction)
    console.log(`[enrichWorker:security] persisting ${allFindings.length} findings for ${repoName}`);
    insertSecurityBatch(repoName, allFindings);

    // Save which branch was scanned
    updateRepoSecurityScannedBranch.run(branchName || 'default', repoName);

    console.log(`[enrichWorker:security] DONE jobId=${jobId} repo=${repoName}`);
    markDone.run(jobId);
    emitEnrichJobUpdate(jobId);
  } catch (err) {
    console.error(`[enrichWorker:security] FAILED jobId=${jobId} repo=${repoName} error=${err.message}`);
    markFailed.run(err.message, jobId);
    emitEnrichJobUpdate(jobId);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Dependencies handler – multi-language: package.json, requirements.txt,
//   Pipfile, pom.xml, build.gradle
// ---------------------------------------------------------------------------

// ---- Node.js dependencies ----

async function extractNodeDeps(authHeader, workspace, repoSlug, rootFiles, ref = 'HEAD') {
  console.log(`[enrichWorker:deps:node] checking package.json for ${repoSlug}...`);
  if (!rootFiles.has("package.json")) {
    console.log(`[enrichWorker:deps:node] no package.json in root listing for ${repoSlug}, skipping`);
    return [];
  }
  const pkgJson = await fetchRepoFile(authHeader, workspace, repoSlug, "package.json", ref);
  if (!pkgJson) {
    console.log(`[enrichWorker:deps:node] no package.json for ${repoSlug}, skipping`);
    return [];
  }

  let pkg;
  try {
    pkg = JSON.parse(pkgJson);
  } catch {
    console.log(`[enrichWorker:deps:node] failed to parse package.json for ${repoSlug}`);
    return [];
  }

  const deps = [];
  for (const [dep, version] of Object.entries(pkg.dependencies || {})) {
    deps.push({ dependency: dep, version });
  }
  for (const [dep, version] of Object.entries(pkg.devDependencies || {})) {
    deps.push({ dependency: dep, version });
  }
  for (const [dep, version] of Object.entries(pkg.peerDependencies || {})) {
    deps.push({ dependency: dep, version });
  }
  console.log(`[enrichWorker:deps:node] ${repoSlug}: extracted ${deps.length} Node dependencies`);
  return deps;
}

// ---- Python dependencies ----

// parseRequirementsTxt is imported from parsers.js

async function extractPythonDeps(authHeader, workspace, repoSlug, rootFiles, ref = 'HEAD') {
  console.log(`[enrichWorker:deps:python] checking Python dependency files for ${repoSlug}...`);
  const hasReqTxt = rootFiles.has("requirements.txt");
  const hasPipfile = rootFiles.has("Pipfile");

  if (!hasReqTxt && !hasPipfile) {
    console.log(`[enrichWorker:deps:python] no Python dependency files in root listing for ${repoSlug}, skipping`);
    return [];
  }

  const deps = [];

  // Try requirements.txt
  const reqTxt = hasReqTxt ? await fetchRepoFile(authHeader, workspace, repoSlug, "requirements.txt", ref) : null;
  if (reqTxt) {
    const reqDeps = parseRequirementsTxt(reqTxt);
    console.log(`[enrichWorker:deps:python] ${repoSlug}: parsed ${reqDeps.length} deps from requirements.txt`);
    deps.push(...reqDeps);
  }

  // Try Pipfile (even if requirements.txt exists – might have different deps)
  const pipfile = hasPipfile ? await fetchRepoFile(authHeader, workspace, repoSlug, "Pipfile", ref) : null;
  if (pipfile) {
    const pipDeps = parsePipfilePackages(pipfile);
    console.log(`[enrichWorker:deps:python] ${repoSlug}: parsed ${pipDeps.length} deps from Pipfile`);
    // Avoid duplicates: only add deps not already present from requirements.txt
    const existing = new Set(deps.map((d) => d.dependency.toLowerCase()));
    let added = 0;
    for (const d of pipDeps) {
      if (!existing.has(d.dependency.toLowerCase())) {
        deps.push(d);
        added++;
      }
    }
    console.log(`[enrichWorker:deps:python] ${repoSlug}: added ${added} unique Pipfile deps (${pipDeps.length - added} duplicates skipped)`);
  }

  if (!reqTxt && !pipfile) {
    console.log(`[enrichWorker:deps:python] no Python dependency files for ${repoSlug}, skipping`);
  } else {
    console.log(`[enrichWorker:deps:python] ${repoSlug}: total ${deps.length} Python dependencies`);
  }
  return deps;
}

// ---- Java dependencies ----

// parsePomXml is imported from parsers.js

// parseBuildGradle is imported from parsers.js

async function extractJavaDeps(authHeader, workspace, repoSlug, rootFiles, ref = 'HEAD') {
  console.log(`[enrichWorker:deps:java] checking Java build files for ${repoSlug}...`);
  const hasPom = rootFiles.has("pom.xml");
  const hasGradle = rootFiles.has("build.gradle");

  if (!hasPom && !hasGradle) {
    console.log(`[enrichWorker:deps:java] no Java build files in root listing for ${repoSlug}, skipping`);
    return [];
  }

  const deps = [];

  // Try pom.xml
  const pomXml = hasPom ? await fetchRepoFile(authHeader, workspace, repoSlug, "pom.xml", ref) : null;
  if (pomXml) {
    const pomDeps = parsePomXml(pomXml);
    console.log(`[enrichWorker:deps:java] ${repoSlug}: parsed ${pomDeps.length} deps from pom.xml`);
    deps.push(...pomDeps);
  }

  // Try build.gradle
  const buildGradle = hasGradle ? await fetchRepoFile(authHeader, workspace, repoSlug, "build.gradle", ref) : null;
  if (buildGradle) {
    const gradleDeps = parseBuildGradle(buildGradle);
    console.log(`[enrichWorker:deps:java] ${repoSlug}: parsed ${gradleDeps.length} deps from build.gradle`);
    // Avoid duplicates if both pom.xml and build.gradle exist (unusual but possible)
    const existing = new Set(deps.map((d) => d.dependency.toLowerCase()));
    let added = 0;
    for (const d of gradleDeps) {
      if (!existing.has(d.dependency.toLowerCase())) {
        deps.push(d);
        added++;
      }
    }
    if (pomXml) {
      console.log(`[enrichWorker:deps:java] ${repoSlug}: added ${added} unique Gradle deps (${gradleDeps.length - added} duplicates skipped)`);
    }
  }

  if (!pomXml && !buildGradle) {
    console.log(`[enrichWorker:deps:java] no Java build files for ${repoSlug}, skipping`);
  } else {
    console.log(`[enrichWorker:deps:java] ${repoSlug}: total ${deps.length} Java dependencies`);
  }
  return deps;
}

// ---- Orchestrator: extract dependencies from all languages ----

async function handleDependencies(msg) {
  const { jobId, repoName, branch } = msg.body;
  console.log(`[enrichWorker:deps] START jobId=${jobId} repo=${repoName} branch=${branch}`);
  markRunning.run(jobId);
  emitEnrichJobUpdate(jobId);

  try {
    const cfg = getConfig();

    if (!cfg.email || !cfg.apiToken || !cfg.workspace) {
      throw new Error("Missing Bitbucket credentials. Configure them in Admin > Settings.");
    }

    // Resolve the branch choice to a Bitbucket API ref
    const { ref, branchName } = await resolveRef(repoName, branch);
    console.log(`[enrichWorker:deps] ${repoName} using ref "${ref}" (branch choice: ${branch})`);

    const authHeader = buildAuthHeader(cfg.email, cfg.apiToken);
    const repoSlug = repoName.includes("/") ? repoName.split("/").slice(1).join("/") : repoName;

    // Fetch root file listing once to avoid per-file 404 probing
    const rootFiles = await listRootFiles(authHeader, cfg.workspace, repoSlug, ref);

    console.log(`[enrichWorker:deps] running Node/Python/Java extractors in parallel for ${repoSlug}...`);
    // Run all language extractors in parallel
    const [nodeDeps, pythonDeps, javaDeps] = await Promise.all([
      extractNodeDeps(authHeader, cfg.workspace, repoSlug, rootFiles, ref),
      extractPythonDeps(authHeader, cfg.workspace, repoSlug, rootFiles, ref),
      extractJavaDeps(authHeader, cfg.workspace, repoSlug, rootFiles, ref),
    ]);

    const allDeps = [...nodeDeps, ...pythonDeps, ...javaDeps];
    console.log(`[enrichWorker:deps] extraction complete for ${repoSlug}: node=${nodeDeps.length} python=${pythonDeps.length} java=${javaDeps.length} total=${allDeps.length}`);

    // Persist (delete old + insert new in one transaction)
    console.log(`[enrichWorker:deps] persisting ${allDeps.length} dependencies for ${repoName}`);
    insertDependenciesBatch(repoName, allDeps);

    // Save which branch was scanned
    updateRepoDependenciesScannedBranch.run(branchName || 'default', repoName);

    console.log(`[enrichWorker:deps] DONE jobId=${jobId} repo=${repoName}`);
    markDone.run(jobId);
    emitEnrichJobUpdate(jobId);
  } catch (err) {
    console.error(`[enrichWorker:deps] FAILED jobId=${jobId} repo=${repoName} error=${err.message}`);
    markFailed.run(err.message, jobId);
    emitEnrichJobUpdate(jobId);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Processors
// ---------------------------------------------------------------------------

export const activityProcessor = new Processor(enrichActivityQueue, {
  handler: handleActivity,
  pollInterval: 200,
  concurrency: 10,
  onError(err, ctx) {
    console.error("[enrichWorker:activity] error:", err.message);
  },
});

export const technologiesProcessor = new Processor(enrichTechnologiesQueue, {
  handler: handleTechnologies,
  pollInterval: 200,
  concurrency: 5,
  onError(err, ctx) {
    console.error("[enrichWorker:technologies] error:", err.message);
  },
});

export const prsProcessor = new Processor(enrichPrsQueue, {
  handler: handlePrs,
  pollInterval: 200,
  concurrency: 3, // lower concurrency to avoid API rate limits
  onError(err, ctx) {
    console.error("[enrichWorker:prs] error:", err.message);
  },
});

export const securityProcessor = new Processor(enrichSecurityQueue, {
  handler: handleSecurity,
  pollInterval: 200,
  concurrency: 3, // npm install + audit is CPU/network heavy
  onError(err, ctx) {
    console.error("[enrichWorker:security] error:", err.message);
  },
});

export const dependenciesProcessor = new Processor(enrichDependenciesQueue, {
  handler: handleDependencies,
  pollInterval: 200,
  concurrency: 5,
  onError(err, ctx) {
    console.error("[enrichWorker:dependencies] error:", err.message);
  },
});

export function startEnrichWorkers() {
  activityProcessor.start();
  technologiesProcessor.start();
  prsProcessor.start();
  securityProcessor.start();
  dependenciesProcessor.start();
  console.log("[enrichWorker] started (activity=10, technologies=5, prs=3, security=3, dependencies=5)");
}

export async function stopEnrichWorkers() {
  await activityProcessor.stop();
  await technologiesProcessor.stop();
  await prsProcessor.stop();
  await securityProcessor.stop();
  await dependenciesProcessor.stop();
  console.log("[enrichWorker] stopped");
}
