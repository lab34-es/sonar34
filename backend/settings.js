/**
 * settings.js
 *
 * Persistent key-value settings stored in SQLite.
 * Falls back to process.env when no DB value exists.
 *
 * The settings exposed to the admin UI are listed in SETTING_DEFS.
 * The API token value is never returned in GET responses (write-only).
 */
import db from "./db.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Setting definitions – single source of truth
// ---------------------------------------------------------------------------

export const SETTING_DEFS = [
  {
    key: "BITBUCKET_EMAIL",
    label: "Bitbucket email",
    envVar: "BITBUCKET_EMAIL",
    default: "",
    secret: false,
  },
  {
    key: "BITBUCKET_API_TOKEN",
    label: "Bitbucket API token",
    envVar: "BITBUCKET_API_TOKEN",
    default: "",
    secret: true, // never returned in GET
  },
  {
    key: "BITBUCKET_WORKSPACE",
    label: "Bitbucket workspace slug",
    envVar: "BITBUCKET_WORKSPACE",
    default: "",
    secret: false,
  },
  {
    key: "MAX_REPOS_TO_FETCH",
    label: "Max repositories to fetch",
    envVar: "MAX_REPOS_TO_FETCH",
    default: "5000",
    secret: false,
  },
  {
    key: "REPOS_DIR",
    label: "Repos directory",
    envVar: "REPOS_DIR",
    default: path.resolve(path.join(__dirname, "..", "..", "repos")),
    secret: false,
  },
  {
    key: "PIP_AUDIT_PATH",
    label: "pip-audit executable path (Python security)",
    envVar: "PIP_AUDIT_PATH",
    default: "pip-audit",
    secret: false,
  },
  {
    key: "DEPENDENCY_CHECK_PATH",
    label: "OWASP dependency-check executable path (Java security)",
    envVar: "DEPENDENCY_CHECK_PATH",
    default: "",
    secret: false,
  },
];

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

const getStmt = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const upsertStmt = db.prepare(`
  INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
`);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a single setting value.
 * Priority: DB row > process.env > definition default.
 */
export function getSetting(key) {
  const row = getStmt.get(key);
  if (row) return row.value;

  const def = SETTING_DEFS.find((d) => d.key === key);
  if (def) {
    const envVal = process.env[def.envVar];
    if (envVal !== undefined && envVal !== "") return envVal;
    return def.default;
  }

  // Unknown key – try env directly
  return process.env[key] || "";
}

/**
 * Persist a setting to the DB.
 */
export function setSetting(key, value) {
  upsertStmt.run(key, value);
}

/**
 * Return all settings suitable for the admin GET endpoint.
 * Secrets are returned as a boolean `isSet` flag instead of the raw value.
 */
export function getAllSettings() {
  return SETTING_DEFS.map((def) => {
    const raw = getSetting(def.key);
    return {
      key: def.key,
      label: def.label,
      value: def.secret ? undefined : raw,
      isSet: def.secret ? raw !== "" : undefined,
      secret: def.secret,
    };
  });
}

/**
 * Bulk-update settings from a { key: value } object.
 * Only keys present in SETTING_DEFS are accepted.
 */
export function updateSettings(map) {
  const validKeys = new Set(SETTING_DEFS.map((d) => d.key));
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(map)) {
      if (!validKeys.has(key)) continue;
      // For secrets: skip if the caller sends an empty string (means "don't change")
      const def = SETTING_DEFS.find((d) => d.key === key);
      if (def?.secret && value === "") continue;
      upsertStmt.run(key, value);
    }
  });
  tx();
}
