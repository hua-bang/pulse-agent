import { isAbsolute, join, normalize } from 'path';
import type { NormalizedPluginPackage } from '../../shared/plugin-market';
import type {
  CanvasPluginConfigField,
  CanvasPluginConfigFieldStatus,
  CanvasPluginEntry,
  CanvasPluginMainSpec,
  CanvasPluginManifestNode,
  CanvasPluginRendererSpec,
} from '../../shared/settings-config';
import { normalizeManifestIcon } from '../settings/plugin-manifest-icons';

const DEFAULT_EXPOSE = './plugin';
const LOCAL_SCHEME = 'pulse-canvas://local';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toLocalPluginAssetUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  const isWindowsDrivePath = /^[a-zA-Z]:\//.test(normalized);
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const encoded = withLeadingSlash.split('/').map((segment, index) => {
    if (isWindowsDrivePath && index === 1 && /^[a-zA-Z]:$/.test(segment)) return segment;
    return encodeURIComponent(segment);
  }).join('/');
  return `${LOCAL_SCHEME}${encoded}`;
}

function normalizeNode(dir: string, value: unknown): CanvasPluginManifestNode | null {
  if (!isRecord(value)) return null;
  const type = typeof value.type === 'string' ? value.type.trim() : '';
  if (!type) return null;
  const renderer = isRecord(value.renderer) ? value.renderer : undefined;
  return {
    type,
    title: typeof value.title === 'string' ? value.title : undefined,
    icon: normalizeManifestIcon(dir, value.icon),
    capabilities: Array.isArray(value.capabilities)
      ? value.capabilities.filter((item): item is string => typeof item === 'string')
      : undefined,
    actions: Array.isArray(value.actions)
      ? value.actions.filter((item): item is string => typeof item === 'string')
      : undefined,
    renderer: renderer ? {
      remoteName: typeof renderer.remoteName === 'string' ? renderer.remoteName : undefined,
      name: typeof renderer.name === 'string' ? renderer.name : undefined,
      entry: typeof renderer.entry === 'string' ? renderer.entry : undefined,
      expose: typeof renderer.expose === 'string' ? renderer.expose : undefined,
      type: typeof renderer.type === 'string' ? renderer.type : undefined,
      entryGlobalName: typeof renderer.entryGlobalName === 'string'
        ? renderer.entryGlobalName
        : undefined,
    } : undefined,
  };
}

function rendererSpec(
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

function mainSpec(dir: string, value: unknown): CanvasPluginMainSpec | undefined {
  if (!isRecord(value)) return undefined;
  const entry = typeof value.entry === 'string' ? value.entry.trim() : '';
  if (!entry) return undefined;
  return {
    entry: isAbsolute(entry) ? normalize(entry) : normalize(join(dir, entry)),
    format: typeof value.format === 'string' && value.format.trim() ? value.format.trim() : undefined,
    runtime: typeof value.runtime === 'string' && value.runtime.trim() ? value.runtime.trim() : undefined,
    permissions: Array.isArray(value.permissions)
      ? value.permissions.filter((item): item is string => typeof item === 'string')
      : undefined,
  };
}

function normalizeConfig(value: unknown): CanvasPluginConfigField[] {
  if (!Array.isArray(value)) return [];
  const fields: CanvasPluginConfigField[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fields.push({
      key,
      label: typeof item.label === 'string' ? item.label : undefined,
      description: typeof item.description === 'string' ? item.description : undefined,
      type: item.type === 'password' || item.type === 'url' || item.type === 'string'
        ? item.type
        : undefined,
      placeholder: typeof item.placeholder === 'string' ? item.placeholder : undefined,
      required: typeof item.required === 'boolean' ? item.required : undefined,
      envKeys: Array.isArray(item.envKeys)
        ? item.envKeys.filter((key): key is string => typeof key === 'string' && Boolean(key.trim()))
        : undefined,
    });
  }
  return fields;
}

function configStatus(
  fields: CanvasPluginConfigField[],
  pluginId: string,
  storedValue: (pluginId: string, key: string) => string | undefined,
): CanvasPluginConfigFieldStatus[] {
  return fields.map((field) => {
    const stored = storedValue(pluginId, field.key);
    const env = stored ? undefined : field.envKeys
      ?.map((key) => process.env[key]?.trim())
      .find(Boolean);
    const value = stored ?? env;
    return {
      ...field,
      configured: Boolean(value),
      source: stored ? 'stored' : env ? 'env' : 'missing',
      valueLength: value?.length,
    };
  });
}

export function dedupeRendererSpecs(
  specs: CanvasPluginRendererSpec[],
): CanvasPluginRendererSpec[] {
  const seen = new Set<string>();
  return specs.filter((spec) => {
    const key = `${spec.id}:${spec.name}:${spec.entry}:${spec.expose ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function canvasEntryFromPackage(
  plugin: NormalizedPluginPackage,
  storedValue: (pluginId: string, key: string) => string | undefined,
  explicitNativePolicy?: boolean,
): CanvasPluginEntry {
  const nativeEnabled = explicitNativePolicy ?? plugin.format === 'legacy-canvas';
  const extension = nativeEnabled ? plugin.pulseExtension : undefined;
  const main = extension?.main ? mainSpec(plugin.root, extension.main) : undefined;
  const skills = plugin.skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    path: skill.skillPath,
    scanPath: skill.directory,
  }));
  const config = extension ? normalizeConfig(extension.config) : [];
  const nodes = (extension?.nodes ?? [])
    .map((node) => normalizeNode(plugin.root, node))
    .filter((node): node is CanvasPluginManifestNode => node !== null);
  const rendererSpecs = dedupeRendererSpecs(
    nodes
      .map((node) => rendererSpec(plugin.name, plugin.version, plugin.root, node))
      .filter((spec): spec is CanvasPluginRendererSpec => spec !== null),
  );
  return {
    id: plugin.name,
    version: plugin.version,
    dir: plugin.root,
    manifestPath: plugin.manifestPath,
    main,
    skills,
    config,
    configStatus: configStatus(config, plugin.name, storedValue),
    nodes,
    rendererSpecs,
  };
}
