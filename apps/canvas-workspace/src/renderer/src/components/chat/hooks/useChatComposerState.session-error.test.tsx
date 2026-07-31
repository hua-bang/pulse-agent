// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockState = vi.hoisted(() => ({
  sessionLoading: false,
  sessionError: null as { message: string } | null,
  isSubmitBlocked: undefined as (() => boolean) | undefined,
}));

vi.mock('../ModelSettings', () => ({
  useCanvasModels: () => ({ selectedLabel: 'Auto' }),
}));

vi.mock('./useChatStream', () => ({
  useChatStream: () => ({
    replaceMessages: vi.fn(),
  }),
}));

vi.mock('./useChatSessions', () => ({
  useChatSessions: () => ({
    adoptActiveSession: vi.fn(),
    sessionLoading: mockState.sessionLoading,
    sessionError: mockState.sessionError,
  }),
}));

vi.mock('./useMentions', () => ({
  useMentions: (options: { isSubmitBlocked?: () => boolean }) => {
    mockState.isSubmitBlocked = options.isSubmitBlocked;
    return {};
  },
}));

import { useChatComposerState } from './useChatComposerState';

const Probe = () => {
  useChatComposerState({ agentScope: { kind: 'global' } });
  return null;
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  mockState.sessionLoading = false;
  mockState.sessionError = null;
  mockState.isSubmitBlocked = undefined;
});

describe('useChatComposerState session mutation guard', () => {
  it('blocks every composer submit path until the session error is resolved', () => {
    host = document.createElement('div');
    root = createRoot(host);
    act(() => root?.render(<Probe />));
    expect(mockState.isSubmitBlocked?.()).toBe(false);

    mockState.sessionError = { message: 'Unable to open conversation' };
    act(() => root?.render(<Probe />));
    expect(mockState.isSubmitBlocked?.()).toBe(true);

    mockState.sessionError = null;
    act(() => root?.render(<Probe />));
    expect(mockState.isSubmitBlocked?.()).toBe(false);
  });
});
