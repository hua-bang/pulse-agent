// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { AppShellProvider } from '../../../../components/shell/AppShellProvider';
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

const triggerFor = (ariaLabel: string): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`.ui-select__trigger[aria-label="${ariaLabel}"]`);

/**
 * Opens the labelled ui/Select and clicks the option with `label`. The open
 * and the pick need separate `act` passes — the menu only exists after the
 * trigger's state update has flushed.
 */
const pickOption = async (ariaLabel: string, label: string): Promise<void> => {
  await act(async () => { triggerFor(ariaLabel)?.click(); });
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!option) throw new Error(`No "${label}" option under ${ariaLabel}`);
  await act(async () => { option.click(); });
};

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

    expect(triggerFor('Hour')?.textContent).toContain('09');
    expect(triggerFor('Minute')?.textContent).toContain('00');

    await pickOption('Hour', '07');
    await pickOption('Minute', '30');

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

  it('keeps a stored off-grid minute selectable instead of rounding it away', async () => {
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
                // The agent tools accept any HH:mm, so the picker has to carry
                // values the 5-minute grid does not contain.
                schedule: { kind: 'daily', timeOfDay: '09:07' },
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

    expect(triggerFor('Minute')?.textContent).toContain('07');

    await act(async () => {
      triggerFor('Minute')?.click();
    });
    const minutes = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .map((option) => option.textContent?.trim());
    expect(minutes).toContain('07');
    expect(minutes).toContain('05');
    expect(minutes).toContain('10');

    await act(async () => {
      triggerFor('Minute')?.click();
    });
    const saveButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Save task'));
    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      schedule: { kind: 'daily', timeOfDay: '09:07' },
    }));
  });
});
