// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useMcpAppApproval } from '../useMcpAppApproval';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const request = { requestId: 'r1', serverName: 'app', toolName: 'save', argumentsPreview: '{}', argumentsSize: 2, truncated: false };

it('cancels pending and late approvals after frame error or unmount', async () => {
  let hook!: ReturnType<typeof useMcpAppApproval>;
  const Probe = ({ closed }: { closed: boolean }) => { hook = useMcpAppApproval(closed); return null; };
  const root = createRoot(document.createElement('div'));
  await act(async () => { root.render(<Probe closed={false} />); });
  let pending!: Promise<string>;
  await act(async () => { pending = hook.ask(request); });
  await act(async () => { root.render(<Probe closed />); });
  expect(await pending).toBe('cancel');
  expect(hook.request).toBeUndefined();
  expect(await hook.ask(request)).toBe('cancel');
  await act(async () => { root.render(<Probe closed={false} />); });
  await act(async () => { pending = hook.ask(request); });
  const lateAsk = hook.ask;
  await act(async () => { root.unmount(); });
  expect(await pending).toBe('cancel');
  expect(await lateAsk(request)).toBe('cancel');
});
