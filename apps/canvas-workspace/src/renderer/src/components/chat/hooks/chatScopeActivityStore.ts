const owners = new Map<string, symbol>();
const listeners = new Map<string, Set<() => void>>();
const runMonitors = new Map<string, Map<symbol, () => void>>();

const monitorsForScope = (scopeId: string) => {
  const existing = runMonitors.get(scopeId);
  if (existing) return existing;
  const monitors = new Map<symbol, () => void>();
  runMonitors.set(scopeId, monitors);
  return monitors;
};

const publish = (scopeId: string) => {
  for (const listener of listeners.get(scopeId) ?? []) listener();
};

export function claimChatScope(scopeId: string, owner: symbol): boolean {
  const current = owners.get(scopeId);
  if (current && current !== owner) return false;
  if (!current) {
    owners.set(scopeId, owner);
    publish(scopeId);
  }
  return true;
}

export function releaseChatScope(scopeId: string, owner: symbol): void {
  if (owners.get(scopeId) !== owner) return;
  const monitors = runMonitors.get(scopeId);
  monitors?.get(owner)?.();
  monitors?.delete(owner);
  if (monitors?.size === 0) runMonitors.delete(scopeId);
  owners.delete(scopeId);
  publish(scopeId);
}

export function isChatScopeBusyElsewhere(scopeId: string, owner: symbol): boolean {
  const current = owners.get(scopeId);
  return current !== undefined && current !== owner;
}

export function isChatScopeOwnedBy(scopeId: string, owner: symbol): boolean {
  return owners.get(scopeId) === owner;
}

export function subscribeChatScope(scopeId: string, listener: () => void): () => void {
  const scopeListeners = listeners.get(scopeId) ?? new Set<() => void>();
  scopeListeners.add(listener);
  listeners.set(scopeId, scopeListeners);
  return () => {
    scopeListeners.delete(listener);
    if (scopeListeners.size === 0) listeners.delete(scopeId);
  };
}

export function trackChatScopeRun(
  scopeId: string,
  owner: symbol,
  getRunStatus: () => Promise<{ ok: boolean; active: boolean }>,
): void {
  if (!isChatScopeOwnedBy(scopeId, owner)) return;
  const monitors = monitorsForScope(scopeId);
  monitors.get(owner)?.();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
  monitors.set(owner, cancel);

  const poll = async () => {
    const result = await getRunStatus().catch(() => ({ ok: false, active: true }));
    if (cancelled) return;
    if (result.ok && !result.active) {
      monitors.delete(owner);
      if (monitors.size === 0) runMonitors.delete(scopeId);
      owners.delete(scopeId);
      publish(scopeId);
      return;
    }
    timer = setTimeout(() => void poll(), 400);
  };
  void poll();
}

export function resetChatScopeActivityForTests(): void {
  for (const monitors of runMonitors.values()) {
    for (const cancel of monitors.values()) cancel();
  }
  runMonitors.clear();
  owners.clear();
  listeners.clear();
}
