import { describe, expect, it, vi } from 'vitest';
import { observePageLinkRequests, reportPageLinkRequest } from './page-link-events';

describe('page link request observation', () => {
  it('keeps workspace, node and guest identity qualified and supports disposal', () => {
    const source = { workspaceId: 'ws', nodeId: 'node', webContentsId: 7 };
    const receive = vi.fn();
    const off = observePageLinkRequests(source, receive);
    reportPageLinkRequest({ ...source, webContentsId: 8 }, 'https://example.test');
    reportPageLinkRequest({ ...source, nodeId: 'other' }, 'https://example.test');
    expect(receive).not.toHaveBeenCalled();
    reportPageLinkRequest(source, 'https://example.test');
    expect(receive).toHaveBeenCalledTimes(1);
    off();
    reportPageLinkRequest(source, 'https://example.test/next');
    expect(receive).toHaveBeenCalledTimes(1);
  });
});
