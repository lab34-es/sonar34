/**
 * parsers.js
 *
 * Pure parsing functions extracted from enrichWorker.js to enable
 * isolated unit testing. No side effects, no I/O, no DB access.
 */

// ---------------------------------------------------------------------------
// Technology detection markers
// ---------------------------------------------------------------------------

/** Map of root-level filenames to technology labels. */
export const TECH_MARKERS = {
  // --- Languages / Runtimes ---
  "package.json":       "NodeJS",
  "requirements.txt":   "Python",
  "Pipfile":            "Python",
  "pyproject.toml":     "Python",
  "setup.py":           "Python",
  "go.mod":             "Go",
  "pom.xml":            "Java",
  "build.gradle":       "Java",
  "build.gradle.kts":   "Java",
  "Gemfile":            "Ruby",
  "Cargo.toml":         "Rust",
  "composer.json":      "PHP",
  "mix.exs":            "Elixir",
  "pubspec.yaml":       "Dart",
  "Package.swift":      "Swift",
  "CMakeLists.txt":     "C/C++",
  "Makefile":           "Make",
  "tsconfig.json":      "TypeScript",
  "deno.json":          "Deno",
  "deno.jsonc":         "Deno",
  "bun.lockb":          "Bun",

  // --- Containerisation ---
  "Dockerfile":              "Docker",
  "docker-compose.yml":      "Docker",
  "docker-compose.yaml":     "Docker",

  // --- CI/CD ---
  "bitbucket-pipelines.yml": "Bitbucket Pipelines",
  "Jenkinsfile":             "Jenkins",
  ".travis.yml":             "Travis CI",
  "azure-pipelines.yml":     "Azure DevOps",
  ".gitlab-ci.yml":          "GitLab CI",

  // --- Frontend frameworks (config-file based) ---
  "angular.json":            "Angular",
  "next.config.js":          "Next.js",
  "next.config.ts":          "Next.js",
  "next.config.mjs":         "Next.js",
  "nuxt.config.js":          "Nuxt.js",
  "nuxt.config.ts":          "Nuxt.js",
  "svelte.config.js":        "Svelte",
  "svelte.config.ts":        "Svelte",
  "remix.config.js":         "Remix",
  "vite.config.js":          "Vite",
  "vite.config.ts":          "Vite",
  "vite.config.mjs":         "Vite",

  // --- Testing ---
  "jest.config.js":          "Jest",
  "jest.config.ts":          "Jest",
  "jest.config.mjs":         "Jest",
  "cypress.config.js":       "Cypress",
  "cypress.config.ts":       "Cypress",
  "playwright.config.js":    "Playwright",
  "playwright.config.ts":    "Playwright",

  // --- Infrastructure / Cloud ---
  "serverless.yml":          "Serverless Framework",
  "serverless.ts":           "Serverless Framework",
  "cdk.json":                "AWS CDK",
  "Chart.yaml":              "Helm",
  "fly.toml":                "Fly.io",
  "render.yaml":             "Render",
  "railway.toml":            "Railway",
  "vercel.json":             "Vercel",
  "netlify.toml":            "Netlify",

  // --- Package managers / Monorepo ---
  "pnpm-lock.yaml":          "pnpm",
  "yarn.lock":               "Yarn",
  "package-lock.json":       "npm",
  "lerna.json":              "Lerna",
  "nx.json":                 "Nx",
  "turbo.json":              "Turborepo",

  // --- ORMs / Databases ---
  "schema.prisma":           "Prisma",
  "drizzle.config.js":       "Drizzle",
  "drizzle.config.ts":       "Drizzle",
  "alembic.ini":             "Alembic",

  // --- Code quality ---
  "biome.json":              "Biome",
  "sonar-project.properties": "SonarQube",

  // --- Documentation ---
  "mkdocs.yml":              "MkDocs",

  // --- LLM / AI Tooling ---
  ".clinerules":             "Cline",
  ".cursorrules":            "Cursor",
  "CLAUDE.md":               "Claude",
  ".windsurfrules":          "Windsurf",
  "kodu.json":               "Kodu",

  // --- Mobile ---
  "capacitor.config.js":     "Capacitor",
  "capacitor.config.ts":     "Capacitor",
  "capacitor.config.json":   "Capacitor",
};

/** Map of root-level directory names to technology labels. */
export const DIR_MARKERS = {
  ".github":     "GitHub Actions",
  ".circleci":   "CircleCI",
  ".rearch":     "ReArch",
  "terraform":   "Terraform",
  ".cursor":     "Cursor",
  ".claude":     "Claude",
  ".copilot":    "GitHub Copilot",
  ".continue":   "Continue.dev",
  ".storybook":  "Storybook",
  "android":     "Android",
  "ios":         "iOS",
  "prisma":      "Prisma",
  ".vercel":     "Vercel",
  ".platform":   "Platform.sh",
};

/** package.json dependency keys -> technology labels. */
export const PKG_DEP_MARKERS = {
  "react":              "React",
  "vue":                "Vue",
  "@angular/core":      "Angular",
  "next":               "Next.js",
  "nuxt":               "Nuxt.js",
  "svelte":             "Svelte",
  "@remix-run/react":   "Remix",
  "expo":               "Expo",
  "electron":           "Electron",
  "astro":              "Astro",
  "gatsby":             "Gatsby",
};

// ---------------------------------------------------------------------------
// requirements.txt parser
// ---------------------------------------------------------------------------

/**
 * Parse requirements.txt content into dependency list.
 * Handles: pkg==1.0, pkg>=1.0, pkg~=1.0, pkg!=1.0, pkg, -r other.txt (ignored),
 * comments, blank lines, environment markers (;), extras ([extra]).
 */
export function parseRequirementsTxt(content) {
  const deps = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;

    // Strip inline comments
    const noComment = line.split("#")[0].trim();
    // Strip environment markers (e.g. ; python_version >= "3.6")
    const noMarker = noComment.split(";")[0].trim();
    if (!noMarker) continue;

    // Match: name[extras]<version_spec>
    const match = noMarker.match(/^([a-zA-Z0-9_.-]+(?:\[[^\]]*\])?)(.*)$/);
    if (!match) continue;

    const depName = match[1].replace(/\[.*\]/, "").trim();
    const versionSpec = match[2].trim() || "*";
    deps.push({ dependency: depName, version: versionSpec });
  }
  return deps;
}

// ---------------------------------------------------------------------------
// Pipfile parser
// ---------------------------------------------------------------------------

/**
 * Parse Pipfile [packages] and [dev-packages] sections into dependency list.
 */
export function parsePipfilePackages(content) {
  const deps = [];
  let inSection = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "[packages]" || trimmed === "[dev-packages]") {
      inSection = true;
      continue;
    }
    if (trimmed.startsWith("[")) {
      inSection = false;
      continue;
    }
    if (!inSection || !trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const name = trimmed.slice(0, eqIdx).trim().replace(/^["']|["']$/g, "");
    let value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    // Pipfile uses: dep = "==1.0" or dep = "*" or dep = {version = ">=1.0"}
    if (value.startsWith("{")) {
      const vMatch = value.match(/version\s*=\s*["']([^"']+)["']/);
      value = vMatch ? vMatch[1] : "*";
    }
    deps.push({ dependency: name, version: value });
  }
  return deps;
}

// ---------------------------------------------------------------------------
// pom.xml parser
// ---------------------------------------------------------------------------

/**
 * Parse pom.xml content to extract <dependency> blocks.
 * Uses simple regex parsing (no XML parser needed for this use case).
 * Returns: [{ dependency: "groupId:artifactId", version: "1.0" }]
 */
export function parsePomXml(content) {
  const deps = [];
  // Match <dependency> blocks
  const depRegex = /<dependency>\s*([\s\S]*?)\s*<\/dependency>/gi;
  let match;
  while ((match = depRegex.exec(content)) !== null) {
    const block = match[1];
    const groupId = (block.match(/<groupId>\s*([^<]+)\s*<\/groupId>/) || [])[1]?.trim();
    const artifactId = (block.match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/) || [])[1]?.trim();
    const version = (block.match(/<version>\s*([^<]+)\s*<\/version>/) || [])[1]?.trim();

    if (groupId && artifactId) {
      deps.push({
        dependency: `${groupId}:${artifactId}`,
        version: version || null,
      });
    }
  }
  return deps;
}

// ---------------------------------------------------------------------------
// build.gradle parser
// ---------------------------------------------------------------------------

/**
 * Parse build.gradle content to extract dependencies.
 * Handles common patterns:
 *   implementation 'group:name:version'
 *   implementation "group:name:version"
 *   api 'group:name:version'
 *   compile 'group:name:version'
 *   testImplementation 'group:name:version'
 *   implementation group: 'g', name: 'n', version: 'v'
 */
export function parseBuildGradle(content) {
  const deps = [];

  // Pattern 1: configuration 'group:name:version' or "group:name:version"
  const shortRegex = /(?:implementation|api|compile|compileOnly|runtimeOnly|testImplementation|testCompile|classpath|annotationProcessor)\s+['"]([^'"]+)['"]/gi;
  let match;
  while ((match = shortRegex.exec(content)) !== null) {
    const parts = match[1].split(":");
    if (parts.length >= 2) {
      const dep = parts.length >= 3 ? `${parts[0]}:${parts[1]}` : match[1];
      const version = parts.length >= 3 ? parts[2] : null;
      deps.push({ dependency: dep, version });
    }
  }

  // Pattern 2: configuration group: 'g', name: 'n', version: 'v'
  const mapRegex = /(?:implementation|api|compile|compileOnly|runtimeOnly|testImplementation|testCompile|classpath|annotationProcessor)\s+group:\s*['"]([^'"]+)['"]\s*,\s*name:\s*['"]([^'"]+)['"]\s*(?:,\s*version:\s*['"]([^'"]+)['"])?/gi;
  while ((match = mapRegex.exec(content)) !== null) {
    deps.push({
      dependency: `${match[1]}:${match[2]}`,
      version: match[3] || null,
    });
  }

  return deps;
}

// ---------------------------------------------------------------------------
// git log output parser
// ---------------------------------------------------------------------------

/**
 * Parse git log output lines (tab-delimited) into structured result objects.
 */
export function parseLogLines(repoName, stdout) {
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

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

/**
 * Check if a relative path matches any of the filter strings (case-insensitive).
 */
export function matchesFilter(relPath, filters) {
  if (!filters || filters.length === 0) return true;
  const lower = relPath.toLowerCase();
  return filters.some((f) => lower.includes(f.toLowerCase()));
}

/**
 * Build git log date-range flags from optional dateFrom / dateTo strings (YYYY-MM-DD).
 */
export function dateArgs(dateFrom, dateTo) {
  const args = [];
  if (dateFrom) args.push(`--after=${dateFrom}`);
  if (dateTo) args.push(`--before=${dateTo}T23:59:59`);
  return args;
}
