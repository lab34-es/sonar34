import { describe, it, expect, beforeEach } from "vitest";
import db from "../db.js";
import { getSetting, setSetting, getAllSettings, updateSettings, SETTING_DEFS } from "../settings.js";

describe("settings", () => {
  beforeEach(() => {
    // Clear all settings before each test
    db.exec("DELETE FROM settings");
  });

  describe("getSetting", () => {
    it("returns the default value for a known key with no DB/env value", () => {
      const value = getSetting("MAX_REPOS_TO_FETCH");
      expect(value).toBe("5000");
    });

    it("returns DB value when set", () => {
      setSetting("MAX_REPOS_TO_FETCH", "100");
      expect(getSetting("MAX_REPOS_TO_FETCH")).toBe("100");
    });

    it("returns env value when no DB value exists", () => {
      const key = "BITBUCKET_EMAIL";
      const originalEnv = process.env[key];
      process.env[key] = "test@example.com";
      try {
        expect(getSetting(key)).toBe("test@example.com");
      } finally {
        if (originalEnv === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = originalEnv;
        }
      }
    });

    it("DB value takes priority over env", () => {
      const key = "BITBUCKET_EMAIL";
      const originalEnv = process.env[key];
      process.env[key] = "env@example.com";
      setSetting(key, "db@example.com");
      try {
        expect(getSetting(key)).toBe("db@example.com");
      } finally {
        if (originalEnv === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = originalEnv;
        }
      }
    });

    it("returns empty string for unknown keys with no env", () => {
      expect(getSetting("TOTALLY_UNKNOWN_KEY")).toBe("");
    });
  });

  describe("setSetting", () => {
    it("persists a value to the database", () => {
      setSetting("MAX_REPOS_TO_FETCH", "200");
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("MAX_REPOS_TO_FETCH");
      expect(row.value).toBe("200");
    });

    it("upserts on conflict", () => {
      setSetting("MAX_REPOS_TO_FETCH", "100");
      setSetting("MAX_REPOS_TO_FETCH", "200");
      const rows = db.prepare("SELECT value FROM settings WHERE key = ?").all("MAX_REPOS_TO_FETCH");
      expect(rows).toHaveLength(1);
      expect(rows[0].value).toBe("200");
    });
  });

  describe("getAllSettings", () => {
    it("returns all defined settings", () => {
      const settings = getAllSettings();
      expect(settings).toHaveLength(SETTING_DEFS.length);
    });

    it("returns value for non-secret settings", () => {
      setSetting("MAX_REPOS_TO_FETCH", "999");
      const settings = getAllSettings();
      const maxRepos = settings.find((s) => s.key === "MAX_REPOS_TO_FETCH");
      expect(maxRepos.value).toBe("999");
      expect(maxRepos.secret).toBe(false);
    });

    it("redacts secret settings (returns isSet flag instead of value)", () => {
      setSetting("BITBUCKET_API_TOKEN", "my-secret-token");
      const settings = getAllSettings();
      const token = settings.find((s) => s.key === "BITBUCKET_API_TOKEN");
      expect(token.value).toBeUndefined();
      expect(token.isSet).toBe(true);
      expect(token.secret).toBe(true);
    });

    it("shows isSet=false for unset secret settings", () => {
      const settings = getAllSettings();
      const token = settings.find((s) => s.key === "BITBUCKET_API_TOKEN");
      expect(token.secret).toBe(true);
      expect(token.value).toBeUndefined();
      // With no DB row and no env var, isSet should be false
      expect(token.isSet).toBe(false);
    });
  });

  describe("updateSettings", () => {
    it("updates multiple settings at once", () => {
      updateSettings({
        MAX_REPOS_TO_FETCH: "1000",
        BITBUCKET_EMAIL: "admin@example.com",
      });
      expect(getSetting("MAX_REPOS_TO_FETCH")).toBe("1000");
      expect(getSetting("BITBUCKET_EMAIL")).toBe("admin@example.com");
    });

    it("ignores unknown keys", () => {
      const countBefore = db.prepare("SELECT COUNT(*) as cnt FROM settings").get().cnt;
      updateSettings({ UNKNOWN_KEY: "value" });
      const countAfter = db.prepare("SELECT COUNT(*) as cnt FROM settings").get().cnt;
      expect(countAfter).toBe(countBefore);
    });

    it("skips empty string for secret settings", () => {
      setSetting("BITBUCKET_API_TOKEN", "original-token");
      updateSettings({ BITBUCKET_API_TOKEN: "" });
      expect(getSetting("BITBUCKET_API_TOKEN")).toBe("original-token");
    });

    it("updates secret settings with non-empty values", () => {
      updateSettings({ BITBUCKET_API_TOKEN: "new-token" });
      expect(getSetting("BITBUCKET_API_TOKEN")).toBe("new-token");
    });
  });

  describe("SETTING_DEFS", () => {
    it("has required properties for each definition", () => {
      for (const def of SETTING_DEFS) {
        expect(def).toHaveProperty("key");
        expect(def).toHaveProperty("label");
        expect(def).toHaveProperty("envVar");
        expect(def).toHaveProperty("default");
        expect(def).toHaveProperty("secret");
        expect(typeof def.key).toBe("string");
        expect(typeof def.label).toBe("string");
        expect(typeof def.secret).toBe("boolean");
      }
    });

    it("only BITBUCKET_API_TOKEN is marked as secret", () => {
      const secrets = SETTING_DEFS.filter((d) => d.secret);
      expect(secrets).toHaveLength(1);
      expect(secrets[0].key).toBe("BITBUCKET_API_TOKEN");
    });
  });
});
