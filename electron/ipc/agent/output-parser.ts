import { v4 as uuidv4 } from 'uuid';
import type { ParsedResult, Queries } from './types';

// ── Output Parsers ─────────────────────────────────────────────────────────────

export function parsePhaseOutput(phase: number, output: string): ParsedResult {
  const result: ParsedResult = {};

  if (phase === 0) {
    result.specOk = output.includes('[SPEC_OK]');
    result.specIncomplete = output.includes('[SPEC_INCOMPLETE]');
    result.suggestions = [];
    const suggestionRegex = /\[SUGGESTION\]\s*(.+)/g;
    let match;
    while ((match = suggestionRegex.exec(output)) !== null) {
      result.suggestions.push(match[1].trim());
    }
  }

  if (phase === 3) {
    result.reviewPass = output.includes('[REVIEW_PASS]');
    result.reviewIssues = output.includes('[REVIEW_ISSUES]');
    result.issues = [];
    const issueRegex = /\[ISSUE\]\s*(\w+):\s*(.+)/g;
    let match;
    while ((match = issueRegex.exec(output)) !== null) {
      result.issues.push({ category: match[1], description: match[2].trim() });
    }

    // Parse knowledge entries
    result.knowledgeEntries = [];
    const knowledgeRegex = /\[KNOWLEDGE_ENTRY\]([\s\S]*?)\[\/KNOWLEDGE_ENTRY\]/g;
    let keMatch;
    while ((keMatch = knowledgeRegex.exec(output)) !== null) {
      const block = keMatch[1];
      const entry = {
        category: extractField(block, 'category') || 'standards',
        severity: extractField(block, 'severity') || 'medium',
        title: extractField(block, 'title') || 'Untitled',
        description: extractField(block, 'description') || '',
        antiPattern: extractField(block, 'anti_pattern'),
        codeExample: extractField(block, 'code_example'),
      };
      result.knowledgeEntries.push(entry);
    }

    // Parse criterion status blocks
    result.criteriaStatus = [];
    const criterionRegex = /\[CRITERION_STATUS\]([\s\S]*?)\[\/CRITERION_STATUS\]/g;
    let csMatch;
    while ((csMatch = criterionRegex.exec(output)) !== null) {
      const block = csMatch[1];
      const idx = extractField(block, 'index');
      const met = extractField(block, 'met');
      const note = extractField(block, 'note');
      if (idx) {
        result.criteriaStatus.push({
          index: parseInt(idx, 10),
          met: met?.toLowerCase() === 'true',
          note: note || undefined,
        });
      }
    }

    // Parse resolved thread IDs (from Fetch & Fix output)
    result.resolvedThreadIds = [];
    const threadRegex = /\[RESOLVED_THREAD:([^\]]+)\]/g;
    let threadMatch;
    while ((threadMatch = threadRegex.exec(output)) !== null) {
      result.resolvedThreadIds.push(threadMatch[1].trim());
    }

    // Parse thread replies — justifications for rejected/partially-accepted suggestions
    result.threadReplies = [];
    const replyRegex = /\[THREAD_REPLY:([^\]]+)\]\n([\s\S]*?)\[\/THREAD_REPLY\]/g;
    let replyMatch;
    while ((replyMatch = replyRegex.exec(output)) !== null) {
      result.threadReplies.push({ threadId: replyMatch[1].trim(), body: replyMatch[2].trim() });
    }
  }

  if (phase === 4) {
    const prMatch = output.match(/\[PR_NUMBER:(\d+)\]/);
    if (prMatch) result.prNumber = parseInt(prMatch[1], 10);
    const branchMatch = output.match(/\[BRANCH:([^\]]+)\]/);
    if (branchMatch) result.branchName = branchMatch[1].trim();
  }

  return result;
}

export function extractField(block: string, field: string): string | undefined {
  const regex = new RegExp(`${field}:\\s*(.+)`, 'i');
  const match = regex.exec(block);
  return match ? match[1].trim() : undefined;
}

// ── Knowledge Saver ────────────────────────────────────────────────────────────

export function saveKnowledgeEntries(
  entries: ParsedResult['knowledgeEntries'],
  projectId: string,
  taskId: string,
  q: Queries
) {
  if (!entries) return;
  for (const entry of entries) {
    const id = uuidv4();
    q.insertKnowledge.run(
      id, projectId, entry.category, entry.severity, entry.title,
      entry.description, taskId, null, entry.codeExample || null,
      entry.antiPattern || null, '[]'
    );
  }
}
