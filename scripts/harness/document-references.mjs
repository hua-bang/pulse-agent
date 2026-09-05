import fs from 'node:fs';
import path from 'node:path';

const rootPrefix = /^(?:packages|apps)\//;
const sourcePrefix = /^src\//;
const historical = /historical|retired|deleted|removed|non-?existent|optional|example|future/i;
const runtimePath = /(?:^|\/)(?:\.harness\/|\.pulse-coder\/(?:config(?:\.json)?|engine-plugins|generated-images|offload|souls)(?:\/|$))/;

export function markdownFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', '.harness', 'dist', 'build'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(absolute);
  }
  return files;
}

export function inspectDocumentReferences(repoRoot, documentPath, workspace = '.', tracked = new Set()) {
  const warnings = [];
  const documentDirectory = path.dirname(path.join(repoRoot, documentPath));
  const workspaceDirectory = path.join(repoRoot, workspace);
  const outside = (absolute) => {
    const relative = path.relative(repoRoot, absolute);
    return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
  };
  const inspect = (raw, label, line, lineNumber, sourceCitation = false) => {
    if (historical.test(label) || /^\s*(?:[-*>]\s*)?(?:history|historical|retired|deleted|removed|non-?existent)\b/i.test(line)) return;
    let reference = raw.replace(/^<|>$/g, '');
    if (sourceCitation) reference = reference.replace(/:\d+(?:-\d+)?(?::\d+)?$/, '');
    if (!reference || reference.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(reference) || /^[~$]/.test(reference)) return;
    reference = reference.split('#')[0].split('?')[0];
    try { reference = decodeURIComponent(reference); } catch { return; }
    if (!reference || /[<>{}*$]/.test(reference)) return;
    let candidates;
    if (path.isAbsolute(reference)) {
      if (reference.startsWith(repoRoot + path.sep)) candidates = [reference];
      else if (/^\/(?:packages|apps|harness|scripts|docs|\.github|\.pulse-coder)(?:\/|$)/.test(reference)) candidates = [path.join(repoRoot, reference.slice(1))];
      else return;
    } else if (!sourceCitation) {
      candidates = [path.resolve(documentDirectory, reference)];
    } else if (rootPrefix.test(reference)) {
      candidates = [path.resolve(repoRoot, reference)];
    } else if (sourcePrefix.test(reference)) {
      candidates = [path.resolve(workspaceDirectory, reference)];
    } else {
      candidates = [
        path.resolve(workspaceDirectory, reference),
        path.resolve(workspaceDirectory, 'src', reference),
        path.resolve(documentDirectory, reference),
      ];
    }
    candidates = candidates.filter((candidate) => !outside(candidate));
    if (!candidates.length) return;
    const relativeCandidates = candidates.map((candidate) => path.relative(repoRoot, candidate).split(path.sep).join('/'));
    if (runtimePath.test(reference) && !relativeCandidates.some((candidate) => tracked.has(candidate))) return;
    if (candidates.some((candidate) => fs.existsSync(candidate))) return;
    if (sourceCitation && !rootPrefix.test(reference) && !sourcePrefix.test(reference)) {
      const owned = [...tracked].filter((file) => file.startsWith(workspace + '/') &&
        file.endsWith('/' + reference) && fs.existsSync(path.join(repoRoot, file)));
      if (owned.length === 1) return;
      warnings.push({ file: documentPath, line: lineNumber, reference,
        kind: owned.length > 1 ? 'ambiguous-source-citation' : 'unqualified-source-citation', candidates: owned });
      return;
    }
    warnings.push({
      file: documentPath, line: lineNumber, reference,
      kind: sourceCitation ? 'missing-source-citation' : 'missing-markdown-target',
      candidates: relativeCandidates,
    });
  };
  let fence = null;
  const text = fs.readFileSync(path.join(repoRoot, documentPath), 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    const delimiter = line.match(/^\s*(?:>\s*)*(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
      return;
    }
    if (fence) return;
    const links = line.replace(/`+[^`]*`+/g, (code) => ' '.repeat(code.length));
    for (const match of links.matchAll(/!?\[([^\]]*)\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*["'])?\)/g)) {
      inspect(match[2], match[1], line, index + 1);
    }
    const definition = links.match(/^\s*\[([^\]]+)\]:\s*(<[^>]+>|\S+)/);
    if (definition) inspect(definition[2], definition[1], line, index + 1);
    for (const match of line.matchAll(/`([^`]+\.(?:tsx?|[cm]?js|jsx|md):\d+(?:-\d+)?(?::\d+)?)`/g)) {
      inspect(match[1], '', line, index + 1, true);
    }
  });
  return warnings;
}
