import { describe, it, expect } from "vitest";
import {
  parseRequirementsTxt,
  parsePipfilePackages,
  parsePomXml,
  parseBuildGradle,
  parseLogLines,
  matchesFilter,
  dateArgs,
  TECH_MARKERS,
  DIR_MARKERS,
  PKG_DEP_MARKERS,
} from "../parsers.js";

// ---------------------------------------------------------------------------
// parseRequirementsTxt
// ---------------------------------------------------------------------------

describe("parseRequirementsTxt", () => {
  it("parses simple pinned dependencies", () => {
    const content = "flask==2.3.0\nrequests==2.31.0\n";
    const deps = parseRequirementsTxt(content);
    expect(deps).toEqual([
      { dependency: "flask", version: "==2.3.0" },
      { dependency: "requests", version: "==2.31.0" },
    ]);
  });

  it("parses version ranges", () => {
    const content = "django>=4.0,<5.0\nnumpy~=1.24\n";
    const deps = parseRequirementsTxt(content);
    expect(deps).toEqual([
      { dependency: "django", version: ">=4.0,<5.0" },
      { dependency: "numpy", version: "~=1.24" },
    ]);
  });

  it("handles packages without version specifiers", () => {
    const content = "boto3\npandas\n";
    const deps = parseRequirementsTxt(content);
    expect(deps).toEqual([
      { dependency: "boto3", version: "*" },
      { dependency: "pandas", version: "*" },
    ]);
  });

  it("ignores comments and blank lines", () => {
    const content = "# This is a comment\nflask==2.3.0\n\n# Another comment\nrequests==2.31.0\n";
    const deps = parseRequirementsTxt(content);
    expect(deps).toHaveLength(2);
    expect(deps[0].dependency).toBe("flask");
    expect(deps[1].dependency).toBe("requests");
  });

  it("ignores -r and -e lines", () => {
    const content = "-r base.txt\n-e git+https://github.com/foo/bar.git\nflask==2.3.0\n";
    const deps = parseRequirementsTxt(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].dependency).toBe("flask");
  });

  it("strips inline comments", () => {
    const content = "flask==2.3.0  # web framework\n";
    const deps = parseRequirementsTxt(content);
    expect(deps).toEqual([
      { dependency: "flask", version: "==2.3.0" },
    ]);
  });

  it("strips environment markers", () => {
    const content = 'pywin32>=300; sys_platform == "win32"\n';
    const deps = parseRequirementsTxt(content);
    expect(deps).toEqual([
      { dependency: "pywin32", version: ">=300" },
    ]);
  });

  it("strips extras from package names", () => {
    const content = "requests[security]>=2.20.0\n";
    const deps = parseRequirementsTxt(content);
    expect(deps).toEqual([
      { dependency: "requests", version: ">=2.20.0" },
    ]);
  });

  it("returns empty array for empty content", () => {
    expect(parseRequirementsTxt("")).toEqual([]);
    expect(parseRequirementsTxt("\n\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parsePipfilePackages
// ---------------------------------------------------------------------------

describe("parsePipfilePackages", () => {
  it("parses [packages] section", () => {
    const content = `
[packages]
flask = "==2.3.0"
requests = "*"
`;
    const deps = parsePipfilePackages(content);
    expect(deps).toEqual([
      { dependency: "flask", version: "==2.3.0" },
      { dependency: "requests", version: "*" },
    ]);
  });

  it("parses [dev-packages] section", () => {
    const content = `
[dev-packages]
pytest = ">=7.0"
black = "*"
`;
    const deps = parsePipfilePackages(content);
    expect(deps).toEqual([
      { dependency: "pytest", version: ">=7.0" },
      { dependency: "black", version: "*" },
    ]);
  });

  it("parses both [packages] and [dev-packages]", () => {
    const content = `
[packages]
flask = "==2.3.0"

[dev-packages]
pytest = ">=7.0"

[requires]
python_version = "3.11"
`;
    const deps = parsePipfilePackages(content);
    expect(deps).toHaveLength(2);
    expect(deps[0].dependency).toBe("flask");
    expect(deps[1].dependency).toBe("pytest");
  });

  it("handles version in object format", () => {
    const content = `
[packages]
django = {version = ">=4.0"}
celery = {version = "~=5.3", extras = ["redis"]}
`;
    const deps = parsePipfilePackages(content);
    expect(deps).toEqual([
      { dependency: "django", version: ">=4.0" },
      { dependency: "celery", version: "~=5.3" },
    ]);
  });

  it("ignores comments", () => {
    const content = `
[packages]
# This is a comment
flask = "==2.3.0"
`;
    const deps = parsePipfilePackages(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].dependency).toBe("flask");
  });

  it("stops parsing at a different section", () => {
    const content = `
[packages]
flask = "==2.3.0"

[scripts]
start = "python app.py"
`;
    const deps = parsePipfilePackages(content);
    expect(deps).toHaveLength(1);
  });

  it("returns empty array for empty content", () => {
    expect(parsePipfilePackages("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parsePomXml
// ---------------------------------------------------------------------------

describe("parsePomXml", () => {
  it("parses standard dependency blocks", () => {
    const content = `
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>5.3.30</version>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
    </dependency>
  </dependencies>
</project>
`;
    const deps = parsePomXml(content);
    expect(deps).toEqual([
      { dependency: "org.springframework:spring-core", version: "5.3.30" },
      { dependency: "junit:junit", version: "4.13.2" },
    ]);
  });

  it("handles dependencies without version", () => {
    const content = `
<dependency>
  <groupId>org.projectlombok</groupId>
  <artifactId>lombok</artifactId>
</dependency>
`;
    const deps = parsePomXml(content);
    expect(deps).toEqual([
      { dependency: "org.projectlombok:lombok", version: null },
    ]);
  });

  it("handles whitespace in XML tags", () => {
    const content = `
<dependency>
  <groupId>  com.google.guava  </groupId>
  <artifactId>  guava  </artifactId>
  <version>  31.1-jre  </version>
</dependency>
`;
    const deps = parsePomXml(content);
    expect(deps).toEqual([
      { dependency: "com.google.guava:guava", version: "31.1-jre" },
    ]);
  });

  it("returns empty array for content without dependencies", () => {
    const content = "<project><name>test</name></project>";
    expect(parsePomXml(content)).toEqual([]);
  });

  it("returns empty array for empty content", () => {
    expect(parsePomXml("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseBuildGradle
// ---------------------------------------------------------------------------

describe("parseBuildGradle", () => {
  it("parses single-quoted shorthand dependencies", () => {
    const content = `
dependencies {
    implementation 'com.google.guava:guava:31.1-jre'
    testImplementation 'junit:junit:4.13.2'
}
`;
    const deps = parseBuildGradle(content);
    expect(deps).toEqual([
      { dependency: "com.google.guava:guava", version: "31.1-jre" },
      { dependency: "junit:junit", version: "4.13.2" },
    ]);
  });

  it("parses double-quoted dependencies", () => {
    const content = `
dependencies {
    implementation "org.springframework:spring-core:5.3.30"
}
`;
    const deps = parseBuildGradle(content);
    expect(deps).toEqual([
      { dependency: "org.springframework:spring-core", version: "5.3.30" },
    ]);
  });

  it("parses map-style dependencies", () => {
    const content = `
dependencies {
    implementation group: 'com.google.guava', name: 'guava', version: '31.1-jre'
}
`;
    const deps = parseBuildGradle(content);
    expect(deps.some(d => d.dependency === "com.google.guava:guava" && d.version === "31.1-jre")).toBe(true);
  });

  it("parses map-style without version", () => {
    const content = `
dependencies {
    implementation group: 'org.projectlombok', name: 'lombok'
}
`;
    const deps = parseBuildGradle(content);
    expect(deps.some(d => d.dependency === "org.projectlombok:lombok" && d.version === null)).toBe(true);
  });

  it("parses multiple configuration types", () => {
    const content = `
dependencies {
    api 'com.google.guava:guava:31.0'
    compileOnly 'org.projectlombok:lombok:1.18.0'
    runtimeOnly 'mysql:mysql-connector-java:8.0.0'
    annotationProcessor 'org.projectlombok:lombok:1.18.0'
}
`;
    const deps = parseBuildGradle(content);
    expect(deps).toHaveLength(4);
  });

  it("handles dependencies without version (two-part)", () => {
    const content = `
dependencies {
    implementation 'com.example:mylib'
}
`;
    const deps = parseBuildGradle(content);
    expect(deps).toEqual([
      { dependency: "com.example:mylib", version: null },
    ]);
  });

  it("returns empty array for content without dependencies", () => {
    const content = `
plugins {
    id 'java'
}
`;
    expect(parseBuildGradle(content)).toEqual([]);
  });

  it("returns empty array for empty content", () => {
    expect(parseBuildGradle("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseLogLines
// ---------------------------------------------------------------------------

describe("parseLogLines", () => {
  it("parses tab-delimited git log output", () => {
    const stdout = "abc123\tJohn Doe\tjohn@example.com\t2024-01-01T00:00:00\tInitial commit\n";
    const results = parseLogLines("my-repo", stdout);
    expect(results).toEqual([
      {
        repo: "my-repo",
        commit: "abc123",
        authorName: "John Doe",
        authorEmail: "john@example.com",
        date: "2024-01-01T00:00:00",
        subject: "Initial commit",
      },
    ]);
  });

  it("parses multiple lines", () => {
    const stdout =
      "abc123\tJohn Doe\tjohn@example.com\t2024-01-01\tFirst commit\n" +
      "def456\tJane Doe\tjane@example.com\t2024-01-02\tSecond commit\n";
    const results = parseLogLines("repo", stdout);
    expect(results).toHaveLength(2);
    expect(results[0].commit).toBe("abc123");
    expect(results[1].commit).toBe("def456");
  });

  it("handles subjects with tabs", () => {
    const stdout = "abc123\tJohn\tjohn@ex.com\t2024-01-01\tpart1\tpart2\n";
    const results = parseLogLines("repo", stdout);
    expect(results[0].subject).toBe("part1\tpart2");
  });

  it("returns empty array for empty/null input", () => {
    expect(parseLogLines("repo", "")).toEqual([]);
    expect(parseLogLines("repo", null)).toEqual([]);
    expect(parseLogLines("repo", undefined)).toEqual([]);
    expect(parseLogLines("repo", "  \n  ")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// matchesFilter
// ---------------------------------------------------------------------------

describe("matchesFilter", () => {
  it("returns true when no filters are provided", () => {
    expect(matchesFilter("some/path", null)).toBe(true);
    expect(matchesFilter("some/path", [])).toBe(true);
    expect(matchesFilter("some/path", undefined)).toBe(true);
  });

  it("returns true when path matches a filter (case-insensitive)", () => {
    expect(matchesFilter("workspace/my-repo", ["my-repo"])).toBe(true);
    expect(matchesFilter("workspace/MY-REPO", ["my-repo"])).toBe(true);
    expect(matchesFilter("workspace/my-repo", ["MY-REPO"])).toBe(true);
  });

  it("returns true if any filter matches", () => {
    expect(matchesFilter("workspace/api-service", ["frontend", "api"])).toBe(true);
  });

  it("returns false when path does not match any filter", () => {
    expect(matchesFilter("workspace/backend-service", ["frontend"])).toBe(false);
  });

  it("matches partial paths", () => {
    expect(matchesFilter("org/my-repo-name", ["my-repo"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dateArgs
// ---------------------------------------------------------------------------

describe("dateArgs", () => {
  it("returns empty array when no dates provided", () => {
    expect(dateArgs(undefined, undefined)).toEqual([]);
    expect(dateArgs(null, null)).toEqual([]);
  });

  it("returns --after flag for dateFrom", () => {
    expect(dateArgs("2024-01-01", undefined)).toEqual(["--after=2024-01-01"]);
  });

  it("returns --before flag for dateTo with end-of-day time", () => {
    expect(dateArgs(undefined, "2024-12-31")).toEqual(["--before=2024-12-31T23:59:59"]);
  });

  it("returns both flags when both dates provided", () => {
    const result = dateArgs("2024-01-01", "2024-12-31");
    expect(result).toEqual([
      "--after=2024-01-01",
      "--before=2024-12-31T23:59:59",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Marker constants
// ---------------------------------------------------------------------------

describe("TECH_MARKERS", () => {
  it("maps package.json to NodeJS", () => {
    expect(TECH_MARKERS["package.json"]).toBe("NodeJS");
  });

  it("maps Dockerfile to Docker", () => {
    expect(TECH_MARKERS["Dockerfile"]).toBe("Docker");
  });

  it("maps go.mod to Go", () => {
    expect(TECH_MARKERS["go.mod"]).toBe("Go");
  });

  it("maps tsconfig.json to TypeScript", () => {
    expect(TECH_MARKERS["tsconfig.json"]).toBe("TypeScript");
  });

  it("has entries for all major ecosystems", () => {
    const values = Object.values(TECH_MARKERS);
    expect(values).toContain("NodeJS");
    expect(values).toContain("Python");
    expect(values).toContain("Java");
    expect(values).toContain("Go");
    expect(values).toContain("Rust");
    expect(values).toContain("Ruby");
    expect(values).toContain("PHP");
    expect(values).toContain("Docker");
  });
});

describe("DIR_MARKERS", () => {
  it("maps .github to GitHub Actions", () => {
    expect(DIR_MARKERS[".github"]).toBe("GitHub Actions");
  });

  it("maps terraform to Terraform", () => {
    expect(DIR_MARKERS["terraform"]).toBe("Terraform");
  });
});

describe("PKG_DEP_MARKERS", () => {
  it("maps react to React", () => {
    expect(PKG_DEP_MARKERS["react"]).toBe("React");
  });

  it("maps vue to Vue", () => {
    expect(PKG_DEP_MARKERS["vue"]).toBe("Vue");
  });

  it("maps @angular/core to Angular", () => {
    expect(PKG_DEP_MARKERS["@angular/core"]).toBe("Angular");
  });
});

// ---------------------------------------------------------------------------
// Adversarial / edge-case inputs
// ---------------------------------------------------------------------------

describe("parseRequirementsTxt (edge cases)", () => {
  it("handles unicode in content without crashing", () => {
    const content = "café==1.0.0\n";
    const deps = parseRequirementsTxt(content);
    // The parser splits on version specifier chars; unicode may split differently
    // but it should never throw
    expect(Array.isArray(deps)).toBe(true);
    expect(deps.length).toBeGreaterThan(0);
  });

  it("handles very long lines", () => {
    const longName = "a".repeat(500);
    const content = `${longName}==1.0.0\n`;
    const deps = parseRequirementsTxt(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].dependency).toBe(longName);
  });

  it("handles Windows-style line endings (CRLF)", () => {
    const content = "flask==2.3.0\r\nrequests==2.31.0\r\n";
    const deps = parseRequirementsTxt(content);
    expect(deps).toHaveLength(2);
    expect(deps[0].dependency).toBe("flask");
    expect(deps[1].dependency).toBe("requests");
  });

  it("handles mixed line endings", () => {
    const content = "flask==1.0\nrequests==2.0\r\ndjango==3.0\n";
    const deps = parseRequirementsTxt(content);
    expect(deps).toHaveLength(3);
  });

  it("handles lines with only whitespace", () => {
    const content = "flask==1.0\n   \n  \t  \nrequests==2.0\n";
    const deps = parseRequirementsTxt(content);
    expect(deps).toHaveLength(2);
  });

  it("handles multiple version specifiers", () => {
    const content = "django>=3.0,<4.0,!=3.0.1\n";
    const deps = parseRequirementsTxt(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].dependency).toBe("django");
  });
});

describe("parsePomXml (edge cases)", () => {
  it("handles malformed XML (unclosed tags)", () => {
    const content = `
<dependency>
  <groupId>com.example
  <artifactId>broken</artifactId>
</dependency>
`;
    // Should not throw, may return partial or empty results
    const result = parsePomXml(content);
    expect(Array.isArray(result)).toBe(true);
  });

  it("handles completely invalid XML", () => {
    const content = "this is not xml at all <<>>";
    const result = parsePomXml(content);
    expect(result).toEqual([]);
  });

  it("handles dependencies with property placeholders", () => {
    const content = `
<dependency>
  <groupId>org.springframework</groupId>
  <artifactId>spring-core</artifactId>
  <version>\${spring.version}</version>
</dependency>
`;
    const deps = parsePomXml(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].version).toBe("${spring.version}");
  });

  it("handles multiple dependency blocks", () => {
    const content = `
<dependencies>
  <dependency>
    <groupId>a</groupId>
    <artifactId>b</artifactId>
    <version>1.0</version>
  </dependency>
</dependencies>
<dependencies>
  <dependency>
    <groupId>c</groupId>
    <artifactId>d</artifactId>
    <version>2.0</version>
  </dependency>
</dependencies>
`;
    const deps = parsePomXml(content);
    expect(deps).toHaveLength(2);
  });

  it("handles unicode in version strings", () => {
    const content = `
<dependency>
  <groupId>com.example</groupId>
  <artifactId>unicode-lib</artifactId>
  <version>1.0-béta</version>
</dependency>
`;
    const deps = parsePomXml(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].version).toBe("1.0-béta");
  });
});

describe("parseBuildGradle (edge cases)", () => {
  it("handles empty dependencies block", () => {
    const content = "dependencies {\n}\n";
    const deps = parseBuildGradle(content);
    expect(deps).toEqual([]);
  });

  it("handles commented-out dependencies", () => {
    const content = `
dependencies {
    // implementation 'com.google.guava:guava:31.0'
    implementation 'junit:junit:4.13.2'
}
`;
    const deps = parseBuildGradle(content);
    // Should only parse the uncommented line
    expect(deps.some(d => d.dependency === "junit:junit")).toBe(true);
  });

  it("handles dependencies with variable references", () => {
    const content = `
dependencies {
    implementation "com.example:lib:$libVersion"
}
`;
    const deps = parseBuildGradle(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].version).toBe("$libVersion");
  });
});

describe("parsePipfilePackages (edge cases)", () => {
  it("handles Pipfile with no packages sections", () => {
    const content = `
[requires]
python_version = "3.11"

[scripts]
start = "python app.py"
`;
    const deps = parsePipfilePackages(content);
    expect(deps).toEqual([]);
  });

  it("handles unicode in package names", () => {
    const content = `
[packages]
café-utils = "==1.0.0"
`;
    const deps = parsePipfilePackages(content);
    expect(deps).toHaveLength(1);
    expect(deps[0].dependency).toBe("café-utils");
  });

  it("handles Windows-style line endings", () => {
    const content = "[packages]\r\nflask = \"==2.0\"\r\nrequests = \"*\"\r\n";
    const deps = parsePipfilePackages(content);
    expect(deps).toHaveLength(2);
  });
});

describe("parseLogLines (edge cases)", () => {
  it("handles lines with fewer than 5 tab-separated fields", () => {
    const stdout = "abc123\tJohn\n";
    const results = parseLogLines("repo", stdout);
    // Should handle gracefully - may produce partial results or skip
    expect(Array.isArray(results)).toBe(true);
  });

  it("handles lines with many tab-separated fields", () => {
    const stdout = "abc123\tJohn\tjohn@ex.com\t2024-01-01\ta\tb\tc\td\n";
    const results = parseLogLines("repo", stdout);
    expect(results).toHaveLength(1);
    // Subject should contain all trailing parts joined by tabs
    expect(results[0].subject).toBe("a\tb\tc\td");
  });

  it("handles unicode in author names and subjects", () => {
    const stdout = "abc123\tJosé García\tjose@example.com\t2024-01-01\tAñadida función\n";
    const results = parseLogLines("repo", stdout);
    expect(results).toHaveLength(1);
    expect(results[0].authorName).toBe("José García");
    expect(results[0].subject).toBe("Añadida función");
  });
});

describe("matchesFilter (edge cases)", () => {
  it("handles empty string filter", () => {
    // An empty string in the filter array should match everything (since everything contains "")
    expect(matchesFilter("workspace/my-repo", [""])).toBe(true);
  });

  it("handles path with special regex characters", () => {
    // matchesFilter uses .includes, not regex, so these should work
    expect(matchesFilter("workspace/my.repo", ["my.repo"])).toBe(true);
  });
});

describe("dateArgs (edge cases)", () => {
  it("handles empty string dates (treats as falsy)", () => {
    expect(dateArgs("", "")).toEqual([]);
  });

  it("handles date strings with time components", () => {
    const result = dateArgs("2024-01-01T00:00:00", undefined);
    expect(result).toEqual(["--after=2024-01-01T00:00:00"]);
  });
});
