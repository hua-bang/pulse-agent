import type { LanguageCode } from '../../../../i18n/messages';

// Kept out of the shared message table: that table ships in the startup
// bundle, and only the lazy model settings page shows these strings.
const copy = {
  en: {
    selectAll: 'Select all',
    clearAll: 'Clear',
    contextWindow: 'Context window (K tokens)',
    contextWindowPlaceholder: 'Uses the window /models reports; otherwise 128',
    contextWindowHint: 'History is compacted at 75% of this window.',
  },
  zh: {
    selectAll: '全选',
    clearAll: '取消全选',
    contextWindow: '上下文窗口（K tokens）',
    contextWindowPlaceholder: '优先用 /models 返回的值，没有则按 128',
    contextWindowHint: '对话历史达到窗口的 75% 时压缩。',
  },
};

export const modelSettingsCopy = (language: LanguageCode) => (language === 'zh' ? copy.zh : copy.en);

/** `128000` → `128K`, `1050000` → `1.05M`. */
export const formatContextWindow = (tokens: number): string => (
  tokens >= 1_000_000
    ? `${Number((tokens / 1_000_000).toFixed(2))}M`
    : `${Math.round(tokens / 1000)}K`
);
