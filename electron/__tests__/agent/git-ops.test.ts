import { describe, it, expect } from 'vitest';
import { slugify } from '../../ipc/agent/git-ops';

describe('slugify', () => {
  it('should convert title to lowercase slug', () => {
    expect(slugify('Add User Authentication')).toBe('add-user-authentication');
  });

  it('should replace non-alphanumeric characters with hyphens', () => {
    expect(slugify('Fix (bug) [v2.0]!')).toBe('fix-bug-v2-0');
  });

  it('should strip leading and trailing hyphens', () => {
    expect(slugify('---Hello World---')).toBe('hello-world');
  });

  it('should truncate to 50 characters', () => {
    const longTitle = 'A'.repeat(100);
    expect(slugify(longTitle).length).toBe(50);
  });

  it('should handle empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('should collapse multiple hyphens into one', () => {
    expect(slugify('foo   bar   baz')).toBe('foo-bar-baz');
  });

  it('should handle special characters', () => {
    expect(slugify('feat: add @user #login')).toBe('feat-add-user-login');
  });

  it('should handle unicode by removing non-ascii', () => {
    expect(slugify('café résumé')).toBe('caf-r-sum');
  });
});
