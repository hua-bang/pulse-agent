// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '..';
import type { SidebarProps } from '../types';
import { I18nProvider } from '../../../../i18n';
import { AppShellProvider } from '../../AppShellProvider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let props: SidebarProps;
const render = () => act(() => root.render(
  <I18nProvider><AppShellProvider><Sidebar {...props} /></AppShellProvider></I18nProvider>,
));
const element = <T extends Element,>(selector: string): T => {
  const result = host.querySelector<T>(selector);
  if (!result) throw new Error(`Missing ${selector}`);
  return result;
};
const click = (selector: string) => act(() => element<HTMLButtonElement>(selector).click());
const type = (value: string) => act(() => {
  const input = element<HTMLInputElement>('input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const key = (value: string) => act(() => {
  element<HTMLInputElement>('input').dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
});
const drag = (selector: string, eventName: string, mime: string, id: string) => act(() => {
  const event = new Event(eventName, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: [mime], getData: (type: string) => type === mime ? id : '', effectAllowed: 'move' },
  });
  element(selector).dispatchEvent(event);
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  props = {
    collapsed: false, activeId: 'a', activeView: 'canvas',
    workspaces: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
    folders: [{ id: 'f', name: 'Folder', collapsed: true }],
    onToggle: vi.fn(), onSelect: vi.fn(), onCreate: vi.fn(), onRename: vi.fn(),
    onDelete: vi.fn(), onExport: vi.fn(), onOpenSettings: vi.fn(), onOpenAppSettings: vi.fn(),
    onImport: vi.fn(), onCreateFolder: vi.fn(), onRenameFolder: vi.fn(), onDeleteFolder: vi.fn(),
    onToggleFolder: vi.fn(), onMoveWorkspace: vi.fn(), onReorderWorkspace: vi.fn(), onReorderFolder: vi.fn(),
    onEnterChat: vi.fn(), onEnterNodes: vi.fn(), onEnterGraph: vi.fn(), onEnterSkills: vi.fn(),
    onEnterScheduled: vi.fn(), nodesEnabled: false, graphEnabled: false, pluginNavItems: [],
    onNavigate: vi.fn(), onExitChat: vi.fn(),
  };
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Sidebar owner interactions', () => {
  it('focuses rename, cancels without committing, and commits the next edit to the selected workspace', () => {
    click('.sidebar-item-rename');
    expect(document.activeElement).toBe(element('input'));
    type('Canceled');
    key('Escape');
    expect(props.onRename).not.toHaveBeenCalled();
    expect(host.querySelector('input')).toBeNull();
    click('.sidebar-item-rename');
    expect(element<HTMLInputElement>('input').value).toBe('Alpha');
    type('Renamed');
    key('Enter');
    expect(props.onRename).toHaveBeenCalledWith('a', 'Renamed');
  });

  it('creates inside the requested folder and clears the target when creation is canceled', () => {
    click('.sidebar-folder-action');
    expect(props.onToggleFolder).toHaveBeenCalledWith('f');
    type(' Folder child ');
    key('Enter');
    expect(props.onCreate).toHaveBeenCalledWith('Folder child', 'f');
    click('.sidebar-folder-action');
    type('Canceled');
    key('Escape');
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    click('[aria-haspopup="menu"]');
    click('[role="menuitem"]');
    expect(element<HTMLInputElement>('input').value).toBe('');
    type('Root child');
    key('Enter');
    expect(props.onCreate).toHaveBeenLastCalledWith('Root child', undefined);
  });

  it('keeps folder renaming separate from workspace editing', () => {
    click('.sidebar-folder-action:nth-child(2)');
    type('Next folder');
    key('Enter');
    expect(props.onRenameFolder).toHaveBeenCalledWith('f', 'Next folder');
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it('routes workspace moves and reorders to distinct targets and clears drag markers', () => {
    const mime = 'application/x-workspace-id';
    drag('.sidebar-folder', 'dragover', mime, 'a');
    expect(host.querySelector('.sidebar-drop-zone--active')).not.toBeNull();
    drag('.sidebar-folder', 'drop', mime, 'a');
    expect(props.onMoveWorkspace).toHaveBeenCalledWith('a', 'f');
    expect(host.querySelector('.sidebar-drop-zone--active')).toBeNull();
    drag('.sidebar-workspace-entry:nth-child(2)', 'dragover', mime, 'a');
    expect(host.querySelector('.sidebar-workspace-entry--drop-before')).not.toBeNull();
    drag('.sidebar-workspace-entry:nth-child(2)', 'drop', mime, 'a');
    expect(props.onReorderWorkspace).toHaveBeenCalledWith('a', 'b', undefined);
    expect(host.querySelector('.sidebar-workspace-entry--drop-before')).toBeNull();
    drag('.sidebar-list.sidebar-drop-zone', 'drop', mime, 'a');
    expect(props.onMoveWorkspace).toHaveBeenLastCalledWith('a', undefined);
  });

  it('ignores self folder reorders and routes folder drops without moving a workspace', () => {
    const mime = 'application/x-folder-id';
    drag('.sidebar-folder', 'drop', mime, 'f');
    expect(props.onReorderFolder).not.toHaveBeenCalled();
    drag('.sidebar-folder', 'dragover', mime, 'other-folder');
    expect(host.querySelector('.sidebar-folder--drop-target')).not.toBeNull();
    drag('.sidebar-folder', 'drop', mime, 'other-folder');
    expect(props.onReorderFolder).toHaveBeenCalledWith('other-folder', 'f');
    expect(props.onMoveWorkspace).not.toHaveBeenCalled();
    expect(host.querySelector('.sidebar-folder--drop-target')).toBeNull();
  });
});
