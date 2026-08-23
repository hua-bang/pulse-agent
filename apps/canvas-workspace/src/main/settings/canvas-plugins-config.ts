import { app } from 'electron';
import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'path';
import type {
  CanvasPluginEntry,
  CanvasPluginSkillSpec,
  CanvasPluginsImportEntry,
  CanvasPluginsStatus,
} from '../../shared/settings-config';
import { readPluginPackage } from '../plugin-market/package-reader';
import { agentPluginSkillScanPathsSync } from '../plugin-market/skill-scan';
import { canvasEntryFromPackage, dedupeRendererSpecs } from '../plugin-market/canvas-package-adapter';

interface CanvasPluginsConfigFile {
  pluginDirs?: string[];
  pluginConfig?: Record<string, Record<string, string>>;
  /** Execution-authoritative native-code policy, keyed by normalized plugin root. */
  pluginNativePolicy?: Record<string, boolean>;
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

export function canvasPluginsConfigPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
      pluginNativePolicy: normalizeNativePolicy(parsed.pluginNativePolicy),
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
      pluginNativePolicy: normalizeNativePolicy(parsed.pluginNativePolicy),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { pluginDirs: [] };
    throw err;
  }
}

async function writeConfig(config: CanvasPluginsConfigFile): Promise<void> {
  const configPath = canvasPluginsConfigPath();
  await fs.mkdir(dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(
      temporary,
      JSON.stringify(
        {
          pluginDirs: config.pluginDirs ?? [],
          pluginConfig: config.pluginConfig ?? {},
          pluginNativePolicy: normalizeNativePolicy(config.pluginNativePolicy),
        },
        null,
        2,
      ),
      'utf8',
    );
    await fs.rename(temporary, configPath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

let configMutationTail: Promise<void> = Promise.resolve();
function runConfigMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = configMutationTail.then(operation);
  configMutationTail = result.then(() => undefined, () => undefined);
  return result;
}
function updateConfig(update: (
  config: CanvasPluginsConfigFile,
) => CanvasPluginsConfigFile): Promise<CanvasPluginsStatus> {
  return runConfigMutation(async () => {
    const config = await readConfig();
    await writeConfig(update(config));
    return getCanvasPluginsStatus();
  });
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

function normalizeNativePolicy(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const policy: Record<string, boolean> = {};
  for (const [root, enabled] of Object.entries(value)) {
    const normalizedRoot = normalizePluginDir(root);
    if (!normalizedRoot || typeof enabled !== 'boolean') continue;
    policy[normalizedRoot] = enabled;
  }
  return policy;
}

function nativePolicyWithout(config: CanvasPluginsConfigFile, root: string): Record<string, boolean> {
  const policy = normalizeNativePolicy(config.pluginNativePolicy);
  delete policy[root];
  return policy;
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

function containedRealpathSync(root: string, candidate: string): string | undefined {
  try {
    const canonicalRoot = realpathSync(root);
    const canonical = realpathSync(candidate);
    const child = relative(canonicalRoot, canonical);
    if (child !== '' && (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))) {
      return undefined;
    }
    return canonical;
  } catch {
    return undefined;
  }
}

function normalizeManifestSkills(dir: string, value: unknown): CanvasPluginSkillSpec[] {
  if (!Array.isArray(value)) return [];
  const skills: CanvasPluginSkillSpec[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const rawPath = typeof item.path === 'string' ? item.path.trim() : '';
    if (
      !rawPath
      || isAbsolute(rawPath)
      || /^[a-zA-Z]:[\\/]/.test(rawPath)
      || rawPath.startsWith('\\\\')
    ) continue;

    const root = containedRealpathSync(dir, dir);
    if (!root) continue;
    const candidate = resolve(root, rawPath);
    const skillCandidate = rawPath.endsWith('SKILL.md')
      ? candidate
      : join(candidate, 'SKILL.md');
    const skillFile = containedRealpathSync(root, skillCandidate);
    if (!skillFile || !statSync(skillFile).isFile()) continue;
    const scanPath = dirname(skillFile);
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

function envPluginValue(field: { envKeys?: string[] }): string | undefined {
  return field.envKeys?.map((key) => process.env[key]?.trim()).find(Boolean);
}

async function readPluginEntry(
  dir: string,
  config: CanvasPluginsConfigFile,
): Promise<CanvasPluginEntry> {
  const result = await readPluginPackage(dir);
  if (!result.package) {
    return {
      id: 'unknown',
      dir,
      manifestPath: existsSync(join(dir, 'plugin.json'))
        ? join(dir, 'plugin.json')
        : join(dir, 'manifest.json'),
      nodes: [],
      rendererSpecs: [],
      error: result.diagnostics.map((item) => item.message).join('; ') || 'Invalid plugin package',
    };
  }
  return canvasEntryFromPackage(
    result.package,
    (pluginId, key) => storedPluginValue(config, pluginId, key),
    config.pluginNativePolicy?.[normalizePluginDir(result.package.root)],
  );
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
      const agentPluginPaths = agentPluginSkillScanPathsSync(dir);
      if (agentPluginPaths) {
        for (const scanPath of agentPluginPaths) {
          if (seen.has(scanPath)) continue;
          seen.add(scanPath);
          scanPaths.push(scanPath);
        }
        continue;
      }
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
  return updateConfig((config) => ({
    ...config,
    pluginDirs: Array.from(new Set([...(config.pluginDirs ?? []), normalized])),
  }));
}

export async function addCanvasPluginDirectoryWithNativePolicy(
  dir: string,
  nativeEnabled: boolean,
): Promise<CanvasPluginsStatus> {
  const normalized = normalizePluginDir(dir);
  if (!normalized) throw new Error('Plugin directory path is required');
  return updateConfig((config) => ({
    ...config,
    pluginDirs: Array.from(new Set([...(config.pluginDirs ?? []), normalized])),
    pluginNativePolicy: {
      ...normalizeNativePolicy(config.pluginNativePolicy),
      [normalized]: nativeEnabled,
    },
  }));
}

export async function addCanvasPluginDirectoryWithoutNativePolicy(dir: string): Promise<CanvasPluginsStatus> {
  const normalized = normalizePluginDir(dir);
  if (!normalized) throw new Error('Plugin directory path is required');
  return updateConfig((config) => ({
    ...config,
    pluginDirs: Array.from(new Set([...(config.pluginDirs ?? []), normalized])),
    pluginNativePolicy: nativePolicyWithout(config, normalized),
  }));
}
export async function setCanvasPluginNativePolicy(
  dir: string,
  nativeEnabled: boolean,
): Promise<CanvasPluginsStatus> {
  const normalized = normalizePluginDir(dir);
  if (!normalized) throw new Error('Plugin directory path is required');
  return updateConfig((config) => {
    if (!(config.pluginDirs ?? []).some((item) => normalizePluginDir(item) === normalized)) {
      throw new Error('Plugin directory is not registered');
    }
    return {
      ...config,
      pluginNativePolicy: {
        ...normalizeNativePolicy(config.pluginNativePolicy),
        [normalized]: nativeEnabled,
      },
    };
  });
}
export function getCanvasPluginNativePolicySync(
  dir: string,
  format: 'agent-plugin' | 'legacy-canvas',
): boolean {
  try {
    const config = readConfigSync();
    const explicit = config.pluginNativePolicy?.[normalizePluginDir(dir)];
    return explicit ?? format === 'legacy-canvas';
  } catch {
    return false;
  }
}

export function getCanvasPluginExplicitNativePolicySync(dir: string): boolean | undefined {
  try {
    return readConfigSync().pluginNativePolicy?.[normalizePluginDir(dir)];
  } catch {
    return undefined;
  }
}

export async function removeCanvasPluginDirectory(dir: string): Promise<CanvasPluginsStatus> {
  const normalized = normalizePluginDir(dir);
  return updateConfig((config) => ({
    ...config,
    pluginDirs: (config.pluginDirs ?? []).filter((item) => normalizePluginDir(item) !== normalized),
    pluginNativePolicy: nativePolicyWithout(config, normalized),
  }));
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

  return updateConfig((config) => {
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
    return { ...config, pluginConfig };
  });
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
  return runConfigMutation(async () => {
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
  });
}
