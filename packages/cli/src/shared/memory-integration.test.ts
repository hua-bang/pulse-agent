import { describe, expect, it, vi } from 'vitest';

describe('memory integration', () => {
  it('does not construct the memory service on module import', async () => {
    vi.resetModules();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('./memory-integration.js');

    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('[memory-service]'));
    log.mockRestore();
  });
});
