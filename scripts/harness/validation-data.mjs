import fs from 'node:fs';
import path from 'node:path';

let parseDocument;
try {
  ({ parseDocument } = await import('yaml'));
} catch (error) {
  throw new Error('Harness requires the root yaml dependency. Run pnpm install before using harness commands.', { cause: error });
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (label, message) => { throw new Error(label + ': ' + message); };

export function parseYaml(source, label = 'YAML') {
  const document = parseDocument(source, { uniqueKeys: true, strict: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length) fail(label, diagnostics.map((error) => error.message).join('; '));
  try {
    return document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    fail(label, error.message);
  }
}

function keys(value, allowed, label) {
  if (!object(value)) fail(label, 'expected a mapping');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(label, 'unknown field ' + key);
}

function strings(value, label, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length)) fail(label, 'expected a nonempty string array');
  if (value.some((item) => typeof item !== 'string' || !item.trim())) fail(label, 'expected nonempty strings');
}

function rulePaths(value, label) {
  strings(value, label);
  for (const pattern of value) {
    if (path.posix.isAbsolute(pattern) || pattern.includes('\\') || pattern.split('/').includes('..')) {
      fail(label, 'paths must be relative to their owner: ' + pattern);
    }
  }
}

export function validateValidation(data, label) {
  keys(data, ['version', 'pathRules', 'escalationRules'], label);
  if (data.version !== 1) fail(label, 'unsupported version (expected 1)');
  if (!Array.isArray(data.pathRules) || !data.pathRules.length) fail(label, 'expected nonempty pathRules');
  const names = new Set();
  for (const rule of data.pathRules) {
    keys(rule, ['name', 'paths', 'quick', 'required', 'release', 'manual', 'optional'], label);
    if (typeof rule.name !== 'string' || !rule.name.trim()) fail(label, 'rule name is required');
    const source = label + ' · ' + rule.name;
    if (names.has(rule.name)) fail(source, 'duplicate rule name');
    names.add(rule.name);
    rulePaths(rule.paths, source + ' paths');
    for (const tier of ['quick', 'required', 'release', 'manual', 'optional']) {
      if (rule[tier] !== undefined) strings(rule[tier], source + ' ' + tier, true);
    }
    if (!['quick', 'required', 'release'].some((tier) => rule[tier]?.length)) {
      fail(source, 'no quick, required, or release commands');
    }
  }
  if (data.escalationRules !== undefined) {
    if (!object(data.escalationRules)) fail(label, 'escalationRules must be a mapping');
    for (const [name, rule] of Object.entries(data.escalationRules)) {
      const source = label + ' · ' + name;
      keys(rule, ['paths', 'required'], source);
      strings(rule.required, source + ' required');
      if (rule.paths !== undefined) rulePaths(rule.paths, source + ' paths');
    }
  }
  return data;
}

export function readValidation(repoRoot, relative, { required = true } = {}) {
  const file = path.join(repoRoot, relative);
  if (!fs.existsSync(file)) {
    if (required) fail(relative, 'missing validation file');
    return null;
  }
  return validateValidation(parseYaml(fs.readFileSync(file, 'utf8'), relative), relative);
}

export function readPackage(repoRoot, directory) {
  const file = path.join(directory, 'package.json');
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
    if (typeof metadata.name !== 'string' || !metadata.name.trim()) fail(file, 'package name is required');
    if (metadata.scripts !== undefined && !object(metadata.scripts)) fail(file, 'scripts must be a mapping');
    return { dir: directory, name: metadata.name, scripts: metadata.scripts ?? {} };
  } catch (error) {
    fail(file, error.message);
  }
}

export function discoverWorkspaces(repoRoot) {
  const config = parseYaml(fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'), 'pnpm-workspace.yaml');
  strings(config?.packages, 'pnpm-workspace.yaml packages');
  rulePaths(config.packages, 'pnpm-workspace.yaml packages');
  const directories = new Set();
  for (const pattern of config.packages) {
    const wildcard = pattern.endsWith('/*');
    const base = wildcard ? pattern.slice(0, -2) : pattern;
    if (/[?*{}![\]]/.test(base)) fail('pnpm-workspace.yaml', 'unsupported workspace pattern ' + pattern);
    if (!wildcard) {
      directories.add(base.replace(/\/$/, ''));
      continue;
    }
    const absolute = path.join(repoRoot, base);
    if (!fs.existsSync(absolute)) continue;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) directories.add(path.posix.join(base, entry.name));
    }
  }
  const workspaces = [...directories]
    .filter((directory) => fs.existsSync(path.join(repoRoot, directory, 'package.json')))
    .map((directory) => readPackage(repoRoot, directory));
  const names = new Set();
  for (const workspace of workspaces) {
    if (names.has(workspace.name)) fail(workspace.dir, 'duplicate package name ' + workspace.name);
    names.add(workspace.name);
  }
  return workspaces;
}

export function globToRegExp(glob) {
  let expression = '';
  for (let i = 0; i < glob.length;) {
    if (glob.startsWith('**/', i)) { expression += '(?:.*/)?'; i += 3; continue; }
    if (glob.startsWith('**', i)) { expression += '.*'; i += 2; continue; }
    if (glob[i] === '*') { expression += '[^/]*'; i += 1; continue; }
    if (glob[i] === '?') { expression += '[^/]'; i += 1; continue; }
    expression += glob[i].replace(/[.+^$(){}|[\]\\]/g, '\\$&');
    i += 1;
  }
  return new RegExp('^' + expression + '$');
}

export function matchesAny(relative, patterns) {
  return (patterns ?? []).some((pattern) => globToRegExp(pattern).test(relative));
}

// Only tokenize a bounded shell subset; do not evaluate expansions or operators.
export function commandSegments(command) {
  const segments = [];
  let words = [], word = '', quote = null, started = false;
  const flush = () => { if (started) words.push(word); word = ''; started = false; };
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
      continue;
    }
    if (char === '$' || char.charCodeAt(0) === 96) return null;
    if (char === '\\') {
      if (i + 1 === command.length) return null;
      const next = command[i + 1];
      if (next === '\n' || next === '\r') return null;
      if (quote === '"' && !['$', String.fromCharCode(96), '"', '\\'].includes(next)) {
        word += char; started = true; continue;
      }
      word += command[++i]; started = true; continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (command.startsWith('&&', i)) {
      flush();
      if (!words.length) return null;
      segments.push(words); words = []; i += 1; continue;
    }
    if (';|&<>\n\r'.includes(char)) return null;
    if (/\s/.test(char)) flush();
    else { word += char; started = true; }
  }
  if (quote) return null;
  flush();
  if (!words.length) return null;
  segments.push(words);
  return segments;
}

export function inspectCommand(command, repoRoot, workspaces) {
  const errors = [], uninspected = [];
  const segments = commandSegments(command);
  if (!segments) return { errors, uninspected: ['unsupported shell form: ' + command] };
  const checkFile = (directory, relative) => {
    if (path.isAbsolute(relative) || relative.split('/').includes('..')) {
      errors.push('expected an owner-relative file: ' + relative);
    } else if (!fs.existsSync(path.join(repoRoot, directory, relative))) {
      errors.push('missing command target ' + path.posix.join(directory, relative));
    }
  };
  for (const raw of segments) {
    const words = [...raw];
    while (/^[A-Za-z_][A-Za-z_0-9]*=/.test(words[0] ?? '')) words.shift();
    if (words[0] === 'node' || words[0] === process.execPath) {
      if (!words[1] || words[1].startsWith('-') || /[*?]/.test(words[1])) uninspected.push('unsupported Node invocation: ' + command);
      else checkFile('.', words[1]);
      continue;
    }
    if (words[0] !== 'pnpm') {
      uninspected.push('unsupported executable: ' + (words[0] ?? '(empty)'));
      continue;
    }
    words.shift();
    let selected = null;
    while (words[0] === '--filter') {
      words.shift();
      const name = words.shift();
      const found = workspaces.find((workspace) => workspace.name === name);
      if (!found) {
        if (name && /[*?[\]!]/.test(name)) uninspected.push('dynamic pnpm selector: ' + name);
        else errors.push('--filter ' + name + ' matches no workspace package');
      }
      selected ??= [];
      if (found) selected.push(found);
    }
    if (selected === null) {
      const file = path.join(repoRoot, 'package.json');
      selected = fs.existsSync(file) ? [readPackage(repoRoot, '.')] : [{ dir: '.', scripts: {} }];
    }
    if (words[0] === 'exec') {
      const tool = words[1];
      if (tool === 'vitest' && words[2] === 'run') {
        for (const argument of words.slice(3)) {
          if (argument.startsWith('-')) { uninspected.push('Vitest option: ' + argument); continue; }
          if (/[*?]/.test(argument) || (!argument.includes('/') && !argument.includes('.test.'))) {
            uninspected.push('nonliteral Vitest filter: ' + argument);
          } else for (const workspace of selected) checkFile(workspace.dir, argument);
        }
      } else if (tool === 'tsc' && words.includes('-p')) {
        const project = words[words.indexOf('-p') + 1];
        if (!project) errors.push('tsc -p requires a project path');
        else for (const workspace of selected) checkFile(workspace.dir, project);
      } else uninspected.push('unsupported pnpm exec: ' + command);
      continue;
    }
    const script = words[0] === 'run' ? words[1] : words[0];
    if (!script || script.startsWith('-') || ['add', 'install', 'remove', 'update'].includes(script)) {
      uninspected.push('unsupported pnpm invocation: ' + command);
      continue;
    }
    for (const workspace of selected) {
      if (typeof workspace.scripts[script] !== 'string' || !workspace.scripts[script].trim()) {
        errors.push(path.posix.join(workspace.dir, 'package.json') + ': missing script ' + script);
      }
    }
  }
  return { errors, uninspected: [...new Set(uninspected)] };
}
