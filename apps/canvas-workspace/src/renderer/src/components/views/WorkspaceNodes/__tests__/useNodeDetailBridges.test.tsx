// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenNodeDetail } from '../../../../utils/openNodeBridge';
import { useNodeDetailBridges } from '../useNodeDetailBridges';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

interface Props {
  enterNodePage: (workspaceId: string, nodeId: string) => void;
  pageNode: OpenNodeDetail | null;
}

const Harness = ({ enterNodePage, pageNode }: Props) => {
  useNodeDetailBridges({
    activeWorkspaceId: 'active-workspace',
    enabled: true,
    enterNodePage,
    pageNode,
    openNodePage: vi.fn(),
    focusNodeOnCanvas: vi.fn(),
  });
  return null;
};

describe('useNodeDetailBridges', () => {
  it('applies the dock/page exclusion boundary to direct detail routes exactly once per node', () => {
    const enterNodePage = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(<Harness enterNodePage={enterNodePage} pageNode={{ workspaceId: 'ws-1', nodeId: 'node-1' }} />);
    });
    expect(enterNodePage).toHaveBeenCalledWith('ws-1', 'node-1');

    act(() => {
      root?.render(<Harness enterNodePage={enterNodePage} pageNode={{ workspaceId: 'ws-1', nodeId: 'node-1' }} />);
    });
    expect(enterNodePage).toHaveBeenCalledTimes(1);
  });
});
