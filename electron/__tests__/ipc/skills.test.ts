import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateProjectPath, readSettingSources, writeSettingSources } from '../../ipc/skills';

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import fs from 'fs';

describe('validateProjectPath', () => {
  it('should accept a valid absolute path', () => {
    const result = validateProjectPath('/home/user/projects/my-app');
    expect(result).toBe('/home/user/projects/my-app');
  });

  it('should reject a relative path', () => {
    expect(() => validateProjectPath('relative/path')).toThrow('Project path must be absolute');
  });

  it('should reject a path starting with dot', () => {
    expect(() => validateProjectPath('./relative/path')).toThrow('Project path must be absolute');
  });

  it('should normalize paths with trailing slashes', () => {
    const result = validateProjectPath('/home/user/projects/');
    expect(result).toBe('/home/user/projects');
  });

  it('should accept deeply nested paths', () => {
    const result = validateProjectPath('/home/user/deep/nested/project/path');
    expect(result).toBe('/home/user/deep/nested/project/path');
  });
});

describe('readSettingSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array if file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = readSettingSources('/some/path/settings.json');
    expect(result).toEqual([]);
  });

  it('should return settingSources from valid JSON', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      settingSources: ['skill-a', 'skill-b'],
    }));
    const result = readSettingSources('/some/path/settings.json');
    expect(result).toEqual(['skill-a', 'skill-b']);
  });

  it('should return empty array if settingSources is not an array', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      settingSources: 'not-an-array',
    }));
    const result = readSettingSources('/some/path/settings.json');
    expect(result).toEqual([]);
  });

  it('should return empty array on parse error', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('invalid json{{{');
    const result = readSettingSources('/some/path/settings.json');
    expect(result).toEqual([]);
  });

  it('should return empty array if settingSources key is missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ otherKey: 'value' }));
    const result = readSettingSources('/some/path/settings.json');
    expect(result).toEqual([]);
  });
});

describe('writeSettingSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create directory if it does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    writeSettingSources('/some/new/path/settings.json', ['skill-a']);
    expect(fs.mkdirSync).toHaveBeenCalledWith('/some/new/path', { recursive: true });
  });

  it('should preserve existing JSON keys when writing', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) =>
      String(p).endsWith('settings.json') ? true : true
    );
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      existingKey: 'preserved',
      settingSources: ['old-skill'],
    }));

    writeSettingSources('/some/path/settings.json', ['new-skill']);

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string);
    expect(written.existingKey).toBe('preserved');
    expect(written.settingSources).toEqual(['new-skill']);
  });
});
