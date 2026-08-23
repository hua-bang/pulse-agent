import { promises as fs } from 'fs';
import { join } from 'path';
import {
  PULSE_CANVAS_EXTENSION_NAMESPACE,
  type JsonObject,
  type PluginPackageDiagnostic,
  type PluginPackagePulseExtension,
  type PulseCanvasPluginConfigField,
  type PulseCanvasPluginMain,
  type PulseCanvasPluginNode,
  type PulseCanvasPluginRenderer,
} from '../../shared/plugin-market';
import {
  containedRealpath,
  diagnostic,
  errorMessage,
  isAbsolutePackagePath,
  isRecord,
  pathExists,
  resolvePackagePath,
  stringArray,
} from './package-reader-support';

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const item = value[key];
  if (item === undefined) return undefined;
  if (typeof item !== 'string') throw new Error(`${key} must be a string`);
  return item;
}

function optionalStringArray(value: Record<string, unknown>, key: string): string[] | undefined {
  const item = value[key];
  if (item === undefined) return undefined;
  const normalized = stringArray(item);
  if (!normalized) throw new Error(`${key} must be an array of strings`);
  return normalized;
}

async function normalizeMain(
  root: string,
  value: unknown,
): Promise<PulseCanvasPluginMain | undefined> {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.entry !== 'string' || !value.entry) {
    throw new Error('main must contain a non-empty entry');
  }
  return {
    entry: await resolvePackagePath(root, value.entry, 'file'),
    ...(optionalString(value, 'format') !== undefined ? { format: optionalString(value, 'format') } : {}),
    ...(optionalString(value, 'runtime') !== undefined ? { runtime: optionalString(value, 'runtime') } : {}),
    ...(optionalStringArray(value, 'permissions') !== undefined
      ? { permissions: optionalStringArray(value, 'permissions') }
      : {}),
  };
}

async function normalizeIcon(root: string, icon: unknown): Promise<string | undefined> {
  if (icon === undefined) return undefined;
  if (typeof icon !== 'string') throw new Error('node icon must be a string');
  if (isAbsolutePackagePath(icon)) throw new Error('absolute node icon paths are not allowed');
  if (/[/\\]/.test(icon) || /\.[a-z0-9]{2,5}$/i.test(icon)) {
    return resolvePackagePath(root, icon, 'file');
  }
  return icon;
}

async function normalizeRenderer(
  root: string,
  value: unknown,
): Promise<PulseCanvasPluginRenderer | undefined> {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('node renderer must be an object');
  const entry = optionalString(value, 'entry');
  return {
    ...(optionalString(value, 'remoteName') !== undefined
      ? { remoteName: optionalString(value, 'remoteName') }
      : {}),
    ...(optionalString(value, 'name') !== undefined ? { name: optionalString(value, 'name') } : {}),
    ...(entry ? { entry: await resolvePackagePath(root, entry, 'file') } : {}),
    ...(optionalString(value, 'expose') !== undefined ? { expose: optionalString(value, 'expose') } : {}),
    ...(optionalString(value, 'type') !== undefined ? { type: optionalString(value, 'type') } : {}),
    ...(optionalString(value, 'entryGlobalName') !== undefined
      ? { entryGlobalName: optionalString(value, 'entryGlobalName') }
      : {}),
  };
}

async function normalizeNodes(root: string, value: unknown): Promise<PulseCanvasPluginNode[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('nodes must be an array');
  const nodes: PulseCanvasPluginNode[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.type !== 'string' || !item.type.trim()) {
      throw new Error('each node must contain a non-empty type');
    }
    const icon = await normalizeIcon(root, item.icon);
    const renderer = await normalizeRenderer(root, item.renderer);
    nodes.push({
      type: item.type.trim(),
      ...(optionalString(item, 'title') !== undefined ? { title: optionalString(item, 'title') } : {}),
      ...(icon !== undefined ? { icon } : {}),
      ...(optionalStringArray(item, 'capabilities') !== undefined
        ? { capabilities: optionalStringArray(item, 'capabilities') }
        : {}),
      ...(optionalStringArray(item, 'actions') !== undefined
        ? { actions: optionalStringArray(item, 'actions') }
        : {}),
      ...(renderer ? { renderer } : {}),
    });
  }
  return nodes;
}

function normalizeConfig(value: unknown): PulseCanvasPluginConfigField[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('config must be an array');
  const fields: PulseCanvasPluginConfigField[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.key !== 'string' || !item.key.trim()) {
      throw new Error('each config field must contain a non-empty key');
    }
    const key = item.key.trim();
    if (seen.has(key)) throw new Error(`duplicate config key \`${key}\``);
    seen.add(key);
    if (item.type !== undefined && !['string', 'password', 'url'].includes(String(item.type))) {
      throw new Error(`invalid config type for \`${key}\``);
    }
    if (item.required !== undefined && typeof item.required !== 'boolean') {
      throw new Error(`required must be boolean for \`${key}\``);
    }
    fields.push({
      key,
      ...(optionalString(item, 'label') !== undefined ? { label: optionalString(item, 'label') } : {}),
      ...(optionalString(item, 'description') !== undefined
        ? { description: optionalString(item, 'description') }
        : {}),
      ...(typeof item.type === 'string'
        ? { type: item.type as PulseCanvasPluginConfigField['type'] }
        : {}),
      ...(optionalString(item, 'placeholder') !== undefined
        ? { placeholder: optionalString(item, 'placeholder') }
        : {}),
      ...(typeof item.required === 'boolean' ? { required: item.required } : {}),
      ...(optionalStringArray(item, 'envKeys') !== undefined
        ? { envKeys: optionalStringArray(item, 'envKeys') }
        : {}),
    });
  }
  return fields;
}

export async function readPulseExtension(
  root: string,
  value: unknown,
  source: PluginPackagePulseExtension['source'],
  diagnostics: PluginPackageDiagnostic[],
): Promise<PluginPackagePulseExtension | undefined> {
  const directoryCandidate = join(root, PULSE_CANVAS_EXTENSION_NAMESPACE);
  let hasDirectory: boolean;
  try {
    hasDirectory = await pathExists(directoryCandidate);
  } catch (error) {
    diagnostics.push(diagnostic(
      'error', 'pulse-extension', 'pulse-extension.invalid', errorMessage(error), directoryCandidate,
    ));
    return undefined;
  }
  if (value === undefined && !hasDirectory) return undefined;

  try {
    let directory: string | undefined;
    if (hasDirectory) {
      directory = await containedRealpath(root, directoryCandidate);
      if (!(await fs.stat(directory)).isDirectory()) {
        throw new Error(`${PULSE_CANVAS_EXTENSION_NAMESPACE} must resolve to a directory`);
      }
    }
    if (value !== undefined && !isRecord(value)) throw new Error('Pulse extension data must be an object');
    const data = (value ?? {}) as JsonObject;
    const schemaVersion = data.schemaVersion;
    if (schemaVersion !== undefined && (!Number.isInteger(schemaVersion) || Number(schemaVersion) < 1)) {
      throw new Error('schemaVersion must be a positive integer');
    }
    const main = await normalizeMain(root, data.main);
    return {
      namespace: PULSE_CANVAS_EXTENSION_NAMESPACE,
      source,
      ...(directory ? { directory } : {}),
      data,
      ...(typeof schemaVersion === 'number' ? { schemaVersion } : {}),
      ...(main ? { main } : {}),
      nodes: await normalizeNodes(root, data.nodes),
      config: normalizeConfig(data.config),
    };
  } catch (error) {
    diagnostics.push(diagnostic(
      'error',
      'pulse-extension',
      'pulse-extension.invalid',
      errorMessage(error),
      hasDirectory ? directoryCandidate : join(root, 'plugin.json'),
      PULSE_CANVAS_EXTENSION_NAMESPACE,
    ));
    return undefined;
  }
}
