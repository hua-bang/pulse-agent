/**
 * Tiny `t()` helper for main-process strings (native dialogs, etc.).
 *
 * The renderer uses react-i18next for its rich UI-text catalog; main only
 * needs to localise a handful of OS-dialog labels, so a plain lookup
 * against {@link MAIN_PROCESS_STRINGS} is enough.
 */

import {
  MAIN_PROCESS_STRINGS,
  type MainProcessKey,
} from '../shared/i18n/main-dictionary';
import type { SupportedLocale } from '../shared/locales';
import { readLocaleSync } from './locale-store';

export function t(key: MainProcessKey, locale?: SupportedLocale): string {
  const resolved = locale ?? readLocaleSync();
  const table = MAIN_PROCESS_STRINGS[resolved] ?? MAIN_PROCESS_STRINGS.en;
  return table[key] ?? MAIN_PROCESS_STRINGS.en[key];
}
