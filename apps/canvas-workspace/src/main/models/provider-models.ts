import type { CanvasProviderModel } from '../../shared/model-config';

// A provider's model catalog: model ids, display names, and the context
// window each model reports through `/models`.

export function normalizeStr(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeContextWindow(value: unknown): number | undefined {
  const tokens = typeof value === 'string' ? Number(value) : value;
  return typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 1000
    ? Math.floor(tokens)
    : undefined;
}

export function normalizeProviderModels(models: unknown): CanvasProviderModel[] {
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  const result: CanvasProviderModel[] = [];
  for (const item of models) {
    const id = typeof item === 'string'
      ? normalizeStr(item)
      : item && typeof item === 'object'
        ? normalizeStr((item as CanvasProviderModel).id)
        : undefined;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const entry = item && typeof item === 'object' ? item as CanvasProviderModel : undefined;
    const name = normalizeStr(entry?.name);
    const contextWindow = normalizeContextWindow(entry?.context_window);
    const customContextWindow = normalizeContextWindow(entry?.custom_context_window);
    const model: CanvasProviderModel = { id };
    if (name && name !== id) model.name = name;
    if (contextWindow) model.context_window = contextWindow;
    if (customContextWindow) model.custom_context_window = customContextWindow;
    result.push(model);
  }
  return result;
}

function joinUrl(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** OpenAI-compatible and Claude APIs both list models at `<base>/v1/models`. */
export function buildModelsUrl(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '');
  if (/\/models$/i.test(trimmed)) return trimmed;
  if (/\/v\d+$/i.test(trimmed)) return joinUrl(trimmed, '/models');
  return joinUrl(joinUrl(trimmed, '/v1'), '/models');
}

/**
 * OpenAI's own /models has no window, but common gateways do: OpenRouter
 * (`context_length`, `top_provider.context_length`), vLLM (`max_model_len`),
 * Anthropic (`max_input_tokens`), and others (`context_window`).
 */
function reportedContextWindow(item: any): number | undefined {
  return [
    item?.context_window,
    item?.context_length,
    item?.max_context_length,
    item?.max_input_tokens,
    item?.max_model_len,
    item?.top_provider?.context_length,
  ].map(normalizeContextWindow).find((value) => value !== undefined);
}

export function parseModelsPayload(payload: unknown): CanvasProviderModel[] {
  const data = payload && typeof payload === 'object' ? (payload as any).data : undefined;
  const list = Array.isArray(data) ? data : Array.isArray(payload) ? payload : [];
  return normalizeProviderModels(list.map((item: any) => {
    if (typeof item === 'string') return item;
    return {
      id: item?.id ?? item?.name,
      name: item?.display_name ?? item?.name,
      context_window: reportedContextWindow(item),
    };
  }));
}
