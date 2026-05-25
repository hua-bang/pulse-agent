/**
 * String table for the main process.
 *
 * Main only owns a handful of native-dialog strings, so a tiny key/value
 * table is enough — pulling in i18next for ~10 strings is overkill, and
 * keeping the dictionary in shared/ lets the renderer reuse the same
 * canonical keys if it ever needs to mirror a label.
 *
 * Keep entries flat (string-keyed) so the type stays a simple Record and
 * `keyof` returns just the keys. Renderer-only strings live in
 * `src/renderer/src/i18n/locales/*` and go through react-i18next.
 */

import type { SupportedLocale } from '../locales';

const EN_STRINGS = {
  'dialog.openFolder.title': 'Select Project Folder',
  'dialog.openFile.title': 'Open File',
  'dialog.exportImage.title': 'Export Image',
  'dialog.saveAs.title': 'Save As',
  'dialog.filter.markdown': 'Markdown',
  'dialog.filter.allFiles': 'All Files',
  'dialog.filter.pngImage': 'PNG Image',
} as const;

export type MainProcessKey = keyof typeof EN_STRINGS;

export const MAIN_PROCESS_STRINGS: Record<SupportedLocale, Record<MainProcessKey, string>> = {
  en: EN_STRINGS,
  zh: {
    'dialog.openFolder.title': '选择项目文件夹',
    'dialog.openFile.title': '打开文件',
    'dialog.exportImage.title': '导出图片',
    'dialog.saveAs.title': '另存为',
    'dialog.filter.markdown': 'Markdown 文档',
    'dialog.filter.allFiles': '所有文件',
    'dialog.filter.pngImage': 'PNG 图片',
  },
};
