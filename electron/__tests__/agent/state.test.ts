import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  activeControllers,
  specResolvers,
  planResolvers,
  pushResolvers,
  fixTestsResolvers,
  checkAborted,
  getSettingValue,
  sendLog,
  sendPhaseUpdate,
} from '../../ipc/agent/state';

describe('checkAborted', () => {
  it('should throw AbortError when controller is aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => checkAborted(controller)).toThrow('Aborted');
    try {
      checkAborted(controller);
    } catch (err) {
      expect((err as Error).name).toBe('AbortError');
    }
  });

  it('should not throw when controller is not aborted', () => {
    const controller = new AbortController();
    expect(() => checkAborted(controller)).not.toThrow();
  });
});

describe('getSettingValue', () => {
  it('should return the parsed value when key exists', () => {
    const mockQ = {
      getSetting: {
        get: vi.fn().mockReturnValue({ value: '10' }),
      },
    } as unknown as Parameters<typeof getSettingValue>[0];
    expect(getSettingValue(mockQ, 'max_concurrent', 3)).toBe(10);
  });

  it('should return default when key does not exist', () => {
    const mockQ = {
      getSetting: {
        get: vi.fn().mockReturnValue(undefined),
      },
    } as unknown as Parameters<typeof getSettingValue>[0];
    expect(getSettingValue(mockQ, 'missing_key', 5)).toBe(5);
  });

  it('should return default when value is not a valid number', () => {
    const mockQ = {
      getSetting: {
        get: vi.fn().mockReturnValue({ value: 'not-a-number' }),
      },
    } as unknown as Parameters<typeof getSettingValue>[0];
    expect(getSettingValue(mockQ, 'bad_value', 7)).toBe(7);
  });
});

describe('resolver maps', () => {
  beforeEach(() => {
    activeControllers.clear();
    specResolvers.clear();
    planResolvers.clear();
    pushResolvers.clear();
    fixTestsResolvers.clear();
  });

  it('should store and retrieve abort controllers', () => {
    const controller = new AbortController();
    activeControllers.set('task-1', controller);
    expect(activeControllers.get('task-1')).toBe(controller);
    expect(activeControllers.size).toBe(1);
  });

  it('should store and invoke spec resolvers', () => {
    const resolver = vi.fn();
    specResolvers.set('task-1', resolver);
    specResolvers.get('task-1')!({ action: 'accept' });
    expect(resolver).toHaveBeenCalledWith({ action: 'accept' });
  });

  it('should store and invoke plan resolvers', () => {
    const resolver = vi.fn();
    planResolvers.set('task-1', resolver);
    planResolvers.get('task-1')!({ action: 'approve' });
    expect(resolver).toHaveBeenCalledWith({ action: 'approve' });
  });

  it('should store and invoke push resolvers', () => {
    const resolver = vi.fn();
    pushResolvers.set('task-1', resolver);
    pushResolvers.get('task-1')!({ action: 'reject' });
    expect(resolver).toHaveBeenCalledWith({ action: 'reject' });
  });

  it('should store and invoke fixTests resolvers', () => {
    const resolver = vi.fn();
    fixTestsResolvers.set('task-1', resolver);
    fixTestsResolvers.get('task-1')!();
    expect(resolver).toHaveBeenCalled();
  });
});

describe('sendLog', () => {
  it('should send log via IPC and save to DB', () => {
    const mockWindow = {
      webContents: { send: vi.fn() },
    };
    const mockGetWindow = vi.fn().mockReturnValue(mockWindow);
    const mockQ = { insertLog: { run: vi.fn() } } as unknown as Parameters<typeof sendLog>[0];

    sendLog(mockQ, mockGetWindow, 'task-1', 'MyProject', 'Test message', 'info');

    expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:log', {
      taskId: 'task-1',
      projectName: 'MyProject',
      message: 'Test message',
      kind: 'info',
    });
    expect(mockQ.insertLog.run).toHaveBeenCalledWith('task-1', 'MyProject', 'Test message', 'info');
  });

  it('should still save to DB when window is null', () => {
    const mockGetWindow = vi.fn().mockReturnValue(null);
    const mockQ = { insertLog: { run: vi.fn() } } as unknown as Parameters<typeof sendLog>[0];

    sendLog(mockQ, mockGetWindow, 'task-1', 'MyProject', 'Test message', 'info');

    expect(mockQ.insertLog.run).toHaveBeenCalledWith('task-1', 'MyProject', 'Test message', 'info');
  });
});

describe('sendPhaseUpdate', () => {
  it('should send phase update via IPC', () => {
    const mockWindow = {
      webContents: { send: vi.fn() },
    };
    const mockGetWindow = vi.fn().mockReturnValue(mockWindow);
    const update = { taskId: 'task-1', phase: 0, phaseLabel: 'spec_review', status: 'started' };

    sendPhaseUpdate(mockGetWindow, update);

    expect(mockWindow.webContents.send).toHaveBeenCalledWith('agent:phaseUpdate', update);
  });

  it('should not throw when window is null', () => {
    const mockGetWindow = vi.fn().mockReturnValue(null);
    expect(() => sendPhaseUpdate(mockGetWindow, { taskId: 't', phase: 0, phaseLabel: 'x', status: 'y' })).not.toThrow();
  });
});
