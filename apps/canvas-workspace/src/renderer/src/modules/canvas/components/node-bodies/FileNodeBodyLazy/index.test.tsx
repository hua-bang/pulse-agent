// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DeferredEditorReady } from '../applyDeferredEditorInput';
import type { CanvasNode, FileNodeData } from '../../../../../types';
import { I18nProvider } from '../../../../../i18n';
import { FileNodeEditorRegistryProvider, useFileNodeEditorRegistry } from '../../../../../shared/fileNodeEditorRegistry';

const { openLink, handoff } = vi.hoisted(() => ({ openLink: vi.fn(), handoff: vi.fn() }));
vi.mock('../../../../../shared/dockPort', () => ({ useRightDock: () => ({ openLink }) }));
vi.mock('../../../../../utils/clipboard', () => ({ copyTextToClipboard: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../FileNodeBody', () => ({
  FileNodeBody: ({ node, onEditorReady }: { node: CanvasNode; onEditorReady?: DeferredEditorReady }) => {
    useEffect(() => onEditorReady?.(handoff), [onEditorReady]);
    return <div data-testid="mock-file-editor">{(node.data as FileNodeData).content}</div>;
  },
}));

import { FileNodeBodyLazy } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node: CanvasNode = {
  id: 'note-1', type: 'file', title: 'Note', x: 0, y: 0, width: 320, height: 240, updatedAt: 1,
  data: { filePath: '/tmp/note.md', content: '# Heading', saved: true, modified: false },
};
let root: Root;
let host: HTMLDivElement;
let read: ReturnType<typeof vi.fn>;
let onUpdate = vi.fn<[string, Partial<CanvasNode>], Promise<void>>();
let changed: (path: string) => void;
let registry: ReturnType<typeof useFileNodeEditorRegistry>;
let previousApi: typeof window.canvasWorkspace;

const RegistryProbe = () => { registry = useFileNodeEditorRegistry(); return null; };
const renderNode = async (options: { readOnly?: boolean; renderFullEditor?: boolean; node?: CanvasNode } = {}) => {
  await act(async () => {
    root.render(<I18nProvider><FileNodeEditorRegistryProvider>
      <RegistryProbe />
      <FileNodeBodyLazy node={options.node ?? node} onUpdate={onUpdate}
        readOnly={options.readOnly} renderFullEditor={options.renderFullEditor} />
    </FileNodeEditorRegistryProvider></I18nProvider>);
  });
};
const editor = () => host.querySelector('[data-testid="mock-file-editor"]');
const preview = () => host.querySelector('.file-preview')!;

beforeEach(() => {
  openLink.mockReset();
  handoff.mockReset();
  read = vi.fn().mockResolvedValue({ ok: true, content: '# Heading', version: 'v1' });
  onUpdate = vi.fn<[string, Partial<CanvasNode>], Promise<void>>().mockResolvedValue(undefined);
  previousApi = window.canvasWorkspace;
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: { file: { read, onChanged: vi.fn((callback: typeof changed) => { changed = callback; return vi.fn(); }) } },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Object.defineProperty(window, 'canvasWorkspace', { configurable: true, value: previousApi });
  vi.restoreAllMocks();
});

it('shows clean saved Markdown through the full static renderer without loading an editor', async () => {
  const content = '# Heading\n\n**Bold** and *italic*\nsoft wrap\n\n| A | B |\n|---|---|\n| one | two |\n\n```js\nconst x = 1;\n```';
  read.mockResolvedValue({ ok: true, content, version: 'v1' });
  await renderNode({ node: { ...node, data: { ...node.data, content } } });
  expect(editor()).toBeNull();
  expect(host.querySelector('h1')?.textContent).toBe('Heading');
  expect(host.querySelector('strong')?.textContent).toBe('Bold');
  expect(host.querySelectorAll('td')).toHaveLength(2);
  expect(host.querySelector('pre code')?.textContent).toContain('const x = 1');
  expect(host.querySelector('p br')).toBeNull();
  expect(onUpdate).not.toHaveBeenCalled();
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-action="copy-code"]')!.click(); });
  expect(editor()).toBeNull();
});

it('loads the editor on the first click with its viewport position and focus request', async () => {
  await renderNode();
  host.querySelector('.note-tiptap-editor')!.scrollTop = 150;
  await act(async () => { preview().dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 90, clientY: 120 })); });
  expect(handoff).toHaveBeenCalledWith(expect.objectContaining({
    point: { x: 90, y: 120, scrollTop: 150 }, html: '', text: '',
  }));
  expect(editor()?.textContent).toBe('# Heading');
  expect(onUpdate).not.toHaveBeenCalled();
  await renderNode();
  expect(editor()).not.toBeNull();
});

it('activates for an existing canvas-search request without stealing focus', async () => {
  await renderNode();
  await act(async () => { expect(registry?.requestActivation(node.id)).toBe(true); });
  expect(handoff).not.toHaveBeenCalled();
});

it.each([
  { filePath: '', content: '' },
  { modified: true, content: 'Retained draft' },
  { fileWriteIntentId: 'pending', fileWriteStatus: 'pending', content: 'Queued draft' },
  { fileWriteIntentId: 'conflict', fileWriteStatus: 'conflict', content: 'Conflicting draft' },
  { content: '<span style="color:red">HTML</span>' },
  { content: '- [ ] An interactive task' },
  { content: '![Image](pulse-canvas://local/a.png)' },
  { content: '[Node](pulse-canvas://node/n)' },
])('keeps recovery or interactive content on its established editor: %j', async patch => {
  const data = { ...node.data, ...patch } as FileNodeData;
  read.mockResolvedValue({ ok: true, content: data.content, version: 'v1' });
  await renderNode({ node: { ...node, data } });
  expect(editor()).not.toBeNull();
  expect(onUpdate).not.toHaveBeenCalled();
});

it('keeps the explicit full renderer for a read-only surface', async () => {
  await renderNode({ readOnly: true, renderFullEditor: true });
  expect(editor()).not.toBeNull();
});

it('refreshes a clean passive note from file events and focus without any Canvas watcher', async () => {
  await renderNode();
  read.mockResolvedValue({ ok: true, content: '# External file edit', version: 'v2' });
  await act(async () => { changed('/tmp/note.md'); });
  expect(host.querySelector('h1')?.textContent).toBe('External file edit');
  expect(onUpdate).toHaveBeenCalledWith(node.id, { data: { ...node.data, content: '# External file edit' } });
  read.mockResolvedValue({ ok: true, content: '# Focus refresh', version: 'v3' });
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(host.querySelector('h1')?.textContent).toBe('Focus refresh');
  expect(editor()).toBeNull();
});

it('refreshes read-only bytes without publishing an edit and retains them when search activates', async () => {
  read.mockResolvedValue({ ok: true, content: '# Fresh bytes', version: 'v2' });
  await renderNode({ readOnly: true });
  expect(host.querySelector('h1')?.textContent).toBe('Fresh bytes');
  expect(onUpdate).not.toHaveBeenCalled();
  await act(async () => { registry?.requestActivation(node.id); });
  expect(editor()?.textContent).toBe('# Fresh bytes');
  expect(handoff).not.toHaveBeenCalled();
});

it('ignores an old read after the node changes backing files', async () => {
  let complete!: (result: { ok: true; content: string; version: string }) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await renderNode();
  read.mockResolvedValue({ ok: true, content: '# B current', version: 'b1' });
  await renderNode({ node: { ...node, data: { ...node.data, filePath: '/tmp/b.md', content: '# B current' } } });
  await act(async () => { complete({ ok: true, content: '# A outdated', version: 'a1' }); });
  expect(host.querySelector('h1')?.textContent).toBe('B current');
  expect(onUpdate).not.toHaveBeenCalled();
});

it('opens ordinary links in the existing Dock without navigating or starting an edit', async () => {
  const content = '[site](https://example.com)';
  read.mockResolvedValue({ ok: true, content, version: 'v1' });
  await renderNode({ node: { ...node, data: { ...node.data, content } } });
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  act(() => { host.querySelector('a')!.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(openLink).toHaveBeenCalledWith('https://example.com');
  expect(editor()).toBeNull();
  expect(onUpdate).not.toHaveBeenCalled();
});
