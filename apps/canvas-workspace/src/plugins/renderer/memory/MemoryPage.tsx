import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RendererCtx } from '../../types';
import { RefreshIcon, TrashIcon } from '../../../renderer/src/components/icons';
import './MemoryPage.css';

// Mirrors the main half's serialized shapes (plugins/main/memory/admin-ipc.ts).
interface MemoryItemView {
  id: string;
  type: 'preference' | 'rule' | 'decision' | 'fix' | 'fact';
  scope: 'session' | 'user' | 'soul';
  sourceType?: 'explicit' | 'daily-log' | 'daily-log-compact';
  summary: string;
  content: string;
  keywords: string[];
  pinned: boolean;
  updatedAt: number;
  dayKey?: string;
  hitCount?: number;
  sessionId?: string;
}

interface MemoryScopeOption {
  id: string;
  label: string;
  kind: 'global' | 'workspace';
}

interface ListResult {
  ok: boolean;
  error?: string;
  items: MemoryItemView[];
}

interface ScopesResult {
  activeId: string | null;
  scopes: MemoryScopeOption[];
}

interface MutateResult {
  ok: boolean;
  error?: string;
}

const TYPE_LABEL: Record<MemoryItemView['type'], string> = {
  preference: '偏好',
  rule: '规则',
  decision: '决策',
  fix: '修复',
  fact: '事实',
};

const formatDate = (ts: number) => (ts ? new Date(ts).toLocaleString() : '—');

interface MemoryPageProps {
  invoke: RendererCtx['invoke'];
  onBackToCanvas: () => void;
}

export const MemoryPage = ({ invoke, onBackToCanvas }: MemoryPageProps) => {
  const [scopes, setScopes] = useState<MemoryScopeOption[]>([]);
  const [selection, setSelection] = useState<string>('global');
  const [items, setItems] = useState<MemoryItemView[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadScopes = useCallback(async () => {
    try {
      const res = await invoke<ScopesResult>('list-scopes');
      setScopes(res.scopes);
      // Default to the active workspace if present, else global.
      setSelection((prev) => (prev === 'global' && res.activeId ? res.activeId : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [invoke]);

  const loadItems = useCallback(
    async (scope: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await invoke<ListResult>('list', scope);
        if (!res.ok) throw new Error(res.error || 'failed to list memory');
        setItems(res.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [invoke],
  );

  useEffect(() => {
    void loadScopes();
  }, [loadScopes]);

  useEffect(() => {
    void loadItems(selection);
  }, [loadItems, selection]);

  const pin = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await invoke<MutateResult>('pin', { selection, id });
        await loadItems(selection);
      } finally {
        setBusyId(null);
      }
    },
    [invoke, loadItems, selection],
  );

  const forget = useCallback(
    async (item: MemoryItemView) => {
      const preview = (item.summary || item.content).slice(0, 60);
      if (!window.confirm(`删除这条记忆？\n\n${preview}`)) return;
      setBusyId(item.id);
      try {
        await invoke<MutateResult>('forget', { selection, id: item.id });
        await loadItems(selection);
      } finally {
        setBusyId(null);
      }
    },
    [invoke, loadItems, selection],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      `${it.summary} ${it.content} ${it.keywords.join(' ')} ${TYPE_LABEL[it.type]}`
        .toLowerCase()
        .includes(q),
    );
  }, [items, query]);

  return (
    <div className="memory-page">
      <header className="memory-head">
        <div className="memory-head-left">
          <span className="memory-kicker">AGENT MEMORY</span>
          <h1>记忆</h1>
        </div>
        <button className="memory-back" onClick={onBackToCanvas}>
          ← 返回画布
        </button>
      </header>

      <div className="memory-toolbar">
        <select
          className="memory-scope"
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
        >
          {scopes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.kind === 'global' ? '🌐 ' : '📁 '}
              {s.label}
            </option>
          ))}
        </select>
        <input
          className="memory-search"
          placeholder="搜索记忆…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="memory-refresh" onClick={() => void loadItems(selection)} title="刷新">
          <RefreshIcon /> 刷新
        </button>
      </div>

      <div className="memory-body">
        {loading && <div className="memory-empty">加载中…</div>}
        {!loading && error && <div className="memory-empty memory-error">出错了：{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="memory-empty">
            {items.length === 0 ? '这个范围还没有任何记忆。' : '没有匹配的记忆。'}
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <ul className="memory-list">
            {filtered.map((it) => (
              <li key={it.id} className="memory-item">
                <div className="memory-item-main">
                  <div className="memory-item-top">
                    <span className={`memory-type memory-type-${it.type}`}>{TYPE_LABEL[it.type]}</span>
                    {it.pinned && <span className="memory-pinned" title="已置顶">★</span>}
                    {it.hitCount && it.hitCount > 1 && (
                      <span className="memory-hits" title="出现次数">×{it.hitCount}</span>
                    )}
                    <span className="memory-date">{formatDate(it.updatedAt)}</span>
                  </div>
                  <div className="memory-summary">{it.summary || it.content}</div>
                  {it.content && it.content !== it.summary && (
                    <div className="memory-content">{it.content}</div>
                  )}
                  {it.keywords.length > 0 && (
                    <div className="memory-keywords">
                      {it.keywords.slice(0, 8).map((k) => (
                        <span key={k} className="memory-kw">
                          {k}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="memory-item-actions">
                  {!it.pinned && (
                    <button disabled={busyId === it.id} onClick={() => void pin(it.id)} title="置顶">
                      置顶
                    </button>
                  )}
                  <button
                    className="memory-forget"
                    disabled={busyId === it.id}
                    onClick={() => void forget(it)}
                    title="删除"
                  >
                    <TrashIcon /> 删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
