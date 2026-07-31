const INTERNAL_DETAIL_LIMIT = 8_000;

export interface FriendlyChatFailure {
  kind: 'auth' | 'busy' | 'context' | 'network' | 'request' | 'unknown';
  details: string;
  retryable: boolean;
}

const normalizedDetails = (error: unknown): string => {
  const text = error instanceof Error ? error.stack || error.message : String(error ?? '');
  return text.length > INTERNAL_DETAIL_LIMIT
    ? `${text.slice(0, INTERNAL_DETAIL_LIMIT)}\n…(details truncated)`
    : text;
};

/** Stable, persistence-safe classification for renderer and main alike. */
export function friendlyChatFailure(error: unknown): FriendlyChatFailure {
  const details = normalizedDetails(error);
  const value = details.toLowerCase();

  if (/api[ _-]?key|unauthorized|authentication|401|403/.test(value)) {
    return { kind: 'auth', details, retryable: false };
  }
  if (/rate.?limit|too many requests|429|overloaded|capacity/.test(value)) {
    return { kind: 'busy', details, retryable: true };
  }
  if (/context.?length|too many tokens|maximum context|prompt is too long/.test(value)) {
    return { kind: 'context', details, retryable: false };
  }
  if (/timeout|timed out|network|econn|fetch failed|socket/.test(value)) {
    return { kind: 'network', details, retryable: true };
  }
  if (/schema|invalid[_ -]?request|failed to read request body|400/.test(value)) {
    return { kind: 'request', details, retryable: true };
  }
  return { kind: 'unknown', details, retryable: true };
}
