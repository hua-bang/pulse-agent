import { app } from 'electron';
import { promises as fs } from 'fs';
import { dirname, join, sep } from 'path';
import type { PluginStore } from '../types';

export function createPluginStore(pluginId: string): PluginStore {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(pluginId)) {
    throw new Error(`Invalid plugin id: ${pluginId}`);
  }
  const baseDir = join(app.getPath('userData'), 'plugins', pluginId);

  const resolveKey = (key: string): string => {
    if (!key || key.includes('..') || key.startsWith('/') || key.includes('\0')) {
      throw new Error(`Invalid plugin store key: ${key}`);
    }
    const target = join(baseDir, `${key}.json`);
    // Defense in depth: confirm the resolved path stays under baseDir even
    // after path normalization on the current platform.
    if (!target.startsWith(baseDir + sep) && target !== baseDir) {
      throw new Error(`Invalid plugin store key: ${key}`);
    }
    return target;
  };

  return {
    async get<T>(key: string): Promise<T | undefined> {
      try {
        const data = await fs.readFile(resolveKey(key), 'utf8');
        return JSON.parse(data) as T;
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
        throw err;
      }
    },
    async set<T>(key: string, value: T): Promise<void> {
      const path = resolveKey(key);
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeFile(path, JSON.stringify(value), 'utf8');
    },
    async list(prefix?: string): Promise<string[]> {
      try {
        await fs.mkdir(baseDir, { recursive: true });
      } catch {
        return [];
      }
      const walk = async (dir: string, rel = ''): Promise<string[]> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const out: string[] = [];
        for (const entry of entries) {
          const childRel = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            out.push(...(await walk(join(dir, entry.name), childRel)));
          } else if (entry.name.endsWith('.json')) {
            out.push(childRel.replace(/\.json$/, ''));
          }
        }
        return out;
      };
      const all = await walk(baseDir);
      return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
    },
  };
}
