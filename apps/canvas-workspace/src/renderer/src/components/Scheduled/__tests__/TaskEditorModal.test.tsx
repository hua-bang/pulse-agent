// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { AppShellProvider } from '../../AppShellProvider';
import { TaskEditorModal } from '../TaskEditorModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  document.querySelector('.ui-modal-backdrop')?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe('TaskEditorModal', () => {
  it('uses AI to draft editable instructions from the task name', async () => {
    const polishScheduledPrompt = vi.fn(async () => ({
      ok: true,
      content: 'Summarize the latest work and call out blockers.',
    }));
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent: { polishScheduledPrompt } },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <I18nProvider>
          <AppShellProvider>
            <TaskEditorModal
              open
              task={{
                id: 'weekly-report',
                title: 'Weekly report',
                prompt: '',
                schedule: { kind: 'weekly', weekday: 1, timeOfDay: '09:00' },
                enabled: true,
                source: 'user',
                createdAt: 1,
                updatedAt: 1,
                nextRunAt: 2,
                runCount: 0,
                status: 'idle',
              }}
              onClose={vi.fn()}
              onSave={vi.fn(async () => true)}
            />
          </AppShellProvider>
        </I18nProvider>,
      );
    });

    const aiButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Write with AI'));
    await act(async () => {
      aiButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(polishScheduledPrompt).toHaveBeenCalledWith({
      title: 'Weekly report',
      currentPrompt: undefined,
    });
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value)
      .toBe('Summarize the latest work and call out blockers.');
  });

  it('saves an edited wall-clock time as an absolute weekly schedule', async () => {
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent: { polishScheduledPrompt: vi.fn() } },
    });
    const onSave = vi.fn(async () => true);

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <I18nProvider>
          <AppShellProvider>
            <TaskEditorModal
              open
              task={{
                id: 'weekly-report',
                title: 'Weekly report',
                prompt: 'Summarize the week.',
                schedule: { kind: 'weekly', weekday: 1, timeOfDay: '09:00' },
                enabled: true,
                source: 'user',
                createdAt: 1,
                updatedAt: 1,
                nextRunAt: 2,
                runCount: 0,
                status: 'idle',
              }}
              onClose={vi.fn()}
              onSave={onSave}
            />
          </AppShellProvider>
        </I18nProvider>,
      );
    });

    const timeInput = document.querySelector<HTMLInputElement>('input[type="time"]');
    expect(timeInput?.value).toBe('09:00');

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(timeInput, '07:30');
      timeInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const saveButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Save task'));
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      schedule: { kind: 'weekly', weekday: 1, timeOfDay: '07:30' },
    }));
  });

  it('blocks saving while the wall-clock time is incomplete', async () => {
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: { agent: { polishScheduledPrompt: vi.fn() } },
    });
    const onSave = vi.fn(async () => true);

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <I18nProvider>
          <AppShellProvider>
            <TaskEditorModal
              open
              task={{
                id: 'daily-brief',
                title: 'Daily brief',
                prompt: 'Summarize what needs my attention.',
                schedule: { kind: 'daily', timeOfDay: '09:00' },
                enabled: true,
                source: 'user',
                createdAt: 1,
                updatedAt: 1,
                nextRunAt: 2,
                runCount: 0,
                status: 'idle',
              }}
              onClose={vi.fn()}
              onSave={onSave}
            />
          </AppShellProvider>
        </I18nProvider>,
      );
    });

    const timeInput = document.querySelector<HTMLInputElement>('input[type="time"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(timeInput, '');
      timeInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const saveButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Save task'));
    expect(saveButton?.disabled).toBe(true);

    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });
    expect(onSave).not.toHaveBeenCalled();
  });
});
