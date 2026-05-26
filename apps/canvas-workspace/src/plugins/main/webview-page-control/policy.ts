/**
 * URL policy for the experimental webview page-control tools.
 *
 * The experimental flag `webview-page-control` decides whether the
 * `page_*` tools are registered at all. This module decides — per call —
 * whether the **current URL** of the target webview is one the agent is
 * allowed to touch. Tools call {@link evaluateActionPolicy} with the
 * webview's `getURL()` before running any side-effecting JS.
 *
 * Defaults are conservative: anything that isn't `http(s):` or `about:blank`
 * is denied (no `file://`, `chrome://`, `devtools://`, `chrome-extension://`,
 * `view-source:`), and a handful of high-stakes domains (banks, payments,
 * mainstream auth/email) are denied by hostname pattern. Users can adjust
 * via `~/.pulse-coder/canvas/webview-action-policy.json` (or override the
 * path with `PULSE_CANVAS_WEBVIEW_ACTION_POLICY`). Config file shape:
 *
 *     {
 *       "denySchemes": ["file:", "chrome:"],   // overrides defaults
 *       "denyHostPatterns": ["*bank*"],         // overrides defaults
 *       "allowHostPatterns": ["github.com", "*.example.com"]  // when set,
 *                                                  // ONLY these hosts pass
 *     }
 *
 * Host patterns: literal hostnames, or globs containing `*` (any chars).
 * Matching is case-insensitive against the URL hostname.
 *
 * Read-only — never mutated at runtime. Re-reads config on each call so
 * that edits land without a restart.
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DEFAULT_DENY_SCHEMES: ReadonlyArray<string> = [
  'file:',
  'chrome:',
  'chrome-extension:',
  'devtools:',
  'view-source:',
  'data:',
  'javascript:',
];

/**
 * Conservative defaults — anything financial, payment, identity, or
 * mainstream personal email/social where session hijack is high-cost.
 * Users can override with an empty `denyHostPatterns` array if they
 * really want to.
 */
const DEFAULT_DENY_HOST_PATTERNS: ReadonlyArray<string> = [
  '*bank*',
  '*paypal*',
  '*stripe*',
  '*venmo*',
  '*cashapp*',
  'accounts.google.com',
  'mail.google.com',
  'login.live.com',
  'outlook.live.com',
  'outlook.office.com',
  'login.microsoftonline.com',
  'appleid.apple.com',
  'icloud.com',
  '*.icloud.com',
  'auth0.com',
  '*.auth0.com',
  'okta.com',
  '*.okta.com',
  '*.oktapreview.com',
  'id.atlassian.com',
];

export interface WebviewActionPolicyConfig {
  denySchemes?: string[];
  denyHostPatterns?: string[];
  allowHostPatterns?: string[];
}

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
}

export function getPolicyConfigPath(): string {
  const envPath = process.env.PULSE_CANVAS_WEBVIEW_ACTION_POLICY?.trim();
  return envPath || join(homedir(), '.pulse-coder', 'canvas', 'webview-action-policy.json');
}

/** Keep only string entries — protects matchHostPattern from numeric / null
 *  entries that would throw on `.toLowerCase()`. */
function filterStrings(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function normalisePolicyConfig(parsed: unknown): WebviewActionPolicyConfig {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const src = parsed as Record<string, unknown>;
  const out: WebviewActionPolicyConfig = {};
  const denySchemes = filterStrings(src.denySchemes);
  if (denySchemes) out.denySchemes = denySchemes;
  const denyHostPatterns = filterStrings(src.denyHostPatterns);
  if (denyHostPatterns) out.denyHostPatterns = denyHostPatterns;
  const allowHostPatterns = filterStrings(src.allowHostPatterns);
  if (allowHostPatterns) out.allowHostPatterns = allowHostPatterns;
  return out;
}

function readPolicyConfig(): WebviewActionPolicyConfig {
  try {
    const raw = readFileSync(getPolicyConfigPath(), 'utf8');
    return normalisePolicyConfig(JSON.parse(raw));
  } catch {
    return {};
  }
}

function matchHostPattern(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (!p.includes('*')) return h === p;
  // Escape regex special chars except '*', then turn '*' into '.*'.
  const re = new RegExp(
    '^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  );
  return re.test(h);
}

/**
 * Evaluate the action policy for a given URL. Pure function — the
 * `config` arg is exposed so tests can inject scenarios without touching
 * disk; production callers should use {@link evaluateActionPolicy}.
 */
export function evaluateActionPolicyWith(
  url: string,
  config: WebviewActionPolicyConfig,
): PolicyDecision {
  if (typeof url !== 'string' || url.length === 0) {
    return { allow: false, reason: 'empty URL' };
  }

  // `about:blank` is the default landing page — harmless, allow.
  if (url === 'about:blank') return { allow: true };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allow: false, reason: `unparseable URL: ${url}` };
  }

  const scheme = parsed.protocol.toLowerCase();
  // Defensively filter to strings — `config` is sometimes hand-built by
  // tests or callers passing un-validated JSON. Production `readPolicyConfig`
  // normalises already; this is belt-and-suspenders.
  const denySchemes = (config.denySchemes ?? DEFAULT_DENY_SCHEMES).filter(
    (v): v is string => typeof v === 'string',
  );
  if (denySchemes.includes(scheme)) {
    return { allow: false, reason: `scheme ${scheme} is denied by policy` };
  }
  // Only http(s) past this point. Anything else (ws:, mailto:, etc.) is
  // not meaningful for a browser-style webview action.
  if (scheme !== 'http:' && scheme !== 'https:') {
    return { allow: false, reason: `scheme ${scheme} is not http(s)` };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) return { allow: false, reason: 'URL has no hostname' };

  const denyPatterns = (config.denyHostPatterns ?? DEFAULT_DENY_HOST_PATTERNS).filter(
    (v): v is string => typeof v === 'string',
  );
  for (const pat of denyPatterns) {
    if (matchHostPattern(host, pat)) {
      return { allow: false, reason: `host ${host} matches deny pattern "${pat}"` };
    }
  }

  const allowPatterns = Array.isArray(config.allowHostPatterns)
    ? config.allowHostPatterns.filter((v): v is string => typeof v === 'string')
    : undefined;
  if (allowPatterns && allowPatterns.length > 0) {
    const hit = allowPatterns.some((pat) => matchHostPattern(host, pat));
    if (!hit) {
      return {
        allow: false,
        reason: `host ${host} is not in the configured allow list`,
      };
    }
  }

  return { allow: true };
}

/**
 * Production entry point: reads policy from disk (or env override) and
 * evaluates against the given URL. Returns `{ allow: false, reason }` on
 * any disallowed URL — caller should surface `reason` to the agent so it
 * knows why it can't act.
 */
export function evaluateActionPolicy(url: string): PolicyDecision {
  return evaluateActionPolicyWith(url, readPolicyConfig());
}
