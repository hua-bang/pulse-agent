// Detect when a Canvas Agent tool result carries a generated image so a
// channel can relay it as a native image message. Canvas surfaces tool
// results as `{ name, result }` where `result` is a JSON-encoded string,
// so we parse it before inspecting. Returns null for anything that is not
// recognizably an image payload — relay is strictly best-effort.

interface GeneratedImageResult {
  outputPath: string;
  mimeType?: string;
}

export function extractGeneratedImageResult(toolResult: {
  name?: string;
  result?: string;
}): GeneratedImageResult | null {
  const toolName = asString(toolResult?.name);
  const payload = parsePayload(toolResult?.result);

  if (!payload || !isRecord(payload)) return null;

  const outputPath = asString(payload.outputPath);
  if (!outputPath) return null;

  const mimeType = asString(payload.mimeType) ?? undefined;

  // Accept known image tools; otherwise require the payload to look like a
  // generated-image result (model + image/* mime + outputPath). The canvas_*
  // names are the tools that actually run in this app (the bare engine names
  // cover direct engine use); listing them makes relay independent of the
  // mimeType fallback so a payload with a missing/odd mime still gets sent.
  const KNOWN_IMAGE_TOOLS = new Set([
    'generate_image',
    'gemini_pro_image',
    'canvas_generate_image',
    'canvas_generate_mindmap_image',
  ]);
  if (toolName && !KNOWN_IMAGE_TOOLS.has(toolName) && !looksLikeImagePayload(payload)) {
    return null;
  }
  if (!toolName && !looksLikeImagePayload(payload)) {
    return null;
  }

  return { outputPath, mimeType };
}

function parsePayload(result: unknown): unknown {
  if (isRecord(result)) return result;
  if (typeof result !== 'string') return null;
  const trimmed = result.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function looksLikeImagePayload(payload: Record<string, unknown>): boolean {
  return (
    asString(payload.outputPath) !== null &&
    asString(payload.mimeType)?.startsWith('image/') === true
  );
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
