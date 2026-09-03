// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import type { CanvasNode } from '../../../../../types';
import { RightDockProvider } from '../../../../../components/dock/RightDock';
import {
  FileNodeEditorRegistryProvider,
  useFileNodeEditorRegistry,
} from '../../../../../hooks/useFileNodeEditorRegistry';
import { CanvasKeyboardActiveProvider } from '../../../../../hooks/useWorkspaceActive';
import { FileNodeBody } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE: CanvasNode = {
  id: 'note-1',
  type: 'file',
  title: 'Review note',
  x: 0,
  y: 0,
  width: 480,
  height: 360,
  data: { content: '', filePath: '' },
};
const MENTION_TARGET: CanvasNode = {
  id: 'target-1',
  type: 'text',
  title: 'Target note',
  x: 500,
  y: 0,
  width: 240,
  height: 120,
  data: { content: '', textColor: '#111111', backgroundColor: 'transparent' },
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let registry: ReturnType<typeof useFileNodeEditorRegistry> = null;

const RegistryProbe = () => {
  registry = useFileNodeEditorRegistry();
  return null;
};

const KeyboardOwnershipFixture = ({ receivedKeys }: { receivedKeys: string[] }) => {
  const [canvasKeyboardActive, setCanvasKeyboardActive] = useState(true);
  return (
    <>
      <CanvasKeyboardActiveProvider value={canvasKeyboardActive}>
        <FileNodeBody
          node={NOTE}
          workspaceId="workspace-1"
          onUpdate={vi.fn()}
          getAllNodes={() => [NOTE, MENTION_TARGET]}
        />
        <RegistryProbe />
      </CanvasKeyboardActiveProvider>
      <textarea
        aria-label="Chat composer"
        onPointerDown={() => setCanvasKeyboardActive(false)}
        onKeyDown={event => receivedKeys.push(event.key)}
      />
    </>
  );
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  document.querySelectorAll('.slash-menu, .note-mention-menu').forEach(element => element.remove());
  host?.remove();
  root = null;
  host = null;
  registry = null;
});

describe('FileNodeBody keyboard ownership', () => {
  it('releases slash-menu keys to a Chat composer after the note loses focus', async () => {
    const receivedKeys: string[] = [];
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <RightDockProvider>
            <FileNodeEditorRegistryProvider>
              <KeyboardOwnershipFixture receivedKeys={receivedKeys} />
            </FileNodeEditorRegistryProvider>
          </RightDockProvider>
        </I18nProvider>,
      );
      await Promise.resolve();
    });

    const editor = registry?.get(NOTE.id);
    expect(editor).not.toBeNull();
    await act(async () => {
      editor?.commands.focus();
      await Promise.resolve();
    });
    const addBlock = host.querySelector<HTMLButtonElement>('[aria-label="Add a block below"]');
    expect(addBlock).not.toBeNull();
    await act(async () => {
      addBlock?.click();
      await Promise.resolve();
    });
    expect(document.querySelector('.slash-menu')).not.toBeNull();
    const noteTextBeforeChat = editor?.getText();

    const composer = host.querySelector<HTMLTextAreaElement>('[aria-label="Chat composer"]')!;
    await act(async () => {
      composer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await Promise.resolve();
    });
    expect(document.querySelector('.slash-menu')).toBeNull();
    await act(async () => {
      composer.focus();
      await Promise.resolve();
      await Promise.resolve();
    });

    const events = ['ArrowDown', 'Enter', 'Escape'].map(key => new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    }));
    await act(async () => {
      events.forEach(event => composer.dispatchEvent(event));
      await Promise.resolve();
    });

    expect(receivedKeys).toEqual(['ArrowDown', 'Enter', 'Escape']);
    expect(events.every(event => !event.defaultPrevented)).toBe(true);
    expect(editor?.getText()).toBe(noteTextBeforeChat);
  });

  it('releases mention-menu keys to a Chat composer after the note loses focus', async () => {
    const receivedKeys: string[] = [];
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <I18nProvider>
          <RightDockProvider>
            <FileNodeEditorRegistryProvider>
              <KeyboardOwnershipFixture receivedKeys={receivedKeys} />
            </FileNodeEditorRegistryProvider>
          </RightDockProvider>
        </I18nProvider>,
      );
      await Promise.resolve();
    });

    const editor = registry?.get(NOTE.id);
    expect(editor).not.toBeNull();
    await act(async () => {
      editor?.chain().focus().insertContent('@').run();
      await Promise.resolve();
    });
    expect(document.querySelector('.note-mention-menu')).not.toBeNull();
    const noteTextBeforeChat = editor?.getText();

    const composer = host.querySelector<HTMLTextAreaElement>('[aria-label="Chat composer"]')!;
    await act(async () => {
      composer.focus();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('.note-mention-menu')).toBeNull();

    const events = ['ArrowDown', 'Enter', 'Escape'].map(key => new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    }));
    await act(async () => {
      events.forEach(event => composer.dispatchEvent(event));
      await Promise.resolve();
    });

    expect(receivedKeys).toEqual(['ArrowDown', 'Enter', 'Escape']);
    expect(events.every(event => !event.defaultPrevented)).toBe(true);
    expect(editor?.getText()).toBe(noteTextBeforeChat);
  });
});
