import type {
  JsonObject,
  PluginPackageAuthor,
  PluginPackageDiagnostic,
} from '../../shared/plugin-market';
import { AGENT_PLUGIN_V1_SCHEMA } from '../../shared/plugin-market';
import { diagnostic, isRecord } from './package-reader-support';

const AGENT_MANIFEST_FIELDS = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions',
]);
const PLUGIN_NAME_PATTERN = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

function optionalString(
  manifest: Record<string, unknown>,
  field: string,
  failures: string[],
): string | undefined {
  const value = manifest[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') failures.push(`\`${field}\` must be a string`);
  return typeof value === 'string' ? value : undefined;
}

export interface AgentManifest {
  name: string;
  version?: string;
  description?: string;
  author?: PluginPackageAuthor;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords: string[];
  extensions?: JsonObject;
}

export function validateAgentManifest(
  value: unknown,
  path: string,
  diagnostics: PluginPackageDiagnostic[],
): AgentManifest | null {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic('error', 'manifest', 'manifest.not-object', 'plugin.json must contain a JSON object', path));
    return null;
  }

  for (const field of Object.keys(value)) {
    if (!AGENT_MANIFEST_FIELDS.has(field)) {
      diagnostics.push(diagnostic(
        'warning',
        'manifest',
        'manifest.unknown-field',
        `Ignoring unknown plugin.json field \`${field}\``,
        path,
        field,
      ));
    }
  }

  const failures: string[] = [];
  if (value.$schema !== AGENT_PLUGIN_V1_SCHEMA) failures.push(`\`$schema\` must be ${AGENT_PLUGIN_V1_SCHEMA}`);
  const name = typeof value.name === 'string' ? value.name : '';
  if (name.length < 1 || name.length > 64 || !PLUGIN_NAME_PATTERN.test(name)) {
    failures.push('`name` must be 1-64 lowercase letters, digits, periods, or hyphens without edge punctuation, `--`, or `..`');
  }
  const version = optionalString(value, 'version', failures);
  const description = optionalString(value, 'description', failures);
  const homepage = optionalString(value, 'homepage', failures);
  const repository = optionalString(value, 'repository', failures);
  const license = optionalString(value, 'license', failures);

  let author: PluginPackageAuthor | undefined;
  if (value.author !== undefined) {
    if (!isRecord(value.author)) failures.push('`author` must be an object');
    else {
      const unknown = Object.keys(value.author).filter((key) => !['name', 'email', 'url'].includes(key));
      if (unknown.length > 0) failures.push(`\`author\` has unknown field \`${unknown[0]}\``);
      const authorFailures: string[] = [];
      const authorName = optionalString(value.author, 'name', authorFailures);
      const authorEmail = optionalString(value.author, 'email', authorFailures);
      const authorUrl = optionalString(value.author, 'url', authorFailures);
      author = {
        ...(authorName !== undefined ? { name: authorName } : {}),
        ...(authorEmail !== undefined ? { email: authorEmail } : {}),
        ...(authorUrl !== undefined ? { url: authorUrl } : {}),
      };
      failures.push(...authorFailures.map((failure) => `author.${failure}`));
    }
  }

  let keywords: string[] = [];
  if (value.keywords !== undefined) {
    if (!Array.isArray(value.keywords) || value.keywords.some((item) => typeof item !== 'string')) {
      failures.push('`keywords` must be an array of strings');
    } else keywords = value.keywords as string[];
  }

  let extensions: JsonObject | undefined;
  if (value.extensions !== undefined) {
    if (!isRecord(value.extensions)) {
      diagnostics.push(diagnostic('warning', 'manifest', 'manifest.invalid-extensions', 'Ignoring non-object `extensions` field', path));
    } else extensions = value.extensions as JsonObject;
  }

  if (failures.length > 0) {
    diagnostics.push(...failures.map((message) => diagnostic('error', 'manifest', 'manifest.invalid', message, path)));
    return null;
  }
  return {
    name,
    ...(version !== undefined ? { version } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(homepage !== undefined ? { homepage } : {}),
    ...(repository !== undefined ? { repository } : {}),
    ...(license !== undefined ? { license } : {}),
    keywords,
    ...(extensions !== undefined ? { extensions } : {}),
  };
}
