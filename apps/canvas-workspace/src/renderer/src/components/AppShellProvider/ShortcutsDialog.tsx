import { useI18n } from '../../i18n';
import type { I18nKey } from '../../i18n';
import {
  SHORTCUTS,
  formatAllBindings,
  type ShortcutId,
  type ShortcutSectionId,
} from '../../shortcuts/registry';
import { Modal } from '../ui';

const SECTION_TITLE_KEY: Record<ShortcutSectionId, I18nKey> = {
  canvas: 'shortcuts.canvas.title',
  view: 'shortcuts.view.title',
  selection: 'shortcuts.selection.title',
  edit: 'shortcuts.edit.title',
  panels: 'shortcuts.panels.title',
};
const SECTION_ORDER: ShortcutSectionId[] = ['canvas', 'view', 'selection', 'edit', 'panels'];

export const SHORTCUT_HELP = {
  'canvas.commandPalette': { section: 'canvas', descriptionKey: 'shortcuts.canvas.commandPalette' },
  'canvas.commandPaletteAlt': { section: 'canvas', descriptionKey: 'shortcuts.canvas.togglePalette' },
  'canvas.find': { section: 'canvas', descriptionKey: 'shortcuts.canvas.find' },
  'canvas.findNext': { section: 'canvas', descriptionKey: 'shortcuts.canvas.findNext' },
  'canvas.cycleNodes': { section: 'canvas', descriptionKey: 'shortcuts.canvas.cycleNodes' },
  'canvas.focusMode': { section: 'canvas', descriptionKey: 'shortcuts.canvas.focusMode' },
  'canvas.zoomIn': { section: 'view', descriptionKey: 'shortcuts.view.zoomIn' },
  'canvas.zoomOut': { section: 'view', descriptionKey: 'shortcuts.view.zoomOut' },
  'canvas.zoomReset': { section: 'view', descriptionKey: 'shortcuts.view.zoomReset' },
  'canvas.fitAll': { section: 'view', descriptionKey: 'shortcuts.view.fitAll' },
  'canvas.fitSelection': { section: 'view', descriptionKey: 'shortcuts.view.fitSelection' },
  'canvas.toolSelect': { section: 'view', descriptionKey: 'shortcuts.view.toolSelect' },
  'canvas.toolHand': { section: 'view', descriptionKey: 'shortcuts.view.toolHand' },
  'canvas.toolConnect': { section: 'view', descriptionKey: 'shortcuts.view.toolConnect' },
  'canvas.nudge': { section: 'selection', descriptionKey: 'shortcuts.selection.nudgeOne' },
  'canvas.nudgeCoarse': { section: 'selection', descriptionKey: 'shortcuts.selection.nudgeTen' },
  'canvas.renameSelection': { section: 'selection', descriptionKey: 'shortcuts.selection.rename' },
  'canvas.selectAll': { section: 'edit', descriptionKey: 'shortcuts.edit.selectAll' },
  'canvas.duplicate': { section: 'edit', descriptionKey: 'shortcuts.edit.duplicate' },
  'canvas.copy': { section: 'edit', descriptionKey: 'shortcuts.edit.copy' },
  'canvas.paste': { section: 'edit', descriptionKey: 'shortcuts.edit.paste' },
  'canvas.group': { section: 'edit', descriptionKey: 'shortcuts.edit.group' },
  'canvas.ungroup': { section: 'edit', descriptionKey: 'shortcuts.edit.ungroup' },
  'canvas.delete': { section: 'edit', descriptionKey: 'shortcuts.edit.delete' },
  'canvas.undo': { section: 'edit', descriptionKey: 'shortcuts.edit.undo' },
  'canvas.redo': { section: 'edit', descriptionKey: 'shortcuts.edit.redo' },
  'canvas.redoAlt': { section: 'edit', descriptionKey: 'shortcuts.edit.redoAlt' },
  'canvas.toggleChatPanel': { section: 'panels', descriptionKey: 'shortcuts.panels.sideChat' },
  'canvas.toggleReferenceDrawer': { section: 'panels', descriptionKey: 'shortcuts.panels.reference' },
  'canvas.escape': { section: 'panels', descriptionKey: 'shortcuts.panels.escape' },
  'app.toggleChatPage': { section: 'panels', descriptionKey: 'shortcuts.panels.chatPage' },
  'app.toggleSidebar': { section: 'panels', descriptionKey: 'shortcuts.panels.sidebar' },
  'app.switchWorkspace': { section: 'panels', descriptionKey: 'shortcuts.panels.switchWorkspace' },
  'app.escapeChatPage': { section: 'panels', descriptionKey: 'shortcuts.panels.escape' },
  'app.shortcutsHelp': { section: 'panels', descriptionKey: 'shortcuts.panels.shortcuts' },
  'terminal.mentionPicker': { section: 'panels', descriptionKey: 'shortcuts.panels.terminalMentionPicker' },
} satisfies Record<ShortcutId, { section: ShortcutSectionId; descriptionKey: I18nKey }>;

const GESTURE_HELP: Array<{
  section: ShortcutSectionId;
  descriptionKey: I18nKey;
  combos: string[];
}> = [
  { section: 'canvas', descriptionKey: 'shortcuts.canvas.createMenu', combos: ['Right-click / Double-click'] },
  { section: 'canvas', descriptionKey: 'shortcuts.canvas.pan', combos: ['Scroll'] },
  { section: 'canvas', descriptionKey: 'shortcuts.canvas.spacePan', combos: ['Space + Drag'] },
  { section: 'canvas', descriptionKey: 'shortcuts.canvas.zoom', combos: ['Ctrl/Cmd + Scroll'] },
  { section: 'canvas', descriptionKey: 'shortcuts.canvas.marquee', combos: ['Drag on blank canvas'] },
  { section: 'selection', descriptionKey: 'shortcuts.selection.selectOne', combos: ['Click'] },
  { section: 'selection', descriptionKey: 'shortcuts.selection.toggle', combos: ['Shift / Ctrl/Cmd + click'] },
  { section: 'selection', descriptionKey: 'shortcuts.selection.extend', combos: ['Shift + drag on blank canvas'] },
  { section: 'selection', descriptionKey: 'shortcuts.selection.disableSnap', combos: ['Ctrl/Cmd while dragging'] },
];

/**
 * Help-only projection of the shortcut registry. This module is lazy because
 * building translated rows and rendering every key chip is unnecessary until
 * the user opens the `?` overlay.
 */
export const SHORTCUT_SECTIONS: Array<{
  titleKey: I18nKey;
  items: Array<{ combos: string[]; descriptionKey: I18nKey }>;
}> = (() => {
  const all = [
    ...GESTURE_HELP,
    ...Object.entries(SHORTCUT_HELP).map(([id, help]) => ({
      ...help,
      combos: formatAllBindings(SHORTCUTS[id as ShortcutId]),
    })),
  ];
  return SECTION_ORDER.map((section) => ({
    titleKey: SECTION_TITLE_KEY[section],
    items: all
      .filter((item) => item.section === section)
      .map((item) => ({
        combos: item.combos,
        descriptionKey: item.descriptionKey,
      }))
      .filter((item) => item.combos.length > 0),
  })).filter((section) => section.items.length > 0);
})();

export const ShortcutsDialog = ({ onClose }: { onClose: () => void }) => {
  const { t } = useI18n();

  return (
    <Modal open onClose={onClose} width={820} className="ui-modal--tall" labelledBy="shell-shortcuts-title">
      <div className="shell-dialog__header">
        <div className="shell-dialog__eyebrow">{t('shell.shortcutsKicker')}</div>
        <h2 className="shell-dialog__title" id="shell-shortcuts-title">{t('shell.shortcutsTitle')}</h2>
      </div>
      <div className="shell-shortcuts__intro">{t('shell.shortcutsIntro')}</div>
      <div className="shell-shortcuts">
        <div className="shell-shortcuts__grid">
          {SHORTCUT_SECTIONS.map((section) => (
            <section key={section.titleKey} className="shell-shortcuts__section">
              <div className="shell-shortcuts__section-title">{t(section.titleKey)}</div>
              <div className="shell-shortcuts__list">
                {section.items.map((item) => (
                  <div key={`${section.titleKey}-${item.combos.join('/')}`} className="shell-shortcuts__item">
                    <div className="shell-shortcuts__combo" aria-label={item.combos.join(' or ')}>
                      {item.combos.map((combo, index) => (
                        <span key={combo} className="shell-shortcuts__combo-group">
                          {index > 0 && <span className="shell-shortcuts__or">/</span>}
                          {combo.split(/\s*\+\s*/).map((part) => (
                            <span key={`${combo}-${part}`} className="shell-shortcuts__key">{part}</span>
                          ))}
                        </span>
                      ))}
                    </div>
                    <div className="shell-shortcuts__item-description">{t(item.descriptionKey)}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <div className="shell-dialog__footer">
        <button type="button" className="shell-dialog__button shell-dialog__button--primary" onClick={onClose}>
          {t('shell.close')}
        </button>
      </div>
    </Modal>
  );
};
