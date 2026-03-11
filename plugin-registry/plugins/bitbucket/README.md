# Bitbucket Plugin for Agent Hub

Code hosting integration that adds **Ship** and **PR Feedback** phases to the SDD workflow using Bitbucket.

## What it does

Without this plugin, the SDD workflow ends at Phase 3 (Quality Gate) and you handle git/PR manually. With this plugin enabled:

- **Phase 4 — Ship**: Automatically creates a conventional commit, pushes the branch, and opens a pull request on Bitbucket.
- **Phase 5 — PR Feedback**: Fetches review comments from the PR. You can click "Fetch & Fix" to apply reviewer feedback, or "Approve" to complete the task.

## Prerequisites

- [Bitbucket CLI (`bkt`)](https://github.com/avivsinai/bitbucket-cli) installed and available in PATH
- `bkt auth login` completed (authenticated with your Bitbucket account)
- Git configured with user name and email

## Installation

1. Open Agent Hub
2. Go to **Plugins > Marketplace**
3. Find **Bitbucket** under "Code Hosting"
4. Click **Install**
5. The installer will verify `bkt` is installed and authenticated

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| Default Branch | Target branch for pull requests | `main` |
| Bitbucket Host | Cloud (bitbucket.org) or Data Center (self-hosted) | `cloud` |
| Git Author Name | Override git commit author name | _(global git config)_ |
| Git Author Email | Override git commit author email | _(global git config)_ |

No token field is required — `bkt` manages credentials via its own keychain (`bkt auth login`).

## Activating for a Project

1. Go to **Projects** and edit your project
2. In the **Code Hosting** dropdown, select **Bitbucket**
3. Save

Once activated, tasks in that project will include the Ship and PR Feedback phases in the workflow.

## Supported Variants

- **Bitbucket Cloud** (bitbucket.org) — full support
- **Bitbucket Data Center** (self-hosted) — full support with thread resolution

## Workflow Phases

### Phase 4 — Ship

Triggered after Phase 3 (Quality Gate) passes. The agent:

1. Creates a conventional commit message based on the changes
2. Pushes the feature branch to origin
3. Opens a pull request against the configured default branch

**Hooks fired:**
- `on:ship_started` — before shipping begins
- `on:pr_created` — after PR is created (includes PR number and branch name)
- `on:ship_failed` — if any step fails

### Phase 5 — PR Feedback

After the PR is created, the workflow pauses and waits for human review.

- **Fetch & Fix**: Pulls review comments from Bitbucket, sends them to the agent for fixing, and pushes the updates
- **Approve**: Marks the task as complete

**Hooks fired:**
- `on:pr_changes_requested` — when review comments are fetched
- `on:pr_fix_pushed` — after fixes are pushed
- `on:pr_approved` — when you approve the PR

## Operations

The plugin exposes these operations via the manifest:

| Operation | Description | Command |
|-----------|-------------|---------|
| `createPR` | Create a pull request | `bkt pr create --title ... --source {branchName} --target {defaultBranch}` |
| `fetchPRComments` | Fetch PR review comments | `bkt pr view {prNumber} --json` |
| `mergePR` | Squash merge and delete branch | `bkt pr merge {prNumber} --squash --delete-branch` |

## Feature Emulation vs GitHub

| Feature | Status | Notes |
|---------|--------|-------|
| Create PR | Full | Via `bkt pr create` |
| Fetch comments | Full | REST API via `bkt api` |
| Fetch inline threads | Full | REST + parent.id grouping |
| Post reply to thread | Full | REST POST with parent.id |
| Resolve thread | Partial | REST PUT state=RESOLVED (Data Center only; graceful skip on Cloud) |
| Minimize old comments | No-op | Bitbucket has no "minimize" concept |
| CI status | Full | Via `bkt pr checks --json` (no failure log extraction) |

## Troubleshooting

### "Required CLI tool not found"

Install the Bitbucket CLI:

```bash
# Via npm
npm install -g @nicedoc/bkt

# Via Homebrew
brew install avivsinai/tap/bkt
```

Then authenticate:

```bash
bkt auth login
```

### "Ship phase failed"

Common causes:
- No remote configured: run `git remote add origin <url>`
- Branch already has a PR: the plugin tries to create a new one
- Authentication expired: run `bkt auth login`

### PR comments not fetching

Ensure the repository URL in the project matches the Bitbucket remote. The plugin extracts `{workspace}/{repo}` (Cloud) or `{project}/{repo}` (Data Center) from the git remote URL.
