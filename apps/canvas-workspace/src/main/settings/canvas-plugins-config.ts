import { app } from 'electron';
import { promises as fs } from 'fs';
import { dirname, isAbsolute, join, normalize, resolve } from 'path';
import type {
  CanvasPluginEntry,
  CanvasPluginMainSpec,
  CanvasPluginManifestNode,
  CanvasPluginRendererSpec,
  CanvasPluginsImportEntry,
  CanvasPluginsStatus,
} from '../../shared/settings-config';

interface CanvasPluginsConfigFile {
  pluginDirs?: string[];
}

interface CanvasPluginManifest {
  id?: unknown;
  version?: unknown;
  main?: unknown;
  nodes?: unknown;
}

const CONFIG_FILE_NAME = 'canvas-plugins.json';
const DEFAULT_EXPOSE = './plugin';
const LOCAL_SCHEME = 'pulse-canvas://local';

export function canvasPluginsConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function encodeAbsolutePath(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  const isWindowsDrivePath = /^[a-zA-Z]:\//.test(normalized);
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;

  return withLeadingSlash
    .split('/')
    .map((segment, index) => {
      if (isWindowsDrivePath && index === 1 && /^[a-zA-Z]:$/.test(segment)) {
        return segment;
      }
      return encodeURIComponent(segment);
    })
    .join('/');
}

function toLocalPluginAssetUrl(absPath: string): string {
  return `${LOCAL_SCHEME}${encodeAbsolutePath(absPath)}`;
}

function normalizePluginDir(dir: string): string {
  const trimmed = dir.trim();
  if (!trimmed) return '';
  return normalize(resolve(trimmed));
}

async function readConfig(): Promise<CanvasPluginsConfigFile> {
  try {
    const raw = await fs.readFile(canvasPluginsConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as CanvasPluginsConfigFile;
    return {
      pluginDirs: Array.isArray(parsed.pluginDirs)
        ? parsed.pluginDirs
            .filter((dir): dir is string => typeof dir === 'string' && !!dir.trim())
            .map(normalizePluginDir)
        : [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { pluginDirs: [] };
    throw err;
  }
}

async function writeConfig(config: CanvasPluginsConfigFile): Promise<void> {
  const configPath = canvasPluginsConfigPath();
  await fs.mkdir(dirname(configPath), { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify({ pluginDirs: config.pluginDirs ?? [] }, null, 2),
    'utf8',
  );
}

function normalizeManifestNode(value: unknown): CanvasPluginManifestNode | null {
  if (!isRecord(value)) return null;
  const type = typeof value.type === 'string' ? value.type.trim() : '';
  if (!type) return null;

  const renderer = isRecord(value.renderer) ? value.renderer : undefined;
  return {
    type,
    title: typeof value.title === 'string' ? value.title : undefined,
    capabilities: Array.isArray(value.capabilities)
      ? value.capabilities.filter((item): item is string => typeof item === 'string')
      : undefined,
    actions: Array.isArray(value.actions)
      ? value.actions.filter((item): item is string => typeof item === 'string')
      : undefined,
    renderer: renderer
      ? {
          remoteName: typeof renderer.remoteName === 'string' ? renderer.remoteName : undefined,
          name: typeof renderer.name === 'string' ? renderer.name : undefined,
          entry: typeof renderer.entry === 'string' ? renderer.entry : undefined,
          expose: typeof renderer.expose === 'string' ? renderer.expose : undefined,
          type: typeof renderer.type === 'string' ? renderer.type : undefined,
          entryGlobalName: typeof renderer.entryGlobalName === 'string'
            ? renderer.entryGlobalName
            : undefined,
        }
      : undefined,
  };
}

function rendererSpecFromNode(
  pluginId: string,
  version: string | undefined,
  dir: string,
  node: CanvasPluginManifestNode,
): CanvasPluginRendererSpec | null {
  const renderer = node.renderer;
  if (!renderer?.entry) return null;
  const remoteName = (renderer.remoteName ?? renderer.name ?? '').trim();
  if (!remoteName) return null;

  const sourcePath = isAbsolute(renderer.entry)
    ? normalize(renderer.entry)
    : normalize(join(dir, renderer.entry));

  return {
    id: pluginId,
    name: remoteName,
    entry: toLocalPluginAssetUrl(sourcePath),
    expose: renderer.expose ?? DEFAULT_EXPOSE,
    type: renderer.type,
    entryGlobalName: renderer.entryGlobalName ?? remoteName,
    version,
  };
}

function mainSpecFromManifest(dir: string, value: unknown): CanvasPluginMainSpec | undefined {
  if (!isRecord(value)) return undefined;
  const entry = typeof value.entry === 'string' ? value.entry.trim() : '';
  if (!entry) return undefined;
  const sourcePath = isAbsolute(entry) ? normalize(entry) : normalize(join(dir, entry));
  return {
    entry: sourcePath,
    format: typeof value.format === 'string' && value.format.trim()
      ? value.format.trim()
      : undefined,
    runtime: typeof value.runtime === 'string' && value.runtime.trim()
      ? value.runtime.trim()
      : undefined,
    permissions: Array.isArray(value.permissions)
      ? value.permissions.filter((item): item is string => typeof item === 'string')
      : undefined,
  };
}

function dedupeRendererSpecs(specs: CanvasPluginRendererSpec[]): CanvasPluginRendererSpec[] {
  const seen = new Set<string>();
  const out: CanvasPluginRendererSpec[] = [];
  for (const spec of specs) {
    const key = `${spec.id}:${spec.name}:${spec.entry}:${spec.expose ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(spec);
  }
  return out;
}

async function readPluginEntry(dir: string): Promise<CanvasPluginEntry> {
  const manifestPath = join(dir, 'manifest.json');
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as CanvasPluginManifest;
    const id = typeof manifest.id === 'string' ? manifest.id.trim() : '';
    if (!id) {
      return {
        id: 'unknown',
        dir,
        manifestPath,
        nodes: [],
        rendererSpecs: [],
        error: 'manifest.json is missing id',
      };
    }

    const version = typeof manifest.version === 'string' ? manifest.version : undefined;
    const main = mainSpecFromManifest(dir, manifest.main);
    const nodes = Array.isArray(manifest.nodes)
      ? manifest.nodes
          .map(normalizeManifestNode)
          .filter((node): node is CanvasPluginManifestNode => node !== null)
      : [];
    const rendererSpecs = dedupeRendererSpecs(
      nodes
        .map((node) => rendererSpecFromNode(id, version, dir, node))
        .filter((spec): spec is CanvasPluginRendererSpec => spec !== null),
    );

    return {
      id,
      version,
      dir,
      manifestPath,
      main,
      nodes,
      rendererSpecs,
      error: nodes.length === 0 ? 'manifest.json has no valid nodes' : undefined,
    };
  } catch (err) {
    return {
      id: 'unknown',
      dir,
      manifestPath,
      nodes: [],
      rendererSpecs: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getCanvasPluginsStatus(): Promise<CanvasPluginsStatus> {
  const config = await readConfig();
  const pluginDirs = Array.from(new Set((config.pluginDirs ?? []).map(normalizePluginDir).filter(Boolean)));
  const plugins = await Promise.all(pluginDirs.map(readPluginEntry));
  return {
    path: canvasPluginsConfigPath(),
    pluginDirs,
    plugins,
    rendererSpecs: dedupeRendererSpecs(plugins.flatMap((plugin) => plugin.rendererSpecs)),
  };
}

export async function addCanvasPluginDirectory(dir: string): Promise<CanvasPluginsStatus> {
  const normalized = normalizePluginDir(dir);
  if (!normalized) throw new Error('Plugin directory path is required');
  const config = await readConfig();
  const dirs = Array.from(new Set([...(config.pluginDirs ?? []), normalized]));
  await writeConfig({ pluginDirs: dirs });
  return getCanvasPluginsStatus();
}

export async function removeCanvasPluginDirectory(dir: string): Promise<CanvasPluginsStatus> {
  const normalized = normalizePluginDir(dir);
  const config = await readConfig();
  await writeConfig({
    pluginDirs: (config.pluginDirs ?? []).filter((item) => normalizePluginDir(item) !== normalized),
  });
  return getCanvasPluginsStatus();
}

export function parseCanvasPluginsConfigJson(json: string): string[] {
  const parsed = JSON.parse(json) as unknown;
  const dirs = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.pluginDirs)
      ? parsed.pluginDirs
      : [];
  return dirs
    .filter((dir): dir is string => typeof dir === 'string' && !!dir.trim())
    .map(normalizePluginDir);
}

export async function importCanvasPluginsConfigJson(json: string): Promise<{
  entries: CanvasPluginsImportEntry[];
  status: CanvasPluginsStatus;
}> {
  const incoming = parseCanvasPluginsConfigJson(json);
  const config = await readConfig();
  const existing = new Set((config.pluginDirs ?? []).map(normalizePluginDir));
  const entries: CanvasPluginsImportEntry[] = [];
  for (const dir of incoming) {
    if (!dir) continue;
    if (existing.has(dir)) {
      entries.push({ dir, status: 'existing' });
      continue;
    }
    existing.add(dir);
    entries.push({ dir, status: 'added' });
  }
  if (incoming.length === 0) {
    entries.push({
      dir: '',
      status: 'skipped',
      reason: 'Expected JSON array or { "pluginDirs": [...] }',
    });
  }
  await writeConfig({ pluginDirs: Array.from(existing) });
  return { entries, status: await getCanvasPluginsStatus() };
}
