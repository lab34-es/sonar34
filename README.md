e# Sonar34

![Sonar34](logo.png)

Enterprise Repository Intelligence — manage, search, analyze and enrich Git repositories at scale.

> Bitbucket Cloud is the only supported provider at this time.

## Quick start

```bash
npx github:lab34-es/sonar34
```

This starts the server and opens the dashboard in your browser at `http://localhost:3001`.

To use a different port:

```bash
PORT=8080 npx github:lab34-es/sonar34
```

## Setup

### 1. Configure Bitbucket credentials

Open the **Settings** page from the sidebar. Enter your:

- **Bitbucket email** — the email associated with your Bitbucket account
- **Bitbucket API token** — an app password generated from Bitbucket. It needs read access to repositories and pull requests.
- **Bitbucket workspace** — the workspace slug containing your repositories

Save the settings.

### 2. Import repositories

Go to the **Repos** page and click **Sync all from Bitbucket**.

This triggers a background job that discovers and clones every repository in your workspace using partial clones (no file checkout — metadata only). Depending on the number of repositories, this can take a few minutes.

You can follow the progress in the **Jobs** page, which shows all background tasks: sync jobs, enrichment jobs, and search jobs.

### 3. Analyze and search

Once repositories are imported:

- **Repos** — browse all imported repositories. From here you can trigger enrichment (activity sparklines, technology detection, open PR counts, security audits, dependency extraction) on individual repos or in bulk.
- **Search** — cross-repo search by author, commit message, file path, or code content. Searches run across all imported repositories with real-time streaming results.

## Contributing

### Commit message convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/) to automate versioning and releases. When pushing to `master`, a CI pipeline runs the tests and — if they pass — creates a new GitHub release with the version bump determined by your commit messages.

| Commit prefix | Version bump | Example |
|---|---|---|
| `fix:`, `chore:`, `docs:`, `refactor:`, etc. | **patch** (0.0.4 -> 0.0.5) | `fix: resolve crash on startup` |
| `feat:` | **minor** (0.0.4 -> 0.1.0) | `feat: add CSV export` |
| `feat!:`, `fix!:`, or body contains `BREAKING CHANGE` | **major** (0.0.4 -> 1.0.0) | `feat!: redesign search API` |

The highest-severity bump among all commits since the last release wins. A scope in parentheses is optional: `feat(search): add fuzzy matching`.

## Requirements

- Node.js >= 24
- Git installed and available in PATH
- A Bitbucket Cloud account with API access
- Other tools for Java and Python security analysis (as seen in the "Settings" section)

## License

MIT
