/**
 * read_webpage — multi-strategy web reader
 *
 * Strategy cascade (inspired by cf's design):
 *   1. Skill hint  — if a domain-specific skill exists, surface it so the agent can
 *                    delegate to that skill instead of falling back here.
 *   2. Text / a11y — fetch cleaned page text via r.jina.ai (covers DOM + a11y content).
 *   3. Vision      — if text extraction yields nothing useful, capture a screenshot via
 *                    a configurable screenshot service and analyse it with the vision model.
 */

import z from 'zod';
import { fetch } from 'undici';
import type { Tool } from 'pulse-coder-engine';

// ---------------------------------------------------------------------------
// Domain → skill hint mapping
// Add entries here when a domain-specific skill is available.
// ---------------------------------------------------------------------------
const DOMAIN_SKILL_MAP: Record<string, string> = {
  'github.com': 'github',
  'twitter.com': 'twitter-reader',
  'x.com': 'twitter-reader',
  't.co': 'twitter-reader',
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const toolSchema = z.object({
  url: z.string().min(1).describe('Target URL to read.'),
  strategy: z
    .enum(['auto', 'text', 'vision'])
    .optional()
    .describe(
      '"auto" (default) — try text extraction first, fall back to vision if content is sparse. ' +
        '"text" — text/a11y only. "vision" — screenshot + vision only.',
    ),
  textMaxChars: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum characters returned from text extraction. Defaults to 12 000.'),
  visionPrompt: z
    .string()
    .optional()
    .describe('Custom prompt for the vision model when screenshot strategy is used.'),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Request timeout in milliseconds for text extraction. Defaults to 20 000.'),
  sparseThreshold: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'Minimum character count for text extraction to be considered "useful" in auto mode. ' +
        'If extracted text is shorter than this, falls back to vision. Defaults to 200.',
    ),
});

type ReadWebpageInput = z.infer<typeof toolSchema>;

type ReadStrategy = 'text' | 'vision' | 'skill_hint';

interface ReadWebpageResult {
  ok: boolean;
  url: string;
  strategy: ReadStrategy;
  /** Only present when strategy === 'skill_hint'. Tells the agent which skill to invoke. */
  skillHint?: string;
  /** Extracted text content (text / a11y strategy). */
  text?: string;
  /** Vision analysis output (vision strategy). */
  visionText?: string;
  /** Whether text content was truncated. */
  truncated?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://')
    ? trimmed
    : `https://${trimmed}`;
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function findSkillHint(hostname: string): string | undefined {
  if (DOMAIN_SKILL_MAP[hostname]) {
    return DOMAIN_SKILL_MAP[hostname];
  }
  // check parent domains (e.g. "docs.github.com" → "github.com")
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (DOMAIN_SKILL_MAP[candidate]) {
      return DOMAIN_SKILL_MAP[candidate];
    }
  }
  return undefined;
}

async function fetchViaJina(
  sourceUrl: string,
  timeoutMs: number,
  maxChars: number,
): Promise<{ ok: boolean; text: string; truncated: boolean; status: number; error?: string }> {
  const withoutProtocol = sourceUrl.replace(/^https?:\/\//, '');
  const protocol = sourceUrl.startsWith('https://') ? 'https' : 'http';
  const targetUrl = `https://r.jina.ai/${protocol}://${withoutProtocol}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'pulse-coder/remote-server' },
      signal: controller.signal,
    });

    const raw = await response.text();
    const truncated = maxChars > 0 && raw.length > maxChars;
    const text = truncated ? raw.slice(0, maxChars) : raw;

    if (!response.ok) {
      return { ok: false, text, truncated, status: response.status, error: `HTTP ${response.status}` };
    }

    return { ok: true, text, truncated, status: response.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, text: '', truncated: false, status: 0, error: message };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchScreenshot(
  sourceUrl: string,
  timeoutMs: number,
): Promise<{ ok: boolean; base64: string; mimeType: string; error?: string }> {
  const screenshotApiBase = process.env.WEBPAGE_SCREENSHOT_API?.trim();
  if (!screenshotApiBase) {
    return { ok: false, base64: '', mimeType: '', error: 'WEBPAGE_SCREENSHOT_API not configured' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const targetUrl = `${screenshotApiBase.replace(/\/$/, '')}/${encodeURIComponent(sourceUrl)}`;
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'pulse-coder/remote-server' },
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, base64: '', mimeType: '', error: `Screenshot API HTTP ${response.status}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/png';
    const mimeType = contentType.split(';')[0].trim();

    return { ok: true, base64: buffer.toString('base64'), mimeType };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, base64: '', mimeType: '', error: message };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function analyzeScreenshotViaOpenAI(
  base64: string,
  mimeType: string,
  prompt: string,
  timeoutMs: number,
): Promise<{ ok: boolean; text: string; error?: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, text: '', error: 'OPENAI_API_KEY not set' };
  }

  const apiUrl = (process.env.OPENAI_API_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model =
    process.env.OPENAI_VISION_MODEL?.trim() || process.env.OPENAI_ANALYZE_IMAGE_MODEL?.trim() || 'gpt-4o';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'auto' } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      return { ok: false, text: '', error: data?.error?.message || `HTTP ${response.status}` };
    }

    const text = data.choices?.[0]?.message?.content?.trim() || '';
    return { ok: true, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, text: '', error: message };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const readWebpageTool: Tool<ReadWebpageInput, ReadWebpageResult> = {
  name: 'read_webpage',
  description:
    'Read a web page using the best available strategy. ' +
    'In "auto" mode: if a domain-specific skill is registered the tool returns a skill hint; ' +
    'otherwise it fetches readable text via r.jina.ai (covers a11y + DOM); ' +
    'if the extracted text is too sparse it falls back to screenshot + vision analysis. ' +
    'Use strategy="text" to force text extraction, or strategy="vision" to force screenshot.',
  defer_loading: true,
  inputSchema: toolSchema,
  execute: async (input): Promise<ReadWebpageResult> => {
    const url = normalizeUrl(input.url);
    const strategy = input.strategy ?? 'auto';
    const textMaxChars = input.textMaxChars ?? 12_000;
    const timeoutMs = input.timeoutMs ?? 20_000;
    const sparseThreshold = input.sparseThreshold ?? 200;
    const visionPrompt =
      input.visionPrompt?.trim() ||
      '请详细描述页面内容，包括标题、正文、关键数据、链接及任何重要的视觉信息。';
    const hostname = extractHostname(url);

    // ── Strategy 1: Skill hint ──────────────────────────────────────────────
    if (strategy === 'auto') {
      const hint = findSkillHint(hostname);
      if (hint) {
        return {
          ok: true,
          url,
          strategy: 'skill_hint',
          skillHint: hint,
        };
      }
    }

    // ── Strategy 2: Text / a11y via jina ───────────────────────────────────
    if (strategy === 'auto' || strategy === 'text') {
      const jinaResult = await fetchViaJina(url, timeoutMs, textMaxChars);

      const isUseful = jinaResult.ok && jinaResult.text.trim().length >= sparseThreshold;

      if (strategy === 'text') {
        return {
          ok: jinaResult.ok,
          url,
          strategy: 'text',
          text: jinaResult.text,
          truncated: jinaResult.truncated,
          error: jinaResult.error,
        };
      }

      if (isUseful) {
        return {
          ok: true,
          url,
          strategy: 'text',
          text: jinaResult.text,
          truncated: jinaResult.truncated,
        };
      }

      // Fall through to vision when text is sparse
    }

    // ── Strategy 3: Screenshot + vision ────────────────────────────────────
    const screenshotResult = await fetchScreenshot(url, timeoutMs * 2);
    if (!screenshotResult.ok) {
      return {
        ok: false,
        url,
        strategy: 'vision',
        error: `Vision strategy failed: screenshot error — ${screenshotResult.error}`,
      };
    }

    const visionResult = await analyzeScreenshotViaOpenAI(
      screenshotResult.base64,
      screenshotResult.mimeType,
      visionPrompt,
      60_000,
    );

    return {
      ok: visionResult.ok,
      url,
      strategy: 'vision',
      visionText: visionResult.text,
      error: visionResult.error,
    };
  },
};
