import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  LANGUAGE_OPTIONS,
  SUPPORTED_LANGUAGES,
  messages,
  type I18nKey,
  type LanguageCode,
} from './messages';

const STORAGE_KEY = 'pulse-canvas.language';
const DEFAULT_LANGUAGE: LanguageCode = 'en';

type Params = Record<string, string | number | boolean | null | undefined>;

interface I18nContextValue {
  language: LanguageCode;
  languageOptions: typeof LANGUAGE_OPTIONS;
  setLanguage: (language: LanguageCode) => void;
  t: (key: I18nKey, params?: Params) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const isLanguageCode = (value: unknown): value is LanguageCode => (
  typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value as LanguageCode)
);

const getInitialLanguage = (): LanguageCode => {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isLanguageCode(stored)) return stored;

  const preferred = window.navigator.language.toLowerCase();
  if (preferred.startsWith('zh')) return 'zh';
  return DEFAULT_LANGUAGE;
};

const interpolate = (template: string, params?: Params): string => {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];
    return value == null ? match : String(value);
  });
};

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<LanguageCode>(() => getInitialLanguage());

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    window.localStorage.setItem(STORAGE_KEY, language);
  }, [language]);

  const setLanguage = useCallback((nextLanguage: LanguageCode) => {
    setLanguageState(nextLanguage);
  }, []);

  const t = useCallback((key: I18nKey, params?: Params) => {
    const template = messages[language][key] ?? messages.en[key];
    return interpolate(template, params);
  }, [language]);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    languageOptions: LANGUAGE_OPTIONS,
    setLanguage,
    t,
  }), [language, setLanguage, t]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextValue => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
};

export type { I18nKey, LanguageCode };
