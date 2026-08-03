function joinUrl(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function normalizeVersionedAPIBaseURL(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '');
  return /\/v\d+$/i.test(trimmed) ? trimmed : joinUrl(trimmed, '/v1');
}

export function buildModelsUrl(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '');
  if (/\/models$/i.test(trimmed)) return trimmed;
  return joinUrl(normalizeVersionedAPIBaseURL(trimmed), '/models');
}
