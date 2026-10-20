import type { LanguageCode } from '../../../../i18n/messages';

// Kept out of the shared message table: that table ships in the startup
// bundle, and only the lazy model settings page shows these strings.
const copy = {
  en: {
    selectAll: 'Select all',
    clearAll: 'Clear',
    contextWindowLabel: 'Context window for {model}, in K tokens',
    contextWindowTitle: 'Context window in K tokens. Empty uses the value /models reports, otherwise 128K. History is compacted at 75% of it.',
  },
  zh: {
    selectAll: '全选',
    clearAll: '取消全选',
    contextWindowLabel: '{model} 的上下文窗口（K tokens）',
    contextWindowTitle: '上下文窗口，单位 K tokens。留空则用 /models 返回的值，没有则按 128K。对话历史达到窗口的 75% 时压缩。',
  },
};

export const modelSettingsCopy = (language: LanguageCode) => (language === 'zh' ? copy.zh : copy.en);
