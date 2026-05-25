import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getLocale: () => 'en-US' },
}));

const { t } = await import('../i18n');

describe('main t()', () => {
  it('returns the English string when locale is en', () => {
    expect(t('dialog.openFolder.title', 'en')).toBe('Select Project Folder');
  });

  it('returns the Chinese string when locale is zh', () => {
    expect(t('dialog.openFolder.title', 'zh')).toBe('选择项目文件夹');
  });

  it('keeps every key non-empty in every supported locale', () => {
    const keys = [
      'dialog.openFolder.title',
      'dialog.openFile.title',
      'dialog.exportImage.title',
      'dialog.saveAs.title',
      'dialog.filter.markdown',
      'dialog.filter.allFiles',
      'dialog.filter.pngImage',
    ] as const;
    for (const locale of ['en', 'zh'] as const) {
      for (const key of keys) {
        expect(t(key, locale), `${locale}/${key}`).toBeTruthy();
      }
    }
  });
});
