import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '../../../shared/locales';
import { i18n } from './index';

interface SetLocaleResult {
  ok: boolean;
  error?: string;
}

/**
 * Reactive accessor for the current UI locale.
 *
 * Keeps three pieces in sync:
 *  1. React state (`locale`) — drives the language switcher UI.
 *  2. i18next runtime — `i18n.changeLanguage` reflows every `useTranslation` consumer.
 *  3. Persisted state on disk — round-tripped through main via `locale:set`,
 *     so a window reload (or a second window) sees the same choice.
 */
export function useLocale() {
  const [locale, setLocaleState] = useState<SupportedLocale>(
    () => (isSupportedLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE),
  );

  useEffect(() => {
    const handler = (lng: string) => {
      if (isSupportedLocale(lng)) setLocaleState(lng);
    };
    i18n.on('languageChanged', handler);
    return () => {
      i18n.off('languageChanged', handler);
    };
  }, []);

  useEffect(() => {
    const api = window.canvasWorkspace?.locale;
    if (!api?.onChange) return;
    return api.onChange((payload) => {
      if (isSupportedLocale(payload.locale) && payload.locale !== i18n.language) {
        void i18n.changeLanguage(payload.locale);
      }
    });
  }, []);

  const setLocale = useCallback(async (next: SupportedLocale): Promise<SetLocaleResult> => {
    if (!isSupportedLocale(next)) return { ok: false, error: 'Unsupported locale' };
    await i18n.changeLanguage(next);
    const api = window.canvasWorkspace?.locale;
    if (!api?.set) return { ok: true };
    return api.set(next);
  }, []);

  return { locale, setLocale, supported: SUPPORTED_LOCALES };
}
