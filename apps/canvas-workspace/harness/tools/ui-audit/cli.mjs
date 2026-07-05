#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const TOOL_DIR = path.dirname(__filename);
const WORKSPACE_DIR = path.resolve(TOOL_DIR, '../../..');
const RENDERER_DIR = path.join(WORKSPACE_DIR, 'src/renderer/src');
const TOKEN_FILE = path.join(RENDERER_DIR, 'styles.css');

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const failOnFindings = args.has('--fail-on-findings');

if (args.has('--help') || args.has('-h')) {
  printHelp();
  process.exit(0);
}

const unknownArgs = [...args].filter((arg) => !['--json', '--fail-on-findings', '--help', '-h'].includes(arg));
if (unknownArgs.length > 0) {
  console.error(`Unknown option: ${unknownArgs.join(', ')}`);
  printHelp();
  process.exit(2);
}

const files = await listFiles(RENDERER_DIR);
const tokenNames = await readTokenNames(TOKEN_FILE);
const findings = [];

for (const file of files) {
  const relFile = path.relative(WORKSPACE_DIR, file);
  const source = await readFile(file, 'utf8');
  const isTokenFile = path.resolve(file) === path.resolve(TOKEN_FILE);
  const isStyleFile = file.endsWith('.css');
  const isTsxLike = file.endsWith('.tsx') || file.endsWith('.ts');
  const scanSource = isStyleFile ? stripCssComments(source) : source;
  const lines = scanSource.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (isStyleFile && !isTokenFile) {
      collectMatches({
        findings,
        category: 'raw-color-literal',
        relFile,
        lineNumber,
        line,
        regex: /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|color-mix\(|linear-gradient\(/g,
      });

      if (/z-index\s*:\s*(?!var\()[^;]*\d/.test(line)) {
        findings.push(toFinding('numeric-z-index', relFile, lineNumber, line));
      }

      if (/border(?:-[a-z]+)*-radius\s*:\s*(?!var\()[^;]+/.test(line)) {
        findings.push(toFinding('literal-border-radius', relFile, lineNumber, line));
      }

      if (/font-size\s*:\s*\d*\.?\d+px\b/.test(line)) {
        findings.push(toFinding('pixel-font-size', relFile, lineNumber, line));
      }

      if (/letter-spacing\s*:\s*-\s*\d*\.?\d+(px|em|rem)\b/.test(line)) {
        findings.push(toFinding('negative-letter-spacing', relFile, lineNumber, line));
      }
    }

    if (isTsxLike && /style=\{\{/.test(line)) {
      findings.push(toFinding('inline-style-object', relFile, lineNumber, line));
    }
  });
}

const summary = summarize(files, tokenNames, findings);

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  printTextSummary(summary);
}

if (failOnFindings && summary.totalFindings > 0) {
  process.exit(1);
}

function printHelp() {
  console.log(`Usage: node apps/canvas-workspace/harness/tools/ui-audit/cli.mjs [options]

Options:
  --json              Print machine-readable summary.
  --fail-on-findings  Exit 1 when any drift finding is present.
  -h, --help          Show this help.
`);
}

async function listFiles(rootDir) {
  const out = [];
  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', 'coverage'].includes(entry.name)) {
        continue;
      }
      out.push(...await listFiles(fullPath));
      continue;
    }

    if (/\.(css|tsx|ts)$/.test(entry.name)) {
      out.push(fullPath);
    }
  }

  return out.sort();
}

async function readTokenNames(file) {
  const source = await readFile(file, 'utf8');
  const matches = source.match(/--[a-z0-9-]+(?=\s*:)/g) ?? [];
  return [...new Set(matches)].sort();
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n\r]/g, ' '));
}

function collectMatches({ findings, category, relFile, lineNumber, line, regex }) {
  if (regex.test(line)) {
    findings.push(toFinding(category, relFile, lineNumber, line));
  }
}

function toFinding(category, file, line, source) {
  return {
    category,
    file,
    line,
    source: source.trim().slice(0, 180),
  };
}

function summarize(files, tokenNames, findings) {
  const counts = countBy(findings, (finding) => finding.category);
  const topFiles = Object.entries(countBy(findings, (finding) => finding.file))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([file, count]) => ({ file, count }));

  return {
    workspace: path.relative(process.cwd(), WORKSPACE_DIR) || '.',
    rendererDir: path.relative(process.cwd(), RENDERER_DIR),
    filesScanned: files.length,
    tokenFile: path.relative(process.cwd(), TOKEN_FILE),
    tokenCount: tokenNames.length,
    tokenNames,
    totalFindings: findings.length,
    counts,
    topFiles,
    sampleFindings: findings.slice(0, 80),
    failOnFindings,
  };
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function printTextSummary(summary) {
  console.log('Canvas Workspace UI Audit');
  console.log(`Workspace: ${summary.workspace}`);
  console.log(`Renderer files scanned: ${summary.filesScanned}`);
  console.log(`Design tokens found: ${summary.tokenCount} (${summary.tokenFile})`);
  console.log(`Findings: ${summary.totalFindings}`);

  if (summary.totalFindings === 0) {
    console.log('No drift findings detected.');
    return;
  }

  console.log('');
  console.log('Finding counts:');
  for (const [category, count] of Object.entries(summary.counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`- ${category}: ${count}`);
  }

  console.log('');
  console.log('Top files:');
  for (const item of summary.topFiles) {
    console.log(`- ${item.file}: ${item.count}`);
  }

  console.log('');
  console.log('Sample findings:');
  for (const finding of summary.sampleFindings.slice(0, 20)) {
    console.log(`- ${finding.category} ${finding.file}:${finding.line} ${finding.source}`);
  }

  console.log('');
  console.log('This is an inventory check. Use --fail-on-findings only after a baseline is ratcheted.');
}
