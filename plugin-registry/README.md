# Agent Hub Plugin Registry

Official plugin registry for [Agent Hub](https://github.com/agenthub-dev/agent-hub). Plugins listed here appear in the Agent Hub marketplace.

## Available Plugins

| Plugin | Type | Description |
|--------|------|-------------|
| [github](plugins/github/) | Level 2 (Code Hosting) | Git operations, PRs, and code review via GitHub CLI |
| [pm-tool](plugins/pm-tool/) | Level 1 (MCP) | Sync tasks with PM tools (Jira, Linear, Asana, etc.) |

## Contributing a Plugin

1. **Fork** this repository
2. **Create** `plugins/{your-plugin-name}/` with the 3 required files:
   - `plugin.json` — identity, capabilities, config schema
   - `manifest.json` — workflow hooks, operations, phases
   - `setup.json` — installation and uninstallation steps
3. **Submit a PR** with your plugin directory
4. After review and approval, your plugin appears in the marketplace

### Plugin ID Rules

- Lowercase alphanumeric + hyphens only: `^[a-z0-9-]+$`
- Must be unique across the registry
- Should clearly identify the service (e.g., `jira`, `gitlab`, `slack`)

### Required Files

Every plugin **must** have all three JSON files. See the [Plugin Development Guide](https://github.com/agenthub-dev/agent-hub/blob/main/docs/PLUGIN-DEVELOPMENT.md) for the complete specification, including:

- Config schema format
- Workflow hooks reference
- Operations and field mappings
- Level 1 vs Level 2 plugins
- Setup step types

### Testing Locally

```bash
# Validate JSON
node -e "JSON.parse(require('fs').readFileSync('plugins/your-plugin/plugin.json'))"
node -e "JSON.parse(require('fs').readFileSync('plugins/your-plugin/manifest.json'))"
node -e "JSON.parse(require('fs').readFileSync('plugins/your-plugin/setup.json'))"

# Build catalog
node scripts/build-catalog.js
```

## How It Works

When a plugin PR is merged to `main`:

1. GitHub Actions builds `.tar.gz` tarballs for each plugin
2. Creates a GitHub Release with the tarballs attached
3. Runs `build-catalog.js` to regenerate `catalog.json` with download URLs and SHA-256 checksums
4. Commits the updated `catalog.json` back to `main`

Agent Hub fetches `catalog.json` from this repo's raw URL to populate the marketplace.

## License

MIT
