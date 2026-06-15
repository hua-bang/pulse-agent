import { init, loadRemote, registerRemotes } from '@module-federation/runtime';
import * as React from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import type {
  RendererCanvasPlugin,
  RendererCtx,
  RendererFederatedPluginSpec,
} from '../types';
import type {
  CanvasPluginRendererSpec,
  CanvasPluginsStatus,
} from '../../shared/settings-config';
import {
  MOCK_NODE_PLUGIN_ID,
  MOCK_NODE_REMOTE_ENTRY,
  MOCK_NODE_REMOTE_NAME,
} from '../mock-node/constants';
import { activateCanvasPlugins } from './registry';

const HOST_NAME = 'pulse_canvas_workspace';
const DEFAULT_EXPOSE = './plugin';
const ENV_REMOTES_KEY = 'VITE_CANVAS_RENDERER_MF_REMOTES';

let initialized = false;
const registeredRemoteNames = new Set<string>();

type RemotePluginModule = {
  default?: unknown;
  plugin?: unknown;
  activate?: unknown;
  enabledWhen?: unknown;
};

type RemoteShape = {
  name: string;
  alias?: string;
  entry: string;
  type?: string;
  entryGlobalName?: string;
  version?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function resolveRendererPublicAsset(path: string): string {
  const trimmed = path.replace(/^\/+/, '');
  const location = globalThis.location;
  if (!location) return `/${trimmed}`;
  if (location.protocol === 'file:') {
    return new URL(`./${trimmed}`, location.href).href;
  }
  return new URL(`/${trimmed}`, location.origin).href;
}

function createHostShared() {
  const shareConfig = { singleton: true, requiredVersion: false as const };
  return {
    react: {
      version: React.version,
      lib: () => React,
      shareConfig,
    },
    'react/jsx-runtime': {
      version: React.version,
      lib: () => ReactJsxRuntime,
      shareConfig,
    },
  };
}

function installLocalSmokeRemoteBridge(): void {
  const global = globalThis as typeof globalThis & {
    __PULSE_CANVAS_PLUGIN_REACT__?: typeof React;
  };
  global.__PULSE_CANVAS_PLUGIN_REACT__ = React;
}

function toRemote(spec: RendererFederatedPluginSpec): RemoteShape {
  return {
    name: spec.name,
    alias: spec.id,
    entry: spec.entry,
    type: spec.type,
    entryGlobalName: spec.entryGlobalName,
    version: spec.version,
  };
}

function ensureFederation(specs: RendererFederatedPluginSpec[]): void {
  installLocalSmokeRemoteBridge();
  const remotes = specs
    .map(toRemote)
    .filter((remote) => {
      if (registeredRemoteNames.has(remote.name)) return false;
      registeredRemoteNames.add(remote.name);
      return true;
    });
  if (!initialized) {
    init({
      name: HOST_NAME,
      remotes,
      shared: createHostShared(),
    });
    initialized = true;
    return;
  }
  if (remotes.length > 0) {
    registerRemotes(remotes);
  }
}

function loadId(spec: RendererFederatedPluginSpec): string {
  const expose = spec.expose || DEFAULT_EXPOSE;
  if (expose === '.') return spec.name;
  return `${spec.name}/${expose.replace(/^\.\//, '')}`;
}

function normalizeRemotePlugin(
  spec: RendererFederatedPluginSpec,
  mod: unknown,
): RendererCanvasPlugin | null {
  const record = isRecord(mod) ? mod as RemotePluginModule : {};
  const candidate = record.default ?? record.plugin ?? mod;

  if (typeof candidate === 'function') {
    return {
      id: spec.id,
      activate: (ctx: RendererCtx) => {
        candidate(ctx);
      },
    };
  }

  if (!isRecord(candidate) || typeof candidate.activate !== 'function') {
    return null;
  }

  const activate = candidate.activate as RendererCanvasPlugin['activate'];
  const enabledWhen = typeof candidate.enabledWhen === 'function'
    ? candidate.enabledWhen as RendererCanvasPlugin['enabledWhen']
    : undefined;

  return {
    id: spec.id,
    enabledWhen,
    activate,
  };
}

export function getBuiltInFederatedRendererPluginSpecs(): RendererFederatedPluginSpec[] {
  return [
    {
      id: MOCK_NODE_PLUGIN_ID,
      name: MOCK_NODE_REMOTE_NAME,
      entry: resolveRendererPublicAsset(MOCK_NODE_REMOTE_ENTRY),
      expose: DEFAULT_EXPOSE,
      type: 'global',
      entryGlobalName: MOCK_NODE_REMOTE_NAME,
    },
  ];
}

function readEnvString(key: string): string | undefined {
  const env = (import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  }).env;
  const value = env?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function parseSpec(value: unknown): RendererFederatedPluginSpec | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string'
    ? value.name.trim()
    : typeof value.remoteName === 'string'
      ? value.remoteName.trim()
      : '';
  const entry = typeof value.entry === 'string'
    ? value.entry.trim()
    : typeof value.url === 'string'
      ? value.url.trim()
      : typeof value.manifest === 'string'
        ? value.manifest.trim()
        : '';

  if (!id || !name || !entry) return null;

  return {
    id,
    name,
    entry,
    expose: typeof value.expose === 'string' && value.expose.trim()
      ? value.expose.trim()
      : DEFAULT_EXPOSE,
    type: typeof value.type === 'string' && value.type.trim()
      ? value.type.trim()
      : undefined,
    entryGlobalName: typeof value.entryGlobalName === 'string' && value.entryGlobalName.trim()
      ? value.entryGlobalName.trim()
      : undefined,
    version: typeof value.version === 'string' && value.version.trim()
      ? value.version.trim()
      : undefined,
  };
}

function specFromConfiguredPlugin(value: CanvasPluginRendererSpec): RendererFederatedPluginSpec {
  return {
    id: value.id,
    name: value.name,
    entry: value.entry,
    expose: value.expose ?? DEFAULT_EXPOSE,
    type: value.type,
    entryGlobalName: value.entryGlobalName,
    version: value.version,
  };
}

export function specsFromCanvasPluginsStatus(
  status: CanvasPluginsStatus | undefined,
): RendererFederatedPluginSpec[] {
  if (!status) return [];
  return status.rendererSpecs.map(specFromConfiguredPlugin);
}

export async function readFederatedRendererPluginSpecsFromUserConfig(): Promise<RendererFederatedPluginSpec[]> {
  const api = (
    globalThis as {
      canvasWorkspace?: {
        canvasPlugins?: {
          list?: () => Promise<{ ok: boolean; status?: CanvasPluginsStatus; error?: string }>;
        };
      };
    }
  ).canvasWorkspace?.canvasPlugins;
  if (!api?.list) return [];

  try {
    const res = await api.list();
    if (!res.ok) {
      console.warn('[canvas-plugins] failed to read user plugin config', res.error);
      return [];
    }
    return specsFromCanvasPluginsStatus(res.status);
  } catch (err) {
    console.warn('[canvas-plugins] failed to read user plugin config', err);
    return [];
  }
}

export function readFederatedRendererPluginSpecsFromEnv(): RendererFederatedPluginSpec[] {
  const raw = readEnvString(ENV_REMOTES_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .map(parseSpec)
      .filter((spec): spec is RendererFederatedPluginSpec => spec !== null);
  } catch (err) {
    console.warn(`[canvas-plugins] failed to parse ${ENV_REMOTES_KEY}`, err);
    return [];
  }
}

export async function activateFederatedRendererPlugins(
  specs: RendererFederatedPluginSpec[],
): Promise<RendererCanvasPlugin[]> {
  if (specs.length === 0) return [];

  ensureFederation(specs);
  const activated: RendererCanvasPlugin[] = [];

  for (const spec of specs) {
    try {
      const mod = await loadRemote<RemotePluginModule>(loadId(spec), { from: 'runtime' });
      const plugin = normalizeRemotePlugin(spec, mod);
      if (!plugin) {
        console.warn(`[canvas-plugins] remote ${spec.id} did not export a renderer plugin`);
        continue;
      }
      activateCanvasPlugins([plugin]);
      activated.push(plugin);
    } catch (err) {
      console.error(`[canvas-plugins] failed to load federated renderer plugin ${spec.id}`, err);
    }
  }

  return activated;
}

export async function activateConfiguredFederatedRendererPlugins(): Promise<RendererCanvasPlugin[]> {
  const userSpecs = await readFederatedRendererPluginSpecsFromUserConfig();
  return activateFederatedRendererPlugins([
    ...getBuiltInFederatedRendererPluginSpecs(),
    ...readFederatedRendererPluginSpecsFromEnv(),
    ...userSpecs,
  ]);
}
