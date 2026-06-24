import { describe, expect, it } from 'vitest';
import {
  nodeIdFromHref,
  nodeLinkHref,
  parseNodeLinkHref,
} from './openNodeBridge';

describe('openNodeBridge node links', () => {
  it('builds and parses node links with workspace identity', () => {
    const href = nodeLinkHref('node 1/2', 'ws-main');

    expect(href).toBe('pulse-canvas://node/node%201%2F2?workspace=ws-main');
    expect(parseNodeLinkHref(href)).toEqual({
      nodeId: 'node 1/2',
      workspaceId: 'ws-main',
    });
  });

  it('round-trips encoded workspace ids without double-decoding', () => {
    const href = nodeLinkHref('n?1', 'ws 100%');

    expect(href).toBe('pulse-canvas://node/n%3F1?workspace=ws%20100%25');
    expect(parseNodeLinkHref(href)).toEqual({
      nodeId: 'n?1',
      workspaceId: 'ws 100%',
    });
  });

  it('parses legacy node links without workspace identity', () => {
    expect(parseNodeLinkHref('pulse-canvas://node/n1')).toEqual({
      nodeId: 'n1',
      workspaceId: undefined,
    });
    expect(nodeIdFromHref('pulse-canvas://node/n1')).toBe('n1');
  });

  it('ignores non-node links and malformed ids', () => {
    expect(parseNodeLinkHref('https://example.com')).toBeNull();
    expect(parseNodeLinkHref('pulse-canvas://node/')).toBeNull();
    expect(parseNodeLinkHref('pulse-canvas://node/%E0%A4%A')).toBeNull();
  });
});
