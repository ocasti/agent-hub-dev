import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { AnalysisResult } from './types';
import { cleanEnv } from './claude-cli';

export function parseAnalysisOutput(output: string): AnalysisResult {
  const shortMatch = output.match(/\[SHORT_DESCRIPTION\]\s*([\s\S]*?)\s*\[\/SHORT_DESCRIPTION\]/);
  const claudeMatch = output.match(/\[CLAUDE_MD\]\s*([\s\S]*?)\s*\[\/CLAUDE_MD\]/);
  return {
    shortDescription: shortMatch?.[1]?.trim() || 'Project analysis completed.',
    claudeMdContent: claudeMatch?.[1]?.trim() || output,
  };
}

export function readClaudeMd(projectPath: string): string {
  try {
    const p = join(projectPath, 'CLAUDE.md');
    return existsSync(p) ? readFileSync(p, 'utf-8') : '';
  } catch { return ''; }
}

export async function runRepoAnalysis(
  projectPath: string,
  existingClaudeMd?: string,
  activeSkills?: string[]
): Promise<AnalysisResult> {
  const skillsSection = activeSkills && activeSkills.length > 0
    ? `\n## Active Skills (settingSources)\nThe following skills/tools are configured for this project:\n${activeSkills.map((s) => `- ${s}`).join('\n')}\nInclude them in the CLAUDE.md under a "Skills" or "Tools" section.\n`
    : '';

  const isMerge = !!existingClaudeMd;
  const timeoutMs = isMerge ? 420000 : 300000; // 7min merge, 5min create

  let prompt: string;

  if (isMerge) {
    // Truncate existing CLAUDE.md if too large to avoid burning tokens
    const maxExistingSize = 50 * 1024;
    const truncatedMd = existingClaudeMd.length > maxExistingSize
      ? existingClaudeMd.substring(0, maxExistingSize) + '\n\n<!-- TRUNCATED: original file exceeds 50KB -->'
      : existingClaudeMd;

    prompt = `You are a senior software architect. This project already has a CLAUDE.md file. Your job is to:
1. Analyze the repository using your tools (Read, Glob, Bash) to find current, accurate information
2. MERGE your findings with the existing CLAUDE.md — preserve manual content, update outdated info, add new findings
${skillsSection}
## Existing CLAUDE.md Content
\`\`\`markdown
${truncatedMd}
\`\`\`

## Instructions
- Preserve any manually-written sections, rules, or conventions
- Update versions, paths, or commands that are outdated
- Add new sections for things not covered in the existing file
- Remove information that is clearly wrong or no longer applies

## Output Format

You MUST wrap your output in these exact delimiters:

[SHORT_DESCRIPTION]
A 1-2 sentence summary of the project (language, framework, purpose). This is for display in a dashboard.
[/SHORT_DESCRIPTION]

[CLAUDE_MD]
The complete merged CLAUDE.md content in markdown.
[/CLAUDE_MD]

IMPORTANT: Actually read files and run commands — do NOT make assumptions. Use the delimiters EXACTLY as shown.`;
  } else {
    prompt = `You are a senior software architect. Analyze this repository and produce TWO things:
1. A short description (1-2 sentences) for dashboard display
2. A comprehensive CLAUDE.md file for the project

Use your tools (Read, Glob, Bash) to inspect the project thoroughly. DO NOT guess — actually read files and run commands.
${skillsSection}
## What to analyze for the CLAUDE.md

1. **Language(s) & Frameworks** — Read package.json, requirements.txt, go.mod, Cargo.toml, etc. Include versions.
2. **Project Structure** — List key directories, entry points, and their purpose.
3. **Testing** — Framework, runner, conventions, how to run tests (e.g. \`npm test\`, \`pytest\`).
4. **Infrastructure** — Docker, CI/CD (GitHub Actions, etc.), env vars.
5. **Patterns & Conventions** — Architecture (MVC, Clean, etc.), naming, API style, error handling.
6. **Dependencies & Package Manager** — npm/yarn/pnpm, pip, etc. Key dependencies.
7. **Database & Data Layer** — ORM, migrations, schema.
8. **Build & Dev** — How to build, how to run in dev mode.

## Output Format

You MUST wrap your output in these exact delimiters:

[SHORT_DESCRIPTION]
A 1-2 sentence summary of the project (language, framework, purpose). This is for display in a dashboard.
[/SHORT_DESCRIPTION]

[CLAUDE_MD]
The complete CLAUDE.md content in markdown. Be concise but specific. Include actual versions, file paths, and command examples.
[/CLAUDE_MD]

IMPORTANT: Actually read files and run commands — do NOT make assumptions. Use the delimiters EXACTLY as shown.`;
  }

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn('claude', ['--model', 'sonnet', '--print', '--permission-mode', 'bypassPermissions'], {
      cwd: projectPath,
      env: cleanEnv(),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code: number | null) => {
      if (code === 0 && stdout.trim()) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `Claude exited with code ${code}`));
    });
    child.on('error', (err) => reject(new Error(`Spawn error: ${err.message}`)));

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Repo analysis timed out after ${Math.round(timeoutMs / 60000)} minutes`));
    }, timeoutMs);

    child.on('close', () => clearTimeout(timeout));

    child.stdin?.write(prompt);
    child.stdin?.end();
  });

  return parseAnalysisOutput(output);
}
