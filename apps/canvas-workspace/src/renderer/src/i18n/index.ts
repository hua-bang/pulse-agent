/**
 * Renderer-side i18n bootstrap.
 *
 * The initial locale is sourced from the preload-injected
 * `window.canvasWorkspace.locale.initial` value (resolved synchronously
 * against `~/.pulse-coder/canvas/locale.json`) so the very first React
 * render already shows the user's chosen language — no flash of English.
 *
 * `useSuspense: false` keeps the integration simple: resources are
 * bundled inline so there's nothing to suspend on anyway.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, isSupportedLocale, type SupportedLocale } from '../../../shared/locales';
import en from './locales/en';
import zh from './locales/zh';

const resources = {
  en: { translation: en },
  zh: { translation: zh },
} as const;

function readInitialLocale(): SupportedLocale {
  const fromPreload = (globalThis as { canvasWorkspace?: { locale?: { initial?: string } } })
    .canvasWorkspace?.locale?.initial;
  return isSupportedLocale(fromPreload) ? fromPreload : DEFAULT_LOCALE;
}

let initialized = false;

export function initI18n(): typeof i18n {
  if (initialized) return i18n;
  initialized = true;
  void i18n.use(initReactI18next).init({
    resources,
    lng: readInitialLocale(),
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });
  return i18n;
}

export { i18n };
