// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileNodeEditorRegistryProvider, useFileNodeEditorRegistry } from './fileNodeEditorRegistry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('File-node editor readiness registry', () => {
  let host: HTMLDivElement;
  let root: Root;
  let registry: NonNullable<ReturnType<typeof useFileNodeEditorRegistry>>;

  const Probe = () => {
    registry = useFileNodeEditorRegistry()!;
    return null;
  };

  beforeEach(() => {
    host = document.createElement('div');
    root = createRoot(host);
    act(() => root.render(<FileNodeEditorRegistryProvider><Probe /></FileNodeEditorRegistryProvider>));
  });

  afterEach(() => act(() => root.unmount()));

  it('keeps registration passive and coalesces activation requests', () => {
    const activate = vi.fn();
    registry.registerActivator('note', activate);
    expect(activate).not.toHaveBeenCalled();
    expect(registry.get('note')).toBeNull();
    expect(registry.requestActivation('missing')).toBe(false);
    expect(registry.requestActivation('note')).toBe(true);
    expect(registry.requestActivation('note')).toBe(true);
    expect(activate).toHaveBeenCalledOnce();
  });

  it('announces readiness and removal while preserving the existing editor API', () => {
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const editor = { view: {} };
    registry.register('note', editor);
    registry.register('note', editor);
    expect(registry.get('note')).toBe(editor);
    expect(registry.getAll().get('note')).toBe(editor);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith('note');
    registry.unregister('note');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.get('note')).toBeNull();
    unsubscribe();
    registry.register('other', editor);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not let an old passive registration remove its replacement', () => {
    const oldActivate = vi.fn();
    const newActivate = vi.fn();
    const disposeOld = registry.registerActivator('note', oldActivate);
    const disposeNew = registry.registerActivator('note', newActivate);
    disposeOld();
    registry.requestActivation('note');
    expect(oldActivate).not.toHaveBeenCalled();
    expect(newActivate).toHaveBeenCalledOnce();
    disposeNew();
    expect(registry.requestActivation('note')).toBe(false);
  });

  it('does not activate an already registered editor or recurse during synchronous readiness', () => {
    const activate = vi.fn(() => registry.register('note', { view: {} }));
    registry.subscribe(() => registry.requestActivation('note'));
    registry.registerActivator('note', activate);
    expect(activate).toHaveBeenCalledOnce();
    registry.requestActivation('note');
    expect(activate).toHaveBeenCalledOnce();
  });
});
