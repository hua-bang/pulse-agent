// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../../shell/AppShellProvider';
import { useStartSkillChat } from './useStartSkillChat';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useStartSkillChat', () => {
  it('creates a clean session before inserting the Skill mention', async () => {
    let start: ((skillName: string) => Promise<void>) | undefined;
    let finishNewSession: (() => void) | undefined;
    const clearInput = vi.fn();
    const insertSkillMention = vi.fn();
    const setSessionBackStack = vi.fn();
    const handleNewSession = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => {
      finishNewSession = () => resolve({ ok: true });
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const Harness = () => {
      useStartSkillChat({
        loading: false,
        clearInput,
        handleNewSession,
        insertSkillMention,
        setSessionBackStack,
        onRegister: (handler) => {
          start = handler;
          return () => undefined;
        },
      });
      return null;
    };
    act(() => root.render(
      <I18nProvider>
        <AppShellProvider>
          <Harness />
        </AppShellProvider>
      </I18nProvider>,
    ));

    await act(async () => {
      void start?.('memory-review');
      await Promise.resolve();
    });
    expect(handleNewSession).toHaveBeenCalledOnce();
    expect(setSessionBackStack).not.toHaveBeenCalled();
    expect(clearInput).not.toHaveBeenCalled();
    expect(insertSkillMention).not.toHaveBeenCalled();

    await act(async () => {
      finishNewSession?.();
      await Promise.resolve();
    });
    expect(setSessionBackStack).toHaveBeenCalledWith([]);
    expect(clearInput).toHaveBeenCalledOnce();
    expect(insertSkillMention).toHaveBeenCalledWith('memory-review');
    act(() => root.unmount());
    host.remove();
  });

  it('preserves the current draft when creating the new session fails', async () => {
    let start: ((skillName: string) => Promise<void>) | undefined;
    const clearInput = vi.fn();
    const insertSkillMention = vi.fn();
    const setSessionBackStack = vi.fn();
    const handleNewSession = vi.fn().mockResolvedValue({ ok: false, error: 'disk error' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const Harness = () => {
      useStartSkillChat({
        loading: false,
        clearInput,
        handleNewSession,
        insertSkillMention,
        setSessionBackStack,
        onRegister: (handler) => {
          start = handler;
          return () => undefined;
        },
      });
      return null;
    };
    act(() => root.render(
      <I18nProvider>
        <AppShellProvider>
          <Harness />
        </AppShellProvider>
      </I18nProvider>,
    ));

    await act(async () => {
      await start?.('memory-review');
    });
    expect(setSessionBackStack).not.toHaveBeenCalled();
    expect(clearInput).not.toHaveBeenCalled();
    expect(insertSkillMention).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('disk error');
    act(() => root.unmount());
    host.remove();
  });

  it('does not create a second session while the first request is in flight', async () => {
    let start: ((skillName: string) => Promise<void>) | undefined;
    let finishNewSession: (() => void) | undefined;
    const insertSkillMention = vi.fn();
    const handleNewSession = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => {
      finishNewSession = () => resolve({ ok: true });
    }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const Harness = () => {
      useStartSkillChat({
        loading: false,
        clearInput: vi.fn(),
        handleNewSession,
        insertSkillMention,
        setSessionBackStack: vi.fn(),
        onRegister: (handler) => {
          start = handler;
          return () => undefined;
        },
      });
      return null;
    };
    act(() => root.render(
      <I18nProvider>
        <AppShellProvider>
          <Harness />
        </AppShellProvider>
      </I18nProvider>,
    ));

    await act(async () => {
      void start?.('first-skill');
      await start?.('second-skill');
    });
    expect(handleNewSession).toHaveBeenCalledOnce();
    expect(insertSkillMention).not.toHaveBeenCalled();

    await act(async () => {
      finishNewSession?.();
      await Promise.resolve();
    });
    expect(insertSkillMention).toHaveBeenCalledOnce();
    expect(insertSkillMention).toHaveBeenCalledWith('first-skill');
    act(() => root.unmount());
    host.remove();
  });
});
