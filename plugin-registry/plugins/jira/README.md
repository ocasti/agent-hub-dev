# Jira Plugin for Agent Hub

Sync your SDD workflow with Jira using the [mcp-atlassian](https://github.com/sooperset/mcp-atlassian) MCP server. This plugin integrates Jira issue tracking into Agent Hub's workflow phases — automatically transitioning issues, posting progress comments, and enriching specs with Jira issue data.

## Prerequisites

- **Python 3.10+** with `uvx` (from [uv](https://docs.astral.sh/uv/))
- **Jira Cloud** or **Jira Data Center / Server** instance
- **API credentials**:
  - **Cloud**: Jira URL + username (email) + [API token](https://id.atlassian.com/manage-profile/security/api-tokens)
  - **Data Center**: Jira URL + [Personal Access Token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html)

## Installation

1. Open Agent Hub → **Plugins** tab
2. Find **Jira** in the marketplace → click **Install**
3. The installer will:
   - Verify `uvx` is available
   - Register the `mcp-atlassian` MCP server with Claude Code
   - Configure Jira credentials as environment variables

## Configuration

| Setting | Required | Description |
|---------|----------|-------------|
| Jira Project Key | Yes | The project key (e.g. `PROJ`, `ENG`) |
| Default Issue Type | No | Issue type for subtasks (default: `Task`) |
| Status: In Progress | Yes | Transition name when work begins |
| Status: In Review | No | Transition name when PR is created |
| Status: Done | Yes | Transition name when task completes |

### Authentication

**Jira Cloud:**
```
JIRA_URL=https://your-domain.atlassian.net
JIRA_USERNAME=your-email@example.com
JIRA_API_TOKEN=your-api-token
```

**Jira Data Center / Server:**
```
JIRA_URL=https://jira.your-company.com
JIRA_PERSONAL_TOKEN=your-personal-access-token
```

## Workflow Integration

| Hook | Action |
|------|--------|
| `on:workflow_started` | Transitions issue to "In Progress" + posts start comment |
| `on:plan_approved` | Posts the approved plan as a comment |
| `on:implement_complete` | Posts development complete comment |
| `on:quality_pass` | Posts quality gate passed comment |
| `on:quality_fail` | Posts quality gate failure details |
| `on:pr_created` | Transitions issue to "In Review" |
| `on:task_complete` | Transitions issue to "Done" |
| `on:workflow_failed` | Posts failure details as comment |

## Task Creation

When creating a task in Agent Hub, the **Jira Issue** selector lets you search your assigned issues. Selecting one auto-fills the task title and description from the Jira issue.

## Manual Actions

- **Sync with Jira** — Refresh issue data from Jira
- **My Issues** — View all issues assigned to you

## Available MCP Tools

This plugin uses the following tools from `mcp-atlassian`:

| Tool | Purpose |
|------|---------|
| `jira_get_issue` | Fetch issue details |
| `jira_search` | Search issues with JQL |
| `jira_create_issue` | Create subtasks |
| `jira_transition_issue` | Change issue status |
| `jira_add_comment` | Post workflow comments |

The full `mcp-atlassian` server provides 72+ tools for Jira and Confluence. Only the tools above are used by this plugin's manifest, but all tools remain available to Claude Code during workflow execution.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `uvx: command not found` | Install uv: `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Authentication fails | Verify credentials: Cloud needs email + API token, DC needs personal token |
| Transitions fail | Check that status names in config match your Jira workflow exactly (case-sensitive) |
| No issues found | Verify the JQL query — ensure issues are assigned to you and not in Done status |
