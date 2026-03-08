# GitHub Plugin for Agent Hub

Code hosting integration that adds **Ship** and **PR Feedback** phases to the SDD workflow.

## What it does

Without this plugin, the SDD workflow ends at Phase 3 (Quality Gate) and you handle git/PR manually. With this plugin enabled:

- **Phase 4 — Ship**: Automatically creates a conventional commit, pushes the branch, and opens a pull request on GitHub.
- **Phase 5 — PR Feedback**: Fetches review comments from the PR. You can click "Fetch & Fix" to apply reviewer feedback, or "Approve" to complete the task.

## Prerequisites

- [GitHub CLI (`gh`)](https://cli.github.com) installed and available in PATH
- `gh auth login` completed (authenticated with your GitHub account)
- Git configured with user name and email

## Installation

1. Open Agent Hub
2. Go to **Plugins > Marketplace**
3. Find **GitHub** under "Code Hosting"
4. Click **Install**
5. The installer will verify `gh` is installed and authenticated

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| Default Branch | Target branch for pull requests | `main` |

## Activating for a Project

1. Go to **Projects** and edit your project
2. In the **Code Hosting** dropdown, select **GitHub**
3. Save

Once activated, tasks in that project will include the Ship and PR Feedback phases in the workflow.

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

- **Fetch & Fix**: Pulls review comments from GitHub, sends them to the agent for fixing, and pushes the updates
- **Approve**: Marks the task as complete

**Hooks fired:**
- `on:pr_changes_requested` — when review comments are fetched
- `on:pr_fix_pushed` — after fixes are pushed
- `on:pr_approved` — when you approve the PR

## Operations

The plugin exposes these operations via the manifest:

| Operation | Description | Command |
|-----------|-------------|---------|
| `createPR` | Create a pull request | `gh pr create --title ... --base {defaultBranch} --head {branchName}` |
| `fetchPRComments` | Fetch PR review comments | `gh api repos/{owner}/{repo}/pulls/{prNumber}/comments` |
| `mergePR` | Squash merge and delete branch | `gh pr merge {prNumber} --squash --delete-branch` |

## Troubleshooting

### "Required CLI tool not found"

Install the GitHub CLI:

```bash
# macOS
brew install gh

# Ubuntu/Debian
sudo apt install gh

# Windows
winget install GitHub.cli
```

Then authenticate:

```bash
gh auth login
```

### "Ship phase failed"

Common causes:
- No remote configured: run `git remote add origin <url>`
- Branch already has a PR: the plugin tries to create a new one
- Authentication expired: run `gh auth refresh`

### PR comments not fetching

Ensure the repository URL in the project matches the GitHub remote. The plugin extracts `{owner}/{repo}` from the git remote URL.
