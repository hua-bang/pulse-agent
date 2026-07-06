interface GeneratedImageResult {
  outputPath: string;
  mimeType?: string;
}

export function extractGeneratedImageResult(toolResult: unknown): GeneratedImageResult | null {
  return extractGeneratedImageResults(toolResult)[0] ?? null;
}

export function extractGeneratedImageResults(toolResult: unknown): GeneratedImageResult[] {
  const markedPayloads = extractMarkedImagePayloads(toolResult);
  if (markedPayloads.length > 0) {
    return markedPayloads;
  }

  const toolName = extractToolName(toolResult);
  const payload = extractToolPayload(toolResult);

  if (!payload || !isRecord(payload)) {
    return [];
  }

  const outputPath = asString(payload.outputPath);
  if (!outputPath) {
    return [];
  }

  const mimeType = asString(payload.mimeType) ?? undefined;

  if (toolName && toolName !== 'generate_image') {
    return [];
  }

  if (!toolName && !looksLikeGeneratedImagePayload(payload)) {
    return [];
  }

  return [{
    outputPath,
    mimeType,
  }];
}

function extractMarkedImagePayloads(value: unknown, depth = 0): GeneratedImageResult[] {
  if (depth > 5) {
    return [];
  }

  if (typeof value === 'string') {
    const marker = '__PULSE_IMAGE_RESULT__';
    const results: GeneratedImageResult[] = [];
    let searchFrom = 0;
    while (searchFrom < value.length) {
      const markerAt = value.indexOf(marker, searchFrom);
      if (markerAt < 0) break;

      const jsonLine = value.slice(markerAt + marker.length).trimStart().split(/\r?\n/, 1)[0]?.trim();
      searchFrom = markerAt + marker.length + (jsonLine?.length ?? 0);
      if (!jsonLine) continue;

      try {
        const payload = JSON.parse(jsonLine) as unknown;
        if (!isRecord(payload) || !looksLikeGeneratedImagePayload(payload)) {
          continue;
        }
        results.push({
          outputPath: asString(payload.outputPath)!,
          mimeType: asString(payload.mimeType) ?? undefined,
        });
      } catch {
        continue;
      }
    }
    return dedupeImageResults(results);
  }

  if (Array.isArray(value)) {
    return dedupeImageResults(value.flatMap((item) => extractMarkedImagePayloads(item, depth + 1)));
  }

  if (isRecord(value)) {
    return dedupeImageResults(Object.values(value).flatMap((item) => extractMarkedImagePayloads(item, depth + 1)));
  }

  return [];
}

function dedupeImageResults(results: GeneratedImageResult[]): GeneratedImageResult[] {
  const seen = new Set<string>();
  const deduped: GeneratedImageResult[] = [];
  for (const result of results) {
    const key = `${result.outputPath}\0${result.mimeType ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}

function extractToolName(toolResult: unknown): string | null {
  if (!isRecord(toolResult)) {
    return null;
  }

  const topLevel = asString(toolResult.toolName) || asString(toolResult.name);
  if (topLevel) {
    return topLevel;
  }

  const nestedToolCall = isRecord(toolResult.toolCall) ? toolResult.toolCall : null;
  if (nestedToolCall) {
    return asString(nestedToolCall.toolName) || asString(nestedToolCall.name) || null;
  }

  return null;
}

function extractToolPayload(toolResult: unknown): unknown {
  if (!isRecord(toolResult)) {
    return null;
  }

  if (isRecord(toolResult.result)) {
    return toolResult.result;
  }

  if (isRecord(toolResult.output)) {
    return toolResult.output;
  }

  return toolResult;
}

function looksLikeGeneratedImagePayload(payload: Record<string, unknown>): boolean {
  return (
    asString(payload.model) !== null
    && asString(payload.outputPath) !== null
    && asString(payload.mimeType)?.startsWith('image/') === true
  );
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
