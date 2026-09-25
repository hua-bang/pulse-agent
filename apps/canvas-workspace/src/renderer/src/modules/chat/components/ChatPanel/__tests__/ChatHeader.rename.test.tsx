// @vitest-environment happy-dom
import { act, createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { ChatHeader } from '../ChatHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement('div');
let root: ReturnType<typeof createRoot>;
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function setup(rename: (id: string, title: string) => Promise<void> = vi.fn(async (_id: string, _title: string) => {})) {
  document.body.appendChild(host);
  root = createRoot(host);
  const load = vi.fn(async () => undefined);
  const pin = vi.fn(async () => undefined);
  const remove = vi.fn(async () => undefined);
  function Probe() {
    const [open, setOpen] = useState(true);
    return <ChatHeader title="Current" sessionMenuOpen={open} sessionMenuRef={createRef()}
      sessions={[{sessionId:'a',title:'Original',date:'today',messageCount:2,isCurrent:true},{sessionId:'b',title:'Second',date:'today',messageCount:2,isCurrent:false}]}
      otherSessions={[]} onRenameSession={rename} onToggleSessionPinned={pin} onDeleteSession={remove}
      onToggleSessionMenu={async()=>setOpen(v=>!v)} onCloseSessionMenu={()=>setOpen(false)}
      onNewSession={async()=>{}} onLoadSession={load} onOpenSettings={()=>{}}
      settingsLabel="Settings" onOpenPromptSettings={()=>{}} onClose={()=>{}} />;
  }
  await act(async () => root.render(<I18nProvider><Probe/></I18nProvider>));
  return {load, pin, remove, rename};
}
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function startRename() {
  await act(async () => button('Rename Original').click());
  return host.querySelector<HTMLInputElement>('input[aria-label="Rename Original"]')!;
}
function changeName(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', {bubbles:true}));
}
describe('ChatHeader shared session actions', () => {
  it('renames inline without navigating or opening a dialog', async () => {
    const {load,rename} = await setup();
    const input = await startRename();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    expect(load).not.toHaveBeenCalled();
    await act(async () => changeName(input, '  Release notes  '));
    await act(async () => button('Save rename').click());
    expect(rename).toHaveBeenCalledWith('a','Release notes');
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
  });
  it('keeps a failed rename draft and lets Escape cancel without closing the menu', async () => {
    await setup(vi.fn(async () => { throw new Error('Disk unavailable'); }));
    const input = await startRename();
    await act(async () => changeName(input, 'New name'));
    await act(async () => button('Save rename').click());
    expect(input.value).toBe('New name');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true})));
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
  });
  it('does not let menu navigation or IME confirmation hijack the editor', async () => {
    const {rename} = await setup();
    const input = await startRename();
    const home = new KeyboardEvent('keydown', {key:'Home',bubbles:true,cancelable:true});
    await act(async () => input.dispatchEvent(home));
    expect(home.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    const enter = new KeyboardEvent('keydown', {key:'Enter',isComposing:true,bubbles:true,cancelable:true});
    await act(async () => input.dispatchEvent(enter));
    expect(enter.defaultPrevented).toBe(true);
    expect(rename).not.toHaveBeenCalled();
  });
  it('keeps menu shortcuts paused until every inline editor has closed', async () => {
    await setup();
    const first = await startRename();
    await act(async () => button('Rename Second').click());
    const second = host.querySelector<HTMLInputElement>('input[aria-label="Rename Second"]')!;
    await act(async () => second.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true})));
    expect(host.querySelectorAll('input')).toHaveLength(1);
    first.focus();
    const home = new KeyboardEvent('keydown', {key:'Home',bubbles:true,cancelable:true});
    await act(async () => first.dispatchEvent(home));
    expect(home.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(first);
    await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true})));
    expect(host.querySelector('input')).toBeNull();
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('uses the same pin action and explicit delete confirmation as the rail', async () => {
    const {pin,remove} = await setup();
    await act(async () => button('Pin Original').click());
    expect(pin).toHaveBeenCalledWith('a',true);
    await act(async () => button('Delete Original').click());
    expect(remove).not.toHaveBeenCalled();
    await act(async () => button('Cancel deleting Original').click());
    expect(remove).not.toHaveBeenCalled();
    await act(async () => button('Delete Original').click());
    await act(async () => button('Confirm delete Original').click());
    expect(remove).toHaveBeenCalledWith('a');
  });
});
