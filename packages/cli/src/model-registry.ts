import * as fs from 'fs/promises';
import * as path from 'path';

export interface ModelChoice {
  model: string;
  modelType?: 'openai' | 'claude';
  label?: string;
  /** Context window size in tokens; overrides the engine's CONTEXT_WINDOW_TOKENS for display AND compaction. */
  contextWindow?: number;
}

/**
 * Parses a model spec string: `claude:<model>` / `openai:<model>` pins the
 * provider path; a bare id keeps the engine's default provider resolution.
 */
export function parseModelSpec(spec: string): ModelChoice | null {
  const trimmed = spec.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('claude:')) {
    const model = trimmed.slice('claude:'.length).trim();
    return model ? { model, modelType: 'claude' } : null;
  }
  if (trimmed.startsWith('openai:')) {
    const model = trimmed.slice('openai:'.length).trim();
    return model ? { model, modelType: 'openai' } : null;
  }
  return { model: trimmed };
}

/** Short display form: last path segment, truncated. */
export function shortModelLabel(model: string, maxLength = 22): string {
  const segments = model.split('/').filter(Boolean);
  const short = segments[segments.length - 1] ?? model;
  return short.length > maxLength ? `${short.slice(0, maxLength - 1)}…` : short;
}

/**
 * Loads model candidates for the /model picker from
 * `.pulse-coder/models.json` (or legacy `.coder/models.json`).
 * Accepted shapes: `["openai:gpt-x", ...]` or `{"models": [{"model": "...",
 * "type": "claude", "label": "..."}, "claude:..."]}`.
 */
export async function loadModelRegistry(cwd = process.cwd()): Promise<ModelChoice[]> {
  for (const dir of ['.pulse-coder', '.coder']) {
    const filePath = path.join(cwd, dir, 'models.json');
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return normalizeRegistry(JSON.parse(raw));
    } catch {
      continue;
    }
  }
  return [];
}

function normalizeRegistry(parsed: unknown): ModelChoice[] {
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { models?: unknown }).models)
      ? (parsed as { models: unknown[] }).models
      : [];

  const choices: ModelChoice[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      const choice = parseModelSpec(entry);
      if (choice) {
        choices.push(choice);
      }
      continue;
    }
    if (entry && typeof entry === 'object') {
      const record = entry as { model?: unknown; type?: unknown; modelType?: unknown; label?: unknown; contextWindow?: unknown; context_window?: unknown };
      if (typeof record.model !== 'string' || !record.model.trim()) {
        continue;
      }
      const type = record.modelType ?? record.type;
      const contextWindow = record.contextWindow ?? record.context_window;
      choices.push({
        model: record.model.trim(),
        ...(type === 'claude' || type === 'openai' ? { modelType: type } : {}),
        ...(typeof record.label === 'string' && record.label.trim() ? { label: record.label.trim() } : {}),
        ...(typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow: Math.floor(contextWindow) } : {}),
      });
    }
  }
  return choices;
}
