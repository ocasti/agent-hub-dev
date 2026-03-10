import type { TaskRow, KnowledgeRow, FetchedThread, ThreadPromptInput } from './types';

// ── Prompt Builder Functions ────────────────────────────────────────────────────
//
// Prompts are agent-agnostic: they reference generic capabilities (read files,
// edit files, run commands) rather than Claude-specific tool names. Each adapter
// can further customize via `transformPrompt()` in the AgentAdapter interface.

export function buildKnowledgeSection(knowledge: KnowledgeRow[]): string {
  if (knowledge.length === 0) return '';
  const entries = knowledge.map((k) => {
    let text = `- **[${k.severity.toUpperCase()}] ${k.title}** (${k.category}): ${k.description}`;
    if (k.anti_pattern) text += `\n  Anti-pattern: ${k.anti_pattern}`;
    if (k.code_example) text += `\n  Example: ${k.code_example}`;
    return text;
  });
  return `\n\n## Past Learnings (apply these to avoid known issues)\n${entries.join('\n')}`;
}

export function buildCriteriaSection(criteria: string[]): string {
  if (criteria.length === 0) return 'No specific criteria defined.';
  return criteria.map((c, i) => `${i + 1}. ${c}`).join('\n');
}

export function buildPhasePrompt(
  phase: number,
  task: TaskRow,
  projectDescription: string,
  knowledge: KnowledgeRow[],
  criteria: string[],
  reviewLoop?: number,
  useSpeckit?: boolean,
  enrichment?: Record<string, unknown>,
  subtasks?: { description: string; completed: boolean }[]
): string {
  const criteriaText = buildCriteriaSection(criteria);

  // Optimization: skip projectDescription for phases 1+ — the agent reads AGENT.md
  // from disk automatically. Only Phase 0 (spec review) needs it inline since the
  // agent hasn't explored the project yet.
  const projectCtx = (phase <= 0 && projectDescription)
    ? `\n## Project Context\n${projectDescription}\n`
    : '';

  // Optimization: limit knowledge entries to top 10 by severity to reduce prompt size.
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortedKnowledge = [...knowledge]
    .sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3))
    .slice(0, 10);
  const knowledgeSection = buildKnowledgeSection(sortedKnowledge);

  // Inject plugin enrichment data if available
  let enrichmentSection = '';
  if (enrichment && Object.keys(enrichment).length > 0) {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(enrichment)) {
      if (typeof value === 'string') {
        parts.push(value);
      } else if (value && typeof value === 'object') {
        parts.push(JSON.stringify(value, null, 2));
      }
    }
    if (parts.length > 0) {
      enrichmentSection = `\n## Plugin Context\n${parts.join('\n\n')}\n`;
    }
  }

  switch (phase) {
    case 0: // Spec Review + Speckit Specification
      return `You are an SDD (Spec-Driven Development) agent. You MUST use your tools to execute commands and modify files.
${projectCtx}${enrichmentSection}
## Task: ${task.title}

## Spec:
${task.description}

## Acceptance Criteria:
${criteriaText}
${knowledgeSection}

## Instructions
${useSpeckit ? `1. If \`memory/constitution.md\` does NOT exist in the project, run the slash command /speckit.constitution to establish project principles.
2. Run the slash command /speckit.specify with this feature description: "${task.title} — ${task.description.slice(0, 200)}"
   This will create a proper spec under specs/ with acceptance criteria, user stories, and success metrics.
3. Review the generated spec against the acceptance criteria provided above.` : `1. Read the project structure to understand what exists.
2. Analyze the task specification above. Determine if it is complete and detailed enough to implement.
3. Check for: clear definition of what needs to be built, enough detail for implementation (inputs, outputs, edge cases), testable acceptance criteria, no ambiguity.`}
4. If the spec is complete and implementation-ready, output [SPEC_OK]
5. If ambiguous or missing details, output [SPEC_INCOMPLETE] followed by [SUGGESTION] lines.

IMPORTANT: You MUST actually execute commands and read files — do NOT just describe what you would do.
${useSpeckit ? 'If speckit commands are not available, create the spec manually by writing files with your Edit tool.' : ''}

## Required Output Format
If the spec is **sufficient**, end your response with exactly:
\`[SPEC_OK]\`

If the spec is **incomplete or ambiguous**, end your response with:
\`[SPEC_INCOMPLETE]\`
Then list each suggestion on its own line prefixed with \`[SUGGESTION]\`:
\`[SUGGESTION] Add error handling requirements for invalid inputs\`
\`[SUGGESTION] Specify the expected response format\``;

    case 1: // Plan + Speckit Plan
      return `You are an SDD agent. You MUST use your tools to execute commands and write files.
${projectCtx}
## Task: ${task.title}

## Spec:
${task.description}

## Acceptance Criteria:
${criteriaText}
${knowledgeSection}

## Instructions
${useSpeckit ? `1. Run the slash command /speckit.plan to generate the implementation plan.
   This creates plan.md, research.md, data-model.md, and contracts/ in the spec directory.
2. Review the generated plan for completeness:
   - Architecture decisions with rationale
   - File structure and module organization
   - Testing strategy
   - Risk identification
3. If speckit commands are not available, create the plan manually following the steps below.` : `1. Read the existing project structure and code to understand the codebase.
2. Create a detailed implementation plan:`}
${!useSpeckit ? `
- **Decompose** the task into subtasks ordered by dependency
- **Identify risks** and dependencies
- **Choose patterns** aligned with SOLID principles
- **Identify files** to create/modify with specific file paths
- **Define the testing strategy** (unit tests, integration tests)
- Be specific about file paths, function signatures, and data flow` : ''}

IMPORTANT: You MUST actually execute commands and write plan files — do NOT just describe what to do.
Do NOT write implementation code yet — only plan.`;

    case 2: { // Tasks + Implement (the critical phase)
      // Build subtasks section — only include PENDING tasks to save tokens.
      // Completed tasks don't need to be in the prompt.
      let subtasksSection = '';
      if (subtasks && subtasks.length > 0) {
        const pending = subtasks.filter((s) => !s.completed);
        const doneCount = subtasks.length - pending.length;
        if (pending.length > 0) {
          const lines = pending.map((s) => `- [ ] ${s.description}`);
          subtasksSection = `\n## Implementation Tasks (${doneCount}/${subtasks.length} completed — ${pending.length} remaining)
${lines.join('\n')}

CRITICAL: You MUST complete ALL ${pending.length} pending tasks above. Do NOT finish until every task is done. Work through them one by one in order.\n`;
        }
      }

      return `You are an SDD agent. You MUST use your tools to write code, create files, and run commands.
${projectCtx}
## Task: ${task.title}

## Spec:
${task.description}

## Acceptance Criteria:
${criteriaText}
${subtasksSection}${knowledgeSection}

## Instructions
${useSpeckit ? `1. Run the slash command /speckit.tasks to generate the task breakdown from the plan.
2. Run the slash command /speckit.implement to execute all tasks.
   This will:
   - Create/modify source files following the plan
   - Write tests FIRST (TDD: Red → Green → Refactor)
   - Run tests to verify they pass
   - Mark completed tasks in tasks.md

3. If speckit commands are not available, implement directly following TDD below.` : '1. Implement the task following TDD (Test-Driven Development):'}

${!useSpeckit ? 'Follow these steps:' : '### Fallback (if speckit is unavailable):'}
a. Write tests FIRST that cover all acceptance criteria — use your Edit tool to create test files
b. Run tests using your Bash tool — verify they fail (Red)
c. Write minimal code to make tests pass (Green) — use your Edit tool to create/modify source files
d. Refactor while keeping tests green
e. Repeat for each component
${subtasks && subtasks.length > 0 ? `
f. For EACH implementation task above, implement it fully before moving to the next one.
   Do NOT skip any task. Every pending task must be completed.` : ''}

4. Ensure ALL tests pass before finishing — run the test suite with your Bash tool.
5. Follow the project's existing coding standards and patterns.

IMPORTANT: You MUST write actual code files using your Edit tool and run tests using your Bash tool.
Do NOT just describe what to do — actually do it. Every acceptance criterion must be covered by a test.${subtasks && subtasks.length > 0 ? '\nDo NOT finish until ALL implementation tasks listed above are complete.' : ''}`;
    }

    case 3: { // Quality Gate
      // Optimization: truncate spec for review — the agent reviews changed files,
      // not the full spec. Keep first 500 chars as context summary.
      const specSummary = task.description.length > 500
        ? task.description.substring(0, 500) + '... [truncated — read full spec from project files if needed]'
        : task.description;

      return `You are an SDD agent performing a quality gate review. You MUST use your tools to verify code quality.

## Phase 3 — Quality Gate (IA Review)${reviewLoop ? ` — Review Loop ${reviewLoop + 1}` : ''}

### Task: ${task.title}

### Specification:
${specSummary}

### Acceptance Criteria:
${criteriaText}
${knowledgeSection}

## Instructions
Review ONLY the files modified in this task — do NOT review the entire codebase.

1. **Identify changed files** — run \`git status\` and \`git diff --name-only\` to get the list of modified files. ONLY review these files.
2. **Run all tests** using your Bash tool and verify they pass
3. **Read ONLY the changed files** using your Read tool and review:
   - Code quality: SOLID principles, clean code, no code smells
   - Security: No OWASP Top 10 vulnerabilities (injection, XSS, CSRF, etc.)
   - Spec compliance: changes match the specification and acceptance criteria
   - Performance: no obvious performance issues
4. **Check for regressions**: verify existing functionality is preserved

IMPORTANT: Focus exclusively on the changed files. Do NOT read or review files that were not modified.

## Required Output Format
If all checks pass, end your response with exactly:
\`[REVIEW_PASS]\`

If issues are found, end your response with:
\`[REVIEW_ISSUES]\`
Then list each issue:
\`[ISSUE] security: SQL injection risk in user input handler\`
\`[ISSUE] testing: Missing edge case test for empty array\`
\`[ISSUE] standards: Function exceeds 30 lines, consider decomposing\`

If you identify a reusable learning, wrap it in:
\`[KNOWLEDGE_ENTRY]
category: testing
severity: medium
title: Always test empty collections
description: Functions that accept collections should be tested with empty inputs
anti_pattern: Assuming collections always have at least one element
[/KNOWLEDGE_ENTRY]\`
${criteria.length > 0 ? `
## Per-Criterion Compliance Report
After your review, report the status of EACH acceptance criterion individually.
For every criterion, output a block like this:

\`[CRITERION_STATUS]
index: 1
met: true
note: Implemented via UserService.validate() with input sanitization
[/CRITERION_STATUS]\`

- \`index\`: 1-based criterion number matching the acceptance criteria list above
- \`met\`: true if the criterion is satisfied, false if not
- \`note\`: brief explanation of how it was met or why it was not

You MUST report a [CRITERION_STATUS] block for EVERY acceptance criterion.` : ''}`;
    }

    case 4: // Ship — no spec/knowledge needed, agent reads diff for PR description
      return `You are an SDD agent shipping code. You MUST use your Bash tool to execute git commands.

### Task: ${task.title}

## Instructions
You are already on the feature branch \`${task.branch_name || 'feature/<NNNN-name>'}\`. Ship the implementation:

1. **Check current branch** with \`git branch --show-current\` to confirm you're on the feature branch
2. **Review all changes** with \`git diff --stat\` and \`git diff\` to understand what was modified
3. **Stage all changes**: \`git add -A\`
4. **Create a conventional commit**: \`git commit -m "feat(scope): description"\` — use the task title as reference
5. **Push** the branch to origin: \`git push -u origin HEAD\`
6. **Create a Pull Request** using \`gh pr create\` with a detailed body. The PR must include:

### PR Title
Concise title matching the task (e.g. "feat(security): harden AJAX endpoints with nonce verification")

### PR Body — use this structure:
\`\`\`
## What
Brief summary of what this PR does (1-2 sentences).

## Why
The problem or need this solves. What was broken, missing, or being improved.

## Changes
- List each meaningful change with the file/area affected
- Group by category if needed (e.g. Security, Tests, Refactor)
- Be specific: "Added nonce verification to 5 AJAX handlers" not "improved security"

## Testing
- How the changes were tested (unit tests, manual, etc.)
- Key test cases added or modified

## Acceptance Criteria
${criteriaText}
\`\`\`

Base branch should be the default branch (main/master).

IMPORTANT: Do NOT create a new branch — you are already on the correct feature branch.
Use your Bash tool to execute all git commands. Read the diff carefully to write an accurate PR description — do NOT guess what changed.

## Required Output Format
After creating the PR, include these markers:
\`[PR_NUMBER:123]\` (the actual PR number)
\`[BRANCH:${task.branch_name || 'feature/...'}\`] (the actual branch name)`;

    default:
      return `## Task: ${task.title}\n\n${task.description}`;
  }
}

export function buildFixPrompt(
  task: TaskRow,
  _projectDescription: string,
  _knowledge: KnowledgeRow[],
  criteria: string[],
  issuesText: string
): string {
  // Optimization: fix prompts only need the issues + criteria for context.
  // The agent already has the codebase on disk and can read files as needed.
  // Skipping projectDescription and knowledge saves significant tokens per fix loop.
  const criteriaText = buildCriteriaSection(criteria);

  return `You are an SDD agent fixing quality gate issues. You MUST use your tools to modify code and run tests.

### Task: ${task.title}

### Acceptance Criteria:
${criteriaText}

## Issues Found in Review
${issuesText}

## Instructions
Fix ALL the issues listed above:
1. Read the relevant source files using your Read tool
2. Fix each issue using your Edit tool to modify the code
3. Run tests after each fix using your Bash tool to ensure no regressions
4. Ensure all tests pass when done
5. Do NOT introduce new issues while fixing existing ones

IMPORTANT: You MUST use your Edit tool to modify files and your Bash tool to run tests. Do NOT just describe fixes.`;
}

export function buildFetchFixPrompt(
  task: TaskRow,
  projectDescription: string,
  knowledge: KnowledgeRow[],
  criteria: string[],
  prComments: string
): string {
  const knowledgeSection = buildKnowledgeSection(knowledge);
  const criteriaText = buildCriteriaSection(criteria);
  const projectCtx = projectDescription ? `\n## Project Context\n${projectDescription}\n` : '';

  return `You are an SDD agent addressing PR feedback. You MUST use your tools to modify code, run tests, and push changes.
${projectCtx}
### Task: ${task.title}

### Specification:
${task.description}

### Acceptance Criteria:
${criteriaText}
${knowledgeSection}

## PR Comments / Review Feedback
${prComments}

## Instructions
Address the PR feedback using your tools:

1. **Analyze** each comment/review critically. Pay attention to:
   - Direct comments describing what to change
   - **\`\`\`suggestion\`\`\` blocks** — these are code replacements proposed by the reviewer
   - **Code context** (diffHunk) — shows the actual code the comment refers to
2. **Evaluate** each suggestion on its technical merit:
   - Does it align with the project's architecture and patterns?
   - Does it improve security, performance, or maintainability?
   - Could it introduce regressions or break existing functionality?
   - Is it consistent with the acceptance criteria and spec?
3. **If you agree**: Apply the fix using your Edit tool, then mark it resolved: \`[RESOLVED_THREAD:threadId]\`
4. **If you disagree or partially agree**: Do NOT apply the suggestion blindly. Instead:
   a. Add an inline code comment in the relevant file explaining WHY the current approach is kept. Use this format:
      \`// PR-review: <concise justification why this approach is correct>\`
   b. Reply in the thread: \`[THREAD_REPLY:threadId]\nYour technical justification here\n[/THREAD_REPLY]\`
5. **Read** the relevant source files to understand the full context before deciding
6. **Run all tests** using your Bash tool to ensure nothing is broken
7. **Commit** the fixes: \`git add . && git commit -m "fix(scope): address PR feedback"\`
   In the commit message body, summarize which suggestions were accepted and which were rejected with reasons.
8. **Push** to the same branch: \`git push\`

IMPORTANT: You MUST use your tools to actually modify files, run tests, commit, and push.
Do NOT create a new PR. Push to the existing branch: \`${task.branch_name || 'current branch'}\`
Do NOT accept suggestions blindly — analyze each one. If a suggestion would break functionality, reduce code quality, or contradict the spec, reject it with justification both in the code (inline comment) and in the PR thread ([THREAD_REPLY]).

## Knowledge Capture
If any PR feedback reveals a reusable pattern or common mistake (severity Critical, High, or Medium), capture it as a learning:

\`[KNOWLEDGE_ENTRY]
category: security
severity: high
title: Short descriptive title
description: What the issue was and how to avoid it in future code
anti_pattern: The wrong pattern that was used
[/KNOWLEDGE_ENTRY]\`

Only emit entries for genuinely reusable learnings — not one-off typos or trivial fixes.`;
}

export function buildSingleThreadPrompt(
  task: TaskRow,
  projectDescription: string,
  knowledge: KnowledgeRow[],
  criteria: string[],
  input: ThreadPromptInput,
  previousActions?: string[],
  branchHistory?: string,
  prFiles?: string
): string {
  const knowledgeSection = buildKnowledgeSection(knowledge);
  const criteriaText = buildCriteriaSection(criteria);
  const projectCtx = projectDescription ? `\n## Project Context\n${projectDescription}\n` : '';

  let feedbackSection = '';
  if (input.type === 'general') {
    feedbackSection = `### General PR Comments\n${input.content}`;
  } else {
    const t = input.thread;
    const loc = `${t.file}${t.line ? ':' + t.line : ''}`;
    feedbackSection = `### Review Thread [${t.id}]\nFile: ${loc}\n`;
    if (t.diffHunk) {
      feedbackSection += `\nCode being reviewed:\n\`\`\`\n${t.diffHunk}\n\`\`\`\n`;
    }
    feedbackSection += `\nReviewer comments:\n`;
    for (const c of t.comments) {
      feedbackSection += `[${c.author}]: ${c.body}\n`;
    }
  }

  const isThread = input.type === 'thread';
  const threadId = isThread ? input.thread.id : '';

  // For general comments, use a different marker format since there are no thread IDs
  const isGeneral = input.type === 'general';

  const branchHistorySection = branchHistory
    ? `\n## Branch Commit History (all review cycles)
These are all commits on this feature branch. Commits prefixed with \`fix(pr-review):\` show what was changed in previous review cycles — including what was accepted and rejected:
\`\`\`
${branchHistory}
\`\`\`
IMPORTANT: If this comment asks to revert or remove something that was deliberately added or kept in a previous review cycle, flag the contradiction and justify which approach is correct.\n`
    : '';

  const prevActionsSection = previousActions && previousActions.length > 0
    ? `\n## Previous Actions (this review cycle)
The following changes were already applied while processing earlier review threads in THIS cycle. Be aware of them to avoid contradictions or regressions:
${previousActions.join('\n')}

IMPORTANT: If this comment asks you to undo, remove, or contradict something that was already applied above, DO NOT blindly apply it. Instead, flag the contradiction in your [THREAD_REPLY] and explain which approach is correct based on the spec and acceptance criteria.\n`
    : '';

  return `You are an SDD agent addressing a single PR review comment. Focus ONLY on this specific issue.
${projectCtx}${branchHistorySection}${prevActionsSection}
### Task: ${task.title}

### Acceptance Criteria:
${criteriaText}
${knowledgeSection}

## Review Feedback
${feedbackSection}

## Instructions

### SCOPE RULES — READ CAREFULLY
${prFiles ? `Files modified in this PR (ONLY these files may be touched):\n${prFiles.split('\n').map((f: string) => '- ' + f).join('\n')}\n` : ''}- You may ONLY modify lines that were CHANGED in this PR. Run \`git diff main...HEAD -- <file>\` to see which lines belong to this PR. NEVER touch lines outside the PR diff.
- You may ONLY modify the specific file(s) mentioned in the review comment
- Make the MINIMUM change needed to address the comment — do NOT refactor, reorganize, or "improve" surrounding code
- Do NOT add new files, rename files, or restructure the project
- Do NOT fix things that the reviewer did NOT ask about
- If the reviewer comments on a line that was NOT modified in this PR, REJECT the suggestion and explain that the line is outside the PR scope
- If the fix truly requires changes beyond the mentioned file, explain why in your [THREAD_REPLY] and ONLY make the strictly necessary cross-file changes

### Analysis
1. **Analyze** the reviewer's feedback critically:
   - Is the suggestion technically correct?
   - Does it align with the project's architecture and patterns?
   - Does it improve security, performance, or maintainability?
   - Could it introduce regressions or break existing functionality?
   - Is it consistent with the acceptance criteria?
   - If the comment includes a \`\`\`suggestion\`\`\` block, that is an exact code replacement proposed by the reviewer.
2. **Read** the relevant source file(s) using your Read tool to understand context

### Action
${isGeneral ? `For EACH comment/suggestion in the general comments, output a separate reply block.
Use a short descriptive label (e.g. the severity + topic) as the identifier.

3. **If you agree**: Apply the MINIMAL fix using your Edit tool, then output:
   \`[RESOLVED_THREAD:SHORT_LABEL — topic]\`
   \`[THREAD_REPLY:SHORT_LABEL — topic]\`
   Brief description of what was changed.
   \`[/THREAD_REPLY]\`
4. **If you disagree or it's out of scope**: Do NOT apply the suggestion. Instead output:
   \`[THREAD_REPLY:SHORT_LABEL — topic]\`
   Your technical justification for rejecting.
   \`[/THREAD_REPLY]\`

**IMPORTANT**: You MUST output one [THREAD_REPLY] block per comment — both when accepting AND when rejecting.` : `3. **If you agree**: Apply the MINIMAL fix using your Edit tool, then output:
   \`[RESOLVED_THREAD:${threadId}]\`
   \`[THREAD_REPLY:${threadId}]\`
   Brief description of what was changed (e.g. "Applied: added null check on line 42 as suggested.")
   \`[/THREAD_REPLY]\`
4. **If you disagree**: Do NOT apply the suggestion. Instead:
   a. Add an inline code comment: \`// PR-review: <concise justification>\`
   b. Output:
   \`[THREAD_REPLY:${threadId}]\`
   Your technical justification for rejecting the suggestion.
   \`[/THREAD_REPLY]\`

**IMPORTANT**: You MUST always output a [THREAD_REPLY] block — both when accepting AND when rejecting.
When accepting, briefly describe what you changed. When rejecting, explain why.`}

5. **Run tests** using your Bash tool to verify no regressions
6. Do **NOT** commit or push — that will be done after all threads are processed

## Knowledge Capture
If this feedback reveals a reusable pattern (severity Critical/High/Medium):

\`[KNOWLEDGE_ENTRY]
category: security|testing|architecture|standards|performance
severity: critical|high|medium
title: Short descriptive title
description: What the issue was and how to avoid it
anti_pattern: The wrong pattern
[/KNOWLEDGE_ENTRY]\``;
}
