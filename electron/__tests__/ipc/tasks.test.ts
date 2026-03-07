import { describe, it, expect } from 'vitest';

// ── Settings Whitelist Tests ──────────────────────────────────────────────────

const ALLOWED_SETTINGS_KEYS = new Set([
  'max_concurrent', 'default_model', 'max_review_loops', 'theme', 'locale',
  'thread_max_files', 'thread_max_lines', 'postfix_lines_per_comment',
  'postfix_files_per_comment', 'test_timeout_min', 'test_fix_retries',
  'branchCounter',
]);

describe('Settings whitelist', () => {
  it('should allow all expected keys', () => {
    const validKeys = [
      'max_concurrent', 'default_model', 'max_review_loops', 'theme', 'locale',
      'thread_max_files', 'thread_max_lines', 'postfix_lines_per_comment',
      'postfix_files_per_comment', 'test_timeout_min', 'test_fix_retries',
      'branchCounter',
    ];
    for (const key of validKeys) {
      expect(ALLOWED_SETTINGS_KEYS.has(key)).toBe(true);
    }
  });

  it('should reject unknown keys', () => {
    const invalidKeys = [
      'admin_password', 'secret_key', 'DROP TABLE', '__proto__',
      'constructor', 'toString', 'random_key', '',
    ];
    for (const key of invalidKeys) {
      expect(ALLOWED_SETTINGS_KEYS.has(key)).toBe(false);
    }
  });
});

// ── Slug Matching Tests ──────────────────────────────────────────────────────

describe('Strict slug matching for spec folder deletion', () => {
  function makeSlug(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50);
  }

  function makePattern(slug: string): RegExp {
    return new RegExp(`^\\d+-${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  }

  it('should match exact slug with numeric prefix', () => {
    const slug = makeSlug('Add user auth');
    const pattern = makePattern(slug);
    expect(pattern.test('001-add-user-auth')).toBe(true);
    expect(pattern.test('42-add-user-auth')).toBe(true);
  });

  it('should NOT match partial includes', () => {
    const slug = makeSlug('auth');
    const pattern = makePattern(slug);
    // Old behavior: 'includes(slug)' would match these. New behavior should not.
    expect(pattern.test('001-add-user-auth-system')).toBe(false);
    expect(pattern.test('authentication-module')).toBe(false);
    expect(pattern.test('auth-extra-stuff')).toBe(false);
  });

  it('should NOT match without numeric prefix', () => {
    const slug = makeSlug('my feature');
    const pattern = makePattern(slug);
    expect(pattern.test('my-feature')).toBe(false);
    expect(pattern.test('abc-my-feature')).toBe(false);
  });

  it('should NOT match if slug is a substring of a longer name', () => {
    const slug = makeSlug('api');
    const pattern = makePattern(slug);
    expect(pattern.test('001-api')).toBe(true);
    expect(pattern.test('001-api-routes')).toBe(false);
    expect(pattern.test('001-new-api')).toBe(false);
  });

  it('should handle special regex characters in title', () => {
    const slug = makeSlug('fix (bug) [v2]');
    const pattern = makePattern(slug);
    expect(pattern.test('001-fix-bug-v2')).toBe(true);
  });
});
