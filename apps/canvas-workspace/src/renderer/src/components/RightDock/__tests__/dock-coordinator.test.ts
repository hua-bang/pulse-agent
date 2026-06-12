import { describe, expect, it, vi } from 'vitest';
import { DockCoordinator } from '../dock-coordinator';

describe('DockCoordinator', () => {
  it('claims the dock for a panel', () => {
    const dock = new DockCoordinator();
    dock.claim({ id: 'artifact', onEvict: vi.fn() });
    expect(dock.activeId).toBe('artifact');
  });

  it('evicts the previous owner when another panel claims', () => {
    const dock = new DockCoordinator();
    const evictArtifact = vi.fn();
    dock.claim({ id: 'artifact', onEvict: evictArtifact });
    dock.claim({ id: 'link', onEvict: vi.fn() });
    expect(evictArtifact).toHaveBeenCalledTimes(1);
    expect(dock.activeId).toBe('link');
  });

  it('does not evict when the same panel re-claims', () => {
    const dock = new DockCoordinator();
    const onEvict = vi.fn();
    dock.claim({ id: 'artifact', onEvict });
    dock.claim({ id: 'artifact', onEvict });
    expect(onEvict).not.toHaveBeenCalled();
    expect(dock.activeId).toBe('artifact');
  });

  it('releases only when the caller is the current owner', () => {
    const dock = new DockCoordinator();
    dock.claim({ id: 'artifact', onEvict: vi.fn() });
    dock.claim({ id: 'link', onEvict: vi.fn() });
    // Evicted panel releasing late must not clear the new owner's claim.
    dock.release('artifact');
    expect(dock.activeId).toBe('link');
    dock.release('link');
    expect(dock.activeId).toBeNull();
  });
});
