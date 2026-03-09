import type Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { AnalysisResult } from './types';
import { resolveAgentForPhase } from './agents';

export function parseAnalysisOutput(output: string): AnalysisResult {
  const shortMatch = output.match(/\[SHORT_DESCRIPTION\]\s*([\s\S]*?)\s*\[\/SHORT_DESCRIPTION\]/);
  const agentMdMatch = output.match(/\[AGENT_MD\]\s*([\s\S]*?)\s*\[\/AGENT_MD\]/);
  return {
    shortDescription: shortMatch?.[1]?.trim() || 'Project analysis completed.',
    agentMdContent: agentMdMatch?.[1]?.trim() || output,
  };
}

export function readAgentMd(projectPath: string): string {
  try {
    // Primary: AGENT.md (new convention)
    const agentPath = join(projectPath, 'AGENT.md');
    if (existsSync(agentPath)) return readFileSync(agentPath, 'utf-8');
    // Fallback: CLAUDE.md (legacy — projects analyzed before v2.0)
    const claudePath = join(projectPath, 'CLAUDE.md');
    if (existsSync(claudePath)) return readFileSync(claudePath, 'utf-8');
    return '';
  } catch { return ''; }
}

export async function runRepoAnalysis(
  projectPath: string,
  existingAgentMd?: string,
  activeSkills?: string[],
  db?: Database.Database,
  projectId?: string
): Promise<AnalysisResult> {
  const skillsSection = activeSkills && activeSkills.length > 0
    ? `\n## Active Skills (settingSources)\nThe following skills/tools are configured for this project:\n${activeSkills.map((s) => `- ${s}`).join('\n')}\nInclude them in the AGENT.md under a "Skills" or "Tools" section.\n`
    : '';

  const isMerge = !!existingAgentMd;
  const timeoutMs = isMerge ? 420000 : 300000; // 7min merge, 5min create

  let prompt: string;

  if (isMerge) {
    // Truncate existing AGENT.md if too large to avoid burning tokens
    const maxExistingSize = 50 * 1024;
    const truncatedMd = existingAgentMd.length > maxExistingSize
      ? existingAgentMd.substring(0, maxExistingSize) + '\n\n<!-- TRUNCATED: original file exceeds 50KB -->'
      : existingAgentMd;

    prompt = `You are a senior software architect. This project already has an AGENT.md file. Your job is to:
1. Analyze the repository using your tools (Read, Glob, Bash) to find current, accurate information
2. MERGE your findings with the existing AGENT.md — preserve manual content, update outdated info, add new findings
${skillsSection}
## Existing AGENT.md Content
\`\`\`markdown
${truncatedMd}
\`\`\`

## Sections to ensure are present
1. Language(s) & Frameworks (with versions)
2. Project Structure (directory tree, entry points)
3. Build & Dev (setup, build, run commands)
4. Testing (framework, runner, how to run, coverage)
5. Patterns & Conventions (architecture, naming, error handling)
6. API Endpoints / Routes (REST methods+paths, GraphQL schema)
7. Database & Data Layer (ORM, migrations, schema, seeds)
8. Dependencies & Package Manager (key deps and their role)
9. Environment Variables (required/optional, from .env.example or config)
10. Infrastructure & CI/CD (Docker, GitHub Actions, deployment scripts)
11. Authentication & Security (auth mechanism, middleware, CORS, validation)
12. Code Standards (linting, formatting, pre-commit hooks, config paths)
13. Deployment (how, where, build output, production commands)

## Instructions
- Preserve any manually-written sections, rules, or conventions
- Update versions, paths, or commands that are outdated
- Add new sections for things not covered in the existing file (see list above)
- Remove information that is clearly wrong or no longer applies

## Output Format

You MUST wrap your output in these exact delimiters:

[SHORT_DESCRIPTION]
A 1-2 sentence summary of the project (language, framework, purpose). This is for display in a dashboard.
[/SHORT_DESCRIPTION]

[AGENT_MD]
The complete merged AGENT.md content in markdown.
[/AGENT_MD]

IMPORTANT: Actually read files and run commands — do NOT make assumptions. Use the delimiters EXACTLY as shown.`;
  } else {
    prompt = `You are a senior software architect. Analyze this repository and produce TWO things:
1. A short description (1-2 sentences) for dashboard display
2. A comprehensive AGENT.md file for the project

Use your tools (Read, Glob, Bash) to inspect the project thoroughly. DO NOT guess — actually read files and run commands.
${skillsSection}
## What to analyze for the AGENT.md

1. **Language(s) & Frameworks** — Read package.json, requirements.txt, go.mod, Cargo.toml, etc. Include exact versions.
2. **Project Structure** — List key directories, entry points, and their purpose. Show the directory tree for the top 2-3 levels.
3. **Build & Dev** — How to build, how to run in dev mode, required setup steps (e.g. \`npm install\`, \`docker compose up\`).
4. **Testing** — Framework, runner, conventions, how to run tests (e.g. \`npm test\`, \`pytest\`). Mention coverage tools if present.
5. **Patterns & Conventions** — Architecture (MVC, Clean, Hexagonal, etc.), naming conventions, coding style, error handling patterns.
6. **API Endpoints / Routes** — If the project exposes an API, list the main routes or entry points. For REST: HTTP methods + paths. For GraphQL: schema location.
7. **Database & Data Layer** — ORM, migrations, schema location, seed data. Include connection config pattern (env vars, config files).
8. **Dependencies & Package Manager** — npm/yarn/pnpm/pip/cargo, etc. List key dependencies and their role (not all, just the important ones).
9. **Environment Variables** — List required env vars from .env.example, docker-compose.yml, or config files. Note which are required vs optional.
10. **Infrastructure & CI/CD** — Docker, GitHub Actions, deployment scripts, cloud provider. Include the deployment flow if detectable.
11. **Authentication & Security** — Auth mechanism (JWT, OAuth, sessions, API keys), middleware, CORS config, input validation patterns.
12. **Code Standards** — Linting (ESLint, Pylint, etc.), formatting (Prettier, Black), pre-commit hooks, TypeScript strict mode. Include config file paths.
13. **Deployment** — How the project is deployed (Vercel, AWS, Docker, manual). Build output directory, production commands.

## Output Format

You MUST wrap your output in these exact delimiters:

[SHORT_DESCRIPTION]
A 1-2 sentence summary of the project (language, framework, purpose). This is for display in a dashboard.
[/SHORT_DESCRIPTION]

[AGENT_MD]
The complete AGENT.md content in markdown. Be concise but specific. Include actual versions, file paths, and command examples.
[/AGENT_MD]

IMPORTANT: Actually read files and run commands — do NOT make assumptions. Use the delimiters EXACTLY as shown.`;
  }

  // Resolve the configured agent for this project (or fall back to any installed agent)
  let adapter;
  if (db && projectId) {
    const { primary } = resolveAgentForPhase(db, projectId, 0);
    adapter = primary;
  } else {
    const { ClaudeAdapter } = await import('./agents/claude-adapter');
    adapter = new ClaudeAdapter();
  }

  console.log(`[repoAnalysis] Using agent: ${adapter.name} (${adapter.id})`);

  // Verify the resolved agent is actually installed
  const installed = await adapter.checkInstalled();
  if (!installed) {
    // Try to find any installed agent
    const { getAllAgents } = await import('./agents/registry');
    const allAgents = getAllAgents();
    let found = false;
    for (const agent of allAgents) {
      if (await agent.checkInstalled()) {
        adapter = agent;
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(`No AI agent is installed. Install at least one agent CLI to analyze the repository.`);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Use a minimal queries object — repo analysis doesn't need task tracking
    const { createQueries } = await import('../../db/queries');
    const q = db ? createQueries(db) : null;

    const { output } = await adapter.runPhase({
      projectPath,
      model: 'sonnet',
      prompt,
      taskId: null as unknown as string, // null taskId — not tied to a task (FK-safe)
      q: q as any,
      getWindow: () => null,
      controller,
      timeoutMs,
    });

    return parseAnalysisOutput(output);
  } finally {
    clearTimeout(timeout);
  }
}
