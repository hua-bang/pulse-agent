// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { setOpenSkillChatContext } from '../../../../../../shared/skillChatContext';
import { useChatPanelContext } from '../useChatPanelContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ContextResult = ReturnType<typeof useChatPanelContext>;

const renderContext = () => {
  const result: { current?: ContextResult } = {};
  const host = document.createElement('div');
  const root = createRoot(host);
  const Harness = () => {
    result.current = useChatPanelContext({ executionMode: 'auto' });
    return null;
  };
  act(() => root.render(<Harness />));
  return { result, unmount: () => act(() => root.unmount()) };
};

describe('useChatPanelContext', () => {
  afterEach(() => setOpenSkillChatContext(null));

  it('shows the open skill as page context and sends it with the turn', () => {
    const { result, unmount } = renderContext();
    expect(result.current?.selectedContext).toEqual([]);

    const skill = { name: 'Weekly report', scope: 'global' as const, path: '/skills/weekly/SKILL.md' };
    act(() => setOpenSkillChatContext(skill));

    expect(result.current?.selectedContext).toEqual([{
      key: 'skill:/skills/weekly/SKILL.md',
      kind: 'skill',
      label: 'Weekly report',
      removable: false,
    }]);
    expect(result.current?.requestContext.skills).toEqual([skill]);
    expect(result.current?.requestContext.scope).toBe('current_canvas');

    act(() => setOpenSkillChatContext(null));
    expect(result.current?.selectedContext).toEqual([]);
    expect(result.current?.requestContext.skills).toBeUndefined();
    unmount();
  });
});
