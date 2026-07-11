import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const normalizePath = (path) => path.replaceAll('\\', '/');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const listFiles = (root, directory = root) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(root, path) : [normalizePath(relative(root, path))];
  });

const sumFileBytes = (root, files) => files.reduce(
  (total, file) => total + statSync(join(root, file)).size,
  0,
);

const sumGzipBytes = (root, files) => files.reduce(
  (total, file) => total + gzipSync(readFileSync(join(root, file))).length,
  0,
);

const findEntry = (manifest) => {
  const entries = Object.entries(manifest).filter(([, value]) => value?.isEntry && value.file);
  if (entries.length !== 1) {
    throw new Error(`expected exactly one renderer entry in manifest, found ${entries.length}`);
  }
  return entries[0];
};

const collectStaticClosure = (manifest, entryKey) => {
  const visited = new Set();
  const jsFiles = new Set();
  const cssFiles = new Set();

  const visit = (key) => {
    if (visited.has(key)) return;
    const chunk = manifest[key];
    if (!chunk) throw new Error(`manifest import ${key} is missing`);
    visited.add(key);
    if (chunk.file?.endsWith('.js')) jsFiles.add(chunk.file);
    for (const cssFile of chunk.css ?? []) cssFiles.add(cssFile);
    for (const importedKey of chunk.imports ?? []) visit(importedKey);
  };

  visit(entryKey);
  return {
    jsFiles: [...jsFiles],
    cssFiles: [...cssFiles],
  };
};

export const measureManifestClosure = ({
  rendererDir,
  manifest,
  entryKey,
  excludeFiles = [],
}) => {
  const excluded = new Set(excludeFiles);
  const closure = collectStaticClosure(manifest, entryKey);
  const jsFiles = closure.jsFiles.filter((file) => !excluded.has(file));
  const cssFiles = closure.cssFiles.filter((file) => !excluded.has(file));
  const jsRawBytes = sumFileBytes(rendererDir, jsFiles);
  const cssRawBytes = sumFileBytes(rendererDir, cssFiles);
  return {
    jsFiles,
    cssFiles,
    jsRawBytes,
    cssRawBytes,
    rawBytes: jsRawBytes + cssRawBytes,
    requestCount: jsFiles.length + cssFiles.length,
  };
};

export const measureRendererBundle = ({ rendererDir, manifest }) => {
  const [entryKey, entryChunk] = findEntry(manifest);
  const closure = measureManifestClosure({ rendererDir, manifest, entryKey });
  const allFiles = listFiles(rendererDir);
  const allJsFiles = allFiles.filter((file) => file.endsWith('.js'));
  const allCssFiles = allFiles.filter((file) => file.endsWith('.css'));
  const entryRawBytes = statSync(join(rendererDir, entryChunk.file)).size;
  const entrySource = readFileSync(join(rendererDir, entryChunk.file));
  const entryGzipBytes = gzipSync(entrySource).length;

  return {
    entry: {
      file: entryChunk.file,
      rawBytes: entryRawBytes,
      gzipBytes: entryGzipBytes,
      sourceSha256: sha256(entrySource),
    },
    startup: {
      ...closure,
      jsRawBytes: closure.jsRawBytes,
      jsGzipBytes: sumGzipBytes(rendererDir, closure.jsFiles),
      cssRawBytes: closure.cssRawBytes,
      cssGzipBytes: sumGzipBytes(rendererDir, closure.cssFiles),
      requestCount: closure.requestCount,
    },
    total: {
      jsFiles: allJsFiles,
      cssFiles: allCssFiles,
      jsRawBytes: sumFileBytes(rendererDir, allJsFiles),
      cssRawBytes: sumFileBytes(rendererDir, allCssFiles),
    },
  };
};

export const matchesEntryDepStats = (stats, entry) => (
  stats?.chunkFileName === entry.file
  && stats?.entrySourceSha256 === entry.sourceSha256
);
