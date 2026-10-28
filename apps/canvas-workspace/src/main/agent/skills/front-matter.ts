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
    let value = kv[2].trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.replace(/^"|"$/g, '');
      }
    }
    fields[kv[1]] = value;
  }
  return fields;
}
