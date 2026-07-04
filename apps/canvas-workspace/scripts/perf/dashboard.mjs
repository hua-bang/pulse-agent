#!/usr/bin/env node
/**
 * Generate the six-aspect performance dashboard from real data:
 *   perf/metrics.json      — metric dictionary (definitions, aspects)
 *   perf/out/metrics-latest.json — normalized values (collect-metrics.mjs,
 *                            regenerated here automatically)
 *   perf/out/bundle-report.json  — chunk breakdown for the bundle tab
 *
 *   pnpm --filter canvas-workspace perf:dashboard
 *
 * Output: perf/out/dashboard.html (self-contained, light/dark).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMetrics } from './collect-metrics.mjs';
import { renderDashboardHtml } from './dashboard-html.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(appRoot, 'perf/out');

const dictionary = JSON.parse(readFileSync(join(appRoot, 'perf/metrics.json'), 'utf-8'));
const snapshot = collectMetrics();
const bundleReport = existsSync(join(outDir, 'bundle-report.json'))
  ? JSON.parse(readFileSync(join(outDir, 'bundle-report.json'), 'utf-8'))
  : null;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'metrics-latest.json'), JSON.stringify(snapshot, null, 2));
writeFileSync(join(outDir, 'dashboard.html'), renderDashboardHtml(dictionary, snapshot, bundleReport));

const measured = snapshot.metrics.length;
const total = dictionary.metrics.length;
console.log(`[perf:dashboard] ${measured}/${total} metrics with values → perf/out/dashboard.html`);
