import { describe, expect, it } from 'vitest';
import { CANVAS_GLOBAL_MEMORY_KEY, memoryKeysForScope } from '../keys';

describe('memoryKeysForScope', () => {
  it('maps a workspace scope to a per-workspace bucket + the shared global bucket', () => {
    const keys = memoryKeysForScope({ kind: 'workspace', workspaceId: 'w1' });
    expect(keys.workspaceKey).toBe('canvas:ws:w1');
    expect(keys.globalKey).toBe(CANVAS_GLOBAL_MEMORY_KEY);
  });

  it('collapses the global chat agent so its workspace bucket IS the global bucket', () => {
    const keys = memoryKeysForScope({ kind: 'global' });
    expect(keys.workspaceKey).toBe(CANVAS_GLOBAL_MEMORY_KEY);
    expect(keys.globalKey).toBe(CANVAS_GLOBAL_MEMORY_KEY);
  });
});
