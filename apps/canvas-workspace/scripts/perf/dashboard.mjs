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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectMetrics } from './collect-metrics.mjs';
import { renderDashboardHtml } from './dashboard-html.mjs';
import { buildVerdict, evaluateRules } from './rules.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(appRoot, 'perf/out');
const historyDir = join(appRoot, 'perf/history');

const dictionary = JSON.parse(readFileSync(join(appRoot, 'perf/metrics.json'), 'utf-8'));
const snapshot = collectMetrics();
const bundleReport = existsSync(join(outDir, 'bundle-report.json'))
  ? JSON.parse(readFileSync(join(outDir, 'bundle-report.json'), 'utf-8'))
  : null;

// Same-machine history only — timing baselines never cross machines.
const history = existsSync(historyDir)
  ? readdirSync(historyDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(historyDir, f), 'utf-8')))
    .filter((h) => h.machineId === snapshot.machineId)
  : [];

const ruleResult = evaluateRules(dictionary, snapshot, history);
const verdict = buildVerdict(dictionary, snapshot, ruleResult.alerts);

mkdirSync(outDir, { recursive: true });
mkdirSync(historyDir, { recursive: true });
writeFileSync(join(outDir, 'metrics-latest.json'), JSON.stringify(snapshot, null, 2));
writeFileSync(
  join(historyDir, `${snapshot.timestamp.slice(0, 10)}-${snapshot.commit}-${snapshot.timestamp.slice(11, 19).replaceAll(':', '')}.json`),
  JSON.stringify(snapshot, null, 2),
);
writeFileSync(
  join(outDir, 'dashboard.html'),
  renderDashboardHtml(dictionary, snapshot, bundleReport, ruleResult, verdict),
);

// Machine-consumable contract (agents/skills read this single file):
// verdict + alerts + metric values, plus where the human-facing HTML lives.
writeFileSync(join(outDir, 'report.json'), JSON.stringify({
  verdict,
  commit: snapshot.commit,
  timestamp: snapshot.timestamp,
  machineId: snapshot.machineId,
  env: snapshot.env,
  coverage: { measured: snapshot.metrics.length, total: dictionary.metrics.length },
  alerts: ruleResult.alerts,
  metrics: snapshot.metrics,
  dashboardHtml: 'perf/out/dashboard.html',
}, null, 2));

console.log(`[perf:dashboard] ${snapshot.metrics.length}/${dictionary.metrics.length} metrics, ${ruleResult.alerts.length} alerts → perf/out/dashboard.html + report.json`);
console.log(`[perf:dashboard] verdict: ${verdict}`);
