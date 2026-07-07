// Minimal YAML-subset parser for the harness data files (validation.yaml,
// pnpm-workspace.yaml): nested maps, lists of scalars or maps, quoted
// scalars, comments. Not a general YAML implementation.

export function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

export function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const line = raw.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    if (line.startsWith('- ')) {
      if (!Array.isArray(parent)) continue;
      const itemText = line.slice(2).trim();
      if (!itemText) {
        const obj = {};
        parent.push(obj);
        stack.push({ indent, value: obj });
      } else if (itemText.includes(': ')) {
        const [key, ...rest] = itemText.split(':');
        const obj = { [key.trim()]: parseScalar(rest.join(':')) };
        parent.push(obj);
        stack.push({ indent, value: obj });
      } else {
        parent.push(parseScalar(itemText));
      }
      continue;
    }

    const match = line.match(/^([^:]+):(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const rest = match[2].trim();

    if (rest) {
      parent[key] = parseScalar(rest);
      continue;
    }

    const next = lines.slice(i + 1).find((candidate) => candidate.trim() && !candidate.trimStart().startsWith('#'));
    const nextTrim = next?.trim() ?? '';
    const container = nextTrim.startsWith('- ') ? [] : {};
    parent[key] = container;
    stack.push({ indent, value: container });
  }

  return root;
}
