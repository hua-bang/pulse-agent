import { app } from 'electron';
import { existsSync, readFileSync } from 'fs';
import { promises as fs } from 'fs';
import { dirname, isAbsolute, join, normalize, resolve } from 'path';
import type {
  CanvasPluginConfigField,
  CanvasPluginConfigFieldStatus,
  CanvasPluginEntry,
  CanvasPluginMainSpec,
  CanvasPluginManifestNode,
  CanvasPluginRendererSpec,
  CanvasPluginSkillSpec,
  CanvasPluginsImportEntry,
  CanvasPluginsStatus,
} from '../../shared/settings-config';

interface CanvasPluginsConfigFile {
  pluginDirs?: string[];
  pluginConfig?: Record<string, Record<string, string>>;
}

interface CanvasPluginManifest {
  id?: unknown;
  version?: unknown;
  main?: unknown;
  skills?: unknown;
  config?: unknown;
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
      pluginConfig: normalizeStoredPluginConfig(parsed.pluginConfig),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { pluginDirs: [] };
    throw err;
  }
}

function readConfigSync(): CanvasPluginsConfigFile {
  try {
    const raw = readFileSync(canvasPluginsConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as CanvasPluginsConfigFile;
    return {
      pluginDirs: Array.isArray(parsed.pluginDirs)
        ? parsed.pluginDirs
            .filter((dir): dir is string => typeof dir === 'string' && !!dir.trim())
            .map(normalizePluginDir)
        : [],
      pluginConfig: normalizeStoredPluginConfig(parsed.pluginConfig),
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
    JSON.stringify(
      {
        pluginDirs: config.pluginDirs ?? [],
        pluginConfig: config.pluginConfig ?? {},
      },
      null,
      2,
    ),
    'utf8',
  );
}

function normalizeStoredPluginConfig(value: unknown): Record<string, Record<string, string>> {
  if (!isRecord(value)) return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [pluginId, pluginConfig] of Object.entries(value)) {
    if (!isRecord(pluginConfig)) continue;
    const fields: Record<string, string> = {};
    for (const [key, fieldValue] of Object.entries(pluginConfig)) {
      if (typeof fieldValue === 'string') fields[key] = fieldValue;
    }
    if (Object.keys(fields).length > 0) out[pluginId] = fields;
  }
  return out;
}

function encodeConfigValue(value: string): string {
  return `plain:${Buffer.from(value, 'utf8').toString('base64')}`;
}

function decodeConfigValue(value: string): string | undefined {
  try {
    if (value.startsWith('plain:')) {
      return Buffer.from(value.slice(6), 'base64').toString('utf8');
    }
  } catch {
    return undefined;
  }
  return value;
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

function normalizeManifestSkills(dir: string, value: unknown): CanvasPluginSkillSpec[] {
  if (!Array.isArray(value)) return [];
  const skills: CanvasPluginSkillSpec[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const rawPath = typeof item.path === 'string' ? item.path.trim() : '';
    if (!rawPath) continue;

    const sourcePath = isAbsolute(rawPath)
      ? normalize(rawPath)
      : normalize(join(dir, rawPath));
    const skillFile = sourcePath.endsWith('SKILL.md')
      ? sourcePath
      : join(sourcePath, 'SKILL.md');
    const scanPath = sourcePath.endsWith('SKILL.md') ? dirname(sourcePath) : sourcePath;
    if (seen.has(skillFile)) continue;
    seen.add(skillFile);

    skills.push({
      name: typeof item.name === 'string' && item.name.trim()
        ? item.name.trim()
        : undefined,
      description: typeof item.description === 'string' && item.description.trim()
        ? item.description.trim()
        : undefined,
      path: skillFile,
      scanPath,
    });
  }
  return skills;
}

function normalizeManifestConfig(value: unknown): CanvasPluginConfigField[] {
  if (!Array.isArray(value)) return [];
  const fields: CanvasPluginConfigField[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const type = item.type === 'password' || item.type === 'url' || item.type === 'string'
      ? item.type
      : undefined;
    fields.push({
      key,
      label: typeof item.label === 'string' ? item.label : undefined,
      description: typeof item.description === 'string' ? item.description : undefined,
      type,
      placeholder: typeof item.placeholder === 'string' ? item.placeholder : undefined,
      required: typeof item.required === 'boolean' ? item.required : undefined,
      envKeys: Array.isArray(item.envKeys)
        ? item.envKeys.filter((envKey): envKey is string => typeof envKey === 'string' && !!envKey.trim())
        : undefined,
    });
  }
  return fields;
}

function storedPluginValue(
  config: CanvasPluginsConfigFile,
  pluginId: string,
  key: string,
): string | undefined {
  const value = config.pluginConfig?.[pluginId]?.[key];
  if (typeof value !== 'string') return undefined;
  const decoded = decodeConfigValue(value);
  return decoded?.trim() ? decoded : undefined;
}

function envPluginValue(field: CanvasPluginConfigField): string | undefined {
  for (const envKey of field.envKeys ?? []) {
    const value = process.env[envKey]?.trim();
    if (value) return value;
  }
  return undefined;
}

function pluginConfigStatus(
  fields: CanvasPluginConfigField[],
  config: CanvasPluginsConfigFile,
  pluginId: string,
): CanvasPluginConfigFieldStatus[] {
  return fields.map((field) => {
    const stored = storedPluginValue(config, pluginId, field.key);
    const env = stored ? undefined : envPluginValue(field);
    const value = stored ?? env;
    return {
      ...field,
      configured: Boolean(value),
      source: stored ? 'stored' : env ? 'env' : 'missing',
      valueLength: value?.length,
    };
  });
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

async function readPluginEntry(
  dir: string,
  config: CanvasPluginsConfigFile,
): Promise<CanvasPluginEntry> {
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
    const skills = normalizeManifestSkills(dir, manifest.skills);
    const pluginConfigFields = normalizeManifestConfig(manifest.config);
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
      skills,
      config: pluginConfigFields,
      configStatus: pluginConfigStatus(pluginConfigFields, config, id),
      nodes,
      rendererSpecs,
      error: nodes.length === 0 && !main && skills.length === 0
        ? 'manifest.json has no valid nodes, main, or skills'
        : undefined,
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

export function getCanvasPluginSkillScanPathsSync(): string[] {
  let config: CanvasPluginsConfigFile;
  try {
    config = readConfigSync();
  } catch (err) {
    console.warn('[canvas-plugins] failed to read plugin config for skills:', err);
    return [];
  }
  const pluginDirs = Array.from(new Set((config.pluginDirs ?? []).map(normalizePluginDir).filter(Boolean)));
  const scanPaths: string[] = [];
  const seen = new Set<string>();
  for (const dir of pluginDirs) {
    try {
      const raw = readFileSync(join(dir, 'manifest.json'), 'utf8');
      const manifest = JSON.parse(raw) as CanvasPluginManifest;
      const skills = normalizeManifestSkills(dir, manifest.skills);
      for (const skill of skills) {
        if (!existsSync(skill.path)) continue;
        if (seen.has(skill.scanPath)) continue;
        seen.add(skill.scanPath);
        scanPaths.push(skill.scanPath);
      }
    } catch (err) {
      console.warn('[canvas-plugins] failed to read plugin skills:', dir, err);
    }
  }
  return scanPaths;
}

export async function getCanvasPluginSkillSources(): Promise<Array<{
  base: string;
  source: 'plugin';
  writable: false;
}>> {
  const status = await getCanvasPluginsStatus();
  const sources: Array<{ base: string; source: 'plugin'; writable: false }> = [];
  const seen = new Set<string>();
  for (const plugin of status.plugins) {
    if (plugin.error) continue;
    for (const skill of plugin.skills ?? []) {
      if (seen.has(skill.scanPath)) continue;
      seen.add(skill.scanPath);
      sources.push({ base: skill.scanPath, source: 'plugin', writable: false });
    }
  }
  return sources;
}

export async function getCanvasPluginsStatus(): Promise<CanvasPluginsStatus> {
  const config = await readConfig();
  const pluginDirs = Array.from(new Set((config.pluginDirs ?? []).map(normalizePluginDir).filter(Boolean)));
  const plugins = await Promise.all(pluginDirs.map((dir) => readPluginEntry(dir, config)));
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
  await writeConfig({ ...config, pluginDirs: dirs });
  return getCanvasPluginsStatus();
}

export async function removeCanvasPluginDirectory(dir: string): Promise<CanvasPluginsStatus> {
  const normalized = normalizePluginDir(dir);
  const config = await readConfig();
  await writeConfig({
    ...config,
    pluginDirs: (config.pluginDirs ?? []).filter((item) => normalizePluginDir(item) !== normalized),
  });
  return getCanvasPluginsStatus();
}

export async function resolveCanvasPluginConfigValue(
  pluginId: string,
  key: string,
): Promise<string | undefined> {
  const config = await readConfig();
  const pluginDirs = Array.from(new Set((config.pluginDirs ?? []).map(normalizePluginDir).filter(Boolean)));
  for (const dir of pluginDirs) {
    const entry = await readPluginEntry(dir, config);
    if (entry.id !== pluginId) continue;
    const field = entry.config?.find((item) => item.key === key);
    return storedPluginValue(config, pluginId, key) ?? (field ? envPluginValue(field) : undefined);
  }
  return storedPluginValue(config, pluginId, key);
}

export async function setCanvasPluginConfigValue(
  pluginId: string,
  key: string,
  value: string,
): Promise<CanvasPluginsStatus> {
  const normalizedPluginId = pluginId.trim();
  const normalizedKey = key.trim();
  const normalizedValue = value.trim();
  if (!normalizedPluginId || !normalizedKey) throw new Error('Plugin id and config key are required');

  const config = await readConfig();
  const pluginConfig = normalizeStoredPluginConfig(config.pluginConfig);
  if (normalizedValue) {
    pluginConfig[normalizedPluginId] = {
      ...(pluginConfig[normalizedPluginId] ?? {}),
      [normalizedKey]: encodeConfigValue(normalizedValue),
    };
  } else if (pluginConfig[normalizedPluginId]) {
    delete pluginConfig[normalizedPluginId][normalizedKey];
    if (Object.keys(pluginConfig[normalizedPluginId]).length === 0) {
      delete pluginConfig[normalizedPluginId];
    }
  }
  await writeConfig({ ...config, pluginConfig });
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
  await writeConfig({ ...config, pluginDirs: Array.from(existing) });
  return { entries, status: await getCanvasPluginsStatus() };
}
