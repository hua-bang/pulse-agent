import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PulseStorage } from '@pulse-coder/storage';
import { createCanvasCompatibilityStore } from '@pulse-coder/storage/canvas';
import { openLocalStorage, readLocalStorageStatus } from '@pulse-coder/storage/local';

const connections = new Map<string, Promise<PulseStorage | null>>();

export async function resolveStorageNativeBinding(): Promise<string | undefined> {
  if (!process.versions.electron) return undefined;
  const { app } = await import('electron');
  const filename = `${process.platform}-${process.arch}-${process.versions.modules}.node`;
  const candidates = [
    join(process.resourcesPath, 'agent-tooling', 'canvas-cli', 'native', filename),
    resolve(app.getAppPath(), '..', '..', 'packages', 'canvas-cli', 'dist', 'native', filename),
  ];
  const binding = candidates.find(candidate => existsSync(candidate));
  if (!binding) throw new Error('SQLite runtime is missing; rebuild or repair bundled agent tooling.');
  return binding;
}

/** Negative results are not cached: another process may activate the backend. */
export async function getLocalCanvasStorage(root: string): Promise<PulseStorage | null> {
  const key = resolve(root);
  const current = connections.get(key);
  if (current) return current;
  if (!await readLocalStorageStatus(key)) return null;
  const pending = openLocalStorage({ root: key, nativeBinding: await resolveStorageNativeBinding() });
  connections.set(key, pending);
  try {
    const store = await pending;
    if (!store) connections.delete(key);
    return store;
  } catch (error) {
    connections.delete(key);
    throw error;
  }
}

export async function getCanvasBackend(root: string) {
  if (!(await readLocalStorageStatus(root))?.domains.includes('canvas')) return null;
  const store = await getLocalCanvasStorage(root);
  return store ? createCanvasCompatibilityStore(store.canvas) : null;
}

export async function closeCanvasStorage(): Promise<void> {
  const pending = [...connections.values()];
  connections.clear();
  const stores = await Promise.allSettled(pending);
  await Promise.all(stores.map(result =>
    result.status === 'fulfilled' && result.value ? result.value.close() : Promise.resolve(),
  ));
}
