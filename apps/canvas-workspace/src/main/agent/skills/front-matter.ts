/** Decode one YAML scalar the way gray-matter would for single-line values. */
function readScalar(raw: string): string {
  const doubleQuoted = /^"((?:[^"\\]|\\.)*)"/.exec(raw);
  if (doubleQuoted) {
    try {
      return JSON.parse(doubleQuoted[0]) as string;
    } catch {
      return doubleQuoted[1];
    }
  }
  const singleQuoted = /^'((?:[^']|'')*)'/.exec(raw);
  if (singleQuoted) return singleQuoted[1].replace(/''/g, "'");
  // A plain scalar ends at a ` #` comment.
  return raw.replace(/\s+#.*$/, '');
}

/**
 * Minimal SKILL.md front-matter reader shared by the settings list and the
 * importers. It reads single-line `key: value` pairs only; the engine's
 * gray-matter parse stays the runtime source of truth.
 */
export function readFrontMatterFields(frontMatter: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of frontMatter.split(/\r?\n/)) {
    const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    fields[kv[1]] = readScalar(kv[2].trim());
  }
  return fields;
}
