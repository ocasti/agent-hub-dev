import { execFile } from 'child_process';

// ── Clean env (strip CLAUDECODE to avoid nested-session block) ─────────────────

export function cleanEnv(extraEnv?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
  }
  return env;
}

// ── execFileAsync ──────────────────────────────────────────────────────────────

export function execFileAsync(cmd: string, args: string[], cwd?: string, timeoutMs: number = 30000, useShell: boolean = false, extraEnv?: Record<string, string | undefined>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { shell: useShell, env: cleanEnv(extraEnv), cwd, timeout: timeoutMs }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/**
 * Execute a GraphQL query via `gh api graphql` with proper variable passing.
 * Uses -f for string variables and -F for numeric variables to avoid injection.
 */
export function execGraphQL(
  query: string,
  cwd: string,
  timeoutMs: number = 30000,
  variables?: Record<string, string | number>,
  extraEnv?: Record<string, string | undefined>
): Promise<string> {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      if (typeof value === 'number') {
        args.push('-F', `${key}=${value}`);
      } else {
        args.push('-f', `${key}=${value}`);
      }
    }
  }
  return new Promise((resolve, reject) => {
    execFile('gh', args, {
      shell: false,
      env: cleanEnv(extraEnv),
      cwd,
      timeout: timeoutMs,
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

